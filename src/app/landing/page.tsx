import type { Metadata } from "next";
import { LandingMembershipPage } from "@/components/landing-membership/LandingMembershipPage";

export const metadata: Metadata = {
  title: "Academia Stampa | Formación y gestión para impresión 3D",
  description:
    "Aprendé impresión 3D, calculá costos, organizá tu taller y generá presupuestos profesionales desde una sola plataforma.",
};

// Los enlaces de comunidad del footer se administran en /admin/redes-canales; la página se regenera cada minuto.
export const revalidate = 60;

export default function LandingPage() {
  return <LandingMembershipPage />;
}
