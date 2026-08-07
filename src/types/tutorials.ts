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
