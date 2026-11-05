import crypto from "node:crypto";

/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Fails closed: without a configured secret (or a short one)
 * nothing is accepted. Constant-time comparison.
 */
export function isAuthorizedCronRequest(authorization: string | null, secret: string | undefined | null): boolean {
  if (!secret || secret.length < 16 || !authorization) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match) return false;
  const expected = crypto.createHash("sha256").update(secret).digest();
  const received = crypto.createHash("sha256").update(match[1]).digest();
  return crypto.timingSafeEqual(expected, received);
}
