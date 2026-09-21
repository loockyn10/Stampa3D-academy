import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { cursorDepth, decodeCursor, MAX_PAGE, parseModelSearchParams } from "@/lib/model-search/params";
import { createRateLimiter } from "@/lib/model-search/rate-limit";
import { hasProviderForFilters, searchModels } from "@/lib/model-search/service";
import { createDefaultProviders } from "@/lib/model-search/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Anonymous puede buscar con límites; Free/Paid ven búsqueda completa. authenticated != paid: no se consulta `accessPlatform` para permitir la búsqueda. */
const ANONYMOUS_MAX_PAGES = 2;
const anonymousLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });
const memberLimiter = createRateLimiter({ windowMs: 60_000, max: 40 });

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function jsonError(error: string, status: number, extra?: Record<string, string>) {
  return NextResponse.json({ error }, { status, headers: { ...NO_STORE, ...extra } });
}

function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function GET(request: NextRequest) {
  const parsed = parseModelSearchParams(request.nextUrl.searchParams);
  if (!parsed.ok) return jsonError(parsed.error, 400);
  const { query, sources, filters, cursor } = parsed.value;

  const supabase = await createClient();
  const { access } = await getCurrentUserAccess(supabase);
  const isMember = access.authenticated === true;
  const tier = access.capabilities.accessPlatform ? "paid" : isMember ? "free" : "anonymous";

  const limiter = isMember ? memberLimiter : anonymousLimiter;
  const limiterKey = isMember && access.userId ? `user:${access.userId}` : `ip:${clientIp(request)}`;
  const limit = limiter.check(limiterKey);
  if (!limit.allowed) {
    return jsonError("rate_limited", 429, { "Retry-After": String(limit.retryAfterSeconds) });
  }

  const maxPages = isMember ? MAX_PAGE : ANONYMOUS_MAX_PAGES;
  if (cursorDepth(cursor) > maxPages) return jsonError("account_required", 403);
  if (!isMember && (filters.commercial !== "any" || filters.sort !== "relevance")) {
    return jsonError("account_required", 403);
  }

  // Sin ningún provider capaz de aplicar el filtro no se devuelve una lista engañosa: se rechaza explícitamente.
  const providers = createDefaultProviders();
  const hasFilters = filters.freeOnly || filters.commercial !== "any";
  if (hasFilters && !hasProviderForFilters(providers, sources, filters)) return jsonError("unsupported_filter", 400);

  try {
    const response = await searchModels({ query, sources, filters, cursor }, { providers });
    // Si la próxima página supera el tope del viewer, no se ofrece cursor y la UI invita a crear cuenta.
    const next = decodeCursor(response.nextCursor);
    const gated = next !== null && cursorDepth(next) > maxPages;
    return NextResponse.json(
      { ...response, nextCursor: gated ? null : response.nextCursor, viewer: { tier, maxPages, gated } },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("[model-search] unexpected failure", { message: error instanceof Error ? error.message : "unknown" });
    return jsonError("search_unavailable", 500);
  }
}
