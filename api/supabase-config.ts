/**
 * Vercel Serverless Function: GET /api/supabase-config
 *
 * Returns the Supabase project URL and public anon key as JSON,
 * built from environment variables set in Vercel Project Settings.
 *
 * vercel.json rewrites /supabase-config.json → /api/supabase-config, so the
 * browser fetch in src/supabase.ts transparently picks this up.
 *
 * Accepted env var names (VITE_ prefix or bare — either works):
 *   VITE_SUPABASE_URL          or  SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY     or  SUPABASE_ANON_KEY
 *   VITE_SUPABASE_PUBLISHABLE_KEY or SUPABASE_PUBLISHABLE_KEY  (aliases)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

function pick(...keys: (string | undefined)[]): string {
  for (const k of keys) {
    const v = (process.env[k ?? ''] ?? '').trim();
    if (v) return v;
  }
  return '';
}

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const projectUrl = pick(
    'VITE_SUPABASE_URL',
    'SUPABASE_URL',
  );
  const anonKey = pick(
    'VITE_SUPABASE_ANON_KEY',
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_ANON_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
  );

  if (!projectUrl || !anonKey) {
    const missing: string[] = [];
    if (!projectUrl) missing.push('SUPABASE_URL (or VITE_SUPABASE_URL)');
    if (!anonKey)    missing.push('SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY)');
    return res.status(404).json({
      error: 'supabase-config not configured',
      missing,
      hint: 'Set the SUPABASE_URL and SUPABASE_ANON_KEY (or their VITE_ prefixed equivalents) in Vercel Project Settings → Environment Variables, then redeploy.',
    });
  }

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).json({ projectUrl, anonKey });
}
