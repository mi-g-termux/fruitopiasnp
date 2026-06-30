import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

function getOrigin(req: VercelRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  return `${proto}://${req.headers.host}`;
}
function ok(res: VercelResponse, body: unknown) { return res.status(200).json(body); }
function fail(res: VercelResponse, status: number, msg: string, extra?: object) {
  return res.status(status).json({ success: false, error: msg, ...extra });
}
function getCreds(gw: string): Record<string, string> {
  const e = (k: string) => String(process.env[k] || '').trim();
  switch (gw) {
    case 'stripe':     return { secretKey: e('STRIPE_SECRET_KEY'), publicKey: e('STRIPE_PUBLIC_KEY') };
    case 'paypal':     return { clientId: e('PAYPAL_CLIENT_ID'), clientSecret: e('PAYPAL_CLIENT_SECRET'), isSandbox: e('PAYPAL_SANDBOX') || 'true' };
    case 'sslcommerz': return { storeId: e('SSLCZ_STORE_ID'), storePass: e('SSLCZ_STORE_PASSWORD'), isSandbox: e('SSLCZ_SANDBOX') || 'true' };
    case 'nagad':      return { merchantId: e('NAGAD_MERCHANT_ID'), merchantNumber: e('NAGAD_MERCHANT_NUMBER'), publicKey: e('NAGAD_PUBLIC_KEY'), privateKey: e('NAGAD_PRIVATE_KEY'), isSandbox: e('NAGAD_SANDBOX') || 'true' };
    case 'razorpay':   return { keyId: e('RAZORPAY_KEY_ID'), keySecret: e('RAZORPAY_KEY_SECRET') };
    case 'bkash':      return { appKey: e('BKASH_APP_KEY'), appSecret: e('BKASH_APP_SECRET'), username: e('BKASH_USERNAME'), password: e('BKASH_PASSWORD'), isSandbox: e('BKASH_SANDBOX') || 'true' };
    default: return {};
  }
}

// ── BKASH ─────────────────────────────────────────────────────────────────
function bkashBase(sandbox: boolean) {
  return sandbox
    ? 'https://tokenized.sandbox.bka.sh/v1.2.0-beta/tokenized/checkout'
    : 'https://tokenized.pay.bka.sh/v1.2.0-beta/tokenized/checkout';
}
async function bkashToken(appKey: string, appSecret: string, username: string, password: string, sandbox: boolean) {
  const r = await fetch(`${bkashBase(sandbox)}/token/grant`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', username, password },
    body: JSON.stringify({ app_key: appKey, app_secret: appSecret }),
  });
  const d: any = await r.json().catch(() => ({}));
  if (!d.id_token) throw new Error(d.statusMessage || `bKash token failed (${r.status})`);
  return d.id_token as string;
}
async function bkashCreatePayment(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');
  const { amount, orderId, callbackURL, sandboxMode = true } = req.body || {};
  if (!amount || !callbackURL) return fail(res, 400, 'amount and callbackURL required');
  const c = getCreds('bkash');
  if (!c.appKey || !c.appSecret || !c.username || !c.password)
    return fail(res, 400, 'Missing bKash credentials: BKASH_APP_KEY, BKASH_APP_SECRET, BKASH_USERNAME, BKASH_PASSWORD');
  try {
    const sandbox = sandboxMode !== false && c.isSandbox !== 'false';
    const token = await bkashToken(c.appKey, c.appSecret, c.username, c.password, sandbox);
    const r = await fetch(`${bkashBase(sandbox)}/create`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: token, 'X-APP-Key': c.appKey },
      body: JSON.stringify({ mode: '0011', payerReference: orderId || `QF-${Date.now()}`, callbackURL, amount: Number(amount).toFixed(2), currency: 'BDT', intent: 'sale', merchantInvoiceNumber: orderId }),
    });
    const d: any = await r.json().catch(() => ({}));
    if (!d.bkashURL) return fail(res, 502, d.statusMessage || 'bKash create failed');
    return ok(res, { success: true, bkashURL: d.bkashURL, paymentID: d.paymentID });
  } catch (e: any) { return fail(res, 500, e.message); }
}
async function bkashExecutePayment(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');
  const { paymentID, paymentId, sandboxMode = true } = req.body || {};
  const pid = paymentID || paymentId;
  if (!pid) return fail(res, 400, 'paymentID required');
  const c = getCreds('bkash');
  if (!c.appKey) return fail(res, 400, 'Missing bKash credentials');
  try {
    const sandbox = sandboxMode !== false && c.isSandbox !== 'false';
    const token = await bkashToken(c.appKey, c.appSecret, c.username, c.password, sandbox);
    const r = await fetch(`${bkashBase(sandbox)}/execute`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: token, 'X-APP-Key': c.appKey },
      body: JSON.stringify({ paymentID: pid }),
    });
    const d: any = await r.json().catch(() => ({}));
    if (d.transactionStatus !== 'Completed') return fail(res, 502, d.statusMessage || 'bKash execute failed', { transactionStatus: d.transactionStatus });
    return ok(res, { success: true, paymentID: d.paymentID, transactionId: d.trxID, amount: d.amount });
  } catch (e: any) { return fail(res, 500, e.message); }
}

