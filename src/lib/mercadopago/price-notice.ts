import type { PriceNoticeMailer } from "@/lib/mercadopago/price-schedule-runner";

/**
 * Notice e-mail sent BEFORE the promotional price ends. Transactional only (one per schedule and debit date); sent
 * through Resend when RESEND_API_KEY and PRICE_NOTICE_FROM are configured. Without them nothing is sent and, because the
 * runner requires a sent notice, the price is never raised.
 */

export interface PriceNoticeInput {
  promoPrice: number;
  postPrice: number;
  currency: string;
  changeDate: Date;
  appUrl: string | null;
}

export function formatPrice(amount: number, currency: string): string {
  const code = currency.toUpperCase();
  const formatted = new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return code === "ARS" ? `$${formatted}` : `${formatted} ${code}`;
}

export function formatNoticeDate(date: Date): string {
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" }).format(date);
}

export function buildPriceChangeNotice(input: PriceNoticeInput): { subject: string; text: string; html: string } {
  const promo = formatPrice(input.promoPrice, input.currency);
  const post = formatPrice(input.postPrice, input.currency);
  const date = formatNoticeDate(input.changeDate);
  const manage = input.appUrl ? new URL("/configuracion", input.appUrl).toString() : null;

  const subject = `Tu precio promocional de Universo Stampa cambia el ${date}`;
  const lines = [
    "Hola,",
    "",
    `Tu membresía Premium de Universo Stampa tiene un precio promocional de ${promo} por mes, que se mantiene durante tus primeros meses de suscripción.`,
    `A partir de tu cobro del ${date} pasarás a pagar ${post} por mes, el precio que aceptaste al contratar. Mercado Pago aplicará el nuevo importe automáticamente: no tenés que hacer nada para seguir con tu membresía.`,
    "Si no querés continuar con el nuevo importe, podés cancelar tu suscripción antes de esa fecha; conservás el acceso hasta el fin del período que ya pagaste.",
    ...(manage ? ["", `Podés ver y gestionar tu membresía acá: ${manage}`] : []),
    "",
    "Equipo Universo Stampa",
  ];
  const text = lines.join("\n");
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a">${lines
    .map((line) => (line ? `<p>${escape(line)}</p>` : ""))
    .join("")}</div>`;
  return { subject, text, html };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AuthUserLookup {
  auth: { admin: { getUserById(id: string): Promise<{ data: { user: { email?: string | null } | null }; error: unknown }> } };
}

export function createResendPriceNoticeMailer(input: {
  admin: AuthUserLookup;
  apiKey: string;
  from: string;
  appUrl: string | null;
  fetchImpl?: FetchLike;
}): PriceNoticeMailer {
  const fetchImpl = input.fetchImpl ?? ((url, init) => fetch(url, init));
  return {
    async sendPriceChangeNotice(notice) {
      const { data, error } = await input.admin.auth.admin.getUserById(notice.userId);
      const to = data?.user?.email;
      if (error || !to) return { ok: false, error: "recipient_not_found" };

      const message = buildPriceChangeNotice({
        promoPrice: notice.promoPrice,
        postPrice: notice.postPrice,
        currency: notice.currency,
        changeDate: notice.changeDate,
        appUrl: input.appUrl,
      });
      let response: Response;
      try {
        response = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${input.apiKey}`,
            "Content-Type": "application/json",
            // The same notice is never delivered twice if a retry races with a slow answer.
            "Idempotency-Key": `price-notice-${notice.scheduleId}-${notice.changeDate.toISOString().slice(0, 10)}-${notice.sequence}`,
          },
          body: JSON.stringify({ from: input.from, to: [to], subject: message.subject, text: message.text, html: message.html }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (caught) {
        return { ok: false, error: caught instanceof Error ? caught.name : "network_error" };
      }
      return response.ok ? { ok: true } : { ok: false, error: `resend_http_${response.status}` };
    },
  };
}

/**
 * `reason` of the preapproval: what the payer reads in Mercado Pago's own screen. It states the promotional price, how
 * many monthly periods it lasts and the price that follows (kept short: Mercado Pago documents no maximum length).
 */
export function promoCheckoutReason(promoPrice: number, terms: { promoCycles: number; postPrice: number }, currency: string): string {
  const promo = formatPrice(promoPrice, currency);
  const post = formatPrice(terms.postPrice, currency);
  const months = terms.promoCycles === 1 ? "1 mes" : `${terms.promoCycles} meses`;
  return `Membresía Academia Stampa - ${promo}/mes por ${months}, luego ${post}/mes`;
}

/** Alert e-mail to the administrator (PRICE_ALERT_EMAIL). Same provider and sender as the customer notices. */
export function createResendAdminMailer(input: {
  apiKey: string;
  from: string;
  to: string;
  fetchImpl?: FetchLike;
}): { send(message: { subject: string; text: string }): Promise<{ ok: boolean; error?: string }> } {
  const fetchImpl = input.fetchImpl ?? ((url, init) => fetch(url, init));
  return {
    async send(message) {
      try {
        const response = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: input.from, to: [input.to], subject: message.subject, text: message.text }),
          signal: AbortSignal.timeout(10_000),
        });
        return response.ok ? { ok: true } : { ok: false, error: `resend_http_${response.status}` };
      } catch (caught) {
        return { ok: false, error: caught instanceof Error ? caught.name : "network_error" };
      }
    },
  };
}
