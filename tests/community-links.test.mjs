import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { loadTs, readRepoFile as read } from "./helpers/load-ts.mjs";

const nodeRequire = createRequire(`${process.cwd()}/package.json`);
const React = nodeRequire("react");
const { renderToStaticMarkup } = nodeRequire("react-dom/server");
const h = React.createElement;

const links = loadTs("src/lib/community/links.ts");
const server = loadTs("src/lib/community/server.ts");

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";

const adminLink = (over = {}) => ({
  id: ID_A,
  kind: "channel",
  platform: "whatsapp",
  name: "Grupo",
  channelType: "group",
  description: null,
  iconKey: null,
  accessLevel: "public",
  sortOrder: 0,
  url: "https://chat.whatsapp.com/abc",
  isActive: true,
  updatedAt: null,
  ...over,
});

// ---------------------------------------------------------------------------------------------------------------
// Validación de URL
// ---------------------------------------------------------------------------------------------------------------

test("validateCommunityUrl acepta https con dominio y normaliza", () => {
  const ok = links.validateCommunityUrl("  https://www.instagram.com/stampa  ");
  assert.equal(ok.ok, true);
  assert.equal(ok.url, "https://www.instagram.com/stampa");
  assert.equal(ok.host, "instagram.com");
  assert.equal(links.validateCommunityUrl("https://t.me/stampa?x=1#a").ok, true);
});

test("validateCommunityUrl rechaza protocolos inseguros y formas peligrosas", () => {
  for (const bad of [
    "http://instagram.com/x",
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "ftp://x.com/a",
    "//instagram.com/x",
    "instagram.com/x",
    "https://user:pass@instagram.com/x",
    "https://localhost/x",
    "https://",
    "https://ins tagram.com",
    "",
    "   ",
    null,
    undefined,
    42,
  ]) {
    assert.equal(links.validateCommunityUrl(bad).ok, false, String(bad));
  }
  assert.equal(links.validateCommunityUrl(`https://a.com/${"x".repeat(520)}`).ok, false);
});

// ---------------------------------------------------------------------------------------------------------------
// Normalización del formulario
// ---------------------------------------------------------------------------------------------------------------

test("las redes sociales se fuerzan a públicas y sin tipo de canal", () => {
  const result = links.normalizeCommunityLinkInput({
    kind: "social",
    platform: "instagram",
    name: "  Instagram ",
    channelType: "group",
    accessLevel: "premium",
    url: "https://instagram.com/stampa",
    description: "  ",
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.accessLevel, "public");
  assert.equal(result.value.channelType, null);
  assert.equal(result.value.name, "Instagram");
  assert.equal(result.value.description, null);
  assert.equal(result.value.isActive, true);
});

test("los canales exigen tipo y nivel de acceso válidos", () => {
  const base = { kind: "channel", platform: "telegram", name: "Canal", url: "https://t.me/x" };
  const missing = links.normalizeCommunityLinkInput({ ...base });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.channelType);
  assert.ok(missing.errors.accessLevel);

  const ok = links.normalizeCommunityLinkInput({ ...base, channelType: "channel", accessLevel: "premium", iconKey: "megaphone", isActive: false });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.accessLevel, "premium");
  assert.equal(ok.value.iconKey, "megaphone");
  assert.equal(ok.value.isActive, false);
});

test("la normalización informa cada campo inválido y descarta íconos desconocidos", () => {
  const bad = links.normalizeCommunityLinkInput({ kind: "otro", platform: "myspace", name: " ", url: "http://x.com", description: "d".repeat(281) });
  assert.equal(bad.ok, false);
  for (const field of ["kind", "platform", "name", "url", "description"]) assert.ok(bad.errors[field], field);

  const tooLong = links.normalizeCommunityLinkInput({ kind: "social", platform: "other", name: "n".repeat(81), url: "https://x.com" });
  assert.equal(tooLong.ok, false);
  assert.ok(tooLong.errors.name);

  const icon = links.normalizeCommunityLinkInput({ kind: "social", platform: "other", name: "X", url: "https://x.com", iconKey: "<svg>" });
  assert.equal(icon.ok, true);
  assert.equal(icon.value.iconKey, null);
  assert.equal(links.normalizeCommunityLinkInput(null).ok, false);
});

