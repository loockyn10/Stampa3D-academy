import type { SupabaseClient } from "@supabase/supabase-js";

export type ConfirmableFilamentAction =
  | "increase_filament_stock"
  | "discount_filament";

export interface ResolvedFilament {
  id: string;
  user_id: string;
  name: string | null;
  filament_type: string | null;
  brand: string | null;
  color: string | null;
  remaining_grams: number;
  total_grams: number | null;
  is_active: boolean;
  filament_templates?: { brand?: string | null } | null;
}

export interface FilamentMatchResult {
  status: "unique" | "none" | "multiple";
  filament?: ResolvedFilament;
  matches?: ResolvedFilament[];
  error?: string;
}

export interface DuplicateFilamentResult {
  status: "clear" | "duplicate" | "error";
  filament?: ResolvedFilament;
  error?: string;
}

export interface ResolvedPrinter {
  id: string;
  user_id: string;
  name: string;
  power_watts: number;
  maintenance_cost_per_hour: number;
  is_active: boolean;
  source_template_id: string | null;
}

export interface DuplicatePrinterResult {
  status:
    | "clear"
    | "active_duplicate"
    | "inactive_match"
    | "ambiguous"
    | "error";
  printer?: ResolvedPrinter;
  matches?: ResolvedPrinter[];
  error?: string;
}

export interface ResolvedProduct {
  id: string;
  user_id: string;
  name: string;
  stock_quantity: number;
  sale_price: number;
  image_url: string | null;
  is_active: boolean;
}

export interface DuplicateProductResult {
  status: "clear" | "duplicate" | "ambiguous" | "error";
  product?: ResolvedProduct;
  matches?: ResolvedProduct[];
  error?: string;
}

export interface ResolvedProductComponent extends Record<string, unknown> {
  grams: number;
  material: string;
  brand: string | null;
  name: string | null;
  color: string | null;
  filamentId: string | null;
  filamentLabel: string | null;
  matchStatus: "unique" | "none" | "multiple";
}

export interface ProductComponentsResolution {
  components: ResolvedProductComponent[];
  unmatchedCount: number;
  errors: string[];
}

export interface ProductFilamentDiscountItem {
  productName: string;
  quantity: number;
}

export interface PreparedProductDiscount {
  productId: string;
  productName: string;
  quantity: number;
  componentsCount: number;
}

export interface PreparedFilamentConsumption {
  filamentId: string;
  label: string;
  requiredGrams: number;
  remainingGrams: number;
  afterRemainingGrams: number;
}

export interface ProductDiscountBlocker {
  code: string;
  message: string;
  productName?: string;
  componentSnapshot?: string;
}

export interface ProductFilamentDiscountPreparation {
  products: PreparedProductDiscount[];
  consumptions: PreparedFilamentConsumption[];
  blockers: ProductDiscountBlocker[];
  warnings: string[];
}

interface ResolveFilamentMatchParams {
  supabase: SupabaseClient;
  userId: string;
  extracted: Record<string, unknown>;
}

export interface FilamentMovementExecutionResult {
  success: boolean;
  actionRequestId: string | null;
  filamentId: string | null;
  previousRemainingGrams: number | null;
  newRemainingGrams: number | null;
  deltaGrams: number | null;
  errorCode: string | null;
  message: string;
}

export interface CreateFilamentExecutionResult {
  success: boolean;
  actionRequestId: string | null;
  filamentId: string | null;
  label: string | null;
  totalGrams: number | null;
  remainingGrams: number | null;
  errorCode: string | null;
  message: string;
}

export interface CreatePrinterExecutionResult {
  success: boolean;
  actionRequestId: string | null;
  printerId: string | null;
  printerName: string | null;
  powerWatts: number | null;
  maintenanceCostPerHour: number | null;
  errorCode: string | null;
  message: string;
}

export interface CreateProductExecutionResult {
  success: boolean;
  actionRequestId: string | null;
  productId: string | null;
  productName: string | null;
  componentsCount: number | null;
  unmatchedComponentsCount: number | null;
  errorCode: string | null;
  message: string;
}

