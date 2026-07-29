import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { isExternalUrl, parseStorageReference } from "@/lib/storage";

export async function POST(req: NextRequest) {
  try {
    const supabaseServer = await createClient();
    
    // 1. Validar autenticación
    const { data: { user } } = await supabaseServer.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // 2. Obtener payload (variantId)
    const body = await req.json();
    const { variantId } = body;
    if (!variantId) {
      return NextResponse.json({ error: "Falta variantId" }, { status: 400 });
    }

    // 3. Validar acceso a la plataforma
    const { data: profile } = await supabaseServer
      .from("profiles")
      .select("membership_status, role, membership_expires_at")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "Perfil no encontrado" }, { status: 403 });
    }

    const membershipStatus = profile.membership_status;
    const role = profile.role;
    const expiresAt = profile.membership_expires_at;

    let hasAccess = role === "admin";
    if (!hasAccess && membershipStatus === "active") {
      if (!expiresAt) {
        hasAccess = true;
      } else {
        hasAccess = new Date(expiresAt).getTime() > Date.now();
      }
    }

    if (!hasAccess) {
      return NextResponse.json({ error: "Membresía inactiva o expirada" }, { status: 403 });
    }

    // 4. Buscar la variante
    const { data: variant, error: varError } = await supabaseServer
      .from("stl_variants")
      .select("file_url, is_active")
      .eq("id", variantId)
      .single();

    if (varError || !variant) {
      return NextResponse.json({ error: "Variante no encontrada" }, { status: 404 });
    }

    if (!variant.is_active && role !== "admin") {
      return NextResponse.json({ error: "Variante inactiva" }, { status: 403 });
    }

    const fileUrl = variant.file_url;
    if (!fileUrl) {
      return NextResponse.json({ error: "La variante no tiene archivo asociado" }, { status: 404 });
    }

    // 5. Procesar archivo según tipo
    if (isExternalUrl(fileUrl)) {
      // URL externa (Google Drive), mantener compatibilidad
      return NextResponse.json({ url: fileUrl });
    }

    const parsedRef = parseStorageReference(fileUrl);
    if (parsedRef) {
      // Archivo privado, generar Signed URL con service_role client para evitar problemas de RLS.
      // (Asumiendo que el usuario ya fue validado arriba, tenemos derecho a entregarle la URL).
      const supabaseAdmin = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      const { data, error: signError } = await supabaseAdmin.storage
        .from(parsedRef.bucket)
        .createSignedUrl(parsedRef.path, 60, { download: true });

      if (signError || !data?.signedUrl) {
        console.error("Error signing URL:", signError);
        return NextResponse.json({ error: "Error al generar enlace de descarga" }, { status: 500 });
      }

      return NextResponse.json({ url: data.signedUrl });
    }

    return NextResponse.json({ error: "Formato de archivo no soportado" }, { status: 400 });

  } catch (error: any) {
    console.error("API stl/download error:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
