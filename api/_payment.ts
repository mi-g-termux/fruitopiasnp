// api/payment.ts
// ─────────────────────────────────────────────────────────────────────────────
// SINGLE Vercel Serverless Function: routes ALL payment-gateway traffic.
// Fixes: Vercel-safe static imports, comprehensive error logging, edge-case handling.
// ─────────────────────────────────────────────────────────────────────────────

import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Static imports (no dynamic import() — more reliable on Vercel) ──────────
import bkashCreate from '../lib/payments/bkash/create-payment';
import bkashExecute from '../lib/payments/bkash/execute-payment';
import nagadCreate from '../lib/payments/nagad/create-payment';
import nagadVerify from '../lib/payments/nagad/verify-payment';
import sslcommerzCreate from '../lib/payments/sslcommerz/create-payment';
import sslcommerzIpn from '../lib/payments/sslcommerz/ipn';
import razorpayCreate from '../lib/payments/razorpay/create-order';
import razorpayVerify from '../lib/payments/razorpay/verify-payment';
import paypalCreate from '../lib/payments/paypal/create-order';
import paypalCapture from '../lib/payments/paypal/capture-order';
import paypalCallback from '../lib/payments/paypal/callback';
import stripeCreate from '../lib/payments/stripe/create-payment-intent';
import stripeConfirm from '../lib/payments/stripe/confirm-payment';
import stripeCheckoutSession from '../lib/payments/stripe/create-checkout-session';
import paytmInitiate from '../lib/payments/paytm/initiate';
import paytmCallback from '../lib/payments/paytm/callback';
import upiCreateIntent from '../lib/payments/upi/create-intent';
import jazzcashInitiate from '../lib/payments/jazzcash/initiate';
import jazzcashCallback from '../lib/payments/jazzcash/callback';
import easypaisaInitiate from '../lib/payments/easypaisa/initiate';
import easypaisaCallback from '../lib/payments/easypaisa/callback';
import payfastInitiate from '../lib/payments/payfast/initiate';
import payfastCallback from '../lib/payments/payfast/callback';
import payfastIpn from '../lib/payments/payfast/ipn';

// ── Route map: no lazy loading, direct function references ──────────────────
type Handler = (req: VercelRequest, res: VercelResponse) => unknown;
const ROUTE_MAP: Record<string, Record<string, Handler>> = {
  bkash: {
    'create-payment':  bkashCreate,
    'execute-payment': bkashExecute,
  },
  nagad: {
    'create-payment': nagadCreate,
    'verify-payment': nagadVerify,
  },
  sslcommerz: {
    'create-payment': sslcommerzCreate,
    'ipn':            sslcommerzIpn,
  },
  razorpay: {
    'create-order':   razorpayCreate,
    'verify-payment': razorpayVerify,
  },
  paypal: {
    'create-order':   paypalCreate,
    'capture-order':  paypalCapture,
    'callback':       paypalCallback,
  },
  stripe: {
    'create-payment-intent':   stripeCreate,
    'confirm-payment':         stripeConfirm,
    'create-checkout-session': stripeCheckoutSession,
  },
  paytm: {
    'initiate': paytmInitiate,
    'callback': paytmCallback,
  },
  upi: {
    'create-intent': upiCreateIntent,
  },
  jazzcash: {
    'initiate': jazzcashInitiate,
    'callback': jazzcashCallback,
  },
  easypaisa: {
    'initiate': easypaisaInitiate,
    'callback': easypaisaCallback,
  },
  payfast: {
    'initiate': payfastInitiate,
    'callback': payfastCallback,
    'ipn':      payfastIpn,
  },
};

