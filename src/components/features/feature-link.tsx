"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { useFeatureVisibility } from "./feature-flags-provider";

type FeatureLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
  /** Qué mostrar si la funcionalidad de destino está deshabilitada (por defecto, nada). */
  fallback?: ReactNode;
};

/** Enlace contextual hacia otra herramienta: se oculta (o muestra `fallback`) si esa herramienta no está disponible. */
export function FeatureLink({ href, fallback = null, ...props }: FeatureLinkProps) {
  const visibility = useFeatureVisibility();
  if (!visibility.isPathVisible(href)) return <>{fallback}</>;
  return <Link href={href} {...props} />;
}
