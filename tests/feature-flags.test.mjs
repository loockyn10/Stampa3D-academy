import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { loadTs, readRepoFile as read } from "./helpers/load-ts.mjs";

const nodeRequire = createRequire(`${process.cwd()}/package.json`);
const React = nodeRequire("react");
const { renderToStaticMarkup } = nodeRequire("react-dom/server");
const h = React.createElement;

// ---------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------

const registry = loadTs("src/lib/features/registry.ts");
const resolve = loadTs("src/lib/features/resolve.ts");
const visibilityLib = loadTs("src/lib/features/visibility.ts");
const policy = loadTs("src/lib/auth/access-policy.ts");

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const ALL_IDS = [...registry.FEATURE_IDS];

/** Snapshot con las funcionalidades indicadas deshabilitadas explícitamente. */
function disabled(...ids) {
  return { source: "database", flags: Object.fromEntries(ids.map((id) => [id, false])) };
}
const UNINITIALIZED = { source: "uninitialized", flags: {} };
const UNAVAILABLE = { source: "unavailable", flags: {} };

function accessSnapshot({ role = null, paid = false, authenticated = true } = {}) {
  const evaluation = policy.evaluateAccessPolicy({
    authenticated,
    role,
    membershipStatus: paid ? "active" : null,
    membershipExpiresAt: paid ? FUTURE : null,
    onboardingCompleted: true,
    grants: [],
  });
  return {
    authenticated,
    userId: authenticated ? "user-1" : null,
    role,
    membershipStatus: paid ? "active" : null,
    membershipExpiresAt: paid ? FUTURE : null,
    onboardingCompleted: true,
    grants: [],
    identity: { email: "qa@stampa.test", fullName: null, displayName: null, avatarUrl: null, memberLevel: null },
    ...evaluation,
  };
}

const PAID = () => accessSnapshot({ paid: true });
const ADMIN = () => accessSnapshot({ role: "admin", paid: true });
const FREE = () => accessSnapshot();

function fakeLink({ href, children, ...rest }) {
  return h("a", { href, ...rest }, children);
}
const navMocks = {
  "next/link": { __esModule: true, default: fakeLink },
  "next/image": { __esModule: true, default: (props) => h("img", { alt: props.alt ?? "", src: String(props.src) }) },
  "next/navigation": {
    usePathname: () => "/",
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push() {}, replace() {} }),
  },
};

function renderWithFeatures(modulePath, componentName, props, { snapshot, isAdmin = false, accessReady = true, mocks = {} }) {
  const cache = new Map();
  const allMocks = { ...navMocks, ...mocks };
  const provider = loadTs("src/components/features/feature-flags-provider.tsx", allMocks, cache);
  const component = loadTs(modulePath, allMocks, cache)[componentName];
  return renderToStaticMarkup(
    h(provider.FeatureVisibilityProvider, { snapshot, isAdmin, accessReady }, h(component, props)),
  );
}

const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);

// ---------------------------------------------------------------------------------------------------------------
// Registro centralizado
// ---------------------------------------------------------------------------------------------------------------

test("registro: ids estables y únicos, con nombre, descripción, rutas y default habilitado", () => {
  const expected = [
    "academia", "stampy", "calculadora", "stampa_maker", "sorteos", "libreria_stl",
    "explorar_modelos", "mi_taller", "mi_negocio", "tienda_online", "redes", "canales",
  ];
  assert.deepEqual([...registry.FEATURE_IDS], expected);
  assert.deepEqual(registry.FEATURE_REGISTRY.map((feature) => feature.id), expected);
  assert.equal(new Set(registry.FEATURE_IDS).size, registry.FEATURE_IDS.length);
  for (const feature of registry.FEATURE_REGISTRY) {
    assert.match(feature.id, /^[a-z][a-z0-9_]{1,47}$/, "formato aceptado por el CHECK de la migration");
    assert.ok(feature.name.length > 0 && feature.description.length > 0, feature.id);
    assert.ok(feature.routes.length > 0, feature.id);
    assert.equal(feature.defaultEnabled, true, `${feature.id}: el default preserva el acceso actual`);
    for (const route of [...feature.routes, ...(feature.apiRoutes ?? [])]) assert.match(route, /^\/[a-z0-9-/]+$/, route);
  }
});

test("registro: ninguna ruta esencial (auth, perfil, configuración, admin, pagos) pertenece a una funcionalidad", () => {
  for (const route of [
    "/", "/login", "/registro", "/recuperar-password", "/actualizar-password", "/verificar-email", "/auth/callback",
    "/onboarding", "/perfil", "/configuracion", "/configuracion?tab=stampy", "/salir", "/sin-acceso", "/no-disponible",
    "/beta-access", "/pago/estado", "/landing", "/admin", "/admin/funcionalidades", "/admin/usuarios",
    "/api/admin/membership/update-price", "/api/mercadopago/webhook", "/api/business/mercadopago/callback",
    "/api/business/mercadopago/webhook", "/api/business/orders/expire",
  ]) {
    assert.equal(registry.findFeatureForPath(route), null, route);
  }
  for (const feature of registry.FEATURE_REGISTRY) {
    for (const route of [...feature.routes, ...(feature.apiRoutes ?? [])]) {
      assert.equal(registry.isProtectedRoute(route), false, `${feature.id} controla ${route}, que está protegida`);
    }
  }
});

