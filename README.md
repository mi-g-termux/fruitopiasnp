# 🍊 Fruitopia — Self-Hosted E-Commerce Store

A fully-featured fruit/grocery store with a browser-based Install Wizard. One codebase works on **Localhost · Render · cPanel · VPS · Vercel · Netlify**.

---

## ⚡ Quick Start (Localhost / VPS / Render)

```bash
# 1. Clone / unzip the project
cd fruitopia

# 2. Install dependencies
npm install

# 3. Run the development server
npm run dev
# → Open http://localhost:3005 in your browser

# 4. Complete the Install Wizard (choose Firebase or Supabase)
# → Credentials are saved to .env automatically
# → The wizard never appears again (even in incognito)
```

---

## 🗄️ Database Setup

### Option A — Supabase (Recommended)

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **Project Settings → API** and copy:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **anon / public key**
3. Go to **SQL Editor** and run this schema:

```sql
-- Copy-paste this entire block into Supabase → SQL Editor, then click Run.
-- (The Install Wizard also prints this — you can use either.)

CREATE TABLE IF NOT EXISTS settings   (key TEXT PRIMARY KEY, value JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS products   (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS orders     (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS coupons    (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS newsletter (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS reviews    (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS users      (id TEXT PRIMARY KEY, data JSONB NOT NULL);

-- Gallery + Variant tables
CREATE TABLE IF NOT EXISTS product_images         (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS product_variant_groups (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS product_variants       (id TEXT PRIMARY KEY, data JSONB NOT NULL);

-- Grants (anon = your storefront's public key)
GRANT SELECT, INSERT, UPDATE, DELETE ON settings   TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON products   TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON orders     TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON coupons    TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON categories TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON newsletter TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON reviews    TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON users      TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON product_images         TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON product_variant_groups TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON product_variants       TO anon;

-- Enable Realtime on settings + orders (for live order tracking)
ALTER PUBLICATION supabase_realtime ADD TABLE settings;
ALTER PUBLICATION supabase_realtime ADD TABLE orders;

-- Enable RLS + Policies
ALTER TABLE settings              ENABLE ROW LEVEL SECURITY;
ALTER TABLE products              ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders                ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons               ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories            ENABLE ROW LEVEL SECURITY;
ALTER TABLE newsletter            ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews               ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_images         ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variant_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read settings"          ON settings              FOR SELECT USING (true);
CREATE POLICY "public read products"          ON products              FOR SELECT USING (true);
CREATE POLICY "public read categories"        ON categories            FOR SELECT USING (true);
CREATE POLICY "public read reviews"           ON reviews               FOR SELECT USING (true);
CREATE POLICY "public read coupons"           ON coupons               FOR SELECT USING (true);
CREATE POLICY "public read product_images"    ON product_images         FOR SELECT USING (true);
CREATE POLICY "public read variant_groups"    ON product_variant_groups FOR SELECT USING (true);
CREATE POLICY "public read product_variants"  ON product_variants       FOR SELECT USING (true);
CREATE POLICY "admin write settings"      ON settings   FOR INSERT WITH CHECK (true);
CREATE POLICY "admin update settings"     ON settings   FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "admin delete settings"     ON settings   FOR DELETE USING (true);
CREATE POLICY "admin write products"      ON products   FOR INSERT WITH CHECK (true);
CREATE POLICY "admin update products"     ON products   FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "admin delete products"     ON products   FOR DELETE USING (true);
CREATE POLICY "admin write categories"    ON categories FOR INSERT WITH CHECK (true);
CREATE POLICY "admin update categories"   ON categories FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "admin delete categories"   ON categories FOR DELETE USING (true);
CREATE POLICY "admin write coupons"       ON coupons    FOR INSERT WITH CHECK (true);
CREATE POLICY "admin update coupons"      ON coupons    FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "admin delete coupons"      ON coupons    FOR DELETE USING (true);
CREATE POLICY "anon write pimages"        ON product_images         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon write pvgroups"       ON product_variant_groups FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon write pvariants"      ON product_variants       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public create orders"     ON orders     FOR INSERT WITH CHECK (true);
CREATE POLICY "admin read orders"        ON orders     FOR SELECT USING (true);
CREATE POLICY "admin update orders"      ON orders     FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "admin delete orders"      ON orders     FOR DELETE USING (true);
CREATE POLICY "public create reviews"    ON reviews    FOR INSERT WITH CHECK (true);
CREATE POLICY "admin update reviews"     ON reviews    FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "admin delete reviews"     ON reviews    FOR DELETE USING (true);
CREATE POLICY "public create newsletter" ON newsletter FOR INSERT WITH CHECK (true);
CREATE POLICY "admin read newsletter"    ON newsletter FOR SELECT USING (true);
CREATE POLICY "admin delete newsletter"  ON newsletter FOR DELETE USING (true);
CREATE POLICY "public write users"       ON users      FOR ALL USING (true) WITH CHECK (true);
```

4. Open the Install Wizard and paste your URL + anon key.

### Option B — Firebase

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Firestore Database** (start in test mode)
3. Go to **Project Settings → General → Your apps → Web app** and copy the config object
4. Open the Install Wizard and paste the values

---

## 🚀 Deployment

### Render (Recommended — full Node.js server)

1. Connect your GitHub repo to Render
2. Create a **Web Service**:
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
   - Node version: `22`
3. Set Environment Variables in the Render dashboard:
   ```
   NODE_ENV=production
   PORT=10000
   # Add these AFTER the wizard runs, OR set them here to skip the wizard:
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_ANON_KEY=your-anon-key
   ```
4. Deploy. Open your Render URL → the wizard runs once → done.

