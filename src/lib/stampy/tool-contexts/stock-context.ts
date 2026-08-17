import { createClient } from "@/utils/supabase/server";

export type SpecificFilamentStockQuery = {
  detectedMaterial?: string;
  detectedColor?: string;
  matches: Array<{
    name: string;
    material?: string | null;
    color?: string | null;
    remainingGrams: number;
    totalGrams?: number | null;
  }>;
  totalRemainingGrams: number;
};

export type StampyStockContext = {
  totalFilaments: number;
  lowStockFilaments: Array<{
    name: string;
    material?: string | null;
    color?: string | null;
    remainingGrams: number;
  }>;
  emptyFilaments: Array<{
    name: string;
    material?: string | null;
    color?: string | null;
  }>;
  totalProducts: number;
  outOfStockProducts: Array<{
    name: string;
    stockQuantity: number;
  }>;
  lowStockProducts: Array<{
    name: string;
    stockQuantity: number;
  }>;
  lowMarginProducts?: Array<{
    name: string;
    salePrice: number;
    baseCost: number;
    marginPercent: number;
  }>;
  recentMovements?: Array<{
    label: string;
    createdAt: string;
  }>;
  specificFilamentQuery?: SpecificFilamentStockQuery;
};

function parseFilamentStockQuery(message: string) {
  const normalized = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  const materials = ["pla+", "pla", "petg", "abs", "asa", "tpu", "nylon", "pa", "pc", "resina", "flex", "hips", "pva"];
  const colors = [
    "rojo", "azul", "negro", "blanco", "gris", "verde", "amarillo", "naranja", "violeta", 
    "morado", "rosa", "fucsia", "cian", "celeste", "turquesa", "marron", "beige", "crema", 
    "dorado", "cobre", "plateado", "transparente"
  ];

  let detectedMaterial: string | undefined;
  for (const m of materials) {
    if (normalized.includes(m)) {
      detectedMaterial = m;
      break;
    }
  }

  let detectedColor: string | undefined;
  for (const c of colors) {
    if (normalized.includes(c)) {
      detectedColor = c;
      break;
    }
  }

  return { detectedMaterial, detectedColor };
}