interface ExecuteFilamentStockMovementParams {
  supabase: SupabaseClient;
  actionRequestId: string;
}

interface RpcMovementResult {
  success: boolean;
  action_request_id: string | null;
  filament_id: string | null;
  previous_remaining_grams: number | string | null;
  new_remaining_grams: number | string | null;
  delta_grams: number | string | null;
  error_code: string | null;
  message: string;
}

interface RpcCreateFilamentResult {
  success: boolean;
  action_request_id: string | null;
  filament_id: string | null;
  label: string | null;
  total_grams: number | string | null;
  remaining_grams: number | string | null;
  error_code: string | null;
  message: string;
}

interface RpcCreatePrinterResult {
  success: boolean;
  action_request_id: string | null;
  printer_id: string | null;
  printer_name: string | null;
  power_watts: number | string | null;
  maintenance_cost_per_hour: number | string | null;
  error_code: string | null;
  message: string;
}

interface RpcCreateProductResult {
  success: boolean;
  action_request_id: string | null;
  product_id: string | null;
  product_name: string | null;
  components_count: number | string | null;
  unmatched_components_count: number | string | null;
  error_code: string | null;
  message: string;
}

interface RpcProductFilamentDiscountResult {
  success: boolean;
  action_request_id: string | null;
  products_count: number | string | null;
  filaments_count: number | string | null;
  total_grams: number | string | null;
  error_code: string | null;
  message: string;
}

export interface ProductFilamentDiscountExecutionResult {
  success: boolean;
  actionRequestId: string | null;
  productsCount: number | null;
  filamentsCount: number | null;
  totalGrams: number | null;
  errorCode: string | null;
  message: string;
}

function normalizeMatchText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function matchesReference(candidate: unknown, reference: unknown): boolean {
  const normalizedCandidate = normalizeMatchText(candidate);
  const normalizedReference = normalizeMatchText(reference);
  if (!normalizedCandidate || !normalizedReference) return false;
  return (
    normalizedCandidate.includes(normalizedReference) ||
    normalizedReference.includes(normalizedCandidate)
  );
}

function normalizeProductReference(value: unknown): string {
  return normalizeMatchText(value)
    .split(" ")
    .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word))
    .join(" ");
}

function readTemplateBrand(filament: ResolvedFilament): string | null {
  return filament.filament_templates?.brand ?? null;
}

export function getResolvedFilamentLabel(filament: ResolvedFilament): string {
  const parts = [
    filament.filament_type,
    filament.brand ?? readTemplateBrand(filament),
    filament.name,
    filament.color,
  ].filter((part): part is string => Boolean(part?.trim()));

  return Array.from(new Set(parts)).join(" · ") || "Filamento sin nombre";
}

export async function resolveFilamentMatch({
  supabase,
  userId,
  extracted,
}: ResolveFilamentMatchParams): Promise<FilamentMatchResult> {
  const material = normalizeMatchText(extracted.material);
  const brand = normalizeMatchText(extracted.brand);
  const color = normalizeMatchText(extracted.color);
  const name = normalizeMatchText(extracted.name);

  if (!material && !brand && !color && !name) {
    return { status: "none", matches: [] };
  }

  const { data, error } = await supabase
    .from("filaments")
    .select(
      "id, user_id, name, filament_type, brand, color, remaining_grams, total_grams, is_active, filament_templates(brand)"
    )
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) {
    return { status: "none", matches: [], error: error.message };
  }

  const filaments = (data ?? []) as ResolvedFilament[];
  const matches = filaments.filter((filament) => {
    if (material && !matchesReference(filament.filament_type, material)) return false;
    if (
      brand &&
      !matchesReference(filament.brand, brand) &&
      !matchesReference(readTemplateBrand(filament), brand) &&
      !matchesReference(filament.name, brand)
    ) {
      return false;
    }
    if (
      color &&
      !matchesReference(filament.color, color) &&
      !matchesReference(filament.name, color)
    ) {
      return false;
    }
    if (name && !matchesReference(filament.name, name)) return false;
    return true;
  });

  if (matches.length === 1) {
    return { status: "unique", filament: matches[0], matches };
  }

  return {
    status: matches.length === 0 ? "none" : "multiple",
    matches,
  };
}

