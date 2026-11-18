import type { Metadata } from "next";
import { Suspense } from "react";
import { ConfirmRecovery } from "./confirm-recovery";

// The link carries a one-time token: never send it to another site as a Referer.
export const metadata: Metadata = {
  title: "Cambiar contraseña · Universo Stampa",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function AuthConfirmPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-stampa-bg" />}>
      <ConfirmRecovery />
    </Suspense>
  );
}
