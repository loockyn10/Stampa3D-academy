import type {
  ModelSearchProvider,
  ModelSearchResult,
  ModelSort,
  ProviderSearchInput,
  ProviderSearchPage,
} from "../types";
import { myMiniFactoryIsFree, normalizeMyMiniFactoryLicense } from "../license";
import { asRecord, cleanText, externalId, isoDate, nonNegativeInt, safeExternalUrl } from "../sanitize";
import { getProviderJson, type FetchLike } from "./http";

// API oficial v2: https://github.com/MyMiniFactory/api-documentation — GET /search (API key o OAuth2).
const API_URL = "https://www.myminifactory.com/api/v2/search";
const ALLOWED_DOMAINS = ["myminifactory.com"] as const;
const FILE_FORMATS = new Set(["stl", "3mf", "obj", "step", "stp", "scad", "f3d", "gcode"]);

const SORT_PARAM: Record<ModelSort, string | null> = { relevance: null, popular: "popularity", newest: "date" };

function fileFormats(files: unknown): string[] | null {
  if (!Array.isArray(files)) return null;
  const formats = new Set<string>();
  for (const file of files) {
    const filename = asRecord(file)?.filename;
    if (typeof filename !== "string") continue;
    const extension = filename.split(".").pop()?.toLowerCase();
    if (extension && FILE_FORMATS.has(extension)) formats.add(extension);
  }
  return formats.size ? Array.from(formats).sort() : null;
}

function thumbnail(images: unknown): string | null {
  if (!Array.isArray(images)) return null;
  const records = images.map(asRecord).filter((image): image is Record<string, unknown> => image !== null);
  const primary = records.find((image) => image.is_primary === true) ?? records[0];
  return safeExternalUrl(asRecord(primary?.thumbnail)?.url, ALLOWED_DOMAINS);
}

/** Devuelve null si el item está malformado (sin id, título o URL original válida). */
export function normalizeMyMiniFactoryItem(raw: unknown): ModelSearchResult | null {
  const item = asRecord(raw);
  if (!item) return null;
  const id = externalId(item.id);
  const title = cleanText(item.name, 160);
  const originalUrl = safeExternalUrl(item.url, ALLOWED_DOMAINS);
  if (!id || !title || !originalUrl) return null;

  const designer = asRecord(item.designer);
  return {
    source: "myminifactory",
    externalId: id,
    title,
    authorName: cleanText(designer?.name ?? designer?.username, 80),
    authorUrl: safeExternalUrl(designer?.profile_url, ALLOWED_DOMAINS),
    thumbnailUrl: thumbnail(item.images),
    originalUrl,
    isFree: myMiniFactoryIsFree(item.licenses),
    license: normalizeMyMiniFactoryLicense(item.licenses, item.license),
    likes: nonNegativeInt(item.likes),
    downloads: null,
    views: nonNegativeInt(item.views),
    rating: null,
    publishedAt: isoDate(item.published_at),
    fileFormats: fileFormats(item.files),
  };
}

export function createMyMiniFactoryProvider(
  options: { fetch?: FetchLike; apiKey?: () => string | undefined } = {},
): ModelSearchProvider {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const getKey = options.apiKey ?? (() => process.env.MYMINIFACTORY_API_KEY?.trim() || undefined);

  return {
    id: "myminifactory",
    label: "MyMiniFactory",
    isEnabled: () => Boolean(getKey()),
    getCapabilities: () => ({ sorts: ["relevance", "popular", "newest"], maxPerPage: 30 }),
    async health() {
      return { status: getKey() ? "ok" : "disabled" };
    },
    async search(input: ProviderSearchInput): Promise<ProviderSearchPage> {
      const key = getKey();
      if (!key) throw new Error("myminifactory_not_configured");

      const params = new URLSearchParams({
        q: input.query,
        page: String(input.page),
        per_page: String(input.perPage),
      });
      const sort = SORT_PARAM[input.filters.sort];
      if (sort) {
        params.set("sort", sort);
        params.set("order", "desc");
      }
      if (input.filters.commercial === "allowed") params.set("commercial_use", "1");
      // La API key viaja en la query (esquema `key` de la API v2); nunca se loguea ni se devuelve al navegador.
      params.set("key", key);

      const body = asRecord(
        await getProviderJson(fetchImpl, `${API_URL}?${params.toString()}`, { headers: { Accept: "application/json" } }, input.signal),
      );
      const items = Array.isArray(body?.items) ? body.items : [];
      const results = items.map(normalizeMyMiniFactoryItem).filter((result): result is ModelSearchResult => result !== null);
      const total = nonNegativeInt(body?.total_count);
      return {
        results,
        total,
        hasMore: total !== null ? input.page * input.perPage < total : items.length >= input.perPage,
      };
    },
  };
}
