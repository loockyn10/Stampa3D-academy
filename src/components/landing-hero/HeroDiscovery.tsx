"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { MouseEvent } from "react";
import { DemoWindow } from "./DemoWindow";
import { discoveryContent } from "./hero-content";
import { heroRevealTool, toolsSectionContent } from "./universe-tools";
import styles from "./UniversoHero.module.css";

/**
 * Escena 4 — Descubrimiento: tras atravesar el núcleo emerge la interfaz real de Universo (la primera demostración
 * del catálogo de herramientas). Su visibilidad y su acople a la sección siguiente los controlan `--disc` y `--dock`
 * (0..1), publicadas por el controlador; con movimiento reducido es siempre una escena estática.
 */
export function HeroDiscovery({ anchorId, reducedMotion }: { anchorId?: string; reducedMotion: boolean }) {
  const { eyebrow, title, subtitle, primary, secondary } = discoveryContent;
  const demo = heroRevealTool.demos[0];

  const goToTools = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    document.getElementById(toolsSectionContent.anchorId)?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  };

  return (
    <section id={anchorId} className={styles.discovery} aria-labelledby="hero-discovery-title">
      <div className={styles.discoveryInner}>
        <div className={styles.discoveryCopy}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h2 id="hero-discovery-title" className={styles.discoveryTitle}>
            {title}
          </h2>
          <p className={styles.discoverySubtitle}>{subtitle}</p>
          <div className={styles.actions}>
            <Link href={primary.href} className={styles.btnPrimary}>
              {primary.label}
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
            <a href={secondary.href} className={styles.btnGhost} onClick={goToTools}>
              {secondary.label}
            </a>
          </div>
        </div>

        {/* La misma ventana que se explora más abajo: aquí es solo la imagen de entrada (la descripción está en la sección). */}
        <div className={styles.reveal} aria-hidden="true">
          <DemoWindow tool={heroRevealTool} media={demo.media} priority decorative animate={!reducedMotion} />
        </div>
      </div>
    </section>
  );
}
