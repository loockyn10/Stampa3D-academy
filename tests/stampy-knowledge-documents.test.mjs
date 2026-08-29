import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import * as unpdf from "unpdf";

const root = process.cwd();

function loadTypeScriptModule(relativePath, dependencies = {}) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (specifier) => {
      if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
      throw new Error(`Unexpected dependency ${specifier} while loading ${relativePath}`);
    },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const chunking = loadTypeScriptModule(
  "src/lib/stampy/knowledge-document-chunking.ts",
);
const retrievalPolicy = loadTypeScriptModule(
  "src/lib/stampy/knowledge-retrieval-policy.ts",
  { "./types": {} },
);

function createTestPdf(text = "") {
  const escapedText = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const stream = text ? `BT /F1 12 Tf 72 720 Td (${escapedText}) Tj ET` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  const bytes = Buffer.from(pdf, "ascii");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test("serverless PDF extraction reads selectable text without browser DOM APIs", async () => {
  const extraction = loadTypeScriptModule(
    "src/lib/stampy/pdf-extraction.ts",
    { "server-only": {}, unpdf },
  );

  const result = await extraction.extractPdfText(
    createTestPdf("Texto seleccionable de impresion 3D con suficiente contenido para indexar Stampy."),
  );

  assert.equal(result.totalPages, 1);
  assert.match(result.text, /Texto seleccionable de impresion 3D/);
  assert.match(result.pages[0].text, /Stampy/);
});

test("a PDF without selectable text returns the controlled scanned-PDF error", async () => {
  const extraction = loadTypeScriptModule(
    "src/lib/stampy/pdf-extraction.ts",
    { "server-only": {}, unpdf },
  );
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      extraction.extractPdfText(createTestPdf()),
      /Puede ser un PDF escaneado/i,
    );
  } finally {
    console.error = originalError;
  }
});

test("one unreadable PDF page does not discard extractable pages", async () => {
  const extraction = loadTypeScriptModule(
    "src/lib/stampy/pdf-extraction.ts",
    {
      "server-only": {},
      unpdf: {
        getDocumentProxy: async () => ({
          numPages: 2,
          getPage: async (pageNumber) => {
            if (pageNumber === 1) throw new Error("broken page");
            return {
              getTextContent: async () => ({
                items: [{ str: "Contenido recuperado de la segunda pagina con texto suficiente para Stampy.", hasEOL: true }],
              }),
              cleanup() {},
            };
          },
          loadingTask: { destroy: async () => {} },
        }),
      },
    },
  );
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await extraction.extractPdfText(createTestPdf("placeholder"));
    assert.equal(result.pages[0].text, "");
    assert.match(result.pages[1].text, /Contenido recuperado/);
  } finally {
    console.warn = originalWarn;
  }
});

