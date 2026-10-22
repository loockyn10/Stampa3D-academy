/**
 * Estado visible de un sorteo publicado (status = "active", is_active = true) según su fecha real.
 * No cambia ni infiere ganadores: un sorteo con fecha cumplida queda "Esperando resultado"
 * hasta que el equipo registra los ganadores (y entonces aparece en Finalizados).
 */
export type RaffleTimeStatus =
  | { kind: "open"; label: string; daysLeft: number }
  | { kind: "no_date"; label: string }
  | { kind: "awaiting_result"; label: string };

const DAY_MS = 24 * 60 * 60 * 1000;

export function getRaffleTimeStatus(drawDate: string | null | undefined, now: Date = new Date()): RaffleTimeStatus {
  const drawMs = drawDate ? Date.parse(drawDate) : Number.NaN;
  if (!Number.isFinite(drawMs)) return { kind: "no_date", label: "Fecha a confirmar" };
  const diff = drawMs - now.getTime();
  if (diff <= 0) return { kind: "awaiting_result", label: "Esperando resultado" };
  const daysLeft = Math.ceil(diff / DAY_MS);
  return {
    kind: "open",
    daysLeft,
    label: daysLeft <= 1 ? "Se sortea en menos de 24 h" : `Faltan ${daysLeft} días`,
  };
}

export interface RaffleWinnerRow {
  id: string;
  winner_name_snapshot: string | null;
  prize_name_snapshot: string | null;
  won_at: string;
  raffles?: { title?: string | null; draw_date?: string | null } | Array<{ title?: string | null; draw_date?: string | null }> | null;
}

export interface FinishedRaffle {
  key: string;
  title: string;
  date: string;
  winners: Array<{ id: string; winner: string; prize: string }>;
}

/** Agrupa los ganadores registrados por sorteo (más reciente primero). */
export function groupWinnersByRaffle(rows: RaffleWinnerRow[]): FinishedRaffle[] {
  const groups = new Map<string, FinishedRaffle>();
  for (const row of rows) {
    const raffle = Array.isArray(row.raffles) ? row.raffles[0] : row.raffles;
    const title = raffle?.title || "Sorteo";
    const date = raffle?.draw_date || row.won_at;
    const key = `${title}::${(date || "").slice(0, 10)}`;
    const group = groups.get(key) ?? { key, title, date, winners: [] };
    group.winners.push({ id: row.id, winner: row.winner_name_snapshot || "Ganador", prize: row.prize_name_snapshot || "Premio" });
    groups.set(key, group);
  }
  return Array.from(groups.values()).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}
