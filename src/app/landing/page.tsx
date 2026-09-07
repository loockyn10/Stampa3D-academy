import type { Metadata } from "next";
import LandingOldPage from "../landing-old/page";

export const metadata: Metadata = {
  title: "Stampa3D Academy | Academia de impresión 3D",
  description: "Aprendé impresión 3D, calculá precios, organizá tu stock y convertí tu impresora en un negocio real.",
};

export default function LandingPage() {
  return <LandingOldPage />;
}
