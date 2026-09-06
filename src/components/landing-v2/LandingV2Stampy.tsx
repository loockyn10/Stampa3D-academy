import { BookOpen, Bot, CheckCircle2, MessageCircle, Sparkles } from "lucide-react";
import { LandingV2SectionHeading } from "./LandingV2SectionHeading";

export function LandingV2Stampy() {
  return (
    <section id="stampy" className="relative scroll-mt-16 overflow-hidden px-5 py-24 sm:px-8 sm:py-32 lg:px-10 lg:py-40">
      <div aria-hidden="true" className="absolute left-1/2 top-1/2 -z-10 h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400/[0.07] blur-[120px]" />
      <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[0.82fr_1.18fr] lg:gap-20">
        <div>
          <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.07] text-cyan-300">
            <Bot size={24} />
          </div>
          <LandingV2SectionHeading
            eyebrow="Stampy · IA integrada"
            title="Cuando te trabes, preguntale a Stampy."
            description="Consultá sobre impresión 3D o sobre la propia plataforma sin perder el contexto de lo que estabas haciendo."
          />
          <ul className="mt-8 space-y-3 text-sm text-zinc-400">
            {["Respuestas sobre problemas de impresión 3D", "Ayuda contextual dentro de Stampa", "Recomendaciones de clases cuando existe una coincidencia útil"].map((item) => (
              <li key={item} className="flex items-start gap-3">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-cyan-300" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Aislado para un futuro tratamiento Border Glow. */}
        <div className="rounded-[1.75rem] border border-cyan-400/20 bg-[#171a1d] p-4 shadow-[0_28px_80px_-35px_rgba(34,211,238,0.2)] sm:p-6">
          <div className="flex items-center gap-3 border-b border-white/[0.08] pb-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300">
              <Sparkles size={18} />
            </div>
            <div>
              <p className="text-sm font-bold text-white">Conversación con Stampy</p>
              <p className="mt-0.5 text-[10px] text-zinc-500">Ejemplo de orientación técnica</p>
            </div>
            <span className="ml-auto h-2 w-2 rounded-full bg-emerald-400" aria-label="Disponible" />
          </div>

          <div className="mt-6 space-y-4">
            <div className="ml-auto max-w-[86%] rounded-2xl rounded-br-md bg-stampa-orange px-4 py-3 text-sm leading-6 text-white">
              ¿Por qué mi primera capa queda demasiado alta?
            </div>
            <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-white/[0.08] bg-white/[0.045] px-4 py-4 text-sm leading-6 text-zinc-300">
              Revisá primero el nivelado de la cama y el Z-offset. Si las líneas quedan separadas y no se unen, acercá el nozzle en ajustes pequeños y repetí la prueba.
            </div>
            <div className="max-w-[92%] rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.04] p-4">
              <div className="flex items-center gap-2 text-xs font-bold text-cyan-300">
                <BookOpen size={14} />
                Clase relacionada
              </div>
              <p className="mt-2 text-sm text-zinc-300">Primera capa, nivelación y adherencia</p>
              <p className="mt-1 text-[10px] text-zinc-600">La recomendación aparece cuando Stampy encuentra contenido relevante.</p>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-4 py-3 text-xs text-zinc-600">
            <MessageCircle size={14} />
            Escribí tu pregunta sobre impresión 3D…
          </div>
        </div>
      </div>
    </section>
  );
}