// ── NAGAD ─────────────────────────────────────────────────────────────────
const NAGAD_PUB =
  '-----BEGIN PUBLIC KEY-----\n' +
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAty2hOpfNUS4NLFNwhJsy\n' +
  'JCfsLisFqcU8RcZGtUE/9SqLNCBR5GoxFAyx0RBfDOyOXyVlAj4nBjBKLi63rGzG\n' +
  'a04L+y4SLZjzukWZSrkXa3kcMtH2QQ1JcSf1hEt+gNW1u/m+ZHrXnXjg1JG9wKjN\n' +
  '/0HHTtA9rIa9XwIDAQAB\n' +
  '-----END PUBLIC KEY-----';
function nagadEncrypt(data: string, pub: string) {
  return crypto.publicEncrypt({ key: pub, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(data)).toString('base64');
}
function nagadSign(data: string, priv: string) {
  const s = crypto.createSign('SHA256'); s.update(data); s.end(); return s.sign(priv, 'base64');
}
function asPem(key: string, label: 'PUBLIC' | 'PRIVATE') {
  if (key.includes('-----BEGIN')) return key.replace(/\\n/g, '\n');
  return `-----BEGIN ${label} KEY-----\n${key}\n-----END ${label} KEY-----`;
}
async function nagadCreatePayment(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');
  const { amount, orderId, callbackUrl: cb, sandboxMode } = req.body || {};
  if (!amount || !orderId) return fail(res, 400, 'amount and orderId required');
  const c = getCreds('nagad');
  if (!c.merchantId || !c.privateKey) return fail(res, 400, 'Missing NAGAD_MERCHANT_ID or NAGAD_PRIVATE_KEY');
  const sandbox = sandboxMode !== false && c.isSandbox !== 'false';
  const base = sandbox
    ? 'https://sandbox.mynagad.com:10080/remote-payment-gateway-1.0/api/dfs'
    : 'https://api.mynagad.com/api/dfs';
  try {
    const privKey = asPem(c.privateKey, 'PRIVATE');
    const datetime = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const challenge = crypto.randomBytes(20).toString('hex');
    const sensitive = { merchantId: c.merchantId, datetime, orderId, challenge };
    const enc = nagadEncrypt(JSON.stringify(sensitive), NAGAD_PUB);
    const sig = nagadSign(JSON.stringify(sensitive), privKey);
    const initR = await fetch(`${base}/check-out/initialize/${c.merchantId}/${orderId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-KM-IP-V4': (req.headers['x-forwarded-for'] as string) || '127.0.0.1', 'X-KM-Client-Type': 'PC_WEB', 'X-KM-Api-Version': 'v-0.2.0' },
      body: JSON.stringify({ dateTime: datetime, sensitiveData: enc, signature: sig }),
    });
    const initJ: any = await initR.json();
    if (!initJ?.sensitiveData) return fail(res, 502, 'Nagad init failed');
    const cSens = { merchantId: c.merchantId, orderId, amount: String(amount), currencyCode: '050', challenge };
    const cEnc = nagadEncrypt(JSON.stringify(cSens), NAGAD_PUB);
    const cSig = nagadSign(JSON.stringify(cSens), privKey);
    const callbackUrl = cb || `${getOrigin(req)}/?nagad=callback&orderId=${orderId}`;
    const confR = await fetch(`${base}/check-out/complete/${initJ.paymentReferenceId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sensitiveData: cEnc, signature: cSig, merchantCallbackURL: callbackUrl }),
    });
    const confJ: any = await confR.json();
    if (!confJ?.callBackUrl) return fail(res, 502, 'Nagad confirm failed');
    return ok(res, { success: true, callBackUrl: confJ.callBackUrl, orderId });
  } catch (e: any) { return fail(res, 500, e.message); }
}
async function nagadVerifyPayment(req: VercelRequest, res: VercelResponse) {
  const refId = (req.query.payment_ref_id as string) || req.body?.paymentRefId;
  if (!refId) return fail(res, 400, 'paymentRefId required');
  const c = getCreds('nagad');
  const base = c.isSandbox !== 'false'
    ? 'https://sandbox.mynagad.com:10080/remote-payment-gateway-1.0/api/dfs'
    : 'https://api.mynagad.com/api/dfs';
  const r = await fetch(`${base}/verify/payment/${refId}`).catch(() => null);
  if (!r) return fail(res, 502, 'Nagad unreachable');
  const j: any = await r.json().catch(() => ({}));
  return ok(res, { success: j?.status === 'Success' || j?.statusCode === '000', raw: j });
}

