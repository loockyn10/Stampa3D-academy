import React from "react";
import { CommunityLinksView } from "@/components/community/community-links-view";
import { loadCommunityLinks } from "@/lib/community/server";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

export default async function CanalesPage() {
  const supabase = await createClient();
  const { links, status } = await loadCommunityLinks(supabase, { kind: "channel" });

  return (
    <CommunityLinksView
      links={links}
      kind="channel"
      route="/canales"
      title="Canales"
      intro="Entrá a los canales de comunidad para resolver dudas, compartir avances y estar al día."
      emptyTitle="Todavía no hay canales para mostrar"
      emptyHint="Muy pronto vas a encontrar acá los canales de la comunidad."
      loadFailed={status === "error"}
    />
  );
}