// ---------------------------------------------------------------------------------------------------------------
// Audiencias y orden
// ---------------------------------------------------------------------------------------------------------------

test("previewForAudience refleja la RPC: bloqueadas sin URL y sin filas bloqueadas para visitantes", () => {
  const all = [
    adminLink({ id: ID_A, accessLevel: "public", sortOrder: 0 }),
    adminLink({ id: ID_B, accessLevel: "registered", sortOrder: 1, url: "https://t.me/registered" }),
    adminLink({ id: ID_C, accessLevel: "premium", sortOrder: 2, url: "https://t.me/+secret" }),
    adminLink({ id: "44444444-4444-4444-8444-444444444444", accessLevel: "public", sortOrder: 3, isActive: false }),
  ];

  const anonymous = links.previewForAudience(all, "anonymous");
  assert.deepEqual(anonymous.map((l) => l.id), [ID_A]);

  const registered = links.previewForAudience(all, "registered");
  assert.deepEqual(registered.map((l) => [l.id, l.locked, l.url !== null]), [
    [ID_A, false, true],
    [ID_B, false, true],
    [ID_C, true, false],
  ]);
  assert.ok(!JSON.stringify(registered).includes("secret"), "la URL Premium no viaja en la vista bloqueada");

  const premium = links.previewForAudience(all, "premium");
  assert.deepEqual(premium.map((l) => l.locked), [false, false, false]);
});

test("moveId, nextSortOrder y sortCommunityLinks", () => {
  assert.deepEqual(links.moveId(["a", "b", "c"], "b", "up"), ["b", "a", "c"]);
  assert.deepEqual(links.moveId(["a", "b", "c"], "b", "down"), ["a", "c", "b"]);
  assert.deepEqual(links.moveId(["a", "b", "c"], "a", "up"), ["a", "b", "c"]);
  assert.deepEqual(links.moveId(["a", "b", "c"], "c", "down"), ["a", "b", "c"]);
  assert.deepEqual(links.moveId(["a", "b"], "zzz", "down"), ["a", "b"]);

  assert.equal(links.nextSortOrder([], "social"), 0);
  assert.equal(links.nextSortOrder([{ kind: "social", sortOrder: 4 }, { kind: "channel", sortOrder: 9 }], "social"), 5);

  const sorted = links.sortCommunityLinks([
    { kind: "channel", sortOrder: 0, n: "c0" },
    { kind: "social", sortOrder: 1, n: "s1" },
    { kind: "social", sortOrder: 0, n: "s0" },
  ]);
  assert.deepEqual(sorted.map((l) => l.n), ["s0", "s1", "c0"]);
});

// ---------------------------------------------------------------------------------------------------------------
// Filas de la base
// ---------------------------------------------------------------------------------------------------------------

test("rowToCommunityLink es defensivo y marca como bloqueado un enlace sin URL", () => {
  const locked = links.rowToCommunityLink({
    id: ID_A, kind: "channel", platform: "telegram", name: "VIP", channel_type: "channel", description: "Beneficio",
    icon_key: null, access_level: "premium", sort_order: 2, url: null, locked: true,
  });
  assert.equal(locked.locked, true);
  assert.equal(locked.url, null);
  assert.equal(locked.accessLevel, "premium");

  // locked = false pero sin URL nunca se trata como abierto
  assert.equal(links.rowToCommunityLink({ id: ID_A, kind: "social", platform: "x", name: "X", access_level: "public", url: null, locked: false }).locked, true);

  for (const bad of [null, undefined, {}, { id: ID_A, kind: "weird", platform: "x", name: "X", access_level: "public" }, { id: ID_A, kind: "social", platform: "x", name: "X", access_level: "vip" }]) {
    assert.equal(links.rowToCommunityLink(bad), null);
  }
  assert.equal(links.rowToAdminLink({ id: ID_A, kind: "social", platform: "x", name: "X", access_level: "public" }), null, "el admin necesita la URL");
});

