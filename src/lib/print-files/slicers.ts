/**
 * Registro de laminadores soportados. Agregar uno nuevo = una entrada acá (+ su logo en /public/slicers);
 * la base solo valida la forma del identificador, no la lista.
 *
 * `deepLink` describe los esquemas de URL que el laminador registra en el sistema operativo. Solo se declaran los
 * verificados en el código fuente del propio laminador (ver docs/ARCHITECTURE.md §27). Sin `deepLink` para un sistema,
 * la app descarga el archivo y explica cómo abrirlo: nunca inventa un esquema.
 */

export type SlicerId = "bambu_studio" | "flash_studio" | "orcaslicer";

/** Sistemas operativos de escritorio en los que puede intentarse abrir un laminador por esquema de URL. */
export type DesktopPlatform = "windows" | "macos";

export interface SlicerDefinition {
  id: SlicerId;
  label: string;
  /** Imagen en /public (icono oficial de la aplicación). */
  logo: string;
  /** Arma el enlace de apertura a partir de la URL https del archivo. Vacío = sin esquema verificable. */
  deepLink: Partial<Record<DesktopPlatform, (fileUrl: string) => string>>;
  /** Lo que se le dice al usuario cuando no hay (o no se pudo usar) un esquema directo. */
  manualOpenHint: string;
  /** Aviso de seguridad o compatibilidad que el laminador muestra al abrir por enlace, si lo hay. */
  deepLinkNote?: string;
  /** Por qué este laminador no tiene apertura directa (solo si `deepLink` está vacío). */
  noDeepLinkReason?: string;
}

export const SLICERS: readonly SlicerDefinition[] = [
  {
    id: "bambu_studio",
    label: "Bambu Studio",
    logo: "/slicers/bambu-studio.png",
    deepLink: {
      // Windows: se recibe como argumento y se lee el parámetro `file=`. macOS: esquema propio `bambustudioopen://`.
      windows: (url) => `bambustudio://open?file=${url}`,
      macos: (url) => `bambustudioopen://${url}`,
    },
    manualOpenHint: "Abrí Bambu Studio y elegí Archivo → Abrir proyecto, o hacé doble clic sobre el archivo .3mf descargado.",
    deepLinkNote:
      "Bambu Studio puede preguntar si confiás en el sitio de descarga: es normal, confirmalo. Si ya lo tenés abierto con la opción «instancia única» de Windows, el enlace se ignora: descargá el archivo.",
  },
  {
    id: "flash_studio",
    label: "Flash Studio",
    logo: "/slicers/flash-studio.png",
    deepLink: {},
    manualOpenHint: "Abrí Flash Studio y arrastrá el archivo .3mf descargado a la ventana, o usá Archivo → Abrir proyecto.",
    noDeepLinkReason:
      "Flash Studio no publica un enlace propio para abrir archivos desde el navegador (comparte el esquema orcaslicer:// con OrcaSlicer y no se puede dirigir solo a él).",
  },
  {
    id: "orcaslicer",
    label: "OrcaSlicer",
    logo: "/slicers/orcaslicer.png",
    deepLink: {
      windows: (url) => `orcaslicer://open?file=${url}`,
      macos: (url) => `orcaslicer://open?file=${url}`,
    },
    manualOpenHint: "Abrí OrcaSlicer y arrastrá el archivo .3mf descargado a la ventana, o usá Archivo → Abrir proyecto.",
    deepLinkNote:
      "OrcaSlicer descarga el proyecto a su carpeta de descargas y lo abre. Si tenés Flash Studio instalado, el enlace puede abrirse en ese programa: en ese caso descargá el archivo.",
  },
] as const;

export const SLICER_IDS: readonly SlicerId[] = SLICERS.map((slicer) => slicer.id);

export function isSlicerId(value: unknown): value is SlicerId {
  return typeof value === "string" && (SLICER_IDS as readonly string[]).includes(value);
}

export function getSlicer(id: string): SlicerDefinition | null {
  return SLICERS.find((slicer) => slicer.id === id) ?? null;
}

export function slicerLabel(id: string): string {
  return getSlicer(id)?.label ?? id;
}
