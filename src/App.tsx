/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Fruitopia — App.tsx  (Root Renderer)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * All listener management is centralised in AppContext's `_mountListenersForEngine()`.
 * This file manages routing only: install gate, admin panel, order tracker, main site.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { ToastProvider, useToast } from './components/Toast';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { FavoritesMenu } from './components/FavoritesMenu';
import { Testimonial } from './components/Testimonial';
import { Newsletter } from './components/Newsletter';
import { Footer } from './components/Footer';
import { CartModal } from './components/CartModal';
import { AdminPanel } from './components/AdminPanel';
import { OrderTrackerPage } from './components/OrderTrackerPage';
import { ProductDetailPage } from './components/ProductDetailPage';
import InstallWizard from './components/InstallWizard';
import { onFirebaseReadyChange } from './firebase';
import { onSupabaseReadyChange } from './supabase';
import { checkInstalled, type InstalledBackend } from './installStatus';

function AppContent() {
  const [currentPath, setCurrentPath]             = useState(window.location.pathname);
  const [isCartOpen, setIsCartOpen]               = useState(false);
  const [searchQuery, setSearchQuery]             = useState('');
  const [activeCategory, setActiveCategory]       = useState<string | null>(null);
  // ❌ REMOVED: emailBannerDismissed - no longer needed (banner removed)

  // ── INSTALL GATE ──────────────────────────────────────────────────────────
  // The ONLY thing that counts as "installed" is the presence of a valid
  // firebase-config.json file served from the web root or public/ URL. localStorage is NOT
  // trusted — it is per-browser, so an incognito window or a different device
  // would otherwise see the installer while one browser sees the homepage.
  //
  //  - 'checking' : verifying /firebase-config.json
  //  - 'install'  : file missing or invalid → show InstallWizard
  //  - 'ready'    : file present and valid → render the app
  const [installState, setInstallState] = useState<'checking' | 'install' | 'ready'>('checking');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [installedBackend, setInstalledBackend] = useState<InstalledBackend | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkInstall() {
      // Cross-backend check: looks at BOTH Firebase config file + install_lock
      // and Supabase localStorage + install_lock row. The site is "installed"
      // only when one of those engines has both config AND a server-side lock.
      const result = await checkInstalled();
      if (cancelled) return;
      setInstalledBackend(result.backend);
      setInstallState(result.installed ? 'ready' : 'install');
    }

    // Expose so InstallWizard can trigger a re-check after the admin uploads
    // the file and clicks "Verify Upload".
    (window as any).__fruitopiaCheckInstall = checkInstall;

    checkInstall();

    const unsub = onFirebaseReadyChange(() => { checkInstall(); });
    const unsubSb = onSupabaseReadyChange(() => { checkInstall(); });

    return () => {
      cancelled = true;
      unsub();
      unsubSb();
      delete (window as any).__fruitopiaCheckInstall;
    };
  }, []);


  const {
    siteSettings,
    isAdminLoggedIn,
    isLoading,
    emailVerificationSettings,
    isEmailVerified,
    verifyEmailToken,
    userProfile,
    isUserLoggedIn,
    sendEmailVerification,
  } = useApp();

  const toast = useToast();

  // ── Reset switch: /install?reset=1 wipes browser-side install cache ──
  // Lets the operator force the wizard to reappear after a prior install
  // on the same browser (clears localStorage Firebase + installed flag).
  useEffect(() => {
    if (window.location.pathname === '/install' && new URLSearchParams(window.location.search).get('reset') === '1') {
      try {
        localStorage.removeItem('fruitopia_installed');
        localStorage.removeItem('fruitopia_dynamic_firebase');
        localStorage.removeItem('fruitopia_active_engine');
        localStorage.removeItem('fruitopia_supabase_config');
      } catch {}
      window.history.replaceState({}, '', '/install');
      window.location.reload();
    }
  }, []);

  // ── Path tracking ─────────────────────────────────────────────────────────
  useEffect(() => {
    const handleLocationChange = () => setCurrentPath(window.location.pathname);
    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('hashchange', handleLocationChange);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('hashchange', handleLocationChange);
    };
  }, []);

  // ── Email verification URL param handler ──────────────────────────────────
  // Handles ?verify_token=xxx&verify_email=yyy deep links
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token  = params.get('verify_token');
    const email  = params.get('verify_email');
    if (token && email) {
      const result = verifyEmailToken(email, token);
      if (result.success) {
        toast.success('✅ Email verified successfully! You can now place orders.');
      } else {
        toast.error(result.message);
      }
      window.history.replaceState({}, '', window.location.pathname);
    }
    // BUG-41 FIX: eslint-disable comment was suppressing a legitimate stale-closure
    // warning. verifyEmailToken comes from AppContext and its reference only changes
    // when the context re-renders, but since this effect only runs once on mount
    // (to handle the deep-link query params), adding it to deps is safe — the
    // function is stable by definition (defined once in the context initialiser).
  }, [verifyEmailToken]);

  // ── Route detection ───────────────────────────────────────────────────────
  const isAdminRoute   = currentPath === '/admin' || window.location.hash === '#admin';
  const isTrackerRoute = currentPath === '/tracker';
  const isInstallRoute = currentPath === '/install';
  const productMatch   = currentPath.match(/^\/product\/(.+)$/);
  const productId      = productMatch ? productMatch[1] : null;

  // HOOKS RULES FIX: This useEffect MUST come before any conditional early
  // returns. React 19 enforces Rules of Hooks strictly — a hook placed after
  // a conditional return triggers error #310 and crashes the entire app.
  // isInstallRoute / isAdminRoute / installState are computed above, so
  // moving it here is both safe and correct.
  useEffect(() => {
    if (isInstallRoute && installState === 'ready' && !isAdminRoute) {
      window.history.replaceState({}, '', '/');
    }
  }, [isInstallRoute, installState, isAdminRoute]);

  // ── INSTALL GATE RENDER ───────────────────────────────────────────────────
  if (installState === 'checking' && !isAdminRoute) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (installState === 'install' && !isAdminRoute) {
    return <InstallWizard />;
  }

  // Admin panel — short-circuit everything else
  if (isAdminRoute) return <AdminPanel />;

  // Loading spinner (only shown when there is no cached siteSettings at all)
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Order Tracker page
  if (isTrackerRoute) {
    if (siteSettings && siteSettings.orderTrackerEnabled === false) {
      window.location.href = '/';
      return null;
    }
    const params    = new URLSearchParams(window.location.search);
    const orderNum  = params.get('order') || '';
    return <OrderTrackerPage initialOrderNumber={orderNum} />;
  }

  // Product Detail page — /product/:id
  if (productId) {
    return (
      <>
        <Navbar
          onCartToggle={() => setIsCartOpen(!isCartOpen)}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          activeCategory={activeCategory}
          setActiveCategory={setActiveCategory}
        />
        <ProductDetailPage productId={productId} />
        <Footer />
        <CartModal
          isOpen={isCartOpen}
          onClose={() => setIsCartOpen(false)}
          emailVerified={
            !emailVerificationSettings?.requireVerificationBeforeOrder ||
            isEmailVerified(userProfile?.email || '')
          }
        />
      </>
    );
  }

  // ❌ REMOVED: Email verification banner - OTP verification during signup already handles email verification

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-between selection:bg-[#ff5c35] selection:text-white">

      {/* ❌ REMOVED: Email verification banner (redundant - OTP verification already handles this) */}

      <Navbar
        onCartToggle={() => setIsCartOpen(!isCartOpen)}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        activeCategory={activeCategory}
        setActiveCategory={setActiveCategory}
      />
      <Hero />
      <FavoritesMenu
        searchQuery={searchQuery}
        activeCategory={activeCategory}
        setActiveCategory={setActiveCategory}
      />
      <Testimonial />
      <Newsletter />
      <Footer />
      <CartModal
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        emailVerified={
          !emailVerificationSettings?.requireVerificationBeforeOrder ||
          isEmailVerified(userProfile?.email || '')
        }
      />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </ToastProvider>
  );
}
