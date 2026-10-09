import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { parseStorageReference } from "@/lib/storage";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { getStlViewerSupport } from "@/lib/stl/library";

const PREVIEW_URL_TTL_SECONDS = 300;

/**
 * URL firmada de corta vida para que el viewer 3D lea un STL.
 * Mismas reglas de acceso que /api/stl/download (sesión + capability downloadStl) y,
 * además, exige que modelo y grupo estén publicados (salvo Admin).
 * El formato (stl | 3mf) se deduce del archivo guardado en DB, no de lo que envíe el cliente.
 * Nunca devuelve el path interno ni URLs externas.
 */
export async function POST(req: NextRequest) {
  try {
    const supabaseServer = await createClient();

    const { access } = await getCurrentUserAccess(supabaseServer);
    if (!access.authenticated || !access.userId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (!access.capabilities.downloadStl) {
      return NextResponse.json({ error: "Membresía inactiva o expirada" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const variantId = typeof body?.variantId === "string" ? body.variantId : "";
    if (!variantId) {
      return NextResponse.json({ error: "Falta variantId" }, { status: 400 });
    }

    const { data: variant } = await supabaseServer
      .from("stl_variants")
      .select("model_id, file_url, is_active")
      .eq("id", variantId)
      .maybeSingle();

    if (!variant) {
      return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
    }

    const canSeeInactive = access.capabilities.viewInactiveContent;
    if (!variant.is_active && !canSeeInactive) {
      return NextResponse.json({ error: "Archivo no disponible" }, { status: 403 });
    }

    const { data: model } = await supabaseServer
      .from("stl_models")
      .select("is_active, category_id")
      .eq("id", variant.model_id)
      .maybeSingle();

    if (!model || (!model.is_active && !canSeeInactive)) {
      return NextResponse.json({ error: "Modelo no encontrado" }, { status: 404 });
    }

    if (model.category_id && !canSeeInactive) {
      const { data: group } = await supabaseServer
        .from("stl_categories")
        .select("is_active")
        .eq("id", model.category_id)
        .maybeSingle();
      if (!group?.is_active) {
        return NextResponse.json({ error: "Modelo no encontrado" }, { status: 404 });
      }
    }

    const fileUrl = variant.file_url as string | null;
    const support = getStlViewerSupport(fileUrl);
    if (!support.supported) {
      return NextResponse.json({ error: support.reason, code: "unsupported" }, { status: 422 });
    }

    const parsedRef = fileUrl ? parseStorageReference(fileUrl) : null;
    if (!parsedRef) {
      return NextResponse.json({ error: "Formato de archivo no soportado", code: "unsupported" }, { status: 422 });
    }

    const supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { data, error: signError } = await supabaseAdmin.storage
      .from(parsedRef.bucket)
      .createSignedUrl(parsedRef.path, PREVIEW_URL_TTL_SECONDS);

    if (signError || !data?.signedUrl) {
      console.error("Error signing STL preview URL:", signError);
      return NextResponse.json({ error: "No se pudo acceder al archivo", code: "missing" }, { status: 404 });
    }

    return NextResponse.json({ url: data.signedUrl, format: support.format }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) {
    console.error("API stl/preview error:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