test("registro: subrutas, query y rutas heredadas resuelven a la funcionalidad correcta", () => {
  const owner = (path) => registry.findFeatureForPath(path)?.id ?? null;
  assert.equal(owner("/mi-negocio"), "mi_negocio");
  for (const sub of ["catalogo", "ventas", "clientes", "pedidos", "inventario", "metricas", "tienda", "venta-rapida", "reposicion", "ticket/abc"]) {
    assert.equal(owner(`/mi-negocio/${sub}`), "mi_negocio", sub);
  }
  assert.equal(owner("/mi-negocio/ventas?estado=x#top"), "mi_negocio");
  assert.equal(owner("/mi-negocio/"), "mi_negocio");
  assert.equal(owner("/presupuestos?action=new"), "mi_negocio");
  assert.equal(owner("/mi-taller/filamentos"), "mi_taller");
  assert.equal(owner("/productos"), "mi_taller");
  assert.equal(owner("/stock?tab=filamentos"), "mi_taller");
  assert.equal(owner("/cursos/abc"), "academia");
  assert.equal(owner("/talleres"), "academia");
  assert.equal(owner("/libreria-stl/grupo/modelo"), "libreria_stl");
  assert.equal(owner("/api/stl/download"), "libreria_stl");
  assert.equal(owner("/api/model-search"), "explorar_modelos");
  assert.equal(owner("/api/calculator/catalog"), "calculadora");
  assert.equal(owner("/stampa-maker/jarros"), "stampa_maker");
  assert.equal(owner("/telegram"), "canales");
  assert.equal(owner("/instagram"), "redes");
  assert.equal(owner("/tienda/mi-tienda/producto"), "tienda_online");
  assert.equal(owner("/api/business/storefront/mi-tienda/checkout"), "tienda_online");
  assert.equal(owner("/api/business/mercadopago/connect"), "mi_negocio");
  // "/mi-negocio-falso" no es una subruta de "/mi-negocio"; una URL absoluta o ajena nunca resuelve.
  assert.equal(owner("/mi-negocio-falso"), null);
  assert.equal(owner("https://evil.example/mi-negocio"), null);
  assert.equal(owner("mi-negocio"), null);
  assert.equal(owner(""), null);
});

// ---------------------------------------------------------------------------------------------------------------
// Resolución: administrador / usuario, habilitada / deshabilitada
// ---------------------------------------------------------------------------------------------------------------

test("1. administrador accede a una funcionalidad habilitada", () => {
  const decision = resolve.resolveFeatureAccess(disabled("sorteos"), "mi_negocio", { isAdmin: true });
  assert.equal(decision.allowed, true);
});

test("2. administrador accede a una funcionalidad deshabilitada (bypass solo de feature flags)", () => {
  const snapshot = disabled(...ALL_IDS);
  for (const id of ALL_IDS) {
    const decision = resolve.resolveFeatureAccess(snapshot, id, { isAdmin: true });
    assert.deepEqual(decision, { allowed: true, reason: "admin_bypass" }, id);
  }
  assert.equal(resolve.isPathAccessible(snapshot, "/mi-negocio/ventas", { isAdmin: true }), true);
});

test("3. usuario común accede a una funcionalidad habilitada (explícita o sin configurar)", () => {
  assert.deepEqual(
    resolve.resolveFeatureAccess({ source: "database", flags: { mi_negocio: true } }, "mi_negocio", { isAdmin: false }),
    { allowed: true, reason: "enabled" },
  );
  assert.deepEqual(
    resolve.resolveFeatureAccess(disabled("sorteos"), "mi_negocio", { isAdmin: false }),
    { allowed: true, reason: "not_configured" },
  );
});

test("4. usuario común no accede a una funcionalidad deshabilitada", () => {
  const decision = resolve.resolveFeatureAccess(disabled("mi_negocio"), "mi_negocio", { isAdmin: false });
  assert.deepEqual(decision, { allowed: false, reason: "disabled" });
});

test("9b. sin configurar (sin fila) ≠ deshabilitada explícitamente; la tabla ausente no restringe nada", () => {
  for (const id of ALL_IDS) {
    assert.equal(resolve.getPublicFeatureState(UNINITIALIZED, id).enabled, true, id);
    assert.equal(resolve.getPublicFeatureState(UNINITIALIZED, id).configured, false, id);
    assert.equal(resolve.getPublicFeatureState(disabled(id), id).configured, true, id);
    assert.equal(resolve.getPublicFeatureState(disabled(id), id).enabled, false, id);
  }
  const fromRows = resolve.buildSnapshotFromRows([
    { feature_id: "mi_negocio", enabled: false },
    { feature_id: "desconocida", enabled: false },
    { feature_id: "sorteos", enabled: "false" },
    { feature_id: "redes", enabled: true },
  ]);
  assert.deepEqual(fromRows.flags, { mi_negocio: false, redes: true }, "ids desconocidos y valores no booleanos se ignoran");
  assert.equal(resolve.buildSnapshotFromRows(null).source, "database");
});

test("13. falla de carga: nunca se concede acceso a herramientas restringidas", () => {
  // Sin último estado conocido: los usuarios comunes quedan fuera, los administradores conservan el acceso.
  for (const id of ALL_IDS) {
    assert.equal(resolve.resolveFeatureAccess(UNAVAILABLE, id, { isAdmin: false }).allowed, false, id);
    assert.equal(resolve.resolveFeatureAccess(UNAVAILABLE, id, { isAdmin: true }).allowed, true, id);
  }
  // Con último estado conocido (stale) se mantiene lo restringido.
  const stale = { source: "stale", flags: { mi_negocio: false } };
  assert.equal(resolve.resolveFeatureAccess(stale, "mi_negocio", { isAdmin: false }).allowed, false);
  assert.equal(resolve.resolveFeatureAccess(stale, "sorteos", { isAdmin: false }).allowed, true);
});

test("listUnavailableFeatures y filterByAccessibleRoute respetan el rol", () => {
  const snapshot = disabled("mi_negocio", "sorteos");
  assert.deepEqual(resolve.listUnavailableFeatures(snapshot, { isAdmin: false }).map((f) => f.id), ["sorteos", "mi_negocio"]);
  assert.deepEqual(resolve.listUnavailableFeatures(snapshot, { isAdmin: true }), []);
  const items = [{ href: "/sorteos" }, { href: "/perfil" }, { href: "/mi-negocio/ventas" }, { href: "/calculadora" }];
  assert.deepEqual(
    resolve.filterByAccessibleRoute(items, (i) => i.href, snapshot, { isAdmin: false }).map((i) => i.href),
    ["/perfil", "/calculadora"],
  );
});

// ---------------------------------------------------------------------------------------------------------------
// Carga desde Supabase (cache, errores, último estado conocido)
// ---------------------------------------------------------------------------------------------------------------

function fakeFlagsClient(responses) {
  const calls = { count: 0 };
  return {
    calls,
    from(table) {
      assert.equal(table, "platform_feature_flags");
      return {
        select(columns) {
          assert.equal(columns, "feature_id, enabled", "no se traen datos de más");
          calls.count += 1;
          const next = responses.length > 1 ? responses.shift() : responses[0];
          if (next instanceof Error) return Promise.reject(next);
          return Promise.resolve(next);
        },
      };
    },
  };
}

