import React from "react";
import { redirect } from "next/navigation";
import { SinAccesoClient } from "./sin-acceso-client";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { resolvePostAccessDestination } from "@/lib/auth/access-destination";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

export default async function SinAccesoPage({ searchParams }: PageProps<"/sin-acceso">) {
  const { feature } = await searchParams;

  const supabase = await createClient();
  const { access } = await getCurrentUserAccess(supabase);

  const destination = resolvePostAccessDestination(access);
  if (destination) redirect(destination);

  return <SinAccesoClient feature={typeof feature === "string" ? feature : null} />;
}
