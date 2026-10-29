// Estado de visualización de los tutoriales.
//
// Fuente de verdad: `user_tool_tutorial_views` (una fila por usuario + herramienta, la misma tabla de siempre).
// `seen_version` (migration 20261031090000) guarda la versión del tutorial que la persona ya vio; las filas
// anteriores a la columna valen versión 1, así que NADIE que ya vio una guía la ve de nuevo por este cambio.
//
// Respaldo: un espejo en localStorage por usuario (`stampa-tutorial-seen:<userId>:<tutorialId>`) evita volver a
// mostrar la guía si la base no responde o la migration todavía no se aplicó. Va por userId para que dos cuentas
// que comparten navegador no mezclen su estado.

const VIEWS_TABLE = "user_tool_tutorial_views";
const OVERRIDES_TABLE = "tool_tutorials";
const LOCAL_PREFIX = "stampa-tutorial-seen";

/** Lo mínimo que se usa del cliente de Supabase (permite probar sin red). */
export interface TutorialSupabase {
  // El query builder de Supabase está tipado por schema generado, que este repo no usa: se acepta cualquier forma.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

export interface TutorialStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function localSeenKey(userId: string, tutorialId: string): string {
  return `${LOCAL_PREFIX}:${userId}:${tutorialId}`;
}

function browserStorage(): TutorialStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function toVersion(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : null;
}

export function readLocalSeenVersion(
  userId: string,
  tutorialId: string,
  storage: TutorialStorage | null = browserStorage(),
): number | null {
  try {
    return toVersion(storage?.getItem(localSeenKey(userId, tutorialId)));
  } catch {
    return null;
  }
}

export function writeLocalSeenVersion(
  userId: string,
  tutorialId: string,
  version: number,
  storage: TutorialStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(localSeenKey(userId, tutorialId), String(version));
  } catch {
    // Storage bloqueado o lleno: el estado igual queda en la base.
  }
}

/** ¿La persona ya vio esta versión (o una posterior)? */
export function hasSeenTutorial(seenVersion: number | null, currentVersion: number): boolean {
  return seenVersion !== null && seenVersion >= currentVersion;
}

export interface AutoOpenInput {
  /** `null` = no se pudo leer nada / nunca lo vio. */
  seenVersion: number | null;
  version: number;
  /** El estado ya se consultó (evita abrir antes de saber si ya lo vio). */
  checked: boolean;
  alreadyAutoOpened: boolean;
  /** Algo más ocupa la pantalla (p. ej. el menú móvil). */
  blocked: boolean;
}

export function shouldAutoOpenTutorial(input: AutoOpenInput): boolean {
  return input.checked && !input.alreadyAutoOpened && !input.blocked && !hasSeenTutorial(input.seenVersion, input.version);
}

/**
 * Versión vista según la base. `ok: false` si no se pudo leer (el caller decide con el espejo local).
 * Si la columna `seen_version` no existe todavía, se lee sin ella y toda fila cuenta como versión 1.
 */
export async function fetchSeenVersion(
  supabase: TutorialSupabase,
  userId: string,
  tutorialId: string,
): Promise<{ ok: boolean; version: number | null }> {
  const select = (columns: string) =>
    supabase.from(VIEWS_TABLE).select(columns).eq("user_id", userId).eq("tool_key", tutorialId).maybeSingle();

  let result = await select("tool_key, viewed_at, dismissed_at, seen_version");
  if (result.error) result = await select("tool_key, viewed_at, dismissed_at");
  if (result.error) return { ok: false, version: null };

  const row = result.data as { seen_version?: unknown } | null;
  if (!row) return { ok: true, version: null };
  return { ok: true, version: toVersion(row.seen_version) ?? 1 };
}

/** Versión vista combinando base y espejo local (gana la mayor). */
export async function loadSeenVersion(
  supabase: TutorialSupabase,
  userId: string,
  tutorialId: string,
  storage: TutorialStorage | null = browserStorage(),
): Promise<number | null> {
  const remote = await fetchSeenVersion(supabase, userId, tutorialId).catch(() => ({ ok: false, version: null }));
  const local = readLocalSeenVersion(userId, tutorialId, storage);
  if (remote.version === null) return local;
  return local === null ? remote.version : Math.max(remote.version, local);
}

/** Registra que la persona vio (completó, omitió o cerró) esta versión. Devuelve si quedó guardada en la base. */
export async function markTutorialSeen(
  supabase: TutorialSupabase,
  userId: string,
  tutorialId: string,
  version: number,
  storage: TutorialStorage | null = browserStorage(),
): Promise<boolean> {
  writeLocalSeenVersion(userId, tutorialId, version, storage);

  const now = new Date().toISOString();
  const base = { user_id: userId, tool_key: tutorialId, viewed_at: now, dismissed_at: now };
  const upsert = (payload: Record<string, unknown>) =>
    supabase.from(VIEWS_TABLE).upsert([payload], { onConflict: "user_id,tool_key" });

  try {
    let { error } = await upsert({ ...base, seen_version: version });
    // Sin la columna (migration pendiente) se guarda igual la fila: cuenta como versión 1.
    if (error) ({ error } = await upsert(base));
    return !error;
  } catch {
    return false;
  }
}

export interface TutorialOverride {
  /** Fila de `tool_tutorials` con `is_active = false`: interruptor para apagar una guía sin deploy. */
  disabled: boolean;
  /** Video cargado en la fila (se usa si el tutorial no define uno en el código). */
  videoUrl: string | null;
}

/** Datos opcionales de `tool_tutorials`. La ausencia de fila (o un error) no desactiva nada. */
export async function fetchTutorialOverride(supabase: TutorialSupabase, tutorialId: string): Promise<TutorialOverride> {
  try {
    const { data, error } = await supabase
      .from(OVERRIDES_TABLE)
      .select("is_active, video_url")
      .eq("tool_key", tutorialId)
      .maybeSingle();
    if (error || !data) return { disabled: false, videoUrl: null };
    return {
      disabled: data.is_active === false,
      videoUrl: typeof data.video_url === "string" ? data.video_url : null,
    };
  } catch {
    return { disabled: false, videoUrl: null };
  }
}
