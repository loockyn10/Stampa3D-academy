/**
 * Explorar Modelos — contratos comunes.
 *
 * Stampa actúa como descubridor: solo se devuelve metadata mínima y el enlace al modelo original. Nunca se
 * almacenan ni redistribuyen archivos de terceros. Los campos que la fuente no brinda quedan en `null`/`"unknown"`.
 */

export type ModelSourceId = "cults" | "myminifactory" | "thingiverse";
export type PriceType = "free" | "paid" | "unknown";
export type PriceFilter = "any" | Exclude<PriceType, "unknown">;

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

  /** Estado comercial informado por la fuente. Nunca se infiere desde la licencia ni desde la plataforma. */
  priceType: PriceType;
  /** Importe en la unidad principal de `currency`; null si la fuente solo informa gratis/de pago. */
  price: number | null;
  /** Código ISO 4217, o null si no hay un importe confiable. */
  currency: string | null;

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
  price: PriceFilter;
  commercial: CommercialFilter;
  sort: ModelSort;
}

export interface ProviderCapabilities {
  sorts: readonly ModelSort[];
  /** Tamaño máximo de página que el provider acepta. */
  maxPerPage: number;
  /** Si puede responder de forma confiable a Gratis/De pago, nativamente o con post-filtro. */
  supportsPriceFilter: boolean;
  /** Si cada resultado informa `priceType` confiable. */
  reportsPrice: boolean;
  /** Permite distinguir filtro nativo de post-filtro sin fingir soporte. */
  priceFilterMode: "native" | "post" | "none";
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
/** null marca un provider agotado para no volver a pedir su página 1 al paginar otra fuente. */
export type ModelSearchCursor = Partial<Record<ModelSourceId, number | null>>;

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
