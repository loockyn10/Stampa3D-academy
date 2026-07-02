import React from "react";
import { SPOOL_COLORS } from "@/data/mock-data";

interface SpoolDotProps {
  i?: number;
  size?: number;
}

export function SpoolDot({ i = 0, size = 8 }: SpoolDotProps) {
  return (
    <span
      className="inline-block rounded-full shrink-0"
      style={{
        width: size,
        height: size,
        backgroundColor: SPOOL_COLORS[i % SPOOL_COLORS.length],
      }}
    />
  );
}
