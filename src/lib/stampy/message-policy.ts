export const STAMPY_MESSAGE_MAX_LENGTH = 4000;

export const STAMPY_MESSAGE_TOO_LONG_ERROR =
  "Tu mensaje es demasiado largo. Probá dividirlo en partes más chicas.";

type StampyMessageValidation =
  | { valid: true; message: string }
  | { valid: false; error: string };

export function validateStampyMessage(message: string): StampyMessageValidation {
  const trimmedMessage = typeof message === "string" ? message.trim() : "";

  if (!trimmedMessage) {
    return { valid: false, error: "Escribí un mensaje para consultar a Stampy." };
  }

  if (trimmedMessage.length > STAMPY_MESSAGE_MAX_LENGTH) {
    return { valid: false, error: STAMPY_MESSAGE_TOO_LONG_ERROR };
  }

  return { valid: true, message: trimmedMessage };
}
