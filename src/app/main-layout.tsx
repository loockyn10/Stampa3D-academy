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

export function MainLayout({ children }: { children: React.ReactNode }) {
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [supabase] = useState(() => createClient());
  const [userAccess, setUserAccess] = useState<UserAccessSnapshot | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const pathname = usePathname();
  const isCalculatorRoute = pathname === "/calculadora";
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
    pathname?.startsWith('/salir');

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
  }, [supabase]);

  if (isPublicRoute) {
    return <main className="min-h-screen">{children}</main>;
  }

  if (isCalculatorRoute && !accessLoading && !userAccess?.authenticated) {
    return <StampyContextProvider><main className="min-h-screen">{children}</main></StampyContextProvider>;
  }

  if (isCalculatorRoute && accessLoading) {
    return <StampyContextProvider><main className="min-h-screen bg-stampa-bg">{children}</main></StampyContextProvider>;
  }

  const hasPlatformAccess = userAccess?.capabilities.accessPlatform === true;

  return (
    <BarcodeScannerProvider
      enabled={!accessLoading && userAccess?.capabilities.accessPlatform === true}
    >
      <StampyContextProvider>
      {hasPlatformAccess && <XpFeedbackListener />}
      <div className="flex min-h-screen w-full min-w-0 overflow-x-clip bg-stampa-bg text-[#ededed] font-sans">
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
        {hasPlatformAccess && <GlobalStampyLauncher mobileMenuOpen={mobileToolsOpen} />}
        <MobileBottomNavigation
          access={userAccess}
          loading={accessLoading}
          toolsOpen={mobileToolsOpen}
          onToolsOpenChange={setMobileToolsOpen}
        />
      </div>
      </StampyContextProvider>
    </BarcodeScannerProvider>
  );
}
