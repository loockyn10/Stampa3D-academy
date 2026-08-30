import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();

function transpileModule(relativePath, resolveDependency = () => {
  throw new Error("Unexpected runtime dependency");
}) {
  const filename = path.join(root, relativePath);
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
    resolveDependency,
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

const accessPolicy = transpileModule("src/lib/auth/access-policy.ts");
const { getRaffleParticipantChances } = transpileModule(
  "src/lib/raffles/participants.ts",
  (specifier) => {
    if (specifier === "@/lib/auth/access-policy") return accessPolicy;
    throw new Error(`Unexpected runtime dependency: ${specifier}`);
  },
);

const now = new Date("2026-08-30T12:00:00.000Z");
const baseProfile = {
  role: "member",
  membership_status: "active",
  membership_expires_at: "2026-09-30T12:00:00.000Z",
  onboarding_completed: true,
  member_level: "bronze",
};

test("eligible raffle participants receive membership level plus bonus chances", () => {
  assert.equal(getRaffleParticipantChances({
    profile: { ...baseProfile, member_level: "gold" },
    grants: [],
    bonusEntries: 3,
    now,
  }), 5);
});

test("a valid Beta grant participates while an expired grant does not", () => {
  const inactiveProfile = {
    ...baseProfile,
    membership_status: "inactive",
    membership_expires_at: null,
  };

  assert.equal(getRaffleParticipantChances({
    profile: inactiveProfile,
    grants: [{ grantType: "beta_tester", status: "active", expiresAt: "2026-09-01T00:00:00.000Z" }],
    bonusEntries: 0,
    now,
  }), 1);
  assert.equal(getRaffleParticipantChances({
    profile: inactiveProfile,
    grants: [{ grantType: "beta_tester", status: "active", expiresAt: "2026-08-01T00:00:00.000Z" }],
    bonusEntries: 10,
    now,
  }), null);
});

test("admin mutation payloads use real audit and founder pricing columns", () => {
  const source = fs.readFileSync(path.join(root, "src/app/admin/usuarios/actions.ts"), "utf8");

  assert.doesNotMatch(source, /granted_by/);
  assert.match(source, /created_by: adminUserId/);
  assert.match(source, /from\("founder_pricing_tiers"\)/);
  assert.match(source, /price: Number\(pricingTier\.monthly_price\)/);
  assert.doesNotMatch(source, /price:\s*0\b/);
});

test("winner assignment revalidates raffle, prize, participant and prior winner", () => {
  const source = fs.readFileSync(path.join(root, "src/app/admin/sorteos/[id]/actions.ts"), "utf8");

  assert.match(source, /from\("raffles"\)/);
  assert.match(source, /from\("raffle_prizes"\)/);
  assert.match(source, /\.eq\("raffle_id", input\.raffleId\)/);
  assert.match(source, /getRaffleParticipantChances/);
  assert.match(source, /Ese premio ya tiene un ganador asignado/);
});
