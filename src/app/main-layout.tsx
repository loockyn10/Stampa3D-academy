"use client";

import React, { useEffect, useState } from "react";
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

export function MainLayout({ children }: { children: React.ReactNode }) {
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [supabase] = useState(() => createClient());
  const [userAccess, setUserAccess] = useState<UserAccessSnapshot | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const pathname = usePathname();
  const isPublicRoute = 
    pathname?.startsWith('/landing') ||
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

  return (
    <StampyContextProvider>
      <div className="flex min-h-screen w-full min-w-0 overflow-x-clip bg-stampa-bg text-[#ededed] font-sans">
        <Sidebar access={userAccess} loading={accessLoading} />
        <div className="flex min-h-screen min-w-0 flex-1 flex-col lg:pl-0">
          <MobileHeader access={userAccess} loading={accessLoading} />
          <Header access={userAccess} loading={accessLoading} />
          <main className="mobile-shell-content relative min-w-0 flex-1 animate-page-in px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
        <GlobalToolTutorial
          userId={userAccess?.userId ?? null}
          mobileMenuOpen={mobileToolsOpen}
        />
        <GlobalStampyLauncher mobileMenuOpen={mobileToolsOpen} />
        <MobileBottomNavigation
          toolsOpen={mobileToolsOpen}
          onToolsOpenChange={setMobileToolsOpen}
        />
      </div>
    </StampyContextProvider>
  );
}
