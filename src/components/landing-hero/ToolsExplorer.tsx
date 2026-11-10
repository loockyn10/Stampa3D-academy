"use client";

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { DemoWindow } from "./DemoWindow";
import { toolIcons } from "./tool-icons";
import { toolsSectionContent, universeTools, type UniverseTool } from "./universe-tools";
import styles from "./ToolsExplorer.module.css";

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Primera sección de exploración: lista de herramientas a la izquierda y una demostración protagonista a la derecha.
 * Al elegir una herramienta cambian la ventana, el título, la descripción y los puntos destacados. Todo sale de
 * `universe-tools.ts`: el componente no conoce ninguna herramienta concreta.
 *
 * Se desliza sobre el último tramo del escenario del Hero (ver `.root` en el CSS), así que la transición parece una sola.
 */
export function ToolsExplorer({ reducedMotion, tools = universeTools }: { reducedMotion: boolean; tools?: readonly UniverseTool[] }) {
  const [activeId, setActiveId] = useState(tools[0].id);
  const [demoId, setDemoId] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [inView, setInView] = useState(false);

  const tool = tools.find((candidate) => candidate.id === activeId) ?? tools[0];
  const demo = tool.demos.find((candidate) => candidate.id === demoId) ?? tool.demos[0];
  const Icon = toolIcons[tool.icon];

  // Entrada de la sección y parallax suave de la ventana, ligados al scroll. Con movimiento reducido no hay ninguno.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (reducedMotion) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.08 },
    );
    observer.observe(root);

    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = root.getBoundingClientRect();
      const viewport = window.innerHeight;
      // 0 cuando la sección asoma por abajo, 1 cuando su base sale por arriba.
      root.style.setProperty("--sp", clamp01((viewport - rect.top) / (viewport + rect.height)).toFixed(3));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [reducedMotion]);

  const select = (id: string, focus = false) => {
    setActiveId(id);
    setDemoId(null);
    const tab = tabRefs.current[id];
    if (focus) tab?.focus();
    // En móvil la lista es horizontal: centra la herramienta elegida sin mover la página.
    const nav = navRef.current;
    if (tab && nav && nav.scrollWidth > nav.clientWidth) {
      nav.scrollTo({ left: tab.offsetLeft - (nav.clientWidth - tab.offsetWidth) / 2, behavior: reducedMotion ? "auto" : "smooth" });
    }
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % tools.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + tools.length) % tools.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tools.length - 1;
    if (next < 0) return;
    event.preventDefault();
    select(tools[next].id, true);
  };

  const isOpen = tool.access === "open";

  return (
    <section
      ref={rootRef}
      id={toolsSectionContent.anchorId}
      className={styles.root}
      data-inview={reducedMotion || inView ? "true" : "false"}
      data-reduced={reducedMotion ? "true" : "false"}
      aria-labelledby="tools-title"
    >
      <div className={styles.inner}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>{toolsSectionContent.eyebrow}</p>
          <h2 id="tools-title" className={styles.title}>
            {toolsSectionContent.title}
          </h2>
          <p className={styles.subtitle}>{toolsSectionContent.subtitle}</p>
        </header>

        <div className={styles.layout}>
          <div ref={navRef} className={styles.nav} role="tablist" aria-label={toolsSectionContent.eyebrow}>
            {tools.map((item, index) => {
              const ItemIcon = toolIcons[item.icon];
              const active = item.id === tool.id;
              return (
                <button
                  key={item.id}
                  ref={(node) => {
                    tabRefs.current[item.id] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`tool-tab-${item.id}`}
                  aria-selected={active}
                  aria-controls="tool-panel"
                  tabIndex={active ? 0 : -1}
                  data-active={active ? "true" : "false"}
                  className={styles.tab}
                  style={{ "--n": index } as CSSProperties}
                  onClick={() => select(item.id)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                >
                  <span className={styles.tabNum} aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className={styles.tabText}>
                    <strong>{item.name}</strong>
                    <small>{item.tagline}</small>
                  </span>
                  <ItemIcon className={styles.tabIcon} aria-hidden="true" size={18} strokeWidth={1.7} />
                </button>
              );
            })}
          </div>

          <div id="tool-panel" role="tabpanel" aria-labelledby={`tool-tab-${tool.id}`} tabIndex={0} className={styles.panel}>
            <div className={styles.viewport}>
              <DemoWindow key={`${tool.id}-${demo.id}`} className={styles.swap} tool={tool} media={demo.media} priority={tool.id === tools[0].id} animate={!reducedMotion} />
            </div>

            <div key={tool.id} className={`${styles.details} ${styles.swap}`}>
              <div className={styles.detailsMain}>
                <span className={styles.badge} data-access={tool.access}>
                  <Icon aria-hidden="true" size={14} strokeWidth={1.9} />
                  {isOpen ? toolsSectionContent.openLabel : toolsSectionContent.memberLabel}
                </span>
                <h3 className={styles.toolName}>{tool.name}</h3>
                <p className={styles.toolDescription}>{tool.description}</p>

                {tool.demos.length > 1 ? (
                  <div className={styles.demoSwitch} role="group" aria-label={`Demostraciones de ${tool.name}`}>
                    {tool.demos.map((item) => (
                      <button key={item.id} type="button" aria-pressed={item.id === demo.id} data-active={item.id === demo.id ? "true" : "false"} onClick={() => setDemoId(item.id)}>
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {demo.media.kind !== "placeholder" ? <p className={styles.summary}>{demo.summary}</p> : null}

                <div className={styles.cta}>
                  {isOpen ? (
                    <Link href={tool.route} className={styles.btnPrimary}>
                      {toolsSectionContent.openCta(tool.name)}
                      <ArrowRight aria-hidden="true" size={18} />
                    </Link>
                  ) : (
                    <Link href={toolsSectionContent.memberHref} className={styles.btnPrimary}>
                      {toolsSectionContent.memberCta}
                      <ArrowRight aria-hidden="true" size={18} />
                    </Link>
                  )}
                </div>
              </div>

              <ul className={styles.highlights}>
                {tool.highlights.map((text) => (
                  <li key={text}>
                    <Check aria-hidden="true" size={16} strokeWidth={2.2} />
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
