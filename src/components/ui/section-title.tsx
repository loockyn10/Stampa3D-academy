import React from "react";

interface SectionTitleProps {
  eyebrow?: string;
  title: string;
  action?: React.ReactNode;
}

export function SectionTitle({ eyebrow, title, action }: SectionTitleProps) {
  return (
    <div className="mb-4 flex items-end justify-between">
      <div>
        {eyebrow && (
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-orange-500">
            {eyebrow}
          </p>
        )}
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      </div>
      {action}
    </div>
  );
}
