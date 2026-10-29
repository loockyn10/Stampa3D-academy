"use client";

import React, { Suspense, useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { MobileHeader } from "@/components/layout/mobile-header";
import { MobileBottomNavigation } from "@/components/layout/mobile-bottom-navigation";
import { usePathname } from "next/navigation";
import { GlobalToolTutorial } from "@/components/tutorials/GlobalToolTutorial";
import { StampyContextProvider } from "@/components/stampy/StampyContextProvider";
import { GlobalStampyLauncher } from "@/components/stampy/GlobalStampyLauncher";
import { createClient } from "@/utils/supabase/client";
import {
  getCurrentUserAccess,
  type UserAccessSnapshot,
} from "@/lib/auth/user-access";
import { BarcodeScannerProvider } from "@/components/barcode/BarcodeScannerProvider";
import { XpFeedbackListener } from "@/components/xp/XpFeedbackListener";
import {
  FeatureVisibilityProvider,
  useFeatureFlagSnapshot,
} from "@/components/features/feature-flags-provider";
import { buildFeatureVisibility } from "@/lib/features/visibility";

export function MainLayout({ children }: { children: React.ReactNode }) {
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [supabase] = useState(() => createClient());
  const [userAccess, setUserAccess] = useState<UserAccessSnapshot | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const pathname = usePathname();
  const featureSnapshot = useFeatureFlagSnapshot(supabase, pathname);
  const isCalculatorRoute = pathname === "/calculadora";
  const isExploreModelsRoute = pathname === "/explorar-modelos";
  const isUnavailableRoute = pathname === "/no-disponible";
  const isPublicRoute = 
    pathname?.startsWith('/landing') ||
    pathname === '/tienda' ||
    pathname?.startsWith('/tienda/') ||
    pathname?.startsWith('/login') || 
    pathname?.startsWith('/registro') || 
    pathname?.startsWith('/recuperar-password') || 
    pathname?.startsWith('/actualizar-password') || 
    pathname?.startsWith('/verificar-email') || 
    pathname?.startsWith('/auth') || 
    pathname?.startsWith('/sin-acceso') || 
    pathname?.startsWith('/pago/estado') ||
    pathname?.startsWith('/salir') ||
    pathname?.startsWith('/mi-negocio/ticket');

  useEffect(() => {
    let active = true;

    getCurrentUserAccess(supabase).then(({ access }) => {
      if (!active) return;
      setUserAccess(access);
      setAccessLoading(false);
    });

    return () => {
      active = false;
    };
    // Re-resolve on navigation: the layout persists across client routing, so a grant redeemed
    // on /sin-acceso must not leave a stale "no access" snapshot behind.
  }, [supabase, pathname]);

  const isAdmin = userAccess?.capabilities.accessAdmin === true;
  // Las rutas públicas sin shell también conocen el estado de las funcionalidades (p. ej. el enlace a la Calculadora
  // de Explorar Modelos).
  const withFeatures = (node: React.ReactNode) => (
    <FeatureVisibilityProvider snapshot={featureSnapshot} isAdmin={isAdmin} accessReady={!accessLoading}>
      {node}
    </FeatureVisibilityProvider>
  );

  if (isPublicRoute) {
    return <main className="min-h-screen">{children}</main>;
  }

  if (isCalculatorRoute && !accessLoading && !userAccess?.authenticated) {
    return withFeatures(<StampyContextProvider><main className="min-h-screen">{children}</main></StampyContextProvider>);
  }

  // Explorar Modelos es público: anonymous ve la página sin shell; usuarios autenticados la ven dentro del shell.
  if (isExploreModelsRoute && (accessLoading || !userAccess?.authenticated)) {
    return withFeatures(<main className="min-h-screen bg-stampa-bg">{children}</main>);
  }

  // Herramienta no disponible: sin shell para visitantes, dentro del shell para usuarios con sesión.
  if (isUnavailableRoute && (accessLoading || !userAccess?.authenticated)) {
    return <main className="min-h-screen bg-stampa-bg">{children}</main>;
  }

  if (isCalculatorRoute && accessLoading) {
    return withFeatures(<StampyContextProvider><main className="min-h-screen bg-stampa-bg">{children}</main></StampyContextProvider>);
  }

  const hasPlatformAccess = userAccess?.capabilities.accessPlatform === true;
  const featureVisibility = buildFeatureVisibility(featureSnapshot, { isAdmin, accessReady: !accessLoading });

  return (
    <FeatureVisibilityProvider snapshot={featureSnapshot} isAdmin={isAdmin} accessReady={!accessLoading}>
    <BarcodeScannerProvider
      enabled={hasPlatformAccess && !accessLoading && featureVisibility.isFeatureVisible("mi_negocio")}
    >
      <StampyContextProvider>
      {hasPlatformAccess && <XpFeedbackListener />}
      <div className="flex min-h-screen w-full min-w-0 overflow-x-clip bg-stampa-bg text-stampa-body font-sans">
        <Suspense fallback={<aside className="hidden w-64 shrink-0 border-r border-stampa-border bg-stampa-bg lg:block" />}>
          <Sidebar access={userAccess} loading={accessLoading} />
        </Suspense>
        <div className="flex min-h-screen min-w-0 flex-1 flex-col lg:pl-0">
          <MobileHeader access={userAccess} loading={accessLoading} />
          <Header access={userAccess} loading={accessLoading} />
          <main className="mobile-shell-content relative min-w-0 flex-1 animate-page-in px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
        {hasPlatformAccess && <GlobalToolTutorial
          userId={userAccess?.userId ?? null}
          mobileMenuOpen={mobileToolsOpen}
        />}
        {hasPlatformAccess && featureVisibility.isFeatureVisible("stampy") && <GlobalStampyLauncher mobileMenuOpen={mobileToolsOpen} />}
        <MobileBottomNavigation
          access={userAccess}
          loading={accessLoading}
          toolsOpen={mobileToolsOpen}
          onToolsOpenChange={setMobileToolsOpen}
        />
      </div>
      </StampyContextProvider>
    </BarcodeScannerProvider>
    </FeatureVisibilityProvider>
  );
}
