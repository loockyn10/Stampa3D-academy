import Image from "next/image";
import type { CSSProperties } from "react";
import { toolIcons } from "./tool-icons";
import { toolsSectionContent, type DemoMedia, type UniverseTool } from "./universe-tools";
import styles from "./DemoWindow.module.css";

type Props = {
  tool: Pick<UniverseTool, "name" | "route" | "icon">;
  media: DemoMedia;
  /** Carga la imagen sin esperar al scroll (la que ya se ve en la primera pantalla de la sección). */
  priority?: boolean;
  /** `true` si la demostración se repite en texto al lado: la imagen queda fuera del árbol de accesibilidad. */
  decorative?: boolean;
  /** Los videos solo se reproducen solos si el movimiento no está reducido. */
  animate?: boolean;
  className?: string;
  style?: CSSProperties;
};

/**
 * Ventana de aplicación que enmarca una demostración (captura, video o marcador). La usan la transición del Hero y la
 * sección de herramientas, así que la interfaz que "emerge" del núcleo es literalmente la que luego se explora.
 */
export function DemoWindow({ tool, media, priority = false, decorative = false, animate = true, className, style }: Props) {
  const Icon = toolIcons[tool.icon];
  return (
    <div className={`${styles.window} ${className ?? ""}`} style={style}>
      <div className={styles.bar} aria-hidden="true">
        <i />
        <i />
        <i />
        <span className={styles.route}>{tool.route}</span>
      </div>

      <div className={styles.screen} data-kind={media.kind}>
        {media.kind === "image" ? (
          <Image
            src={media.src}
            alt={decorative ? "" : media.alt}
            width={media.width}
            height={media.height}
            sizes="(min-width: 1024px) 56vw, 92vw"
            priority={priority}
            draggable={false}
          />
        ) : null}

        {media.kind === "video" ? (
          <video
            src={media.src}
            poster={media.poster}
            width={media.width}
            height={media.height}
            muted
            loop
            playsInline
            preload="metadata"
            autoPlay={animate}
            aria-label={decorative ? undefined : media.alt}
            aria-hidden={decorative ? true : undefined}
          />
        ) : null}

        {media.kind === "placeholder" ? (
          <div className={styles.placeholder} role="img" aria-label={`${tool.name}: ${toolsSectionContent.placeholderTitle}`}>
            <span className={styles.placeholderIcon}>
              <Icon aria-hidden="true" size={30} strokeWidth={1.6} />
            </span>
            <strong>{toolsSectionContent.placeholderTitle}</strong>
            <p>{media.note}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
