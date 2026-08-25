"use client";

import React, { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { usePathname } from "next/navigation";
import { GlobalToolTutorial } from "@/components/tutorials/GlobalToolTutorial";
import { StampyContextProvider } from "@/components/stampy/StampyContextProvider";
import { GlobalStampyWidget } from "@/components/stampy/GlobalStampyWidget";
import { createClient } from "@/utils/supabase/client";
import {
  getCurrentUserAccess,
  type UserAccessSnapshot,
} from "@/lib/auth/user-access";

export function MainLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
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
      <div className="flex min-h-screen w-full min-w-0 bg-stampa-bg text-[#ededed] font-sans">
        <Sidebar
          mobileOpen={mobileOpen}
          setMobileOpen={setMobileOpen}
          access={userAccess}
          loading={accessLoading}
        />
        <div className="flex min-h-screen min-w-0 flex-1 flex-col lg:pl-0">
          <Header
            setMobileOpen={setMobileOpen}
            access={userAccess}
            loading={accessLoading}
          />
          <main className="flex-1 min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 animate-page-in relative">
            {children}
          </main>
        </div>
        <GlobalToolTutorial />
        <GlobalStampyWidget />
      </div>
    </StampyContextProvider>
  );
}
