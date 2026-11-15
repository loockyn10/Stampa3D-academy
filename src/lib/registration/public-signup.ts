/**
 * Qué muestra el alta pública (/registro). Solo controla la VISIBILIDAD de campos y textos: la infraestructura de
 * invitaciones Beta (`beta_access_codes`, canje desde Perfil) y la de referidos (`referrals`, callback de auth) siguen
 * intactas en el backend.
 *
 * - La Beta ya no es parte del alta pública (lanzamiento comercial, 2026-11): nadie necesita un código para registrarse.
 * - El programa de referidos (y los sorteos asociados) se habilita con ~20–30 miembros activos. Hasta entonces no se
 *   pide ni se anuncia. Un enlace `/registro?ref=…` o `?invite=…` (por ejemplo, el que genera /admin/codigos) se sigue
 *   procesando en silencio, igual que antes.
 *
 * Para activar el programa de referidos: cambiar REFERRAL_PROGRAM_PUBLIC a `true` (muestra el campo en el registro y la
 * tarjeta del código propio en Perfil). Revisar antes los textos de Sorteos y las bases legales.
 */
export const REFERRAL_PROGRAM_PUBLIC = false;

/**
 * Campo «¿Tenés un código de invitación?» en el alta (/registro) y en la pantalla de contratación (/sin-acceso). Con
 * `false` el checkout solo muestra el código de DESCUENTO (sin mezclarlo con invitaciones). El canje de un código Beta
 * o de acceso manual sigue disponible desde Perfil, y los enlaces `?invite=` se procesan igual.
 */
export const BETA_CODE_PUBLIC_ENTRY = false;

/**
 * La suscripción de Mercado Pago se crea con el correo de la cuenta como `payer_email` (create-subscription), y Mercado
 * Pago solo deja pagarla con la cuenta que tiene ese correo. Si es otro, en /sin-acceso se puede indicar el correo de
 * la cuenta de Mercado Pago. Por eso es una recomendación (no un requisito) visible junto al campo de correo.
 */
export const MERCADO_PAGO_EMAIL_RECOMMENDATION =
  "Te recomendamos registrarte con el mismo correo que utilizás en Mercado Pago para facilitar la identificación de tus pagos.";

/** Segunda línea del aviso: qué pasa si el correo de Mercado Pago es otro (existe la alternativa en /sin-acceso). */
export const MERCADO_PAGO_EMAIL_ALTERNATIVE =
  "Si usás otro correo en Mercado Pago, vas a poder indicarlo al activar Premium.";
