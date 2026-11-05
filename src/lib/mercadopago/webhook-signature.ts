import crypto from "node:crypto";

/**
 * Validates the `x-signature` header Mercado Pago sends with every webhook (membership webhook).
 *
 * Manifest (official docs): `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` signed with HMAC-SHA256 and the
 * application's webhook secret. A pair whose value is missing from the notification is omitted from the manifest, and
 * an alphanumeric `data.id` is lowercased. The comparison is constant time.
 *
 * There is deliberately no timestamp window: the docs are ambiguous about `ts` being seconds or milliseconds, and a
 * replayed (valid) notification is harmless because processing re-reads the current state from Mercado Pago and is
 * idempotent. Fails closed: no secret, no header or a malformed header → invalid.
 */
export function verifyMembershipWebhookSignature(input: {
  secret: string | undefined | null;
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
}): boolean {
  if (!input.secret || !input.xSignature) return false;

  let ts: string | null = null;
  let v1: string | null = null;
  for (const part of input.xSignature.split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "ts") ts = value;
    if (key === "v1") v1 = value;
  }

  if (!ts || !/^\d+$/.test(ts) || !v1 || !/^[a-f0-9]{64}$/i.test(v1)) return false;

  const dataId = input.dataId ? input.dataId.trim().toLowerCase() : "";
  const requestId = input.xRequestId ? input.xRequestId.trim() : "";
  const manifest =
    (dataId ? `id:${dataId};` : "") + (requestId ? `request-id:${requestId};` : "") + `ts:${ts};`;

  const expected = crypto.createHmac("sha256", input.secret).update(manifest).digest();
  const received = Buffer.from(v1.toLowerCase(), "hex");
  return received.length === expected.length && crypto.timingSafeEqual(expected, received);
}