test("13b. loader: tabla ausente => sin configurar; error genérico => unavailable o último estado conocido", async () => {
  let clock = 0;
  const { createFeatureFlagLoader } = loadTs("src/lib/features/loader.ts");

  // Tabla ausente (migration sin aplicar): no restringe nada.
  const missing = createFeatureFlagLoader(() => clock);
  for (const error of [
    { code: "42P01", message: "relation does not exist" },
    { code: "PGRST205", message: "Could not find the table" },
    { message: "relation \"public.platform_feature_flags\" does not exist" },
  ]) {
    const snapshot = await createFeatureFlagLoader(() => clock).load(fakeFlagsClient([{ data: null, error }]));
    assert.equal(snapshot.source, "uninitialized");
  }
  assert.equal((await missing.load(fakeFlagsClient([{ data: null, error: { code: "42P01" } }]))).source, "uninitialized");

  // Error genérico sin último estado conocido: falla cerrada.
  const cold = createFeatureFlagLoader(() => clock);
  assert.equal((await cold.load(fakeFlagsClient([{ data: null, error: { code: "57P01", message: "terminating" } }]))).source, "unavailable");
  assert.equal((await createFeatureFlagLoader(() => clock).load(fakeFlagsClient([new Error("fetch failed")]))).source, "unavailable");

  // Éxito y luego error: se conserva el último estado conocido (lo restringido sigue restringido).
  const loader = createFeatureFlagLoader(() => clock);
  const client = fakeFlagsClient([
    { data: [{ feature_id: "mi_negocio", enabled: false }], error: null },
    { data: null, error: { code: "57P01", message: "boom" } },
  ]);
  const first = await loader.load(client);
  assert.equal(first.source, "database");
  assert.equal(first.flags.mi_negocio, false);
  clock += 10_000;
  const second = await loader.load(client);
  assert.equal(second.source, "stale");
  assert.equal(second.flags.mi_negocio, false);
  assert.equal(resolve.resolveFeatureAccess(second, "mi_negocio", { isAdmin: false }).allowed, false);
});

test("loader: cache de 5 s, invalidate y fresh", async () => {
  let clock = 1_000;
  const { createFeatureFlagLoader, FEATURE_FLAGS_CACHE_TTL_MS } = loadTs("src/lib/features/loader.ts");
  const loader = createFeatureFlagLoader(() => clock);
  const client = fakeFlagsClient([
    { data: [{ feature_id: "sorteos", enabled: false }], error: null },
    { data: [{ feature_id: "sorteos", enabled: true }], error: null },
  ]);

  assert.equal((await loader.load(client)).flags.sorteos, false);
  assert.equal((await loader.load(client)).flags.sorteos, false, "dentro del TTL no vuelve a consultar");
  assert.equal(client.calls.count, 1);

  loader.invalidate();
  assert.equal((await loader.load(client)).flags.sorteos, true, "tras un cambio del Admin se relee");
  assert.equal(client.calls.count, 2);

  clock += FEATURE_FLAGS_CACHE_TTL_MS + 1;
  await loader.load(client);
  assert.equal(client.calls.count, 3, "vencido el TTL consulta de nuevo");
  await loader.load(client, { fresh: true });
  assert.equal(client.calls.count, 4);
});

// ---------------------------------------------------------------------------------------------------------------
// Proxy: acceso directo por URL, subsecciones, rutas esenciales, convivencia con membresía
// ---------------------------------------------------------------------------------------------------------------

function fakeSupabaseForProxy({ user, profile, flags, flagsError }) {
  const respond = (table) => {
    if (table === "profiles") return { data: profile, error: null };
    if (table === "user_access_grants") return { data: [], error: null };
    return flagsError ? { data: null, error: flagsError } : { data: flags, error: null };
  };
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from(table) {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        single: () => Promise.resolve(respond(table)),
        then: (resolveFn, rejectFn) => Promise.resolve(respond(table)).then(resolveFn, rejectFn),
      };
      return query;
    },
  };
}

async function runProxy(path, { who = "paid", flags = [], flagsError = null } = {}) {
  const jar = () => ({ getAll: () => [], set() {} });
  const NextResponse = {
    next: () => ({ type: "next", cookies: jar() }),
    redirect: (url) => ({ type: "redirect", to: `${url.pathname}${url.search ?? ""}`, cookies: jar() }),
  };
  const profiles = {
    anon: null,
    free: { role: null, membership_status: null, membership_expires_at: null, onboarding_completed: true },
    paid: { role: null, membership_status: "active", membership_expires_at: FUTURE, onboarding_completed: true },
    admin: { role: "admin", membership_status: "active", membership_expires_at: FUTURE, onboarding_completed: true },
  };
  const user = who === "anon" ? null : { id: "user-1", email: "qa@stampa.test" };
  const supabase = fakeSupabaseForProxy({ user, profile: profiles[who], flags, flagsError });
  const { updateSession } = loadTs("src/utils/supabase/middleware.ts", {
    "@supabase/ssr": { createServerClient: () => supabase },
    "next/server": { NextResponse },
  }, new Map());

  const [pathname, search = ""] = path.split("?");
  const request = {
    url: `http://localhost:3000${path}`,
    cookies: { getAll: () => [], set() {} },
    nextUrl: {
      pathname,
      search: search ? `?${search}` : "",
      searchParams: new URLSearchParams(search),
      clone() { return { pathname: this.pathname, search: this.search }; },
    },
  };
  const response = await updateSession(request);
  return response.type === "redirect" ? response.to : "next";
}

const OFF = (...ids) => ids.map((id) => ({ feature_id: id, enabled: false }));

test("5/6. URL directa y subsecciones: usuario común es redirigido a /no-disponible, administrador entra", async () => {
  const flags = OFF("mi_negocio");
  for (const path of [
    "/mi-negocio", "/mi-negocio/catalogo", "/mi-negocio/ventas", "/mi-negocio/clientes", "/mi-negocio/pedidos",
    "/mi-negocio/ticket/abc", "/presupuestos", "/mi-negocio/ventas?estado=anulada",
  ]) {
    assert.match(await runProxy(path, { who: "paid", flags }), /^\/no-disponible\?herramienta=mi_negocio$/, path);
    assert.equal(await runProxy(path, { who: "admin", flags }), "next", `admin ${path}`);
  }
  // Otras funcionalidades siguen accesibles.
  assert.equal(await runProxy("/mi-taller/filamentos", { who: "paid", flags }), "next");
  assert.equal(await runProxy("/sorteos", { who: "paid", flags }), "next");
});

