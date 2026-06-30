/**
 * Vercel Serverless Function: /api/verify-smtp
 *
 * Tests the SMTP connection and authentication without sending an email.
 * Called by Admin Dashboard → SMTP Settings → "Verify Connection" button.
 *
 * HTTP status codes:
 *   400 — missing / invalid credentials (caller's fault)
 *   503 — SMTP server unreachable / timed out / rejected (network/platform issue)
 *   200 — connection verified successfully
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';

// ── Platform detection ────────────────────────────────────────────────────────
const IS_RENDER   = !!(process.env.RENDER);
const IS_VERCEL   = !!(process.env.VERCEL);
const IS_NETLIFY  = !!(process.env.NETLIFY);

function getPlatformName(): string {
  if (IS_RENDER)  return 'Render';
  if (IS_VERCEL)  return 'Vercel';
  if (IS_NETLIFY) return 'Netlify';
  return '';
}

// ── Context-aware SMTP error classifier ──────────────────────────────────────
// Returns { message, httpStatus } so the caller can use the right HTTP code.
function classifySmtpError(
  err: any,
  context: { host: string; port: number; secure: boolean; requireTLS: boolean; email: string },
): { message: string; httpStatus: number } {
  const code: string = (err.code  || '').toUpperCase();
  const msg:  string = (err.message || '').toLowerCase();
  const platform = getPlatformName();

  // ── Auth failures ──────────────────────────────────────────────────────────
  if (
    code === 'EAUTH' ||
    msg.includes('invalid login') ||
    msg.includes('authentication failed') ||
    msg.includes('username and password') ||
    msg.includes('bad credentials') ||
    msg.includes('535') ||
    msg.includes('534') ||
    msg.includes('530')
  ) {
    return {
      message:
        'Authentication failed. ' +
        'Check your email address and App Password. ' +
        'For Gmail: go to myaccount.google.com/apppasswords and generate an App Password ' +
        '— do NOT use your regular Gmail login password. ' +
        'For Outlook: enable SMTP AUTH in Microsoft 365 Admin Center. ' +
        'For Yahoo: generate an App Password at login.yahoo.com/account/security.',
      httpStatus: 401,
    };
  }

  // ── DNS failures ───────────────────────────────────────────────────────────
  if (
    code === 'ENOTFOUND' ||
    msg.includes('getaddrinfo') ||
    msg.includes('enotfound') ||
    msg.includes('dns')
  ) {
    return {
      message:
        `DNS lookup failed for host "${context.host}". ` +
        'Check the Mail Host — it may be misspelled or unreachable. ' +
        'Common values: smtp.gmail.com, smtp-mail.outlook.com, smtp.zoho.com, ' +
        'smtp.mail.yahoo.com, mail.yourdomain.com.',
      httpStatus: 503,
    };
  }

  // ── Connection refused ─────────────────────────────────────────────────────
  if (code === 'ECONNREFUSED') {
    const altPort = context.port === 587 ? 465 : 587;
    return {
      message:
        `Connection refused on port ${context.port} to "${context.host}". ` +
        `Try port ${altPort} instead. ` +
        (platform ? `${platform} may restrict this port. ` : '') +
        'Also verify the Mail Host is correct for your provider.',
      httpStatus: 503,
    };
  }

  // ── Timeout ────────────────────────────────────────────────────────────────
  if (
    code === 'ETIMEDOUT' ||
    code === 'ESOCKETTIMEDOUT' ||
    msg.includes('timed out') ||
    msg.includes('etimedout')
  ) {
    const altPort = context.port === 587 ? 465 : 587;
    let detail: string;

    if (platform === 'Render') {
      detail =
        'RENDER PLATFORM DETECTED: Render.com free plans block outbound SMTP on ports 25, 465, and 587. ' +
        'Options: (1) Upgrade to a Render paid plan and contact Render support to enable outbound SMTP. ' +
        '(2) Switch to a transactional email API that uses HTTPS — e.g. Resend (resend.com), SendGrid, ' +
        'Mailgun, or AWS SES. These bypass SMTP entirely and work on all platforms. ' +
        `(3) Try port 2525 if your provider supports it (some bypass firewall rules).`;
    } else if (platform === 'Vercel' || platform === 'Netlify') {
      detail =
        `${platform} serverless functions may have short execution timeouts (10 s default). ` +
        'If your SMTP server is slow to respond, increase timeouts or switch to a transactional API. ' +
        `Currently trying port ${context.port} — also try port ${altPort}.`;
    } else {
      detail =
        `Connection to "${context.host}" on port ${context.port} timed out. ` +
        `Your hosting provider may block outbound SMTP on port ${context.port}. ` +
        `Try port ${altPort} instead. ` +
        'Port 2525 is another alternative that is often not firewalled. ' +
        'Contact your hosting provider to confirm outbound SMTP is allowed.';
    }
    return { message: detail, httpStatus: 503 };
  }

  // ── TLS / SSL failures ─────────────────────────────────────────────────────
  if (
    code === 'ESOCKET' ||
    msg.includes('tls') ||
    msg.includes('ssl') ||
    msg.includes('certificate') ||
    msg.includes('handshake')
  ) {
    const altPort = context.port === 587 ? 465 : 587;
    return {
      message:
        `TLS/SSL negotiation failed on port ${context.port}. ` +
        `Port 465 requires implicit SSL (secure: true). ` +
        `Port 587 requires STARTTLS (secure: false + requireTLS: true). ` +
        `Try switching to port ${altPort}.`,
      httpStatus: 503,
    };
  }

  // ── Self-signed certificate ────────────────────────────────────────────────
  if (msg.includes('self signed') || msg.includes('self-signed') || msg.includes('cert')) {
    return {
      message:
        'TLS certificate error. The SMTP server presented an untrusted certificate. ' +
        'This is common with cPanel/shared hosting — contact your provider for the correct SMTP host, ' +
        'or enable "Allow self-signed certificates" if your admin panel supports it.',
      httpStatus: 503,
    };
  }

  // ── Connection reset ───────────────────────────────────────────────────────
  if (code === 'ECONNRESET' || msg.includes('econnreset') || msg.includes('connection reset')) {
    return {
      message:
        'Connection was reset by the SMTP server mid-session. ' +
        'This can mean wrong TLS mode (try toggling port 465 ↔ 587) or the server rate-limited the connection.',
      httpStatus: 503,
    };
  }

  // ── Fallback ───────────────────────────────────────────────────────────────
  return {
    message: `SMTP error [${code || 'UNKNOWN'}] on ${context.host}:${context.port} — ${err.message}`,
    httpStatus: 503,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  const { smtpSettings } = body;
  const smtp = smtpSettings || {};

  // ── Validate required fields ───────────────────────────────────────────────
  const missing: string[] = [];
  if (!smtp.host)     missing.push('host');
  if (!smtp.email)    missing.push('email');
  if (!smtp.password) missing.push('password');
  if (missing.length > 0) {
    return res.status(400).json({
      success: false,
      error: `Missing required SMTP fields: ${missing.join(', ')}. ` +
             'Ensure the Mail Host, Sender Email Address, and App Password / Secret are all filled in.',
    });
  }

  const port          = Number(smtp.port || 587);
  const isImplicitSsl = port === 465;
  const requireTLS    = !isImplicitSsl;

  // ── Structured diagnostic log (no password) ───────────────────────────────
  const diag = {
    host:        smtp.host,
    port,
    secure:      isImplicitSsl,
    requireTLS,
    email:       smtp.email,
    platform:    getPlatformName() || 'unknown',
    render:      IS_RENDER,
    vercel:      IS_VERCEL,
    netlify:     IS_NETLIFY,
  };
  console.log('[SMTP VERIFY START]', JSON.stringify(diag));

  const transporter = nodemailer.createTransport({
    host:               smtp.host,
    port,
    secure:             isImplicitSsl,
    requireTLS,
    auth:               { user: smtp.email, pass: smtp.password },
    tls:                { rejectUnauthorized: false },
    socketTimeout:      20000,
    greetingTimeout:    15000,
    connectionTimeout:  15000,
  });

  try {
    await transporter.verify();
    transporter.close();
    console.log('[SMTP VERIFY OK]', JSON.stringify(diag));
    return res.status(200).json({
      success: true,
      message: `Connected to ${smtp.host}:${port} successfully. Credentials are valid.`,
    });
  } catch (err: any) {
    transporter.close();

    // Full structured error log (no password exposed)
    console.error('[SMTP VERIFY FAIL]', JSON.stringify({
      ...diag,
      errorCode:      err.code,
      errorCommand:   err.command,
      errorResponse:  err.response,
      errorResponseCode: err.responseCode,
      errorMessage:   err.message,
      stack:          err.stack?.split('\n').slice(0, 5).join(' | '),
    }));

    const { message, httpStatus } = classifySmtpError(err, {
      host:       smtp.host,
      port,
      secure:     isImplicitSsl,
      requireTLS,
      email:      smtp.email,
    });

    return res.status(httpStatus).json({ success: false, error: message });
  }
}
