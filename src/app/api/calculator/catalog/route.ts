import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { CALCULATOR_DEMO_CONFIG } from "@/lib/calculator/demo-config";
import type {
  CalculatorCatalogResponse,
  CalculatorFilamentCatalogItem,
  CalculatorPreferenceDto,
  CalculatorPrinterCatalogItem,
} from "@/lib/calculator/catalog-types";

export const dynamic = "force-dynamic";

function pickConfiguredOrFirst<T extends { id: string }>(items: T[], configuredId: string | null): T | null {
  return (configuredId ? items.find((item) => item.id === configuredId) : null) ?? items[0] ?? null;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return NextResponse.json({ error: "La configuración demo no está disponible." }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const admin = createAdminClient(url, serviceRoleKey, { auth: { persistSession: false } });

  const [printerResult, filamentResult] = await Promise.all([
    admin
      .from("printer_templates")
      .select("id, name, brand, model, power_watts, maintenance_cost_per_hour, image_path")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("brand", { ascending: true }),
    admin
      .from("filament_templates")
      .select("id, name, brand, filament_type, color, color_hex, default_total_grams, default_purchase_price")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
  ]);

  if (printerResult.error || filamentResult.error) {
    console.error("[calculator/catalog] catalog query failed", {
      printers: printerResult.error?.message,
      filaments: filamentResult.error?.message,
    });
    return NextResponse.json({ error: "No pudimos cargar la configuración de cálculo." }, { status: 503 });
  }

  const printers = (printerResult.data ?? []) as CalculatorPrinterCatalogItem[];
  const filaments = (filamentResult.data ?? []) as CalculatorFilamentCatalogItem[];
  const demoPrinter = pickConfiguredOrFirst(printers, CALCULATOR_DEMO_CONFIG.printerTemplateId);
  const demoFilament = pickConfiguredOrFirst(filaments, CALCULATOR_DEMO_CONFIG.filamentTemplateId);

  if (!demoPrinter || !demoFilament) {
    return NextResponse.json({ error: "El catálogo demo todavía no está configurado." }, { status: 503 });
  }

  let preferences: CalculatorPreferenceDto | null = null;
  if (user) {
    const { data, error } = await supabase
      .from("calculator_user_preferences")
      .select("default_printer_template_id, default_filament_template_id, onboarding_status")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!error && data) {
      preferences = {
        defaultPrinterTemplateId: data.default_printer_template_id,
        defaultFilamentTemplateId: data.default_filament_template_id,
        onboardingStatus: data.onboarding_status,
      };
    } else if (error && error.code !== "42P01" && error.code !== "PGRST205") {
      console.error("[calculator/catalog] preference read failed", error.message.slice(0, 160));
    }
  }

  const response: CalculatorCatalogResponse = {
    authenticated: Boolean(user),
    demo: !user || !preferences?.defaultPrinterTemplateId || !preferences?.defaultFilamentTemplateId,
    printers: user ? printers : [demoPrinter],
    filaments: user ? filaments : [demoFilament],
    preferences,
    settings: CALCULATOR_DEMO_CONFIG.settings,
    productTypes: [...CALCULATOR_DEMO_CONFIG.productTypes],
  };

  return NextResponse.json(response, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
