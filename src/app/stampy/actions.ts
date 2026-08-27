"use server";

import { createClient } from "@/utils/supabase/server";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { validateStampyMessage } from "@/lib/stampy/message-policy";
import type { StampyActionIntent } from "@/lib/stampy/types";
import type { StampyActionValidationResult } from "@/lib/stampy/action-validator";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
export type StampyContextPayload =
  | {
      source: "lesson";
      courseTitle?: string;
      moduleTitle?: string;
      courseId?: string;
      lessonId?: string;
      lessonTitle?: string;
      lessonDescription?: string;
      lessonSummary?: string;
      lessonTopics?: string[];
      lessonProblems?: string[];
      lessonLevel?: string;
      relatedTool?: string;
      transcript?: string;
      pathname?: string;
    }
  | {
      source: "page";
      pathname?: string;
      pageTitle?: string;
      pageDescription?: string;
      dbContext?: string; // New: context directly from database
      userIntentHints?: string[];
      relatedRoutes?: string[];
      toolKey?: string;
      suggestedQuestions?: string[];
    };

function cleanText(value?: string | null): string {
  if (!value) return "";
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function isUsefulText(value?: string | null): boolean {
  const cleaned = cleanText(value);
  return (
    cleaned.length >= 4 &&
    cleaned !== "empty" &&
    cleaned !== "null" &&
    cleaned !== "pendiente" &&
    cleaned !== "sin resumen" &&
    cleaned !== "sin descripcion"
  );
}

function includesUsefulNeedle(haystack: string, needle?: string | null) {
  const cleanedNeedle = cleanText(needle);
  if (!isUsefulText(cleanedNeedle)) return false;
  return haystack.includes(cleanedNeedle);
}

const ACTION_FIELD_LABELS: Record<string, string> = {
  clientName: "cliente",
  productName: "producto",
  quantity: "cantidad",
  grams: "gramos",
  hours: "horas",
  filamentReference: "material, color o marca del filamento",
  material: "material",
  totalGrams: "peso total",
  printerName: "nombre de la impresora",
  initialStock: "stock inicial",
  printTimeMinutes: "tiempo de impresión",
  baseCost: "costo base",
  salePrice: "precio de venta",
  components: "receta de filamentos",
  items: "productos y cantidades",
  powerWatts: "potencia",
  maintenanceCostPerHour: "mantenimiento por hora",
  toolContract: "contrato de herramienta",
};

function formatFieldList(fields: string[]): string {
  const labels = fields.map((field) => ACTION_FIELD_LABELS[field] ?? field);
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} y ${labels.at(-1)}`;
}

function buildActionValidationResponse(
  actionIntent: StampyActionIntent,
  validation: StampyActionValidationResult
): string {
  const parts: string[] = [];

  if (validation.missingFields.length > 0) {
    parts.push(`Me faltan estos datos: ${formatFieldList(validation.missingFields)}.`);
  }
  if (validation.invalidFields.length > 0) {
    parts.push(`Estos datos no son válidos: ${formatFieldList(validation.invalidFields)}.`);
  }

  if (actionIntent.type === "create_quote") {
    parts.push("No calculé ningún precio ni usé gramos como base del presupuesto.");
  } else if (actionIntent.type === "calculate_price") {
    parts.push("Indicame gramos y horas para poder prepararte el acceso a la calculadora, sin inventar un precio.");
  } else {
    parts.push("Pasame esos datos y te preparo el acceso a la herramienta para que confirmes la acción manualmente.");
  }

  return parts.join(" ");
}

function isFilamentMovementAction(actionIntent: StampyActionIntent): boolean {
  return (
    actionIntent.type === "increase_filament_stock" ||
    actionIntent.type === "discount_filament"
  );
}

function isCreateFilamentAction(actionIntent: StampyActionIntent): boolean {
  return actionIntent.type === "add_filament";
}

function isCreatePrinterAction(actionIntent: StampyActionIntent): boolean {
  return actionIntent.type === "add_printer";
}

function isCreateProductAction(actionIntent: StampyActionIntent): boolean {
  return actionIntent.type === "create_product";
}

function isProductFilamentDiscountAction(
  actionIntent: StampyActionIntent
): boolean {
  return actionIntent.type === "discount_product_filaments";
}

function buildFilamentMovementResponse(actionIntent: StampyActionIntent): string {
  const resolvedTarget = actionIntent.extracted.resolvedTarget as
    | { label?: string; remainingGramsBefore?: number }
    | undefined;
  const grams = Number(actionIntent.extracted.grams);
  const matchStatus = actionIntent.extracted.matchStatus;

  if (actionIntent.extracted.requiresConfirmation === true && resolvedTarget?.label) {
    const actionLabel =
      actionIntent.type === "discount_filament" ? "descontar stock" : "aumentar stock";
    return `Detecté un movimiento de filamento:\n\n- Acción: ${actionLabel}\n- Filamento: ${resolvedTarget.label}\n- Cantidad: ${grams}g\n\nAntes de hacerlo necesito que confirmes. Todavía no modifiqué tu stock.`;
  }

  if (matchStatus === "multiple") {
    return "Encontré más de un filamento posible. Para evitar errores, elegilo desde Stock. Todavía no modifiqué tu stock.";
  }

  return "No encontré un filamento activo que coincida con esos datos. Te dejo Stock abierto para que lo selecciones manualmente. Todavía no modifiqué tu stock.";
}

function buildCreateFilamentResponse(actionIntent: StampyActionIntent): string {
  const extracted = actionIntent.extracted;
  if (extracted.duplicateStatus === "duplicate") {
    return "Ya encontré un filamento parecido cargado. Para evitar duplicados, te conviene aumentar stock desde el existente o revisar Stock. Todavía no creé nada.";
  }

  if (extracted.requiresConfirmation !== true) {
    return "No pude verificar con seguridad que el filamento sea nuevo. Abrí Stock para revisarlo antes de crear nada.";
  }

  const details = [
    `- Material: ${String(extracted.material)}`,
    extracted.brand ? `- Marca: ${String(extracted.brand)}` : null,
    extracted.name ? `- Subtipo: ${String(extracted.name)}` : null,
    extracted.color ? `- Color: ${String(extracted.color)}` : null,
    `- Peso total: ${Number(extracted.totalGrams)}g${
      extracted.totalGramsAssumed === true ? " (asumido)" : ""
    }`,
  ].filter((detail): detail is string => Boolean(detail));

  return `Preparé este filamento nuevo:\n\n${details.join(
    "\n"
  )}\n\nAntes de crearlo necesito que confirmes. Todavía no hice cambios.`;
}

function buildCreatePrinterResponse(actionIntent: StampyActionIntent): string {
  const extracted = actionIntent.extracted;
  if (extracted.duplicateStatus === "active_duplicate") {
    return "Ya encontré una impresora parecida cargada. Para evitar duplicados, revisala desde Calculadora. Todavía no creé nada.";
  }
  if (extracted.duplicateStatus === "inactive_match") {
    return "Ya existe una impresora parecida, pero está inactiva. Por ahora Stampy no la reactiva automáticamente; abrí Calculadora para revisarla.";
  }
  if (extracted.duplicateStatus === "ambiguous") {
    return "Encontré varias impresoras parecidas y no puedo elegir una con seguridad. Abrí Calculadora para revisarlas.";
  }
  if (extracted.requiresConfirmation !== true) {
    return "No pude verificar con seguridad que la impresora sea nueva. Abrí Calculadora para revisarla antes de crear nada.";
  }

  const warnings = Array.isArray(extracted.validationWarnings)
    ? (extracted.validationWarnings as string[])
    : [];
  const warningText = warnings.length
    ? `\n\n${warnings.map((warning) => `- ${warning}`).join("\n")}`
    : "";
  return `Detecté una nueva impresora:\n\n- Nombre: ${String(
    extracted.printerName
  )}\n- Potencia: ${Number(extracted.powerWatts)}W\n- Mantenimiento/hora: $${Number(
    extracted.maintenanceCostPerHour
  )}${warningText}\n\nAntes de crearla necesito que confirmes. Todavía no hice cambios.`;
}

function buildCreateProductResponse(actionIntent: StampyActionIntent): string {
  const extracted = actionIntent.extracted;
  if (
    extracted.duplicateStatus === "duplicate" ||
    extracted.duplicateStatus === "ambiguous"
  ) {
    return "Ya encontré un producto parecido cargado. Para evitar duplicados, abrí Productos o Stock. Todavía no creé nada.";
  }
  if (extracted.requiresConfirmation !== true) {
    return "No pude verificar con seguridad que el producto sea nuevo. Abrí Productos para revisarlo antes de crear nada.";
  }

  const components = Array.isArray(extracted.components)
    ? (extracted.components as Array<Record<string, unknown>>)
    : [];
  const componentLines = components.map((component) => {
    const details = [
      component.material,
      component.brand,
      component.name,
      component.color,
    ].filter(Boolean);
    const suffix =
      component.matchStatus === "unique"
        ? ""
        : " (sin filamento exacto asociado)";
    return `- ${Number(component.grams)}g ${details.join(" ")}${suffix}`;
  });
  const recipeText = componentLines.length
    ? `\n- Receta:\n${componentLines.join("\n")}`
    : "\n- Receta: no indicada";
  const stockText =
    extracted.initialStock === null || extracted.initialStock === undefined
      ? "0 (no indicado)"
      : String(extracted.initialStock);
  const formatMinutes = (value: unknown) => {
    if (value === null || value === undefined || value === "") return "no indicado";
    const minutes = Number(value);
    if (!Number.isFinite(minutes)) return "no indicado";
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return [hours ? `${hours}h` : "", remainingMinutes ? `${remainingMinutes}m` : ""]
      .filter(Boolean)
      .join(" ") || "0m";
  };
  const formatMoney = (value: unknown) => {
    if (value === null || value === undefined || value === "") return "no indicado";
    const amount = Number(value);
    return Number.isFinite(amount)
      ? `$${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(amount)}`
      : "no indicado";
  };
  const warnings = Array.isArray(extracted.validationWarnings)
    ? (extracted.validationWarnings as string[])
    : [];
  const warningText = warnings.length
    ? `\n\n${warnings.map((warning) => `- ${warning}`).join("\n")}`
    : "";

  return `Preparé este producto:\n\n- Producto: ${String(
    extracted.productName
  )}\n- Stock inicial: ${stockText}\n- Tiempo de impresión: ${formatMinutes(
    extracted.printTimeMinutes
  )}\n- Costo base: ${formatMoney(extracted.baseCost)}\n- Precio de venta: ${formatMoney(
    extracted.salePrice
  )}${recipeText}${warningText}\n\nAntes de crearlo necesito que confirmes. Todavía no hice cambios.`;
}

function buildProductFilamentDiscountResponse(
  actionIntent: StampyActionIntent
): string {
  const extracted = actionIntent.extracted;
  const blockers = Array.isArray(extracted.blockers)
    ? (extracted.blockers as Array<{ message?: string }>)
    : [];
  if (blockers.length > 0) {
    return blockers[0].message ??
      "No pude preparar el descuento con seguridad. Revisá las recetas desde Productos.";
  }
  if (extracted.requiresConfirmation !== true) {
    return "No pude verificar las recetas y el stock con seguridad. No modifiqué ningún filamento.";
  }
  return "Encontré las recetas y preparé el descuento. Revisá el resumen antes de confirmar. Esta acción no baja el stock de productos terminados.";
}

type AutoExecutionReason =
  | "user_setting_enabled"
  | "setting_disabled"
  | "ambiguous_target"
  | "validation_failed"
  | "unsupported_action"
  | "insufficient_stock"
  | "settings_unavailable"
  | "rpc_error";

interface AutoExecutionAudit {
  attempted: true;
  allowed: boolean;
  reason: AutoExecutionReason;
  executed?: boolean;
  errorCode?: string | null;
}

function isSupportedAutoExecutionAction(
  actionIntent: StampyActionIntent
): boolean {
  return (
    isFilamentMovementAction(actionIntent) ||
    isCreateFilamentAction(actionIntent) ||
    isCreatePrinterAction(actionIntent)
  );
}

async function resolveAutoExecutionAudit({
  supabase,
  userId,
  actionIntent,
  validation,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  actionIntent: StampyActionIntent;
  validation: StampyActionValidationResult;
}): Promise<AutoExecutionAudit> {
  if (!validation.isValid) {
    return { attempted: true, allowed: false, reason: "validation_failed" };
  }

  if (!isSupportedAutoExecutionAction(actionIntent)) {
    return { attempted: true, allowed: false, reason: "unsupported_action" };
  }

  if (isFilamentMovementAction(actionIntent)) {
    const resolvedTarget = actionIntent.extracted.resolvedTarget as
      | { id?: string; remainingGramsBefore?: number }
      | undefined;
    const grams = Number(actionIntent.extracted.grams);
    if (
      actionIntent.extracted.matchStatus !== "unique" ||
      actionIntent.extracted.requiresConfirmation !== true ||
      !resolvedTarget?.id ||
      !Number.isFinite(grams) ||
      grams <= 0
    ) {
      return { attempted: true, allowed: false, reason: "ambiguous_target" };
    }

    if (
      actionIntent.type === "discount_filament" &&
      Number(resolvedTarget.remainingGramsBefore) < grams
    ) {
      return { attempted: true, allowed: false, reason: "insufficient_stock" };
    }
  }

  if (
    (isCreateFilamentAction(actionIntent) ||
      isCreatePrinterAction(actionIntent)) &&
    (actionIntent.extracted.duplicateStatus !== "clear" ||
      actionIntent.extracted.requiresConfirmation !== true)
  ) {
    return { attempted: true, allowed: false, reason: "ambiguous_target" };
  }

  try {
    const {
      canAutoExecuteStampyAction,
      getStampyActionSettings,
    } = await import("@/lib/stampy/action-settings");
    const settingsResult = await getStampyActionSettings({
      supabase,
      userId,
    });
    if (settingsResult.error) {
      console.error(
        "[Stampy] action settings unavailable",
        settingsResult.error.substring(0, 200)
      );
      return {
        attempted: true,
        allowed: false,
        reason: "settings_unavailable",
      };
    }

    const allowed = canAutoExecuteStampyAction({
      settings: settingsResult.settings,
      actionType: actionIntent.type,
    });
    return {
      attempted: true,
      allowed,
      reason: allowed ? "user_setting_enabled" : "setting_disabled",
    };
  } catch (error) {
    console.error(
      "[Stampy] action settings unavailable",
      String(error).substring(0, 200)
    );
    return {
      attempted: true,
      allowed: false,
      reason: "settings_unavailable",
    };
  }
}

async function executeAutomaticStampyAction({
  supabase,
  actionRequestId,
  actionIntent,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  actionRequestId: string;
  actionIntent: StampyActionIntent;
}) {
  const {
    executeCreateFilament,
    executeCreatePrinter,
    executeFilamentStockMovement,
  } = await import("@/lib/stampy/action-executor");

  if (isFilamentMovementAction(actionIntent)) {
    return executeFilamentStockMovement({ supabase, actionRequestId });
  }
  if (isCreateFilamentAction(actionIntent)) {
    return executeCreateFilament({ supabase, actionRequestId });
  }
  if (isCreatePrinterAction(actionIntent)) {
    return executeCreatePrinter({ supabase, actionRequestId });
  }

  return {
    success: false,
    errorCode: "unsupported_action",
    message: "Esta acción no admite ejecución automática.",
  };
}

function buildAutoExecutionSuccessResponse(
  actionIntent: StampyActionIntent,
  result: {
    message: string;
    newRemainingGrams?: number | null;
    label?: string | null;
    remainingGrams?: number | null;
    printerName?: string | null;
  }
): string {
  if (isFilamentMovementAction(actionIntent)) {
    const target = actionIntent.extracted.resolvedTarget as
      | { label?: string }
      | undefined;
    const verb =
      actionIntent.type === "discount_filament" ? "desconté" : "sumé";
    const preposition =
      actionIntent.type === "discount_filament" ? "de" : "a";
    return `Listo, ${verb} ${Number(actionIntent.extracted.grams)}g ${
      target?.label ? `${preposition} ${target.label}` : "al filamento"
    }. Ahora te quedan ${Number(result.newRemainingGrams)}g.`;
  }

  if (isCreateFilamentAction(actionIntent)) {
    return `Listo, creé el filamento ${
      result.label ?? String(actionIntent.extracted.material)
    } con ${Number(result.remainingGrams)}g disponibles.`;
  }

  if (isCreatePrinterAction(actionIntent)) {
    return `Listo, creé la impresora ${
      result.printerName ?? String(actionIntent.extracted.printerName)
    }.`;
  }

  return result.message;
}

export async function askStampyAction(
  message: string,
  conversationId?: string | null,
  context?: StampyContextPayload
) {
  const startTime = Date.now();
  let actualConversationId = conversationId || null;
  let answerText = "No pude generar una respuesta.";
  let requestMode: "openai" | "direct" | "blocked" | "error" = "openai";
  const supabase = await createClient();
  let currentUserId: string | null = null;

  try {
    const { access } = await getCurrentUserAccess(supabase);
    const userId = access.userId;
    currentUserId = userId;

    if (!access.authenticated || !userId) {
      return { error: "No autorizado" };
    }

    if (!access.capabilities.useStampy) {
      return {
        answer: "Para usar Stampy necesitás tener una membresía activa.",
        recommendations: [],
        knowledgeTools: [],
        relatedTools: [],
        suggestedQuestions: [],
        conversationId: actualConversationId
      };
    }

    const messageValidation = validateStampyMessage(message);
    if (!messageValidation.valid) {
      return {
        error: messageValidation.error,
        answer: messageValidation.error,
        recommendations: [],
        knowledgeTools: [],
        relatedTools: [],
        suggestedQuestions: [],
        conversationId: actualConversationId,
        actionRequestId: null,
        actionIntent: null
      };
    }
    const userMessage = messageValidation.message;

    // Rate Limit Check
    const { checkStampyRateLimit } = await import("@/lib/stampy/rate-limit");
    const rateLimit = await checkStampyRateLimit({ supabase, userId });
    if (rateLimit.isBlocked) {
      const { logStampyUsage } = await import("@/lib/stampy/usage-log");
      await logStampyUsage({
        supabase,
        userId,
        conversationId: actualConversationId,
        model: null,
        mode: "blocked",
        status: "blocked",
        messageChars: userMessage.length,
      });

      return {
        answer: "Llegaste al límite temporal de mensajes de Stampy. Probá de nuevo más tarde.",
        recommendations: [],
        knowledgeTools: [],
        relatedTools: [],
        suggestedQuestions: [],
        conversationId: actualConversationId
      };
    }

    // Ensure Conversation
    const { ensureConversation, getRecentHistory, saveMessages } = await import("@/lib/stampy/history");
    const ensuredId = await ensureConversation({
      supabase,
      userId,
      conversationId: actualConversationId,
      message: userMessage
    });
    if (ensuredId) {
      actualConversationId = ensuredId;
    }

    const pathname = context?.pathname;
    const { detectStampyActionIntent, buildActionIntentResponse } = await import("@/lib/stampy/action-intents");
    const actionIntent = detectStampyActionIntent({
      message: userMessage,
      currentPath: pathname
    });

    if (actionIntent) {
      const { getStampyToolContractsForIntent } = await import("@/lib/stampy/tool-registry");
      const { validateStampyActionIntent } = await import("@/lib/stampy/action-validator");
      const toolContract = getStampyToolContractsForIntent(actionIntent.type)[0] ?? null;
      const validation = validateStampyActionIntent({ actionIntent, toolContract });
      let validatedActionIntent: StampyActionIntent = {
        ...actionIntent,
        extracted: validation.normalizedExtracted,
        toolHref: validation.isValid ? actionIntent.toolHref : undefined,
        toolLabel: validation.isValid ? actionIntent.toolLabel : undefined,
        canExecute: false,
      };
      const validationMetadata = {
        isValid: validation.isValid,
        missingFields: validation.missingFields,
        invalidFields: validation.invalidFields,
        warnings: validation.warnings,
      };

      if (validation.isValid && isFilamentMovementAction(validatedActionIntent)) {
        try {
          const { getResolvedFilamentLabel, resolveFilamentMatch } = await import(
            "@/lib/stampy/action-executor"
          );
          const filamentMatch = await resolveFilamentMatch({
            supabase,
            userId,
            extracted: validation.normalizedExtracted,
          });

          if (filamentMatch.error) {
            console.error("[Stampy] filament match failed", filamentMatch.error);
          }

          if (filamentMatch.status === "unique" && filamentMatch.filament) {
            validatedActionIntent = {
              ...validatedActionIntent,
              extracted: {
                ...validatedActionIntent.extracted,
                matchStatus: "unique",
                requiresConfirmation: true,
                resolvedTarget: {
                  type: "filament",
                  id: filamentMatch.filament.id,
                  label: getResolvedFilamentLabel(filamentMatch.filament),
                  remainingGramsBefore: filamentMatch.filament.remaining_grams,
                },
              },
            };
          } else {
            validatedActionIntent = {
              ...validatedActionIntent,
              extracted: {
                ...validatedActionIntent.extracted,
                matchStatus: filamentMatch.status,
                requiresConfirmation: false,
              },
            };
          }
        } catch (error) {
          console.error(
            "[Stampy] filament match failed",
            String(error).substring(0, 200)
          );
          validatedActionIntent = {
            ...validatedActionIntent,
            extracted: {
              ...validatedActionIntent.extracted,
              matchStatus: "none",
              requiresConfirmation: false,
            },
          };
        }
      }

      if (
        validation.isValid &&
        isProductFilamentDiscountAction(validatedActionIntent)
      ) {
        try {
          const { prepareProductFilamentDiscount } = await import(
            "@/lib/stampy/action-executor"
          );
          const preparation = await prepareProductFilamentDiscount({
            supabase,
            userId,
            items: validation.normalizedExtracted.items as Array<{
              productName: string;
              quantity: number;
            }>,
          });
          validatedActionIntent = {
            ...validatedActionIntent,
            extracted: {
              ...validatedActionIntent.extracted,
              actionType: "discount_product_filaments",
              resolvedProducts: preparation.products,
              consumptions: preparation.consumptions,
              blockers: preparation.blockers,
              warnings: preparation.warnings,
              requiresConfirmation: preparation.blockers.length === 0,
            },
          };
        } catch (error) {
          console.error(
            "[Stampy] product filament discount preparation failed",
            String(error).substring(0, 200)
          );
          validatedActionIntent = {
            ...validatedActionIntent,
            extracted: {
              ...validatedActionIntent.extracted,
              actionType: "discount_product_filaments",
              resolvedProducts: [],
              consumptions: [],
              blockers: [
                {
                  code: "preparation_failed",
                  message:
                    "No pude verificar las recetas y el stock. No modifiqué ningún filamento.",
                },
              ],
              warnings: validation.warnings,
              requiresConfirmation: false,
            },
          };
        }
      }

      if (validation.isValid && isCreateFilamentAction(validatedActionIntent)) {
        try {
          const { findDuplicateActiveFilament, getResolvedFilamentLabel } =
            await import("@/lib/stampy/action-executor");
          const duplicateCheck = await findDuplicateActiveFilament({
            supabase,
            userId,
            extracted: validation.normalizedExtracted,
          });

          if (duplicateCheck.status === "error") {
            console.error(
              "[Stampy] duplicate filament check failed",
              duplicateCheck.error?.substring(0, 200)
            );
          }

          validatedActionIntent = {
            ...validatedActionIntent,
            extracted: {
              ...validatedActionIntent.extracted,
              actionType: "add_filament",
              duplicateStatus: duplicateCheck.status,
              requiresConfirmation: duplicateCheck.status === "clear",
              ...(duplicateCheck.filament
                ? {
                    duplicateTarget: {
                      type: "filament",
                      id: duplicateCheck.filament.id,
                      label: getResolvedFilamentLabel(duplicateCheck.filament),
                    },
                  }
                : {}),
            },
          };
        } catch (error) {
          console.error(
            "[Stampy] duplicate filament check failed",
            String(error).substring(0, 200)
          );
          validatedActionIntent = {
            ...validatedActionIntent,
            extracted: {
              ...validatedActionIntent.extracted,
              actionType: "add_filament",
              duplicateStatus: "error",
              requiresConfirmation: false,
            },
          };
        }
      }

      if (validation.isValid && isCreatePrinterAction(validatedActionIntent)) {
        try {
          const { findDuplicatePrinter } = await import(
            "@/lib/stampy/action-executor"
          );
          const duplicateCheck = await findDuplicatePrinter({
            supabase,
            userId,
            printerName: String(validation.normalizedExtracted.printerName),
          });

          if (duplicateCheck.status === "error") {
            console.error(
              "[Stampy] duplicate printer check failed",
              duplicateCheck.error?.substring(0, 200)
            );
          }

          validatedActionIntent = {
            ...validatedActionIntent,
            extracted: {
              ...validatedActionIntent.extracted,
              actionType: "add_printer",
              duplicateStatus: duplicateCheck.status,
              requiresConfirmation: duplicateCheck.status === "clear",
              validationWarnings: validation.warnings,
              ...(duplicateCheck.printer
                ? {
                    duplicateTarget: {
                      type: "printer",
                      id: duplicateCheck.printer.id,
                      label: duplicateCheck.printer.name,
                      isActive: duplicateCheck.printer.is_active,
                    },
                  }
                : {}),
            },
          };
        } catch (error) {
          console.error(
            "[Stampy] duplicate printer check failed",
            String(error).substring(0, 200)
          );
          validatedActionIntent = {
            ...validatedActionIntent,
            extracted: {
              ...validatedActionIntent.extracted,
              actionType: "add_printer",
              duplicateStatus: "error",
              requiresConfirmation: false,
              validationWarnings: validation.warnings,
            },
          };
        }
      }

      if (validation.isValid && isCreateProductAction(validatedActionIntent)) {
        try {
          const { findDuplicateProduct, resolveProductFilamentComponents } =
            await import("@/lib/stampy/action-executor");
          const duplicateCheck = await findDuplicateProduct({
            supabase,
            userId,
            productName: String(validation.normalizedExtracted.productName),
          });
          const rawComponents = Array.isArray(
            validation.normalizedExtracted.components
          )
            ? (validation.normalizedExtracted.components as Array<
                Record<string, unknown>
              >)
            : [];
          const componentResolution =
            duplicateCheck.status === "clear" && rawComponents.length > 0
              ? await resolveProductFilamentComponents({
                  supabase,
                  userId,
                  components: rawComponents,
                })
              : {
                  components: rawComponents,
                  unmatchedCount: rawComponents.length,
                  errors: [] as string[],
                };

          if (duplicateCheck.status === "error") {
            console.error(
              "[Stampy] duplicate product check failed",
              duplicateCheck.error?.substring(0, 200)
            );
          }
          if (componentResolution.errors.length > 0) {
            console.error(
              "[Stampy] product component match failed",
              componentResolution.errors[0].substring(0, 200)
            );
          }
          if (componentResolution.unmatchedCount > 0) {
            validationMetadata.warnings.push(
              `${componentResolution.unmatchedCount} componente(s) se guardarán sin filamento exacto asociado.`
            );
          }

          validatedActionIntent = {
            ...validatedActionIntent,
            extracted: {
              ...validatedActionIntent.extracted,
              actionType: "create_product",
              components: componentResolution.components,
              unmatchedComponentsCount: componentResolution.unmatchedCount,
              duplicateStatus: duplicateCheck.status,
              requiresConfirmation: duplicateCheck.status === "clear",
              validationWarnings: validationMetadata.warnings,
              ...(duplicateCheck.product
                ? {
                    duplicateTarget: {
                      type: "product",
                      id: duplicateCheck.product.id,
                      label: duplicateCheck.product.name,
                    },
                  }
                : {}),
            },
          };
        } catch (error) {
          console.error(
            "[Stampy] product preparation failed",
            String(error).substring(0, 200)
          );
          validatedActionIntent = {
            ...validatedActionIntent,
            extracted: {
              ...validatedActionIntent.extracted,
              actionType: "create_product",
              duplicateStatus: "error",
              requiresConfirmation: false,
              validationWarnings: validationMetadata.warnings,
            },
          };
        }
      }

      let autoExecution = await resolveAutoExecutionAudit({
        supabase,
        userId,
        actionIntent: validatedActionIntent,
        validation,
      });
      if (autoExecution.reason === "insufficient_stock") {
        validatedActionIntent = {
          ...validatedActionIntent,
          extracted: {
            ...validatedActionIntent.extracted,
            requiresConfirmation: false,
          },
        };
      }
      validatedActionIntent = {
        ...validatedActionIntent,
        extracted: {
          ...validatedActionIntent.extracted,
          autoExecution,
        },
      };

      requestMode = "direct";
      answerText = autoExecution.reason === "insufficient_stock"
        ? "No hay suficientes gramos disponibles para hacer ese descuento. No modifiqué tu stock; revisalo desde Stock."
        : validation.isValid
        ? isFilamentMovementAction(validatedActionIntent)
          ? buildFilamentMovementResponse(validatedActionIntent)
          : isCreateFilamentAction(validatedActionIntent)
            ? buildCreateFilamentResponse(validatedActionIntent)
            : isCreatePrinterAction(validatedActionIntent)
              ? buildCreatePrinterResponse(validatedActionIntent)
              : isCreateProductAction(validatedActionIntent)
                ? buildCreateProductResponse(validatedActionIntent)
                : isProductFilamentDiscountAction(validatedActionIntent)
                  ? buildProductFilamentDiscountResponse(validatedActionIntent)
          : buildActionIntentResponse(validatedActionIntent)
        : buildActionValidationResponse(validatedActionIntent, validation);
      const knowledgeTools = validation.isValid && validatedActionIntent.toolHref && validatedActionIntent.toolLabel
        ? [{
            title: `Abrir ${validatedActionIntent.toolLabel}`,
            route: validatedActionIntent.toolHref,
            shortDescription: "Revisá los datos y confirmá la acción desde la herramienta."
          }]
        : [];

      let assistantMessageId: string | null = null;
      let actionRequestId: string | null = null;
      if (actualConversationId) {
        const saved = await saveMessages(
          supabase,
          userId,
          actualConversationId,
          userMessage,
          answerText,
          {
            mode: requestMode,
            model: null,
            relatedToolsCount: knowledgeTools.length,
            recommendationsCount: 0,
            actionIntent: validatedActionIntent,
            validation: validationMetadata,
            memory: { loadedCount: 0, savedCount: 0 },
          }
        );
        assistantMessageId = saved?.assistantMessageId || null;

        if (assistantMessageId && validation.isValid) {
          const { createStampyActionRequest } = await import("@/lib/stampy/action-requests");
          const result = await createStampyActionRequest({
            userId,
            conversationId: actualConversationId,
            messageId: assistantMessageId,
            actionIntent: validatedActionIntent,
            source: context?.source || "stampy"
          });
          actionRequestId = result.actionRequestId;

          if (actionRequestId) {
            if (autoExecution.allowed) {
              const executionResult = await executeAutomaticStampyAction({
                supabase,
                actionRequestId,
                actionIntent: validatedActionIntent,
              });
              autoExecution = executionResult.success
                ? {
                    ...autoExecution,
                    executed: true,
                    errorCode: null,
                  }
                : {
                    attempted: true,
                    allowed: false,
                    reason: "rpc_error",
                    executed: false,
                    errorCode: executionResult.errorCode,
                  };
              validatedActionIntent = {
                ...validatedActionIntent,
                extracted: {
                  ...validatedActionIntent.extracted,
                  autoExecution,
                  ...(executionResult.success
                    ? { requiresConfirmation: false }
                    : {}),
                },
              };

              if (executionResult.success) {
                answerText = buildAutoExecutionSuccessResponse(
                  validatedActionIntent,
                  executionResult
                );
              } else {
                answerText = `${executionResult.message} No hice cambios automáticamente; podés revisar y confirmar la acción manualmente.`;
              }

              await supabase
                .from("stampy_action_requests")
                .update({ extracted: validatedActionIntent.extracted })
                .eq("id", actionRequestId)
                .eq("user_id", userId);
            }

            await supabase
              .from("stampy_messages")
              .update({
                content: answerText,
                metadata: {
                  mode: requestMode,
                  model: null,
                  actionIntent: validatedActionIntent,
                  actionRequestId,
                  validation: validationMetadata,
                  memory: { loadedCount: 0, savedCount: 0 },
                }
              })
              .eq("id", assistantMessageId);
          }
        }

        const { logStampyUsage } = await import("@/lib/stampy/usage-log");
        await logStampyUsage({
          supabase,
          userId,
          conversationId: actualConversationId,
          model: null,
          mode: requestMode,
          status: "success",
          messageChars: userMessage.length,
          promptChars: 0,
          completionChars: answerText.length,
          latencyMs: Date.now() - startTime
        });
      }

      return {
        answer: answerText,
        recommendations: [],
        knowledgeTools,
        relatedTools: [],
        suggestedQuestions: [],
        conversationId: actualConversationId,
        assistantMessageId,
        actionRequestId,
        actionIntent: validatedActionIntent,
        validation: validationMetadata,
      };
    }

    let loadedMemoryCount = 0;
    let memoryPromptText = "";
    try {
      const { loadRelevantMemory } = await import("@/lib/stampy/user-memory");
      const relevantMemory = await loadRelevantMemory({
        supabase,
        userId,
        query: userMessage,
        limit: 10,
      });

      if (relevantMemory.error) {
        console.error("[Stampy] memory load failed", relevantMemory.error);
      } else {
        loadedMemoryCount = relevantMemory.memories.length;
        memoryPromptText = relevantMemory.promptText;
      }
    } catch (error) {
      console.error("[Stampy] memory load failed", String(error).substring(0, 200));
    }

    const { OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    // 0. Contexto del taller del usuario (Solo Lectura)
    const { getStampyWorkshopContext } = await import("@/lib/stampy/workshop-context");
    const workshopContext = await getStampyWorkshopContext({
      supabase,
      userId,
      message: userMessage
    });

    if (userMessage === "/debug taller" && process.env.NODE_ENV !== "production") {
      const debugText = `DEBUG CONTEXTO TALLER\n\nuserId: ${userId}\n\nprintersCount: ${workshopContext.printersCount}\nactiveFilamentsCount: ${workshopContext.filamentsCount}\nactiveFilamentsError: ${workshopContext.activeFilamentsErrorMsg}\nproductsCount: ${workshopContext.productsCount}\n\nFilamentos activos sample:\n${workshopContext.sampleFilaments}\n\nContexto final:\n${workshopContext.text}`;
      
      return {
        answer: debugText,
        recommendations: [],
        knowledgeTools: [],
        relatedTools: [],
        suggestedQuestions: []
      };
    }

    // 2. Fetch new dynamic contexts
    const { getStampyRelevantContexts } = await import("@/lib/stampy/context-search");
    const dynamicContextData = await getStampyRelevantContexts({
      supabase,
      message: userMessage,
      currentPath: pathname,
      lessonId: context?.source === "lesson" ? context.lessonId : undefined,
    });

    if (dynamicContextData.contextsCount > 0) {
      // (context logs removed)
    }

    // 3. Buscar contexto estático de forma segura (ignorar si falla y usar solo si no hay match dinámico exacto de mayor prioridad)
    let staticContext = null;
    if (pathname && dynamicContextData.contextsCount === 0) {
      try {
        const { getStaticStampyPageContext } = await import("@/lib/stampy/static-page-contexts");
        staticContext = getStaticStampyPageContext(pathname);
      } catch (e) {
        console.error("[Stampy] No se pudo cargar el contexto estático", e);
      }
    }

    // 4. Preparar system prompt
    let systemPrompt = "Sos Stampy, el asistente de Academia Stampa. Respondé breve, práctico y en español argentino.\n";
    
    if (dynamicContextData.text) {
      systemPrompt += `\n${dynamicContextData.text}\n`;
    }

    if (staticContext) {
      systemPrompt += `\nContexto de la pantalla actual:
- Sección: ${staticContext.title}
- ${staticContext.context}
Usá este contexto para responder mejor, pero no lo menciones explícitamente.

Reglas:
- No digas "según el contexto de la ruta".
- Si el usuario pregunta algo fuera de esta sección, respondé normal orientando a la ruta correcta.\n`;
    }

    systemPrompt += `\nRegla sobre contenido de la Academia:
Si el usuario pregunta por clases específicas o contenido de la academia y no hay chunks suficientes devueltos en tu contexto, debés ser prudente. 
Podés decir algo como "Todavía no tengo contenido cargado suficiente de esa clase. Puedo orientarte de forma general o indicarte dónde verlo cuando esté disponible".
No inventes que existe una clase completa o contenidos si solo tenés el título.\n`;

    // 4. Buscar contexto del usuario de forma segura
    let userContext = null;
    try {
      const { getStampyUserContext } = await import("@/lib/stampy/user-context");
      userContext = await getStampyUserContext(userId);
    } catch (e) {
      console.error("[Stampy] user context failed", e);
    }

    if (userContext) {
      systemPrompt += `\nDatos del usuario:
- Nombre: ${userContext.displayName || 'No especificado'}
- Nivel: ${userContext.experienceLevelLabel || 'No especificado'}
- Impresora principal: ${userContext.printerLabel || 'No especificada'}
- Slicer: ${userContext.slicerLabel || 'No especificado'}
- Objetivo: ${userContext.mainGoalLabel || 'No especificado'}
- Etapa comercial: ${userContext.commercialStageLabel || 'No especificada'}
- Código de referido: ${userContext.referralCode || 'No generado'}
- Estado de membresía: ${userContext.membershipStatusLabel || 'No activa'}`;
      if (userContext.memberLevelLabel) {
         systemPrompt += ` (${userContext.memberLevelLabel})`;
      }
      
      systemPrompt += `

Reglas del usuario:
- Usá estos datos solo para adaptar la respuesta.
- No los repitas todos salvo que el usuario pregunte.
- No digas "según tu perfil" en cada respuesta.
- Si falta onboarding, podés sugerir completar el perfil/configuración.
- No menciones datos internos.\n`;
    }

    if (pathname && pathname.startsWith("/sorteos")) {
      let rafflesContext = null;
      try {
        const { getStampyRafflesContext } = await import("@/lib/stampy/tool-contexts/raffles-context");
        rafflesContext = await getStampyRafflesContext(userId);
      } catch (error) {
        console.error("[Stampy] raffles context failed", error);
      }

      if (rafflesContext) {
        systemPrompt += `\n\nContexto real de sorteos del usuario:
- Código de referido: ${rafflesContext.referralCode || 'No tiene'}
- Participaciones base: ${rafflesContext.baseEntries}
- Participaciones extra: ${rafflesContext.bonusEntries}
- Participaciones totales: ${rafflesContext.totalEntries}
- Referidos pendientes: ${rafflesContext.pendingReferrals}
- Referidos convertidos: ${rafflesContext.convertedReferrals}
- Sorteo activo: ${rafflesContext.activeRaffle?.title || 'Ninguno'}

Reglas:
- Usá estos datos solo si el usuario pregunta por sorteos, chances, participaciones o referidos.
- No recites todos los números si no hace falta.
- Si pregunta cómo sumar chances, mencioná su código de referido.
- No prometas premios ni resultados.
- No digas que ganó si no hay dato real.\n`;
      }
    }

    if (pathname && pathname.startsWith("/stock")) {
      let stockContext = null;
      try {
        const { getStampyStockContext } = await import("@/lib/stampy/tool-contexts/stock-context");
        stockContext = await getStampyStockContext(userId, userMessage);
      } catch (error) {
        console.error("[Stampy] stock context failed", error);
      }

      if (stockContext) {
        if (stockContext.specificFilamentQuery) {
          const q = stockContext.specificFilamentQuery;
          systemPrompt += `\n\nConsulta específica de filamento detectada:
- Material detectado: ${q.detectedMaterial || 'Cualquiera'}
- Color detectado: ${q.detectedColor || 'Cualquiera'}
- Filamentos encontrados:
${q.matches.length > 0 ? q.matches.map(m => `  - ${m.name}: ${m.remainingGrams} g disponibles`).join('\n') : '  No encontré filamentos activos que coincidan.'}
- Total disponible: ${q.totalRemainingGrams} g

Reglas:
- Si el usuario pregunta "cuántos gramos", responder con cantidades.
- Si hay varios filamentos, listar cada uno y el total.
- Si no hay coincidencias, decir que no encontraste filamentos que coincidan con ese material/color.
- No responder solo con resumen de stock bajo si hay una consulta específica.
- No mencionar HEX.
- Si el usuario quiere modificar stock, explicale dónde hacerlo.\n`;
        } else if (stockContext.totalFilaments === 0 && stockContext.totalProducts === 0) {
          systemPrompt += `\n\nContexto real de stock del usuario:
El usuario todavía no tiene filamentos ni productos cargados en su stock.`;
        } else {
          systemPrompt += `\n\nContexto real de stock del usuario:
- Filamentos activos: ${stockContext.totalFilaments}
- Filamentos bajos: ${stockContext.lowStockFilaments.length > 0 ? stockContext.lowStockFilaments.map(f => f.name).join(', ') : 'Ninguno'}
- Filamentos vacíos: ${stockContext.emptyFilaments.length > 0 ? stockContext.emptyFilaments.map(f => f.name).join(', ') : 'Ninguno'}
- Productos activos: ${stockContext.totalProducts}
- Productos sin stock: ${stockContext.outOfStockProducts.length > 0 ? stockContext.outOfStockProducts.map(p => p.name).join(', ') : 'Ninguno'}
- Productos con stock bajo: ${stockContext.lowStockProducts.length > 0 ? stockContext.lowStockProducts.map(p => p.name).join(', ') : 'Ninguno'}`;

          if (stockContext.lowMarginProducts && stockContext.lowMarginProducts.length > 0) {
            systemPrompt += `\n- Productos con margen bajo: ${stockContext.lowMarginProducts.map(p => p.name).join(', ')}`;
          }
          if (stockContext.recentMovements && stockContext.recentMovements.length > 0) {
            systemPrompt += `\n- Últimos movimientos: ${stockContext.recentMovements.map(m => m.label).join(' | ')}`;
          }
          
          systemPrompt += `\n\nReglas:
- Usá estos datos solo si el usuario pregunta por stock, filamentos, productos, faltantes, reposición o movimientos.
- No recites todos los datos si no hace falta.
- Priorizá alertas accionables.
- No digas que descontaste stock.
- Si el usuario quiere modificar stock, explicale dónde hacerlo.
- Si no hay datos, sugerí cargarlos.\n`;
        }
      }
    }

    systemPrompt += `\n\nDATOS DEL USUARIO Y TALLER:
${workshopContext.text}

Reglas del taller:
- Estos datos son solo lectura.
- No digas "no tengo acceso" si el dato está en este bloque.
- Si el dato no está disponible, decilo naturalmente.
- No inventes stock, impresoras ni productos fuera del contexto.
- Podés usar este contexto para responder preguntas sobre impresoras cargadas, filamentos disponibles, stock aproximado, productos cargados y configuración general.

No podés todavía:
- crear datos
- editar datos
- descontar stock
- crear presupuestos
- ejecutar acciones

Si el usuario pide una acción:
- explicá brevemente que por ahora podés orientarlo
- mandalo a la herramienta correspondiente
- no digas que lo hiciste\n`;

    if (memoryPromptText) {
      systemPrompt += `\n\n${memoryPromptText}\n`;
    }

    systemPrompt += `\nReglas generales:
- Respuestas MUY breves y prácticas.
- No inventes datos.
- No modifiques datos reales, solo orientá sobre cómo hacerlo.
- Cuando el usuario pregunte por filamentos, materiales o tipos como PLA/PETG/TPU, usá exclusivamente el contexto de filamentos. No interpretes esos términos como productos. Si recomendás una herramienta, mandá a Stock de filamentos, no a Stock de productos.
- Podés usar el historial reciente de esta conversación para mantener continuidad. No inventes datos permanentes del usuario si no aparecen en el perfil, el taller o el historial reciente. Si el usuario cambia de tema, adaptate al nuevo tema.
- REGLA CRÍTICA PARA PRESUPUESTOS Y CÁLCULOS: Cuando el usuario pida presupuestos o cálculos de precio, no inventes importes, tarifas, costos, márgenes ni totales. Si no estás usando una herramienta real que calcule, derivá al usuario a Presupuestos o Calculadora. Si el usuario pide crear un presupuesto, no uses datos de impresión anteriores salvo que diga explícitamente 'con esos datos', 'con lo anterior' o similar.`;

    // 5. Buscar herramientas de conocimiento
    const { findRelevantKnowledge } = await import("@/lib/stampy/knowledge-search");
    let knowledgeTools = findRelevantKnowledge(userMessage);

    // Ajustar herramientas según intent
    if (workshopContext.isFilamentQuery) {
      knowledgeTools = knowledgeTools.filter((tool) => tool.id !== "finished-product-stock" && tool.id !== "products");
    } else if (workshopContext.isProductQuery) {
      knowledgeTools = knowledgeTools.filter((tool) => tool.id !== "filament-stock");
    }


    // Cargar historial reciente
    const recentHistory = actualConversationId ? await getRecentHistory(supabase, actualConversationId, userId) : [];

    const lessonId = context?.source === "lesson" ? context.lessonId : undefined;
    let transcriptContextText = "";
    if (lessonId) {
      const { getLessonTranscriptContext } = await import("@/lib/stampy/lesson-transcripts");
      const transcriptData = await getLessonTranscriptContext({
        supabase,
        lessonId,
        message: userMessage,
      });

      // (transcript logs removed)

      if (transcriptData.transcriptFound) {
        transcriptContextText = `\n\n${transcriptData.text}\n\nRegla sobre la transcripción:\nTengo acceso a una transcripción de la clase actual. Usala como fuente principal para responder preguntas sobre esta clase. No digas que viste el video; decí que según la clase o según el contenido de la clase. Si la transcripción no contiene la respuesta, aclaralo y luego podés orientar con conocimiento general.`;
      }
    }

    if (transcriptContextText) {
      systemPrompt += transcriptContextText;
    }

    const { retrieveStampyKnowledge } = await import("@/lib/stampy/retrieval");
    const retrievedKnowledge = await retrieveStampyKnowledge({
      supabase,
      query: userMessage,
      courseId: context?.source === "lesson" ? context.courseId : undefined,
      lessonId,
      currentPath: pathname,
      maxChunks: 8,
    });

    if (retrievedKnowledge) {
      systemPrompt += `\n\n${retrievedKnowledge}`;
    }

    // 5.5 Inyectar Tool Contracts según la ruta actual
    if (pathname) {
      const { getRelevantContractsForPath, formatToolContractForPrompt } = await import("@/lib/stampy/tool-registry");
      const relevantContracts = getRelevantContractsForPath(pathname);
      if (relevantContracts.length > 0) {
        systemPrompt += `\n\nCONTRATOS DE HERRAMIENTAS (REGLAS ESTRICTAS):
Al estar en esta ruta, debés respetar cómo funcionan estas herramientas reales. Si el usuario te pide hacer algo relacionado a esto, seguí estas reglas:
${relevantContracts.map(formatToolContractForPrompt).join("\n\n")}\n`;
      }
    }

    const messagesPayload: ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...recentHistory,
      { role: "user", content: userMessage }
    ];

    const modelName = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const completion = await openai.chat.completions.create({
      model: modelName,
      messages: messagesPayload
    });

    answerText = completion.choices[0]?.message?.content || "No pude generar una respuesta.";
    // 6. Buscar lecciones recomendables (búsqueda textual simple)
    const { data: rawLessons } = await supabase
      .from('lessons')
      .select(`
        id,
        title,
        description,
        is_published,
        is_ai_recommendable,
        ai_summary,
        ai_topics,
        ai_problems,
        ai_level,
        course_modules!inner (
          id,
          is_active,
          courses!inner (
            id,
            slug,
            title,
            status,
            course_kind
          )
        )
      `)
      .eq('is_ai_recommendable', true)
      .eq('is_published', true)
      .eq('course_modules.is_active', true)
      .eq('course_modules.courses.status', 'published');

    let recommendations: unknown[] = [];
    if (rawLessons && rawLessons.length > 0) {
      const normalize = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      const q = normalize(userMessage);
      
      const scored = rawLessons.map(l => {
        let score = 0;
        const kwds = [l.title, l.ai_summary, l.ai_topics, l.ai_problems].filter(Boolean).join(" ");
        if (normalize(kwds).includes(q)) score += 5;
        // Simple fallback
        if (score === 0) {
           const words = q.split(/\s+/).filter(w => w.length > 3);
           words.forEach(w => {
             if (normalize(kwds).includes(w)) score += 1;
           });
        }
        return {
          ...l,
          score,
          courseKind: (
            l.course_modules as {
              courses?: { course_kind?: string | null };
            } | null
          )?.courses?.course_kind,
        };
      }).filter(l => l.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
      
      recommendations = scored;
    }

    let assistantMessageId: string | null = null;
    let savedMemoryCount = 0;
    if (actualConversationId) {
      const assistantMetadata = {
        mode: requestMode,
        model: modelName,
        relatedToolsCount: knowledgeTools.length,
        recommendationsCount: recommendations.length,
        actionIntent: null,
        memory: { loadedCount: loadedMemoryCount, savedCount: 0 },
      };
      const saved = await saveMessages(
        supabase, 
        userId,
        actualConversationId, 
        userMessage,
        answerText, 
        assistantMetadata
      );
      assistantMessageId = saved?.assistantMessageId || null;

      if (saved?.userMessageId) {
        try {
          const { saveUserMemory } = await import("@/lib/stampy/user-memory");
          const memorySaveResult = await saveUserMemory({
            supabase,
            userId,
            sourceMessageId: saved.userMessageId,
            message: userMessage,
          });
          savedMemoryCount = memorySaveResult.savedCount;

          if (memorySaveResult.errors.length > 0) {
            console.error("[Stampy] memory save failed", {
              count: memorySaveResult.errors.length,
              error: memorySaveResult.errors[0]?.substring(0, 200),
            });
          }
        } catch (error) {
          console.error("[Stampy] memory save failed", String(error).substring(0, 200));
        }

        if (assistantMessageId && savedMemoryCount > 0) {
          try {
            const { error: metadataError } = await supabase
              .from("stampy_messages")
              .update({
                metadata: {
                  ...assistantMetadata,
                  memory: {
                    loadedCount: loadedMemoryCount,
                    savedCount: savedMemoryCount,
                  },
                },
              })
              .eq("id", assistantMessageId);

            if (metadataError) {
              console.error("[Stampy] memory metadata update failed", metadataError.message);
            }
          } catch (error) {
            console.error(
              "[Stampy] memory metadata update failed",
              String(error).substring(0, 200)
            );
          }
        }
      }

      const { logStampyUsage } = await import("@/lib/stampy/usage-log");
      await logStampyUsage({
        supabase,
        userId,
        conversationId: actualConversationId,
        model: modelName,
        mode: requestMode,
        status: "success",
        messageChars: userMessage.length,
        promptChars: systemPrompt.length + recentHistory.reduce((total, historyMessage) => total + historyMessage.content.length, 0),
        completionChars: answerText.length,
        latencyMs: Date.now() - startTime
      });
    }

    // (request log removed)

    return {
      answer: answerText,
      recommendations,
      knowledgeTools,
      relatedTools: [],
      suggestedQuestions: staticContext?.suggestedQuestions || [],
      conversationId: actualConversationId,
      assistantMessageId,
      actionRequestId: null,
      actionIntent: null
    };
  } catch (error) {
    console.error("[Stampy] OpenAI request failed", {
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      error
    });

    if (actualConversationId && currentUserId) {
      const { logStampyUsage } = await import("@/lib/stampy/usage-log");
      await logStampyUsage({
        supabase,
        userId: currentUserId,
        conversationId: actualConversationId,
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        mode: "error",
        status: "error",
        messageChars: message.length,
        errorMessage: String(error).substring(0, 500),
        latencyMs: Date.now() - startTime
      });
    }

    return {
      answer: "No pude conectarme con Stampy en este momento. Revisá la configuración de OpenAI.",
      recommendations: [],
      knowledgeTools: [],
      relatedTools: [],
      suggestedQuestions: [],
      conversationId: actualConversationId,
      actionRequestId: null,
      actionIntent: null
    };
  }
}