test("3b. usuario común accede a una funcionalidad habilitada o sin configurar", async () => {
  assert.equal(await runProxy("/mi-negocio/ventas", { who: "paid", flags: [{ feature_id: "mi_negocio", enabled: true }] }), "next");
  assert.equal(await runProxy("/mi-negocio/ventas", { who: "paid", flags: [] }), "next");
  assert.equal(await runProxy("/mi-negocio/ventas", { who: "paid", flagsError: { code: "42P01" } }), "next", "migration sin aplicar");
});

test("12. convivencia con la membresía: la flag y el plan son controles independientes", async () => {
  // Free + herramienta habilitada: sigue rigiendo el gate de plan.
  assert.equal(await runProxy("/mi-taller", { who: "free", flags: [] }), "/sin-acceso");
  // Free + herramienta deshabilitada: se informa "no disponible", no una invitación a pagar.
  assert.equal(await runProxy("/mi-taller", { who: "free", flags: OFF("mi_taller") }), "/no-disponible?herramienta=mi_taller");
  // Rutas gratuitas: Calculadora y Explorar Modelos siguen el estado de su flag, no la membresía.
  assert.equal(await runProxy("/calculadora", { who: "free", flags: [] }), "next");
  assert.equal(await runProxy("/calculadora", { who: "free", flags: OFF("calculadora") }), "/no-disponible?herramienta=calculadora");
  assert.equal(await runProxy("/calculadora", { who: "anon", flags: OFF("calculadora") }), "/no-disponible?herramienta=calculadora");
  assert.equal(await runProxy("/explorar-modelos", { who: "anon", flags: OFF("explorar_modelos") }), "/no-disponible?herramienta=explorar_modelos");
  assert.equal(await runProxy("/explorar-modelos", { who: "anon", flags: [] }), "next");
  // El administrador conserva todo.
  assert.equal(await runProxy("/calculadora", { who: "admin", flags: OFF("calculadora") }), "next");
  // Anónimo en rutas privadas: primero se pide iniciar sesión (no se revela qué está deshabilitado).
  assert.equal(await runProxy("/mi-negocio", { who: "anon", flags: OFF("mi_negocio") }), "/login");
  // La tienda pública sigue su propia flag.
  assert.equal(await runProxy("/tienda/mi-tienda", { who: "anon", flags: OFF("tienda_online") }), "/no-disponible?herramienta=tienda_online");
  assert.equal(await runProxy("/tienda/mi-tienda", { who: "anon", flags: OFF("mi_negocio") }), "next");
});

test("13c. falla de carga en el proxy: usuarios comunes quedan fuera de lo controlado, administradores no", async () => {
  const flagsError = { code: "57P01", message: "connection terminated" };
  assert.equal(await runProxy("/sorteos", { who: "paid", flagsError }), "/no-disponible?herramienta=sorteos");
  assert.equal(await runProxy("/sorteos", { who: "admin", flagsError }), "next");
  // Las rutas esenciales no dependen de las flags.
  assert.equal(await runProxy("/perfil", { who: "paid", flagsError }), "next");
  assert.equal(await runProxy("/configuracion", { who: "paid", flagsError }), "next");
});

test("14. rutas de autenticación, cuenta y administración nunca quedan bloqueadas por flags", async () => {
  const everything = OFF(...ALL_IDS);
  for (const path of ["/perfil", "/configuracion", "/configuracion?tab=stampy", "/admin", "/admin/funcionalidades", "/admin/usuarios", "/no-disponible", "/sin-acceso"]) {
    assert.equal(await runProxy(path, { who: "admin", flags: everything }), "next", `admin ${path}`);
  }
  for (const path of ["/perfil", "/configuracion", "/no-disponible"]) {
    assert.equal(await runProxy(path, { who: "paid", flags: everything }), "next", `paid ${path}`);
  }
  for (const path of ["/login", "/registro", "/recuperar-password", "/actualizar-password", "/landing", "/no-disponible", "/sin-acceso"]) {
    assert.equal(await runProxy(path, { who: "anon", flags: everything }), "next", `anon ${path}`);
  }
  // /admin sigue exigiendo rol admin (la flag no cambia eso).
  assert.equal(await runProxy("/admin/funcionalidades", { who: "paid", flags: [] }), "/");
  // Inicio es la ruta de retorno de la pantalla "no disponible": jamás se bloquea.
  assert.equal(await runProxy("/", { who: "paid", flags: everything }), "next");
});

// ---------------------------------------------------------------------------------------------------------------
// Navegación: sidebar, navegación móvil, menú radial, Inicio, buscador
// ---------------------------------------------------------------------------------------------------------------

test("7. sidebar: oculta herramientas deshabilitadas, sin grupos vacíos; el admin ve todo", () => {
  const render = (access, snapshot, isAdmin = false) =>
    renderWithFeatures("src/components/layout/sidebar.tsx", "Sidebar", { access, loading: false }, { snapshot, isAdmin });

  const all = hrefs(render(PAID(), UNINITIALIZED));
  for (const href of ["/stampy", "/calculadora", "/stampa-maker", "/sorteos", "/libreria-stl", "/explorar-modelos", "/academia", "/mi-taller", "/mi-negocio", "/redes", "/canales", "/perfil", "/configuracion"]) {
    assert.ok(all.includes(href), `sin flags configuradas se ve ${href}`);
  }

  const html = render(PAID(), disabled("mi_negocio", "sorteos", "redes", "canales"));
  const visible = hrefs(html);
  for (const href of ["/mi-negocio", "/sorteos", "/redes", "/canales"]) assert.ok(!visible.includes(href), `oculta ${href}`);
  for (const href of ["/stampy", "/mi-taller", "/academia", "/perfil", "/configuracion"]) assert.ok(visible.includes(href), `conserva ${href}`);
  assert.ok(!html.includes(">Comunidad<"), "el grupo Comunidad quedó vacío y no se muestra");
  assert.ok(html.includes(">Áreas<") && html.includes(">Plataforma<"));

  // Todo deshabilitado: solo quedan Inicio y el usuario.
  const none = render(PAID(), disabled(...ALL_IDS));
  assert.ok(!none.includes(">Plataforma<") && !none.includes(">Áreas<") && !none.includes(">Comunidad<"));
  assert.ok(none.includes(">Usuario<") && hrefs(none).includes("/perfil") && hrefs(none).includes("/salir"));

  // Administrador: ve todo y además Administración.
  const adminHtml = render(ADMIN(), disabled(...ALL_IDS), true);
  const adminHrefs = hrefs(adminHtml);
  for (const href of ["/stampy", "/mi-negocio", "/canales", "/admin"]) assert.ok(adminHrefs.includes(href), `admin ve ${href}`);

  // Mientras no cargaron las flags, las entradas controladas no aparecen (nunca se "retira" un acceso ya mostrado).
  const loading = renderWithFeatures("src/components/layout/sidebar.tsx", "Sidebar", { access: PAID(), loading: false }, { snapshot: null });
  assert.ok(!hrefs(loading).includes("/mi-negocio") && hrefs(loading).includes("/perfil"));
});

