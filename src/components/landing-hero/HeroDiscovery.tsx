import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { CSSProperties } from "react";
import { discoveryContent, type DiscoveryModule } from "./hero-content";
import styles from "./UniversoHero.module.css";

/** Mini visualizaciones decorativas de cada módulo (marcadores hasta tener demostraciones administrables). */
function ModuleVisual({ kind }: { kind: DiscoveryModule["kind"] }) {
  if (kind === "bars") {
    return (
      <div className={styles.vizBars}>
        {[46, 72, 38, 88, 60, 78].map((h, index) => (
          <span key={index} style={{ height: `${h}%` }} />
        ))}
      </div>
    );
  }
  if (kind === "stock") {
    return (
      <div className={styles.vizStock}>
        {[82, 54, 31].map((w, index) => (
          <div key={index}>
            <span style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
    );
  }
  if (kind === "chat") {
    return (
      <div className={styles.vizChat}>
        <span />
        <span />
      </div>
    );
  }
  return (
    <div className={styles.vizProgress}>
      <span />
      <i />
    </div>
  );
}

/**
 * Escena 4 — Descubrimiento: presentación estilizada de la plataforma.
 * La visibilidad la controla `--disc` (0..1) publicada por el controlador; con movimiento reducido es siempre 1.
 */
export function HeroDiscovery({ anchorId }: { anchorId?: string }) {
  const { eyebrow, title, subtitle, primary, secondary, modules } = discoveryContent;
  return (
    <section id={anchorId} className={styles.discovery} aria-labelledby="hero-discovery-title">
      <div className={styles.chamber} aria-hidden="true">
        <span className={styles.chamberRing} style={{ "--k": 0 } as CSSProperties} />
        <span className={styles.chamberRing} style={{ "--k": 1 } as CSSProperties} />
        <span className={styles.chamberRing} style={{ "--k": 2 } as CSSProperties} />
        <span className={styles.chamberRing} style={{ "--k": 3 } as CSSProperties} />
      </div>

      <div className={styles.discoveryInner}>
        <div className={styles.discoveryCopy} style={{ "--i": 0 } as CSSProperties}>
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
            <Link href={secondary.href} className={styles.btnGhost}>
              {secondary.label}
            </Link>
          </div>
        </div>

        <div className={styles.platform} aria-hidden="true">
          <div className={styles.platformPanel} style={{ "--i": 1 } as CSSProperties}>
            <div className={styles.panelBar}>
              <i />
              <i />
              <i />
              <b />
            </div>
            <div className={styles.panelBody}>
              <div className={styles.panelSide}>
                <i />
                <i />
                <i />
                <i />
              </div>
              <div className={styles.panelMain}>
                <span className={styles.panelHeadline} />
                <span className={styles.panelLine} />
                <span className={styles.panelLine} data-short="true" />
                <div className={styles.panelLayers}>
                  {Array.from({ length: 9 }, (_, index) => (
                    <span key={index} style={{ "--w": `${52 + Math.sin(index * 0.8) * 26 + index * 2}%` } as CSSProperties} />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {modules.map((module, index) => (
            <div key={module.id} className={styles.moduleCard} data-slot={index} style={{ "--i": index + 2 } as CSSProperties}>
              <div className={styles.moduleHead}>
                <strong>{module.title}</strong>
                <small>{module.hint}</small>
              </div>
              <ModuleVisual kind={module.kind} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
