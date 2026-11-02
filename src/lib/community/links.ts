/**
 * Redes sociales y canales de comunidad de Stampa (tabla public.community_links).
 *
 * Módulo puro (sin React ni Supabase): tipos, catálogo de plataformas, validación de URL/entradas del Admin y
 * helpers de audiencia. La autorización real de lectura vive en la base (RLS + RPC list_community_links); las
 * funciones de audiencia de aquí solo alimentan la vista previa del Admin y deben reflejar esas reglas.
 */

export const COMMUNITY_KINDS = ["social", "channel"] as const;
export type CommunityKind = (typeof COMMUNITY_KINDS)[number];

export const ACCESS_LEVELS = ["public", "registered", "premium"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  public: "Público",
  registered: "Usuarios registrados",
  premium: "Usuarios Premium",
};

export const ACCESS_LEVEL_HINTS: Record<AccessLevel, string> = {
  public: "Lo ve cualquiera, también quien no inició sesión.",
  registered: "Solo con sesión iniciada.",
  premium: "Solo con membresía o acceso de plataforma. El enlace no se expone a nadie más.",
};

export const CHANNEL_TYPES = ["channel", "group", "community", "server"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const CHANNEL_TYPE_LABELS: Record<ChannelType, string> = {
  channel: "Canal",
  group: "Grupo",
  community: "Comunidad",
  server: "Servidor",
};

/** Quién mira: un visitante, un usuario con sesión sin acceso de pago, o un usuario con acceso de plataforma/admin. */
export const AUDIENCES = ["anonymous", "registered", "premium"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const AUDIENCE_LABELS: Record<Audience, string> = {
  anonymous: "Visitante",
  registered: "Registrado",
  premium: "Premium",
};

/** Claves de icono disponibles; el componente de iconos las traduce a un SVG. */
export const COMMUNITY_ICON_KEYS = [
  "instagram",
  "youtube",
  "tiktok",
  "facebook",
  "x",
  "discord",
  "whatsapp",
  "telegram",
  "globe",
  "store",
  "users",
  "megaphone",
  "link",
] as const;
export type CommunityIconKey = (typeof COMMUNITY_ICON_KEYS)[number];

export const COMMUNITY_ICON_LABELS: Record<CommunityIconKey, string> = {
  instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  facebook: "Facebook",
  x: "X",
  discord: "Discord",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  globe: "Sitio web",
  store: "Tienda",
  users: "Comunidad",
  megaphone: "Novedades",
  link: "Enlace",
};

export interface PlatformDefinition {
  id: string;
  label: string;
  /** Icono por defecto cuando el enlace no define uno propio. */
  iconKey: CommunityIconKey;
  /** Clases de color de la tarjeta (mismas paletas que ya usaban /redes y /canales). */
  tone: string;
  /** Tipo de enlace para el que se sugiere primero en el formulario. */
  suggestedFor: CommunityKind;
}

export const PLATFORMS: readonly PlatformDefinition[] = [
  { id: "instagram", label: "Instagram", iconKey: "instagram", tone: "bg-fuchsia-50 text-fuchsia-600 border-fuchsia-100", suggestedFor: "social" },
  { id: "youtube", label: "YouTube", iconKey: "youtube", tone: "bg-red-50 text-red-600 border-red-100", suggestedFor: "social" },
  { id: "tiktok", label: "TikTok", iconKey: "tiktok", tone: "bg-stampa-bg-soft text-fg border-stampa-border", suggestedFor: "social" },
  { id: "facebook", label: "Facebook", iconKey: "facebook", tone: "bg-blue-50 text-blue-600 border-blue-100", suggestedFor: "social" },
  { id: "x", label: "X", iconKey: "x", tone: "bg-stampa-bg-soft text-fg border-stampa-border", suggestedFor: "social" },
  { id: "whatsapp", label: "WhatsApp", iconKey: "whatsapp", tone: "bg-green-50 text-green-600 border-green-100", suggestedFor: "channel" },
  { id: "telegram", label: "Telegram", iconKey: "telegram", tone: "bg-sky-50 text-sky-600 border-sky-100", suggestedFor: "channel" },
  { id: "discord", label: "Discord", iconKey: "discord", tone: "bg-indigo-50 text-indigo-600 border-indigo-100", suggestedFor: "channel" },
  { id: "website", label: "Sitio web / tienda", iconKey: "store", tone: "bg-orange-50 text-stampa-accent border-orange-100", suggestedFor: "social" },
  { id: "other", label: "Otra plataforma", iconKey: "link", tone: "bg-stampa-bg-soft text-fg border-stampa-border", suggestedFor: "social" },
];

const PLATFORM_BY_ID = new Map(PLATFORMS.map((platform) => [platform.id, platform]));
const FALLBACK_PLATFORM = PLATFORM_BY_ID.get("other") as PlatformDefinition;

export function getPlatform(id: string | null | undefined): PlatformDefinition {
  return (id ? PLATFORM_BY_ID.get(id) : undefined) ?? FALLBACK_PLATFORM;
}

export function isPlatformId(value: unknown): value is string {
  return typeof value === "string" && PLATFORM_BY_ID.has(value);
}

export function platformsForKind(kind: CommunityKind): PlatformDefinition[] {
  return [...PLATFORMS].sort(
    (a, b) => Number(b.suggestedFor === kind) - Number(a.suggestedFor === kind),
  );
}

export function resolveIconKey(link: { iconKey: string | null; platform: string }): CommunityIconKey {
  if (isIconKey(link.iconKey)) return link.iconKey;
  return getPlatform(link.platform).iconKey;
}

export function isIconKey(value: unknown): value is CommunityIconKey {
  return typeof value === "string" && (COMMUNITY_ICON_KEYS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------------------------------------------
// Modelos
// ---------------------------------------------------------------------------------------------------------------

/** Lo que recibe una pantalla de usuario: `url` es null cuando el enlace está bloqueado para quien lo mira. */
export interface CommunityLink {
  id: string;
  kind: CommunityKind;
  platform: string;
  name: string;
  channelType: ChannelType | null;
  description: string | null;
  iconKey: string | null;
  accessLevel: AccessLevel;
  sortOrder: number;
  url: string | null;
  locked: boolean;
}

/** Fila completa para el Admin (incluye inactivas y la URL siempre). */
export interface CommunityLinkAdmin {
  id: string;
  kind: CommunityKind;
  platform: string;
  name: string;
  channelType: ChannelType | null;
  description: string | null;
  iconKey: string | null;
  accessLevel: AccessLevel;
  sortOrder: number;
  url: string;
  isActive: boolean;
  updatedAt: string | null;
}

/** Datos editables que envía el formulario del Admin (siempre se vuelven a validar en el servidor). */
export interface CommunityLinkInput {
  kind: CommunityKind;
  platform: string;
  name: string;
  channelType: ChannelType | null;
  description: string | null;
  url: string;
  iconKey: CommunityIconKey | null;
  accessLevel: AccessLevel;
  isActive: boolean;
}

export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 280;
export const URL_MAX = 500;

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export const isCommunityKind = (value: unknown): value is CommunityKind => isOneOf(COMMUNITY_KINDS, value);
export const isAccessLevel = (value: unknown): value is AccessLevel => isOneOf(ACCESS_LEVELS, value);
export const isChannelType = (value: unknown): value is ChannelType => isOneOf(CHANNEL_TYPES, value);

// ---------------------------------------------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------------------------------------------

export type UrlValidation = { ok: true; url: string; host: string } | { ok: false; error: string };

/**
 * Solo https, con dominio, sin credenciales embebidas ni espacios. Devuelve la URL normalizada y el host.
 * Nunca se hace una petición a la URL: solo se valida su forma (no hay SSRF).
 */
export function validateCommunityUrl(raw: unknown): UrlValidation {
  if (typeof raw !== "string") return { ok: false, error: "Ingresá la URL del enlace." };
  const value = raw.trim();
  if (!value) return { ok: false, error: "Ingresá la URL del enlace." };
  if (value.length > URL_MAX) return { ok: false, error: `La URL no puede superar los ${URL_MAX} caracteres.` };
  if (/\s/.test(value)) return { ok: false, error: "La URL no puede contener espacios." };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, error: "La URL no es válida. Tiene que empezar con https://" };
  }

  if (parsed.protocol !== "https:") return { ok: false, error: "Solo se permiten enlaces seguros que empiecen con https://" };
  if (parsed.username || parsed.password) return { ok: false, error: "La URL no puede incluir usuario ni contraseña." };
  if (!parsed.hostname || !parsed.hostname.includes(".")) return { ok: false, error: "La URL necesita un dominio válido (por ejemplo instagram.com)." };

  const normalized = parsed.toString();
  if (normalized.length > URL_MAX) return { ok: false, error: `La URL no puede superar los ${URL_MAX} caracteres.` };
  return { ok: true, url: normalized, host: parsed.hostname.replace(/^www\./, "") };
}

export function linkHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export type CommunityLinkField = "kind" | "platform" | "name" | "channelType" | "description" | "url" | "accessLevel";
export type NormalizeResult =
  | { ok: true; value: CommunityLinkInput }
  | { ok: false; errors: Partial<Record<CommunityLinkField, string>> };

/** Valida y normaliza lo que llega del cliente. Las reglas por tipo (social/canal) se imponen aquí y en la base. */
export function normalizeCommunityLinkInput(raw: unknown): NormalizeResult {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const errors: Partial<Record<CommunityLinkField, string>> = {};

  const kind = isCommunityKind(input.kind) ? input.kind : null;
  if (!kind) errors.kind = "Elegí si es una red social o un canal.";

  const platform = isPlatformId(input.platform) ? input.platform : null;
  if (!platform) errors.platform = "Elegí una plataforma.";

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) errors.name = "Ingresá un nombre.";
  else if (name.length > NAME_MAX) errors.name = `El nombre no puede superar los ${NAME_MAX} caracteres.`;

  const descriptionRaw = typeof input.description === "string" ? input.description.trim() : "";
  if (descriptionRaw.length > DESCRIPTION_MAX) errors.description = `La descripción no puede superar los ${DESCRIPTION_MAX} caracteres.`;

  const urlResult = validateCommunityUrl(input.url);
  if (!urlResult.ok) errors.url = urlResult.error;

  let channelType: ChannelType | null = null;
  let accessLevel: AccessLevel = "public";
  if (kind === "channel") {
    if (isChannelType(input.channelType)) channelType = input.channelType;
    else errors.channelType = "Elegí el tipo de canal.";
    if (isAccessLevel(input.accessLevel)) accessLevel = input.accessLevel;
    else errors.accessLevel = "Elegí el nivel de acceso.";
  }

  if (Object.keys(errors).length > 0 || !kind || !platform || !urlResult.ok) return { ok: false, errors };

  return {
    ok: true,
    value: {
      kind,
      platform,
      name,
      channelType,
      description: descriptionRaw || null,
      url: urlResult.url,
      iconKey: isIconKey(input.iconKey) ? input.iconKey : null,
      accessLevel,
      isActive: typeof input.isActive === "boolean" ? input.isActive : true,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Audiencia (vista previa del Admin; la protección real es RLS/RPC)
// ---------------------------------------------------------------------------------------------------------------

const ACCESS_RANK: Record<AccessLevel, number> = { public: 0, registered: 1, premium: 2 };
const AUDIENCE_RANK: Record<Audience, number> = { anonymous: 0, registered: 1, premium: 2 };

export function audienceCanAccess(level: AccessLevel, audience: Audience): boolean {
  return AUDIENCE_RANK[audience] >= ACCESS_RANK[level];
}

/**
 * Reproduce `list_community_links()` para una audiencia: solo activas; sin acceso -> url null + locked; un visitante
 * sin sesión no recibe filas bloqueadas.
 */
export function previewForAudience(links: readonly CommunityLinkAdmin[], audience: Audience): CommunityLink[] {
  return sortCommunityLinks(
    links
      .filter((link) => link.isActive)
      .flatMap((link): CommunityLink[] => {
        const allowed = audienceCanAccess(link.accessLevel, audience);
        if (!allowed && audience === "anonymous") return [];
        return [
          {
            id: link.id,
            kind: link.kind,
            platform: link.platform,
            name: link.name,
            channelType: link.channelType,
            description: link.description,
            iconKey: link.iconKey,
            accessLevel: link.accessLevel,
            sortOrder: link.sortOrder,
            url: allowed ? link.url : null,
            locked: !allowed,
          },
        ];
      }),
  );
}

export function sortCommunityLinks<T extends { kind: CommunityKind; sortOrder: number }>(links: readonly T[]): T[] {
  const kindRank = (kind: CommunityKind) => COMMUNITY_KINDS.indexOf(kind);
  return [...links].sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.sortOrder - b.sortOrder);
}

/** Intercambia un id con su vecino en la lista de ids; devuelve la misma lista si no hay movimiento posible. */
export function moveId(ids: readonly string[], id: string, direction: "up" | "down"): string[] {
  const index = ids.indexOf(id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= ids.length) return [...ids];
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function nextSortOrder(links: readonly { kind: CommunityKind; sortOrder: number }[], kind: CommunityKind): number {
  return links.reduce((max, link) => (link.kind === kind ? Math.max(max, link.sortOrder + 1) : max), 0);
}

// ---------------------------------------------------------------------------------------------------------------
// Filas de la base -> modelos
// ---------------------------------------------------------------------------------------------------------------

type RawRow = Record<string, unknown>;

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

function baseFields(raw: RawRow) {
  const id = str(raw.id);
  const platform = str(raw.platform);
  const name = str(raw.name);
  if (!id || !platform || !name || !isCommunityKind(raw.kind) || !isAccessLevel(raw.access_level)) return null;
  return {
    id,
    kind: raw.kind,
    platform,
    name,
    channelType: isChannelType(raw.channel_type) ? raw.channel_type : null,
    description: str(raw.description),
    iconKey: str(raw.icon_key),
    accessLevel: raw.access_level,
    sortOrder: typeof raw.sort_order === "number" ? raw.sort_order : 0,
  };
}

/** Fila de `list_community_links()`. Defensivo: una fila malformada se descarta. */
export function rowToCommunityLink(raw: unknown): CommunityLink | null {
  const row = (raw && typeof raw === "object" ? raw : {}) as RawRow;
  const base = baseFields(row);
  if (!base) return null;
  const url = str(row.url);
  return { ...base, url, locked: row.locked === true || url === null };
}

/** Fila de `community_links` leída por un administrador. */
export function rowToAdminLink(raw: unknown): CommunityLinkAdmin | null {
  const row = (raw && typeof raw === "object" ? raw : {}) as RawRow;
  const base = baseFields(row);
  const url = str(row.url);
  if (!base || !url) return null;
  return { ...base, url, isActive: row.is_active !== false, updatedAt: str(row.updated_at) };
}

/**
 * Enlaces que se usan SOLO si la tabla todavía no existe (migration sin aplicar), para no vaciar el footer ni las
 * pantallas de comunidad durante el despliegue. Coinciden con el seed de la migration; con la tabla aplicada manda
 * siempre la configuración del Admin.
 */
export const COMMUNITY_FALLBACK_LINKS: readonly CommunityLink[] = [
  { id: "fallback-instagram", kind: "social", platform: "instagram", name: "Instagram", channelType: null, description: "Contenido, novedades y avances de la comunidad.", iconKey: null, accessLevel: "public", sortOrder: 0, url: "https://instagram.com/extruye", locked: false },
  { id: "fallback-youtube", kind: "social", platform: "youtube", name: "YouTube", channelType: null, description: "Videos, tutoriales y contenido complementario de la academia.", iconKey: null, accessLevel: "public", sortOrder: 1, url: "https://youtube.com/extruye", locked: false },
  { id: "fallback-whatsapp", kind: "channel", platform: "whatsapp", name: "WhatsApp", channelType: "group", description: "Canal o grupo para avisos, consultas rápidas y comunidad.", iconKey: null, accessLevel: "public", sortOrder: 0, url: "https://chat.whatsapp.com/extruye", locked: false },
  { id: "fallback-telegram", kind: "channel", platform: "telegram", name: "Telegram", channelType: "channel", description: "Canal o grupo alternativo para novedades y comunidad.", iconKey: null, accessLevel: "public", sortOrder: 1, url: "https://t.me/extruye", locked: false },
];

/** Etiqueta del botón de acceso. */
export function openLabel(link: Pick<CommunityLink, "kind" | "platform" | "name" | "channelType">): string {
  const platform = getPlatform(link.platform);
  const target = link.platform === "other" || link.platform === "website" ? link.name : platform.label;
  if (link.kind === "channel") return `Unirme en ${target}`;
  return `Abrir ${target}`;
}
