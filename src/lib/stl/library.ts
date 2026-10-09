/**
 * Librería STL: Grupo -> Modelos.
 *
 * "Grupo" es `stl_categories` (ya tenía slug, descripción, portada, sort_order e is_active);
 * `stl_models.category_id` es la relación. No existe una segunda entidad de grupos.
 * Los modelos activos sin categoría se muestran en el grupo virtual "Otros modelos"
 * (no se crea ningún dato en DB).
 */

export const UNGROUPED_GROUP_SLUG = "otros-modelos";
export const UNGROUPED_GROUP_NAME = "Otros modelos";

/** Límite del viewer 3D: por encima se ofrece solo la descarga. */
export const STL_VIEWER_MAX_BYTES = 60 * 1024 * 1024;

export interface StlGroupRow {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  thumbnail_url: string | null;
  sort_order: number | null;
  is_active: boolean | null;
}

export interface StlModelRow {
  id: string;
  category_id: string | null;
  is_active: boolean | null;
  [key: string]: unknown;
}

export interface StlGroupSummary {
  /** null = grupo virtual "Otros modelos". */
  id: string | null;
  slug: string;
  name: string;
  description: string | null;
  thumbnailUrl: string | null;
  modelCount: number;
  isVirtual: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function slugifyGroupName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Segmento de URL de un grupo: slug si existe, si no el id. */
export function groupPathSegment(group: { id: string | null; slug: string | null }): string {
  return group.slug?.trim() || group.id || UNGROUPED_GROUP_SLUG;
}

export function groupHref(group: { id: string | null; slug: string | null }): string {
  return `/libreria-stl/${encodeURIComponent(groupPathSegment(group))}`;
}

export function modelHref(group: { id: string | null; slug: string | null }, modelId: string): string {
  return `${groupHref(group)}/${encodeURIComponent(modelId)}`;
}

function publishedModels<T extends StlModelRow>(models: T[]): T[] {
  return models.filter((model) => model.is_active === true);
}

function publishedGroups(groups: StlGroupRow[]): StlGroupRow[] {
  return groups.filter((group) => group.is_active === true);
}

/** Modelos visibles públicamente de un grupo (null = "Otros modelos"). */
export function modelsOfGroup<T extends StlModelRow>(
  groups: StlGroupRow[],
  models: T[],
  groupId: string | null,
): T[] {
  const live = publishedModels(models);
  if (groupId === null) return live.filter((model) => !model.category_id);
  const group = publishedGroups(groups).find((candidate) => candidate.id === groupId);
  if (!group) return [];
  return live.filter((model) => model.category_id === group.id);
}

/**
 * Grupos para la home de la Librería: solo publicados, ordenados por sort_order,
 * con contador de modelos publicados. Los grupos publicados sin modelos no se muestran
 * (la home no debe llevar a páginas vacías). "Otros modelos" va al final si hay huérfanos.
 */
export function buildGroupSummaries(groups: StlGroupRow[], models: StlModelRow[]): StlGroupSummary[] {
  const summaries: StlGroupSummary[] = publishedGroups(groups)
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, "es"))
    .map((group) => ({
      id: group.id,
      slug: groupPathSegment(group),
      name: group.name,
      description: group.description?.trim() || null,
      thumbnailUrl: group.thumbnail_url?.trim() || null,
      modelCount: modelsOfGroup(groups, models, group.id).length,
      isVirtual: false,
    }))
    .filter((summary) => summary.modelCount > 0);

  const orphanCount = modelsOfGroup(groups, models, null).length;
  if (orphanCount > 0) {
    summaries.push({
      id: null,
      slug: UNGROUPED_GROUP_SLUG,
      name: UNGROUPED_GROUP_NAME,
      description: null,
      thumbnailUrl: null,
      modelCount: orphanCount,
      isVirtual: true,
    });
  }
  return summaries;
}

/**
 * Resuelve el segmento de URL a un grupo público. Prioridad: slug real, id (uuid),
 * y por último el grupo virtual. Un grupo no publicado no se resuelve.
 */
export function resolveGroupSegment(
  groups: StlGroupRow[],
  segment: string,
): { id: string | null; slug: string | null; name: string; description: string | null; isVirtual: boolean } | null {
  const live = publishedGroups(groups);
  const bySlug = live.find((group) => group.slug?.trim() === segment);
  const byId = isUuid(segment) ? live.find((group) => group.id === segment) : undefined;
  const found = bySlug ?? byId;
  if (found) {
    return {
      id: found.id,
      slug: found.slug?.trim() || null,
      name: found.name,
      description: found.description?.trim() || null,
      isVirtual: false,
    };
  }
  if (segment === UNGROUPED_GROUP_SLUG) {
    return { id: null, slug: UNGROUPED_GROUP_SLUG, name: UNGROUPED_GROUP_NAME, description: null, isVirtual: true };
  }
  return null;
}

export type StlViewerSupport = { supported: true } | { supported: false; reason: string };

/** El viewer solo abre `.stl`; .3mf/.zip/URLs externas se descargan sin preview. */
export function getStlViewerSupport(fileReference: string | null | undefined): StlViewerSupport {
  const ref = (fileReference ?? "").trim();
  if (!ref) return { supported: false, reason: "Este modelo todavía no tiene archivo." };
  if (/^https?:\/\//i.test(ref)) {
    return { supported: false, reason: "El archivo está alojado fuera de la plataforma: no hay vista previa 3D." };
  }
  const clean = ref.split("?")[0].toLowerCase();
  if (!clean.endsWith(".stl")) {
    return { supported: false, reason: "La vista previa 3D solo está disponible para archivos .stl." };
  }
  return { supported: true };
}

export interface StlDimensions {
  x: number;
  y: number;
  z: number;
}

/** "143 × 81 × 52" — sin unidad: el STL no declara unidades. */
export function formatStlDimensions(dimensions: StlDimensions): string {
  const fmt = (value: number) =>
    new Intl.NumberFormat("es-AR", { maximumFractionDigits: value >= 100 ? 0 : 1 }).format(value);
  return `${fmt(dimensions.x)} × ${fmt(dimensions.y)} × ${fmt(dimensions.z)}`;
}
