import type { ModelSearchProvider, ModelSearchResult, ProviderSearchInput, ProviderSearchPage } from "../types";
import { ProviderHttpError } from "../types";
import { asRecord, cleanText, externalId, isoDate, nonNegativeInt, safeExternalUrl } from "../sanitize";
import type { FetchLike } from "./http";

// API GraphQL oficial: https://cults3d.com/en/pages/graphql
// Autenticación HTTP Basic: nickname de Cults + API key. La API nunca entrega los archivos 3D.
const API_URL = "https://cults3d.com/graphql";
const ALLOWED_DOMAINS = ["cults3d.com"] as const;

// Campos confirmados en la documentación/GraphiQL pública y en los ejemplos oficiales enlazados por Cults.
const SEARCH_QUERY = `
  query SearchCreations($query: String!, $limit: Int!, $offset: Int!, $onlyFree: Boolean!, $onlyPriced: Boolean!) {
    creationsSearchBatch(
      query: $query
      limit: $limit
      offset: $offset
      onlyFree: $onlyFree
      onlyPriced: $onlyPriced
    ) {
      total
      results {
        id
        name(locale: EN)
        url(locale: EN)
        illustrationImageUrl
        price(currency: USD) { cents }
        creator { nick shortUrl }
        license { name(locale: EN) url(locale: EN) }
        likesCount
        downloadsCount
        viewsCount
        publishedAt
      }
    }
  }
`;

function priceFromCents(value: unknown): { priceType: ModelSearchResult["priceType"]; price: number | null; currency: string | null } {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    return { priceType: "unknown", price: null, currency: null };
  }
  return { priceType: value === 0 ? "free" : "paid", price: value / 100, currency: "USD" };
}

export function normalizeCultsCreation(raw: unknown): ModelSearchResult | null {
  const item = asRecord(raw);
  if (!item) return null;
  const id = externalId(item.id);
  const title = cleanText(item.name, 160);
  const originalUrl = safeExternalUrl(item.url, ALLOWED_DOMAINS);
  if (!id || !title || !originalUrl) return null;

  const creator = asRecord(item.creator);
  const license = asRecord(item.license);
  const price = priceFromCents(asRecord(item.price)?.cents);
  return {
    source: "cults",
    externalId: id,
    title,
    authorName: cleanText(creator?.nick, 80),
    authorUrl: safeExternalUrl(creator?.shortUrl, ALLOWED_DOMAINS),
    thumbnailUrl: safeExternalUrl(item.illustrationImageUrl, ALLOWED_DOMAINS),
    originalUrl,
    ...price,
    license: {
      name: cleanText(license?.name, 120),
      url: safeExternalUrl(license?.url, ALLOWED_DOMAINS),
      commercialUse: "unknown",
      attributionRequired: "unknown",
      remixAllowed: null,
    },
    likes: nonNegativeInt(item.likesCount),
    downloads: nonNegativeInt(item.downloadsCount),
    views: nonNegativeInt(item.viewsCount),
    rating: null,
    publishedAt: isoDate(item.publishedAt),
    fileFormats: null,
  };
}

export function createCultsProvider(
  options: {
    fetch?: FetchLike;
    username?: () => string | undefined;
    apiKey?: () => string | undefined;
  } = {},
): ModelSearchProvider {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const getUsername = options.username ?? (() => process.env.CULTS_USERNAME?.trim() || undefined);
  const getApiKey = options.apiKey ?? (() => process.env.CULTS_API_KEY?.trim() || undefined);
  const configured = () => Boolean(getUsername() && getApiKey());

  return {
    id: "cults",
    label: "Cults3D",
    isEnabled: configured,
    getCapabilities: () => ({
      sorts: ["relevance"],
      maxPerPage: 50,
      supportsPriceFilter: true,
      reportsPrice: true,
      priceFilterMode: "native",
      commercialFilters: [],
    }),
    async health() {
      return { status: configured() ? "ok" : "disabled" };
    },
    async search(input: ProviderSearchInput): Promise<ProviderSearchPage> {
      const username = getUsername();
      const apiKey = getApiKey();
      if (!username || !apiKey) throw new Error("cults_not_configured");

      const response = await fetchImpl(API_URL, {
        method: "POST",
        signal: input.signal,
        cache: "no-store",
        redirect: "error",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`${username}:${apiKey}`, "utf8").toString("base64")}`,
        },
        body: JSON.stringify({
          query: SEARCH_QUERY,
          variables: {
            query: input.query,
            limit: input.perPage,
            offset: (input.page - 1) * input.perPage,
            onlyFree: input.filters.price === "free",
            onlyPriced: input.filters.price === "paid",
          },
        }),
      });
      if (!response.ok) throw new ProviderHttpError(response.status);

      const body = asRecord(await response.json());
      if (Array.isArray(body?.errors) && body.errors.length > 0) throw new Error("cults_graphql_error");
      const batch = asRecord(asRecord(body?.data)?.creationsSearchBatch);
      if (!batch) throw new Error("cults_invalid_response");
      const items = Array.isArray(batch.results) ? batch.results : [];
      const results = items.map(normalizeCultsCreation).filter((result): result is ModelSearchResult => result !== null);
      const total = nonNegativeInt(batch.total);
      return {
        results,
        total,
        hasMore: total !== null ? input.page * input.perPage < total : items.length >= input.perPage,
      };
    },
  };
}
