import { MessageSquareQuote, ShieldCheck, Users } from "lucide-react";
import { LandingV2SectionHeading } from "./LandingV2SectionHeading";

const PROOF_PRINCIPLES = [
  {
    title: "Experiencias verificables",
    description: "Las historias públicas se sumarán cuando puedan representar casos reales de la comunidad.",
    icon: MessageSquareQuote,
  },
  {
    title: "Sin cifras infladas",
    description: "Preferimos mostrar el producto y sus herramientas antes que apoyarnos en métricas sin contexto.",
    icon: ShieldCheck,
  },
  {
    title: "Construido con la comunidad",
    description: "El recorrido evoluciona alrededor de necesidades concretas de quienes aprenden y producen.",
    icon: Users,
  },
];

export function LandingV2SocialProof() {
  return (
    <section className="px-5 py-24 sm:px-8 sm:py-32 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <LandingV2SectionHeading
          eyebrow="Confianza sin atajos"
          title="La experiencia real tiene más valor que una promesa de marketing."
          description="Esta sección queda preparada para incorporar testimonios verificables sin inventar nombres, cifras ni resultados que todavía no estén documentados."
          align="center"
        />

        <div className="mt-14 grid overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.025] md:grid-cols-3">
          {PROOF_PRINCIPLES.map(({ title, description, icon: Icon }, index) => (
            <article
              key={title}
              className={`p-7 sm:p-8 ${index > 0 ? "border-t border-white/[0.08] md:border-l md:border-t-0" : ""}`}
            >
              <Icon size={20} className="text-stampa-orange" />
              <h3 className="mt-6 text-base font-semibold text-white">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-zinc-500">{description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
