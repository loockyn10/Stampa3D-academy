import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadReplyPolicy() {
  const filename = path.join(root, "src/lib/stampy/reply-policy.ts");
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  const loadedModule = { exports: {} };
  new Function("module", "exports", outputText)(loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const replyPolicy = loadReplyPolicy();

test("five turns keep conversational history while isolating each new assistant reply", () => {
  const history = [];
  const expectedReplies = [
    "Empezá por tu ruta recomendada.",
    "Los Cursos enseñan por clases; los Talleres son proyectos prácticos.",
    "Te convienen primero los Cursos.",
    "Porque te dan una base ordenada antes de practicar.",
    "Después podés seguir con el primer Taller.",
  ];

  for (const [index, expectedReply] of expectedReplies.entries()) {
    const previousAssistantText = history
      .filter((message) => message.role === "assistant")
      .map((message) => message.content)
      .join("\n\n");
    const rawAnswer = previousAssistantText
      ? `${previousAssistantText}\n\n${expectedReply}`
      : expectedReply;
    const result = replyPolicy.isolateCurrentStampyReply({
      answer: rawAnswer,
      history,
      userMessage: index === 3 ? "¿Y por qué?" : `Pregunta ${index + 1}`,
    });

    assert.equal(result.content, expectedReply);
    for (const previous of expectedReplies.slice(0, index)) {
      assert.doesNotMatch(result.content, new RegExp(previous.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }

    history.push(
      { role: "user", content: index === 3 ? "¿Y por qué?" : `Pregunta ${index + 1}` },
      { role: "assistant", content: result.content },
    );
  }

  assert.equal(history.length, 10);
  assert.equal(history[5].content, "Te convienen primero los Cursos.");
});

test("an explicit request to repeat preserves the previous reply", () => {
  const previous = "Los Cursos enseñan por clases y los Talleres son proyectos prácticos.";
  const result = replyPolicy.isolateCurrentStampyReply({
    answer: `${previous}\n\nEn otras palabras, uno enseña y el otro permite practicar.`,
    history: [{ role: "assistant", content: previous }],
    userMessage: "Repetí lo anterior y explicamelo mejor.",
  });

  assert.equal(result.removedPrefixes, 0);
  assert.match(result.content, /Los Cursos enseñan/);
});

test("all Stampy clients append one response value into a unique message bubble", () => {
  for (const relativePath of [
    "src/app/stampy/page.tsx",
    "src/components/stampy/GlobalStampyWidget.tsx",
    "src/components/stampy/StampyLessonChat.tsx",
  ]) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    assert.match(source, /id: createStampyMessageId\(requestId, ["']assistant["']\)/);
    assert.match(source, /content: (?:res|response)\.answer/);
    assert.doesNotMatch(source, /content:\s*(?:current|prev|messages).*\+.*(?:res|response)\.answer/);
  }
});

test("the server cleans the raw model reply before persistence and return", () => {
  const source = fs.readFileSync(path.join(root, "src/app/stampy/actions.ts"), "utf8");
  const rawIndex = source.indexOf("const rawAnswerText =");
  const isolateIndex = source.indexOf("isolateCurrentStampyReply", rawIndex);
  const saveIndex = source.indexOf("const saved = await saveMessages", isolateIndex);
  const returnIndex = source.indexOf("answer: answerText", saveIndex);

  assert.ok(rawIndex > 0);
  assert.ok(isolateIndex > rawIndex);
  assert.ok(saveIndex > isolateIndex);
  assert.ok(returnIndex > saveIndex);
  assert.match(source, /El historial es contexto interno para comprender referencias/);
});
