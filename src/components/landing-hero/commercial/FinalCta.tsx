"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useRef, type CSSProperties } from "react";
import { commercialCtas, finalCta } from "./commercial-content";
import { useScrollProgress } from "./use-scroll-progress";
import styles from "./Commercial.module.css";

/**
 * Cierre: recupera el lenguaje del Hero (resplandor naranja, anillos en perspectiva, líneas de capa) sin repetir el objeto 3D.
 * Los anillos se abren y el resplandor sube con el scroll (--fp). Todo es CSS: sin WebGL.
 */
export function FinalCta() {
  const ref = useRef<HTMLElement>(null);
  useScrollProgress(ref, "--fp", 0.9);
  return (
    <section ref={ref} id="empezar" className={`${styles.section} ${styles.final}`} aria-labelledby="final-title">
      <div className={styles.finalStage} aria-hidden="true">
        <span className={styles.finalGlow} />
        {[0, 1, 2, 3, 4].map((k) => (
          <span key={k} className={styles.finalRing} style={{ "--k": k } as CSSProperties} />
        ))}
        <span className={styles.finalCore} />
        <span className={styles.finalLayers} />
      </div>
      <div className={styles.finalInner}>
        <h2 id="final-title" className={styles.finalTitle}>
          {finalCta.title.map((line, index) => (
            <span key={line} className={index > 0 ? styles.accent : undefined}>
              {line}
            </span>
          ))}
        </h2>
        <p className={styles.finalLead}>{finalCta.lead}</p>
        <div className={styles.finalActions}>
          <Link href={commercialCtas.primary.href} className={`${styles.btnPrimary} ${styles.btnLarge}`}>
            {commercialCtas.primary.label}
            <ArrowRight aria-hidden="true" size={20} />
          </Link>
          <Link href={commercialCtas.secondary.href} className={`${styles.btnGhost} ${styles.btnLarge}`}>
            {commercialCtas.secondary.label}
          </Link>
        </div>
        <p className={styles.finalMicro}>{finalCta.micro}</p>
        <Link href={commercialCtas.login.href} className={styles.finalLogin}>
          {commercialCtas.login.label}
        </Link>
      </div>
    </section>
  );
}
