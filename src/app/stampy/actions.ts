"use server";

import { createClient } from "@/utils/supabase/server";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { validateStampyMessage } from "@/lib/stampy/message-policy";
import type { StampyActionIntent } from "@/lib/stampy/types";
import type { StampyActionValidationResult } from "@/lib/stampy/action-validator";
import type { StampyLessonRecommendation } from "@/lib/stampy/lesson-recommendations";
import type { StampyScreenContext } from "@/lib/stampy/screen-context";

type StampyRequestScreenContext = {
  screenContext?: StampyScreenContext;
};

export type StampyContextPayload = (
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
    }
) & StampyRequestScreenContext;

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

function shouldTryScreenAnalysis(message: string, section?: string | null): boolean {
  const text = cleanText(message);
  if (section === "calculator") {
    return /caro|costo|pesa|ganancia|gano|margen|cobrando|precio|cambiarias|ajustarias|mejorarias|agrego|agrega|sumo|suma|subo|subi|anado/.test(text);
  }
  if (section === "budgets") {
    return /cobrando|cobrar|total|desglos|ganancia|gano|margen|barato|caro|descuento|iva|impuesto|envio|cargo|adicional|falta|incompleto|cambiarias|ajustarias|mejorarias|como queda ahora/.test(text);
  }
  return false;
}

function logStampyPromptAudit({
  pathname,
  dynamicContextData,
  staticContext,
  screenContextPrompt,
  profilePrinter,
  workshopContextText,
  history,
  loadedMemoryCount,
  knowledgeToolIds,
  toolContractIds,
  retrievedKnowledgeChars,
  systemPromptChars,
}: {
  pathname?: string | null;
  dynamicContextData: {
    text: string;
    contexts: Array<{ title?: unknown; route?: unknown; score?: unknown }>;
  };
  staticContext: { title: string; context: string } | null;
  screenContextPrompt: string;
  profilePrinter?: string;
  workshopContextText: string;
  history: Array<{ role: string; content: string }>;
  loadedMemoryCount: number;
  knowledgeToolIds: string[];
  toolContractIds: string[];
  retrievedKnowledgeChars: number;
  systemPromptChars: number;
}) {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.STAMPY_DEBUG_PROMPT !== "true"
  ) {
    return;
  }

  const workshopPrinterLines = workshopContextText
    .split("\n")
    .filter((line) => /impresora/i.test(line))
    .slice(0, 5);

  console.log("[Stampy Prompt Audit]", {
    pathname: pathname ?? null,
    dynamicContext: {
      matches: dynamicContextData.contexts.map((context) => ({
        title: context.title,
        route: context.route,
        score: context.score,
      })),
      promptText: dynamicContextData.text || null,
    },
    staticFallback: staticContext,
    currentUiContext: screenContextPrompt || null,
    profilePrinter: profilePrinter ?? null,
    workshopPrinterLines,
    history: history.map((message) => ({
      role: message.role,
      chars: message.content.length,
    })),
    loadedMemoryCount,
    responseKnowledgeToolIds: knowledgeToolIds,
    promptToolContractIds: toolContractIds,
    retrievedKnowledgeChars,
    systemPromptChars,
  });
}

function logStampyTurnAudit({
  conversationId,
  assistantMessageId,
  input,
  historyCount,
  rawAnswer,
  returnedAnswer,
  removedPrefixes,
}: {
  conversationId: string | null;
  assistantMessageId: string | null;
  input: string;
  historyCount: number;
  rawAnswer: string;
  returnedAnswer: string;
  removedPrefixes: number;
}) {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.STAMPY_DEBUG_PROMPT !== "true"
  ) {
    return;
  }

  console.log("[Stampy Turn Audit]", {
    conversationId,
    assistantMessageId,
    inputPreview: input.substring(0, 120),
    historyCount,
    rawAnswerChars: rawAnswer.length,
    rawAnswerPreview: rawAnswer.substring(0, 160),
    returnedAnswerChars: returnedAnswer.length,
    returnedAnswerPreview: returnedAnswer.substring(0, 160),
    removedPrefixes,
  });
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
    const isDiscount = actionIntent.type === "discount_filament";
    const verb = isDiscount ? "descontar" : "sumar";
    const preposition = isDiscount ? "de" : "a";
    const remainingBefore = Number(resolvedTarget.remainingGramsBefore);
    const remainingAfter = isDiscount
      ? remainingBefore - grams
      : remainingBefore + grams;
    const remainingText = Number.isFinite(remainingAfter)
      ? ` Te quedarían ${remainingAfter}g.`
      : "";
    return `Voy a ${verb} ${grams}g ${preposition} ${resolvedTarget.label}.${remainingText} Confirmá si está bien.`;
  }

  if (matchStatus === "multiple") {
    return "Encontré más de un filamento posible. Decime cuál querés usar o elegilo desde Stock. No hice cambios.";
  }

  return "No encontré un filamento activo que coincida. Revisá el nombre, material, marca o color, o elegilo desde Stock. No hice cambios.";
}