export async function findDuplicateActiveFilament({
  supabase,
  userId,
  extracted,
}: ResolveFilamentMatchParams): Promise<DuplicateFilamentResult> {
  const material = normalizeMatchText(extracted.material);
  const brand = normalizeMatchText(extracted.brand);
  const name = normalizeMatchText(extracted.name);
  const color = normalizeMatchText(extracted.color ?? "Sin color");

  if (!material) return { status: "error", error: "missing_material" };

  const { data, error } = await supabase
    .from("filaments")
    .select(
      "id, user_id, name, filament_type, brand, color, remaining_grams, total_grams, is_active, filament_templates(brand)"
    )
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) return { status: "error", error: error.message };

  const duplicate = ((data ?? []) as ResolvedFilament[]).find((filament) => {
    const filamentBrand = normalizeMatchText(
      filament.brand ?? readTemplateBrand(filament)
    );
    return (
      normalizeMatchText(filament.filament_type) === material &&
      filamentBrand === brand &&
      normalizeMatchText(filament.name) === name &&
      normalizeMatchText(filament.color ?? "Sin color") === color
    );
  });

  return duplicate
    ? { status: "duplicate", filament: duplicate }
    : { status: "clear" };
}

export async function findDuplicatePrinter({
  supabase,
  userId,
  printerName,
}: {
  supabase: SupabaseClient;
  userId: string;
  printerName: string;
}): Promise<DuplicatePrinterResult> {
  const normalizedRequestedName = normalizeMatchText(printerName);
  if (!normalizedRequestedName) {
    return { status: "error", matches: [], error: "missing_printer_name" };
  }

  const { data, error } = await supabase
    .from("printers")
    .select(
      "id, user_id, name, power_watts, maintenance_cost_per_hour, is_active, source_template_id"
    )
    .eq("user_id", userId);

  if (error) return { status: "error", matches: [], error: error.message };

  const printers = (data ?? []) as ResolvedPrinter[];
  const exactMatches = printers.filter(
    (printer) => normalizeMatchText(printer.name) === normalizedRequestedName
  );
  const candidates =
    exactMatches.length > 0
      ? exactMatches
      : printers.filter((printer) => {
          const normalizedName = normalizeMatchText(printer.name);
          return (
            normalizedName.includes(normalizedRequestedName) ||
            normalizedRequestedName.includes(normalizedName)
          );
        });

  if (candidates.length === 0) return { status: "clear", matches: [] };
  if (candidates.length > 1) return { status: "ambiguous", matches: candidates };

  const printer = candidates[0];
  return printer.is_active
    ? { status: "active_duplicate", printer, matches: candidates }
    : { status: "inactive_match", printer, matches: candidates };
}

export async function findDuplicateProduct({
  supabase,
  userId,
  productName,
}: {
  supabase: SupabaseClient;
  userId: string;
  productName: string;
}): Promise<DuplicateProductResult> {
  const normalizedRequestedName = normalizeMatchText(productName);
  if (!normalizedRequestedName) {
    return { status: "error", matches: [], error: "missing_product_name" };
  }

  const { data, error } = await supabase
    .from("products")
    .select("id, user_id, name, stock_quantity, sale_price, image_url, is_active")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) return { status: "error", matches: [], error: error.message };

  const products = (data ?? []) as ResolvedProduct[];
  const exactMatches = products.filter(
    (product) => normalizeMatchText(product.name) === normalizedRequestedName
  );
  const candidates =
    exactMatches.length > 0
      ? exactMatches
      : products.filter((product) => {
          const normalizedName = normalizeMatchText(product.name);
          return (
            normalizedName.includes(normalizedRequestedName) ||
            normalizedRequestedName.includes(normalizedName)
          );
        });

  if (candidates.length === 0) return { status: "clear", matches: [] };
  if (candidates.length > 1) {
    return { status: "ambiguous", matches: candidates };
  }
  return { status: "duplicate", product: candidates[0], matches: candidates };
}

