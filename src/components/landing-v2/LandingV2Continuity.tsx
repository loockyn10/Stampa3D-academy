import { BookOpen, Gift, RefreshCw, Users, Wrench } from "lucide-react";
import { LandingV2SectionHeading } from "./LandingV2SectionHeading";

const CONTINUITY_ITEMS = [
  { title: "Nuevos contenidos", description: "Cursos y talleres que amplían lo que podés aprender.", icon: BookOpen },
  { title: "Herramientas de uso diario", description: "Volvé para calcular, presupuestar y ordenar tu taller.", icon: Wrench },
  { title: "Comunidad", description: "Canales para compartir avances, consultas y novedades.", icon: Users },
  { title: "Recursos", description: "Librería STL y materiales disponibles dentro de la plataforma.", icon: RefreshCw },
  { title: "Sorteos", description: "Beneficios y sorteos para miembros desde una sección dedicada.", icon: Gift },
];

export function LandingV2Continuity() {
  return (
    <section className="border-y border-white/[0.06] bg-[#151517] px-5 py-24 sm:px-8 sm:py-32 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <LandingV2SectionHeading
          eyebrow="Una plataforma a la que volver"
          title="El valor no termina cuando termina un curso."
          description="Stampa también vive en las herramientas, los recursos y la comunidad que acompañan tu trabajo cotidiano."
          align="center"
        />

        <div className="mt-14 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-5">
          {CONTINUITY_ITEMS.map(({ title, description, icon: Icon }, index) => (
            <div key={title} className={`border-t border-white/[0.1] pt-5 ${index === CONTINUITY_ITEMS.length - 1 ? "sm:col-span-2 lg:col-span-1" : ""}`}>
              <Icon size={17} className="text-stampa-orange" />
              <h3 className="mt-5 text-sm font-bold text-zinc-200">{title}</h3>
              <p className="mt-3 text-xs leading-5 text-zinc-600">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