// ── SSLCOMMERZ ────────────────────────────────────────────────────────────
const _sslPending = new Set<string>();
async function sslcommerzCreatePayment(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');
  const { amount, orderId, customer = {}, productName = 'Order', sandboxMode } = req.body || {};
  if (!amount || !orderId) return fail(res, 400, 'amount and orderId required');
  if (_sslPending.has(String(orderId))) return fail(res, 429, 'Already processing');
  _sslPending.add(String(orderId));
  try {
    const c = getCreds('sslcommerz');
    if (sandboxMode !== undefined) c.isSandbox = String(sandboxMode);
    if (!c.storeId || !c.storePass) return fail(res, 400, 'Missing SSLCZ_STORE_ID or SSLCZ_STORE_PASSWORD');
    const sandbox = c.isSandbox !== 'false';
    const base = sandbox ? 'https://sandbox.sslcommerz.com' : 'https://securepay.sslcommerz.com';
    const origin = getOrigin(req);
    const form = new URLSearchParams({
      store_id: c.storeId, store_passwd: c.storePass,
      total_amount: Number(amount).toFixed(2), currency: 'BDT', tran_id: String(orderId),
      success_url: `${origin}/api/payment?gateway=sslcommerz&action=ipn&status=success&orderId=${encodeURIComponent(orderId)}`,
      fail_url:    `${origin}/api/payment?gateway=sslcommerz&action=ipn&status=fail&orderId=${encodeURIComponent(orderId)}`,
      cancel_url:  `${origin}/api/payment?gateway=sslcommerz&action=ipn&status=cancel&orderId=${encodeURIComponent(orderId)}`,
      ipn_url:     `${origin}/api/payment?gateway=sslcommerz&action=ipn`,
      cus_name: String(customer.name || 'Customer'), cus_email: String(customer.email || 'noreply@example.com'),
      cus_phone: String(customer.phone || '01700000000'), cus_add1: String(customer.address || 'N/A'),
      cus_city: String(customer.city || 'Dhaka'), cus_country: String(customer.country || 'Bangladesh'),
      shipping_method: 'NO', product_name: String(productName),
      product_category: 'general', product_profile: 'general', num_of_item: '1', value_a: String(orderId),
    });
    const r = await fetch(`${base}/gwprocess/v4/api.php`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(),
    });
    const text = await r.text();
    let j: any;
    try { j = JSON.parse(text); } catch { return fail(res, 502, 'SSLCommerz invalid response'); }
    if (j?.status !== 'SUCCESS' || !j?.GatewayPageURL) return fail(res, 502, j?.failedreason || 'SSLCommerz session failed');
    return ok(res, { success: true, redirectUrl: j.GatewayPageURL, sessionkey: j.sessionkey });
  } catch (e: any) { return fail(res, 500, e.message); }
  finally { setTimeout(() => _sslPending.delete(String(orderId)), 30_000); }
}
async function sslcommerzIpn(req: VercelRequest, res: VercelResponse) {
  const body   = req.method === 'POST' ? (req.body || {}) : {};
  const status  = String(body.status  || req.query.status  || 'unknown');
  const orderId = String(body.tran_id || req.query.orderId || '');
  const valId   = body.val_id as string | undefined;
  let verified = false;
  if (valId) {
    const c = getCreds('sslcommerz');
    const base = c.isSandbox !== 'false' ? 'https://sandbox.sslcommerz.com' : 'https://securepay.sslcommerz.com';
    const vr = await fetch(`${base}/validator/api/validationserverAPI.php?val_id=${encodeURIComponent(valId)}&store_id=${encodeURIComponent(c.storeId)}&store_passwd=${encodeURIComponent(c.storePass)}&format=json`).catch(() => null);
    if (vr?.ok) { const vj: any = await vr.json().catch(() => ({})); verified = vj?.status === 'VALID' || vj?.status === 'VALIDATED'; }
  }
  const flag = status === 'success' ? (verified ? 'success' : 'fail') : status;
  return res.redirect(302, `${getOrigin(req)}/?sslcz=${flag}&orderId=${encodeURIComponent(orderId)}`);
}

