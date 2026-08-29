"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { Bot } from "lucide-react";
import { useState } from "react";

const GlobalStampyWidget = dynamic(
  () => import("./GlobalStampyWidget").then((module) => module.GlobalStampyWidget),
  { ssr: false },
);

const HIDDEN_ON = [
  "/login",
  "/registro",
  "/landing",
  "/verificar-email",
  "/recuperar-password",
  "/actualizar-password",
  "/auth",
  "/sin-acceso",
  "/pago/estado",
  "/salir",
];

export function GlobalStampyLauncher() {
  const pathname = usePathname();
  const [activated, setActivated] = useState(false);

  if (activated) {
    return <GlobalStampyWidget initiallyOpen />;
  }

  if (HIDDEN_ON.some((route) => pathname.startsWith(route))) return null;
  if (/^\/cursos\/[^/]+/.test(pathname)) return null;

  return (
    <button
      type="button"
      onClick={() => setActivated(true)}
      title="Preguntarle a Stampy"
      aria-label="Abrir Stampy"
      className="fixed bottom-6 right-6 z-[100] flex h-14 w-14 items-center justify-center rounded-full border border-cyan-300/40 bg-gradient-to-r from-cyan-400 to-violet-500 text-white shadow-2xl shadow-cyan-500/25 transition hover:brightness-110 hover:scale-105 active:scale-95"
    >
      <Bot size={28} className="animate-soft-pulse" />
    </button>
  );
}
