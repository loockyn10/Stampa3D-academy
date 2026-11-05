import crypto from "node:crypto";

/**
 * Bunny Stream "Embed view token authentication" (docs.bunny.net): token = SHA256_HEX(token_security_key +
 * video_id + expires), `expires` in UNIX seconds, both added to the embed URL. Server-side only: the key never
 * reaches the browser. With token authentication enabled in the Bunny library, an embed URL without a valid,
 * unexpired token answers 403, so a shared link stops working when it expires.
 */
export const BUNNY_EMBED_TOKEN_TTL_SECONDS = 4 * 60 * 60;

export function signBunnyEmbedUrl(input: {
  embedUrl: string;
  videoId: string;
  tokenKey: string;
  now: Date;
  ttlSeconds?: number;
}): string {
  const expires = Math.floor(input.now.getTime() / 1000) + (input.ttlSeconds ?? BUNNY_EMBED_TOKEN_TTL_SECONDS);
  const token = crypto.createHash("sha256").update(`${input.tokenKey}${input.videoId}${expires}`).digest("hex");
  const url = new URL(input.embedUrl);
  url.searchParams.set("token", token);
  url.searchParams.set("expires", String(expires));
  return url.toString();
}
