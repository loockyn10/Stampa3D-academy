import type { Metadata } from "next";
import { LandingMembershipPage } from "@/components/landing-membership/LandingMembershipPage";

export const metadata: Metadata = {
  title: "Academia Stampa | Formación y gestión para impresión 3D",
  description:
    "Aprendé impresión 3D, calculá costos, organizá tu taller y generá presupuestos profesionales desde una sola plataforma.",
};

export default function LandingPage() {
  return <LandingMembershipPage />;
}
