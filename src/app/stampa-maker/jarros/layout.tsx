import { redirect } from "next/navigation";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { canAccessMakerTool } from "@/lib/maker/availability";
import { createClient } from "@/utils/supabase/server";

// Jarros 3D: Beta / solo administradores. Chequeo server-side con el mismo rol que /admin.
export default async function JarrosLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { access } = await getCurrentUserAccess(supabase);
  if (!canAccessMakerTool("/stampa-maker/jarros", access.capabilities.accessAdmin)) redirect("/stampa-maker");
  return children;
}
