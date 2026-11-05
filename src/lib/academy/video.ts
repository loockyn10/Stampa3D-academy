/**
 * Turns the `lessons.video_url` an admin pasted (URL or full <iframe> snippet) into a safe embed. Pure: used by the
 * lesson player, the admin form (validation) and the server-side Bunny signer.
 *
 * Only https URLs of known providers are embedded. Anything else is "invalid" and never reaches an <iframe>.
 */

export type LessonVideo =
  | { provider: "none" }
  | { provider: "invalid"; reason: "not_https" | "unsupported" | "malformed" }
  | { provider: "bunny"; embedUrl: string; libraryId: string; videoId: string }
  | { provider: "vimeo"; embedUrl: string }
  | { provider: "youtube"; embedUrl: string }
  | { provider: "file"; embedUrl: string };

const BUNNY_HOSTS = new Set(["iframe.mediadelivery.net", "player.mediadelivery.net"]);
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com", "player.vimeo.com"]);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const NUMERIC_ID = /^\d+$/;
const BUNNY_ID = /^[A-Za-z0-9-]+$/;
const FILE_EXTENSION = /\.(mp4|webm|ogg|mov)$/i;
/** Query parameters of the Bunny player that are kept; token/expires are always generated server-side. */
const BUNNY_KEPT_PARAMS = ["autoplay", "loop", "muted", "preload", "responsive", "t", "captions", "chromecast", "showHeatmap", "showSpeed"];

export const VIDEO_PROVIDER_LABEL: Record<LessonVideo["provider"], string> = {
  none: "Sin video",
  invalid: "Formato no reconocido",
  bunny: "Bunny Stream",
  vimeo: "Vimeo",
  youtube: "YouTube",
  file: "Archivo de video",
};

function extractUrl(raw: string): string {
  const value = raw.trim();
  if (value.toLowerCase().includes("<iframe")) {
    const match = value.match(/src\s*=\s*["']([^"']+)["']/i);
    return match ? match[1].trim().replace(/&amp;/g, "&") : "";
  }
  return value;
}

export function resolveLessonVideo(raw: string | null | undefined): LessonVideo {
  if (!raw || !raw.trim()) return { provider: "none" };
  const candidate = extractUrl(raw);
  if (!candidate) return { provider: "invalid", reason: "malformed" };

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { provider: "invalid", reason: "malformed" };
  }
  if (url.protocol !== "https:") return { provider: "invalid", reason: "not_https" };

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  if (BUNNY_HOSTS.has(host)) {
    // /embed/{library}/{video} (embed) or /play/{library}/{video} (share page) → always the embed.
    if ((segments[0] === "embed" || segments[0] === "play") && segments.length >= 3) {
      const [, libraryId, videoId] = segments;
      if (NUMERIC_ID.test(libraryId) && BUNNY_ID.test(videoId)) {
        const embed = new URL(`https://${host}/embed/${libraryId}/${videoId}`);
        for (const key of BUNNY_KEPT_PARAMS) {
          const value = url.searchParams.get(key);
          if (value !== null) embed.searchParams.set(key, value);
        }
        return { provider: "bunny", embedUrl: embed.toString(), libraryId, videoId };
      }
    }
    return { provider: "invalid", reason: "unsupported" };
  }

  if (host === "youtu.be" || YOUTUBE_HOSTS.has(host)) {
    let id: string | null = null;
    if (host === "youtu.be") id = segments[0] ?? null;
    else if (segments[0] === "watch") id = url.searchParams.get("v");
    else if (["embed", "shorts", "live", "v"].includes(segments[0] ?? "")) id = segments[1] ?? null;
    if (id && YOUTUBE_ID.test(id)) {
      const embed = new URL(`https://www.youtube.com/embed/${id}`);
      embed.searchParams.set("rel", "0");
      const start = url.searchParams.get("t") ?? url.searchParams.get("start");
      const seconds = start ? Number.parseInt(start, 10) : NaN;
      if (Number.isFinite(seconds) && seconds > 0) embed.searchParams.set("start", String(seconds));
      return { provider: "youtube", embedUrl: embed.toString() };
    }
    return { provider: "invalid", reason: "unsupported" };
  }

  if (VIMEO_HOSTS.has(host)) {
    // player.vimeo.com/video/{id}?h={hash} · vimeo.com/{id} · vimeo.com/{id}/{hash} (unlisted)
    const id = host === "player.vimeo.com" ? (segments[0] === "video" ? segments[1] : null) : segments[0];
    if (id && NUMERIC_ID.test(id)) {
      const embed = new URL(`https://player.vimeo.com/video/${id}`);
      const hash = url.searchParams.get("h") ?? (host !== "player.vimeo.com" && segments[1] && /^[0-9a-f]+$/i.test(segments[1]) ? segments[1] : null);
      if (hash) embed.searchParams.set("h", hash);
      return { provider: "vimeo", embedUrl: embed.toString() };
    }
    return { provider: "invalid", reason: "unsupported" };
  }

  if (FILE_EXTENSION.test(url.pathname)) return { provider: "file", embedUrl: url.toString() };
  return { provider: "invalid", reason: "unsupported" };
}

/** Admin-side message for a pasted value (null = nothing to say). */
export function describeVideoInput(raw: string | null | undefined): { ok: boolean; message: string } | null {
  const video = resolveLessonVideo(raw);
  if (video.provider === "none") return null;
  if (video.provider === "invalid") {
    return {
      ok: false,
      message:
        video.reason === "not_https"
          ? "El enlace tiene que empezar con https://."
          : "No reconocemos este enlace. Pegá el enlace de embed de Bunny Stream (iframe.mediadelivery.net/embed/…), YouTube o Vimeo.",
    };
  }
  return { ok: true, message: `Reconocido: ${VIDEO_PROVIDER_LABEL[video.provider]}.` };
}
