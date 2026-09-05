import type { Metadata } from "next";
import { LandingV2 } from "@/components/landing-v2/LandingV2";

export const metadata: Metadata = {
  title: "Academia Stampa | Aprendé, gestioná y hacé crecer tu mundo 3D",
  description:
    "Cursos, herramientas para tu taller y negocio, comunidad y una IA integrada para makers y emprendedores de impresión 3D.",
};

export default function LandingPage() {
  return <LandingV2 />;
}
