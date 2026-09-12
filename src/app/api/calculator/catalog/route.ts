import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { CALCULATOR_DEMO_CONFIG } from "@/lib/calculator/demo-config";
import {
  getCalculatorFilamentDisplayName,
  getCalculatorPrinterDisplayName,
  isUsableDemoFilament,
  isUsableDemoPrinter,
  selectDemoCatalogItem,
} from "@/lib/calculator/demo-catalog";
import type {
  CalculatorCatalogResponse,
  CalculatorFilamentCatalogItem,
  CalculatorPreferenceDto,
  CalculatorPrinterCatalogItem,
} from "@/lib/calculator/catalog-types";

export const dynamic = "force-dynamic";

type CatalogQueryError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

function catalogErrorCategory(error: CatalogQueryError | null): string | null {
  if (!error) return null;
  if (error.code === "42501") return "permission_denied";
  if (["42P01", "PGRST205"].includes(error.code ?? "")) return "table_missing";
  if (["42703", "PGRST204"].includes(error.code ?? "")) return "schema_mismatch";
  if (/fetch failed|network|connect/i.test(error.message ?? "")) return "connection_failed";
  return "query_failed";
}

function unavailable() {
  return NextResponse.json({ error: "calculator_catalog_unavailable" }, { status: 503 });
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error("[calculator/catalog] unavailable", {
      category: "missing_environment",
      missing: [!url ? "NEXT_PUBLIC_SUPABASE_URL" : null, !serviceRoleKey ? "SUPABASE_SERVICE_ROLE_KEY" : null].filter(Boolean),
    });
    return unavailable();
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.warn("[calculator/catalog] session unavailable; serving anonymous DTO", {
      category: "auth_session_error",
      message: authError.message.slice(0, 160),
    });
  }
  const admin = createAdminClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const catalogResults = await Promise.all([
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
  ]).catch((caught: unknown) => {
    console.error("[calculator/catalog] unavailable", {
      category: "connection_failed",
      errorType: caught instanceof Error ? caught.name : "unknown_error",
    });
    return null;
  });

  if (!catalogResults) return unavailable();
  const [printerResult, filamentResult] = catalogResults;

  if (printerResult.error || filamentResult.error) {
    console.error("[calculator/catalog] unavailable", {
      category: "catalog_query",
      printers: printerResult.error ? {
        category: catalogErrorCategory(printerResult.error),
        code: printerResult.error.code,
        message: printerResult.error.message.slice(0, 180),
      } : null,
      filaments: filamentResult.error ? {
        category: catalogErrorCategory(filamentResult.error),
        code: filamentResult.error.code,
        message: filamentResult.error.message.slice(0, 180),
      } : null,
    });
    return unavailable();
  }

  const rawPrinters = printerResult.data ?? [];
  const rawFilaments = filamentResult.data ?? [];
  const printerSelection = selectDemoCatalogItem(rawPrinters, CALCULATOR_DEMO_CONFIG.printerTemplateId, isUsableDemoPrinter);
  const filamentSelection = selectDemoCatalogItem(rawFilaments, CALCULATOR_DEMO_CONFIG.filamentTemplateId, isUsableDemoFilament);

  for (const [kind, selection, configuredId] of [
    ["printer", printerSelection, CALCULATOR_DEMO_CONFIG.printerTemplateId],
    ["filament", filamentSelection, CALCULATOR_DEMO_CONFIG.filamentTemplateId],
  ] as const) {
    if (selection.status === "configured_missing" || selection.status === "configured_invalid") {
      console.warn("[calculator/catalog] invalid demo configuration", {
        category: selection.status,
        kind,
        configuredId,
        fallbackSelected: Boolean(selection.item),
      });
    }
  }

  const printers = rawPrinters.filter(isUsableDemoPrinter).map((printer) => ({
    ...printer,
    display_name: getCalculatorPrinterDisplayName(printer),
  })) as CalculatorPrinterCatalogItem[];
  const filaments = rawFilaments.filter(isUsableDemoFilament).map((filament) => ({
    ...filament,
    display_name: getCalculatorFilamentDisplayName(filament),
  })) as CalculatorFilamentCatalogItem[];
  const demoPrinter = printerSelection.item
    ? printers.find((printer) => printer.id === printerSelection.item?.id) ?? null
    : null;
  const demoFilament = filamentSelection.item
    ? filaments.find((filament) => filament.id === filamentSelection.item?.id) ?? null
    : null;

  if (!demoPrinter || !demoFilament) {
    console.error("[calculator/catalog] unavailable", {
      category: "no_complete_demo_template",
      usablePrinters: printers.length,
      usableFilaments: filaments.length,
    });
    return unavailable();
  }

  let preferences: CalculatorPreferenceDto | null = null;
  let selectedPrinterTemplateIds: string[] = [];
  let selectedFilamentTemplateIds: string[] = [];
  if (user) {
    const [preferenceResult, printerSelectionsResult, filamentSelectionsResult] = await Promise.all([
      supabase
        .from("calculator_user_preferences")
        .select("default_printer_template_id, default_filament_template_id, onboarding_status")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("calculator_user_printer_templates")
        .select("printer_template_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("calculator_user_filament_templates")
        .select("filament_template_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true }),
    ]);

    const selectionError = printerSelectionsResult.error || filamentSelectionsResult.error;
    if (selectionError) {
      console.error("[calculator/catalog] selection read failed", {
        category: catalogErrorCategory(selectionError),
        code: selectionError.code,
      });
      return unavailable();
    }

    selectedPrinterTemplateIds = (printerSelectionsResult.data ?? []).map((row) => row.printer_template_id);
    selectedFilamentTemplateIds = (filamentSelectionsResult.data ?? []).map((row) => row.filament_template_id);

    const { data, error } = preferenceResult;
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

  const selectedPrinters = printers.filter((printer) => selectedPrinterTemplateIds.includes(printer.id));
  const selectedFilaments = filaments.filter((filament) => selectedFilamentTemplateIds.includes(filament.id));

  const response: CalculatorCatalogResponse = {
    authenticated: Boolean(user),
    demo: !user || !preferences?.defaultPrinterTemplateId || !preferences?.defaultFilamentTemplateId,
    printers: user && selectedPrinters.length > 0 ? selectedPrinters : [demoPrinter],
    filaments: user && selectedFilaments.length > 0 ? selectedFilaments : [demoFilament],
    catalogPrinters: user ? printers : [],
    catalogFilaments: user ? filaments : [],
    selectedPrinterTemplateIds,
    selectedFilamentTemplateIds,
    preferences,
    settings: CALCULATOR_DEMO_CONFIG.settings,
    productTypes: [...CALCULATOR_DEMO_CONFIG.productTypes],
  };

  return NextResponse.json(response, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
