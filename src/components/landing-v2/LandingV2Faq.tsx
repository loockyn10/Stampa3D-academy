import { Plus } from "lucide-react";
import { LandingV2SectionHeading } from "./LandingV2SectionHeading";

const FAQ_ITEMS = [
  {
    question: "¿Sirve si recién empiezo?",
    answer:
      "Sí. La academia incluye recorridos pensados para empezar desde cero y avanzar hacia temas más específicos a medida que ganás práctica.",
  },
  {
    question: "¿Y si ya tengo experiencia imprimiendo?",
    answer:
      "También. Podés ir directo a contenidos y herramientas sobre slicers, diseño, costos, presupuestos y organización del taller.",
  },
  {
    question: "¿Necesito una impresora específica?",
    answer:
      "No. Hay contenidos generales de impresión 3D y otros enfocados en equipos o flujos concretos, para que elijas lo que corresponda a tu caso.",
  },
  {
    question: "¿Qué incluye Stampa?",
    answer:
      "Cursos, talleres, Stampy, calculadora de costos, presupuestos, productos, stock, recursos STL, comunidad y beneficios para miembros, reunidos en la misma plataforma.",
  },
  {
    question: "¿Cómo funciona Stampy?",
    answer:
      "Es el asistente integrado de la academia. Puede ayudarte con dudas de impresión 3D y con el uso de la plataforma, y recomendarte una clase relacionada cuando encuentra una coincidencia útil.",
  },
  {
    question: "¿Puedo usar Stampa desde el celular?",
    answer:
      "Sí. La plataforma es responsive y puede instalarse como aplicación web. En esta etapa necesita conexión a internet para funcionar.",
  },
  {
    question: "¿Cómo funciona la membresía?",
    answer:
      "Después de crear tu cuenta vas a ver el precio mensual vigente antes de iniciar la suscripción y acceder a la plataforma.",
  },
];

export function LandingV2Faq() {
  return (
    <section id="faq" className="border-y border-white/[0.06] bg-[#151517] px-5 py-24 sm:px-8 sm:py-32 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.72fr_1fr] lg:gap-20">
        <LandingV2SectionHeading
          eyebrow="Preguntas frecuentes"
          title="Antes de empezar, lo esencial."
          description="Una respuesta directa a las dudas más comunes sobre la plataforma."
        />

        <div className="divide-y divide-white/[0.08] border-y border-white/[0.08]">
          {FAQ_ITEMS.map(({ question, answer }) => (
            <details key={question} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-5 py-6 text-left text-sm font-semibold text-zinc-200 marker:hidden sm:text-base">
                {question}
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 text-zinc-500 transition group-open:rotate-45 group-open:border-stampa-orange/30 group-open:text-stampa-orange">
                  <Plus size={16} />
                </span>
              </summary>
              <p className="max-w-2xl pb-6 pr-10 text-sm leading-7 text-zinc-500">{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
