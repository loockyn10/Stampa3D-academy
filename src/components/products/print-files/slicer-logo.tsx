import React from "react";
import { getSlicer } from "@/lib/print-files/slicers";

/** Icono oficial del laminador (archivos en /public/slicers). Decorativo: el nombre siempre va escrito al lado. */
export function SlicerLogo({ slicerId, size = 24, className = "" }: { slicerId: string; size?: number; className?: string }) {
  const slicer = getSlicer(slicerId);
  if (!slicer) {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-fg/10 text-[10px] font-bold text-gray-400 ${className}`}
        style={{ width: size, height: size }}
      >
        3MF
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={slicer.logo} alt="" width={size} height={size} className={`shrink-0 rounded-lg object-contain ${className}`} />
  );
}