// ── STRIPE ────────────────────────────────────────────────────────────────
async function stripeCreatePaymentIntent(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');
  const { amount, currency = 'usd' } = req.body || {};
  if (!amount) return fail(res, 400, 'amount required');
  const c = getCreds('stripe');
  if (!c.secretKey) return fail(res, 400, 'Missing STRIPE_SECRET_KEY');
  const r = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST', headers: { Authorization: `Bearer ${c.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ amount: String(Math.round(Number(amount) * 100)), currency: String(currency).toLowerCase(), 'automatic_payment_methods[enabled]': 'true' }).toString(),
  });
  const d: any = await r.json();
  if (d.error) return fail(res, 502, d.error.message);
  return ok(res, { success: true, clientSecret: d.client_secret, paymentIntentId: d.id });
}
async function stripeConfirmPayment(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');
  const { paymentIntentId, paymentMethodId } = req.body || {};
  if (!paymentIntentId || !paymentMethodId) return fail(res, 400, 'paymentIntentId and paymentMethodId required');
  const c = getCreds('stripe');
  if (!c.secretKey) return fail(res, 400, 'Missing STRIPE_SECRET_KEY');
  const r = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}/confirm`, {
    method: 'POST', headers: { Authorization: `Bearer ${c.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ payment_method: paymentMethodId }).toString(),
  });
  const d: any = await r.json();
  if (d.error) return fail(res, 502, d.error.message);
  return ok(res, { success: true, status: d.status, transactionId: d.id });
}
async function stripeCreateCheckoutSession(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');
  const { amount, currency = 'usd', orderId, productName = 'Order', customerEmail, successUrl, cancelUrl } = req.body || {};
  if (!amount || !successUrl || !cancelUrl) return fail(res, 400, 'amount, successUrl, cancelUrl required');
  const c = getCreds('stripe');
  if (!c.secretKey) return fail(res, 400, 'Missing STRIPE_SECRET_KEY');
  const p = new URLSearchParams({
    mode: 'payment', success_url: successUrl, cancel_url: cancelUrl,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': String(currency).toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(Math.round(Number(amount) * 100)),
    'line_items[0][price_data][product_data][name]': String(productName).slice(0, 250),
  });
  if (customerEmail) p.set('customer_email', String(customerEmail));
  if (orderId) { p.set('client_reference_id', String(orderId)); p.set('metadata[orderId]', String(orderId)); }
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST', headers: { Authorization: `Bearer ${c.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: p.toString(),
  });
  const d: any = await r.json();
  if (d.error || !d.url) return fail(res, 502, d.error?.message || 'Stripe checkout failed');
  return ok(res, { success: true, sessionId: d.id, url: d.url });
}

