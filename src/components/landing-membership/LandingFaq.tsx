import { ChevronDown } from "lucide-react";
import { LandingSectionHeading } from "./LandingSectionHeading";
import { faqItems } from "./landing-content";

export function LandingFaq() {
  return (
    <section id="faq" className="scroll-mt-24 bg-stampa-bg py-24">
      <div className="container mx-auto px-5 md:px-6">
        <LandingSectionHeading
          eyebrow="Preguntas frecuentes"
          title="Lo importante, antes de empezar"
          description="Respuestas directas sobre la membresía, las herramientas y el acceso a la plataforma."
        />

        <div className="mx-auto mt-14 max-w-3xl divide-y divide-white/8 overflow-hidden rounded-3xl border border-stampa-border bg-zinc-900/45">
          {faqItems.map((item) => (
            <details key={item.question} className="group">
              <summary className="flex list-none items-center justify-between gap-5 px-5 py-5 text-left font-semibold text-white transition-colors hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-orange-400 md:px-7">
                <span>{item.question}</span>
                <ChevronDown className="h-5 w-5 shrink-0 text-orange-400 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-5 pb-6 pr-12 md:px-7 md:pr-16">
                <p className="leading-relaxed text-zinc-400">{item.answer}</p>
                {"pending" in item ? (
                  <p className="mt-3 text-xs font-medium text-amber-400/80">
                    Información pendiente: {item.pending}
                  </p>
                ) : null}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