function buildCreateFilamentResponse(actionIntent: StampyActionIntent): string {
  const extracted = actionIntent.extracted;
  if (extracted.duplicateStatus === "duplicate") {
    return "Ya existe un filamento parecido. Para evitar duplicados, revisalo desde Stock. No hice cambios.";
  }

  if (extracted.requiresConfirmation !== true) {
    return "No pude confirmar que sea un filamento nuevo. Revisalo desde Stock antes de crearlo.";
  }

  const label = [
    extracted.material,
    extracted.brand,
    extracted.name,
    extracted.color,
  ]
    .filter(Boolean)
    .join(" ");
  const assumption = extracted.totalGramsAssumed === true
    ? " (asumí un rollo porque no indicaste el peso)"
    : "";
  return `Voy a crear este filamento: ${label}, ${Number(
    extracted.totalGrams
  )}g${assumption}. Confirmá si está bien.`;
}

function buildCreatePrinterResponse(actionIntent: StampyActionIntent): string {
  const extracted = actionIntent.extracted;
  if (extracted.duplicateStatus === "active_duplicate") {
    return "Ya existe una impresora parecida. Para evitar duplicados, revisala desde Calculadora. No hice cambios.";
  }
  if (extracted.duplicateStatus === "inactive_match") {
    return "Ya existe una impresora parecida, pero está inactiva. Por ahora Stampy no la reactiva automáticamente; abrí Calculadora para revisarla.";
  }
  if (extracted.duplicateStatus === "ambiguous") {
    return "Encontré más de una impresora posible. Decime cuál querés usar o revisalas desde Calculadora.";
  }
  if (extracted.requiresConfirmation !== true) {
    return "No pude verificar con seguridad que la impresora sea nueva. Abrí Calculadora para revisarla antes de crear nada.";
  }

  return `Voy a crear esta impresora: ${String(
    extracted.printerName
  )}, ${Number(extracted.powerWatts)}W. Confirmá si está bien.`;
}

