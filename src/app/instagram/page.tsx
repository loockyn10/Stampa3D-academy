import React from "react";
import { SocialView } from "@/components/common/social-view";
import { loadCommunityLinks } from "@/lib/community/server";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

export default async function InstagramPage() {
  const supabase = await createClient();
  const { links, status } = await loadCommunityLinks(supabase);
  // El Admin puede tener varios enlaces de la misma plataforma: se muestra el primero según el orden configurado.
  const link = links.find((item) => item.platform === "instagram") ?? null;

  return <SocialView id="instagram" link={link} loadFailed={status === "error"} />;
}
