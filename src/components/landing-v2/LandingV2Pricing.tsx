import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { LandingV2SectionHeading } from "./LandingV2SectionHeading";

const MEMBERSHIP_BENEFITS = [
  "Cursos y talleres de impresión 3D",
  "Stampy, el asistente integrado de la academia",
  "Calculadora, presupuestos y herramientas de gestión",
  "Recursos, librería STL y sorteos para miembros",
  "Acceso a los canales de la comunidad",
];

export function LandingV2Pricing() {
  return (
    <section id="precios" className="scroll-mt-20 px-5 py-24 sm:px-8 sm:py-32 lg:px-10">
      <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1fr_0.82fr] lg:gap-20">
        <LandingV2SectionHeading
          eyebrow="Membresía"
          title="Una membresía para aprender y trabajar dentro del mismo ecosistema."
          description="Creá tu cuenta, conocé el valor mensual vigente y decidí antes de iniciar la suscripción."
        />

        {/* Punto de integración aislado para un futuro efecto Star Border. */}
        <div className="relative rounded-[2rem] border border-stampa-orange/30 bg-[linear-gradient(145deg,rgba(255,120,10,0.1),rgba(255,255,255,0.025)_42%)] p-1 shadow-[0_28px_80px_-45px_rgba(255,120,10,0.75)]">
          <div className="rounded-[1.7rem] bg-[#171719]/95 p-7 sm:p-9">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-stampa-orange">Membresía Stampa</p>
            <p className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-white">
              Precio vigente al activar
            </p>
            <p className="mt-3 text-sm leading-6 text-zinc-500">
              Vas a ver el importe mensual antes de iniciar el pago. Crear la cuenta no inicia una suscripción.
            </p>

            <ul className="mt-8 space-y-4">
              {MEMBERSHIP_BENEFITS.map((benefit) => (
                <li key={benefit} className="flex gap-3 text-sm leading-6 text-zinc-300">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stampa-orange/15 text-stampa-orange">
                    <Check size={13} strokeWidth={3} />
                  </span>
                  {benefit}
                </li>
              ))}
            </ul>

            <Link
              href="/registro"
              className="mt-9 flex w-full items-center justify-center gap-2 rounded-xl bg-stampa-orange px-5 py-3.5 text-sm font-bold text-white transition-colors hover:bg-stampa-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Crear mi cuenta
              <ArrowRight size={17} />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
