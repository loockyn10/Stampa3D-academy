import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SelectionKind = "printer" | "filament";

type SelectionBody = {
  kind?: unknown;
  templateId?: unknown;
};

const CONFIG = {
  printer: {
    templateTable: "printer_templates",
    selectionTable: "calculator_user_printer_templates",
    idColumn: "printer_template_id",
    preferenceColumn: "default_printer_template_id",
  },
  filament: {
    templateTable: "filament_templates",
    selectionTable: "calculator_user_filament_templates",
    idColumn: "filament_template_id",
    preferenceColumn: "default_filament_template_id",
  },
} as const;

function parseBody(body: SelectionBody): { kind: SelectionKind; templateId: string } | null {
  const kind = body.kind === "printer" || body.kind === "filament" ? body.kind : null;
  const templateId = typeof body.templateId === "string" && UUID_PATTERN.test(body.templateId) ? body.templateId : null;
  return kind && templateId ? { kind, templateId } : null;
}

async function requestContext() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "authentication_required" }, { status: 401 }) } as const;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("[calculator/selections] missing server environment");
    return { error: NextResponse.json({ error: "calculator_selection_unavailable" }, { status: 503 }) } as const;
  }

  const admin = createAdminClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { supabase, admin, user } as const;
}

async function readBody(request: Request) {
  try {
    return parseBody(await request.json() as SelectionBody);
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const selection = await readBody(request);
  if (!selection) return NextResponse.json({ error: "invalid_selection" }, { status: 400 });

  const context = await requestContext();
  if ("error" in context) return context.error;
  const config = CONFIG[selection.kind];

  const { data: template, error: templateError } = await context.admin
    .from(config.templateTable)
    .select("id")
    .eq("id", selection.templateId)
    .eq("is_active", true)
    .maybeSingle();
  if (templateError) {
    console.error("[calculator/selections] template validation failed", {
      kind: selection.kind,
      code: templateError.code,
    });
    return NextResponse.json({ error: "calculator_selection_unavailable" }, { status: 503 });
  }
  if (!template) return NextResponse.json({ error: "template_unavailable" }, { status: 404 });

  const { error } = await context.supabase
    .from(config.selectionTable)
    .upsert({ user_id: context.user.id, [config.idColumn]: selection.templateId }, {
      onConflict: `user_id,${config.idColumn}`,
      ignoreDuplicates: true,
    });
  if (error) {
    console.error("[calculator/selections] add failed", { kind: selection.kind, code: error.code });
    return NextResponse.json({ error: "calculator_selection_unavailable" }, { status: 503 });
  }

  return NextResponse.json({ success: true, templateId: selection.templateId });
}

export async function DELETE(request: Request) {
  const selection = await readBody(request);
  if (!selection) return NextResponse.json({ error: "invalid_selection" }, { status: 400 });

  const context = await requestContext();
  if ("error" in context) return context.error;
  const config = CONFIG[selection.kind];

  const { data: preferences, error: preferenceReadError } = await context.supabase
    .from("calculator_user_preferences")
    .select("default_printer_template_id, default_filament_template_id")
    .eq("user_id", context.user.id)
    .maybeSingle();
  if (preferenceReadError) {
    console.error("[calculator/selections] preference read failed", { code: preferenceReadError.code });
    return NextResponse.json({ error: "calculator_selection_unavailable" }, { status: 503 });
  }

  if (preferences?.[config.preferenceColumn] === selection.templateId) {
    const { data: alternative, error: alternativeError } = await context.supabase
      .from(config.selectionTable)
      .select(config.idColumn)
      .eq("user_id", context.user.id)
      .neq(config.idColumn, selection.templateId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (alternativeError) {
      console.error("[calculator/selections] fallback read failed", { kind: selection.kind, code: alternativeError.code });
      return NextResponse.json({ error: "calculator_selection_unavailable" }, { status: 503 });
    }

    const replacement = (alternative as Record<string, string> | null)?.[config.idColumn] ?? null;
    const otherDefault = selection.kind === "printer"
      ? preferences.default_filament_template_id
      : preferences.default_printer_template_id;
    const { error: updateError } = await context.supabase
      .from("calculator_user_preferences")
      .update({
        [config.preferenceColumn]: replacement,
        onboarding_status: replacement && otherDefault ? "completed" : "pending",
      })
      .eq("user_id", context.user.id);
    if (updateError) {
      console.error("[calculator/selections] default replacement failed", { kind: selection.kind, code: updateError.code });
      return NextResponse.json({ error: "calculator_selection_unavailable" }, { status: 503 });
    }
  }

  const { error } = await context.supabase
    .from(config.selectionTable)
    .delete()
    .eq("user_id", context.user.id)
    .eq(config.idColumn, selection.templateId);
  if (error) {
    console.error("[calculator/selections] remove failed", { kind: selection.kind, code: error.code });
    return NextResponse.json({ error: "calculator_selection_unavailable" }, { status: 503 });
  }

  return NextResponse.json({ success: true, templateId: selection.templateId });
}
