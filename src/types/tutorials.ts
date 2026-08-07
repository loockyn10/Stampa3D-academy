export interface ToolTutorial {
  id: string;
  tool_key: string;
  title: string;
  description: string | null;
  video_url: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface UserToolTutorialView {
  id: string;
  user_id: string;
  tool_key: string;
  viewed_at: string;
  dismissed_at: string | null;
  created_at: string;
}

export function isPendingTutorialUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith("PENDIENTE_");
}

export function isBunnyEmbedUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes("player.mediadelivery.net");
}

export function getYoutubeEmbedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);

    if (parsed.hostname.includes("youtube.com")) {
      if (parsed.pathname === "/watch") {
        const id = parsed.searchParams.get("v");
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }

      if (parsed.pathname.startsWith("/embed/")) {
        return url;
      }
    }

    if (parsed.hostname === "youtu.be") {
      const id = parsed.pathname.replace("/", "");
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }

    return null;
  } catch {
    return null;
  }
}
