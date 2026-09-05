import type { Metadata } from "next";
import { LandingV2 } from "@/components/landing-v2/LandingV2";

export const metadata: Metadata = {
  title: "Academia Stampa",
  description: "Plataforma de impresión 3D de Stampa",
};

export default function LandingPage() {
  return <LandingV2 />;
}