// ── PAYPAL ────────────────────────────────────────────────────────────────
async function ppToken(clientId: string, secret: string, sandbox: boolean) {
  const base = sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
  const r = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${clientId}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const d: any = await r.json();
  if (!d.access_token) throw new Error('PayPal token failed');
  return { token: d.access_token as string, base };
}
async function paypalCreateOrder(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');
  const { amount, currency = 'USD', sandboxMode } = req.body || {};
  if (!amount) return fail(res, 400, 'amount required');
  const c = getCreds('paypal');
  if (sandboxMode !== undefined) c.isSandbox = String(sandboxMode);
  if (!c.clientId || !c.clientSecret) return fail(res, 400, 'Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET');
  try {
    const sandbox = c.isSandbox !== 'false';
    const { token, base } = await ppToken(c.clientId, c.clientSecret, sandbox);
    const origin = getOrigin(req);
    const r = await fetch(`${base}/v2/checkout/orders`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: String(currency).toUpperCase(), value: Number(amount).toFixed(2) } }],
        application_context: {
          return_url: `${origin}/api/payment?gateway=paypal&action=callback&status=success`,
          cancel_url: `${origin}/api/payment?gateway=paypal&action=callback&status=cancelled`,
        },
      }),
    });
    const d: any = await r.json();
    if (!d.id) return fail(res, 502, 'PayPal order failed');
    return ok(res, { success: true, orderId: d.id, approvalUrl: d.links?.find((l: any) => l.rel === 'approve')?.href });
  } catch (e: any) { return fail(res, 500, e.message); }
}
async function paypalCaptureOrder(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');
  const { orderId } = req.body || {};
  if (!orderId) return fail(res, 400, 'orderId required');
  const c = getCreds('paypal');
  if (!c.clientId || !c.clientSecret) return fail(res, 400, 'Missing PayPal credentials');
  try {
    const { token, base } = await ppToken(c.clientId, c.clientSecret, c.isSandbox !== 'false');
    const r = await fetch(`${base}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const d: any = await r.json();
    if (d.status === 'COMPLETED') return ok(res, { success: true, transactionId: d.purchase_units?.[0]?.payments?.captures?.[0]?.id });
    return fail(res, 502, 'PayPal capture failed');
  } catch (e: any) { return fail(res, 500, e.message); }
}
function paypalCallback(req: VercelRequest, res: VercelResponse) {
  const { token, status } = req.query;
  return res.redirect(302, `${getOrigin(req)}/?paypal=${status === 'cancelled' ? 'cancelled' : 'approved'}&orderId=${token || ''}`);
}

// ── RAZORPAY ──────────────────────────────────────────────────────────────
async function razorpayCreateOrder(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');
  const { amount, currency = 'INR', orderId } = req.body || {};
  if (!amount) return fail(res, 400, 'amount required');
  const c = getCreds('razorpay');
  if (!c.keyId || !c.keySecret) return fail(res, 400, 'Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET');
  const r = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${c.keyId}:${c.keySecret}`).toString('base64'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: Math.round(Number(amount) * 100), currency, receipt: String(orderId || `r_${Date.now()}`) }),
  });
  const d: any = await r.json();
  if (!d.id) return fail(res, 502, 'Razorpay order failed');
  return ok(res, { success: true, orderId: d.id, amount: d.amount, currency: d.currency, keyId: c.keyId });
}
async function razorpayVerifyPayment(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) return fail(res, 400, 'Missing fields');
  const c = getCreds('razorpay');
  if (!c.keySecret) return fail(res, 400, 'Missing RAZORPAY_KEY_SECRET');
  const expected = crypto.createHmac('sha256', c.keySecret).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
  const verified = expected.length === String(razorpay_signature).length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(razorpay_signature)));
  return ok(res, { success: verified, verified });
}

// ── ROUTER ────────────────────────────────────────────────────────────────
type H = (req: VercelRequest, res: VercelResponse) => unknown;
const ROUTES: Record<string, Record<string, H>> = {
  bkash:      { 'create-payment': bkashCreatePayment, 'execute-payment': bkashExecutePayment },
  nagad:      { 'create-payment': nagadCreatePayment, 'verify-payment': nagadVerifyPayment },
  sslcommerz: { 'create-payment': sslcommerzCreatePayment, 'ipn': sslcommerzIpn },
  stripe:     { 'create-payment-intent': stripeCreatePaymentIntent, 'confirm-payment': stripeConfirmPayment, 'create-checkout-session': stripeCreateCheckoutSession },
  paypal:     { 'create-order': paypalCreateOrder, 'capture-order': paypalCaptureOrder, 'callback': paypalCallback },
  razorpay:   { 'create-order': razorpayCreateOrder, 'verify-payment': razorpayVerifyPayment },
};
function norm(v: string | string[] | undefined) {
  return (Array.isArray(v) ? v[0] : v || '').trim().toLowerCase();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    return res.status(204).end();
  }
  const gateway = norm(req.query.gateway);
  const action  = norm(req.query.action);
  if (!gateway || !action) return fail(res, 400, 'Missing ?gateway=&action=', { available: Object.keys(ROUTES) });
  const gr = ROUTES[gateway];
  if (!gr) return fail(res, 404, `Unknown gateway: ${gateway}`, { available: Object.keys(ROUTES) });
  const fn = gr[action];
  if (!fn) return fail(res, 404, `Unknown action: ${action}`, { available: Object.keys(gr) });
  try { await fn(req, res); } catch (e: any) { if (!res.headersSent) fail(res, 500, e?.message || 'Error'); }
}