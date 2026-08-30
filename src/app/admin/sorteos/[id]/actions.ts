"use server";

import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { PLATFORM_GRANT_TYPES } from "@/lib/auth/access-policy";
import { getRaffleParticipantChances } from "@/lib/raffles/participants";
import { createClient } from "@/utils/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function assignRaffleWinner(input: {
  raffleId: string;
  prizeId: string;
  userId: string;
}) {
  if (![input.raffleId, input.prizeId, input.userId].every((value) => UUID_PATTERN.test(value))) {
    return { success: false, error: "La selección enviada es inválida." };
  }

  const supabase = await createClient();
  const { access, error: accessError } = await getCurrentUserAccess(supabase);
  if (accessError || !access.capabilities.accessAdmin) {
    return { success: false, error: "No autorizado." };
  }

  const [raffleResult, prizeResult, profileResult, grantsResult, bonusResult, winnerResult] = await Promise.all([
    supabase.from("raffles").select("id").eq("id", input.raffleId).maybeSingle(),
    supabase.from("raffle_prizes").select("id, raffle_id, name").eq("id", input.prizeId).eq("raffle_id", input.raffleId).maybeSingle(),
    supabase.from("profiles").select("id, email, full_name, display_name, role, membership_status, membership_expires_at, onboarding_completed, member_level").eq("id", input.userId).maybeSingle(),
    supabase.from("user_access_grants").select("grant_type, status, expires_at").eq("user_id", input.userId).eq("status", "active").in("grant_type", [...PLATFORM_GRANT_TYPES]),
    supabase.from("user_raffle_bonus_entries").select("entries_count").eq("user_id", input.userId).eq("is_active", true),
    supabase.from("raffle_winners").select("id").eq("raffle_id", input.raffleId).eq("prize_id", input.prizeId).limit(1).maybeSingle(),
  ]);

  if (raffleResult.error || !raffleResult.data) return { success: false, error: "No se encontró el sorteo." };
  if (prizeResult.error || !prizeResult.data) return { success: false, error: "El premio no pertenece a este sorteo." };
  if (profileResult.error || !profileResult.data) return { success: false, error: "No se encontró el usuario." };
  if (grantsResult.error) return { success: false, error: grantsResult.error.message };
  if (bonusResult.error) return { success: false, error: bonusResult.error.message };
  if (winnerResult.error) return { success: false, error: winnerResult.error.message };
  if (winnerResult.data) return { success: false, error: "Ese premio ya tiene un ganador asignado." };

  const bonusEntries = (bonusResult.data || []).reduce(
    (total, row) => total + Number(row.entries_count || 0),
    0,
  );
  const chances = getRaffleParticipantChances({
    profile: profileResult.data,
    grants: (grantsResult.data || []).map((grant) => ({
      grantType: grant.grant_type,
      status: grant.status,
      expiresAt: grant.expires_at,
    })),
    bonusEntries,
  });
  if (chances === null) {
    return { success: false, error: "El usuario no tiene acceso vigente y no participa del sorteo." };
  }

  const winnerName = profileResult.data.display_name
    || profileResult.data.full_name
    || profileResult.data.email
    || "Usuario sin nombre";
  const { data: winner, error: insertError } = await supabase
    .from("raffle_winners")
    .insert({
      raffle_id: input.raffleId,
      prize_id: input.prizeId,
      user_id: input.userId,
      winner_name_snapshot: winnerName,
      prize_name_snapshot: prizeResult.data.name,
      won_at: new Date().toISOString(),
    })
    .select("id, raffle_id, prize_id, user_id, winner_name_snapshot, prize_name_snapshot, won_at")
    .single();

  if (insertError) return { success: false, error: insertError.message };
  return { success: true, winner, chances };
}
