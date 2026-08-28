import OpenAI from "openai";

export async function createEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

  const openai = new OpenAI({
    apiKey,
  });

  // Truncate to a reasonable limit, ~8000 chars is well within the token limit for text-embedding-3-small
  const MAX_CHARS = 8000;
  let cleanText = text.trim();
  if (cleanText.length > MAX_CHARS) {
    cleanText = cleanText.substring(0, MAX_CHARS);
  }

  // OpenAI recommends replacing newlines with spaces for embeddings, though modern models handle it better.
  cleanText = cleanText.replace(/\n/g, " ");

  const response = await openai.embeddings.create({
    model,
    input: cleanText,
    encoding_format: "float",
  });

  if (!response.data || response.data.length === 0) {
    throw new Error("Failed to generate embedding.");
  }

  return response.data[0].embedding;
}

export async function createEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
  const openai = new OpenAI({ apiKey });
  const MAX_CHARS = 8000;
  const cleanTexts = texts.map((text) =>
    text.trim().slice(0, MAX_CHARS).replace(/\n/g, " "),
  );

  const response = await openai.embeddings.create({
    model,
    input: cleanTexts,
    encoding_format: "float",
  });

  const ordered = [...response.data].sort((left, right) => left.index - right.index);
  if (ordered.length !== cleanTexts.length) {
    throw new Error("No se generaron todos los embeddings del documento.");
  }

  return ordered.map((item) => item.embedding);
}
