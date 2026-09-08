import "server-only";
import crypto from "node:crypto";

const VERSION = "v1";

function encryptionKey(): Buffer {
  const configured = process.env.BUSINESS_PAYMENT_TOKEN_ENCRYPTION_KEY;
  if (!configured) throw new Error("BUSINESS_PAYMENT_TOKEN_ENCRYPTION_KEY no configurada");
  const decoded = Buffer.from(configured, "base64");
  if (decoded.length !== 32) throw new Error("BUSINESS_PAYMENT_TOKEN_ENCRYPTION_KEY debe contener 32 bytes en base64");
  return decoded;
}

export function encryptBusinessSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptBusinessSecret(value: string): string {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== VERSION || !ivValue || !tagValue || !encryptedValue) throw new Error("Credencial cifrada inválida");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createPkcePair() {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