test("PDF parsing stays server-only and no longer bundles pdf-parse", () => {
  const extraction = fs.readFileSync(
    path.join(root, "src/lib/stampy/pdf-extraction.ts"),
    "utf8",
  );
  const actions = fs.readFileSync(
    path.join(root, "src/app/admin/stampy/documentos/actions.ts"),
    "utf8",
  );
  const page = fs.readFileSync(
    path.join(root, "src/app/admin/stampy/documentos/page.tsx"),
    "utf8",
  );
  const client = fs.readFileSync(
    path.join(root, "src/app/admin/stampy/documentos/knowledge-documents-admin.tsx"),
    "utf8",
  );
  const nextConfig = fs.readFileSync(path.join(root, "next.config.ts"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

  assert.match(extraction, /^import "server-only";/);
  assert.match(extraction, /await import\("unpdf"\)/);
  assert.doesNotMatch(extraction, /from ["']pdf-parse["']/);
  assert.doesNotMatch(page, /pdf-parse|unpdf/);
  assert.doesNotMatch(client, /pdf-parse|unpdf/);
  assert.doesNotMatch(nextConfig, /pdf-parse/);
  assert.equal(packageJson.dependencies["pdf-parse"], undefined);
  assert.equal(packageJson.dependencies.unpdf, "^1.8.1");
  assert.match(actions, /error instanceof PdfExtractionError/);
  assert.match(actions, /return \{ success: false, error: message \}/);
});

function words(chars, prefix = "contenido") {
  return Array.from({ length: Math.ceil(chars / (prefix.length + 5)) }, (_, index) => `${prefix}-${index}`).join(" ");
}

test("PDF page text is cleaned and split into bounded overlapping chunks", () => {
  const pages = Array.from({ length: 8 }, (_, index) => ({
    pageNumber: index + 1,
    text: `Manual de impresión 3D\n\nSección ${index + 1}\n\n${words(2_200, `pagina${index + 1}`)}\n\nAcademia Stampa`,
  }));

  const cleaned = chunking.cleanKnowledgeDocumentPages(pages);
  assert.ok(cleaned.every((page) => !page.text.includes("Manual de impresión 3D")));
  assert.ok(cleaned.every((page) => !page.text.includes("Academia Stampa")));

  const chunks = chunking.chunkKnowledgeDocumentPages(pages);
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((chunk) => chunk.content.length <= 6_000));
  assert.ok(chunks.every((chunk) => chunk.pageStart >= 1 && chunk.pageEnd <= 8));
  assert.deepEqual(chunks.map((chunk) => chunk.chunkIndex), chunks.map((_, index) => index));
});

test("an extraction failure never calls embeddings or marks the document ready", async () => {
  let embeddingCalls = 0;
  let rpcCalls = 0;
  const indexer = loadTypeScriptModule(
    "src/lib/stampy/knowledge-document-indexer.ts",
    {
      "server-only": {},
      "./embeddings": {
        createEmbeddings: async () => {
          embeddingCalls += 1;
          return [];
        },
      },
      "./knowledge-document-chunking": chunking,
      "./pdf-extraction": {
        extractPdfText: async () => {
          throw new Error("No se pudo extraer texto. Puede ser un PDF escaneado. OCR queda pendiente.");
        },
      },
    },
  );
  const supabase = {
    storage: {
      from() {
        return { download: async () => ({ data: new Blob(["%PDF-test"]), error: null }) };
      },
    },
    async rpc() {
      rpcCalls += 1;
      return { data: null, error: null };
    },
  };

  await assert.rejects(
    indexer.indexStampyKnowledgeDocument({
      supabase,
      document: {
        id: "document-1",
        title: "PDF escaneado",
        file_path: "admin/document-1/file.pdf",
        mime_type: "application/pdf",
        file_size: 100,
        status: "processing",
      },
    }),
    /PDF escaneado/i,
  );
  assert.equal(embeddingCalls, 0);
  assert.equal(rpcCalls, 0);
});

test("indexing sends one atomic replacement RPC with page metadata", async () => {
  const rpcCalls = [];
  const indexer = loadTypeScriptModule(
    "src/lib/stampy/knowledge-document-indexer.ts",
    {
      "server-only": {},
      "./embeddings": {
        createEmbeddings: async (texts) => texts.map(() => [0.1, 0.2, 0.3]),
      },
      "./knowledge-document-chunking": chunking,
      "./pdf-extraction": {
        extractPdfText: async () => ({
          totalPages: 2,
          pages: [
            { pageNumber: 1, text: words(3_200, "adherencia") },
            { pageNumber: 2, text: words(3_200, "warping") },
          ],
        }),
      },
    },
  );
  const supabase = {
    storage: {
      from() {
        return { download: async () => ({ data: new Blob(["%PDF-test"]), error: null }) };
      },
    },
    async rpc(name, params) {
      rpcCalls.push({ name, params });
      return { data: params.p_chunks.length, error: null };
    },
  };

  const result = await indexer.indexStampyKnowledgeDocument({
    supabase,
    document: {
      id: "document-2",
      title: "Guía de primera capa",
      file_path: "admin/document-2/file.pdf",
      mime_type: "application/pdf",
      file_size: 100,
      status: "processing",
    },
  });

  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "replace_stampy_knowledge_document_chunks");
  assert.ok(rpcCalls[0].params.p_chunks.length > 0);
  assert.equal(rpcCalls[0].params.p_chunks[0].metadata.document_id, "document-2");
  assert.equal(rpcCalls[0].params.p_chunks[0].metadata.source_type, "knowledge_document");
  assert.equal(result.chunksCount, rpcCalls[0].params.p_chunks.length);
});

test("retrieval prioritizes classes, contexts, active document candidates, then generic sources", () => {
  const base = {
    id: "chunk",
    source_id: null,
    source_key: null,
    title: "Fuente",
    content: "Contenido",
    route: "/stampy",
    category: null,
    tags: [],
    course_id: null,
    module_id: null,
    lesson_id: null,
    metadata: {},
    is_active: true,
    last_indexed_at: "2026-08-28T00:00:00.000Z",
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
  };
  const sorted = retrievalPolicy.prioritizeStampyRetrievedChunks([
    { ...base, id: "doc", source_type: "knowledge_document", similarity: 0.99 },
    { ...base, id: "context", source_type: "stampy_context", similarity: 0.8 },
    { ...base, id: "lesson", source_type: "lesson_transcript", similarity: 0.75 },
    { ...base, id: "other", source_type: "other", similarity: 1 },
  ], 4);

  assert.deepEqual(sorted.map((chunk) => chunk.id), ["lesson", "context", "doc", "other"]);
});

test("migration keeps documents private and retrieval admits only ready active documents", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20260828103109_stampy_knowledge_documents.sql"),
    "utf8",
  );

  assert.match(sql, /create table if not exists public\.stampy_knowledge_documents/i);
  assert.match(sql, /'stampy-knowledge-documents',[\s\S]*false,[\s\S]*20971520/i);
  assert.match(sql, /stampy_knowledge_documents_admin_all[\s\S]*public\.is_admin\(auth\.uid\(\)\)/i);
  assert.match(sql, /source_type <> 'knowledge_document'/i);
  assert.match(sql, /document\.status = 'ready'[\s\S]*document\.is_active = true/i);
  assert.match(sql, /delete from public\.stampy_knowledge_chunks[\s\S]*insert into public\.stampy_knowledge_chunks[\s\S]*status = 'ready'/i);
  assert.doesNotMatch(sql, /to anon[\s\S]*for (insert|update|delete)/i);
});

