// Filas de `tool_tutorials` / `user_tool_tutorial_views`. El contenido de los tutoriales vive en `src/lib/tutorials`.
// `seen_version` lo agrega la migration 20261031090000 (filas anteriores = versión 1).
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
  seen_version?: number;
  created_at: string;
}
