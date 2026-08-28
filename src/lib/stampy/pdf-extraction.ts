import "server-only";

import { PDFParse } from "pdf-parse";
import type { KnowledgeDocumentPage } from "./knowledge-document-chunking";

export const MAX_KNOWLEDGE_DOCUMENT_BYTES = 20 * 1024 * 1024;

export interface ExtractedPdfDocument {
  pages: KnowledgeDocumentPage[];
  totalPages: number;
}

export class PdfHasNoExtractableTextError extends Error {
  constructor() {
    super("No se pudo extraer texto. Puede ser un PDF escaneado. OCR queda pendiente.");
    this.name = "PdfHasNoExtractableTextError";
  }
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

  const parser = new PDFParse({ data: new Uint8Array(data) });
  try {
    const result = await parser.getText();
    const pages = result.pages.map((page) => ({
      pageNumber: page.num,
      text: page.text.trim(),
    }));
    const selectableChars = pages.reduce(
      (total, page) => total + page.text.replace(/\s/g, "").length,
      0,
    );

    if (selectableChars < 40) {
      throw new PdfHasNoExtractableTextError();
    }

    return { pages, totalPages: result.total };
  } finally {
    await parser.destroy();
  }
}
