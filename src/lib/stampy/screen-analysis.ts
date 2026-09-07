import { calculateCalculatorPricing } from "@/lib/calculator/pricing";
import { calculateBudgetTotals } from "@/lib/budgets/calculation";
import type {
  StampyBudgetDraftContext,
  StampyCalculatorDraftContext,
  StampyScreenContext,
} from "./screen-context";

export interface StampyScreenAnalysisResult {
  kind: "calculator" | "budget";
  answer: string;
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("es-AR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatNumber(value: number, decimals = 0): string {
  const numeric = Number.isFinite(value) ? value : 0;
  const sign = numeric < 0 ? "-" : "";
  const fixed = Math.abs(numeric).toFixed(decimals);
  const [integer, decimal] = fixed.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const usefulDecimals = decimal?.replace(/0+$/, "") ?? "";
  const formatted = usefulDecimals ? `${grouped},${usefulDecimals}` : grouped;
  return `${sign}${formatted}`;
}

function money(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${formatNumber(Math.abs(value), Math.abs(value % 1) > 0.005 ? 2 : 0)}`;
}

function currentMargin(draft: StampyCalculatorDraftContext): number {
  return draft.result.salePrice > 0
    ? (draft.result.profit / draft.result.salePrice) * 100
    : 0;
}

function calculatorCostParts(draft: StampyCalculatorDraftContext) {
  const adjustedInputs = (draft.otherCost + draft.fixedCost) * 1.3;
  return [
    { label: "filamento", value: draft.result.filamentCost },
    { label: "electricidad", value: draft.result.electricityCost },
    { label: "mantenimiento", value: draft.result.maintenanceCost },
    { label: "mano de obra", value: draft.laborCost },
    { label: "insumos y costos fijos con recargo", value: adjustedInputs },
  ].sort((left, right) => right.value - left.value);
}

function analyzeCalculator(
  message: string,
  draft: StampyCalculatorDraftContext,
): StampyScreenAnalysisResult | null {
  const text = normalize(message);
  const asksAboutCost = /(?:por que|que).*(?:caro|alto)|da tan caro/.test(text);
  const asksLargestCost = /(?:que|cual).*(?:costo|parte).*(?:pesa|mayor)|que pesa mas/.test(text);
  const asksProfit = /cuanto.*(?:gano|ganando)|ganancia/.test(text);
  const asksCheap = /(?:cobrando|cobro).*(?:barato|poco)|precio.*(?:barato|bajo)/.test(text);
  const asksAdvice = /que cambiarias|que ajustarias|como lo mejorarias/.test(text);
  const addedHoursMatch = text.match(/(?:agrego|agrega|sumo|suma|subo|subi|anado|añado)\s+(\d+(?:[.,]\d+)?)\s*(?:h|hora|horas)/);
  const marginMatch = text.match(/(\d+(?:[.,]\d+)?)\s*%\s*(?:de\s*)?margen|margen\s*(?:de\s*)?(\d+(?:[.,]\d+)?)\s*%/);

  if (!asksAboutCost && !asksLargestCost && !asksProfit && !asksCheap && !asksAdvice && !addedHoursMatch && !marginMatch) {
    return null;
  }

  if (!draft.valid) {
    return {
      kind: "calculator",
      answer: "Todavía faltan datos para analizar el cálculo. Completá al menos un filamento con gramos, una impresora y el tiempo de impresión.",
    };
  }

  if (addedHoursMatch) {
    const addedHours = Number(addedHoursMatch[1].replace(",", "."));
    const currentHours = draft.timeMinutes / 60;
    const projectedHours = currentHours + addedHours;
    const electricityCost = projectedHours * (draft.printerPowerWatts / 1000) * draft.electricityPriceKwh;
    const maintenanceCost = projectedHours * draft.maintenanceCostPerHour;
    const projected = calculateCalculatorPricing({
      filamentCost: draft.result.filamentCost,
      electricityCost,
      maintenanceCost,
      fixedCost: draft.fixedCost,
      multiplier: draft.multiplier,
      laborCost: draft.laborCost,
      otherCost: draft.otherCost,
    });
    return {
      kind: "calculator",
      answer: `Con ${formatNumber(addedHours, 2)} horas más, el costo base pasaría de **${money(draft.result.baseCost)}** a **${money(projected.baseCost)}** y el precio sugerido a **${money(projected.salePrice)}**. No modifiqué el cálculo.`,
    };
  }

  if (marginMatch) {
    const requestedMargin = Number((marginMatch[1] ?? marginMatch[2]).replace(",", "."));
    if (!(requestedMargin > 0 && requestedMargin < 100)) {
      return { kind: "calculator", answer: "El margen tiene que ser mayor a 0% y menor a 100%. No modifiqué el cálculo." };
    }
    const targetSalePrice = draft.result.baseCost / (1 - requestedMargin / 100);
    const nonMultipliableCost = draft.result.baseCost - draft.result.filamentCost;
    const targetMultiplier = draft.result.filamentCost > 0
      ? Math.max(0, (targetSalePrice - nonMultipliableCost) / draft.result.filamentCost)
      : 0;
    const projected = calculateCalculatorPricing({
      filamentCost: draft.result.filamentCost,
      electricityCost: draft.result.electricityCost,
      maintenanceCost: draft.result.maintenanceCost,
      fixedCost: draft.fixedCost,
      multiplier: targetMultiplier,
      laborCost: draft.laborCost,
      otherCost: draft.otherCost,
    });
    return {
      kind: "calculator",
      answer: `Para un margen del **${formatNumber(requestedMargin, 2)}%** sobre el precio final, el precio sugerido sería aproximadamente **${money(projected.salePrice)}** y la ganancia **${money(projected.profit)}**. Eso equivale a un multiplicador de filamento cercano a **${formatNumber(targetMultiplier, 2)}**. No modifiqué el cálculo.`,
    };
  }

  if (asksProfit) {
    return {
      kind: "calculator",
      answer: `La ganancia estimada es **${money(draft.result.profit)}**, equivalente al **${formatNumber(currentMargin(draft), 1)}%** del precio sugerido.`,
    };
  }

  const parts = calculatorCostParts(draft);
  const largest = parts[0];
  if (asksLargestCost) {
    return {
      kind: "calculator",
      answer: `La parte que más pesa es **${largest.label}**, con **${money(largest.value)}** del costo base de ${money(draft.result.baseCost)}.`,
    };
  }

  if (asksAboutCost) {
    const relevant = parts.filter((part) => part.value > 0).slice(0, 3);
    return {
      kind: "calculator",
      answer: `El precio se explica principalmente por ${relevant.map((part) => `**${part.label} (${money(part.value)})**`).join(", ")}. El costo base es ${money(draft.result.baseCost)} y el multiplicador sólo se aplica al filamento; no al resto de los costos.`,
    };
  }

  if (asksCheap) {
    return {
      kind: "calculator",
      answer: `Con los datos cargados, el precio sugerido es **${money(draft.result.salePrice)}** y deja **${money(draft.result.profit)}** de ganancia (${formatNumber(currentMargin(draft), 1)}%). Para saber si está barato frente al mercado hace falta compararlo con piezas equivalentes; la calculadora sólo confirma tus costos y margen.`,
    };
  }

  return {
    kind: "calculator",
    answer: `Revisaría primero **${largest.label}**, porque hoy es el componente más alto (${money(largest.value)}). Después comprobaría el tiempo, los gramos y el multiplicador con los datos reales del trabajo. No modifiqué el cálculo.`,
  };
}

function budgetBreakdown(draft: StampyBudgetDraftContext): string {
  const parts = [`subtotal **${money(draft.summary.subtotal)}**`];
  if (draft.summary.discount > 0) parts.push(`descuento **-${money(draft.summary.discount)}**`);
  if (draft.summary.tax > 0) parts.push(`IVA **${money(draft.summary.tax)}**`);
  if (draft.additionalCharges > 0) parts.push(`cargos adicionales **${money(draft.additionalCharges)}**`);
  return `${parts.join(", ")}. Total: **${money(draft.summary.total)}**.`;
}

function analyzeBudget(
  message: string,
  draft: StampyBudgetDraftContext,
): StampyScreenAnalysisResult | null {
  const text = normalize(message);
  const numberToken = "(\\d+(?:[.,]\\d+)?)";
  const discountMatch = text.includes("descuento")
    ? text.match(new RegExp(`${numberToken}\\s*%?`))
    : null;
  const taxMatch = /\b(?:iva|impuesto)\b/.test(text)
    ? text.match(new RegExp(`${numberToken}\\s*%?`))
    : null;
  const chargeMatch = /\b(?:envio|cargo|cargos|adicional|adicionales)\b/.test(text)
    ? text.match(new RegExp(`\\$?\\s*${numberToken}`))
    : null;
  const asksTotal = /cuanto.*(?:cobrando|cobrar|total)|como queda ahora|total actual/.test(text);
  const asksBreakdown = /desglos|detalle.*(?:precio|total)|como se compone/.test(text);
  const asksProfit = /cuanto.*(?:gano|ganando)|ganancia|margen/.test(text);
  const asksWellPriced = /(?:cobrando|precio).*(?:bien|barato|caro)/.test(text);
  const asksLowestMargin = /(?:que|cual).*(?:producto|item).*(?:menos margen|menos ganancia)|menos margen/.test(text);
  const asksMissing = /que falta|falta completar|incompleto/.test(text);
  const asksAdvice = /que cambiarias|que ajustarias|como lo mejorarias/.test(text);

  if (discountMatch) {
    const discountPercent = Number(discountMatch[1].replace(",", "."));
    const projected = calculateBudgetTotals({
      subtotal: draft.summary.subtotal,
      discountPercent,
      taxRate: draft.taxRate,
      additionalCharges: draft.additionalCharges,
    });
    return {
      kind: "budget",
      answer: `Con **${formatNumber(projected.discountPercent, 2)}% de descuento**, el descuento sería ${money(projected.discountAmount)} y el total quedaría en **${money(projected.total)}**. No modifiqué el borrador; cambiá el campo Descuento para aplicarlo.`,
    };
  }

  if (taxMatch) {
    const requestedRate = Number(taxMatch[1].replace(",", "."));
    if (![0, 10.5, 21].includes(requestedRate)) {
      return {
        kind: "budget",
        answer: "La pantalla admite IVA de 0%, 10,5% o 21%. No modifiqué el borrador.",
      };
    }
    const projected = calculateBudgetTotals({
      subtotal: draft.summary.subtotal,
      discountPercent: draft.discountPercent,
      taxRate: requestedRate,
      additionalCharges: draft.additionalCharges,
    });
    return {
      kind: "budget",
      answer: `Con **IVA ${formatNumber(projected.taxRate, 1)}%**, el IVA sería ${money(projected.taxAmount)} y el total quedaría en **${money(projected.total)}**. No modifiqué el borrador; elegí esa tasa en el campo IVA para aplicarla.`,
    };
  }

  if (chargeMatch) {
    const additionalCharges = Number(chargeMatch[1].replace(",", "."));
    const projected = calculateBudgetTotals({
      subtotal: draft.summary.subtotal,
      discountPercent: draft.discountPercent,
      taxRate: draft.taxRate,
      additionalCharges,
    });
    return {
      kind: "budget",
      answer: `Con **${money(additionalCharges)}** de cargos adicionales, el total quedaría en **${money(projected.total)}**. No modifiqué el borrador; cargá el importe en Cargos adicionales para aplicarlo.`,
    };
  }

  if (!asksTotal && !asksBreakdown && !asksProfit && !asksWellPriced && !asksLowestMargin && !asksMissing && !asksAdvice) {
    return null;
  }

  if (asksMissing) {
    const missing: string[] = [];
    if (!draft.client?.id && !draft.client?.name) missing.push("cliente");
    if (draft.items.length === 0) missing.push("al menos un producto");
    if (draft.items.some((item) => item.quantity <= 0)) missing.push("cantidades válidas");
    if (draft.items.some((item) => item.unitPrice < 0)) missing.push("precios válidos");
    if (draft.budgetType === "professional" && !draft.paymentMethod) missing.push("forma de pago");
    if (draft.budgetType === "professional" && !draft.deliveryTime) missing.push("plazo de entrega");
    return {
      kind: "budget",
      answer: missing.length > 0
        ? `Falta completar: **${missing.join(", ")}**.`
        : "Los datos principales del presupuesto están completos. Antes de guardarlo, revisá cantidades, precios, descuento, IVA y condiciones comerciales.",
    };
  }

  if (asksLowestMargin) {
    const candidates = draft.items
      .filter((item) => item.estimatedProfit !== undefined && item.quantity > 0 && item.unitPrice > 0)
      .map((item) => ({
        item,
        margin: ((item.estimatedProfit ?? 0) / (item.quantity * item.unitPrice)) * 100,
      }))
      .sort((left, right) => left.margin - right.margin);
    if (candidates.length === 0) {
      return { kind: "budget", answer: "No hay información de ganancia por producto suficiente para comparar los márgenes del borrador." };
    }
    const lowest = candidates[0];
    return {
      kind: "budget",
      answer: `El producto con menor margen estimado es **${lowest.item.name}**, con aproximadamente **${formatNumber(lowest.margin, 1)}%** sobre su importe.`,
    };
  }

  if (asksProfit || asksWellPriced) {
    const profit = draft.summary.estimatedProfit;
    if (profit === undefined) {
      return { kind: "budget", answer: `El total actual es **${money(draft.summary.total)}**, pero este borrador no aporta costos suficientes para calcular la ganancia.` };
    }
    const netRevenue = Math.max(0, draft.summary.subtotal - draft.summary.discount);
    const margin = netRevenue > 0 ? (profit / netRevenue) * 100 : 0;
    const marketNote = asksWellPriced
      ? " Esto confirma tus números internos; para saber si el precio está bien frente al mercado hace falta compararlo con trabajos equivalentes."
      : "";
    return {
      kind: "budget",
      answer: `La ganancia estimada del borrador es **${money(profit)}**, cerca del **${formatNumber(margin, 1)}%** sobre el importe neto antes de IVA y cargos.${marketNote}`,
    };
  }

  if (asksBreakdown) {
    return { kind: "budget", answer: budgetBreakdown(draft) };
  }

  if (asksTotal) {
    return { kind: "budget", answer: `Le estás cobrando **${money(draft.summary.total)}** en total. ${budgetBreakdown(draft)}` };
  }

  const missingProfessional = draft.budgetType === "professional"
    ? [!draft.paymentMethod ? "forma de pago" : null, !draft.deliveryTime ? "plazo de entrega" : null].filter(Boolean)
    : [];
  return {
    kind: "budget",
    answer: missingProfessional.length > 0
      ? `Antes de enviarlo, completaría **${missingProfessional.join(" y ")}** y revisaría el total de ${money(draft.summary.total)}. No modifiqué el borrador.`
      : `Revisaría cantidades, descuento e IVA antes de enviarlo. El total actual es **${money(draft.summary.total)}**. No modifiqué el borrador.`,
  };
}

export function analyzeStampyScreenQuestion({
  message,
  screenContext,
}: {
  message: string;
  screenContext: StampyScreenContext | null;
}): StampyScreenAnalysisResult | null {
  if (!screenContext) return null;
  if (
    screenContext.page.section === "calculator"
    && screenContext.formState?.kind === "calculatorDraft"
  ) {
    return analyzeCalculator(message, screenContext.formState);
  }
  if (
    screenContext.page.section === "budgets"
    && screenContext.formState?.kind === "budgetDraft"
  ) {
    return analyzeBudget(message, screenContext.formState);
  }
  return null;
}