test("7b. sidebar Free: las promociones bloqueadas de herramientas deshabilitadas tampoco se muestran", () => {
  const html = renderWithFeatures("src/components/layout/sidebar.tsx", "Sidebar", { access: FREE(), loading: false }, {
    snapshot: disabled("academia", "calculadora"),
  });
  const visible = hrefs(html);
  assert.ok(!visible.includes("/calculadora"));
  assert.ok(!visible.includes("/sin-acceso?feature=academia"));
  assert.ok(visible.includes("/sin-acceso?feature=taller") && visible.includes("/sin-acceso?feature=negocio"));
  assert.ok(visible.includes("/explorar-modelos"));
});

test("8. navegación móvil: barra inferior, reparto simétrico y menú radial", () => {
  const nav = (access, snapshot, isAdmin = false) =>
    renderWithFeatures("src/components/layout/mobile-bottom-navigation.tsx", "MobileBottomNavigation",
      { access, loading: false, toolsOpen: false, onToolsOpenChange() {} }, { snapshot, isAdmin });

  const full = nav(PAID(), UNINITIALIZED);
  for (const href of ["/", "/academia", "/mi-taller", "/mi-negocio", "/calculadora", "/libreria-stl", "/stampa-maker", "/sorteos", "/canales", "/redes", "/configuracion"]) {
    assert.ok(hrefs(full).includes(href), `se ve ${href}`);
  }
  assert.ok(full.includes("repeat(2, minmax(0, 1fr)) 4.5rem repeat(2, minmax(0, 1fr))"));

  const partial = nav(PAID(), disabled("mi_negocio", "sorteos", "redes", "canales"));
  const visible = hrefs(partial);
  for (const href of ["/mi-negocio", "/sorteos", "/redes", "/canales"]) assert.ok(!visible.includes(href), `oculta ${href}`);
  for (const href of ["/", "/academia", "/mi-taller", "/calculadora", "/configuracion"]) assert.ok(visible.includes(href), `conserva ${href}`);
  // 3 ítems principales => 2 a la izquierda y 1 a la derecha + hueco para mantener el botón central.
  assert.ok(partial.includes("repeat(2, minmax(0, 1fr)) 4.5rem repeat(2, minmax(0, 1fr))"));
  assert.equal([...partial.matchAll(/aria-hidden="true"/g)].length >= 2, true, "huecos de relleno sin enlaces vacíos");

  const minimal = nav(PAID(), disabled("academia", "mi_taller", "mi_negocio"));
  assert.ok(minimal.includes("repeat(1, minmax(0, 1fr)) 4.5rem repeat(1, minmax(0, 1fr))"));
  assert.deepEqual(hrefs(minimal).filter((href) => ["/academia", "/mi-taller", "/mi-negocio"].includes(href)), []);
  assert.ok(hrefs(minimal).includes("/"), "Inicio siempre está");

  // Free: la barra se reduce según lo disponible y nunca queda vacía.
  const free = nav(FREE(), disabled("calculadora", "academia"));
  assert.ok(!hrefs(free).includes("/calculadora") && !hrefs(free).includes("/sin-acceso?feature=academia"));
  assert.ok(free.includes("repeat(3, minmax(0, 1fr))"));
  const freeNone = nav(FREE(), disabled("calculadora", "explorar_modelos", "academia", "mi_taller", "mi_negocio"));
  assert.ok(hrefs(freeNone).includes("/perfil"));

  // Administrador: todo visible aunque esté deshabilitado.
  const admin = nav(ADMIN(), disabled(...ALL_IDS), true);
  for (const href of ["/academia", "/mi-taller", "/mi-negocio", "/sorteos", "/canales"]) assert.ok(hrefs(admin).includes(href), `admin ve ${href}`);
});

test("8b. menú radial: ángulos válidos para cualquier cantidad de herramientas visibles", () => {
  const { getRadialArcAngles, secondaryMobileNavigation } = loadTs("src/components/layout/mobile-navigation.ts");
  assert.deepEqual(getRadialArcAngles(6), [210, 232, 254, 286, 308, 330], "con 6 se conserva el reparto original");
  assert.deepEqual(getRadialArcAngles(0), []);
  assert.deepEqual(getRadialArcAngles(1), [270]);
  for (let count = 1; count <= secondaryMobileNavigation.length; count += 1) {
    const angles = getRadialArcAngles(count);
    assert.equal(angles.length, count);
    assert.ok(angles.every((angle) => Number.isFinite(angle) && angle >= 200 && angle <= 340), `count ${count}`);
    assert.deepEqual([...angles].sort((a, b) => a - b), angles, "ordenados de izquierda a derecha");
  }
});