### cPanel (Node.js App)

1. Upload the project files to your cPanel account
2. In cPanel → **Setup Node.js App**:
   - Node.js version: 18+
   - Application mode: Production
   - Application root: your project folder
   - Application startup file: `dist-server/server.js`
3. Run in the cPanel terminal:
   ```bash
   npm install
   npm run build
   ```
4. Add environment variables in cPanel → Node.js App → Environment Variables:
   ```
   NODE_ENV=production
   PORT=3005
   ```
5. Start the app. Open your domain → wizard runs → done.

### Vercel

> ⚠️ Vercel has a **read-only filesystem** — the wizard cannot write `.env` directly.
> After completing the wizard, it will show you the exact env vars to paste into Vercel.

1. Import the project to Vercel
2. Build settings are auto-detected from `vercel.json`
3. Run the wizard → copy the env vars shown → paste into **Vercel → Project → Settings → Environment Variables**
4. Trigger a redeploy. The wizard will never appear again.

### Netlify

Same as Vercel — Netlify's functions are stateless. The wizard shows a guide to set env vars.

> Note: Netlify + a separate Node server on Render works best. Set `NODE_API_URL` in Netlify env vars to point to your Render service URL.

### VPS / Docker

```bash
npm install
npm run build         # Builds frontend to dist/ and server to dist-server/
NODE_ENV=production npm start

# Or with PM2:
pm2 start dist-server/server.js --name fruitopia
```

---

## 🔧 Environment Variables Reference

Copy `.env.example` to `.env` and fill in your values:

| Variable | Required | Description |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | For Firebase | Firebase Web API key |
| `VITE_FIREBASE_PROJECT_ID` | For Firebase | Firebase project ID |
| `VITE_FIREBASE_AUTH_DOMAIN` | For Firebase | `project.firebaseapp.com` |
| `VITE_FIREBASE_STORAGE_BUCKET` | For Firebase | `project.appspot.com` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | For Firebase | Sender ID |
| `VITE_FIREBASE_APP_ID` | For Firebase | App ID |
| `SUPABASE_URL` | For Supabase | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | For Supabase | Public anon key |
| `PORT` | Optional | Server port (default: 3005) |
| `NODE_ENV` | Optional | `development` or `production` |
| `SMTP_HOST` | Optional | SMTP host for emails |
| `SMTP_USER` | Optional | SMTP username/email |
| `SMTP_PASS` | Optional | SMTP password / App Password |

---

## 🛡️ User Accounts & Guest Checkout

### 1-Email-1-Account Rule
- Users **cannot** register twice with the same email
- The duplicate check runs on **both** the local cache and the database backend
- The email uniqueness check happens before sending the OTP, so users get an immediate clear error

### Guest Checkout → Auto Account
When a guest completes an order:
1. The system checks if an account already exists for their email (localStorage + DB)
2. **If yes** → order is linked to their existing account, their profile is updated with the new address/phone
3. **If no** → a new account is created automatically with no password
4. A "Set your password" email is sent (requires SMTP to be configured)
5. The customer clicks the link in the email to set their password and gain full account access

### Admin Panel
- URL: `/?admin=1` or click the lock icon in the navbar
- Default credentials are set during the Install Wizard

---

## 📧 Email / SMTP Setup

Configure SMTP in the Admin Panel under **Settings → Email**:

- **Gmail**: Use an [App Password](https://myaccount.google.com/apppasswords) (enable 2FA first)
- **Host**: `smtp.gmail.com`, Port: `587`

Without SMTP configured, emails are skipped silently (the store still works — users just won't get notifications).

---

## 🐛 Troubleshooting

**Installer shows again in incognito / on a different device**

This is the primary bug this release fixes. It happens when:
- The `.env` file was not written (most common on Vercel/Netlify — use their env dashboard)
- The server hasn't been restarted after a manual `.env` edit → restart with `npm run dev` or `pm2 restart all`
- The DB `install_lock` record is missing → re-run the wizard once

**`.env` not written after Install Wizard**

On Vercel/Netlify, the filesystem is read-only. The wizard will show you the exact env vars to paste into the hosting dashboard. After adding them and redeploying, the issue is permanently resolved.

On Render/cPanel/VPS, if `.env` write fails it's usually a permissions issue. Run:
```bash
chmod 664 .env   # or create the file manually
```

**TypeScript errors in `api/` or `lib/payments/`**

These are Vercel serverless function files and compile separately in Vercel's environment. They do not affect the `npm run dev` or `npm run build` for the main application.

---

## 🏗️ Project Structure

```
fruitopia/
├── src/                    # React frontend (Vite)
│   ├── App.tsx             # Root — install gate + routing
│   ├── installStatus.ts    # 3-tier install check (server → VITE_ vars → DB lock)
│   ├── firebase.ts         # Firebase client + dynamic config
│   ├── supabase.ts         # Supabase client + dynamic config
│   ├── db.ts               # Dual-backend data layer
│   └── components/         # UI components
│       └── InstallWizard.tsx  # First-run setup wizard
├── server.ts               # Express server (dev + production)
│   ├── /api/install-status     # Returns installed:true if .env has credentials
│   ├── /api/save-config         # Writes Firebase creds to .env
│   ├── /api/save-supabase-config # Writes Supabase creds to .env
│   ├── /firebase-config.json    # Serves Firebase config from env vars
│   └── /supabase-config.json    # Serves Supabase config from env vars
├── api/                    # Vercel serverless function versions of the above
├── .env.example            # Copy to .env and fill in your values
├── vercel.json             # Vercel deploy config
├── netlify.toml            # Netlify deploy config
└── render.yaml             # Render deploy config
```

---

## 📜 License

Apache-2.0
