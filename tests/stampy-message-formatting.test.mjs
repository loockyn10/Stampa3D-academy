import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const messageRendererPath = path.join(root, "src/components/stampy/StampyMessageContent.tsx");
const messageRendererSource = fs.readFileSync(messageRendererPath, "utf8");
const actionSource = fs.readFileSync(path.join(root, "src/app/stampy/actions.ts"), "utf8");

test("every Stampy client uses the shared message renderer", () => {
  const clients = [
    "src/app/stampy/page.tsx",
    "src/components/stampy/GlobalStampyWidget.tsx",
    "src/components/stampy/StampyLessonChat.tsx",
  ];

  for (const relativePath of clients) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    assert.match(source, /import \{ StampyMessageContent \}/);
    assert.match(source, /<StampyMessageContent content=\{(?:msg|m)\.content\} role=\{(?:msg|m)\.role\} \/>/);
    assert.doesNotMatch(source, /whitespace-pre-wrap">\{(?:msg|m)\.content\}<\/div>/);
  }
});

test("assistant Markdown is allowlisted and arbitrary model HTML stays disabled", () => {
  assert.match(messageRendererSource, /<ReactMarkdown/);
  assert.match(messageRendererSource, /remarkPlugins=\{\[remarkGfm\]\}/);
  assert.match(messageRendererSource, /skipHtml/);
  assert.match(messageRendererSource, /allowedElements=\{\[/);
  assert.doesNotMatch(messageRendererSource, /dangerouslySetInnerHTML|rehypeRaw|remarkRehypeOptions/);
});

test("links are restricted to known internal Stampa routes", () => {
  assert.match(messageRendererSource, /INTERNAL_ROUTE_ROOTS/);
  assert.match(messageRendererSource, /!href\.startsWith\("\/"\)/);
  assert.match(messageRendererSource, /href\.startsWith\("\/\/"\)/);
  assert.match(messageRendererSource, /isAllowedInternalHref\(href\)/);
  assert.doesNotMatch(messageRendererSource, /target="_blank"/);
});

test("message typography supports compact mobile-safe paragraphs, lists, code and tables", () => {
  assert.match(messageRendererSource, /\[overflow-wrap:anywhere\]/);
  assert.match(messageRendererSource, /list-disc/);
  assert.match(messageRendererSource, /list-decimal/);
  assert.match(messageRendererSource, /overflow-x-auto/);
  assert.match(messageRendererSource, /table-fixed/);
  assert.match(messageRendererSource, /text-\[15px\]/);
});

test("the prompt chooses formatting by intent without forcing Markdown everywhere", () => {
  assert.match(actionSource, /Una respuesta simple sigue siendo una frase o un párrafo breve/);
  assert.match(actionSource, /procedimientos secuenciales usá una lista numerada/);
  assert.match(actionSource, /opciones independientes usá entre 2 y 4 bullets/);
  assert.match(actionSource, /preferí bloques breves; usá una tabla Markdown sólo si es corta/);
  assert.match(actionSource, /No anuncies el formato/);
  assert.match(actionSource, /Sólo crees un enlace Markdown hacia una página interna real y verificada de Stampa/);
});

test("existing real recommendation, tool and action controls remain separate from model Markdown", () => {
  const mainPage = fs.readFileSync(path.join(root, "src/app/stampy/page.tsx"), "utf8");
  assert.match(mainPage, /msg\.recommendations/);
  assert.match(mainPage, /msg\.knowledgeTools/);
  assert.match(mainPage, /<ActionIntentCard/);
  assert.doesNotMatch(messageRendererSource, /button|ActionIntentCard|knowledgeTools|recommendations/);
});

test("Stampy still waits for the complete model response instead of rendering partial Markdown", () => {
  assert.match(actionSource, /openai\.chat\.completions\.create\(/);
  assert.doesNotMatch(actionSource, /stream:\s*true/);
});
