// Resolución de la URL de video de un tutorial a algo que se pueda reproducir de forma segura.

export type ResolvedTutorialVideo =
  | { kind: "youtube"; embedUrl: string }
  | { kind: "bunny"; embedUrl: string }
  | { kind: "external"; href: string };

/** Las filas de `tool_tutorials` sin video cargado guardan un marcador `PENDIENTE_*`. */
export function isPendingTutorialUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.trim().startsWith("PENDIENTE_");
}

function parseHttpsUrl(url: string): URL | null {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
const YOUTUBE_ID = /^[\w-]{6,20}$/;

function youtubeEmbedUrl(parsed: URL): string | null {
  let id: string | null = null;
  if (parsed.hostname === "youtu.be") {
    id = parsed.pathname.slice(1).split("/")[0] || null;
  } else if (YOUTUBE_HOSTS.has(parsed.hostname)) {
    if (parsed.pathname === "/watch") id = parsed.searchParams.get("v");
    else if (parsed.pathname.startsWith("/embed/")) id = parsed.pathname.slice("/embed/".length).split("/")[0] || null;
  }
  // Sin parámetros de autoplay: el video siempre arranca cuando la persona lo decide.
  return id && YOUTUBE_ID.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}

/**
 * Devuelve cómo reproducir `url`, o `null` si no hay un video utilizable (vacío, marcador PENDIENTE_, URL inválida o
 * no https). Nunca devuelve un `javascript:`/`data:`: el caller puede confiar en el resultado.
 */
export function resolveTutorialVideo(url: string | null | undefined): ResolvedTutorialVideo | null {
  if (!url || !url.trim() || isPendingTutorialUrl(url)) return null;
  const parsed = parseHttpsUrl(url);
  if (!parsed) return null;

  const youtube = youtubeEmbedUrl(parsed);
  if (youtube) return { kind: "youtube", embedUrl: youtube };

  if (parsed.hostname === "player.mediadelivery.net") {
    // Bunny respeta `autoplay=false`; se fuerza para que nunca arranque solo.
    parsed.searchParams.set("autoplay", "false");
    return { kind: "bunny", embedUrl: parsed.toString() };
  }

  return { kind: "external", href: parsed.toString() };
}
