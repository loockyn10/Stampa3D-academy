import Image from "next/image";
import { MessageSquareQuote, UserRound } from "lucide-react";
import { LandingSectionHeading } from "./LandingSectionHeading";
import { testimonials } from "./landing-content";

export function LandingTestimonials() {
  return (
    <section id="testimonios" className="scroll-mt-24 bg-stampa-bg py-24">
      <div className="container mx-auto px-5 md:px-6">
        <LandingSectionHeading
          eyebrow="Experiencias reales"
          title="Lo que construyen quienes usan Stampa"
          description="Este espacio se completará únicamente con experiencias autorizadas y resultados que puedan verificarse."
        />

        {testimonials.length > 0 ? (
          <div className="mt-14 grid gap-6 lg:grid-cols-3">
            {testimonials.map((testimonial) => (
              <figure key={`${testimonial.name}-${testimonial.workshop}`} className="rounded-3xl border border-stampa-border bg-zinc-900/55 p-7">
                <MessageSquareQuote className="h-7 w-7 text-orange-400" />
                <blockquote className="mt-6 leading-relaxed text-zinc-200">
                  “{testimonial.quote}”
                </blockquote>
                {testimonial.verifiedResult ? (
                  <p className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                    {testimonial.verifiedResult}
                  </p>
                ) : null}
                <figcaption className="mt-7 flex items-center gap-3 border-t border-white/8 pt-5">
                  <Image
                    src={testimonial.photoUrl}
                    alt={`Foto de ${testimonial.name}`}
                    width={44}
                    height={44}
                    className="h-11 w-11 rounded-full object-cover"
                  />
                  <span>
                    <strong className="block text-sm text-white">{testimonial.name}</strong>
                    <span className="text-xs text-zinc-500">{testimonial.workshop}</span>
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="mx-auto mt-14 grid max-w-5xl gap-5 md:grid-cols-3">
            {[1, 2, 3].map((slot) => (
              <div key={slot} className="rounded-3xl border border-dashed border-stampa-border bg-zinc-900/25 p-7 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-stampa-orange/20 bg-stampa-orange/10">
                  <UserRound className="h-5 w-5 text-orange-400" />
                </span>
                <p className="mt-5 text-sm font-semibold text-zinc-300">Testimonio pendiente</p>
                <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                  Espacio reservado para una experiencia real y autorizada.
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
