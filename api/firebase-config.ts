/**
 * Vercel Serverless Function: GET /api/firebase-config
 *
 * Returns the Firebase Web App config as JSON, built from environment
 * variables set in Vercel Project Settings → Environment Variables.
 *
 * vercel.json rewrites /firebase-config.json → /api/firebase-config, so the
 * browser fetch in src/firebase.ts transparently picks this up — no
 * firebase-config.json file needs to live in the repo or be uploaded.
 *
 * Required env vars (minimum — only these 3 are truly required):
 *   FIREBASE_API_KEY          (also: VITE_FIREBASE_API_KEY)
 *   FIREBASE_AUTH_DOMAIN      (also: VITE_FIREBASE_AUTH_DOMAIN)
 *   FIREBASE_PROJECT_ID       (also: VITE_FIREBASE_PROJECT_ID)
 *
 * Optional env vars:
 *   FIREBASE_STORAGE_BUCKET         (also: VITE_FIREBASE_STORAGE_BUCKET)
 *   FIREBASE_MESSAGING_SENDER_ID    (also: VITE_FIREBASE_MESSAGING_SENDER_ID)
 *   FIREBASE_APP_ID                 (also: VITE_FIREBASE_APP_ID)
 *   FIREBASE_DATABASE_ID            (also: VITE_FIREBASE_DATABASE_ID)
 *
 * NOTE: The function accepts BOTH VITE_ prefixed and bare FIREBASE_ names,
 * so users only need ONE set of vars regardless of naming convention.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

function pick(...keys: (string | undefined)[]): string {
  for (const k of keys) {
    const v = (process.env[k ?? ''] ?? '').trim();
    if (v) return v;
  }
  return '';
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Only 3 fields are truly required for Firebase to initialise.
  // storageBucket, messagingSenderId, appId are optional extras — omitting
  // them does not prevent the app from connecting to Firestore/Auth.
  const apiKey            = pick('VITE_FIREBASE_API_KEY',             'FIREBASE_API_KEY');
  const authDomain        = pick('VITE_FIREBASE_AUTH_DOMAIN',         'FIREBASE_AUTH_DOMAIN');
  const projectId         = pick('VITE_FIREBASE_PROJECT_ID',          'FIREBASE_PROJECT_ID');
  const storageBucket     = pick('VITE_FIREBASE_STORAGE_BUCKET',      'FIREBASE_STORAGE_BUCKET');
  const messagingSenderId = pick('VITE_FIREBASE_MESSAGING_SENDER_ID', 'FIREBASE_MESSAGING_SENDER_ID');
  const appId             = pick('VITE_FIREBASE_APP_ID',              'FIREBASE_APP_ID');
  const databaseId        = pick('VITE_FIREBASE_DATABASE_ID',         'FIREBASE_DATABASE_ID');

  // Only fail if the 3 core fields are missing
  const missing: string[] = [];
  if (!apiKey)       missing.push('FIREBASE_API_KEY');
  if (!authDomain)   missing.push('FIREBASE_AUTH_DOMAIN');
  if (!projectId)    missing.push('FIREBASE_PROJECT_ID');

  if (missing.length > 0) {
    return res.status(404).json({
      error: 'firebase-config not configured',
      missing,
      hint: 'Set the FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, and FIREBASE_PROJECT_ID environment variables in Vercel Project Settings → Environment Variables, then redeploy.',
    });
  }

  // Build the config — only include optional fields if they are present
  const cfg: Record<string, string> = { apiKey, authDomain, projectId };
  if (storageBucket)     cfg.storageBucket     = storageBucket;
  if (messagingSenderId) cfg.messagingSenderId = messagingSenderId;
  if (appId)             cfg.appId             = appId;
  if (databaseId && databaseId !== '(default)') cfg.databaseId = databaseId;

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).json(cfg);
}
