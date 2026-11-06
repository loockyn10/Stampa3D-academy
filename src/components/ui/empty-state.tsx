import React from "react";
import { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  hint?: string;
}

export function EmptyState({ icon: Icon, title, hint }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-stampa-border bg-fg/[0.03] px-6 py-10 text-center sm:py-14">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-stampa-orange/10 text-stampa-accent">
        <Icon size={22} aria-hidden="true" />
      </div>
      <p className="text-sm font-semibold text-fg">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-xs text-stampa-text-muted">{hint}</p>}
    </div>
  );
}
