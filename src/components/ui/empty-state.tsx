import React from "react";
import { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  hint?: string;
}

export function EmptyState({ icon: Icon, title, hint }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white/60 px-6 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-orange-50 text-orange-500">
        <Icon size={22} />
      </div>
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