export async function resolveProductFilamentComponents({
  supabase,
  userId,
  components,
}: {
  supabase: SupabaseClient;
  userId: string;
  components: Array<Record<string, unknown>>;
}): Promise<ProductComponentsResolution> {
  const errors: string[] = [];
  const resolvedComponents = await Promise.all(
    components.map(async (component): Promise<ResolvedProductComponent> => {
      const match = await resolveFilamentMatch({
        supabase,
        userId,
        extracted: component,
      });
      if (match.error) errors.push(match.error);

      return {
        ...component,
        grams: Number(component.grams),
        material: String(component.material),
        brand: typeof component.brand === "string" ? component.brand : null,
        name: typeof component.name === "string" ? component.name : null,
        color: typeof component.color === "string" ? component.color : null,
        filamentId:
          match.status === "unique" && match.filament ? match.filament.id : null,
        filamentLabel:
          match.status === "unique" && match.filament
            ? getResolvedFilamentLabel(match.filament)
            : null,
        matchStatus: match.status,
      };
    })
  );

  return {
    components: resolvedComponents,
    unmatchedCount: resolvedComponents.filter(
      (component) => component.matchStatus !== "unique"
    ).length,
    errors,
  };
}

export async function prepareProductFilamentDiscount({
  supabase,
  userId,
  items,
}: {
  supabase: SupabaseClient;
  userId: string;
  items: ProductFilamentDiscountItem[];
}): Promise<ProductFilamentDiscountPreparation> {
  const warnings = [
    "Esta acción descuenta filamentos y requiere confirmación explícita.",
    "No baja el stock de productos terminados todavía.",
  ];
  const blockers: ProductDiscountBlocker[] = [];
  const preparedProducts: PreparedProductDiscount[] = [];

  const { data: productData, error: productError } = await supabase
    .from("products")
    .select("id, user_id, name, stock_quantity, sale_price, image_url, is_active")
    .eq("user_id", userId)
    .eq("is_active", true);
  if (productError) {
    return {
      products: [],
      consumptions: [],
      blockers: [
        {
          code: "products_query_failed",
          message: "No pude consultar tus productos para preparar el descuento.",
        },
      ],
      warnings,
    };
  }

  const products = (productData ?? []) as ResolvedProduct[];
  const resolvedItems: Array<{
    product: ResolvedProduct;
    quantity: number;
  }> = [];
  for (const item of items) {
    const requestedName = normalizeProductReference(item.productName);
    const exactMatches = products.filter(
      (product) => normalizeProductReference(product.name) === requestedName
    );
    const candidates =
      exactMatches.length > 0
        ? exactMatches
        : products.filter((product) => {
            const candidate = normalizeProductReference(product.name);
            return candidate.includes(requestedName) || requestedName.includes(candidate);
          });

    if (candidates.length === 0) {
      blockers.push({
        code: "product_not_found",
        productName: item.productName,
        message: `No encontré un producto activo que coincida con ${item.productName}.`,
      });
      continue;
    }
    if (candidates.length > 1) {
      blockers.push({
        code: "product_ambiguous",
        productName: item.productName,
        message: `Encontré más de un producto parecido a ${item.productName}. Decime cuál querés usar o revisalos desde Productos.`,
      });
      continue;
    }
    resolvedItems.push({ product: candidates[0], quantity: item.quantity });
  }

  const productIds = Array.from(
    new Set(resolvedItems.map(({ product }) => product.id))
  );
  if (productIds.length === 0) {
    return { products: [], consumptions: [], blockers, warnings };
  }

  const { data: componentData, error: componentError } = await supabase
    .from("product_components")
    .select("id, product_id, name, quantity_per_product, is_active")
    .in("product_id", productIds)
    .eq("is_active", true);
  if (componentError) {
    blockers.push({
      code: "recipes_query_failed",
      message: "No pude consultar las recetas de tus productos.",
    });
    return { products: [], consumptions: [], blockers, warnings };
  }

  const components = (componentData ?? []) as Array<{
    id: string;
    product_id: string;
    name: string;
    quantity_per_product: number;
    is_active: boolean;
  }>;
  const componentIds = components.map((component) => component.id);
  const { data: materialData, error: materialError } = componentIds.length
    ? await supabase
        .from("product_component_filaments")
        .select(
          "id, component_id, filament_id, grams, filament_type, brand, name, color"
        )
        .in("component_id", componentIds)
    : { data: [], error: null };
  if (materialError) {
    blockers.push({
      code: "recipe_materials_query_failed",
      message: "No pude consultar los filamentos de las recetas.",
    });
    return { products: [], consumptions: [], blockers, warnings };
  }

  const materials = (materialData ?? []) as Array<{
    id: string;
    component_id: string;
    filament_id: string | null;
    grams: number;
    filament_type: string | null;
    brand: string | null;
    name: string | null;
    color: string | null;
  }>;
  const requestedFilamentIds = Array.from(
    new Set(
      materials
        .map((material) => material.filament_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  const { data: filamentData, error: filamentError } = requestedFilamentIds.length
    ? await supabase
        .from("filaments")
        .select(
          "id, user_id, name, filament_type, brand, color, remaining_grams, total_grams, is_active, filament_templates(brand)"
        )
        .in("id", requestedFilamentIds)
        .eq("user_id", userId)
        .eq("is_active", true)
    : { data: [], error: null };
  if (filamentError) {
    blockers.push({
      code: "filaments_query_failed",
      message: "No pude consultar el stock actual de filamentos.",
    });
    return { products: [], consumptions: [], blockers, warnings };
  }

  const filaments = (filamentData ?? []) as ResolvedFilament[];
  const filamentsById = new Map(filaments.map((filament) => [filament.id, filament]));
  const totals = new Map<string, number>();

  for (const { product, quantity } of resolvedItems) {
    const productComponents = components.filter(
      (component) => component.product_id === product.id
    );
    preparedProducts.push({
      productId: product.id,
      productName: product.name,
      quantity,
      componentsCount: productComponents.length,
    });
    if (productComponents.length === 0) {
      blockers.push({
        code: "recipe_missing",
        productName: product.name,
        message: `El producto ${product.name} no tiene receta de filamentos cargada.`,
      });
      continue;
    }

    for (const component of productComponents) {
      const componentMaterials = materials.filter(
        (material) => material.component_id === component.id
      );
      if (componentMaterials.length === 0) {
        blockers.push({
          code: "recipe_missing",
          productName: product.name,
          message: `El producto ${product.name} tiene un componente sin receta de filamentos.`,
        });
        continue;
      }

      const componentQuantity = Number(component.quantity_per_product);
      if (!Number.isFinite(componentQuantity) || componentQuantity <= 0) {
        blockers.push({
          code: "invalid_component_quantity",
          productName: product.name,
          message: `La receta de ${product.name} tiene una cantidad de componente inválida.`,
        });
        continue;
      }

      for (const material of componentMaterials) {
        const snapshot = [
          material.filament_type,
          material.brand,
          material.name,
          material.color,
        ]
          .filter(Boolean)
          .join(" ");
        if (!material.filament_id) {
          blockers.push({
            code: "filament_unresolved",
            productName: product.name,
            componentSnapshot: snapshot,
            message: `No puedo descontar ${product.name} todavía porque su receta incluye ${Number(
              material.grams
            )}g ${snapshot || "de un material sin identificar"} sin asociar a un filamento del stock. Abrí Productos, asociá el filamento correcto y volvé a intentarlo.`,
          });
          continue;
        }
        const filament = filamentsById.get(material.filament_id);
        if (!filament) {
          blockers.push({
            code: "filament_unavailable",
            productName: product.name,
            componentSnapshot: snapshot,
            message: `Un filamento de la receta de ${product.name} no existe, no está activo o no pertenece al usuario.`,
          });
          continue;
        }
        const grams = Number(material.grams);
        if (!Number.isFinite(grams) || grams <= 0) {
          blockers.push({
            code: "invalid_recipe_grams",
            productName: product.name,
            message: `La receta de ${product.name} contiene una cantidad de gramos inválida.`,
          });
          continue;
        }
        const required = grams * componentQuantity * quantity;
        totals.set(filament.id, (totals.get(filament.id) ?? 0) + required);
      }
    }
  }

  const consumptions = Array.from(totals.entries()).map(
    ([filamentId, requiredGrams]): PreparedFilamentConsumption => {
      const filament = filamentsById.get(filamentId)!;
      const remainingGrams = Number(filament.remaining_grams ?? 0);
      if (remainingGrams < requiredGrams) {
        blockers.push({
          code: "insufficient_stock",
          message: `No alcanza el stock de ${getResolvedFilamentLabel(
            filament
          )}: necesitás ${requiredGrams}g y te quedan ${remainingGrams}g.`,
        });
      }
      return {
        filamentId,
        label: getResolvedFilamentLabel(filament),
        requiredGrams,
        remainingGrams,
        afterRemainingGrams: remainingGrams - requiredGrams,
      };
    }
  );

  return { products: preparedProducts, consumptions, blockers, warnings };
}

function toNullableNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export async function executeFilamentStockMovement({
  supabase,
  actionRequestId,
}: ExecuteFilamentStockMovementParams): Promise<FilamentMovementExecutionResult> {
  const { data, error } = await supabase.rpc("confirm_stampy_filament_movement", {
    p_action_request_id: actionRequestId,
  });

  if (error) {
    console.error(
      "[Stampy] filament movement confirmation failed",
      error.message.substring(0, 200)
    );
    return {
      success: false,
      actionRequestId,
      filamentId: null,
      previousRemainingGrams: null,
      newRemainingGrams: null,
      deltaGrams: null,
      errorCode: "rpc_error",
      message: "Algo falló al confirmar el movimiento. No hice ningún cambio. Probá de nuevo o abrí Stock.",
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as RpcMovementResult | null;
  if (!row) {
    return {
      success: false,
      actionRequestId,
      filamentId: null,
      previousRemainingGrams: null,
      newRemainingGrams: null,
      deltaGrams: null,
      errorCode: "empty_rpc_result",
      message: "La confirmación no devolvió un resultado válido.",
    };
  }

  return {
    success: row.success === true,
    actionRequestId: row.action_request_id,
    filamentId: row.filament_id,
    previousRemainingGrams: toNullableNumber(row.previous_remaining_grams),
    newRemainingGrams: toNullableNumber(row.new_remaining_grams),
    deltaGrams: toNullableNumber(row.delta_grams),
    errorCode: row.error_code,
    message: row.message,
  };
}

export async function executeCreateFilament({
  supabase,
  actionRequestId,
}: ExecuteFilamentStockMovementParams): Promise<CreateFilamentExecutionResult> {
  const { data, error } = await supabase.rpc("confirm_stampy_create_filament", {
    p_action_request_id: actionRequestId,
  });

  if (error) {
    console.error(
      "[Stampy] filament creation confirmation failed",
      error.message.substring(0, 200)
    );
    return {
      success: false,
      actionRequestId,
      filamentId: null,
      label: null,
      totalGrams: null,
      remainingGrams: null,
      errorCode: "rpc_error",
      message: "Algo falló al crear el filamento. No hice ningún cambio. Probá de nuevo o abrí Stock.",
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | RpcCreateFilamentResult
    | null;
  if (!row) {
    return {
      success: false,
      actionRequestId,
      filamentId: null,
      label: null,
      totalGrams: null,
      remainingGrams: null,
      errorCode: "empty_rpc_result",
      message: "La creación no devolvió un resultado válido.",
    };
  }

  return {
    success: row.success === true,
    actionRequestId: row.action_request_id,
    filamentId: row.filament_id,
    label: row.label,
    totalGrams: toNullableNumber(row.total_grams),
    remainingGrams: toNullableNumber(row.remaining_grams),
    errorCode: row.error_code,
    message: row.message,
  };
}

export async function executeCreatePrinter({
  supabase,
  actionRequestId,
}: ExecuteFilamentStockMovementParams): Promise<CreatePrinterExecutionResult> {
  const { data, error } = await supabase.rpc("confirm_stampy_create_printer", {
    p_action_request_id: actionRequestId,
  });

  if (error) {
    console.error(
      "[Stampy] printer creation confirmation failed",
      error.message.substring(0, 200)
    );
    return {
      success: false,
      actionRequestId,
      printerId: null,
      printerName: null,
      powerWatts: null,
      maintenanceCostPerHour: null,
      errorCode: "rpc_error",
      message: "Algo falló al crear la impresora. No hice ningún cambio. Probá de nuevo o abrí Calculadora.",
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | RpcCreatePrinterResult
    | null;
  if (!row) {
    return {
      success: false,
      actionRequestId,
      printerId: null,
      printerName: null,
      powerWatts: null,
      maintenanceCostPerHour: null,
      errorCode: "empty_rpc_result",
      message: "La creación no devolvió un resultado válido.",
    };
  }

  return {
    success: row.success === true,
    actionRequestId: row.action_request_id,
    printerId: row.printer_id,
    printerName: row.printer_name,
    powerWatts: toNullableNumber(row.power_watts),
    maintenanceCostPerHour: toNullableNumber(
      row.maintenance_cost_per_hour
    ),
    errorCode: row.error_code,
    message: row.message,
  };
}

export async function executeCreateProduct({
  supabase,
  actionRequestId,
}: ExecuteFilamentStockMovementParams): Promise<CreateProductExecutionResult> {
  const { data, error } = await supabase.rpc("confirm_stampy_create_product", {
    p_action_request_id: actionRequestId,
  });

  if (error) {
    console.error(
      "[Stampy] product creation confirmation failed",
      error.message.substring(0, 200)
    );
    return {
      success: false,
      actionRequestId,
      productId: null,
      productName: null,
      componentsCount: null,
      unmatchedComponentsCount: null,
      errorCode: "rpc_error",
      message: "Algo falló al crear el producto. No hice ningún cambio. Probá de nuevo o abrí Productos.",
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | RpcCreateProductResult
    | null;
  if (!row) {
    return {
      success: false,
      actionRequestId,
      productId: null,
      productName: null,
      componentsCount: null,
      unmatchedComponentsCount: null,
      errorCode: "empty_rpc_result",
      message: "La creación no devolvió un resultado válido.",
    };
  }

  return {
    success: row.success === true,
    actionRequestId: row.action_request_id,
    productId: row.product_id,
    productName: row.product_name,
    componentsCount: toNullableNumber(row.components_count),
    unmatchedComponentsCount: toNullableNumber(
      row.unmatched_components_count
    ),
    errorCode: row.error_code,
    message: row.message,
  };
}

export async function executeProductFilamentDiscount({
  supabase,
  actionRequestId,
}: ExecuteFilamentStockMovementParams): Promise<ProductFilamentDiscountExecutionResult> {
  const { data, error } = await supabase.rpc(
    "confirm_stampy_discount_product_filaments",
    { p_action_request_id: actionRequestId }
  );

  if (error) {
    console.error(
      "[Stampy] product filament discount confirmation failed",
      error.message.substring(0, 200)
    );
    return {
      success: false,
      actionRequestId,
      productsCount: null,
      filamentsCount: null,
      totalGrams: null,
      errorCode: "rpc_error",
      message: "Algo falló al descontar los filamentos. No hice ningún cambio. Probá de nuevo o abrí Productos.",
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | RpcProductFilamentDiscountResult
    | null;
  if (!row) {
    return {
      success: false,
      actionRequestId,
      productsCount: null,
      filamentsCount: null,
      totalGrams: null,
      errorCode: "empty_rpc_result",
      message: "La confirmación no devolvió un resultado válido.",
    };
  }

  return {
    success: row.success === true,
    actionRequestId: row.action_request_id,
    productsCount: toNullableNumber(row.products_count),
    filamentsCount: toNullableNumber(row.filaments_count),
    totalGrams: toNullableNumber(row.total_grams),
    errorCode: row.error_code,
    message: row.message,
  };
}
