"use server";

import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { createClient } from "@/utils/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requireAdmin() {
  const supabase = await createClient();
  const { access, error } = await getCurrentUserAccess(supabase);
  if (error || !access.capabilities.accessAdmin || !access.userId) return null;
  return { supabase, adminUserId: access.userId };
}

export async function grantBetaAccessAdmin(input: {
  userId: string;
  notes: string;
  expiresAt: string | null;
}) {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "No autorizado." };
  const { supabase, adminUserId } = admin;
  if (!UUID_PATTERN.test(input.userId)) return { success: false, error: "Usuario inválido." };

  const notes = input.notes.trim().slice(0, 1_000) || null;
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) {
    return { success: false, error: "La fecha de vencimiento debe ser futura." };
  }

  const { data: target, error: targetError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", input.userId)
    .maybeSingle();
  if (targetError || !target) return { success: false, error: "No se encontró el usuario." };

  const { data: existing, error: existingError } = await supabase
    .from("user_access_grants")
    .select("id")
    .eq("user_id", input.userId)
    .eq("grant_type", "beta_tester")
    .limit(1)
    .maybeSingle();
  if (existingError) return { success: false, error: existingError.message };

  const grantValues = {
    status: "active",
    notes,
    expires_at: expiresAt?.toISOString() ?? null,
  };

  const mutation = existing
    ? supabase.from("user_access_grants").update(grantValues).eq("id", existing.id)
    : supabase.from("user_access_grants").insert({
        user_id: input.userId,
        grant_type: "beta_tester",
        created_by: adminUserId,
        ...grantValues,
      });

  const { error: mutationError } = await mutation;
  if (mutationError) return { success: false, error: mutationError.message };

  return { success: true };
}

async function activateFounderReservation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  founderId: string,
) {
  const { data, error } = await supabase
    .from("founder_members")
    .update({
      status: "active",
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", founderId)
    .eq("status", "reserved")
    .select("id, founder_number, price")
    .maybeSingle();

  if (error) return { success: false as const, error: error.message };
  if (!data) return { success: false as const, error: "La reserva fundadora ya no está pendiente." };
  return {
    success: true as const,
    founderNumber: data.founder_number as number,
    price: Number(data.price),
  };
}

export async function activateFounderOverrideAdmin(userId: string) {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "No autorizado." };
  const { supabase } = admin;
  if (!UUID_PATTERN.test(userId)) return { success: false, error: "Usuario inválido." };

  const { data: existing, error: existingError } = await supabase
    .from("founder_members")
    .select("id, founder_number, status, price")
    .eq("user_id", userId)
    .maybeSingle();
  if (existingError) return { success: false, error: existingError.message };

  if (existing?.status === "active") {
    return { success: true, founderNumber: existing.founder_number, price: Number(existing.price) };
  }
  if (existing?.status === "reserved") {
    return activateFounderReservation(supabase, existing.id);
  }
  if (existing) {
    return { success: false, error: `El usuario ya tiene un registro fundador en estado ${existing.status}.` };
  }

  const { data: lastFounder, error: lastFounderError } = await supabase
    .from("founder_members")
    .select("founder_number")
    .order("founder_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastFounderError) return { success: false, error: lastFounderError.message };

  const nextFounderNumber = Number(lastFounder?.founder_number || 0) + 1;
  const { data: pricingTier, error: pricingError } = await supabase
    .from("founder_pricing_tiers")
    .select("monthly_price, currency")
    .eq("is_active", true)
    .lte("starts_at_number", nextFounderNumber)
    .gte("ends_at_number", nextFounderNumber)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (pricingError) return { success: false, error: pricingError.message };
  if (!pricingTier || !Number.isFinite(Number(pricingTier.monthly_price))) {
    return { success: false, error: `No hay un precio fundador vigente para el cupo #${nextFounderNumber}.` };
  }

  const { data: founder, error: insertError } = await supabase
    .from("founder_members")
    .insert({
      user_id: userId,
      founder_number: nextFounderNumber,
      price: Number(pricingTier.monthly_price),
      currency: pricingTier.currency || "ARS",
      status: "active",
      confirmed_at: new Date().toISOString(),
    })
    .select("founder_number, price")
    .single();
  if (insertError) return { success: false, error: insertError.message };

  return {
    success: true,
    founderNumber: founder.founder_number as number,
    price: Number(founder.price),
  };
}
