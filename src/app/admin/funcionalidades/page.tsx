import Link from "next/link";
import { ToggleRight } from "lucide-react";
import { FeatureFlagsManager } from "@/components/admin/feature-flags-manager";
import { loadFeatureFlagsAdminAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminFuncionalidadesPage() {
  // /admin/* ya exige rol admin en el proxy; la acción vuelve a verificarlo en el servidor.
  const initial = await loadFeatureFlagsAdminAction();

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Link href="/admin" className="text-sm font-medium text-stampa-accent hover:text-orange-300">
            Admin
          </Link>
          <span className="text-gray-400">/</span>
          <span className="text-sm text-gray-500">Gestión de funcionalidades</span>
        </div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-fg">
          <ToggleRight className="text-stampa-accent" />
          Gestión de funcionalidades
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Elegí qué herramientas de Universo Stampa están disponibles para los usuarios. Lanzá de a una, probá con una cuenta común y habilitá la siguiente.
        </p>
      </div>

      <FeatureFlagsManager initial={initial} />
    </div>
  );
}
