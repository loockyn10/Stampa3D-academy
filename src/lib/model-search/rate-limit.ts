/**
 * Limitador de ventana fija en memoria para el endpoint público. Es "best effort": en un entorno serverless cada
 * instancia tiene su propio contador. Suficiente como freno básico ante abuso; un limitador compartido (Redis/edge)
 * queda pendiente hasta conocer el hosting definitivo (ver docs/TASKS.md).
 */
export interface RateLimiter {
  check(key: string, now?: number): { allowed: boolean; retryAfterSeconds: number };
}

export function createRateLimiter(options: { windowMs: number; max: number; maxKeys?: number }): RateLimiter {
  const { windowMs, max, maxKeys = 5000 } = options;
  const buckets = new Map<string, { windowStart: number; count: number }>();

  return {
    check(key, now = Date.now()) {
      if (buckets.size >= maxKeys) {
        for (const [bucketKey, bucket] of buckets) {
          if (now - bucket.windowStart >= windowMs) buckets.delete(bucketKey);
        }
        if (buckets.size >= maxKeys) buckets.clear();
      }
      const bucket = buckets.get(key);
      if (!bucket || now - bucket.windowStart >= windowMs) {
        buckets.set(key, { windowStart: now, count: 1 });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      bucket.count += 1;
      if (bucket.count > max) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000)) };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