function buildCreateProductResponse(actionIntent: StampyActionIntent): string {
  const extracted = actionIntent.extracted;
  if (extracted.duplicateStatus === "duplicate") {
    return "Ya existe un producto parecido. Para evitar duplicados, revisalo desde Productos. No hice cambios.";
  }
  if (extracted.duplicateStatus === "ambiguous") {
    return "Encontré más de un producto posible. Decime cuál querés usar o revisalos desde Productos. No hice cambios.";
  }
  if (extracted.requiresConfirmation !== true) {
    return "No pude verificar con seguridad que el producto sea nuevo. Abrí Productos para revisarlo antes de crear nada.";
  }

  const components = Array.isArray(extracted.components)
    ? (extracted.components as Array<Record<string, unknown>>)
    : [];
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
  const details = [
    extracted.initialStock !== null && extracted.initialStock !== undefined
      ? `stock ${Number(extracted.initialStock)}`
      : null,
    extracted.printTimeMinutes !== null && extracted.printTimeMinutes !== undefined
      ? `${formatMinutes(extracted.printTimeMinutes)} de impresión`
      : null,
    extracted.baseCost !== null && extracted.baseCost !== undefined
      ? `costo ${formatMoney(extracted.baseCost)}`
      : null,
    extracted.salePrice !== null && extracted.salePrice !== undefined
      ? `venta ${formatMoney(extracted.salePrice)}`
      : null,
    components.length > 0
      ? `${components.length} filamento${components.length === 1 ? "" : "s"} en la receta`
      : null,
  ].filter((detail): detail is string => Boolean(detail));
  const detailsText = details.length === 0
    ? ""
    : details.length === 1
      ? ` con ${details[0]}`
      : ` con ${details.slice(0, -1).join(", ")} y ${details.at(-1)}`;

  return `Voy a crear ${String(
    extracted.productName
  )}${detailsText}. Confirmá si está bien.`;
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
    return "No pude verificar las recetas y el stock. Revisalas desde Productos antes de intentarlo de nuevo. No hice cambios.";
  }
  const products = Array.isArray(extracted.resolvedProducts)
    ? (extracted.resolvedProducts as Array<Record<string, unknown>>)
    : [];
  const consumptions = Array.isArray(extracted.consumptions)
    ? (extracted.consumptions as Array<Record<string, unknown>>)
    : [];
  const lines = [
    ...products.map(
      (product) =>
        `- ${Number(product.quantity)} × ${String(product.productName)}`
    ),
    ...consumptions.map(
      (consumption) =>
        `- ${String(consumption.label)}: ${Number(consumption.requiredGrams)}g`
    ),
  ];
  return `Preparé el descuento de materiales:\n${lines.join(
    "\n"
  )}\n\nConfirmá si está bien. Esta acción no cambia el stock de productos terminados.`;
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
  let answerText = "No pude responder esta vez. Probá de nuevo.";
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
        answer: "Llegaste al límite de mensajes por ahora. Probá de nuevo más tarde.",
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
    let screenContext: StampyScreenContext | null = null;
    if (context?.screenContext) {
      const { sanitizeStampyScreenContext } = await import("@/lib/stampy/screen-context");
      screenContext = sanitizeStampyScreenContext(context?.screenContext);
    }
    const shouldCheckProductStockTools = Boolean(
      screenContext && (
        screenContext.page.route.startsWith("/productos")
        || screenContext.page.route.startsWith("/stock")
        || screenContext.page.route.startsWith("/mi-taller")
      )
    )
      || /(?:recalcul|cu[aá]nto gano|ganancia|margen|por qu[eé].*(?:cuesta|amarill)|qu[eé] filamentos? usa|receta|me alcanza|cu[aá]ntos puedo|por terminarse|stock bajo|bobina|agreg.*al stock)/i.test(userMessage);
    let productStockIntent = null;
    let actionDetectionMessage = userMessage;
    if (shouldCheckProductStockTools) {
      const {
        bindSelectedProductToConsumptionMessage,
        detectStampyProductStockToolIntent,
      } = await import("@/lib/stampy/product-stock-tool-intents");
      productStockIntent = detectStampyProductStockToolIntent({
        message: userMessage,
        screenContext,
      });
      actionDetectionMessage = bindSelectedProductToConsumptionMessage(
        userMessage,
        screenContext,
      );
    }

    if (productStockIntent) {
      const {
        executeStampyProductStockTool,
        formatStampyProductStockToolResult,
      } = await import("@/lib/stampy/product-stock-tools");
      const toolResult = await executeStampyProductStockTool({
        supabase,
        userId,
        intent: productStockIntent,
        recalculateProduct: productStockIntent.toolName === "products.recalculate"
          ? async (productId) => {
              const { recalculateProductPriceAction } = await import("@/app/productos/actions");
              return recalculateProductPriceAction(productId);
            }
          : undefined,
      });
      requestMode = "direct";
      answerText = formatStampyProductStockToolResult(toolResult);
      let assistantMessageId: string | null = null;

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
            actionIntent: null,
            toolExecution: {
              toolName: toolResult.toolName,
              impact: toolResult.impact,
              confirmationRequired: toolResult.confirmationRequired,
              success: toolResult.success,
              errorCode: toolResult.errorCode ?? null,
            },
            memory: { loadedCount: 0, savedCount: 0 },
          },
        );
        assistantMessageId = saved.assistantMessageId;

        const { logStampyUsage } = await import("@/lib/stampy/usage-log");
        await logStampyUsage({
          supabase,
          userId,
          conversationId: actualConversationId,
          model: null,
          mode: requestMode,
          status: toolResult.success ? "success" : "error",
          messageChars: userMessage.length,
          promptChars: 0,
          completionChars: answerText.length,
          latencyMs: Date.now() - startTime,
        });
      }

      return {
        answer: answerText,
        recommendations: [],
        knowledgeTools: [],
        relatedTools: [],
        suggestedQuestions: [],
        conversationId: actualConversationId,
        assistantMessageId,
        actionRequestId: null,
        actionIntent: null,
      };
    }

    const hasClientScreenContext = screenContext?.selectedEntity?.type === "client"
      || screenContext?.visibleEntities?.some((entity) => entity.type === "client") === true;
    const shouldCheckClientTools = hasClientScreenContext
      && /(?:presupuestos?|[uú]ltimo|[uú]ltima|datos?|falta|incomplet|email|correo|informaci[oó]n|resumen)/i.test(userMessage);
    const clientIntent = shouldCheckClientTools
      ? (await import("@/lib/stampy/client-tool-intents")).detectStampyClientToolIntent({
          message: userMessage,
          screenContext,
        })
      : null;
    if (clientIntent) {
      const {
        executeStampyClientTool,
        formatStampyClientToolResult,
      } = await import("@/lib/stampy/client-tools");
      const toolResult = await executeStampyClientTool({
        supabase,
        userId,
        intent: clientIntent,
      });
      requestMode = "direct";
      answerText = formatStampyClientToolResult(toolResult);
      let assistantMessageId: string | null = null;

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
            actionIntent: null,
            toolExecution: {
              toolName: toolResult.toolName,
              impact: "read",
              confirmationRequired: false,
              success: toolResult.success,
              errorCode: toolResult.errorCode ?? null,
            },
            memory: { loadedCount: 0, savedCount: 0 },
          },
        );
        assistantMessageId = saved.assistantMessageId;

        const { logStampyUsage } = await import("@/lib/stampy/usage-log");
        await logStampyUsage({
          supabase,
          userId,
          conversationId: actualConversationId,
          model: null,
          mode: requestMode,
          status: toolResult.success ? "success" : "error",
          messageChars: userMessage.length,
          promptChars: 0,
          completionChars: answerText.length,
          latencyMs: Date.now() - startTime,
        });
      }

      return {
        answer: answerText,
        recommendations: [],
        knowledgeTools: [],
        relatedTools: [],
        suggestedQuestions: [],
        conversationId: actualConversationId,
        assistantMessageId,
        actionRequestId: null,
        actionIntent: null,
      };
    }

    const screenAnalysis = screenContext && shouldTryScreenAnalysis(userMessage, screenContext.page.section)
      ? (await import("@/lib/stampy/screen-analysis")).analyzeStampyScreenQuestion({
          message: userMessage,
          screenContext,
        })
      : null;
    if (screenAnalysis) {
      requestMode = "direct";
      answerText = screenAnalysis.answer;
      let assistantMessageId: string | null = null;

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
            actionIntent: null,
            screenAnalysis: { kind: screenAnalysis.kind },
            memory: { loadedCount: 0, savedCount: 0 },
          },
        );
        assistantMessageId = saved.assistantMessageId;

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
          latencyMs: Date.now() - startTime,
        });
      }

      return {
        answer: answerText,
        recommendations: [],
        knowledgeTools: [],
        relatedTools: [],
        suggestedQuestions: [],
        conversationId: actualConversationId,
        assistantMessageId,
        actionRequestId: null,
        actionIntent: null,
      };
    }

    const consumptionUsesSelectedProduct = actionDetectionMessage !== userMessage;
    const { detectStampyActionIntent, buildActionIntentResponse } = await import("@/lib/stampy/action-intents");
    const actionIntent = detectStampyActionIntent({
      message: actionDetectionMessage,
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
              confirmationExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
              ...(consumptionUsesSelectedProduct && screenContext?.selectedEntity?.type === "product"
                ? {
                    contextBinding: {
                      route: screenContext.page.route,
                      selectedEntityId: screenContext.selectedEntity.id,
                    },
                  }
                : {}),
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

    // Historial de la conversación activa, con roles. Se carga antes de
    // clasificar para que los seguimientos cortos ("¿y con PETG?") hereden
    // el tema del turno anterior.
    const recentHistory = actualConversationId
      ? await getRecentHistory(supabase, actualConversationId, userId)
      : [];
    const {
      STAMPY_MODEL_UNAVAILABLE_MESSAGE,
      buildStampyContextQuery,
      buildStampyResponseRequest,
      describeStampyModelError,
      extractStampyResponseText,
      getStampyModelConfig,
      isStampyFollowUpMessage,
    } = await import("@/lib/stampy/responses");
    const contextQuery = buildStampyContextQuery({
      userMessage,
      history: recentHistory,
    });

    const {
      classifyStampyKnowledgeIntent,
      formatStampyKnowledgeIntentForPrompt,
      shouldRetrieveStampyKnowledge,
    } = await import("@/lib/stampy/knowledge-intent");
    const knowledgeIntent = classifyStampyKnowledgeIntent(contextQuery);

    let loadedMemoryCount = 0;
    let memoryPromptText = "";
    try {
      const { loadRelevantMemory } = await import("@/lib/stampy/user-memory");
      const relevantMemory = await loadRelevantMemory({
        supabase,
        userId,
        query: contextQuery,
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

    const { formatStampyScreenContextForPrompt } = await import("@/lib/stampy/screen-context");
    const screenContextPrompt = formatStampyScreenContextForPrompt(screenContext);

    // 0. Contexto del taller del usuario (Solo Lectura)
    const { getStampyWorkshopContext } = await import("@/lib/stampy/workshop-context");
    const workshopContext = await getStampyWorkshopContext({
      supabase,
      userId,
      message: contextQuery
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
      message: contextQuery,
      currentPath: pathname,
      lessonId: context?.source === "lesson" ? context.lessonId : undefined,
    });

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

    // 4. System prompt: base fija + contexto de este turno.
    const {
      STAMPY_SYSTEM_PROMPT,
      STAMPY_TURN_CONTEXT_HEADER,
      formatStampyLessonContextForPrompt,
      formatStampyLessonRecommendationsForPrompt,
      formatStampyToolsForPrompt,
    } = await import("@/lib/stampy/system-prompt");
    const turnContext: string[] = [];

    // La clase actual va primero: es el marco principal de la conversación.
    const lessonId = context?.source === "lesson" ? context.lessonId : undefined;
    if (context?.source === "lesson") {
      turnContext.push(formatStampyLessonContextForPrompt(context));
    }
    if (lessonId) {
      const { getLessonTranscriptContext } = await import("@/lib/stampy/lesson-transcripts");
      const transcriptData = await getLessonTranscriptContext({
        supabase,
        lessonId,
        message: contextQuery,
      });

      if (transcriptData.transcriptFound) {
        turnContext.push(`${transcriptData.text}\n\nUsá esta transcripción como fuente principal sobre lo que dice la clase. No digas que viste el video; hablá de "la clase". Si no contiene la respuesta, aclaralo y orientá con conocimiento general.`);
      }
    }

    turnContext.push(formatStampyKnowledgeIntentForPrompt(knowledgeIntent));
    turnContext.push(dynamicContextData.text);

    if (staticContext) {
      turnContext.push(`PANTALLA ACTUAL: ${staticContext.title}
${staticContext.context}
Usalo para entender dónde está la persona; no lo menciones ni digas "según el contexto de la ruta". Si pregunta por algo de otra sección, respondé igual y, si hace falta, indicá la sección correcta.`);
    }

    // Contexto del usuario
    let userContext = null;
    try {
      const { getStampyUserContext } = await import("@/lib/stampy/user-context");
      userContext = await getStampyUserContext(userId);
    } catch (e) {
      console.error("[Stampy] user context failed", e);
    }

    if (userContext) {
      let userContextText = `Datos del usuario:
- Nombre: ${userContext.displayName || 'No especificado'}
- Experiencia de impresión: ${userContext.experienceLevelLabel || 'No especificada'}
- Impresora principal: ${userContext.printerLabel || 'No especificada'}
- Slicer: ${userContext.slicerLabel || 'No especificado'}
- Objetivo: ${userContext.mainGoalLabel || 'No especificado'}
- Etapa comercial: ${userContext.commercialStageLabel || 'No especificada'}
- Código de referido: ${userContext.referralCode || 'No generado'}
- Estado de membresía: ${userContext.membershipStatusLabel || 'No activa'}
- Progresión: Nivel ${userContext.xpLevel}, ${userContext.totalXp} XP totales, ${userContext.xpToNextLevel} XP para el próximo nivel`;
      if (userContext.memberLevelLabel) {
         userContextText += ` (${userContext.memberLevelLabel})`;
      }
      if (/\b(xp|nivel(?:es)?|puntos?|recompensas?)\b/i.test(userMessage)) {
        const { formatPublicXpRulesForStampy } = await import("@/lib/xp/config");
        userContextText += `\n\nREGLAS REALES DE XP:\n${formatPublicXpRulesForStampy()}\nExplicá solo estas reglas. No podés otorgar XP, cambiar niveles ni prometer recompensas no listadas.`;
      }

      userContextText += `
Usá estos datos para adaptar la respuesta (nivel técnico, impresora, slicer) sin recitarlos ni decir "según tu perfil". Si falta un dato del perfil que cambiaría la respuesta, podés sugerir completarlo.`;
      turnContext.push(userContextText);
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
        turnContext.push(`Contexto real de sorteos del usuario:
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
- No digas que ganó si no hay dato real.`);
      }
    }

    if (pathname && (pathname.startsWith("/stock") || pathname.startsWith("/mi-taller/filamentos") || pathname.startsWith("/mi-taller/inventario"))) {
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
          turnContext.push(`Consulta específica de filamento detectada:
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
- Si el usuario quiere modificar stock, explicale dónde hacerlo.`);
        } else if (stockContext.totalFilaments === 0 && stockContext.totalProducts === 0) {
          turnContext.push(`Contexto real de stock del usuario:
El usuario todavía no tiene filamentos ni productos cargados en su stock.`);
        } else {
          let stockText = `Contexto real de stock del usuario:
- Filamentos activos: ${stockContext.totalFilaments}
- Filamentos bajos: ${stockContext.lowStockFilaments.length > 0 ? stockContext.lowStockFilaments.map(f => f.name).join(', ') : 'Ninguno'}
- Filamentos vacíos: ${stockContext.emptyFilaments.length > 0 ? stockContext.emptyFilaments.map(f => f.name).join(', ') : 'Ninguno'}
- Productos activos: ${stockContext.totalProducts}
- Productos sin stock: ${stockContext.outOfStockProducts.length > 0 ? stockContext.outOfStockProducts.map(p => p.name).join(', ') : 'Ninguno'}
- Productos con stock bajo: ${stockContext.lowStockProducts.length > 0 ? stockContext.lowStockProducts.map(p => p.name).join(', ') : 'Ninguno'}`;

          if (stockContext.lowMarginProducts && stockContext.lowMarginProducts.length > 0) {
            stockText += `\n- Productos con margen bajo: ${stockContext.lowMarginProducts.map(p => p.name).join(', ')}`;
          }
          if (stockContext.recentMovements && stockContext.recentMovements.length > 0) {
            stockText += `\n- Últimos movimientos: ${stockContext.recentMovements.map(m => m.label).join(' | ')}`;
          }

          stockText += `\n\nReglas:
- Usá estos datos solo si el usuario pregunta por stock, filamentos, productos, faltantes, reposición o movimientos.
- No recites todos los datos si no hace falta.
- Priorizá alertas accionables.
- No digas que descontaste stock.
- Si el usuario quiere modificar stock, explicale dónde hacerlo.
- Si no hay datos, sugerí cargarlos.`;
          turnContext.push(stockText);
        }
      }
    }

    turnContext.push(`DATOS DEL USUARIO Y TALLER:
${workshopContext.text}

Reglas del taller:
- No digas "no tengo acceso" si el dato está en este bloque.
- Si el dato no está disponible, decilo naturalmente.
- No inventes stock, impresoras ni productos fuera del contexto.
- Las acciones seguras se detectan y preparan fuera de esta respuesta: no prometas ni simules cambios.`);

    if (screenContextPrompt) {
      turnContext.push(screenContextPrompt);
    }

    if (memoryPromptText) {
      turnContext.push(memoryPromptText);
    }

    let retrievedKnowledge = "";
    if (shouldRetrieveStampyKnowledge(knowledgeIntent, Boolean(lessonId))) {
      const { retrieveStampyKnowledge } = await import("@/lib/stampy/retrieval");
      retrievedKnowledge = await retrieveStampyKnowledge({
        supabase,
        query: contextQuery,
        courseId: context?.source === "lesson" ? context.courseId : undefined,
        lessonId,
        currentPath: pathname,
        maxChunks: 8,
      });
    }
    turnContext.push(retrievedKnowledge);

    // 5. Herramientas de Stampa relacionadas: se le dan al modelo para que
    // las ofrezca después de responder, y a la UI como tarjetas.
    const { findRelevantKnowledge } = await import("@/lib/stampy/knowledge-search");
    let knowledgeTools = findRelevantKnowledge(userMessage);
    if (knowledgeTools.length === 0 && isStampyFollowUpMessage(userMessage)) {
      knowledgeTools = findRelevantKnowledge(contextQuery);
    }

    // Ajustar herramientas según intent
    if (workshopContext.isFilamentQuery) {
      knowledgeTools = knowledgeTools.filter((tool) => tool.id !== "finished-product-stock" && tool.id !== "products");
    } else if (workshopContext.isProductQuery) {
      knowledgeTools = knowledgeTools.filter((tool) => tool.id !== "filament-stock");
    }
    turnContext.push(formatStampyToolsForPrompt(knowledgeTools));

    // 6. Clases de Academia: capa adicional de baja confianza (scoring
    // textual). Se buscan antes de llamar al modelo para que las integre
    // sólo si encajan; nunca reemplazan la respuesta.
    const shouldRecommendLessons = knowledgeIntent?.type === "course_recommendation";
    let recommendations: StampyLessonRecommendation[] = [];
    if (shouldRecommendLessons) {
      const { findStampyLessonRecommendations } = await import("@/lib/stampy/lesson-recommendations");
      recommendations = await findStampyLessonRecommendations({
        supabase,
        query: contextQuery,
        intent: knowledgeIntent,
        limit: 2,
      });
      turnContext.push(formatStampyLessonRecommendationsForPrompt(recommendations));
    }

    // 7. Acciones disponibles y contratos de herramientas según la ruta actual
    let promptToolContractIds: string[] = [];
    const {
      formatStampyAvailableActionsForPrompt,
      formatToolContractForPrompt,
      getRelevantContractsForPath,
    } = await import("@/lib/stampy/tool-registry");
    const relevantContracts = pathname ? getRelevantContractsForPath(pathname) : [];
    promptToolContractIds = relevantContracts.map((contract) => contract.id);
    turnContext.push(formatStampyAvailableActionsForPrompt(relevantContracts));
    if (relevantContracts.length > 0) {
      turnContext.push(`CONTRATOS DE HERRAMIENTAS DE ESTA PANTALLA (REGLAS ESTRICTAS):
${relevantContracts.map(formatToolContractForPrompt).join("\n\n")}`);
    }

    const systemPrompt = [
      STAMPY_SYSTEM_PROMPT,
      STAMPY_TURN_CONTEXT_HEADER,
      ...turnContext.map((section) => section?.trim()).filter(Boolean),
    ].join("\n\n");

    logStampyPromptAudit({
      pathname,
      dynamicContextData,
      staticContext,
      screenContextPrompt,
      profilePrinter: userContext?.printerLabel,
      workshopContextText: workshopContext.text,
      history: recentHistory,
      loadedMemoryCount,
      knowledgeToolIds: knowledgeTools.map((tool) => tool.id),
      toolContractIds: promptToolContractIds,
      retrievedKnowledgeChars: retrievedKnowledge?.length ?? 0,
      systemPromptChars: systemPrompt.length,
    });

    // 8. Responses API: instrucciones + conversación multi-turn con roles.
    const modelConfig = getStampyModelConfig();
    const modelName = modelConfig.model;
    let rawAnswerText = "";
    let modelFailure: Record<string, unknown> | null = null;
    try {
      const response = await openai.responses.create(
        buildStampyResponseRequest({
          config: modelConfig,
          instructions: systemPrompt,
          history: recentHistory,
          userMessage,
        })
      );
      rawAnswerText = extractStampyResponseText(response);
      if (!rawAnswerText) {
        modelFailure = {
          name: "EmptyResponse",
          status: response.status ?? null,
          incompleteReason: response.incomplete_details?.reason ?? null,
        };
      }
    } catch (error) {
      modelFailure = describeStampyModelError(error);
    }

    if (!rawAnswerText) {
      // Fallback explícito: no se presenta como respuesta del modelo ni se
      // guarda en el historial de la conversación.
      console.error("[Stampy] model unavailable", { model: modelName, ...modelFailure });
      const { logStampyUsage } = await import("@/lib/stampy/usage-log");
      await logStampyUsage({
        supabase,
        userId,
        conversationId: actualConversationId,
        model: modelName,
        mode: "error",
        status: "error",
        messageChars: userMessage.length,
        errorMessage: JSON.stringify(modelFailure).substring(0, 500),
        latencyMs: Date.now() - startTime,
      });

      return {
        error: STAMPY_MODEL_UNAVAILABLE_MESSAGE,
        errorCode: "model_unavailable",
        answer: STAMPY_MODEL_UNAVAILABLE_MESSAGE,
        recommendations: [],
        knowledgeTools: [],
        relatedTools: [],
        suggestedQuestions: [],
        conversationId: actualConversationId,
        assistantMessageId: null,
        actionRequestId: null,
        actionIntent: null,
      };
    }

    const { isolateCurrentStampyReply } = await import("@/lib/stampy/reply-policy");
    const isolatedReply = isolateCurrentStampyReply({
      answer: rawAnswerText,
      history: recentHistory,
      userMessage,
    });
    answerText = isolatedReply.content || rawAnswerText;

    let assistantMessageId: string | null = null;
    let savedMemoryCount = 0;
    if (actualConversationId) {
      const assistantMetadata = {
        mode: requestMode,
        model: modelName,
        reasoningEffort: modelConfig.reasoningEffort,
        followUp: contextQuery !== userMessage,
        relatedToolsCount: knowledgeTools.length,
        recommendationsCount: recommendations.length,
        knowledgeIntent: knowledgeIntent?.type ?? null,
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

    logStampyTurnAudit({
      conversationId: actualConversationId,
      assistantMessageId,
      input: userMessage,
      historyCount: recentHistory.length,
      rawAnswer: rawAnswerText,
      returnedAnswer: answerText,
      removedPrefixes: isolatedReply.removedPrefixes,
    });

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
      actionIntent: null,
      knowledgeIntent: knowledgeIntent?.type ?? null,
    };
  } catch (error) {
    // Fallo interno fuera de la llamada al modelo (datos, contexto, etc.).
    console.error("[Stampy] request failed", {
      name: error instanceof Error ? error.name : "Error",
      message: String(error instanceof Error ? error.message : error).substring(0, 300),
    });

    if (actualConversationId && currentUserId) {
      const { logStampyUsage } = await import("@/lib/stampy/usage-log");
      await logStampyUsage({
        supabase,
        userId: currentUserId,
        conversationId: actualConversationId,
        model: null,
        mode: "error",
        status: "error",
        messageChars: message.length,
        errorMessage: String(error).substring(0, 500),
        latencyMs: Date.now() - startTime
      });
    }

    return {
      answer: "Algo falló al procesarlo. No hice ningún cambio. Probá de nuevo o abrí la herramienta manualmente.",
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
