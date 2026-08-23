import { SupabaseClient } from "@supabase/supabase-js";

export async function getStampyWorkshopContext({
  supabase,
  userId,
  message,
}: {
  supabase: SupabaseClient;
  userId: string;
  message: string;
}) {
  let text = "";
  let printersCount = 0;
  let filamentsCount = 0;
  let productsCount = 0;

  function normalizeSearchText(value: unknown) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  let isFilamentQuery = false;
  let isProductQuery = false;

  try {
    // 1. Profile / Onboarding
    const { data: profile } = await supabase
      .from("profiles")
      .select(`
        full_name,
        display_name,
        company_name,
        company_city,
        main_printer_brand,
        main_printer_model,
        experience_level,
        main_goal,
        slicer_preference,
        commercial_stage,
        member_level
      `)
      .eq("id", userId)
      .single();

    if (profile) {
      const p = [];
      if (profile.full_name || profile.display_name) p.push(`- Nombre: ${profile.display_name || profile.full_name}`);
      if (profile.company_name) p.push(`- Empresa: ${profile.company_name}`);
      if (profile.company_city) p.push(`- Ciudad: ${profile.company_city}`);
      if (profile.experience_level) p.push(`- Nivel: ${profile.experience_level}`);
      if (profile.main_goal) p.push(`- Objetivo: ${profile.main_goal}`);
      if (profile.main_printer_brand || profile.main_printer_model) p.push(`- Impresora principal declarada: ${profile.main_printer_brand || ""} ${profile.main_printer_model || ""}`.trim());
      if (profile.slicer_preference) p.push(`- Slicer: ${profile.slicer_preference}`);
      if (profile.commercial_stage) p.push(`- Etapa comercial: ${profile.commercial_stage}`);
      
      if (p.length > 0) {
        text += "Perfil del usuario:\n" + p.join("\n") + "\n\n";
      }
    }

    // 2. Printers
    const { data: printers, error: printersError } = await supabase
      .from("printers")
      .select("name,power_watts,maintenance_cost_per_hour,is_active")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(10);

    if (printersError) {
      console.error("[Stampy] printers query failed", printersError);
    }

    if (printers && printers.length > 0) {
      printersCount = printers.length;
      text += "Impresoras cargadas en el taller:\n";
      printers.forEach((p: any) => {
        text += `- ${p.name} — ${p.power_watts || 0}W\n`;
      });
      text += "\n";
    } else {
      text += "Impresoras cargadas:\nNo tiene impresoras cargadas.\n\n";
    }

    // 3. Filaments
    const { data: activeFilaments, error: activeFilamentsError } = await supabase
      .from("filaments")
      .select(`
        id,
        filament_type,
        brand,
        name,
        color,
        remaining_grams,
        total_grams,
        is_active,
        created_at
      `)
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(50);

    if (activeFilamentsError) {
      console.error("[Stampy] active filaments query failed", activeFilamentsError);
      text += "No pude leer los filamentos por un error interno.\n\n";
    }

    console.log("[Stampy] active filaments debug", {
      userId,
      activeFilamentsError: activeFilamentsError?.message ?? null,
      activeFilamentsCount: activeFilaments?.length ?? null,
      sample: activeFilaments?.slice(0, 5).map((f: any) => ({
        filament_type: f.filament_type,
        brand: f.brand,
        name: f.name,
        color: f.color,
        remaining_grams: f.remaining_grams,
        total_grams: f.total_grams,
        is_active: f.is_active,
      })),
    });

    function getFilamentLabel(filament: any) {
      return [
        filament.filament_type,
        filament.brand,
        filament.name,
        filament.color,
      ].filter(Boolean).join(" ");
    }

    const q = normalizeSearchText(message);

    const KNOWN_FILAMENT_TYPES = [
      "pla", "pla rapid", "pla silk", "petg", "tpu", "abs", "asa", "nylon", "resina", "pc", "pva"
    ];
    
    // Extract brands dynamically from user's filaments
    const userBrands = Array.from(new Set(activeFilaments?.map(f => normalizeSearchText(f.brand)).filter(Boolean) || []));

    const detectedMaterial = KNOWN_FILAMENT_TYPES.find(m => q.includes(m));
    const detectedBrand = userBrands.find(b => q.includes(b));
    const hasFilamentKeyword = ["filamento", "filamentos", "material", "materiales"].some(kw => q.includes(kw));

    isFilamentQuery = Boolean(detectedMaterial || detectedBrand || hasFilamentKeyword);

    let matchedFilaments: any[] = [];
    let relevantTokens: string[] = [];

    if (activeFilaments && activeFilaments.length > 0) {
      filamentsCount = activeFilaments.length;

      // Enhance filaments with searchableText
      const filaments = activeFilaments.map((f: any) => {
        const searchableText = normalizeSearchText(getFilamentLabel(f));
        return { ...f, searchableText };
      });

      if (isFilamentQuery) {
        // Extract relevant tokens
        const ignoreWords = ["tengo", "tenes", "tenés", "cuanto", "cuánto", "filamento", "filamentos", "material", "materiales", "de", "del", "la", "el", "un", "una", "hay", "cargado", "cargados", "stock", "disponible", "disponibles"];
        relevantTokens = q.split(/\s+/).filter(w => w.length > 0 && !ignoreWords.includes(w));

        if (relevantTokens.length > 0) {
          matchedFilaments = filaments.filter(f => 
            relevantTokens.every(token => f.searchableText.includes(token))
          );
        }

        if (relevantTokens.length > 0) {
          if (matchedFilaments.length > 0) {
            text += "Consulta específica de filamentos:\n";
            text += `Coincidencias para "${relevantTokens.join(" ")}":\n`;
            let totalGrams = 0;
            matchedFilaments.forEach((f: any) => {
              text += `- ${getFilamentLabel(f)}: ${f.remaining_grams || 0}g disponibles de ${f.total_grams || 1000}g\n`;
              totalGrams += Number(f.remaining_grams || 0);
            });
            text += `\nTotal aproximado: ${totalGrams}g disponibles.\n\n`;
          } else {
            text += `No se encontraron filamentos activos que coincidan con "${relevantTokens.join(" ")}".\n\n`;
          }
        } else {
          // If they just asked "Tengo filamentos?" without specific tokens
          text += "Filamentos activos (resumen):\n";
          text += `- Total activos: ${filamentsCount}\n\n`;
          text += "Listado:\n";
          filaments.slice(0, 10).forEach((f: any) => {
            text += `- ${getFilamentLabel(f)}: ${f.remaining_grams || 0}g / ${f.total_grams || 1000}g\n`;
          });
          text += "\n";
        }
      } else {
        // General summary
        const types = Array.from(new Set(filaments.map((f: any) => f.filament_type).filter(Boolean)));
        const brands = Array.from(new Set(filaments.map((f: any) => f.brand).filter(Boolean)));
        const colors = Array.from(new Set(filaments.map((f: any) => f.color).filter(Boolean)));
        
        text += "Filamentos activos:\n";
        text += `- Total activos: ${filamentsCount}\n`;
        text += `- Materiales: ${types.join(", ") || "Ninguno"}\n`;
        text += `- Marcas: ${brands.join(", ") || "Ninguna"}\n`;
        text += `- Colores: ${colors.join(", ") || "Ninguno"}\n\n`;

        text += "Listado:\n";
        filaments.slice(0, 10).forEach((f: any) => {
          text += `- ${getFilamentLabel(f)}: ${f.remaining_grams || 0}g / ${f.total_grams || 1000}g\n`;
        });
        text += "\n";
      }
    } else {
      if (activeFilaments && !activeFilamentsError && activeFilaments.length === 0) {
        text += "No tenés filamentos activos en el taller.\n\n";
      }
    }

    // 4. Products
    const { data: products } = await supabase
      .from("products")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(50);

      if (products && products.length > 0) {
      productsCount = products.length;
      const lowStockProducts = products.filter(p => Number(p.stock_quantity || 0) <= 0);
      
      text += "Productos:\n";
      text += `- Total activos: ${productsCount}\n`;
      text += `- Con stock bajo/cero: ${lowStockProducts.length}\n\n`;

      const productKeywords = ["producto", "productos", "stock de producto", "artículo", "articulo", "artículos", "articulos", "venta", "vendo", "catálogo", "catalogo", "precio de venta"];
      isProductQuery = productKeywords.some(kw => q.includes(kw));

      if (isProductQuery && !isFilamentQuery) {
        const matches = products.filter(p => normalizeSearchText(p.name).split(/\s+/).some(w => w.length > 3 && q.includes(w)));
        const toShow = matches.length > 0 ? matches.slice(0, 10) : products.slice(0, 5);
        
        toShow.forEach((p: any) => {
          text += `- ${p.name}: ${p.stock_quantity || 0} en stock (Precio: $${p.sale_price || p.price || 0})\n`;
        });
        text += "\n";
      }
    } else {
      text += "Productos:\nNo tiene productos cargados.\n\n";
    }

    // Truncate if too long
    if (text.length > 2500) {
      text = text.substring(0, 2450) + "\n\n...Contexto del taller resumido por tamaño.";
    }

    console.log("[Stampy] filament intent", {
      filamentsCount,
      relevantTokens: typeof relevantTokens !== 'undefined' ? relevantTokens : [],
      matchedFilamentsCount: typeof matchedFilaments !== 'undefined' ? matchedFilaments.length : 0,
      detectedAsFilamentQuery: typeof isFilamentQuery !== 'undefined' ? isFilamentQuery : false,
    });

  } catch (error) {
    console.error("[Stampy] getStampyWorkshopContext error", error);
  }

  return { text, isFilamentQuery, isProductQuery };
}
