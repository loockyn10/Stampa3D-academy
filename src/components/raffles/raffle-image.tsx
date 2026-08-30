"use client";

import { useState, type ReactNode } from "react";

interface RaffleImageProps {
  src: string | null | undefined;
  alt: string;
  className: string;
  fallback: ReactNode;
}

export function RaffleImage({ src, alt, className, fallback }: RaffleImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) return <>{fallback}</>;

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailedSrc(src)}
    />
  );
}
