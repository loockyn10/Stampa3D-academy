import type { CSSProperties } from "react";
import styles from "./UniversoHero.module.css";

/**
 * Alternativa visual sin WebGL: el mismo vaso de capas dibujado con elipses CSS.
 * Reacciona al scroll con las variables `--ex` (separación) y `--p` (progreso) que publica el controlador.
 */
const RINGS = 17;
const PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0, 0.7],
  [0.1, 1.18],
  [0.26, 1.62],
  [0.42, 1.22],
  [0.55, 0.96],
  [0.72, 1.32],
  [0.88, 1.58],
  [1, 1.12],
];

function radiusAt(t: number): number {
  for (let k = 1; k < PROFILE.length; k += 1) {
    const [t1, r1] = PROFILE[k];
    if (t <= t1) {
      const [t0, r0] = PROFILE[k - 1];
      const s = (1 - Math.cos(((t - t0) / (t1 - t0)) * Math.PI)) / 2;
      return r0 + (r1 - r0) * s;
    }
  }
  return PROFILE[PROFILE.length - 1][1];
}

export function HeroFallbackCore() {
  return (
    <div className={styles.fallback} aria-hidden="true">
      <div className={styles.fallbackGlow} />
      <div className={styles.fallbackStack}>
        {Array.from({ length: RINGS }, (_, index) => {
          const t = index / (RINGS - 1);
          const style = {
            "--y": ((t - 0.5) * -14).toFixed(2),
            "--w": (radiusAt(t) * 11.5).toFixed(2),
            "--i": index,
          } as CSSProperties;
          return <span key={index} className={styles.fallbackRing} data-accent={index % 4 === 2 ? "true" : "false"} style={style} />;
        })}
      </div>
    </div>
  );
}
