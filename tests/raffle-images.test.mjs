import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const filename = path.join(process.cwd(), "src/lib/raffles/images.ts");
const source = fs.readFileSync(filename, "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: filename,
});

const loadedModule = { exports: {} };
new Function("require", "module", "exports", outputText)(
  (specifier) => {
    if (specifier !== "@/lib/storage") throw new Error(`Unexpected dependency: ${specifier}`);
    return {
      isExternalUrl: (value) => value.startsWith("http://") || value.startsWith("https://"),
      parseStorageReference: (value) => {
        if (!value.startsWith("storage://")) return null;
        const [bucket, ...pathParts] = value.slice("storage://".length).split("/");
        return { bucket, path: pathParts.join("/") };
      },
    };
  },
  loadedModule,
  loadedModule.exports,
);

const { RAFFLE_IMAGES_BUCKET, resolveRaffleImageUrl } = loadedModule.exports;
const supabase = {
  storage: {
    from: (bucket) => ({
      getPublicUrl: (objectPath) => ({
        data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/${bucket}/${objectPath}` },
      }),
    }),
  },
};

test("raffle images reuse the existing public product-images bucket", () => {
  assert.equal(RAFFLE_IMAGES_BUCKET, "product-images");
});

test("external image URLs remain unchanged", () => {
  const url = "https://cdn.example.com/prize.webp";
  assert.equal(resolveRaffleImageUrl(supabase, url), url);
});

test("storage references and bare object paths become public URLs", () => {
  const expected = "https://example.supabase.co/storage/v1/object/public/product-images/raffles/raffle-1/prizes/a1.webp";
  assert.equal(
    resolveRaffleImageUrl(supabase, "storage://product-images/raffles/raffle-1/prizes/a1.webp"),
    expected,
  );
  assert.equal(
    resolveRaffleImageUrl(supabase, "product-images/raffles/raffle-1/prizes/a1.webp"),
    expected,
  );
});

test("references to an unexpected bucket fail closed", () => {
  assert.equal(
    resolveRaffleImageUrl(supabase, "storage://private-documents/prize.webp"),
    null,
  );
});
