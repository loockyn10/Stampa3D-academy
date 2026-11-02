import React from "react";
import { CommunityLinksView } from "@/components/community/community-links-view";
import { loadCommunityLinks } from "@/lib/community/server";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

export default async function RedesPage() {
  const supabase = await createClient();
  const { links, status } = await loadCommunityLinks(supabase, { kind: "social" });

  return (
    <CommunityLinksView
      links={links}
      kind="social"
      route="/redes"
      title="Redes"
      intro="Seguinos en nuestras redes y encontrá contenido, novedades y recursos de Academia Stampa."
      emptyTitle="Todavía no hay redes para mostrar"
      emptyHint="Muy pronto vas a encontrar acá nuestras redes sociales."
      loadFailed={status === "error"}
    />
  );
}
