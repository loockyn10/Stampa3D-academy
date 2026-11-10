"use client";

import { useRef, type CSSProperties } from "react";
import { journey } from "./commercial-content";
import { Reveal } from "./Reveal";
import { useScrollProgress } from "./use-scroll-progress";
import styles from "./Commercial.module.css";

/**
 * «De la idea a la pieza»: una línea de capas (como las de una impresión) se rellena de naranja al avanzar el scroll y cada paso
 * se enciende cuando la línea llega a él. Un solo valor (--jp) gobierna todo; con movimiento reducido todo está encendido.
 */
export function ValueJourney() {
  const ref = useRef<HTMLElement>(null);
  useScrollProgress(ref, "--jp", 0.66);
  const count = journey.steps.length;

  return (
    <section ref={ref} id="valor" className={`${styles.section} ${styles.journey}`} aria-labelledby="journey-title">
      <div className={styles.inner}>
        <div className={styles.journeyGrid}>
          <Reveal className={styles.journeyIntro}>
            <p className={styles.eyebrow}>{journey.eyebrow}</p>
            <h2 id="journey-title" className={styles.display}>
              {journey.title.map((line, index) => (
                <span key={line} className={index === journey.title.length - 1 ? styles.accent : undefined}>
                  {line}
                </span>
              ))}
            </h2>
            <p className={styles.lead}>{journey.lead}</p>
          </Reveal>

          <div className={styles.steps}>
            <div className={styles.rail} aria-hidden="true">
              <span className={styles.railFill} />
            </div>
            <ol className={styles.stepList}>
              {journey.steps.map((step, index) => (
                <li key={step.verb} className={styles.step} data-plan={step.plan} style={{ "--at": (0.05 + (index / count) * 0.86).toFixed(3) } as CSSProperties}>
                  <span className={styles.stepNum} aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className={styles.stepBody}>
                    <p className={styles.stepTag} data-plan={step.plan}>
                      {journey.planLabels[step.plan]}
                    </p>
                    <h3 className={styles.stepVerb}>{step.verb}</h3>
                    <p className={styles.stepText}>{step.text}</p>
                    <p className={styles.handoff}>{step.handoff}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className={styles.journeyClosing}>{journey.closing}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
