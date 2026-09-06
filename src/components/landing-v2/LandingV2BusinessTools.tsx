import { Boxes, Calculator, FileText, Package, TrendingUp } from "lucide-react";
import { LandingV2SectionHeading } from "./LandingV2SectionHeading";

const BUSINESS_AREAS = [
  { title: "Presupuestá con claridad", detail: "Modo rápido, profesional y exportación a PDF.", icon: FileText },
  { title: "Controlá materiales", detail: "Filamentos, gramos restantes y movimientos.", icon: Boxes },
  { title: "Ordená tus productos", detail: "Costos, recetas, precio de venta y stock terminado.", icon: Package },
];

export function LandingV2BusinessTools() {
  return (
    <section id="herramientas" className="scroll-mt-16 border-y border-white/[0.06] bg-[#151517] px-5 py-24 sm:px-8 sm:py-32 lg:px-10 lg:py-40">
      <div className="mx-auto max-w-7xl">
        <LandingV2SectionHeading
          eyebrow="Tu taller y tu negocio"
          title={<>Menos tiempo administrando. <span className="text-zinc-500">Más tiempo creando.</span></>}
          description="Usá información del trabajo real para calcular, presupuestar y organizar lo que producís."
        />

        <div className="mt-14 grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="overflow-hidden rounded-3xl border border-white/[0.09] bg-[#202023]">
            <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4 sm:px-7">
              <div className="flex items-center gap-2.5">
                <Calculator size={17} className="text-stampa-orange" />
                <p className="text-sm font-bold text-white">Calculadora de costos</p>
              </div>
              <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-emerald-300">Cálculo listo</span>
            </div>
            <div className="grid gap-6 p-5 sm:p-7 md:grid-cols-[1fr_0.8fr]">
              <div className="space-y-3">
                {[
                  ["Material", "PLA · 167 g"],
                  ["Tiempo de impresión", "5 h"],
                  ["Electricidad y mantenimiento", "Incluidos"],
                  ["Insumos extra", "Revisados"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-4 border-b border-white/[0.07] py-3 text-xs">
                    <span className="text-zinc-500">{label}</span>
                    <span className="font-semibold text-zinc-200">{value}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-col justify-between rounded-2xl bg-stampa-orange p-5 text-white">
                <TrendingUp size={20} />
                <div className="mt-12">
                  <p className="text-xs text-orange-100">Resultado</p>
                  <p className="mt-2 text-2xl font-bold">Precio sugerido</p>
                  <p className="mt-3 text-xs leading-5 text-orange-100">Revisá el detalle antes de usarlo en un presupuesto.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="divide-y divide-white/[0.08] rounded-3xl border border-white/[0.09] bg-[#1b1b1e] px-5 sm:px-7">
            {BUSINESS_AREAS.map(({ title, detail, icon: Icon }) => (
              <div key={title} className="flex gap-4 py-6">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-stampa-orange">
                  <Icon size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{title}</h3>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">{detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
