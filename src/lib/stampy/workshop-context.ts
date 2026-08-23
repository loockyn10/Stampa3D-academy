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
    const { data: printers } = await supabase
      .from("user_printers")
      .select("*") 
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(10);

    if (printers && printers.length > 0) {
      printersCount = printers.length;
      text += "Impresoras cargadas:\n";
      printers.forEach((p: any) => {
        text += `- ${p.name} — ${p.power_watts || p.consumption_watts || 0}W\n`;
      });
      text += "\n";
    } else {
      text += "Impresoras cargadas:\nNo tiene impresoras cargadas.\n\n";
    }

    // 3. Filaments
    const { data: filaments } = await supabase
      .from("filaments")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(100); // Get up to 100 to process matching, we'll limit output

    const normalize = (t: string) => t ? t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : "";
    const q = normalize(message);

    // Common materials & colors to check if the query is specific
    const commonMaterials = ["pla", "petg", "abs", "asa", "tpu", "nylon", "resina"];
    const commonColors = ["negro", "blanco", "rojo", "azul", "verde", "amarillo", "gris", "transparente", "naranja", "violeta", "rosa", "marron", "natural"];
    
    // Extract brands dynamically from user's filaments
    const userBrands = Array.from(new Set(filaments?.map(f => normalize(f.brand)).filter(Boolean) || []));

    const isSpecificQuery = commonMaterials.some(m => q.includes(m)) || 
                            commonColors.some(c => q.includes(c)) || 
                            userBrands.some(b => q.includes(b));

    if (filaments && filaments.length > 0) {
      filamentsCount = filaments.length;

      if (isSpecificQuery) {
        // Find matches
        const matches = filaments.filter(f => {
          const label = normalize([f.filament_type, f.brand, f.name, f.color].filter(Boolean).join(" "));
          return q.split(/\s+/).filter(w => w.length > 2).some(w => label.includes(w));
        }).slice(0, 20); // max 20 for specific

        text += "Consulta específica de filamentos:\n";
        if (matches.length > 0) {
          text += `Coincidencias encontradas:\n`;
          let totalGrams = 0;
          matches.forEach((f: any) => {
            const label = [f.filament_type, f.brand, f.name, f.color].filter(Boolean).join(" ");
            text += `- ${label}: ${f.remaining_grams || f.remaining_quantity_grams || 0}g disponibles de ${f.total_grams || 1000}g\n`;
            totalGrams += Number(f.remaining_grams || f.remaining_quantity_grams || 0);
          });
          text += `\nTotal aproximado: ${totalGrams}g disponibles.\n\n`;
        } else {
          text += "No se encontraron filamentos activos que coincidan.\n\n";
        }
      } else {
        // General summary
        const types = Array.from(new Set(filaments.map(f => f.filament_type).filter(Boolean)));
        const colors = Array.from(new Set(filaments.map(f => f.color).filter(Boolean)));
        const lowStock = filaments.filter(f => Number(f.remaining_grams || f.remaining_quantity_grams || 0) < 100);

        text += "Filamentos activos:\n";
        text += `- Total: ${filamentsCount}\n`;
        text += `- Materiales: ${types.join(", ") || "Ninguno"}\n`;
        text += `- Colores: ${colors.join(", ") || "Ninguno"}\n`;
        text += `- Bajo stock: ${lowStock.length} filamentos con menos de 100g\n\n`;

        filaments.slice(0, 10).forEach((f: any) => {
          const label = [f.filament_type, f.brand, f.name, f.color].filter(Boolean).join(" ");
          text += `- ${label}: ${f.remaining_grams || f.remaining_quantity_grams || 0}g / ${f.total_grams || 1000}g\n`;
        });
        text += "\n";
      }
    } else {
      text += "Filamentos activos:\nNo tiene filamentos cargados.\n\n";
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

      if (q.includes("producto") || q.includes("stock")) {
        const matches = products.filter(p => normalize(p.name).split(/\s+/).some(w => w.length > 3 && q.includes(w)));
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

    console.log("[Stampy] workshop context", {
      userId,
      printersCount,
      filamentsCount,
      productsCount,
      contextChars: text.length,
    });

  } catch (error) {
    console.error("[Stampy] getStampyWorkshopContext error", error);
  }

  return { text };
}