test("knowledge document RPC resolves pgvector explicitly with an empty search path", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20260828103109_stampy_knowledge_documents.sql"),
    "utf8",
  );

  assert.match(sql, /query_embedding public\.vector\(1536\)/i);
  assert.match(sql, /::public\.vector\(1536\)/i);
  assert.equal((sql.match(/public\.cosine_distance\(chunk\.embedding, query_embedding\)/gi) || []).length, 3);
  assert.match(sql, /to_regprocedure\('public\.cosine_distance\(public\.vector,public\.vector\)'\)/i);
  assert.doesNotMatch(sql, /OPERATOR\([^)]*<=>[^)]*\)/i);
  assert.doesNotMatch(sql, /chunk\.embedding\s*<=>\s*query_embedding/i);
  assert.match(sql, /set search_path = ''[\s\S]*public\.cosine_distance\(chunk\.embedding, query_embedding\)/i);
  assert.match(sql, /match_stampy_knowledge_chunks\(public\.vector, double precision, integer\)/i);
});

test("admin actions reauthorize and Stampy prompt treats documents separately from classes", () => {
  const actions = fs.readFileSync(
    path.join(root, "src/app/admin/stampy/documentos/actions.ts"),
    "utf8",
  );
  const stampyActions = fs.readFileSync(
    path.join(root, "src/app/stampy/actions.ts"),
    "utf8",
  );

  assert.match(actions, /getCurrentUserAccess\(supabase\)/);
  assert.match(actions, /access\.capabilities\.accessAdmin/);
  assert.match(stampyActions, /Un documento nunca demuestra que exista una clase o video/);
  assert.match(stampyActions, /No menciones embeddings, chunks, RAG, SQL ni Storage/);
});
