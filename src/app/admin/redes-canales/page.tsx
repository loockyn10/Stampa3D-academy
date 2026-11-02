import Link from "next/link";
import { Share2 } from "lucide-react";
import { CommunityLinksManager } from "@/components/admin/community-links-manager";
import { loadCommunityLinksAdminAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminRedesCanalesPage() {
  // /admin/* ya exige rol admin en el proxy; la acción vuelve a verificarlo en el servidor.
  const initial = await loadCommunityLinksAdminAction();

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Link href="/admin" className="text-sm font-medium text-stampa-accent hover:text-orange-300">
            Admin
          </Link>
          <span className="text-gray-400">/</span>
          <span className="text-sm text-gray-500">Redes y canales</span>
        </div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-fg">
          <Share2 className="text-stampa-accent" />
          Redes y canales
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Administrá las redes sociales y los canales de comunidad de Stampa: enlaces, orden, visibilidad y quién puede entrar a cada canal.
        </p>
      </div>

      <CommunityLinksManager initial={initial} />
    </div>
  );
}
