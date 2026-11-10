import "server-only";
import { createClient } from "@supabase/supabase-js";
import { readPublicMembershipPrice, type PublicMembershipPrice } from "./membership-price";

/**
 * Lectura del precio para la página pública. `membership_settings` no tiene permiso de lectura para visitantes anónimos
 * (a propósito), así que se lee SOLO en el servidor con la clave de servicio, pidiendo únicamente `monthly_price` y `currency`.
 * La clave nunca llega al navegador (este módulo es `server-only`) y la página se regenera cada pocos minutos (ISR).
 * No modifica nada: es una lectura. Si falta configuración o la lectura falla, devuelve `null` (estado provisional).
 */
export async function loadPublicMembershipPrice(): Promise<PublicMembershipPrice | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  // El cliente de supabase-js es estructuralmente compatible; el cast evita una instanciación de tipos excesivamente profunda.
  return readPublicMembershipPrice(client as unknown as Parameters<typeof readPublicMembershipPrice>[0]);
}
