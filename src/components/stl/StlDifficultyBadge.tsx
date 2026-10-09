import React from "react";

function normalizeDifficulty(value?: string | null) {
  const normalized = value?.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  if (!normalized) return null;
  if (["facil", "easy", "beginner", "principiante"].includes(normalized)) {
    return { label: "Fácil", stars: 1, className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" };
  }
  if (["intermedio", "medium", "intermediate"].includes(normalized)) {
    return { label: "Intermedio", stars: 2, className: "border-amber-500/30 bg-amber-500/10 text-amber-300" };
  }
  if (["dificil", "hard", "advanced", "avanzado"].includes(normalized)) {
    return { label: "Difícil", stars: 3, className: "border-red-500/30 bg-red-500/10 text-red-300" };
  }
  return { label: value as string, stars: 0, className: "border-stampa-border bg-white/5 text-neutral-300" };
}

export function StlDifficultyBadge({ difficulty }: { difficulty?: string | null }) {
  const norm = normalizeDifficulty(difficulty);
  if (!norm) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider backdrop-blur-md ${norm.className}`}>
      {norm.stars > 0 && <span className="mr-0.5 tracking-tight">{"★".repeat(norm.stars) + "☆".repeat(3 - norm.stars)}</span>}
      <span>{norm.label}</span>
    </span>
  );
}
