"use client";

import React, { useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { usePathname } from "next/navigation";

export function MainLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const isAuthRoute = 
    pathname?.startsWith('/login') || 
    pathname?.startsWith('/registro') || 
    pathname?.startsWith('/recuperar-password') || 
    pathname?.startsWith('/actualizar-password') || 
    pathname?.startsWith('/verificar-email') || 
    pathname?.startsWith('/auth') || 
    pathname?.startsWith('/sin-acceso') || 
    pathname?.startsWith('/pago/estado') || 
    pathname?.startsWith('/salir');

  if (isAuthRoute) {
    return <main className="min-h-screen bg-[#F7F7F9]">{children}</main>;
  }

  return (
    <div className="flex min-h-screen bg-[#F7F7F9] font-sans">
      <Sidebar mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
      <div className="flex min-h-screen flex-1 flex-col lg:pl-0">
        <Header setMobileOpen={setMobileOpen} />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
