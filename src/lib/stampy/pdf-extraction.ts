import "server-only";

import type { KnowledgeDocumentPage } from "./knowledge-document-chunking";

export const MAX_KNOWLEDGE_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const PDF_EXTRACTION_ERROR_MESSAGE =
  "No se pudo extraer texto del PDF. Puede ser un PDF escaneado o incompatible.";

export interface ExtractedPdfDocument {
  text: string;
  pages: KnowledgeDocumentPage[];
  totalPages: number;
}

export class PdfExtractionError extends Error {
  constructor(message = PDF_EXTRACTION_ERROR_MESSAGE, options?: ErrorOptions) {
    super(message, options);
    this.name = "PdfExtractionError";
  }
}

export class PdfHasNoExtractableTextError extends PdfExtractionError {
  constructor(options?: ErrorOptions) {
    super("No se pudo extraer texto del PDF. Puede ser un PDF escaneado.", options);
    this.name = "PdfHasNoExtractableTextError";
  }
}

function normalizePdfText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compactPdfError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

export async function extractPdfText(data: ArrayBuffer): Promise<ExtractedPdfDocument> {
  if (data.byteLength === 0) {
    throw new Error("El archivo PDF está vacío.");
  }
  if (data.byteLength > MAX_KNOWLEDGE_DOCUMENT_BYTES) {
    throw new Error("El PDF supera el límite de 20 MB.");
  }

  const signature = new TextDecoder("ascii").decode(data.slice(0, 5));
  if (signature !== "%PDF-") {
    throw new Error("El archivo no tiene una firma PDF válida.");
  }

  let pdf: Awaited<ReturnType<typeof import("unpdf")["getDocumentProxy"]>> | null = null;
  try {
    const { getDocumentProxy } = await import("unpdf");
    pdf = await getDocumentProxy(new Uint8Array(data));
    const pages: KnowledgeDocumentPage[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      try {
        const page = await pdf.getPage(pageNumber);
        try {
          const content = await page.getTextContent();
          const rawText = content.items
            .filter((item) => "str" in item)
            .map((item) => `${item.str}${item.hasEOL ? "\n" : ""}`)
            .join("");
          pages.push({ pageNumber, text: normalizePdfText(rawText) });
        } finally {
          page.cleanup();
        }
      } catch (error) {
        console.warn("[Stampy Knowledge PDF Page]", {
          pageNumber,
          error: compactPdfError(error),
        });
        pages.push({ pageNumber, text: "" });
      }
    }

    const selectableChars = pages.reduce(
      (total, page) => total + page.text.replace(/\s/g, "").length,
      0,
    );

    if (selectableChars < 40) {
      throw new PdfHasNoExtractableTextError();
    }

    return {
      text: pages.map((page) => page.text).filter(Boolean).join("\n\n"),
      pages,
      totalPages: pdf.numPages,
    };
  } catch (error) {
    console.error("[Stampy Knowledge PDF Extraction]", error);
    if (error instanceof PdfExtractionError) throw error;
    throw new PdfExtractionError(PDF_EXTRACTION_ERROR_MESSAGE, { cause: error });
  } finally {
    await pdf?.loadingTask.destroy();
  }
}
