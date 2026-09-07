import Link from "next/link";
import { Check, ChevronRight, CreditCard, RefreshCcw } from "lucide-react";
import { LandingSectionHeading } from "./LandingSectionHeading";
import { landingPrimaryCta, membershipOffer } from "./landing-content";

export function LandingPricing() {
  return (
    <section id="precio" className="relative scroll-mt-24 overflow-hidden border-y border-stampa-border bg-zinc-950/60 py-24">
      <div className="absolute bottom-0 left-1/2 h-[500px] w-full max-w-4xl -translate-x-1/2 rounded-full bg-stampa-orange/10 blur-[140px]" aria-hidden="true" />
      <div className="container relative z-10 mx-auto px-5 md:px-6">
        <LandingSectionHeading
          eyebrow="La membresía"
          title="Todo el sistema, en un único acceso"
          description="Formación, herramientas y acompañamiento conectados para que puedas aprender y gestionar sin saltar entre soluciones separadas."
        />

        <article className="mx-auto mt-14 grid max-w-5xl overflow-hidden rounded-3xl border border-stampa-orange/35 bg-stampa-bg/90 shadow-[0_0_60px_rgba(234,88,12,0.12)] lg:grid-cols-[0.9fr_1.1fr]">
          <div className="border-b border-stampa-border p-7 md:p-10 lg:border-b-0 lg:border-r">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-orange-400">
              {membershipOffer.name}
            </p>
            <div className="mt-7">
              {membershipOffer.price ? (
                <p className="text-5xl font-black text-white">{membershipOffer.price}</p>
              ) : (
                <p className="max-w-sm text-3xl font-black leading-tight text-white md:text-4xl">
                  {membershipOffer.priceFallback}
                </p>
              )}
              <p className="mt-3 flex items-center gap-2 text-sm text-zinc-400">
                <RefreshCcw className="h-4 w-4 text-orange-400" />
                {membershipOffer.frequency}
              </p>
            </div>

            <Link
              href={landingPrimaryCta.href}
              className="group mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-600 to-orange-500 px-7 py-4 font-bold text-white transition-all hover:from-orange-500 hover:to-orange-400 hover:shadow-[0_0_30px_rgba(234,88,12,0.45)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-300"
            >
              {landingPrimaryCta.label}
              <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
            </Link>

            <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-zinc-500">
              <CreditCard className="mt-0.5 h-4 w-4 shrink-0" />
              El valor y los medios disponibles se muestran antes de confirmar
              la contratación en Mercado Pago.
            </p>
          </div>

          <div className="p-7 md:p-10">
            <h3 className="text-xl font-bold text-white">Tu acceso incluye</h3>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2">
              {membershipOffer.included.map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm leading-relaxed text-zinc-300">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10">
                    <Check className="h-3 w-3 text-emerald-400" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-8 border-t border-stampa-border pt-6 text-sm leading-relaxed text-zinc-400">
              {membershipOffer.cancellation}
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}
