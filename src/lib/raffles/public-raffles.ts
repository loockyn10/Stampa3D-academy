import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

export const PUBLIC_RAFFLE_STATUS = "active";

export interface PublicRafflePrize {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  sort_order: number | null;
}

export interface PublicRaffle {
  id: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  draw_date: string | null;
  status: string;
  is_active: boolean;
  created_at: string;
  raffle_prizes: PublicRafflePrize[];
}

export function isPublicRaffleVisible(
  raffle: Pick<PublicRaffle, "status" | "is_active">,
): boolean {
  return raffle.status === PUBLIC_RAFFLE_STATUS && raffle.is_active === true;
}

export async function getVisibleRaffles(
  supabase: SupabaseClient,
): Promise<{ data: PublicRaffle[]; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .from("raffles")
    .select(`
      id,
      title,
      description,
      cover_image_url,
      draw_date,
      status,
      is_active,
      created_at,
      raffle_prizes (
        id,
        name,
        description,
        image_url,
        sort_order
      )
    `)
    .eq("status", PUBLIC_RAFFLE_STATUS)
    .eq("is_active", true)
    .order("draw_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) return { data: [], error };

  const visibleRaffles = (data || [])
    .filter(isPublicRaffleVisible)
    .map((raffle) => ({
      ...raffle,
      raffle_prizes: [...(raffle.raffle_prizes || [])].sort(
        (left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0),
      ),
    })) as PublicRaffle[];

  return { data: visibleRaffles, error: null };
}
