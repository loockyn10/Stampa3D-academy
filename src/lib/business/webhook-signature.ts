import crypto from "node:crypto";

export function validateMercadoPagoWebhookSignature(input: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secret: string | undefined;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): boolean {
  if (!input.secret || !input.xSignature || !input.xRequestId || !input.dataId) return false;
  const parts = Object.fromEntries(input.xSignature.split(",").map((part) => part.trim().split("=", 2)));
  const timestamp = parts.ts;
  const signature = parts.v1;
  if (!timestamp || !signature || !/^\d+$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > (input.toleranceSeconds ?? 300)) return false;
  const manifest = `id:${input.dataId};request-id:${input.xRequestId};ts:${timestamp};`;
  const expected = crypto.createHmac("sha256", input.secret).update(manifest).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
}

export function stableWebhookEventId(payload: Record<string, unknown>, requestId: string, dataId: string): string {
  const providerId = typeof payload.id === "number" || typeof payload.id === "string" ? String(payload.id) : "";
  const action = typeof payload.action === "string" ? payload.action : "event";
  return providerId || crypto.createHash("sha256").update(`${requestId}:${action}:${dataId}`).digest("hex");
}

