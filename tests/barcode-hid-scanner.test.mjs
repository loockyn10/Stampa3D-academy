import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function loadTypeScriptModule(filename) {
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (request) => { throw new Error(`Unexpected dependency: ${request}`); },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const scanner = loadTypeScriptModule(path.join(root, "src/lib/barcode/hid-scanner.ts"));
const read = (filename) => fs.readFileSync(path.join(root, filename), "utf8");

function feedSequence(detector, value, startAt = 0, interval = 10, terminator = "Enter") {
  for (let index = 0; index < value.length; index += 1) {
    detector.feed(value[index], startAt + index * interval);
  }
  return detector.feed(terminator, startAt + value.length * interval);
}

test("a fast HID burst followed by Enter produces exactly one scan", () => {
  const detector = new scanner.BarcodeHidDetector();
  const result = feedSequence(detector, "1105000016385");
  assert.equal(result.barcode, "1105000016385");
  assert.equal(detector.bufferedLength, 0);
});

test("slow human typing is not classified as a barcode scan", () => {
  const detector = new scanner.BarcodeHidDetector();
  const result = feedSequence(detector, "7791234567890", 0, 110);
  assert.equal(result.barcode, null);
});

test("Tab is supported as a scanner terminator", () => {
  const detector = new scanner.BarcodeHidDetector();
  assert.equal(feedSequence(detector, "ABC-12345", 0, 8, "Tab").barcode, "ABC-12345");
});

test("short sequences and expired partial sequences are discarded", () => {
  const shortDetector = new scanner.BarcodeHidDetector();
  assert.equal(feedSequence(shortDetector, "12345").barcode, null);

  const expiredDetector = new scanner.BarcodeHidDetector();
  expiredDetector.feed("1", 0);
  expiredDetector.feed("2", 10);
  assert.equal(expiredDetector.expire(500), true);
  assert.equal(feedSequence(expiredDetector, "34567", 510).barcode, null);
});

test("consecutive scans remain separate and leading zeroes are preserved", () => {
  const detector = new scanner.BarcodeHidDetector();
  assert.equal(feedSequence(detector, "0012345678905", 0).barcode, "0012345678905");
  assert.equal(feedSequence(detector, "CODE128-A", 500).barcode, "CODE128-A");
});

test("pending scan queue drains once and never leaves stale scans", () => {
  const queue = new scanner.PendingBarcodeScanQueue();
  queue.enqueue("00123456", 1);
  queue.enqueue("ABC12345", 2);
  assert.equal(queue.size, 2);
  assert.deepEqual(queue.drain().map((scan) => scan.value), ["00123456", "ABC12345"]);
  assert.equal(queue.size, 0);
  assert.deepEqual(queue.drain(), []);
});

test("the authenticated shell owns one global listener and protects dialogs and excluded routes", () => {
  const mainLayout = read("src/app/main-layout.tsx");
  const provider = read("src/components/barcode/BarcodeScannerProvider.tsx");
  assert.match(mainLayout, /<BarcodeScannerProvider/);
  assert.match(mainLayout, /capabilities\.accessPlatform === true/);
  assert.equal((provider.match(/addEventListener\("keydown"/g) ?? []).length, 1);
  assert.match(provider, /role=\"dialog\"/);
  assert.match(provider, /role=\"alertdialog\"/);
  assert.match(provider, /"\/admin"/);
  assert.match(provider, /router\.push\(QUICK_SALE_ROUTE\)/);
  assert.match(provider, /CONTEXTUAL_BARCODE_ROUTES/);
  assert.match(provider, /PendingBarcodeScanQueue/);
  assert.match(provider, /event\.stopImmediatePropagation\(\)/);
});

test("quick sale uses the contextual handler, continuous-safe cart ref and one-click sale", () => {
  const page = read("src/app/mi-negocio/venta-rapida/page.tsx");
  assert.match(page, /useBarcodeScanHandler\(\{/);
  assert.match(page, /id: "quick-sale"/);
  assert.match(page, /cartRef\.current/);
  assert.match(page, /addBusinessCartItem\(cartRef\.current, item\)/);
  assert.match(page, /submittingRef\.current/);
  assert.match(page, /Procesando\.\.\./);
  assert.doesNotMatch(page, /confirmAction\(\{/);
  assert.match(page, /<BarcodeScanner onDetected=\{handleBarcode\}/);
});

test("catalog has contextual lookup, highlight and unknown-barcode prefill", () => {
  const page = read("src/app/mi-negocio/catalogo/page.tsx");
  assert.match(page, /id: "business-catalog"/);
  assert.match(page, /normalizeBarcode\(item\.barcode/);
  assert.match(page, /catalog-item-\$\{item\.id\}/);
  assert.match(page, /setResaleForm\(\{ \.\.\.emptyResaleForm, barcode \}\)/);
  assert.match(page, /searchParams\.get\("barcode"\)/);
  assert.match(page, /createResaleCatalogItemAction/);
});
