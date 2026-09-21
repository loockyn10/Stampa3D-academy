import type {
  ModelSearchProvider,
  ModelSearchResult,
  ModelSort,
  ProviderSearchInput,
  ProviderSearchPage,
} from "../types";
import { normalizeThingiverseLicense } from "../license";
import { asRecord, cleanText, externalId, isoDate, nonNegativeInt, safeExternalUrl } from "../sanitize";
import { getProviderJson, type FetchLike } from "./http";

// API oficial: https://www.thingiverse.com/developers/swagger — GET /search/{term}?type=things, BearerAuth.
// Uso sujeto a los términos del Developer Program (ver docs/DECISIONS.md): sin token configurado queda deshabilitado.
const API_URL = "https://api.thingiverse.com/search";
const ALLOWED_DOMAINS = ["thingiverse.com"] as const;

const SORT_PARAM: Record<ModelSort, string> = { relevance: "relevant", popular: "popular", newest: "newest" };

function truthyFlag(value: unknown): boolean {
  return value === true || value === 1;
}

/** Devuelve null si el item está malformado o no corresponde mostrarlo (NSFW / no publicado). */
export function normalizeThingiverseItem(raw: unknown): ModelSearchResult | null {
  const item = asRecord(raw);
  if (!item) return null;
  const id = externalId(item.id);
  const title = cleanText(item.name, 160);
  const originalUrl = safeExternalUrl(item.public_url, ALLOWED_DOMAINS);
  if (!id || !title || !originalUrl) return null;
  if (truthyFlag(item.is_nsfw) || item.is_published === 0 || item.is_published === false) return null;

  const creator = asRecord(item.creator);
  return {
    source: "thingiverse",
    externalId: id,
    title,
    authorName: cleanText(creator?.name, 80),
    authorUrl: safeExternalUrl(creator?.public_url, ALLOWED_DOMAINS),
    thumbnailUrl: safeExternalUrl(item.thumbnail, ALLOWED_DOMAINS),
    originalUrl,
    // La API de Thingiverse no expone precio; la descarga de Things es gratuita (los Tips son voluntarios).
    isFree: true,
    license: normalizeThingiverseLicense(item.license, item.allows_derivatives),
    likes: nonNegativeInt(item.like_count),
    downloads: nonNegativeInt(item.download_count),
    views: nonNegativeInt(item.view_count),
    rating: null,
    publishedAt: isoDate(item.added),
    fileFormats: null,
  };
}

export function createThingiverseProvider(
  options: { fetch?: FetchLike; accessToken?: () => string | undefined } = {},
): ModelSearchProvider {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const getToken = options.accessToken ?? (() => process.env.THINGIVERSE_ACCESS_TOKEN?.trim() || undefined);

  return {
    id: "thingiverse",
    label: "Thingiverse",
    isEnabled: () => Boolean(getToken()),
    getCapabilities: () => ({ sorts: ["relevance", "popular", "newest"], maxPerPage: 30 }),
    async health() {
      return { status: getToken() ? "ok" : "disabled" };
    },
    async search(input: ProviderSearchInput): Promise<ProviderSearchPage> {
      const token = getToken();
      if (!token) throw new Error("thingiverse_not_configured");

      const params = new URLSearchParams({
        type: "things",
        page: String(input.page),
        per_page: String(input.perPage),
        sort: SORT_PARAM[input.filters.sort],
      });
      const url = `${API_URL}/${encodeURIComponent(input.query)}?${params.toString()}`;
      const body = asRecord(
        await getProviderJson(fetchImpl, url, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } }, input.signal),
      );
      const hits = Array.isArray(body?.hits) ? body.hits : [];
      const results = hits.map(normalizeThingiverseItem).filter((result): result is ModelSearchResult => result !== null);
      const total = nonNegativeInt(body?.total);
      return {
        results,
        total,
        hasMore: total !== null ? input.page * input.perPage < total : hits.length >= input.perPage,
      };
    },
  };
}
