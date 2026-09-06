import {
  MessageCircle,
  PlayCircle,
  Search,
  StickyNote,
  Table2,
  Unplug,
} from "lucide-react";
import { LandingV2SectionHeading } from "./LandingV2SectionHeading";

const FRAGMENTED_PLACES = [
  { label: "Videos sueltos", icon: PlayCircle, position: "lg:translate-y-8" },
  { label: "Planillas de stock", icon: Table2, position: "lg:-translate-y-5" },
  { label: "Chats y presupuestos", icon: MessageCircle, position: "lg:translate-y-14" },
  { label: "Notas de materiales", icon: StickyNote, position: "lg:-translate-y-10" },
  { label: "Búsquedas eternas", icon: Search, position: "lg:translate-y-4" },
];

export function LandingV2Problem() {
  return (
    <section className="relative overflow-hidden px-5 py-24 sm:px-8 sm:py-32 lg:px-10 lg:py-40">
      <div className="mx-auto max-w-7xl">
        <LandingV2SectionHeading
          eyebrow="El problema no es la falta de información"
          title={<>Tu impresión 3D está repartida entre <span className="text-zinc-500">demasiados lugares.</span></>}
          description="Aprender por un lado y administrar por otro te obliga a reconstruir el contexto cada vez que querés avanzar."
        />

        <div className="relative mt-14 grid gap-3 sm:grid-cols-2 lg:mt-20 lg:grid-cols-5 lg:gap-4">
          <div aria-hidden="true" className="absolute left-[10%] right-[10%] top-1/2 hidden border-t border-dashed border-white/10 lg:block" />
          {FRAGMENTED_PLACES.map(({ label, icon: Icon, position }) => (
            <div
              key={label}
              className={`relative flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-[#1d1d20] px-4 py-4 text-sm text-zinc-300 shadow-lg shadow-black/10 ${position}`}
            >
              <Icon size={17} className="shrink-0 text-zinc-500" />
              <span>{label}</span>
            </div>
          ))}
        </div>

        <div className="mt-16 flex items-center gap-4 border-t border-white/[0.08] pt-7 lg:mt-24">
          <Unplug size={18} className="shrink-0 text-stampa-orange" />
          <p className="max-w-3xl text-sm leading-6 text-zinc-500 sm:text-base">
            El costo invisible no es solamente usar muchas herramientas: es perder tiempo conectándolas mentalmente.
          </p>
        </div>
      </div>
    </section>
  );
}
