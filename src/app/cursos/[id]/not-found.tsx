import Link from "next/link";
import { GraduationCap } from "lucide-react";

/** Curso inexistente u oculto: ambos casos se ven igual para quien no es administrador. */
export default function CursoNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-fg/5">
        <GraduationCap size={40} className="text-gray-500" aria-hidden="true" />
      </div>
      <h2 className="mb-3 text-2xl font-bold text-fg">Curso no encontrado</h2>
      <p className="text-gray-400">El curso que estás buscando no existe o no está disponible.</p>
      <Link
        href="/academia"
        className="mt-6 rounded-xl bg-stampa-orange px-6 py-3 font-bold text-white shadow-lg shadow-[#ff6a00]/20 transition-colors hover:bg-[#e65c00]"
      >
        Volver a Academia
      </Link>
    </div>
  );
}
