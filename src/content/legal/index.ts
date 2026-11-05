/**
 * Approved legal texts (Markdown). `null` = not approved yet: the page answers 404, the footer shows it as pending
 * and nothing links to it. Do NOT write placeholder or invented text here; paste only the version approved by the
 * owner / legal advice, and record the approval date in `LEGAL_APPROVALS`.
 */
export const LEGAL_TEXTS: Record<string, string | null> = {
  terminos: null,
  privacidad: null,
  "condiciones-membresia": null,
  // Pending the commercial decision D045 (Disposición 954/2025: botón de baja de servicio / botón de arrepentimiento).
  baja: null,
  arrepentimiento: null,
};

/** "YYYY-MM-DD" of the approved version, shown on the page as "Última actualización". */
export const LEGAL_APPROVALS: Record<string, string | null> = {
  terminos: null,
  privacidad: null,
  "condiciones-membresia": null,
  baja: null,
  arrepentimiento: null,
};
