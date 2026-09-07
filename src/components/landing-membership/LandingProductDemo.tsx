import { LandingInteractiveMockup } from "@/components/landing/LandingInteractiveMockup";

const benefits = {
  1: "Sabé exactamente qué aprender después.",
  2: "Conocé el costo y margen de cada trabajo.",
  3: "Evitá comenzar trabajos sin material suficiente.",
  4: "Enviá propuestas profesionales en minutos.",
} as const;

export function LandingProductDemo() {
  return (
    <LandingInteractiveMockup
      title="Así funciona tu taller dentro de Stampa"
      description="Explorá cómo formación, costos, materiales y presupuestos trabajan conectados dentro de la misma plataforma."
      stepBenefits={benefits}
    />
  );
}
