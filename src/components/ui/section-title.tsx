import React from "react";

interface SectionTitleProps {
  eyebrow?: string;
  title: string;
  action?: React.ReactNode;
}

export function SectionTitle({ eyebrow, title, action }: SectionTitleProps) {
  return (
    <div className="mb-4 flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 w-full sm:w-auto">
        {eyebrow && (
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#ff6a00] truncate">
            {eyebrow}
          </p>
        )}
        <h2 className="text-lg font-bold text-white truncate">{title}</h2>
      </div>
      <div className="w-full sm:w-auto">
        {action}
      </div>
    </div>
  );
}
