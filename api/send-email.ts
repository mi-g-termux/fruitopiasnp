/**
 * Vercel Serverless Function: /api/send-email
 *
 * Replaces the Express server's /api/send-email route.
 * Vercel auto-deploys files under /api/ as serverless functions.
 *
 * Supports an optional `attachments` array, each item shaped as:
 *   { filename: string, content: string (base64), contentType?: string }
 * This is how the order-confirmation flow attaches the PDF invoice.
 *
 * Gmail SMTP setup:
 *   host: smtp.gmail.com
 *   port: 587
 *   email: yourname@gmail.com
 *   password: YOUR_APP_PASSWORD  ← NOT your Gmail login password!
 *             (Google Account → Security → 2-Step Verification → App Passwords)
 *
 * HTTP status codes returned:
 *   200 — sent successfully (or simulated when SMTP not configured)
 *   400 — missing / invalid request fields
 *   429 — rate limited
 *   503 — SMTP server unreachable / timed out (network issue)
 *   500 — unexpected server error
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';

interface InboundAttachment {
  filename?: string;
  content?: string; // base64 (without data: URI prefix)
  contentType?: string;
}

type RL = { count: number; reset: number };
const emailRl: Map<string, RL> = (globalThis as any).__fruEmailRL || new Map();
(globalThis as any).__fruEmailRL = emailRl;

const sanitize = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max) : '';

function isEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function checkRate(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const cur = emailRl.get(key);
  if (!cur || now > cur.reset) {
    emailRl.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (cur.count >= max) return false;
  cur.count++;
  return true;
}

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
function classifySmtpError(
  err: any,
  context: { host: string; port: number },
): { message: string; httpStatus: number } {
  const code: string = (err.code  || '').toUpperCase();
  const msg:  string = (err.message || '').toLowerCase();
  const platform = getPlatformName();

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
        'Authentication failed. Check your email address and App Password. ' +
        'For Gmail: go to myaccount.google.com/apppasswords — do NOT use your Gmail login password. ' +
        'For Outlook: enable SMTP AUTH in Microsoft 365 Admin Center. ' +
        'For Yahoo: generate an App Password at login.yahoo.com/account/security.',
      httpStatus: 503,
    };
  }

  if (
    code === 'ENOTFOUND' ||
    msg.includes('getaddrinfo') ||
    msg.includes('enotfound') ||
    msg.includes('dns')
  ) {
    return {
      message:
        `DNS lookup failed for host "${context.host}". ` +
        'Check the Mail Host — it may be misspelled or unreachable from this server.',
      httpStatus: 503,
    };
  }

  if (code === 'ECONNREFUSED') {
    const altPort = context.port === 587 ? 465 : 587;
    return {
      message:
        `Connection refused on port ${context.port} to "${context.host}". ` +
        `Try port ${altPort} instead.` +
        (platform ? ` ${platform} may restrict this port.` : ''),
      httpStatus: 503,
    };
  }

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
        'RENDER PLATFORM: Render.com free plans block outbound SMTP on ports 25, 465, and 587. ' +
        'Use a transactional email API (Resend, SendGrid, Mailgun, AWS SES) which works over HTTPS. ' +
        `Alternatively, try port 2525 if your provider supports it.`;
    } else {
      detail =
        `Connection to "${context.host}:${context.port}" timed out. ` +
        `Your hosting provider may block port ${context.port}. ` +
        `Try port ${altPort} or port 2525. ` +
        'Contact your host to confirm outbound SMTP is allowed.';
    }
    return { message: detail, httpStatus: 503 };
  }

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
        `TLS/SSL error on port ${context.port}. ` +
        `Port 465 uses implicit SSL; port 587 uses STARTTLS. Try port ${altPort}.`,
      httpStatus: 503,
    };
  }

  if (code === 'ECONNRESET' || msg.includes('econnreset') || msg.includes('connection reset')) {
    return {
      message:
        'Connection was reset by the SMTP server. Verify credentials and try toggling port 465 ↔ 587.',
      httpStatus: 503,
    };
  }

  if (msg.includes('self signed') || msg.includes('self-signed') || msg.includes('cert')) {
    return {
      message:
        'TLS certificate error. Common with cPanel/shared hosting — contact your provider for the correct SMTP host.',
      httpStatus: 503,
    };
  }

  return {
    message: `SMTP error [${code || 'UNKNOWN'}] on ${context.host}:${context.port} — ${err.message}`,
    httpStatus: 500,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const raw = req.body || {};
  const to      = sanitize(raw.to, 254);
  const subject = sanitize(raw.subject, 200);
  const html    = typeof raw.html === 'string' ? raw.html.slice(0, 100_000) : '';
  const { smtpSettings, attachments } = raw;

  if (!to || !subject || !html) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, html' });
  }
  if (!isEmail(to)) {
    return res.status(400).json({ error: 'Invalid recipient email' });
  }
  if (!checkRate(`email:${to}`, 10, 60_000)) {
    return res.status(429).json({ success: false, error: 'Too many email requests. Please wait before retrying.' });
  }

  const smtp = smtpSettings || { isEnabled: false };

  if (!smtp.isEnabled || !smtp.host || !smtp.email || !smtp.password) {
    console.log(`[EMAIL SKIPPED] SMTP not configured. Would have sent to: ${to} | Subject: ${subject}`);
    return res.status(200).json({
      success:   true,
      simulated: true,
      message:   'SMTP not configured — email skipped. Configure SMTP in Admin → Settings → SMTP.',
    });
  }

  const port          = Number(smtp.port || 587);
  const isImplicitSsl = port === 465;
  const requireTLS    = !isImplicitSsl;

  const diag = {
    to,
    host:       smtp.host,
    port,
    secure:     isImplicitSsl,
    requireTLS,
    email:      smtp.email,
    platform:   getPlatformName() || 'unknown',
    attachmentCount: Array.isArray(attachments) ? attachments.length : 0,
  };
  console.log('[EMAIL SEND START]', JSON.stringify(diag));

  try {
    const transporter = nodemailer.createTransport({
      host:               smtp.host,
      port,
      secure:             isImplicitSsl,
      requireTLS,
      auth:               { user: smtp.email, pass: smtp.password },
      tls:                { rejectUnauthorized: false },
      socketTimeout:      30000,
      greetingTimeout:    20000,
      connectionTimeout:  20000,
    });

    const normalizedAttachments = Array.isArray(attachments)
      ? attachments
          .filter((a: InboundAttachment) => a && typeof a.content === 'string' && a.content.length > 0)
          .map((a: InboundAttachment) => ({
            filename:    a.filename || 'attachment',
            content:     a.content as string,
            encoding:    'base64' as const,
            contentType: a.contentType || 'application/octet-stream',
          }))
      : [];

    const info = await transporter.sendMail({
      from:        `"${smtp.fromName || 'Store'}" <${smtp.email}>`,
      to,
      subject,
      html,
      attachments: normalizedAttachments.length ? normalizedAttachments : undefined,
    });

    console.log('[EMAIL SENT]', JSON.stringify({ ...diag, messageId: info.messageId }));
    return res.status(200).json({ success: true, messageId: info.messageId });

  } catch (err: any) {
    console.error('[EMAIL ERROR]', JSON.stringify({
      ...diag,
      errorCode:         err.code,
      errorCommand:      err.command,
      errorResponse:     err.response,
      errorResponseCode: err.responseCode,
      errorMessage:      err.message,
      stack:             err.stack?.split('\n').slice(0, 5).join(' | '),
    }));

    const { message, httpStatus } = classifySmtpError(err, { host: smtp.host, port });
    return res.status(httpStatus).json({ success: false, error: message });
  }
}
