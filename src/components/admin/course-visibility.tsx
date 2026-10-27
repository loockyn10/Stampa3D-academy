"use client";

import React from "react";
import { CheckCircle2, Eye, EyeOff, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  COURSE_VISIBILITIES,
  COURSE_VISIBILITY_META,
  normalizeCourseVisibility,
  type CourseVisibility,
} from "@/lib/academy/visibility";

const ICONS: Record<CourseVisibility, React.ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>> = {
  published: Eye,
  coming_soon: Lock,
  hidden: EyeOff,
};

/** Insignia del estado actual (listado de administración). Los valores históricos draft/archived se leen como «Oculto». */
export function CourseVisibilityBadge({ status }: { status: unknown }) {
  const visibility = normalizeCourseVisibility(status);
  const Icon = ICONS[visibility];
  const tone = visibility === "published" ? "green" : visibility === "coming_soon" ? "orange" : "dark";
  return (
    <Badge tone={tone}>
      <Icon size={12} aria-hidden={true} />
      {COURSE_VISIBILITY_META[visibility].label}
    </Badge>
  );
}

/** Selector de visibilidad con la explicación de cada estado (radiogroup accesible, táctil en mobile). */
export function CourseVisibilitySelector({
  value,
  onChange,
  disabled = false,
}: {
  value: CourseVisibility;
  onChange: (next: CourseVisibility) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="space-y-2 md:col-span-2" disabled={disabled}>
      <legend className="text-sm font-medium text-gray-300">Visibilidad</legend>
      <div role="radiogroup" aria-label="Visibilidad del curso" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {COURSE_VISIBILITIES.map((option) => {
          const meta = COURSE_VISIBILITY_META[option];
          const Icon = ICONS[option];
          const selected = value === option;
          return (
            <label
              key={option}
              className={`relative flex min-h-11 cursor-pointer flex-col gap-1 rounded-xl border p-4 transition-colors focus-within:ring-2 focus-within:ring-[#ff6a00]/40 ${
                selected
                  ? "border-stampa-orange bg-stampa-orange/10"
                  : "border-stampa-border bg-stampa-surface hover:border-stampa-orange/40"
              }`}
            >
              <input
                type="radio"
                name="visibility"
                value={option}
                checked={selected}
                onChange={() => onChange(option)}
                className="sr-only"
              />
              <span className="flex items-center gap-2 text-sm font-bold text-white">
                <Icon size={16} className={selected ? "text-stampa-orange" : "text-gray-400"} aria-hidden={true} />
                {meta.label}
                {selected && <CheckCircle2 size={14} className="ml-auto text-stampa-orange" aria-hidden={true} />}
              </span>
              <span className="text-xs leading-relaxed text-gray-300">{meta.description}</span>
              <span className="text-xs leading-relaxed text-gray-400">{meta.adminHint}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