// ---------------------------------------------------------------------------------------------------------------
// Loader de servidor
// ---------------------------------------------------------------------------------------------------------------

const rpcClient = (response) => ({ rpc: async (name) => { rpcClient.called = name; return response; } });
const dbRow = (over) => ({ id: ID_A, kind: "social", platform: "instagram", name: "Instagram", channel_type: null, description: null, icon_key: null, access_level: "public", sort_order: 0, url: "https://instagram.com/x", locked: false, ...over });

test("loadCommunityLinks lee la RPC, ordena y filtra por tipo", async () => {
  const supabase = rpcClient({
    data: [dbRow({ id: ID_B, kind: "channel", platform: "telegram", name: "TG", channel_type: "channel", sort_order: 1 }), dbRow({ id: ID_A }), { basura: true }],
    error: null,
  });
  const all = await server.loadCommunityLinks(supabase);
  assert.equal(rpcClient.called, "list_community_links");
  assert.equal(all.status, "ok");
  assert.deepEqual(all.links.map((l) => l.id), [ID_A, ID_B]);
  const channels = await server.loadCommunityLinks(supabase, { kind: "channel" });
  assert.deepEqual(channels.links.map((l) => l.id), [ID_B]);
});

test("loadCommunityLinks usa el respaldo solo si la migration falta y no inventa enlaces ante otros errores", async () => {
  const missing = await server.loadCommunityLinks(rpcClient({ data: null, error: { code: "PGRST202", message: "Could not find the function public.list_community_links" } }));
  assert.equal(missing.status, "fallback");
  assert.ok(missing.links.length >= 4);
  const missingChannel = await server.loadCommunityLinks(rpcClient({ data: null, error: { code: "42883", message: "x" } }), { kind: "channel" });
  assert.ok(missingChannel.links.every((l) => l.kind === "channel"));

  const originalError = console.error;
  console.error = () => {};
  try {
    const failed = await server.loadCommunityLinks(rpcClient({ data: null, error: { code: "57014", message: "timeout" } }));
    assert.deepEqual(failed, { links: [], status: "error" });
    const thrown = await server.loadCommunityLinks({ rpc: async () => { throw new Error("red"); } });
    assert.deepEqual(thrown, { links: [], status: "error" });
  } finally {
    console.error = originalError;
  }
});

test("los enlaces de respaldo coinciden con el seed de la migration", () => {
  const migration = read("supabase/migrations/20261102120000_community_links.sql");
  for (const link of links.COMMUNITY_FALLBACK_LINKS) {
    assert.ok(migration.includes(`'${link.url}'`), `seed sin ${link.url}`);
    assert.equal(links.validateCommunityUrl(link.url).ok, true);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Server Actions del Admin
// ---------------------------------------------------------------------------------------------------------------

function loadActions({ admin = true, queryResult = { data: null, error: null } } = {}) {
  const calls = [];
  const builder = (table) => {
    const state = { table, ops: [] };
    const chain = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return (resolve) => resolve(queryResult);
          return (...args) => {
            state.ops.push([prop, args]);
            if (prop === "single" || prop === "maybeSingle") return Promise.resolve(queryResult);
            return chain;
          };
        },
      },
    );
    calls.push(state);
    return chain;
  };
  const supabase = {
    from: builder,
    rpc: async (name, args) => {
      calls.push({ rpc: name, args });
      return { data: null, error: null };
    },
  };
  const mod = loadTs("src/app/admin/redes-canales/actions.ts", {
    "@/utils/supabase/server": { createClient: async () => supabase },
    "@/lib/auth/user-access": {
      getCurrentUserAccess: async () => ({
        error: null,
        access: { userId: "user-1", capabilities: { accessAdmin: admin } },
      }),
    },
  });
  return { mod, calls };
}

