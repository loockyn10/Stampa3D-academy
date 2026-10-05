"use server";

import {
  BETA_CODE_MAX_INPUT_LENGTH,
  BETA_CODE_SHAPE,
  normalizeBetaAccessCode,
  toBetaRedeemResult,
  type BetaRedeemResult,
} from "@/lib/beta-access/code";
import { createClient } from "@/utils/supabase/server";

/**
 * Redeems a beta invitation code for the CURRENT session user. The user id is never taken from the
 * client: the database function uses auth.uid(). Validation, expiry, max uses, idempotency and
 * rate limiting all live in public.redeem_beta_access_code. RPC/technical errors are never returned.
 */
export async function redeemBetaAccessCodeAction(rawCode: unknown): Promise<BetaRedeemResult> {
  if (typeof rawCode !== "string" || rawCode.length > BETA_CODE_MAX_INPUT_LENGTH) {
    return toBetaRedeemResult({ status: "invalid" });
  }

  const code = normalizeBetaAccessCode(rawCode);
  // Obvious typos / wrong shape never reach the database (and do not burn a guess attempt).
  if (!BETA_CODE_SHAPE.test(code)) return toBetaRedeemResult({ status: "invalid" });

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return toBetaRedeemResult({ status: "unauthenticated" });

    const { data, error } = await supabase.rpc("redeem_beta_access_code", { p_code: code });
    if (error) {
      console.error("[beta-access] redeem rpc failed", error.code ?? "unknown");
      return toBetaRedeemResult({ status: "error" });
    }

    return toBetaRedeemResult(data);
  } catch (caught) {
    console.error("[beta-access] redeem failed", caught instanceof Error ? caught.name : "unknown_error");
    return toBetaRedeemResult({ status: "error" });
  }
}
