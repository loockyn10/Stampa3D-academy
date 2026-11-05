import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { findLegalDocument, legalApprovalDate, legalText, publishedLegalDocuments } from "@/lib/legal/registry";

export const dynamicParams = false;

export function generateStaticParams() {
  return publishedLegalDocuments().map((doc) => ({ slug: doc.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const doc = findLegalDocument(slug);
  // An unapproved document does not exist publicly (real 404, no title leak).
  if (!doc || !legalText(doc.id)) notFound();
  return { title: `${doc.title} | Universo Stampa` };
}

/** Approved legal texts only (src/content/legal). Unapproved documents do not exist publicly (404). */
export default async function LegalDocumentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = findLegalDocument(slug);
  const text = doc ? legalText(doc.id) : null;
  if (!doc || !text) notFound();
  const approved = legalApprovalDate(doc.id);

  return (
    <div className="min-h-dvh bg-stampa-bg px-4 py-10 text-stampa-text sm:px-6">
      <article className="mx-auto max-w-3xl">
        <Link href="/landing" className="text-sm font-semibold text-stampa-accent hover:underline">← Universo Stampa</Link>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-fg">{doc.title}</h1>
        {approved && <p className="mt-2 text-sm text-stampa-text-muted">Última actualización: {approved}</p>}
        <div className="prose prose-invert mt-8 max-w-none text-stampa-text-soft">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
      </article>
    </div>
  );
}