test("ninguna Server Action responde ni toca la base si quien llama no es administrador", async () => {
  const { mod, calls } = loadActions({ admin: false });
  const valid = { kind: "social", platform: "instagram", name: "I", url: "https://instagram.com/x" };
  const results = [
    await mod.loadCommunityLinksAdminAction(),
    await mod.createCommunityLinkAction(valid),
    await mod.updateCommunityLinkAction(ID_A, valid),
    await mod.setCommunityLinkActiveAction(ID_A, false),
    await mod.deleteCommunityLinkAction(ID_A),
    await mod.reorderCommunityLinksAction("social", [ID_A]),
  ];
  for (const result of results) assert.equal(result.success, false);
  assert.equal(results[0].code, "forbidden");
  assert.equal(calls.length, 0, "no se consultó la base");
});

test("las acciones validan ids, tipos y órdenes antes de escribir", async () => {
  const { mod, calls } = loadActions();
  assert.equal((await mod.updateCommunityLinkAction("no-es-uuid", {})).success, false);
  assert.equal((await mod.setCommunityLinkActiveAction(ID_A, "si")).success, false);
  assert.equal((await mod.deleteCommunityLinkAction("1; drop table")).success, false);
  assert.equal((await mod.reorderCommunityLinksAction("otro", [ID_A])).success, false);
  assert.equal((await mod.reorderCommunityLinksAction("social", [])).success, false);
  assert.equal((await mod.reorderCommunityLinksAction("social", [ID_A, ID_A])).success, false);
  assert.equal((await mod.reorderCommunityLinksAction("social", [ID_A, "x"])).success, false);
  const invalid = await mod.createCommunityLinkAction({ kind: "social", platform: "instagram", name: "I", url: "javascript:alert(1)" });
  assert.equal(invalid.success, false);
  assert.ok(invalid.fieldErrors.url);
  assert.equal(calls.length, 0);
});

test("crear inserta al final de su lista con datos normalizados y reordenar usa la RPC atómica", async () => {
  const existing = { data: [{ kind: "channel", sort_order: 3 }], error: null };
  const { mod, calls } = loadActions({ queryResult: existing });
  // El insert devuelve la misma respuesta (sin fila válida) -> error controlado, pero el INSERT debe haberse armado bien.
  const result = await mod.createCommunityLinkAction({
    kind: "channel", platform: "discord", name: " Servidor ", channelType: "server", accessLevel: "premium",
    url: "https://discord.gg/abc", sortOrder: 99, isActive: true,
  });
  assert.equal(result.success, false);
  const insert = calls.flatMap((c) => c.ops ?? []).find(([op]) => op === "insert");
  assert.ok(insert, "se intentó insertar");
  assert.equal(insert[1][0].sort_order, 4, "el orden lo fija el servidor");
  assert.equal(insert[1][0].name, "Servidor");
  assert.equal(insert[1][0].access_level, "premium");

  const reordered = await mod.reorderCommunityLinksAction("channel", [ID_B, ID_A]);
  assert.equal(reordered.success, true);
  assert.deepEqual(calls.at(-1), { rpc: "reorder_community_links", args: { p_kind: "channel", p_ids: [ID_B, ID_A] } });
});

// ---------------------------------------------------------------------------------------------------------------
// Componentes
// ---------------------------------------------------------------------------------------------------------------

const view = loadTs("src/components/community/community-links-view.tsx", {
  "next/link": { __esModule: true, default: ({ href, children, ...rest }) => h("a", { href, ...rest }, children) },
  "@/components/stampy/StampyContextProvider": { usePublishStampyScreenContext() {} },
});

const publicLink = (over = {}) => ({
  id: ID_A, kind: "channel", platform: "whatsapp", name: "Grupo", channelType: "group", description: "Avisos",
  iconKey: null, accessLevel: "public", sortOrder: 0, url: "https://chat.whatsapp.com/abc", locked: false, ...over,
});

test("una tarjeta desbloqueada enlaza con rel seguro y una bloqueada no contiene ningún enlace", () => {
  const open = renderToStaticMarkup(h(view.CommunityLinkCard, { link: publicLink() }));
  assert.match(open, /href="https:\/\/chat\.whatsapp\.com\/abc"/);
  assert.match(open, /rel="noopener noreferrer"/);
  assert.match(open, /target="_blank"/);

  const locked = renderToStaticMarkup(
    h(view.CommunityLinkCard, { link: publicLink({ accessLevel: "premium", url: null, locked: true, name: "VIP", description: "Beneficios exclusivos" }) }),
  );
  assert.ok(!locked.includes("href="), "sin enlaces en la tarjeta bloqueada");
  assert.match(locked, /Exclusivo para miembros Premium/);
  assert.match(locked, /Beneficios exclusivos/);

  const preview = renderToStaticMarkup(h(view.CommunityLinkCard, { link: publicLink(), preview: true }));
  assert.ok(!preview.includes("href="), "la vista previa del admin no navega");
});