test("Inicio: accesos rápidos y paneles de herramientas deshabilitadas no se muestran ni dejan huecos", () => {
  const mocks = {
    "@/utils/supabase/client": { createClient: () => ({}) },
    "@/components/stampy/StampyContextProvider": { usePublishStampyScreenContext() {} },
    "@/app/mi-negocio/actions": { loadBusinessMetricsAction: async () => ({}) },
  };
  const data = {
    firstName: "Ana", xp: null,
    learning: { status: "loading" }, workshop: { status: "loading" }, business: { status: "loading" },
    raffle: { status: "loading" }, stl: { status: "loading" },
  };
  const view = (snapshot, isAdmin = false) =>
    renderWithFeatures("src/components/home/home-dashboard.tsx", "HomeDashboardView", {
      data,
      visibility: visibilityLib.buildFeatureVisibility(snapshot, { isAdmin, accessReady: true }),
    }, { snapshot, isAdmin, mocks });

  const full = view(UNINITIALIZED);
  for (const href of ["/stampy", "/calculadora", "/explorar-modelos", "/academia", "/mi-taller", "/mi-negocio"]) assert.ok(hrefs(full).includes(href), href);
  assert.ok(full.includes("pedile ayuda a Stampy"));

  const partial = view(disabled("stampy", "mi_negocio", "sorteos", "libreria_stl"));
  const visible = hrefs(partial);
  for (const href of ["/stampy", "/mi-negocio", "/mi-negocio/venta-rapida", "/sorteos", "/libreria-stl"]) assert.ok(!visible.includes(href), `oculta ${href}`);
  for (const href of ["/calculadora", "/academia", "/mi-taller"]) assert.ok(visible.includes(href), `conserva ${href}`);
  assert.ok(!partial.includes("pedile ayuda a Stampy"), "no promete Stampy si está deshabilitado");
  assert.ok(!partial.includes('aria-label="Novedades"'), "sin sorteos ni librería, el aside desaparece");

  const everythingOff = view(disabled(...ALL_IDS));
  assert.ok(!everythingOff.includes('aria-label="Accesos rápidos"'));

  const adminView = view(disabled(...ALL_IDS), true);
  for (const href of ["/stampy", "/mi-negocio", "/mi-taller"]) assert.ok(hrefs(adminView).includes(href), `admin ve ${href}`);
  assert.ok(adminView.includes('aria-label="Novedades"'), "admin conserva el bloque de novedades");
});

test("9. buscador global: no sugiere herramientas ni cursos de funcionalidades deshabilitadas", () => {
  const mocks = { "@/utils/supabase/client": { createClient: () => ({}) } };
  const search = loadTs("src/components/search/GlobalSearch.tsx", { ...navMocks, ...mocks }, new Map());
  const courses = [{ id: "c1", title: "Curso de calibración", description: "", type: "course", path: "/cursos/calibracion" }];
  const items = [...search.STATIC_TOOLS, ...courses];
  const ids = (term, snapshot, isAdmin = false) => {
    const visibility = visibilityLib.buildFeatureVisibility(snapshot, { isAdmin, accessReady: true });
    return search.filterGlobalSearchItems(items, term, visibility.isPathVisible).map((item) => item.id);
  };

  assert.ok(ids("calcul", UNINITIALIZED).includes("tool-calculadora"));
  assert.ok(ids("precio", disabled("calculadora")).every((id) => id !== "tool-calculadora"));
  assert.ok(!ids("calcul", disabled("calculadora")).includes("tool-calculadora"));
  assert.ok(!ids("producto", disabled("mi_taller")).includes("tool-productos"));
  assert.ok(!ids("presupuesto", disabled("mi_negocio")).includes("tool-presupuestos"));
  assert.ok(ids("calibr", UNINITIALIZED).includes("c1"));
  assert.ok(!ids("calibr", disabled("academia")).includes("c1"), "los cursos pertenecen a Academia");
  assert.ok(!ids("curso", disabled("academia")).some((id) => ["tool-academia", "tool-cursos", "tool-talleres"].includes(id)));
  // Rutas esenciales siempre sugeribles.
  assert.ok(ids("perfil", disabled(...ALL_IDS)).includes("tool-perfil"));
  assert.ok(ids("configuracion", disabled(...ALL_IDS)).includes("tool-config"));
  // Administrador: ve todo.
  assert.ok(ids("calcul", disabled(...ALL_IDS), true).includes("tool-calculadora"));
  assert.deepEqual(search.filterGlobalSearchItems(items, "   ", () => true), []);
  assert.ok(search.filterGlobalSearchItems(items, "a", () => true).length <= 8);
});

// ---------------------------------------------------------------------------------------------------------------
// Panel de administración (acciones del servidor)
// ---------------------------------------------------------------------------------------------------------------

function loadAdminActions({ access, upsertResult, selectResult, invalidated = { count: 0 } }) {
  const dbCalls = [];
  const supabase = {
    from(table) {
      dbCalls.push(table);
      return {
        select: () => Promise.resolve(selectResult ?? { data: [], error: null }),
        upsert: (payload, options) => {
          dbCalls.push({ payload, options });
          return { select: () => ({ single: () => Promise.resolve(upsertResult ?? { data: null, error: { code: "x" } }) }) };
        },
      };
    },
  };
  const realLoader = loadTs("src/lib/features/loader.ts");
  const actions = loadTs("src/app/admin/funcionalidades/actions.ts", {
    "@/utils/supabase/server": { createClient: async () => supabase },
    "@/lib/auth/user-access": { getCurrentUserAccess: async () => ({ access, error: null }) },
    "@/lib/features/loader": { ...realLoader, invalidateFeatureFlagCache: () => { invalidated.count += 1; } },
  }, new Map());
  return { actions, dbCalls, invalidated };
}

test("10. administrador modifica una feature flag: upsert validado, caché invalidada y fila devuelta", async () => {
  const row = { feature_id: "mi_negocio", enabled: false, updated_at: "2026-10-24T12:00:00Z" };
  const { actions, dbCalls, invalidated } = loadAdminActions({ access: ADMIN(), upsertResult: { data: row, error: null } });
  const result = await actions.setFeatureFlagAction({ featureId: "mi_negocio", enabled: false });
  assert.deepEqual(result, { success: true, row: { featureId: "mi_negocio", enabled: false, updatedAt: "2026-10-24T12:00:00Z" } });
  assert.equal(invalidated.count, 1);
  const write = dbCalls.find((call) => typeof call === "object");
  assert.deepEqual(write.payload, { feature_id: "mi_negocio", enabled: false }, "el cliente no envía updated_by/updated_at");
  assert.deepEqual(write.options, { onConflict: "feature_id" });
});

test("10b. el administrador solo puede escribir ids del registro y booleanos", async () => {
  const { actions, dbCalls } = loadAdminActions({ access: ADMIN() });
  for (const input of [
    { featureId: "no_existe", enabled: true }, { featureId: "mi_negocio", enabled: "false" },
    { featureId: "mi_negocio; drop table profiles", enabled: true }, { featureId: null, enabled: true }, null, {},
  ]) {
    const result = await actions.setFeatureFlagAction(input);
    assert.equal(result.success, false);
  }
  assert.deepEqual(dbCalls.filter((call) => typeof call === "object"), [], "nada llegó a la base");
});

