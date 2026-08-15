import React from "react";
import { normalizeFilamentColor } from "@/lib/colors/filament-colors";

type ColorSwatchLabelProps = {
  color?: string | null;
  colorHex?: string | null;
  size?: "sm" | "md";
  fallbackLabel?: string;
  className?: string;
};

// Simple regex to validate hex color
const isValidHexColor = (hex: string) => /^#[0-9A-Fa-f]{6}$/i.test(hex);

export function ColorSwatchLabel({
  color,
  colorHex,
  size = "md",
  fallbackLabel = "Sin color",
  className = "",
}: ColorSwatchLabelProps) {
  const isSm = size === "sm";

  // Resolve Label
  let resolvedLabel = fallbackLabel;
  if (color && color.trim() !== "") {
    resolvedLabel = color;
  } else if (colorHex && colorHex.trim() !== "") {
    resolvedLabel = "Color personalizado";
  }

  // Resolve Hex
  let resolvedHex = "#737373"; // neutral gray fallback
  if (colorHex && isValidHexColor(colorHex)) {
    resolvedHex = colorHex;
  } else if (color && color.trim() !== "") {
    const normalized = normalizeFilamentColor(color);
    if (normalized && normalized.hex) {
      resolvedHex = normalized.hex;
    }
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span
        className={`rounded-full border border-white/20 shrink-0 shadow-sm ${
          isSm ? "h-3 w-3" : "h-4 w-4"
        }`}
        style={{ backgroundColor: resolvedHex }}
      />
      <span className={isSm ? "text-xs" : "text-sm"}>{resolvedLabel}</span>
    </span>
  );
}