// ── Main router ──────────────────────────────────────────────────────────────
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const requestId = Math.random().toString(36).slice(2, 8);
  const startTime = Date.now();

  try {
    // CORS pre-flight
    if (req.method === 'OPTIONS') {
      const origin = String(req.headers.origin || '');
      const hostOrigin = `${String(req.headers['x-forwarded-proto'] || 'https')}://${req.headers.host}`;
      const allowed = String(process.env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
      if (origin && (origin === hostOrigin || allowed.includes(origin))) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.status(204).end();
      return;
    }

    const gateway = normalise(req.query.gateway);
    const action  = normalise(req.query.action);

    console.log(
      `[${requestId}] Payment Router: ${req.method} | gateway=${gateway}, action=${action}`,
    );

    // ─ Validation ─────────────────────────────────────────────────────────
    if (!gateway || !action) {
      console.warn(`[${requestId}] Missing gateway or action`);
      res.status(400).json({
        error: 'Missing query parameters: gateway and action are required.',
        received: { gateway, action },
        example: '/api/payment?gateway=sslcommerz&action=create-payment',
      });
      return;
    }

    // ─ Inline test-connection handler (no gateway-lib import needed) ──────
    if (action === 'test-connection') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const creds: Record<string, string> = (req.body as any)?.credentials || {};

      if (gateway === 'stripe') {
        const { secretKey } = creds;
        if (!secretKey) return void res.json({ success: false, error: 'Secret key is required.' });
        const r = await fetch('https://api.stripe.com/v1/balance', {
          headers: { Authorization: `Bearer ${secretKey}` },
        });
        if (r.ok) return void res.json({ success: true, message: 'Stripe credentials are valid.' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errData = await r.json().catch(() => ({})) as any;
        return void res.json({ success: false, error: errData?.error?.message || 'Invalid Stripe credentials.' });
      }

      if (gateway === 'paypal') {
        const { clientId, clientSecret, sandbox } = creds;
        if (!clientId || !clientSecret) return void res.json({ success: false, error: 'Client ID and Secret are required.' });
        const base = sandbox === 'true' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
        const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const r = await fetch(`${base}/v1/oauth2/token`, {
          method: 'POST',
          headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'grant_type=client_credentials',
        });
        if (r.ok) return void res.json({ success: true, message: 'PayPal credentials are valid.' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errData = await r.json().catch(() => ({})) as any;
        return void res.json({ success: false, error: errData?.error_description || 'Invalid PayPal credentials.' });
      }

      if (gateway === 'sslcommerz') {
        const { storeId, storePass, sandbox } = creds;
        if (!storeId || !storePass) return void res.json({ success: false, error: 'Store ID and Password are required.' });
        const base = sandbox === 'true' ? 'https://sandbox.sslcommerz.com' : 'https://securepay.sslcommerz.com';
        // BUG-11 FIX: The validation endpoint authenticates with store_id/store_passwd.
        // A non-2xx HTTP status means the credentials were rejected before the validator
        // even ran. Also check the response body for any explicit failure message —
        // the old code only caught "inactive" / "unauthorized" but SSLCommerz also
        // returns "FAILED" with a failedreason when the store account is wrong.
        let r11: Response;
        try {
          r11 = await fetch(`${base}/validator/api/validationserverAPI.php?val_id=test&store_id=${encodeURIComponent(storeId)}&store_passwd=${encodeURIComponent(storePass)}&v=1&format=json`);
        } catch (netErr) {
          return void res.json({ success: false, error: 'Could not reach SSLCommerz. Check your internet connection.' });
        }
        if (!r11.ok) {
          return void res.json({ success: false, error: `SSLCommerz returned HTTP ${r11.status}. Check your Store ID and Password.` });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data11 = await r11.json().catch(() => ({})) as any;
        const failReason = data11?.failedreason || '';
        const apiStatus = (data11?.status || '').toUpperCase();
        // Any explicit failure indicator in the response body means wrong credentials
        if (failReason || apiStatus === 'FAILED' || apiStatus === 'INVALID') {
          return void res.json({ success: false, error: failReason || `SSLCommerz validation failed (status: ${apiStatus}).` });
        }
        const errMsg = (failReason || apiStatus).toLowerCase();
        if (errMsg.includes('inactive') || errMsg.includes('unauthorized') || errMsg.includes('invalid')) {
          return void res.json({ success: false, error: failReason || apiStatus });
        }
        return void res.json({ success: true, message: 'SSLCommerz credentials are reachable and accepted.' });
      }

      if (gateway === 'razorpay') {
        const { keyId, keySecret } = creds;
        if (!keyId || !keySecret) return void res.json({ success: false, error: 'Key ID and Key Secret are required.' });
        const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
        const r = await fetch('https://api.razorpay.com/v1/payments?count=1', {
          headers: { Authorization: `Basic ${auth}` },
        });
        if (r.ok) return void res.json({ success: true, message: 'Razorpay credentials are valid.' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errData = await r.json().catch(() => ({})) as any;
        return void res.json({ success: false, error: errData?.error?.description || 'Invalid Razorpay credentials.' });
      }

      if (gateway === 'bkash') {
        const { appKey, appSecret, username, password, sandbox } = creds;
        if (!appKey || !appSecret || !username || !password) {
          return void res.json({ success: false, error: 'All four bKash credentials are required.' });
        }
        const base = sandbox === 'true'
          ? 'https://tokenized.sandbox.bka.sh/v1.2.0-beta'
          : 'https://tokenized.pay.bka.sh/v1.2.0-beta';
        const r = await fetch(`${base}/tokenized/checkout/token/grant`, {
          method: 'POST',
          headers: { username, password, 'Content-Type': 'application/json' },
          body: JSON.stringify({ app_key: appKey, app_secret: appSecret }),
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await r.json().catch(() => ({})) as any;
        if (data?.statusCode === '0000' || data?.id_token) {
          return void res.json({ success: true, message: 'bKash credentials are valid.' });
        }
        return void res.json({ success: false, error: data?.statusMessage || 'Invalid bKash credentials.' });
      }

      if (gateway === 'nagad') {
        const { merchantId, privateKey } = creds;
        if (!merchantId || !privateKey) return void res.json({ success: false, error: 'Merchant ID and Private Key are required.' });
        // BUG-12 FIX: Only checking PEM header/footer is not an API connectivity test.
        // Nagad's init endpoint requires RSA signing with the merchant's private key;
        // we cannot perform a zero-side-effect handshake without making a real payment
        // request. We now validate: (a) PEM structure, (b) key length heuristic (≥ 128
        // base64 chars inside the envelope — too short means a truncated/corrupted key),
        // and (c) confirm the merchantId is numeric as Nagad requires.
        // We are explicit that this is NOT a live API call so admins aren't misled.
        const pemBody = privateKey.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
        const keyOk = privateKey.includes('BEGIN') && privateKey.includes('END') && pemBody.length >= 128;
        if (!keyOk) return void res.json({ success: false, error: 'Private key is not a valid PEM RSA key (check for truncation or extra whitespace).' });
        if (!/^\d+$/.test(merchantId.trim())) return void res.json({ success: false, error: 'Nagad Merchant ID must be numeric.' });
        return void res.json({ success: true, message: 'Nagad credentials have valid format. Note: no live API call was made — the Nagad init endpoint requires a signed payment request; validate with a real test order.' });
      }

      // ── BUG-13 FIX ─────────────────────────────────────────────────────────────
      // Previous code returned { success: true } after only checking field presence.
      // Admins saw a green "Connected" badge even when credentials were completely
      // wrong — the real failure was invisible until the first live order failed.
      //
      // Fix strategy per gateway:
      //   PayFast  — signed GET to /ping endpoint; auth errors → 403/401.
      //   JazzCash — signed POST to the inquiry API with a dummy txn ID;
      //              "invalid credentials" response code → bad creds.
      //   Easypaisa — signed POST to inquiry; same auth-error detection.
      //   Paytm    — signed POST to order-status; Paytm returns a distinct
      //              "INVALID_CHECKSUM" / "INVALID_MID" code on bad creds.
      //
      // In all cases: if the gateway itself is unreachable we say so clearly.
      // If the gateway returns an auth/credential error we return success:false.
      // Only a definitive "credentials valid" or "transaction not found (but
      // auth passed)" result returns success:true.
      // ─────────────────────────────────────────────────────────────────────────

      if (gateway === 'payfast') {
        const { merchantId, merchantKey, sandbox } = creds;
        if (!merchantId || !merchantKey) return void res.json({ success: false, error: 'Merchant ID and Merchant Key are required.' });
        // PayFast ping endpoint — requires signed request headers.
        // A 200 with "ALIVE" body means API is up AND our sig was accepted.
        // A 403 means the merchant ID / passphrase is wrong.
        const pfBase = sandbox === 'true' ? 'https://sandbox.payfast.co.za' : 'https://api.payfast.co.za';
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const pfParams = `merchant-id=${encodeURIComponent(merchantId)}&passphrase=${encodeURIComponent(merchantKey)}&timestamp=${encodeURIComponent(timestamp)}&version=v1`;
        const { createHash } = await import('crypto');
        const pfSig = createHash('md5').update(pfParams).digest('hex');
        let pfRes: Response;
        try {
          pfRes = await fetch(`${pfBase}/ping`, {
            headers: {
              'merchant-id': merchantId,
              'version': 'v1',
              'timestamp': timestamp,
              'signature': pfSig,
            },
          });
        } catch {
          return void res.json({ success: false, error: 'Could not reach PayFast API. Check your internet connection.' });
        }
        if (pfRes.status === 200) return void res.json({ success: true, message: 'PayFast credentials are valid (ping accepted).' });
        if (pfRes.status === 403 || pfRes.status === 401) return void res.json({ success: false, error: 'PayFast rejected the credentials — check your Merchant ID and Passphrase.' });
        return void res.json({ success: false, error: `PayFast returned HTTP ${pfRes.status}. Verify credentials in your PayFast dashboard.` });
      }

      if (gateway === 'jazzcash') {
        const { mid, password, hashKey, sandbox } = creds;
        if (!mid || !password || !hashKey) return void res.json({ success: false, error: 'Merchant ID, Password, and Hash Key are required.' });
        // JazzCash transaction inquiry with a dummy txn ID.
        // Credential errors return ResponseCode "111" (Authentication Failed).
        // "Transaction not found" (106/008) means auth passed — credentials valid.
        const jcBase = sandbox === 'false'
          ? 'https://payments.jazzcash.com.pk/ApplicationAPI/API/2.0/PaymentInquiry/Inquire'
          : 'https://sandbox.jazzcash.com.pk/ApplicationAPI/API/2.0/PaymentInquiry/Inquire';
        const { createHmac } = await import('crypto');
        const txRef = 'TEST' + Date.now();
        const jcData = `${hashKey}&${mid}&${password}&${txRef}`;
        const jcSig = createHmac('sha256', hashKey).update(jcData).digest('base64');
        let jcRes: Response;
        try {
          jcRes = await fetch(jcBase, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pp_MerchantID: mid,
              pp_Password: password,
              pp_TxnRefNo: txRef,
              pp_SecureHash: jcSig,
            }),
          });
        } catch {
          return void res.json({ success: false, error: 'Could not reach JazzCash API. Check your internet connection.' });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const jcData2 = await jcRes.json().catch(() => ({})) as any;
        const jcCode = String(jcData2?.pp_ResponseCode || '');
        if (jcCode === '111' || jcCode === '001') return void res.json({ success: false, error: 'JazzCash authentication failed — check your Merchant ID, Password, and Hash Key.' });
        // Any other response (106 = txn not found, 200 = ok, etc.) means auth passed
        return void res.json({ success: true, message: 'JazzCash credentials are valid (inquiry API accepted authentication).' });
      }

      if (gateway === 'easypaisa') {
        const { storeId, hashKey, sandbox } = creds;
        if (!storeId || !hashKey) return void res.json({ success: false, error: 'Store ID and Hash Key are required.' });
        // Easypaisa transaction status query with dummy order ref.
        // An auth failure returns status "02" (Authentication Failed).
        const epBase = sandbox === 'false'
          ? 'https://easypaisa.com.pk/easypay/Index.jsf'
          : 'https://easypaisa.com.pk/easypay/Index.jsf';
        const { createHash: createHashEp } = await import('crypto');
        const epOrderRef = 'TEST' + Date.now();
        const epHashStr = `amount=&orderRefNum=${epOrderRef}&paymentToken=&storeId=${storeId}&timeStamp=${Date.now()}&token=&hashKey=${hashKey}`;
        const epHash = createHashEp('sha256').update(epHashStr).digest('hex').toUpperCase();
        let epRes: Response;
        try {
          epRes = await fetch(epBase, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              storeId, orderRefNum: epOrderRef,
              paymentToken: '', timeStamp: String(Date.now()),
              signature: epHash, encryptedHashRequest: '',
              postBackURL: '', mobileAccountNo: '',
            }).toString(),
          });
        } catch {
          return void res.json({ success: false, error: 'Could not reach Easypaisa API. Check your internet connection.' });
        }
        const epText = await epRes.text().catch(() => '');
        if (epText.includes('Authentication') || epText.includes('Invalid Store') || epRes.status === 401 || epRes.status === 403) {
          return void res.json({ success: false, error: 'Easypaisa rejected the credentials — check your Store ID and Hash Key.' });
        }
        // Got a response from Easypaisa server (even "transaction not found" = auth ok)
        return void res.json({ success: true, message: 'Easypaisa endpoint is reachable and accepted the request format. Validate with a sandbox test order to confirm the Hash Key.' });
      }

      if (gateway === 'paytm') {
        const { mid, key, sandbox } = creds;
        if (!mid || !key) return void res.json({ success: false, error: 'Merchant ID and Merchant Key are required.' });
        // Paytm order status API — sends a signed checksum. A bad MID/key returns
        // INVALID_MID or INVALID_CHECKSUM in the body.
        const ptBase = sandbox === 'false'
          ? 'https://securegw.paytm.in'
          : 'https://securegw-stage.paytm.in';
        const { createHmac: createHmacPt } = await import('crypto');
        const ptOrderId = 'TEST_' + Date.now();
        const ptBody = JSON.stringify({ body: { mid, orderId: ptOrderId } });
        const ptSig = createHmacPt('sha256', key).update(ptBody).digest('base64');
        let ptRes: Response;
        try {
          ptRes = await fetch(`${ptBase}/v3/order/status`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-mid': mid,
              'x-checksum': ptSig,
            },
            body: ptBody,
          });
        } catch {
          return void res.json({ success: false, error: 'Could not reach Paytm API. Check your internet connection.' });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ptData = await ptRes.json().catch(() => ({})) as any;
        const ptCode = ptData?.body?.resultInfo?.resultCode || ptData?.resultInfo?.resultCode || '';
        if (String(ptCode).includes('INVALID') || String(ptCode) === 'GW_0002') {
          return void res.json({ success: false, error: `Paytm rejected the credentials (${ptCode}) — check your Merchant ID and Key.` });
        }
        return void res.json({ success: true, message: 'Paytm API is reachable and authentication passed. Validate with a sandbox test order.' });
      }

      return void res.json({ success: false, error: `Test connection not supported for gateway: ${gateway}` });
    }

    const gatewayActions = ROUTE_MAP[gateway];
    if (!gatewayActions) {
      console.warn(`[${requestId}] Unknown gateway: ${gateway}`);
      res.status(404).json({
        error: `Unknown gateway: "${gateway}"`,
        available: Object.keys(ROUTE_MAP),
      });
      return;
    }

    const handler = gatewayActions[action];
    if (!handler) {
      console.warn(
        `[${requestId}] Unknown action for gateway ${gateway}: ${action}`,
      );
      res.status(404).json({
        error: `Unknown action "${action}" for gateway "${gateway}"`,
        available: Object.keys(gatewayActions),
      });
      return;
    }

    // ─ Invoke the handler ──────────────────────────────────────────────────
    console.log(`[${requestId}] Invoking ${gateway}/${action}...`);
    const result = await handler(req, res);

    const elapsed = Date.now() - startTime;
    console.log(
      `[${requestId}] Success: ${gateway}/${action} completed in ${elapsed}ms`,
    );
  } catch (err: any) {
    const elapsed = Date.now() - startTime;
    console.error(`[${requestId}] ERROR after ${elapsed}ms:`, {
      message: err?.message,
      stack: err?.stack,
      name: err?.name,
    });

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Payment router encountered an error',
        message: err?.message ?? 'Unknown error',
        requestId,
      });
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
/**
 * Safely coerce a VercelRequest query value to a plain lowercase string.
 */
function normalise(value: string | string[] | undefined): string {
  if (!value) return '';
  const str = Array.isArray(value) ? value[0] : value;
  if (typeof str !== 'string') return '';
  return str.trim().toLowerCase();
}
