import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { validatePromoTerms } from "@/lib/mercadopago/promo-terms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || profile.role !== "admin") return { response: NextResponse.json({ error: "Forbidden" }, { status: 403, headers: noStore }) };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { response: NextResponse.json({ error: "Configuración de Supabase incompleta" }, { status: 500, headers: noStore }) };
  return { admin: createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) };
}

/** Terms of every code that has them (admin list). Empty when the price-schedule migration is not applied yet. */
export async function GET() {
  const gate = await requireAdmin();
  if (!gate.admin) return gate.response;
  const { data, error } = await gate.admin
    .from("discount_code_terms")
    .select("invite_code_id, promo_cycles, post_price, notice_days, terms_version");
  if (error) return NextResponse.json({ terms: [], available: false }, { headers: noStore });
  return NextResponse.json({ terms: data ?? [], available: true }, { headers: noStore });
}

/**
 * Saves (creates or replaces) the promotion terms of a fixed-price discount code. Admin only, service role. The database
 * refuses to change terms that users already accepted (a new code / version is needed then).
 */
export async function POST(request: Request) {
  const gate = await requireAdmin();
  if (!gate.admin) return gate.response;

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Bad Request" }, { status: 400, headers: noStore });
  }

  const codeId = body.invite_code_id;
  if (typeof codeId !== "string" || !UUID.test(codeId)) {
    return NextResponse.json({ error: "Código inválido." }, { status: 400, headers: noStore });
  }

  const { data: code, error: codeError } = await gate.admin
    .from("invite_codes")
    .select("id, code_type, discount_value")
    .eq("id", codeId)
    .maybeSingle();
  if (codeError || !code) return NextResponse.json({ error: "No encontramos el código." }, { status: 404, headers: noStore });
  if (code.code_type !== "fixed_price") {
    return NextResponse.json({ error: "Las condiciones por períodos solo se aplican a códigos de Precio Especial Fijo." }, { status: 422, headers: noStore });
  }

  const validation = validatePromoTerms(
    { promoCycles: body.promo_cycles, postPrice: body.post_price, noticeDays: body.notice_days },
    { promoPrice: Number(code.discount_value) },
  );
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 422, headers: noStore });

  const t = validation.terms;

  // Saving the same conditions again changes nothing (and keeps the version buyers already accepted).
  const { data: existing } = await gate.admin
    .from("discount_code_terms")
    .select("promo_cycles, post_price, notice_days, terms_version")
    .eq("invite_code_id", codeId)
    .maybeSingle();
  if (
    existing &&
    Number(existing.promo_cycles) === t.promoCycles &&
    Math.round(Number(existing.post_price) * 100) === Math.round(t.postPrice * 100) &&
    Number(existing.notice_days) === t.noticeDays
  ) {
    return NextResponse.json({ saved: true, unchanged: true, terms_version: existing.terms_version }, { headers: noStore });
  }

  const { error } = await gate.admin.from("discount_code_terms").upsert(
    {
      invite_code_id: codeId,
      promo_cycles: t.promoCycles,
      post_price: t.postPrice,
      notice_days: t.noticeDays,
      notice_lead_days: t.noticeLeadDays,
      terms_version: t.termsVersion,
    },
    { onConflict: "invite_code_id" },
  );
  if (error) {
    if (/cannot change once users accepted/i.test(error.message)) {
      return NextResponse.json(
        { error: "Estas condiciones ya fueron aceptadas por compradores y no se pueden cambiar. Creá otro código." },
        { status: 409, headers: noStore },
      );
    }
    // Typically: the price-schedule migration is not applied yet (relation does not exist).
    console.error("[admin promo-terms] save failed", error.code ?? "error");
    return NextResponse.json({ error: "No pudimos guardar las condiciones. Verificá que la migration de agendas de precio esté aplicada." }, { status: 503, headers: noStore });
  }
  return NextResponse.json({ saved: true, terms_version: t.termsVersion }, { headers: noStore });
}
