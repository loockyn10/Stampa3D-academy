/**
 * Explorar Modelos — contratos comunes.
 *
 * Stampa actúa como descubridor: solo se devuelve metadata mínima y el enlace al modelo original. Nunca se
 * almacenan ni redistribuyen archivos de terceros. Los campos que la fuente no brinda quedan en `null`/`"unknown"`.
 */

export type ModelSourceId = "myminifactory" | "thingiverse";

export type CommercialUse = "allowed" | "prohibited" | "unknown";
export type AttributionRequired = true | false | "unknown";

export interface ModelLicense {
  /** Nombre tal como lo informa la fuente (o null). */
  name: string | null;
  url: string | null;
  commercialUse: CommercialUse;
  attributionRequired: AttributionRequired;
  /** null = la fuente no lo informa. */
  remixAllowed: boolean | null;
}

export interface ModelSearchResult {
  source: ModelSourceId;
  externalId: string;
  title: string;

  authorName: string | null;
  authorUrl: string | null;

  thumbnailUrl: string | null;
  /** URL pública del modelo en la fuente (https + dominio esperado del provider). */
  originalUrl: string;

  /** null = la fuente no lo informa. `true` NO implica uso comercial permitido. */
  isFree: boolean | null;

  license: ModelLicense;

  likes: number | null;
  downloads: number | null;
  views: number | null;
  rating: number | null;

  publishedAt: string | null;

  fileFormats: string[] | null;
}

export type ModelSort = "relevance" | "popular" | "newest";
export type CommercialFilter = "any" | CommercialUse;

export interface ModelSearchFilters {
  freeOnly: boolean;
  commercial: CommercialFilter;
  sort: ModelSort;
}

export interface ProviderCapabilities {
  sorts: readonly ModelSort[];
  /** Tamaño máximo de página que el provider acepta. */
  maxPerPage: number;
  /**
   * Filtro "solo gratuitos" aplicado por la propia fuente. Si es false el filtro no se ofrece para ese provider:
   * filtrar después de traer la página produciría páginas vacías o paginación engañosa.
   */
  freeFilter: boolean;
  /** Valores de uso comercial que la fuente puede filtrar de forma confiable (server-side). */
  commercialFilters: readonly Exclude<CommercialFilter, "any">[];
}

export interface ProviderSearchInput {
  query: string;
  filters: ModelSearchFilters;
  /** Página 1-based dentro del provider. */
  page: number;
  perPage: number;
  signal: AbortSignal;
}

export interface ProviderSearchPage {
  results: ModelSearchResult[];
  total: number | null;
  hasMore: boolean;
}

export interface ProviderHealth {
  status: "ok" | "disabled";
}

export interface ModelSearchProvider {
  readonly id: ModelSourceId;
  readonly label: string;
  /** false cuando falta la credencial server-side: el provider se reporta como `disabled`. */
  isEnabled(): boolean;
  getCapabilities(): ProviderCapabilities;
  /** Estado local (configuración). No hace requests externas para no gastar cuota. */
  health(): Promise<ProviderHealth>;
  search(input: ProviderSearchInput): Promise<ProviderSearchPage>;
}

export type SourceStatusCode = "ok" | "timeout" | "error" | "disabled" | "unsupported";

export interface SourceStatus {
  id: ModelSourceId;
  status: SourceStatusCode;
  count: number;
  hasMore: boolean;
}

/** Cursor por provider: próxima página (1-based) a pedir. Opaco para el cliente. */
export type ModelSearchCursor = Partial<Record<ModelSourceId, number>>;

export interface ModelSearchResponse {
  results: ModelSearchResult[];
  sources: SourceStatus[];
  nextCursor: string | null;
}

export class ProviderHttpError extends Error {
  constructor(public readonly status: number) {
    super(`provider_http_${status}`);
    this.name = "ProviderHttpError";
  }
}
