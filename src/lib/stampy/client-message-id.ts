let fallbackSequence = 0;

export function createStampyRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  fallbackSequence += 1;
  return `${Date.now()}-${fallbackSequence}`;
}

export function createStampyMessageId(
  requestId: string,
  role: "user" | "assistant"
): string {
  return `${requestId}:${role}`;
}
