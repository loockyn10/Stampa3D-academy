import React from "react";
import { redirect } from "next/navigation";
import { SinAccesoClient } from "./sin-acceso-client";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { resolvePostAccessDestination } from "@/lib/auth/access-destination";
import { createClient } from "@/utils/supabase/server";
import { discountCodesEnabled } from "@/lib/discounts/discount-codes";
import { loadFeatureFlagSnapshot } from "@/lib/features/loader";
import { resolveFeatureAccess } from "@/lib/features/resolve";

export const dynamic = "force-dynamic";

export default async function SinAccesoPage({ searchParams }: PageProps<"/sin-acceso">) {
  const { feature } = await searchParams;

  const supabase = await createClient();
  const { access } = await getCurrentUserAccess(supabase);

  const destination = resolvePostAccessDestination(access);
  if (destination) redirect(destination);

  // Free tools offered here follow the real feature flags (a disabled tool is not offered).
  const flags = await loadFeatureFlagSnapshot(supabase);
  const calculatorAvailable = resolveFeatureAccess(flags, "calculadora", { isAdmin: false }).allowed;

  return (
    <SinAccesoClient
      feature={typeof feature === "string" ? feature : null}
      discountCodesEnabled={discountCodesEnabled()}
      calculatorAvailable={calculatorAvailable}
    />
  );
}
