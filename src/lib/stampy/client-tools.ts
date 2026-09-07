import type { SupabaseClient } from "@supabase/supabase-js";
import type { StampyClientToolIntent } from "./client-tool-intents";

export interface StampyClientToolResult {
  success: boolean;
  toolName: "clients.inspect";
  aspect: StampyClientToolIntent["aspect"];
  data?: Record<string, unknown>;
  errorCode?: string;
  message?: string;
}

export async function executeStampyClientTool({
  supabase,
  userId,
  intent,
}: {
  supabase: SupabaseClient;
  userId: string;
  intent: StampyClientToolIntent;
}): Promise<StampyClientToolResult> {
  const base = { toolName: "clients.inspect" as const, aspect: intent.aspect };
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, user_id, name, email, phone, address, city, province, postal_code, contact_person, fiscal_condition, cuit, is_active")
    .eq("id", intent.clientId)
    .eq("user_id", userId)
    .maybeSingle();

  if (clientError) {
    return { ...base, success: false, errorCode: "client_query_failed", message: "No pude consultar ese cliente ahora." };
  }
  if (!client) {
    return { ...base, success: false, errorCode: "client_not_found", message: "No encontré ese cliente o no te pertenece." };
  }

  if (intent.aspect === "email") {
    return {
      ...base,
      success: true,
      data: { clientName: client.name, email: client.email || null },
    };
  }

  if (intent.aspect === "missing_data") {
    const fields = [
      ["email", client.email],
      ["teléfono", client.phone],
      ["dirección", client.address],
      ["ciudad", client.city],
      ["provincia", client.province],
      ["código postal", client.postal_code],
      ["persona de contacto", client.contact_person],
      ["condición fiscal", client.fiscal_condition],
      ["CUIT", client.cuit],
    ] as const;
    return {
      ...base,
      success: true,
      data: {
        clientName: client.name,
        missingFields: fields.filter(([, value]) => !String(value ?? "").trim()).map(([label]) => label),
      },
    };
  }

  if (intent.aspect === "summary") {
    return {
      ...base,
      success: true,
      data: {
        clientName: client.name,
        active: client.is_active !== false,
        contactPerson: client.contact_person || null,
        fiscalCondition: client.fiscal_condition || null,
        city: client.city || null,
      },
    };
  }

  const { data: budgets, error: budgetsError } = await supabase
    .from("budgets")
    .select("id, title, budget_number, status, total_amount, created_at, valid_until")
    .eq("user_id", userId)
    .eq("client_id", intent.clientId)
    .order("created_at", { ascending: false })
    .limit(intent.aspect === "last_budget" ? 1 : 20);
  if (budgetsError) {
    return { ...base, success: false, errorCode: "client_budgets_query_failed", message: "No pude consultar los presupuestos de ese cliente ahora." };
  }

  return {
    ...base,
    success: true,
    data: {
      clientName: client.name,
      budgets: (budgets ?? []).map((budget) => ({
        title: budget.title,
        number: budget.budget_number,
        status: budget.status,
        total: Number(budget.total_amount ?? 0),
        createdAt: budget.created_at,
        validUntil: budget.valid_until,
      })),
    },
  };
}

function money(value: unknown): string {
  const amount = Number(value);
  return `$${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0)}`;
}

function date(value: unknown): string {
  if (typeof value !== "string" || !value) return "sin fecha";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(parsed);
}

export function formatStampyClientToolResult(result: StampyClientToolResult): string {
  if (!result.success) return result.message ?? "No pude consultar ese cliente.";
  const data = result.data ?? {};
  const clientName = String(data.clientName ?? "El cliente");

  if (result.aspect === "email") {
    return data.email
      ? `El email de **${clientName}** es **${String(data.email)}**.`
      : `**${clientName}** no tiene un email cargado.`;
  }
  if (result.aspect === "missing_data") {
    const missing = (data.missingFields ?? []) as string[];
    return missing.length > 0
      ? `A **${clientName}** le faltan estos datos: ${missing.map((field) => `**${field}**`).join(", ")}.`
      : `**${clientName}** tiene completos los datos comerciales principales.`;
  }
  if (result.aspect === "summary") {
    const facts = [
      data.contactPerson ? `Contacto: ${String(data.contactPerson)}` : null,
      data.fiscalCondition ? `Condición fiscal: ${String(data.fiscalCondition)}` : null,
      data.city ? `Ciudad: ${String(data.city)}` : null,
      `Estado: ${data.active ? "activo" : "inactivo"}`,
    ].filter(Boolean);
    return `**${clientName}**\n\n${facts.map((fact) => `- ${fact}`).join("\n")}`;
  }

  const budgets = (data.budgets ?? []) as Array<{
    title?: string;
    number?: number;
    status?: string;
    total?: number;
    createdAt?: string;
  }>;
  if (budgets.length === 0) return `**${clientName}** todavía no tiene presupuestos.`;
  if (result.aspect === "last_budget") {
    const budget = budgets[0];
    return `El último presupuesto de **${clientName}** es **${budget.title || `PRES-${String(budget.number ?? "").padStart(6, "0")}`}**, del ${date(budget.createdAt)}, por **${money(budget.total)}**.`;
  }
  return `**${clientName} tiene ${budgets.length} presupuesto${budgets.length === 1 ? "" : "s"}:**\n\n${budgets.map((budget) => `- ${budget.title || `PRES-${String(budget.number ?? "").padStart(6, "0")}`}: ${money(budget.total)} · ${date(budget.createdAt)} · ${budget.status || "sin estado"}`).join("\n")}`;
}