test("11. un usuario no autorizado no puede modificar ni leer la configuración de administración", async () => {
  for (const access of [PAID(), FREE(), accessSnapshot({ authenticated: false })]) {
    const { actions, dbCalls, invalidated } = loadAdminActions({ access, upsertResult: { data: { feature_id: "mi_negocio", enabled: false }, error: null } });
    const write = await actions.setFeatureFlagAction({ featureId: "mi_negocio", enabled: false });
    assert.equal(write.success, false);
    const read = await actions.loadFeatureFlagsAdminAction();
    assert.equal(read.success, false);
    assert.equal(read.code, "forbidden");
    assert.deepEqual(dbCalls, [], "ni una consulta a la base");
    assert.equal(invalidated.count, 0);
  }
});

test("10c. errores de guardado/carga: mensajes seguros y migration faltante distinguida", async () => {
  const failing = loadAdminActions({ access: ADMIN(), upsertResult: { data: null, error: { code: "42501", message: "new row violates row-level security policy" } } });
  const saved = await failing.actions.setFeatureFlagAction({ featureId: "sorteos", enabled: true });
  assert.equal(saved.success, false);
  assert.ok(!/row-level|policy|42501/.test(saved.error), "no filtra detalles internos");
  assert.equal(failing.invalidated.count, 0);

  const missingTable = loadAdminActions({ access: ADMIN(), selectResult: { data: null, error: { code: "42P01", message: "relation does not exist" } } });
  const loaded = await missingTable.actions.loadFeatureFlagsAdminAction();
  assert.equal(loaded.success, false);
  assert.equal(loaded.code, "migration_missing");

  const ok = loadAdminActions({ access: ADMIN(), selectResult: { data: [
    { feature_id: "sorteos", enabled: false, updated_at: "2026-10-24T10:00:00Z" },
    { feature_id: "fantasma", enabled: true, updated_at: null },
  ], error: null } });
  const rows = await ok.actions.loadFeatureFlagsAdminAction();
  assert.deepEqual(rows, { success: true, rows: [{ featureId: "sorteos", enabled: false, updatedAt: "2026-10-24T10:00:00Z" }] });
});

