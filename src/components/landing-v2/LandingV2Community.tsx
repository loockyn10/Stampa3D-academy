import { Camera, CirclePlay, MessageCircle, Send, Users } from "lucide-react";
import { LandingV2SectionHeading } from "./LandingV2SectionHeading";

const ACTIVE_CHANNELS = [
  { label: "WhatsApp", icon: MessageCircle, tone: "text-emerald-300 bg-emerald-400/10" },
  { label: "Telegram", icon: Send, tone: "text-sky-300 bg-sky-400/10" },
  { label: "YouTube", icon: CirclePlay, tone: "text-red-300 bg-red-400/10" },
  { label: "Instagram", icon: Camera, tone: "text-fuchsia-300 bg-fuchsia-400/10" },
];

export function LandingV2Community() {
  return (
    <section id="comunidad" className="scroll-mt-16 overflow-hidden border-y border-white/[0.06] bg-[#1d1d20] px-5 py-24 sm:px-8 sm:py-32 lg:px-10 lg:py-40">
      <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        <LandingV2SectionHeading
          eyebrow="Comunidad"
          title="No tenés que resolver todo solo."
          description="Compartí dudas, avances y proyectos en los canales de la comunidad, y seguí el contenido de Stampa desde el mismo ecosistema."
        />

        <div className="relative min-h-[420px]">
          <div className="absolute inset-0 rounded-[2rem] border border-white/[0.08] bg-[#171719]" />
          <div className="relative p-5 sm:p-8">
            <div className="flex items-center gap-3 border-b border-white/[0.08] pb-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-400/10 text-violet-300">
                <Users size={19} />
              </div>
              <div>
                <p className="text-sm font-bold text-white">Canales de la comunidad</p>
                <p className="mt-0.5 text-[10px] text-zinc-500">Consultas, novedades y proyectos</p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              {ACTIVE_CHANNELS.map(({ label, icon: Icon, tone }) => (
                <div key={label} className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}>
                    <Icon size={16} />
                  </div>
                  <p className="mt-4 text-sm font-bold text-zinc-200">{label}</p>
                  <p className="mt-1 text-[10px] text-zinc-600">Canal disponible</p>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-dashed border-white/[0.12] bg-black/10 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-bold text-zinc-300">Conversaciones alrededor de las clases</p>
                <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500">En evolución</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-zinc-600">Una capa de comunidad contextual para preguntas y aprendizajes compartidos.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
