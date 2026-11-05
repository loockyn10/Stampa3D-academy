import { LEGAL_APPROVALS, LEGAL_TEXTS } from "@/content/legal";

export type LegalDocumentId = "terminos" | "privacidad" | "condiciones-membresia" | "baja" | "arrepentimiento";

export interface LegalDocument {
  id: LegalDocumentId;
  title: string;
  path: `/legal/${LegalDocumentId}`;
  /** Shown in the landing footer (baja/arrepentimiento wait for D045). */
  inFooter: boolean;
  /** What must be decided/approved before publishing (`docs/LEGAL_PENDING.md`). */
  pendingApproval: string;
}

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  { id: "terminos", title: "Términos y condiciones", path: "/legal/terminos", inFooter: true, pendingApproval: "Texto completo aprobado por el dueño / asesoría legal." },
  { id: "privacidad", title: "Política de privacidad", path: "/legal/privacidad", inFooter: true, pendingApproval: "Texto aprobado (Ley 25.326): datos tratados, finalidades, terceros (Supabase, Vercel, Mercado Pago, OpenAI, Bunny), derechos y contacto." },
  { id: "condiciones-membresia", title: "Condiciones de la membresía", path: "/legal/condiciones-membresia", inFooter: true, pendingApproval: "Precio, renovación, medios de pago, baja y qué incluye; coherente con D044/D045." },
  { id: "baja", title: "Botón de baja", path: "/legal/baja", inFooter: false, pendingApproval: "Decisión comercial D045 + Disposición 954/2025 (enlace visible desde el primer acceso, código de baja en 24 h)." },
  { id: "arrepentimiento", title: "Botón de arrepentimiento", path: "/legal/arrepentimiento", inFooter: false, pendingApproval: "Decisión D045 + circuito de reembolso (hoy no existe)." },
];

export function legalText(id: string): string | null {
  const text = LEGAL_TEXTS[id];
  return typeof text === "string" && text.trim() ? text : null;
}

export function legalApprovalDate(id: string): string | null {
  return LEGAL_APPROVALS[id] ?? null;
}

export function findLegalDocument(id: string): LegalDocument | null {
  return LEGAL_DOCUMENTS.find((doc) => doc.id === id) ?? null;
}

export function isLegalDocumentPublished(id: string): boolean {
  return findLegalDocument(id) !== null && legalText(id) !== null;
}

export function publishedLegalDocuments(): LegalDocument[] {
  return LEGAL_DOCUMENTS.filter((doc) => isLegalDocumentPublished(doc.id));
}

/** Footer entries: link only when the approved text exists. */
export function footerLegalLinks(): { label: string; href: string | null }[] {
  return LEGAL_DOCUMENTS.filter((doc) => doc.inFooter).map((doc) => ({
    label: doc.title,
    href: isLegalDocumentPublished(doc.id) ? doc.path : null,
  }));
}