test("10d. panel de administración: tarjeta en el hub, rutas protegidas por el proxy y UI accesible", () => {
  assert.match(read("src/app/admin/page.tsx"), /href="\/admin\/funcionalidades"[\s\S]*Gestión de funcionalidades/);
  const manager = read("src/components/admin/feature-flags-manager.tsx");
  assert.match(manager, /role="switch"/);
  assert.match(manager, /aria-checked/);
  assert.match(manager, /confirmAction\(/, "confirma antes de deshabilitar");
  assert.match(manager, /toast\.error/);
  assert.match(manager, /Loader2/);
  assert.match(manager, /Sin configurar/);
  assert.match(read("src/app/admin/funcionalidades/loading.tsx"), /aria-busy/);
  // /admin/* ya exige rol admin en el proxy.
  assert.match(read("src/utils/supabase/middleware.ts"), /pathname\.startsWith\('\/admin'\) && !access\.capabilities\.accessAdmin/);
});

// ---------------------------------------------------------------------------------------------------------------
// Backend: Server Actions, API routes y Stampy
// ---------------------------------------------------------------------------------------------------------------

test("backend: Server Actions y API routes de funcionalidades controladas validan su flag", () => {
  const expectations = [
    ["src/app/mi-negocio/actions.ts", /isFeatureAvailable\(supabase, "mi_negocio", access\)/],
    ["src/app/productos/actions.ts", /isFeatureAvailable\(supabase, "mi_taller", access\)/],
    ["src/app/stampa-maker/jarros/actions.ts", /isFeatureAvailable\(supabase, "stampa_maker", access\)/],
    ["src/app/stampy/feedback-actions.ts", /isFeatureAvailable\(supabase, "stampy", access\)/],
    ["src/lib/stampy/action-settings-actions.ts", /isFeatureAvailable\(supabase, "stampy", access\)/],
    ["src/lib/stampy/action-requests.ts", /ensureStampyActionFeatures/],
    ["src/app/stampy/actions.ts", /featureGate\.isFeatureAvailable\("stampy"\)/],
    ["src/app/api/stl/download/route.ts", /featureGuardResponse\(supabaseServer, "libreria_stl", access\)/],
    ["src/app/api/stl/preview/route.ts", /featureGuardResponse\(supabaseServer, "libreria_stl", access\)/],
    ["src/app/api/model-search/route.ts", /featureGuardResponse\(supabase, "explorar_modelos", access\)/],
    ["src/app/api/calculator/catalog/route.ts", /featureGuardResponse\(supabase, "calculadora"\)/],
    ["src/app/api/calculator/preferences/route.ts", /featureGuardResponse\(supabase, "calculadora"\)/],
    ["src/app/api/calculator/selections/route.ts", /featureGuardResponse\(supabase, "calculadora"\)/],
    ["src/app/api/business/mercadopago/connect/route.ts", /featureGuardResponse\(supabase, "mi_negocio", access\)/],
    ["src/app/api/business/mercadopago/disconnect/route.ts", /featureGuardResponse\(supabase, "mi_negocio", access\)/],
    ["src/app/api/business/storefront/[slug]/checkout/route.ts", /featureGuardResponse\(await createClient\(\), "tienda_online"\)/],
  ];
  for (const [file, pattern] of expectations) assert.match(read(file), pattern, file);

  // Cada API route declarada en el registro tiene su guard (salvo las que no existen como handler).
  for (const feature of registry.FEATURE_REGISTRY) {
    for (const apiRoute of feature.apiRoutes ?? []) {
      assert.ok(apiRoute.startsWith("/api/"), apiRoute);
    }
  }
  // La acción de mi-negocio centraliza el guard: las 34 acciones pasan por authorizeBusinessAccess.
  const businessActions = read("src/app/mi-negocio/actions.ts");
  assert.ok((businessActions.match(/authorizeBusinessAccess\(\)/g) ?? []).length >= 30);
  // Webhooks, callback y expiración de pedidos NO se gatean: cortarían pagos en curso.
  for (const file of [
    "src/app/api/mercadopago/webhook/route.ts",
    "src/app/api/business/mercadopago/webhook/route.ts",
    "src/app/api/business/mercadopago/callback/route.ts",
    "src/app/api/business/orders/expire/route.ts",
  ]) assert.doesNotMatch(read(file), /featureGuardResponse|isFeatureAvailable/, file);
});

test("Stampy: no recomienda ni ejecuta acciones de herramientas deshabilitadas, pero sigue respondiendo", () => {
  const { buildStampyFeatureGate } = loadTs("src/lib/stampy/feature-gate.ts");
  const knowledge = loadTs("src/lib/stampy/app-knowledge.ts").STAMPY_APP_KNOWLEDGE;
  const registryTools = loadTs("src/lib/stampy/tool-registry.ts");

  const gate = buildStampyFeatureGate(disabled("mi_negocio", "calculadora"), { isAdmin: false });
  assert.equal(gate.isFeatureAvailable("stampy"), true, "Stampy sigue respondiendo");
  assert.equal(gate.isFeatureAvailable("mi_negocio"), false);
  const routes = gate.filterByRoute(knowledge, (item) => item.route).map((item) => item.route).filter(Boolean);
  assert.ok(!routes.some((route) => route.startsWith("/calculadora") || route.startsWith("/presupuestos") || route.startsWith("/mi-negocio")));
  assert.ok(routes.some((route) => route.startsWith("/mi-taller")), "lo habilitado sigue recomendándose");
  assert.ok(knowledge.some((item) => item.route === "/calculadora"), "el conocimiento no se borra, solo se filtra");

  const contracts = gate.filterByRoute(registryTools.STAMPY_TOOL_CONTRACTS ?? [], (contract) => contract.route);
  assert.ok(contracts.every((contract) => !contract.route.startsWith("/calculadora") && !contract.route.startsWith("/presupuestos")));

  const notice = gate.buildPromptNotice();
  assert.match(notice, /Mi Negocio/);
  assert.match(notice, /Calculadora/);
  assert.match(notice, /todavía no está disponible/);
  assert.equal(buildStampyFeatureGate(disabled("mi_negocio"), { isAdmin: true }).buildPromptNotice(), null, "administradores sin restricciones");
  assert.equal(buildStampyFeatureGate(UNINITIALIZED, { isAdmin: false }).buildPromptNotice(), null);
  assert.equal(buildStampyFeatureGate(disabled("stampy"), { isAdmin: false }).isFeatureAvailable("stampy"), false);

  const actions = read("src/app/stampy/actions.ts");
  assert.match(actions, /shouldCheckProductStockTools && featureGate\.isFeatureAvailable\("mi_taller"\)/);
  assert.match(actions, /featureGate\.isFeatureAvailable\("mi_negocio"\) && hasClientScreenContext/);
  assert.match(actions, /featureGate\.isRouteAvailable\(detectedActionIntent\.toolHref\)/);
  assert.match(actions, /featureGate\.filterByRoute\(knowledgeTools/);
  assert.match(actions, /featureGate\.buildPromptNotice\(\)/);
});

// ---------------------------------------------------------------------------------------------------------------
// Pantalla "no disponible", migration, PWA y documentación del despliegue seguro
// ---------------------------------------------------------------------------------------------------------------

test("pantalla no disponible: mensaje, botón a Inicio y sin detalles técnicos; nombres solo del registro", () => {
  const { FeatureUnavailable } = loadTs("src/components/features/feature-unavailable.tsx", navMocks);
  const html = renderToStaticMarkup(h(FeatureUnavailable, { featureName: "Mi Negocio" }));
  assert.match(html, /Esta herramienta todavía no está disponible\./);
  assert.match(html, /Estamos trabajando para incorporarla próximamente a Universo Stampa\./);
  assert.match(html, /href="\/"[^>]*>Volver a Inicio</);
  assert.match(html, /Mi Negocio/);
  assert.doesNotMatch(html, /error|exception|stack|feature_id|platform_feature_flags/i);

  const page = read("src/app/no-disponible/page.tsx");
  assert.match(page, /isFeatureId\(raw\)/, "el nombre sale del registro, nunca del texto de la URL");
  assert.match(page, /robots: \{ index: false/);
  // Distinción de estados: login (no autenticado), /sin-acceso (plan), /no-disponible (flag), 404 (inexistente).
  const proxy = read("src/utils/supabase/middleware.ts");
  assert.match(proxy, /redirectWithCookies\('\/login'\)/);
  assert.match(proxy, /redirectWithCookies\('\/sin-acceso'\)/);
  assert.match(proxy, /pathname === '\/no-disponible'/);
  assert.equal(registry.FEATURE_UNAVAILABLE_ROUTE, "/no-disponible");
});

test("migration: tabla con RLS, lectura pública, escritura solo admin, sin seed ni cambios a datos de usuarios", () => {
  const sql = read("supabase/migrations/20261024120000_platform_feature_flags.sql");
  assert.match(sql, /create table if not exists public\.platform_feature_flags/);
  assert.match(sql, /feature_id text primary key/);
  assert.match(sql, /enabled boolean not null/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /for select to anon, authenticated\s+using \(true\)/);
  assert.match(sql, /for insert to authenticated\s+with check \(public\.is_admin\(auth\.uid\(\)\)\)/);
  assert.match(sql, /for update to authenticated\s+using \(public\.is_admin\(auth\.uid\(\)\)\)\s+with check \(public\.is_admin\(auth\.uid\(\)\)\)/);
  assert.doesNotMatch(sql, /for delete to authenticated/, "sin DELETE para authenticated");
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*to anon/i);
  assert.doesNotMatch(sql, /insert into public\.platform_feature_flags/i, "no siembra filas: aplicar la migration no restringe nada");
  assert.doesNotMatch(sql, /\b(update|delete from|truncate|drop table|alter table) +public\.(profiles|user_access_grants|products|filaments|printers)/i);
  assert.match(sql, /new\.updated_by := auth\.uid\(\)/, "el autor del cambio sale de la sesión");
  assert.match(sql, /feature_id ~ '\^\[a-z\]\[a-z0-9_\]\{1,47\}\$'/);
});

test("PWA: sin service worker, así que el estado de las flags solo depende de la red y del proxy", () => {
  const files = [read("src/app/manifest.ts"), read("next.config.ts"), read("src/app/layout.tsx")].join("\n");
  assert.doesNotMatch(files, /serviceWorker|workbox|next-pwa|sw\.js/);
  assert.doesNotMatch(read("src/app/manifest.ts"), /shortcuts/, "el manifest no define accesos directos a herramientas");
  // La navegación se vuelve a consultar en cada cambio de ruta.
  assert.match(read("src/components/features/feature-flags-provider.tsx"), /\[supabase, pathname\]/);
});