test("CommunityLinksView muestra el estado vacío y el error de carga", () => {
  const props = { kind: "social", route: "/redes", title: "Redes", intro: "Intro", emptyTitle: "Sin redes", emptyHint: "Pronto" };
  assert.match(renderToStaticMarkup(h(view.CommunityLinksView, { ...props, links: [] })), /Sin redes/);
  assert.match(renderToStaticMarkup(h(view.CommunityLinksView, { ...props, links: [], loadFailed: true })), /No pudimos cargar/);
  const withLinks = renderToStaticMarkup(h(view.CommunityLinksView, { ...props, links: [publicLink({ kind: "social", platform: "instagram", name: "Instagram", channelType: null })] }));
  assert.match(withLinks, /Instagram/);
});

// ---------------------------------------------------------------------------------------------------------------
// Migration y cableado (estático)
// ---------------------------------------------------------------------------------------------------------------

const migration = read("supabase/migrations/20261102120000_community_links.sql");

test("la migration protege la tabla: RLS, https, premium vía has_platform_access y sin escritura anónima", () => {
  assert.match(migration, /alter table public\.community_links enable row level security/);
  assert.match(migration, /url ~ '\^https:\/\//);
  assert.match(migration, /constraint community_links_social_is_public check \(kind <> 'social' or access_level = 'public'\)/);
  assert.match(migration, /has_platform_access\(auth\.uid\(\)\)/);
  assert.match(migration, /grant select on table public\.community_links to anon, authenticated/);
  assert.match(migration, /grant insert, update, delete on table public\.community_links to authenticated/);
  assert.ok(!/grant (insert|update|delete)[^;]*to[^;]*anon/.test(migration), "anon no escribe");
  for (const op of ["insert", "update", "delete"]) {
    assert.match(migration, new RegExp(`community_links_admin_${op}[\\s\\S]*?public\\.is_admin\\(auth\\.uid\\(\\)\\)`));
  }
  assert.match(migration, /security definer\s+set search_path = ''/);
  assert.match(migration, /revoke all on function public\.reorder_community_links\(text, uuid\[\]\) from public, anon/);
  assert.ok(!/update public\.courses|alter policy|drop policy if exists (?!community_links)/.test(migration), "no toca policies ajenas");
});

test("las pantallas de comunidad leen de la configuración y no fijan enlaces propios", () => {
  for (const file of ["src/app/redes/page.tsx", "src/app/canales/page.tsx", "src/app/whatsapp/page.tsx", "src/app/telegram/page.tsx", "src/app/instagram/page.tsx", "src/app/youtube/page.tsx"]) {
    const source = read(file);
    assert.match(source, /loadCommunityLinks/, file);
    assert.ok(!/https?:\/\//.test(source), `${file} no debe fijar URLs`);
  }
  assert.ok(!/https?:\/\//.test(read("src/components/common/social-view.tsx")));
  assert.ok(!/extruye/.test(read("src/components/landing-membership/landing-content.ts")), "la landing ya no fija redes");
  const footer = read("src/components/landing-membership/LandingFooter.tsx");
  assert.match(footer, /loadPublicCommunityLinks/);
  assert.ok(!/https?:\/\//.test(footer));
});

test("el panel admin enlaza la sección y la ruta exige rol admin (proxy /admin)", () => {
  assert.match(read("src/app/admin/page.tsx"), /href="\/admin\/redes-canales"/);
  assert.match(read("src/utils/supabase/middleware.ts"), /pathname\.startsWith\('\/admin'\) && !access\.capabilities\.accessAdmin/);
  assert.match(read("tests/e2e/specs/14-admin.spec.ts"), /\/admin\/redes-canales/);
});
