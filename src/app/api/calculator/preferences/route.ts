import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PreferenceBody = {
  defaultPrinterTemplateId?: unknown;
  defaultFilamentTemplateId?: unknown;
  onboardingStatus?: unknown;
};

export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Necesitás iniciar sesión." }, { status: 401 });

  let body: PreferenceBody;
  try {
    body = await request.json() as PreferenceBody;
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  const printerId = typeof body.defaultPrinterTemplateId === "string" ? body.defaultPrinterTemplateId : null;
  const filamentId = typeof body.defaultFilamentTemplateId === "string" ? body.defaultFilamentTemplateId : null;
  const status = body.onboardingStatus;
  if (!['completed', 'skipped'].includes(String(status))) {
    return NextResponse.json({ error: "Estado de onboarding inválido." }, { status: 400 });
  }
  if (status === "completed" && (!printerId || !filamentId)) {
    return NextResponse.json({ error: "Elegí una impresora y un filamento." }, { status: 400 });
  }
  if ((printerId && !UUID_PATTERN.test(printerId)) || (filamentId && !UUID_PATTERN.test(filamentId))) {
    return NextResponse.json({ error: "Selección inválida." }, { status: 400 });
  }

  if (status === "completed") {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return NextResponse.json({ error: "Servicio no configurado." }, { status: 503 });
    const admin = createAdminClient(url, key, { auth: { persistSession: false } });
    const [printer, filament] = await Promise.all([
      admin.from("printer_templates").select("id").eq("id", printerId).eq("is_active", true).maybeSingle(),
      admin.from("filament_templates").select("id").eq("id", filamentId).eq("is_active", true).maybeSingle(),
    ]);
    if (printer.error || filament.error) return NextResponse.json({ error: "No pudimos validar tu selección." }, { status: 503 });
    if (!printer.data || !filament.data) return NextResponse.json({ error: "La selección ya no está disponible." }, { status: 400 });
  }

  const payload = {
    user_id: user.id,
    default_printer_template_id: status === "completed" ? printerId : null,
    default_filament_template_id: status === "completed" ? filamentId : null,
    onboarding_status: status,
    completed_at: status === "completed" ? new Date().toISOString() : null,
  };
  const { error } = await supabase.from("calculator_user_preferences").upsert(payload, { onConflict: "user_id" });
  if (error) {
    console.error("[calculator/preferences] save failed", error.message.slice(0, 160));
    return NextResponse.json({ error: "No pudimos guardar tu configuración." }, { status: 503 });
  }
  return NextResponse.json({ success: true });
}
