import { redirect } from "next/navigation";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { canAccessMakerTool } from "@/lib/maker/availability";
import { createClient } from "@/utils/supabase/server";

// Lámparas E27: Beta / solo administradores hasta completar la validación física (montaje, temperatura y estabilidad).
// Chequeo server-side con el mismo rol que /admin.
export default async function LamparasLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { access } = await getCurrentUserAccess(supabase);
  if (!canAccessMakerTool("/stampa-maker/lamparas", access.capabilities.accessAdmin)) redirect("/stampa-maker");
  return children;
}