export async function getStampyStockContext(userId: string, message?: string): Promise<StampyStockContext | null> {
  try {
    const supabase = await createClient();

    // 1. Filamentos activos
    const { data: filaments, error: filamentsError } = await supabase
      .from("filaments")
      .select("id, name, filament_type, color, color_hex, total_grams, remaining_grams")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (filamentsError) {
      console.error("[Stampy] stock context filaments error", filamentsError);
      return null;
    }

    const totalFilaments = filaments?.length || 0;
    
    // Low: > 0 and <= 100
    const lowStockFilamentsData = (filaments || [])
      .filter(f => (f.remaining_grams || 0) > 0 && (f.remaining_grams || 0) <= 100)
      .slice(0, 5)
      .map(f => ({
        name: f.name,
        material: f.filament_type,
        color: f.color,
        remainingGrams: f.remaining_grams || 0
      }));

    // Empty: <= 0
    const emptyFilamentsData = (filaments || [])
      .filter(f => (f.remaining_grams || 0) <= 0)
      .slice(0, 5)
      .map(f => ({
        name: f.name,
        material: f.filament_type,
        color: f.color
      }));

    let specificFilamentQuery: SpecificFilamentStockQuery | undefined;

    if (message) {
      const { detectedMaterial, detectedColor } = parseFilamentStockQuery(message);
      if (detectedMaterial || detectedColor) {
        const matches = (filaments || []).filter(f => {
          const nameNorm = (f.name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          const typeNorm = (f.filament_type || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          const colorNorm = (f.color || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

          let matchMat = true;
          if (detectedMaterial) {
            matchMat = typeNorm.includes(detectedMaterial) || nameNorm.includes(detectedMaterial);
          }

          let matchCol = true;
          if (detectedColor) {
            matchCol = colorNorm.includes(detectedColor) || nameNorm.includes(detectedColor);
          }

          return matchMat && matchCol;
        });

        const totalRemainingGrams = matches.reduce((acc, curr) => acc + (curr.remaining_grams || 0), 0);
        
        specificFilamentQuery = {
          detectedMaterial: detectedMaterial ? detectedMaterial.toUpperCase() : undefined,
          detectedColor: detectedColor ? detectedColor.charAt(0).toUpperCase() + detectedColor.slice(1) : undefined,
          matches: matches.slice(0, 10).map(m => ({
            name: m.name,
            material: m.filament_type,
            color: m.color,
            remainingGrams: m.remaining_grams || 0,
            totalGrams: m.total_grams
          })),
          totalRemainingGrams
        };
      }
    }

    // 2. Productos activos
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, name, stock_quantity, sale_price, base_cost")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (productsError) {
      console.error("[Stampy] stock context products error", productsError);
      return null;
    }

    const totalProducts = products?.length || 0;

    // Out of stock: <= 0
    const outOfStockProducts = (products || [])
      .filter(p => (p.stock_quantity || 0) <= 0)
      .slice(0, 5)
      .map(p => ({
        name: p.name,
        stockQuantity: p.stock_quantity || 0
      }));

    // Low stock: > 0 and <= 2
    const lowStockProducts = (products || [])
      .filter(p => (p.stock_quantity || 0) > 0 && (p.stock_quantity || 0) <= 2)
      .slice(0, 5)
      .map(p => ({
        name: p.name,
        stockQuantity: p.stock_quantity || 0
      }));

    // Low margin
    const lowMarginProducts = (products || [])
      .map(p => {
        const salePrice = p.sale_price || 0;
        const baseCost = p.base_cost || 0;
        let marginPercent = 0;
        if (salePrice > 0) {
          marginPercent = ((salePrice - baseCost) / salePrice) * 100;
        }
        return {
          name: p.name,
          salePrice,
          baseCost,
          marginPercent
        };
      })
      .filter(p => p.salePrice > 0)
      .sort((a, b) => a.marginPercent - b.marginPercent)
      .slice(0, 3);

    // 3. Movimientos recientes
    let recentMovements: Array<{label: string, createdAt: string}> = [];
    try {
      const { data: fMovements } = await supabase
        .from("filament_stock_movements")
        .select("amount, type, created_at, filaments(name)")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(3);

      const { data: pMovements } = await supabase
        .from("product_stock_movements")
        .select("quantity, type, created_at, products(name)")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(3);

      if (fMovements) {
        recentMovements.push(...fMovements.map(m => {
          const fName = Array.isArray(m.filaments) ? m.filaments[0]?.name : (m.filaments as any)?.name;
          return {
            label: `${m.type === 'add' ? '+' : '-'}${m.amount}g de ${fName || 'filamento'}`,
            createdAt: m.created_at
          };
        }));
      }
      if (pMovements) {
        recentMovements.push(...pMovements.map(m => {
          const pName = Array.isArray(m.products) ? m.products[0]?.name : (m.products as any)?.name;
          return {
            label: `${m.type === 'add' ? '+' : '-'}${m.quantity} un. de ${pName || 'producto'}`,
            createdAt: m.created_at
          };
        }));
      }
      
      recentMovements = recentMovements
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 5);

    } catch (movError) {
      console.error("[Stampy] stock context movements ignored", movError);
    }

    return {
      totalFilaments,
      lowStockFilaments: lowStockFilamentsData,
      emptyFilaments: emptyFilamentsData,
      totalProducts,
      outOfStockProducts,
      lowStockProducts,
      lowMarginProducts,
      recentMovements,
      specificFilamentQuery
    };

  } catch (error) {
    console.error("[Stampy] stock context failed", error);
    return null;
  }
}
