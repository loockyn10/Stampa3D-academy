/**
 * Precio mensual público de la membresía, leído de `membership_settings` (la ÚNICA fuente de precio del checkout).
 *
 * Esta parte es pura (recibe el cliente), así se puede testear sin red. La lectura real del servidor está en
 * `load-membership-price.ts`. Nunca hay precio de respaldo: si la lectura falla, el resultado es `null` y la sección muestra su
 * estado provisional («el valor se muestra antes de confirmar»).
 */

export type PublicMembershipPrice = { amount: number; currency: string };

type SettingsClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> };
    };
  };
};

/** Solo se piden estas dos columnas: nada más de `membership_settings` sale de la base. */
export const PUBLIC_PRICE_COLUMNS = "monthly_price, currency";

export async function readPublicMembershipPrice(client: SettingsClient): Promise<PublicMembershipPrice | null> {
  try {
    const { data, error } = await client.from("membership_settings").select(PUBLIC_PRICE_COLUMNS).eq("id", "default").maybeSingle();
    if (error || !data || typeof data !== "object") return null;
    const row = data as { monthly_price?: unknown; currency?: unknown };
    const amount = Number(row.monthly_price);
    const currency = String(row.currency ?? "ARS").toUpperCase();
    if (!Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency)) return null;
    return { amount, currency };
  } catch {
    return null;
  }
}

/** «$ 15.000» (es-AR). Sin decimales si el monto es entero. */
export function formatMembershipPrice(price: PublicMembershipPrice): string {
  const whole = Number.isInteger(price.amount);
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: price.currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(price.amount);
}
