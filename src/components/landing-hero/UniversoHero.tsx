"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from "react";
import { ArrowRight, Layers } from "lucide-react";
import { heroContent, type HeroAction } from "./hero-content";
import { isWebGLAvailable } from "./hero-quality";
import { HeroDiscovery } from "./HeroDiscovery";
import { HeroFallbackCore } from "./HeroFallbackCore";
import type { HeroModel, HeroSceneApi } from "./HeroCoreCanvas";
import { useHeroController } from "./use-hero-controller";
import styles from "./UniversoHero.module.css";

// Three.js viaja en su propio chunk y solo se descarga en el navegador.
const HeroCoreCanvas = dynamic(() => import("./HeroCoreCanvas"), { ssr: false });

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

let webglSupport: boolean | null = null;
function subscribeNever(): () => void {
  return () => undefined;
}
function getWebGLSupport(): boolean {
  webglSupport ??= isWebGLAvailable();
  return webglSupport;
}

const ANCHOR_ID = "descubrimiento";

/**
 * Hero 3D de Universo Stampa (prototipo). Orquesta las cuatro escenas:
 * formación → exploración → transformación (scroll) → descubrimiento.
 *
 * Estructura: un contenedor alto (`track`) con un escenario fijo (`stage`, sticky) dentro.
 * El progreso del scroll sobre el contenedor gobierna la cámara, el núcleo y las capas de texto.
 */
export function UniversoHero({ model = "nucleo" }: { model?: HeroModel }) {
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
  // null durante SSR/hidratación → sin discrepancias; luego true/false según el navegador.
  const webgl = useSyncExternalStore(subscribeNever, getWebGLSupport, () => null);

  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HeroSceneApi | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const [failed, setFailed] = useState(false);

  const handleReady = useCallback((api: HeroSceneApi) => {
    sceneRef.current = api;
    setSceneVersion((version) => version + 1);
  }, []);
  const handleFail = useCallback(() => {
    sceneRef.current = null;
    setFailed(true);
    setSceneVersion((version) => version + 1);
  }, []);

  useHeroController({ trackRef, stageRef, sceneRef, reducedMotion, sceneVersion });

  const showCanvas = webgl === true && !failed;
  const showFallback = webgl === false || failed;

  const goToDiscovery = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const track = trackRef.current;
    const stage = stageRef.current;
    if (reducedMotion || !track || !stage) {
      document.getElementById(ANCHOR_ID)?.scrollIntoView({ behavior: "auto", block: "start" });
      return;
    }
    const top = track.getBoundingClientRect().top + window.scrollY + track.offsetHeight - stage.clientHeight;
    window.scrollTo({ top, behavior: "smooth" });
  };

  const renderAction = (action: HeroAction) => {
    const className = action.kind === "primary" ? styles.btnPrimary : styles.btnGhost;
    const content = (
      <>
        {action.label}
        {action.kind === "primary" ? <ArrowRight aria-hidden="true" size={18} /> : null}
      </>
    );
    if (action.href.startsWith("#")) {
      return (
        <a key={action.label} href={action.href} className={className} onClick={goToDiscovery}>
          {content}
        </a>
      );
    }
    return (
      <Link key={action.label} href={action.href} className={className}>
        {content}
      </Link>
    );
  };

  return (
    <div className={styles.root} data-reduced={reducedMotion ? "true" : "false"}>
      <div ref={trackRef} className={styles.track}>
        <div ref={stageRef} className={styles.stage} data-hero-active="true" data-disc-active="false">
          <div className={styles.backdrop} aria-hidden="true" />

          <div className={styles.canvasWrap} aria-hidden="true">
            {showCanvas ? (
              <HeroCoreCanvas key={`${model}-${reducedMotion ? "still" : "live"}`} model={model} reducedMotion={reducedMotion} onReady={handleReady} onFail={handleFail} />
            ) : null}
            {showFallback ? <HeroFallbackCore /> : null}
          </div>
          <div className={styles.vignette} aria-hidden="true" />

          <header className={styles.nav}>
            <Link href="/landing" className={styles.brand} aria-label={`${heroContent.brand} — inicio`}>
              <span className={styles.brandMark}>
                <Layers aria-hidden="true" size={18} />
              </span>
              <span>{heroContent.brand}</span>
            </Link>
            <Link href={heroContent.loginHref} className={styles.navLink}>
              {heroContent.loginLabel}
            </Link>
          </header>

          <div className={styles.copy}>
            <h1 className={styles.title}>
              <span className={styles.titleLine} style={{ "--d": "1.5s" } as CSSProperties}>
                {heroContent.titleLines[0]}
              </span>
              <span className={`${styles.titleLine} ${styles.titleAccent}`} style={{ "--d": "1.68s" } as CSSProperties}>
                {heroContent.titleLines[1]}
              </span>
            </h1>
            <p className={styles.subtitle}>{heroContent.subtitle}</p>
            <div className={styles.actions}>{heroContent.actions.map(renderAction)}</div>
          </div>

          <p className={styles.caption} data-n="1" aria-hidden="true">
            {heroContent.captions[0]}
          </p>
          <p className={styles.caption} data-n="2" aria-hidden="true">
            {heroContent.captions[1]}
          </p>

          <div className={styles.scrollHint} aria-hidden="true">
            <span>{heroContent.scrollHint}</span>
            <i />
          </div>

          <div className={styles.flash} aria-hidden="true" />

          {reducedMotion ? null : <HeroDiscovery />}
        </div>
        {reducedMotion ? null : <span id={ANCHOR_ID} className={styles.endAnchor} aria-hidden="true" />}
      </div>

      {reducedMotion ? <HeroDiscovery anchorId={ANCHOR_ID} /> : null}
    </div>
  );
}
