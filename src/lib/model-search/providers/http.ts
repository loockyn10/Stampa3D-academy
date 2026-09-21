import { ProviderHttpError } from "../types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** GET JSON contra un host fijo del provider. Nunca recibe URLs del usuario. */
export async function getProviderJson(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetchImpl(url, { ...init, method: "GET", signal, cache: "no-store", redirect: "error" });
  if (!response.ok) throw new ProviderHttpError(response.status);
  return response.json();
}
