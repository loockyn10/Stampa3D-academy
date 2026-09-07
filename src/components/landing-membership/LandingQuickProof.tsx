import { quickProofItems } from "./landing-content";

export function LandingQuickProof() {
  return (
    <section
      aria-labelledby="quick-proof-title"
      className="relative overflow-hidden border-b border-stampa-border bg-stampa-bg py-14 md:py-20"
    >
      <div className="absolute left-1/2 top-1/2 h-full w-4/5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-stampa-orange/5 blur-[100px]" aria-hidden="true" />
      <div className="container relative z-10 mx-auto px-5 md:px-6">
        <div className="mb-8 flex flex-col items-center justify-between gap-3 text-center md:flex-row md:text-left">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-orange-400">
              Todo conectado
            </p>
            <h2 id="quick-proof-title" className="mt-2 text-xl font-bold text-white md:text-2xl">
              Una membresía para aprender y gestionar
            </h2>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-zinc-400">
            Sin cifras infladas ni herramientas aisladas: el valor está en usar
            el mismo sistema desde el aprendizaje hasta la venta.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {quickProofItems.map((item) => (
            <article
              key={item.value}
              className="stampa-card-interactive rounded-2xl border border-stampa-border bg-zinc-900/55 p-6"
            >
              <h3 className="text-xl font-black text-orange-400">{item.value}</h3>
              <p className="mt-1 font-medium text-white">{item.label}</p>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                {item.description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
