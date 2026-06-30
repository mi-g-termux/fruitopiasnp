#!/usr/bin/env node
/**
 * build-api.js
 * Pre-bundles api/_payment.ts (and ALL lib/payments/* deps) into a single
 * self-contained api/payment.js using esbuild.
 *
 * WHY THIS IS NEEDED
 * ─────────────────────────────────────────────────────────────────────────
 * Vercel @vercel/node v3 compiles api/*.ts individually with tsc/ncc but does
 * NOT recursively bundle relative imports that live OUTSIDE the api/ folder.
 * Because package.json has "type":"module", the compiled api/payment.js tries
 * ESM imports like:
 *   import bkashCreate from '../lib/payments/bkash/create-payment'
 * at runtime — but those .ts source files are never compiled to .js, so every
 * payment call crashes with ERR_MODULE_NOT_FOUND.
 *
 * SOLUTION
 * ─────────────────────────────────────────────────────────────────────────
 * 1. Source lives at api/_payment.ts  (underscore = Vercel ignores it as a route)
 * 2. This script bundles it + all lib/payments/* into api/payment.js
 * 3. Vercel deploys api/payment.js directly — no recompilation, no missing modules
 * 4. All rewrites in vercel.json (/api/sslcommerz/:action → /api/payment) still work
 */

import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

console.log('\n🔨 Bundling api/_payment.ts → api/payment.js ...\n');

await build({
  entryPoints: [path.join(root, 'api/_payment.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: path.join(root, 'api/payment.js'),
  // @vercel/node is provided by Vercel runtime — keep external
  // Node built-ins are also external (available in Lambda)
  external: [
    '@vercel/node',
    'crypto',
    'buffer',
    'stream',
    'url',
    'path',
    'fs',
    'http',
    'https',
    'os',
    'net',
    'tls',
    'zlib',
    'events',
    'util',
    'querystring',
    'module',
    'worker_threads',
    'child_process',
    'assert',
    'string_decoder',
    'perf_hooks',
    'v8',
    'vm',
  ],
  banner: {
    // CJS interop shim for any require() calls inside bundled code
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
  logLevel: 'info',
  minify: false,
  sourcemap: false,
  // Silence "use client" / "use server" warnings from lib files
  ignoreAnnotations: false,
});

console.log('\n✅ api/payment.js bundled — all gateways (bKash, Nagad, SSLCommerz, Stripe,');
console.log('   PayPal, Razorpay, Paytm, UPI, JazzCash, Easypaisa, PayFast) are included.\n');
