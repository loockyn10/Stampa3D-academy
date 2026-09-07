"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { gsap } from "gsap";

import "./AccordionGallery.css";

export interface AccordionGalleryItem {
  label: string;
  description?: string;
  image?: string;
  alt?: string;
  content?: ReactNode;
}

export interface AccordionGalleryProps {
  items: AccordionGalleryItem[];
  defaultIndex?: number;
  accentColor?: string;
  overlayColor?: string;
  textColor?: string;
  height?: number;
  gap?: number;
  radius?: number;
  expandRatio?: number;
  duration?: number;
  ease?: string;
  tilt?: number;
  trigger?: "hover" | "click";
  className?: string;
}

export default function AccordionGallery({
  items,
  defaultIndex = 0,
  accentColor = "#ff780a",
  overlayColor = "#09090b",
  textColor = "#ffffff",
  height = 500,
  gap = 12,
  radius = 20,
  expandRatio = 0.58,
  duration = 0.55,
  ease = "power3.out",
  tilt = 4,
  trigger = "click",
  className = "",
}: AccordionGalleryProps) {
  const rootRef = useRef<HTMLUListElement>(null);
  const panelRefs = useRef<(HTMLLIElement | null)[]>([]);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const mediaRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const firstRunRef = useRef(true);
  const count = items.length;
  const [active, setActive] = useState(() =>
    Math.min(Math.max(defaultIndex, 0), Math.max(count - 1, 0)),
  );

  const applyLayout = useCallback(
    (animate: boolean) => {
      if (!rootRef.current || count === 0) return;

      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const isMobile = window.matchMedia("(max-width: 640px)").matches;
      const ratio = Math.min(Math.max(expandRatio, 0.2), 0.9);
      const activeGrow =
        count > 1 ? (ratio * (count - 1)) / (1 - ratio) : 1;
      const transitionDuration = animate && !reducedMotion ? duration : 0;

      timelineRef.current?.kill();
      const timeline = gsap.timeline();

      panelRefs.current.forEach((panel, index) => {
        if (!panel) return;

        const selected = index === active;
        const direction = index < active ? tilt : -tilt;
        const media = mediaRefs.current[index];

        timeline.to(
          panel,
          {
            flexGrow: isMobile ? 1 : selected ? activeGrow : 1,
            minHeight: isMobile ? (selected ? 360 : 88) : 0,
            rotateY: isMobile || selected ? 0 : direction,
            duration: transitionDuration,
            ease,
          },
          0,
        );

        if (media) {
          timeline.to(
            media,
            {
              x: selected ? 0 : index < active ? -8 : 8,
              scale: selected ? 1 : 1.035,
              opacity: selected ? 1 : 0.42,
              duration: transitionDuration,
              ease,
            },
            0,
          );
        }
      });

      timelineRef.current = timeline;
    },
    [active, count, duration, ease, expandRatio, tilt],
  );

  useEffect(() => {
    applyLayout(!firstRunRef.current);
    firstRunRef.current = false;
  }, [applyLayout]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const observer = new ResizeObserver(() => applyLayout(false));
    observer.observe(root);

    return () => observer.disconnect();
  }, [applyLayout]);

  useEffect(
    () => () => {
      timelineRef.current?.kill();
    },
    [],
  );

  const selectPanel = (index: number) => {
    setActive(index);
  };

  const handleKeyDown = (
    index: number,
    event: KeyboardEvent<HTMLButtonElement>,
  ) => {
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % count;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + count) % count;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = count - 1;
    }

    if (nextIndex === null) return;

    event.preventDefault();
    selectPanel(nextIndex);
    buttonRefs.current[nextIndex]?.focus();
  };

  const rootStyle = {
    "--ag-accent": accentColor,
    "--ag-overlay": overlayColor,
    "--ag-text": textColor,
    "--ag-gap": `${gap}px`,
    "--ag-radius": `${radius}px`,
    height: `${height}px`,
  } as CSSProperties;

  return (
    <ul
      ref={rootRef}
      className={`accordion-gallery ${className}`.trim()}
      style={rootStyle}
      aria-label="Recorrido por las herramientas de Academia Stampa"
    >
      {items.map((item, index) => {
        const selected = index === active;

        return (
          <li
            key={item.label}
            ref={(element) => {
              panelRefs.current[index] = element;
            }}
            className={`ag-panel${selected ? " ag-panel--active" : ""}`}
            style={{ borderRadius: `${radius}px` }}
          >
            <button
              ref={(element) => {
                buttonRefs.current[index] = element;
              }}
              type="button"
              className="ag-panel__button"
              aria-pressed={selected}
              aria-label={`${item.label}. ${item.description ?? ""}`.trim()}
              onClick={() => selectPanel(index)}
              onFocus={() => selectPanel(index)}
              onMouseEnter={() => {
                if (trigger === "hover") selectPanel(index);
              }}
              onKeyDown={(event) => handleKeyDown(index, event)}
            >
              <span className="ag-panel__frame">
                <span
                  ref={(element) => {
                    mediaRefs.current[index] = element;
                  }}
                  className="ag-panel__media"
                >
                  {item.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.image}
                      alt={item.alt ?? ""}
                      draggable={false}
                    />
                  ) : (
                    item.content
                  )}
                </span>
                <span className="ag-panel__overlay" aria-hidden="true" />
              </span>

              <span className="ag-panel__label" aria-hidden="true">
                <span className="ag-panel__bar" />
                <span className="ag-panel__copy">
                  <span className="ag-panel__title">{item.label}</span>
                  {item.description ? (
                    <span className="ag-panel__description">
                      {item.description}
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
