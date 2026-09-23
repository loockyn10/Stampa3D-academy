# STAMPA MAKER

> 0.1 (2026-09-17): MVP del Creador de Carteles, fix del motor geométrico
> (huecos tapados / paredes sin espesor real, sección 6) y exportación de
> letras individuales soldadas como un único sólido por letra (sección 9).
> 0.2 (2026-09-17): segundo modo de frente — tapa frontal plana como pieza
> separada del cuerpo (sección 11).
> 0.3 (2026-09-17): tercer modo de frente — tapa encastrable con labio
> interior (sección 12), y hardening de errores/warnings geométricos: una
> tapa encastrable sin encastre funcional (`LIP_COLLAPSED`) bloquea la
> exportación en vez de degradarse en silencio (sección 12.3).
> 0.3.1 (2026-09-17): corrección conceptual del labio — pasa de "rellenar
> toda la cavidad" a un anillo perimetral fino (`lipWallMm`, sección 12.4),
> crítico para cartelería luminosa (la placa debe permanecer fina). Además,
> el viewport 3D gana altura en desktop (sección 13).
> 0.4 (2026-09-18): sistemas de cuerpo y frente — arquitectura BODY/FRONT/
> JOINT/MODIFIERS/PATTERN con resultado genérico `parts: SignPart[]`
> (sección 14.1); modificador de costillas laterales (14.2); cuerpo
> tapered (14.3); bisel frontal interior (14.4); frente perforado +
> difusor + patrón de círculos (14.5); frente de canal luminoso interior +
> difusor de canal (14.6); UI contextual y exportación/preview genéricos
> por partes (14.7); limitaciones conocidas (14.8).
> 0.4.1 (2026-09-18): iteración CORRECTIVA de 0.4 — cuatro errores de
> interpretación geométrica detectados al probar visualmente lo
> implementado, sin agregar familias/patrones nuevos (sección 15). Perfil
> de costilla: de prisma de tope plano a montículo progresivo (coseno,
> 15.1). Tapered: dos estilos, `stepped` (sin cambios) y `smooth`
> (resolución fina + smoothstep, 15.2). Bisel: separado en dos
> modificadores independientes — bisel frontal suavizado + continuidad con
> la tapa (15.3), y bisel lateral/doble bisel nuevo (`grooveEnabled`,
> 15.4). Frente perforado: orden explosionado corregido (15.5) y máscara
> rediseñada como carcasa con faldón lateral (`maskSideDepthMm`, 15.6).
> Fix transversal de precisión numérica en la aproximación por sub-bandas
> (cuantización de offset, 15.7). 199 tests Maker (162 -> 199).
> 0.4.2 (2026-09-18): "Bevel system completion" — completa el sistema de
> biseles y corrige DEFINITIVAMENTE el orden explosionado (sección 16). Fix
> de orden explosionado del perforado: capa de armado semántica por
> `PartKind` (`PART_ASSEMBLY_LAYER`, geometry/explodeOrder.ts) en vez de la
> posición Z real de la malla, que volvía a romperse con el faldón lateral
> de la máscara (16.1). Bisel posterior (`rearBevelEnabled`), equivalente
> trasero del bisel frontal, misma infraestructura de bandas (16.2). Bisel
> de tapa/difusor (`lidBevelEnabled`), aplicado a la tapa o al difusor del
> perforado (nunca a la máscara), acotado automáticamente al espesor real
> de la pieza (16.3). Canal luminoso, gyroid, honeycomb, nuevos patterns,
> materiales, 3MF y LEDs quedan explícitamente fuera de alcance (16.7). 242
> tests Maker (199 -> 242).
> 0.5 (2026-09-19): importación de SVG y PNG como origen del diseño
> (sección 17): `DesignSource` (texto | SVG | PNG) normalizado a
> `ContourGroup[]` ANTES del motor — el resto del pipeline (cuerpos, frentes,
> biseles, export, preview) no sabe de dónde vino la forma. SVG vectorial
> (parser propio, sin DOM), PNG por alpha o luminosidad (marching squares +
> Douglas-Peucker propios), escala uniforme por alto en mm, unión booleana
> Clipper, counters e islas. Dependencia nueva: `upng-js` (solo decodificar
> PNG). 45 tests nuevos en tests/maker-import.test.mjs (287 tests Maker).
> 0.5.1 (2026-09-19): sprint UX/productividad (secciones 18-21): workspace fijo con visor + controles superpuestos, vistas Modelo/Cama (A1 256x256x256, auto-arrange, multi-placa), slider de explosión, presets y proyectos persistentes por usuario. Motor geométrico sin cambios.
> 0.6 (2026-09-19): safe zone del overlay respecto de Stampy, orientación de impresión como fuente única para Vista Cama y STL (sección 22) y recortes traseros paramétricos circle/capsule/keyhole (sección 23).
> 0.6.1 (2026-09-19): editor visual de recortes (seleccionar + arrastrar sobre la vista trasera ortográfica) y keyhole nuevo a 180° (sección 24).
> Neon 0.1 (2026-09-19): segunda herramienta, **Neon LED** (`/stampa-maker/neon`, sección 25): canal en U imprimible para Neon Flex a partir de texto (fuente de trazos) o SVG de líneas. Motor geométrico propio, separado del de Carteles.
> Neon 0.2 (2026-09-20): imágenes raster PNG/JPEG -> skeleton -> NeonPaths (sección 27).
> Jarros 0.1 (2026-09-21): tercera herramienta, **Jarros 3D** (`/stampa-maker/jarros`, sección 28): motor paramétrico independiente `MugDefinition` -> perfil -> revolución -> asa por loft topológico -> malla única cerrada.
> Jarros 0.2 (2026-09-21): personalización del cuerpo — texto, SVG, PNG/JPG como relieve, grabado o medallón envueltos sobre la superficie real, sin CSG (sección 29).
> Jarros 0.3 (2026-09-21): Diseñar con IA — el modelo solo configura MugDefinition/decoraciones vía structured output + sanitización + preview + aplicar (sección 30).
> **Jarros 3D — Status: Beta / Admin Only (2026-09-21).** Desarrollo temporalmente pausado; ver sección 31.
> Instalación 0.1 (2026-09-21): sistema de instalación de Carteles — identidad física por letra, montaje (Keyhole / separadores impresos con receptor reforzado), cableado BIPOLAR encadenado físico / paralelo eléctrico (puertos de dos agujeros, soporte de empalmes EXTERNO imprimible), zonas reservadas, plantilla 1:1 (PDF vectorial con tiling), guía de conexión y kit ZIP (sección 32; corrección bipolar/externo en 32.7-32.8).
> Neon 0.1.1 (2026-09-19): importador SVG corregido (cascada CSS real, `<text>`, mensajes diferenciados) y biblioteca de fuentes single-line reales: Mistral SingleLine y Relief SingleLine, OFL (sección 26).
> Neon 0.3 (2026-09-23): sistema de instalación de Neon LED (sección 33): `NeonSegment` (identidad física por recorrido, IDs posicionales + reconciliación best-effort por forma), `NeonWiringPlan` (nearest-neighbor + 2-opt acotado, IN/OUT por segmento), `NeonCablePassThrough` (cápsula bipolar única, perfora el piso sin tocar las paredes visibles — split de piso por bandas gateado, malla bit a bit idéntica sin pass-throughs), puentes traseros por MST (Kruskal, **sólidos independientes con overlap físico real, NO soldados por Clipper** — ver 33.4 para el porqué y la limitación aceptada), `NeonWallClip` paramétrico (deriva de la sección del canal, se regenera solo), posición automática de clips por longitud de arco, editor manual (reutiliza el editor de Back Cutouts existente, pass-through como `BackCutout` sintético — invertir/reordenar por lista), malla helper de cableado/montaje (nunca se exporta), export (Wall Clip STL + kit ZIP) y persistencia (receta+overrides anidados en el mismo `settings` jsonb, sin migration nueva). 53 tests nuevos en tests/maker-neon-installation.test.mjs (630 -> 683 tests Maker). No avanza a Neon 0.4.
> Neon 0.3.2 (2026-09-23): corrección conceptual de cableado y puentes (sección 34), sin features nuevas. Cableado: se verificó que la fórmula 2N-1 de pass-throughs ya estaba bien implementada (no era "1 segmento -> 1 pass-through"); se agregó `NeonPassThroughRole` (POWER IN/IN/OUT/loop) y `planValidPassThrough()` (fallback de reposicionamiento cuando la posición por defecto no entra en la cavidad — antes se perdía en silencio). Puentes: reescritos de MST-only a modelo `BridgeConnection`/`BridgeInstance` con 4 modos (`independent`/`minimal`/`reinforced`/`custom`, antes solo `independent`/`bridged`), planificador de refuerzo con muestreo por longitud de arco + separación espacial mínima + evasión de pass-throughs, y editor manual mínimo (agregar/eliminar por par de segmentos, con validación de "toca ambos floors"). 12 tests nuevos en tests/maker-neon-installation.test.mjs (53 -> 65; 683 -> 696 tests Maker totales, 1 skip preexistente no relacionado). No avanza a Neon 0.4.

## 1. Qué es

Nueva sección de Stampa (`/stampa-maker`) para generar geometría 3D paramétrica
imprimible. La primera (y única, en esta fase) herramienta es el **Creador de
Carteles**: convierte texto en letras corpóreas huecas (fondo cerrado) y
permite previsualizarlas en 3D y exportarlas como STL. El frente puede ser
completamente abierto (0.1) o cerrado con una tapa frontal plana, como pieza
separada del cuerpo (0.2, sección 11).

No reemplaza ni modifica ninguna arquitectura existente de Stampa (auth,
RLS, pricing, stock). Es una sección nueva, protegida por el mismo middleware
que el resto de "Plataforma" (requiere `accessPlatform`, sin excepción Free
— no está en `isFreeAccountRoute` de `src/utils/supabase/middleware.ts`).

## 2. Dónde vive

```
src/app/stampa-maker/page.tsx              landing de la sección (lista de herramientas)
src/app/stampa-maker/carteles/page.tsx     Creador de Carteles (tool page)
src/app/stampa-maker/neon/page.tsx         Neon LED (tool page, sección 25)

src/lib/maker/
  types.ts                  tipos compartidos del pipeline (mm en todo)
  validation.ts              validación de parámetros de UI
  fonts/registry.ts          catálogo de fuentes + loader (fetch + opentype.parse, con cache)
  geometry/
    textToPaths.ts            texto -> paths de opentype.js (uno por carácter, mismo layout/kerning que el string completo) y aplanado de curvas -> contornos 2D
    contourHierarchy.ts       contornos crudos -> {outer, holes}[] (par/impar, point-in-polygon)
    offsets.ts                wrapper de Clipper: inset (núcleo erosionado) y difference (footprint de pared)
    extrudePolygon.ts         contornos -> mesh 3D (earcut + paredes laterales), normaliza winding + grilla de coordenadas compartida
    createLetterGeometry.ts   orquesta el pipeline por carácter y suelda fondo+pared en un solo sólido por letra
    toBufferGeometry.ts       triangle soup -> THREE.BufferGeometry
  exporters/
    exportSTL.ts               triangle soup -> Blob STL binario + descarga (pieza suelta: cuerpo o tapa)
    exportWord.ts               palabra completa -> .stl (frente abierto) o .zip cuerpo+tapa (tapa frontal)
    exportLettersZip.ts        letras individuales -> recentrado + ZIP (JSZip) -> descarga (1 o 2 STL por letra)

src/hooks/maker/useLetterGeometry.ts   corre el pipeline con debounce, fuera del render

src/components/maker/
  MakerTextControls.tsx       panel de controles (texto, fuente, dimensiones, descarga: palabra completa / letras .zip)
  MakerViewport.tsx           visor three.js "vanilla" (sin r3f), grilla + OrbitControls

public/fonts/maker/           Montserrat-Regular.woff, Montserrat-Bold.woff (de @fontsource/montserrat)

tests/maker-letter-geometry.test.mjs   tests del pipeline geométrico y de exportación (node:test)
```

Convenciones reutilizadas del resto del repo (no se creó un design system
aparte): `Card`, `Button`, `SectionTitle`, `CalculatorSelect` de
`src/components/ui/*`, colores `stampa-*` de Tailwind, `useAppFeedback` para
toasts. Entrada agregada en `src/components/layout/sidebar.tsx` (grupo
"Plataforma") y `mobile-navigation.ts`.

## 3. Pipeline geométrico

```
texto + fuente + alto(mm)
  -> textToPerCharacterPaths      (font.getPaths: un path por carácter, mismo layout que el string completo)
  -> por cada carácter (se descartan los que no tienen tinta: espacios):
       flattenOpentypePath         subpaths cerrados, curvas Q/C aplanadas, Y invertida a "arriba positivo"
       buildContourHierarchy       {outer, holes}[] del carácter, regla par/impar vía point-in-polygon
       buildWeldedLetterSolid      ver "Soldadura fondo/pared" abajo -> UN sólido por carácter
  -> letters[] (una pieza por carácter) + positions/normals combinados (letters[] concatenado) -> THREE.BufferGeometry -> preview / STL / ZIP
```

Todo el pipeline trabaja en **milímetros** (1 unidad = 1 mm), sin
conversiones intermedias. `createLetterGeometry()` es la única fuente de
verdad geométrica: el preview, `STAMPA.stl` (concatenación de `letters[]`)
y el ZIP de letras individuales (cada entrada de `letters[]`, recentrada)
usan exactamente las mismas piezas — no hay un motor de exportación
paralelo.

### Soldadura fondo/pared: un solo sólido por letra, sin booleana 3D

Cada carácter se resuelve con `buildWeldedLetterSolid()`
(`createLetterGeometry.ts`), que arma **una única malla soldada** por
coordenadas compartidas en cada frontera, en vez de dos sólidos separados
que solo se tocan (ver sección 6.2, el diseño original). Piezas:

1. **Fondo**: tapa en `z=0` (silueta exterior menos los huecos ORIGINALES
   del glifo) + paredes laterales de ese mismo exterior/huecos, de punta a
   punta, `z=0` → `z=depthMm`. El exterior y cada hueco original no cambian
   de forma en ningún punto de la pieza, así que su pared lateral es una
   franja continua, sin corte en `baseMm`.
2. **Repisa**: tapa del **núcleo erosionado** (`insetContourGroups`, la
   misma erosión que ya se usaba para calcular la pared) en `z=baseMm`,
   mirando hacia `+Z`. Reemplaza la tapa completa que el fondo ponía ahí
   antes (esa tapaba el hueco — el bug de la sección 6.2). Vacía si el
   trazo se erosionó por completo.
3. **Paredes internas**: bordes del núcleo erosionado, `baseMm` → `depthMm`
   (separan la pared hueca de la cavidad real). Mismo conjunto de
   contornos que la repisa, pero con la normal de las paredes invertida
   (`flipSides`): como región, el material "natural" del núcleo erosionado
   es su propio interior, pero acá el núcleo representa la cavidad (vacía)
   y el material real está afuera de él.
4. **Frente**: tapa de la huella de pared (`differenceContourGroups`,
   exterior/hueco original menos el núcleo) en `z=depthMm`, mirando hacia
   `+Z`. Earcut nunca triangula el interior del núcleo (llega como
   `holeIndices`), así que esta tapa nunca cubre la cavidad.

Las 4 piezas comparten vértices exactos en cada frontera (mismas
coordenadas antes y después del jitter), así que el resultado es **un solo
componente conectado por letra** — verificado con un test dedicado de
conteo de shells (sección 9). Ningún paso usa CSG/boolean 3D.

### Decisiones clave

- **Huecos vía nonzero + Clipper, no unión previa.** `buildContourHierarchy`
  clasifica exterior/huecos directamente por contención geométrica
  (par/impar); esa clasificación se usa tal cual para el offset y la
  extrusión.
- **Fuentes vs. salida de Clipper usan winding opuesto.** Cada fuente
  (internamente consistente: exterior y huecos en sentidos opuestos) y
  Clipper usan convenciones absolutas distintas entre sí.
  `extrudePolygon.ts` normaliza explícitamente la orientación de cada
  contorno antes de generar paredes laterales (las tapas no lo necesitan:
  `earcut` normaliza su propia salida).
- **Grilla de coordenadas compartida (0.0001 mm) antes del jitter.** Un
  mismo borde físico (p.ej. el contorno exterior, que no cambia de forma en
  ningún punto de la pieza) puede llegar con una diferencia de
  ~0.00001–0.00005 mm según si viene directo de la fuente o de un
  round-trip por Clipper (que redondea a enteros internamente). Sin
  redondear ambas copias a la misma grilla antes de aplicar el jitter
  determinístico, esa diferencia ínfima podía caer en celdas de grilla
  distintas y dejar la letra como shells separados en vez de un único
  sólido soldado. Ver sección 6.3.
- **Jitter determinístico antes de triangular.** earcut elige el "puente"
  hueco↔exterior con una heurística propia; cuando hay vértices exactamente
  alineados (mismo X o Y — común en offsets con tramos rectos, de cualquier
  fuente o letra) puede elegir un puente que deja la malla no-manifold o un
  triángulo de área ~0. `extrudePolygon.ts` aplica un jitter determinístico
  de 0.0001 mm (muy por debajo de cualquier tolerancia de impresión, y
  consistente entre llamadas separadas porque depende del hash de cada
  punto, no de su índice) antes de triangular y de generar las paredes
  laterales.
- **`differenceContourGroups` ya no limpia su salida con `CleanPolygons`.**
  Se probó originalmente para letras con features muy próximas (p.ej. el
  travesaño de una "B"), pero `CleanPolygons` podía alterar levemente el
  contorno exterior de letras con curvas complejas (p.ej. "S"), rompiendo
  la igualdad exacta de coordenadas que necesita la soldadura. El problema
  que motivó `CleanPolygons` ya está cubierto por el jitter determinístico
  (ver arriba), así que se quitó — sigue activo solo en
  `insetContourGroups`, donde no genera este conflicto.
- **Offset con fallback sólido.** Si `wallMm` es mayor a la mitad del trazo
  más angosto, el núcleo erosionado da vacío para esa letra y el "frente"
  cubre la letra completa sin hueco (macizo) en vez de romper. Se reporta
  como warning `WALL_TOO_THICK`, no como error bloqueante.

## 4. Dependencias agregadas

| Paquete | Uso |
|---|---|
| `three` (+`@types/three`) | preview 3D, `STLExporter`, `OrbitControls` |
| `opentype.js` (+`@types/opentype.js`) | texto -> paths vectoriales |
| `earcut` | triangulación de tapas (exterior + huecos) |
| `clipper-lib` (+`@types/clipper-lib`) | offset (núcleo erosionado) y difference (footprint de pared) |
| `@fontsource/montserrat` | fuente de origen de los `.woff` en `public/fonts/maker` (no se usa en runtime, solo como fuente de los archivos) |
| `jszip` | arma el ZIP de letras individuales en el cliente (ships sus propios tipos, sin `@types/jszip`) |

No se usó react-three-fiber ni Web Workers: el visor es three.js imperativo
en un `useEffect`, y el pipeline corre en el hilo principal con debounce
(200 ms). Para este volumen de texto (unas pocas palabras) el cálculo tarda
milisegundos; si en 0.2+ se soportan textos largos o geometría más pesada,
mover el pipeline a un Worker es el primer punto a evaluar.

## 5. Limitaciones conocidas (0.1)

- Solo 2 fuentes (Montserrat Regular/Bold), ambas Latin. Agregar una fuente
  nueva es sumar el `.woff` en `public/fonts/maker` + una entrada en
  `src/lib/maker/fonts/registry.ts` — no requiere tocar el pipeline.
- El alto se calibra contra `capHeight` (o `sTypoAscender`/`ascender` como
  fallback) de la fuente. Con texto en minúsculas o mixto, el alto real de
  ascendentes/descendentes puede no coincidir exactamente con `heightMm`.
- `buildContourHierarchy` soporta un nivel de anidamiento (huecos dentro de
  un exterior). Glifos con formas anidadas más profundas (p.ej. `@`) no
  están garantizados — no forman parte del alcance de este MVP (solo
  letras/dígitos latinos).
- El curveado (aplanado de Bézier) usa una subdivisión fija por longitud de
  cuerda (~1.2 mm objetivo), no adaptativa por curvatura. Es suficiente para
  el rango de tamaños de este MVP; letras muy grandes (varios cientos de mm)
  podrían beneficiarse de más segmentos.
- Sin Web Workers: con textos muy largos (varias líneas, decenas de
  palabras) el cálculo podría notarse en la UI. No medido en este MVP.
- El ZIP de letras individuales se arma sincrónicamente en el cliente con
  JSZip; no medido con textos muy largos (decenas de letras).

## 6. Bugs encontrados y corregidos

### 6.1 Primera pasada (2026-09-17, implementación inicial)

Al extruir letras con huecos, las paredes laterales quedaban con normales
invertidas en la interfaz fondo/pared. `extrudePolygon.ts` normaliza
explícitamente la orientación de cada contorno antes de generar paredes
laterales (ver sección 3) para corregirlo.

### 6.2 Segunda pasada (mismo día, reporte de "hueco tapado" y "pared hueca")

Verificación visual del STL mostró que el counter de la `O` seguía tapado
y las paredes no se veían como un volumen sólido real. La causa NO estaba
en `contourHierarchy`, en cómo se arma `{outer, holes}`, ni en cómo se
pasan `holeIndices` a earcut — esa parte ya era correcta. Dos bugs reales,
ambos en `createLetterGeometry.ts`/`extrudePolygon.ts`, no específicos de
ninguna letra:

1. **`fondoGroups` descartaba los huecos a propósito** (`holes: []`),
   convirtiendo el fondo en un disco macizo que tapaba el counter con una
   cara real en `z = baseMm`, por debajo de donde la pared sí dejaba el
   hueco abierto. Mirado desde el frente, el canal se veía "tapado" al
   llegar al fondo. Fix: `holes: group.holes` (sección 3).
2. **La pared no tapaba su propio extremo frontal** (`capEnd: false`),
   dejando dos superficies verticales (exterior/interior) sin unir en la
   punta — de ahí la sensación de "pared hueca". Como la huella de la
   pared ya es un anillo (no incluye el área del counter), taparla en
   `capEnd: true` le da espesor real sin cubrir la cavidad. Fix:
   `{ capStart: true, capEnd: true }` (sección 3).

Al implementar el fix se encontró un tercer problema, más sutil, al
agregar tests que verifican explícitamente que el hueco esté libre (no
solo que la malla esté balanceada): para letras con huecos cercanos entre
sí o a tramos rectos del contorno (`B`, `L`), earcut podía elegir un
"puente" hueco↔exterior que dejaba la malla no-manifold o generaba un
triángulo de área ~0, por vértices exactamente colineales (mismo X o Y).
Fix: jitter determinístico de 0.0001 mm antes de triangular y de generar
paredes laterales (sección 3), reproducible con cualquier fuente/letra
donde el offset deje puntos alineados.

Los tests anteriores (balance de aristas) no detectaban ninguno de los dos
primeros bugs: una malla puede ser perfectamente watertight/manifold y
seguir teniendo la forma equivocada (disco en vez de anillo). Se agregaron
tests que disparan un rayo vertical por el centro de cada counter (`O`,
`B` x2, `8` x2, `A`) y verifican que ningún triángulo lo cruce en ningún
punto de la profundidad, más tests específicos de fondo-como-anillo,
frente-sin-tapa-sobre-la-cavidad y espesor de pared real
(`tests/maker-letter-geometry.test.mjs`).

> Nota: el `capStart`/`capEnd` descriptos en 6.2 (fondo y pared como dos
> sólidos separados, cada uno tapado por completo en `z=baseMm`)
> corresponde al diseño **anterior** a la soldadura de la sección 6.3. El
> fix de huecos (`holes: group.holes` en el fondo) sigue vigente; el
> "capEnd:true en la pared" fue reemplazado por la repisa del núcleo
> erosionado (sección 3) al soldar fondo y pared en un solo sólido.

### 6.3 Tercera pasada (mismo día, "una letra debe ser un solo objeto imprimible")

Verificación pedida explícitamente: ¿una letra terminada es 1 solo
connected component, o varios shells watertight que solo se tocan? Con el
diseño de 6.2 (fondo y pared como dos sólidos independientes, cada uno con
su propia tapa completa en `z=baseMm`), la respuesta era **varios shells**:
2 para letras sin huecos (I, L), 3 para letras con 1 hueco (O, A), hasta 4
para letras con 2 huecos (B, 8) — exactamente lo que Bambu Studio separaría
con "Dividir en objetos". Se evaluó agregar una unión booleana 3D para
fusionarlos, pero antes se evaluó si la construcción podía dar un único
sólido desde el origen — sí se pudo, sin CSG: ver "Soldadura fondo/pared"
en la sección 3. Resultado verificado con un test dedicado de conteo de
componentes conectados (sección 9): 1 solo shell para I/O/A/B/8.

### 6.4 Bug encontrado al implementar la soldadura: precisión numérica entre fuente y Clipper

Al soldar fondo y pared compartiendo coordenadas, letras simples (`I`)
pasaron a ser 1 solo componente de inmediato, pero letras con curvas
complejas seguían mostrando aristas sueltas puntuales. Causa: un mismo
punto del contorno exterior, según viniera directo de la fuente (float sin
redondear) o de un round-trip por Clipper (que trabaja en enteros
internamente, grilla de 0.0001 mm), podía diferir en ~0.00001–0.00005 mm.
El jitter determinístico (hash de `(x, y)`) amplificaba esa diferencia
ínfima lo suficiente como para que ambas copias cayeran en lados opuestos
de un borde de redondeo a 4 decimales — dejando una arista sin su
contraparte. Fix: redondear todo contorno a la misma grilla de 0.0001 mm
*antes* de aplicar el jitter (`extrudePolygon.ts`, `snapToGrid`).

Aparte, para letras con curvas más complejas (`S`), `differenceContourGroups`
devolvía el contorno exterior con una cantidad de puntos distinta a la
original (382 vs. 399) — `CleanPolygons`, aplicado a toda la salida de la
diferencia, estaba simplificando levemente ese contorno. Como el fondo usa
el contorno exterior de la fuente sin pasar por Clipper, dos copias con
distinta cantidad de puntos no pueden soldarse borde a borde. Fix: se quitó
`CleanPolygons` de `differenceContourGroups` (sección 3); el problema que
había motivado agregarlo (triángulos degenerados en letras con huecos
próximos, como `B`) ya estaba cubierto por el jitter determinístico.

## 7. Cómo validar

```bash
npx tsc --noEmit
npm run build
node --test tests/maker-letter-geometry.test.mjs
```

Los tests cubren: `I, L, A, O, B, 8, STAMPA, LOOCK 3D` (mesh válido +
topología correcta, incluyendo que no queden bordes abiertos: la letra
completa queda totalmente cerrada como un único sólido soldado), conteo de
huecos por letra (`O`→1, `B`→2, `8`→2, `STAMPA`→3 contando la P),
específicamente para huecos: el counter de `O`/`B`(x2)/`8`(x2)/`A` queda
libre de geometría en toda la profundidad (rayo vertical por su centro),
el fondo no tiene ninguna cara sobre el counter pero sí tiene material
sobre el trazo (control positivo), no hay tapa exactamente en
`z = depthMm` sobre la cavidad, y la erosión de la pared queda a
~`wallMm` del contorno más cercano; conteo de componentes conectados
(1 por letra, I/O/A/B/8); y exportación de letras individuales (sección 9).
Más: warning `WALL_TOO_THICK` con pared desproporcionada, texto vacío, y
validación de parámetros.

Para 0.2 (tapa frontal, sección 11) se suman: mesh de la tapa válido +
manifold/watertight + counters libres para `A/O/B/8`, rango de Z de la
tapa (`depthMm` → `depthMm+lidMm`), el cuerpo es byte-idéntico con frente
abierto vs. tapa frontal, exportación de letra individual con tapa (2 STL
por letra, `STAMPA` → 12 en el ZIP), exportación de palabra completa con
tapa (`.zip` con `_cuerpo.stl`+`_tapa.stl`), y validación de `lidMm`
(0.4–10 mm solo cuando `frontType === "lid"`).

Verificación manual pendiente (no realizada en esta fase por no contar con
credenciales de una cuenta con acceso Paid): abrir `/stampa-maker/carteles`
autenticado, generar `STAMPA` en Montserrat Bold con los valores por
defecto (100/40/1.6/1.2 mm), rotar/zoomear el preview, descargar el STL y
abrirlo en un slicer (OrcaSlicer/Bambu Studio) para confirmar dimensiones y
huecos visualmente. Ídem el ZIP de letras individuales: confirmar en
Bambu Studio/OrcaSlicer que cada STL abre como una sola pieza (que
"Dividir en objetos" no la separe) y centrada razonablemente en la cama.
Para 0.2: confirmar visualmente la vista explosionada (tapa separada del
cuerpo) y que `_cuerpo.stl`/`_tapa.stl` abren como dos piezas planas que
coinciden en su silueta exterior.

## 9. Exportación de letras individuales

Segunda opción de descarga en `/stampa-maker/carteles` (además de la
palabra completa): **Letras individuales (.zip)**. Usa exactamente las
piezas de `letters[]` que ya devuelve `createLetterGeometry()` — la misma
fuente de verdad que el preview y que `STAMPA.stl` (concatenación de esas
mismas piezas), no un motor de exportación paralelo.

- **Un archivo por carácter, sin espacios.** `textToPerCharacterPaths`
  (`textToPaths.ts`) devuelve un path por carácter con el mismo
  layout/kerning que tendría el string completo (`opentype.Font#getPaths`);
  los caracteres sin tinta (espacios) se descartan antes de numerar.
- **Nombres**: `NN_CARACTER.stl`, índice de 2 dígitos 1-based **entre los
  caracteres exportables** (no la posición original del string, que
  incluiría el espacio). El índice garantiza unicidad aunque el carácter se
  repita (`STAMPA` → `03_A.stl`, `06_A.stl`). Caracteres inválidos para un
  nombre de archivo (`\ / : * ? " < > |`, espacios, control chars) se
  reemplazan por `_` (`exportLettersZip.ts`, `sanitizeFileNameChar`) —no se
  confía en el carácter literal.
- **Recentrado** (`recenterMesh`): cada pieza se traslada restando el
  centro de su propio bounding box en X/Y y su `minZ`, calculados sobre la
  malla real (no sobre el contorno 2D) — así el STL individual no conserva
  la posición que tenía dentro de la palabra (p.ej. la `P` de `STAMPA`, a
  ~430 mm de X dentro del string, queda centrada en `X≈0`) y apoya en
  `Z=0`. Es una traslación pura: no toca normales ni re-triangula nada.
- **ZIP en el cliente** con `jszip` (`buildLettersZipBlob`,
  `downloadLettersZip`): no hay ningún request al backend.
- Cada letra exportada hereda la soldadura de la sección 3 (fondo + repisa
  + pared en un solo sólido), así que sigue siendo 1 connected component
  después de recentrar — verificado en
  `tests/maker-letter-geometry.test.mjs` con un raycast por el counter de
  una "O" recentrada.
- Con tapa frontal (0.2, sección 11) cada letra exporta 2 STL
  (`..._cuerpo.stl` + `..._tapa.stl`), cada uno recentrado por separado —
  ver sección 11.

## 10. Próximos pasos sugeridos (no implementados)

- Más fuentes / catálogo más amplio.
- Ajuste fino de segmentación de curvas (adaptativa por curvatura).
- Mover el pipeline (y/o el armado del ZIP) a un Web Worker si el volumen
  de texto lo justifica.
- Exportación 3MF/OBJ, auto-layout en cama, división según tamaño de cama.
- Encastres/tolerancias para que la tapa frontal (0.2) quede sujeta sin
  pegamento — hoy es una tapa plana para pegar, a propósito (sección 11).
- Todo lo explícitamente fuera de alcance de 0.1/0.2 (LEDs, acrílico, DXF,
  clips/tornillos/imanes, costos, Supabase, etc.) — sin cambios.

## 11. Tapa frontal (0.2)

Segundo modo de frente en `/stampa-maker/carteles`, además del frente
abierto (0.1, sin cambios de comportamiento). Selector **Tipo de frente**:
`Frente abierto` / `Tapa frontal`. Con tapa frontal aparece **Espesor de
tapa** (`lidMm`, default 1.2 mm, validado en 0.4–10 mm) y un selector
**Vista**: `Ensamblada` / `Explosionada`.

### Diseño: pieza separada, no encastre

La tapa es una **pieza independiente del cuerpo**, a propósito (sección 4
del pedido: "esta tapa todavía no encastra" — es una tapa plana para
pegar, sin labios/pestañas/snap-fit/tolerancias). `buildLetterSolid()`
(`createLetterGeometry.ts`) genera:

- `body`: exactamente el mismo sólido soldado de 0.1 (fondo + repisa +
  pared), **sin cambios** — verificado con un test que compara byte a byte
  el cuerpo con frente abierto vs. con tapa frontal, mismos parámetros.
- `lid` (solo si `frontType === "lid"`): la misma silueta que el fondo
  (`fondoGroups` — exterior menos los huecos ORIGINALES del glifo, la
  pieza que 0.1 ya usa para el fondo) extruida como sólido plano
  independiente de `z=depthMm` a `z=depthMm+lidMm`, con tapa en ambos
  extremos (`capStart`+`capEnd`). Nunca un disco: reusar `fondoGroups`
  respeta los counters exactamente igual que el fondo del cuerpo. No
  comparte ningún paso con la generación del cuerpo aparte de esa silueta.

`body` y `lid` se tocan/apoyan en `z=depthMm` (misma silueta exterior) pero
no comparten vértices a propósito — no es una soldadura como la de la
sección 3, es la unión de dos sólidos independientes, cada uno exportable
por separado. La profundidad del cuerpo (`depthMm`) no cambia: la
profundidad total ensamblada es `depthMm + lidMm`.

### Preview: dos objetos 3D separados, nunca una malla fusionada

`MakerViewport.tsx` crea un `THREE.Mesh` para `body` y, si existe, otro
para `lid` — nunca los fusiona en una sola `BufferGeometry` (así la vista
explosionada puede mover solo la tapa). Vista **Explosionada**: desplaza
`lidMesh.position.z` +10 mm — una transformación de escena puramente
visual (no toca `geometry.lid.positions`, no duplica geometría, no afecta
lo que se exporta). Vista **Ensamblada** vuelve `position.z` a 0. El
encuadre de cámara se calcula sobre la posición ensamblada siempre, para
que no salte al cambiar de vista.

### Exportación: nunca mezcladas en un STL ambiguo

- **Letra individual con tapa** (`exportLettersZip.ts`): en vez de
  `NN_CARACTER.stl`, dos archivos — `NN_CARACTER_cuerpo.stl` +
  `NN_CARACTER_tapa.stl`, cada uno recentrado por separado (cada archivo es
  una pieza para imprimir independiente, así que cada uno apoya en `Z=0`
  por su cuenta). `STAMPA` con tapa → 12 STL en el ZIP.
- **Palabra completa con tapa** (`exportWord.ts`, nuevo): en vez de
  `STAMPA.stl`, `STAMPA.zip` con `STAMPA_cuerpo.stl` + `STAMPA_tapa.stl`,
  en las mismas coordenadas del preview (sin recentrar: representan el
  conjunto ensamblado). Con frente abierto, `exportWord()` sigue
  exportando un único `.stl` — mismo comportamiento que 0.1.
- Ambos casos usan `buildSTLBlob()` (sin cambios desde 0.1) sobre
  `body`/`lid` directamente: preview y exportación comparten la misma
  fuente de verdad geométrica (`createLetterGeometry()` → `{body, lid,
  letters[]}` → preview / STL / ZIP), sin un segundo motor.

### Tipos

`LetterSignParams` suma `frontType: "open" | "lid"` y `lidMm: number`.
`LetterPieceResult`/`LetterGeometryResult` pasan de exponer
`positions`/`normals`/`triangleCount` planos a `body: TriangleSoupData` +
`lid: TriangleSoupData | null` (mismo shape `{positions, normals,
triangleCount}`). `geometry.triangleCount` (top-level) sigue existiendo
como `body.triangleCount + (lid?.triangleCount ?? 0)`, para los checks
rápidos de "¿hay algo para exportar?" que ya usaba la UI.

## 12. Tapa encastrable con labio interior (0.3)

Tercer modo de frente en `/stampa-maker/carteles`: **Tapa encastrable**,
además de Frente abierto (0.1) y Tapa frontal (0.2, sin cambios). La tapa
pasa a tener una placa frontal + un labio que entra en la cavidad del
cuerpo con holgura, soldados en una sola pieza (sin booleana 3D).

### Arquitectura: cuerpo / tapa / sistema de unión, tres conceptos separados

`FrontType` (`"open" | "lid"`) no creció: sigue diciendo solo si hay tapa.
Se agregó `LidJoint = "glue" | "interior-lip"`, independiente, que dice
*cómo* se une la tapa al cuerpo cuando `frontType === "lid"`. "Tapa plana"
de 0.2 es `lidJoint: "glue"` (código sin tocar); la nueva es
`lidJoint: "interior-lip"`. Un futuro sistema de unión (clips, imanes,
tornillos) sería un valor más de `LidJoint`, no una nueva rama de
`frontType` ni un enum combinado cuerpo×tapa×encastre desparramado por la
app.

Módulos nuevos:

- `src/lib/maker/geometry/joints/interiorLip.ts` — el "sistema de
  encastre": `fitInteriorLip()` deriva la huella 2D del labio a partir de
  la MISMA cavidad que ya delimita el cuerpo (núcleo erosionado por
  `wallMm`, la pared interior real — no un cuerpo especial), erosionada
  `clearanceMm` (posiciona el labio) y reducida a un ANILLO perimetral de
  espesor `lipWallMm` (ver sección 12.4 — corrección 0.3.1: no toda esa
  región, solo su perímetro). No sabe nada de Z ni de extrusión.
- `src/lib/maker/geometry/lid.ts` — el concepto "tapa": arma la
  `ExtrudedMeshData` de la tapa de un carácter. Contiene el único
  `if`/switch sobre `lidJoint` de todo el pipeline (placa plana vs.
  placa+labio), en un solo lugar.

`createLetterGeometry.ts` (`buildLetterSolid`) genera el cuerpo exactamente
igual para los 3 modos de frente — no hay un cuerpo especial para el
encastre.

### Convención de holgura: por lado, sin dividir por dos

`clearanceMm` se pasa directo como `insetMm` a `insetContourGroups`: cada
borde del labio queda erosionado esa distancia exacta desde la cavidad. Un
`clearanceMm = 0.20` da ~0.20 mm de separación física en cada lado, no
0.10 mm total.

### Posición Z

Con `depthMm`, `insertDepthMm` (profundidad de encastre, 0.5–20 mm,
default 3 mm) y `lidMm` (espesor de placa, igual que en 0.2):

```
body:   0 -> depthMm                              (sin cambios)
labio:  depthMm - insertDepthEfectivo -> depthMm
placa:  depthMm -> depthMm + lidMm
```

`insertDepthEfectivo` es `insertDepthMm` acotado a `[0, depthMm - baseMm]`
(la cavidad real disponible: por debajo de `baseMm` el cuerpo es la base
maciza). Si se acota, se informa con el warning `INSERT_DEPTH_CLAMPED`
(sección 12.3).

### Placa + labio: una sola pieza soldada, sin booleana 3D

Mismo mecanismo que ya suelda fondo/repisa/pared del cuerpo (grilla
compartida 0.0001 mm + jitter determinístico en `extrudePolygon.ts`), con
4 piezas por letra: paredes+tapa superior de la placa (silueta completa,
sin tapar la cara inferior), repisa de la placa (tapa la cara inferior
donde NO hay pared de labio — desde 0.3.1 esto incluye el centro vacío
detrás de la placa, no solo el borde exterior, mirando hacia -Z), paredes
del ANILLO del labio (sigue ambos bordes del anillo; sin tapa en ninguno
de los dos extremos) y tapa de la punta del labio (mirando hacia -Z).
Comparten coordenadas exactas en cada frontera → 1 solo componente
conectado, verificado con `countConnectedComponents` (igual que el
cuerpo). Los counters (huecos originales del glifo) quedan libres tanto en
la placa como en el labio: ninguna pieza los tapa. Para un trazo anular
(p.ej. "O") el anillo da naturalmente 2 bandas separadas y la repisa 3
regiones separadas — mismo mecanismo de multi-`ContourGroup` que ya usa el
resto del pipeline, sin lógica especial por letra.

### 12.1 Cuando el labio es imposible: colapso, no geometría corrupta

`fitInteriorLip()` devuelve `collapsed: true` para un contorno en dos
casos, ninguno de los dos se degrada en silencio a una placa maciza (ver
12.3, `LIP_COLLAPSED` es un ERROR):

1. La fit region (cavidad erosionada por `wallMm` + `clearanceMm`)
   desaparece por completo — trazo muy fino, holgura excesiva, letra muy
   chica: no hay dónde poner un labio.
2. La fit region existe, pero `lipWallMm` es tan grande respecto a su
   ancho que el vacío CENTRAL del anillo (sección 12.4) desaparece — el
   "labio" pasaría a ser la fit region completa, macizo. Es exactamente el
   problema que corrige 0.3.1, así que se trata igual: error, no placa
   gruesa silenciosa.

En ambos casos `lid.ts` no rompe: la placa queda maciza SOLO en esa zona
(mismo resultado visual que la tapa plana ahí), sin labio para ese
contorno — pero el resultado completo queda marcado inválido para
exportar.

### 12.2 Preview

`MakerViewport.tsx` no necesitó cambios: trata `geometry.lid` como una
malla opaca (placa+labio ya combinados en el mismo `TriangleSoupData`), y
la vista explosionada desplaza esa malla completa como una sola tapa. El
preview sigue mostrándose aunque el resultado tenga errores geométricos
(sección 12.3) — ayuda a entender qué ajustar.

### 12.3 Errores vs. warnings (hardening, misma sesión)

`LetterGeometryResult` distingue `errors` de `warnings` (mismo shape
`LetterGeometryWarning[]`, sin sistema paralelo):

- **`errors`**: el modelo generado NO debería exportarse. Hoy el único
  caso es `LIP_COLLAPSED` — una tapa pedida como "encastrable" sin
  encastre funcional en una o más letras. Un mensaje por letra afectada
  (carácter + posición 1-based entre caracteres exportables, p.ej. `El
  encastre no puede generarse en la letra "S" (posición 1)...`), no un
  selector complejo de errores.
- **`warnings`**: el modelo es exportable pero hubo un ajuste o situación
  relevante (`WALL_TOO_THICK`, `INSERT_DEPTH_CLAMPED`). El mensaje de
  `INSERT_DEPTH_CLAMPED` informa el valor solicitado y el efectivo (p.ej.
  `Profundidad de encastre ajustada de 20 mm a 4 mm...`).

Los 3 caminos de exportación (`exportWord.ts`: `exportWord()` y
`buildWordZipBlob()`; `exportLettersZip.ts`: `buildLettersZipBlob()` y
`downloadLettersZip()`) rechazan (`throw`) si `result.errors.length > 0` —
misma fuente de verdad, sin ruta alternativa que ignore el error.
`exportLettersZip.ts` pasó a recibir el `LetterGeometryResult` completo
(antes solo `letters[]`) para poder leer `errors`. En la UI,
`MakerTextControls.tsx` muestra los errores en un bloque distinto de los
warnings ("Diseño no listo para exportar") y `canDownload` (`page.tsx`)
exige `geometry.errors.length === 0` — los botones de descarga quedan
deshabilitados mientras persista el error, sin ocultarlo ni convertir la
tapa encastrable en tapa plana automáticamente.

### 12.4 Corrección 0.3.1: el labio es un anillo perimetral fino, no un relleno macizo

**Error conceptual de la primera implementación (0.3):** el labio ocupaba
TODA la fit region (cavidad erosionada por `wallMm` + `clearanceMm`)
extruida hacia atrás durante `insertDepthMm`. Con `lidThickness=0.6mm` +
`insertDepth=1.4mm`, buena parte de la tapa terminaba con ~2.0mm de
material — inaceptable para cartelería luminosa, donde la placa frontal
debe permanecer fina para dejar pasar/difundir la luz.

**Corrección:** nuevo parámetro `lipWallMm` (espesor de pared del labio,
0.4–3mm, default 0.8mm, independiente de `lidMm`/`insertDepthMm`/
`clearanceMm`/`wallMm` del cuerpo). El footprint del labio pasa a ser:

```
fitRegion  (cavidad + clearance, como antes)
    -
inset(fitRegion, lipWallMm)
    =
anillo/marco del labio (footprint real, sección 3 de fitInteriorLip)
```

Mismo patrón que ya usa el cuerpo para su propia pared (`ink - inset(ink,
wallMm)`, ver sección 3) — reutilizado vía `differenceRawPaths` (nueva
función en `offsets.ts`, factoriza la lógica que ya usaba
`differenceContourGroups`, sin duplicarla). Para un trazo simple ("I") el
anillo es 1 marco; para un trazo anular ("O") son 2 bandas separadas
(exterior + interior), con un VACÍO real entre ambas — exactamente la
sección transversal descripta en el pedido. La placa (`lidMm`) se apoya
sobre TODO el footprint de la placa; solo donde pasa el anillo hay además
labio por debajo — el resto (incluido el centro vacío detrás de la placa)
queda con exactamente `lidMm` de espesor, nunca `lidMm + insertDepthMm`.
Test dedicado: `tests/maker-letter-geometry.test.mjs`, "la zona vacía
detrás de la placa mide solo lidThickness, nunca lidThickness+insertDepth"
(raycast en el centro del vacío, verifica que los únicos impactos estén en
`[depthMm, depthMm+lidMm]`).

La convención de holgura (`clearanceMm` por lado, sin dividir por dos) no
cambió: se aplica ANTES de calcular el anillo (paso 2 de `fitInteriorLip`,
posiciona el labio), `lipWallMm` actúa DESPUÉS, sobre el resultado (paso
3, da espesor al anillo).

## 13. Viewport 3D: altura en desktop (0.3.1)

El visor (`MakerViewport.tsx` dentro de un `<Card>` en
`carteles/page.tsx`) tenía una altura fija chica (`min-h-[420px]`), dando
una proporción de banner horizontal en desktop — insuficiente para una
herramienta tipo CAD. El `<Card>` que envuelve el viewport ahora fija su
altura con `clamp()` responsivo en vez de un mínimo fijo:

```
mobile:  h-[clamp(400px,60vh,500px)]
desktop: lg:h-[clamp(650px,75vh,750px)]
```

El panel de controles (`MakerTextControls`) sigue a la izquierda con su
altura natural (`lg:items-start` en el grid, sin cambios); el viewport a
la derecha gana altura de forma independiente, sin dejar una zona vacía
debajo. `MakerViewport.tsx` no necesitó cambios internos (ya usaba
`h-full w-full`, hereda la altura del `<Card>` padre vía `ResizeObserver`,
que ya reencuadra cámara/renderer en cada resize).

## 14. Stampa Maker 0.4 — Sistemas de cuerpo y frente

Sprint grande, implementado en 6 etapas geométricas internas + UI/export,
cada una validada con tests antes de continuar a la siguiente (81 tests al
empezar → 162 al cerrar la Etapa 6, todos en
`tests/maker-letter-geometry.test.mjs`).

### 14.1 Arquitectura (Etapa 1)

`LetterSignParams` se mantiene como una única interfaz plana (mismo
estilo que 0.1-0.3.1: todos los campos conviven en el objeto, solo los
relevantes al modo activo se usan/validan). La modularidad pedida
("distinguir BODY/FRONT/JOINT/MODIFIERS/PATTERN, sin `if` dispersos") vive
en la estructura de módulos, no en el shape de los tipos:

```
src/lib/maker/geometry/
  body/
    index.ts            único switch (params.bodyType) del proyecto
    standard.ts          cuerpo standard (fondo+repisa+pared, 0.1-0.3.1 sin cambios)
                          + integra costillas/bisel/canal (ver más abajo)
    tapered.ts            cuerpo tapered (14.3)
    shared.ts             computeWallAndCore: cavidad oculta, reusada por standard/tapered
    modifiers/
      ribs.ts              costillas laterales (14.2)
      bevel.ts             bisel frontal interior (14.4)
  front/
    index.ts            único switch (params.frontType) del proyecto
    perforated.ts         frente perforado + difusor (14.5)
    lightChannel.ts        canal luminoso + difusor de canal (14.6)
  patterns/
    circles.ts             patrón de círculos (14.5), sin registry
  joints/
    interiorLip.ts         sin cambios (0.3)
  lid.ts                    sin cambios (0.2/0.3), lo llama front/index.ts
```

**Resultado como lista de piezas, no campos fijos.** `LetterGeometryResult`/
`LetterPieceResult` pasan de `{body, lid}` a `parts: SignPart[]`
(`{kind, filenameSuffix, mesh}`, `PartKind = "body" | "lid" | "mask" |
"diffuser" | "channelDiffuser"`). Necesario porque 14.5/14.6 agregan piezas
que no encajan en un par fijo. `exporters/parts.ts#partFileEntries` es el
único lugar que decide nombres de archivo (`<base>.stl` con 1 pieza,
`<base>_<sufijo>.stl` por pieza con 2+) — `exportWord.ts` y
`exportLettersZip.ts` lo reusan en vez de tener cada uno su propio
`if (piezas > 1)`. `MakerViewport.tsx` reemplaza los 2 refs fijos
(`bodyMeshRef`/`lidMeshRef`) por un `Map<PartKind, THREE.Mesh>` + tabla de
colores por kind; la vista explosionada apila cada pieza no-"body" por su
posición entre las piezas presentes (1 pieza extra → mismo +10mm de
siempre; 2 piezas extra → +10mm/+20mm).

Motor geométrico sin cambios: `extrudePolygon.ts`, `contourHierarchy.ts`,
`textToPaths.ts` no se tocaron. `offsets.ts` ganó funciones nuevas
(`outsetContourGroups` — offset positivo, dilata material;
`isPointInsideContourGroups` — point-in-region correcto con huecos;
`cleanContourGroups`, `contourGroupsToRawPaths`, `pointsToRawPath`), todas
aditivas, sin tocar las firmas existentes.

### 14.2 Costillas laterales (Etapa 2)

`ribsCount: 0 | 1 | 2` (default 0), `ribProtrusionMm` (default 0.8),
`ribWidthMm` (default 1.2). 1 costilla al medio de `[baseMm, depthMm]`; 2
en 1/3 y 2/3 — sin parámetro de posición expuesto. `body/modifiers/ribs.ts`:
en la banda, el contorno se dilata (`outsetContourGroups`: exterior crece,
huecos se achican — el montículo sobresale hacia afuera Y hacia el
counter) sobre la pieza "fondo" (piece1) del cuerpo — la cavidad oculta
(piece2/3) y el frente (piece4) no cambian, porque la costilla es un
relieve de la superficie VISIBLE, no de la cavidad de ahorro de material.
Escalones horizontales (mismo patrón que la repisa del núcleo erosionado)
sueldan la transición pared plana ↔ costilla sin CSG.

### 14.3 Cuerpo tapered (Etapa 3)

`bodyType: "standard" | "tapered"`, `rearExpansionMm` (default 2, solo
tapered). La silueta exterior/de counters crece progresivamente desde el
frente (z=depthMm, offset 0 — nominal, compatible con frente/tapa sin
cambios) hacia la base (z=0, offset `rearExpansionMm`). `body/tapered.ts`
aproxima el offset progresivo con ~8-20 tramos rectos apilados (banda
objetivo 2mm), anclados por su extremo inferior (más ancho) — sin escalón
en la base, con un escalón final exacto contra el contorno original para
empalmar con el frente. La cavidad oculta y la interfaz con frente/tapa
usan el contorno original sin cambios.

**Limitación conocida**: tapered no soporta combinarse con costillas
(`ribsCount` se ignora si `bodyType === "tapered"`) ni con bisel — fuera de
alcance de este sprint.

### 14.4 Bisel frontal interior (Etapa 4)

`bevelEnabled` (default false), `bevelDepthMm` (default 2), `bevelInsetMm`
(default 1). Banda pegada al frente donde la pared (exterior y counters)
se erosiona progresivamente (`insetContourGroups`, mismo mecanismo
uniforme) desde 0 en `depthMm-bevelDepthMm` hasta `bevelInsetMm` en
`depthMm` — mismo patrón de sub-bandeo que el tapered, con signo opuesto y
acotado al frente. Costillas y bisel pueden combinarse: el rango de
costillas se acota automáticamente para no superponerse con la banda del
bisel (`ribsCeilingMm` en `body/standard.ts`).

Sin sistema de materiales todavía (fuera de alcance de 0.4): la región de
bisel es geometría normal, identificable solo por su rango Z.

### 14.5 Frente perforado + difusor plano + patrón de círculos (Etapa 5)

`frontType: "perforated"`. Campos: `maskThicknessMm` (1), `diffuserThicknessMm`
(0.6, compartido con 14.6), `holeDiameterMm` (2), `pitchMm` (4, CENTRO A
CENTRO), `edgeMarginMm` (2). `front/perforated.ts` genera 2 piezas
siempre separadas: `diffuser` (misma silueta que la tapa plana, sin
perforar) y `mask` (misma silueta, perforada). `patterns/circles.ts#punchCirclePattern`
recorta una grilla de círculos contra la región seguro (erosionada por
`edgeMarginMm + holeDiameterMm/2`, así el círculo COMPLETO respeta el
margen) usando `isPointInsideContourGroups` (correcto con huecos — ver
14.8) — nunca bounding boxes.

### 14.6 Canal luminoso interior + difusor de canal (Etapa 6)

`frontType: "light-channel"`. Campos: `channelWidthMm` (6), `channelDepthMm`
(4), `channelOffsetMm` (2), `diffuserClearanceMm` (0.2, + `diffuserThicknessMm`
compartido). A diferencia de los demás frentes, asume un **cuerpo macizo**
(sin la cavidad interior hueca de ahorro de material): "el resto del
frente permanece opaco/negro" solo tiene sentido si hay material sólido
detrás, no un anillo fino de `wallMm`. `body/standard.ts` detecta
`frontType === "light-channel"` (única excepción documentada a "body no
lee frontType", ver su comentario) y: usa la silueta completa como
footprint de partida, omite la repisa/paredes del núcleo (piezas 2/3), y
talla el canal como una cavidad desde el frente — `channelGroups =
inset(ink, offset) - inset(ink, offset+width)` — con piso sólido a
`channelDepthMm` del frente (nunca atraviesa el cuerpo) y paredes internas
propias. `front/lightChannel.ts` arma el difusor del canal (inset del
canal por `diffuserClearanceMm`, pieza independiente a ras del frente).

Colapso (`CHANNEL_COLLAPSED`, error — igual mecanismo que `LIP_COLLAPSED`):
un trazo demasiado fino para el ancho de canal pedido no genera geometría
corrupta, bloquea la exportación de esa letra. `channelDepthMm` se acota a
la cavidad disponible (`CHANNEL_DEPTH_CLAMPED`, warning) igual que
`insertDepthMm`.

### 14.7 UI, preview y exportación (Etapas 7-9)

`MakerTextControls.tsx`: reemplaza el selector de 3 vías (frontType+lidJoint
combinados) por controles contextuales — `CUERPO` (Estándar/Tapered +
expansión), `Modificadores` (costillas: toggle + cantidad + protrusión/
ancho; bisel: toggle + profundidad/desplazamiento), `FRENTE` (4 vías:
Abierto/Tapa completa/Perforado/Canal luminoso) y, contextual a la
elección de frente: `Encastre` (solo con Tapa completa) o los campos
propios de Perforado/Canal luminoso. El botón de descarga muestra
`.zip`/`.stl` según `frontType !== "open"` (generaliza el check existente
a los 2 frentes nuevos). Exportación y preview ya eran genéricos por
partes desde la Etapa 1 (14.1) — no necesitaron cambios adicionales.

**Verificación manual pendiente**: igual que 0.1-0.3.1, no se pudo abrir
`/stampa-maker/carteles` en el navegador durante esta sesión por no contar
con credenciales de una cuenta con acceso Paid (el middleware redirige a
login sin sesión). Verificado en su lugar: `npx tsc --noEmit` limpio y
`npm run build` exitoso (incluye `/stampa-maker/carteles` como ruta
estática), más los 162 tests del pipeline geométrico.

### 14.8 Limitaciones conocidas

- **Tapered no combina con costillas ni bisel** (14.3) — combinación fuera
  de alcance, `ribsCount`/`bevelEnabled` se ignoran silenciosamente si
  `bodyType === "tapered"`.
- **Earcut + muchos huecos cercanos: artefactos numéricos benignos.** Con
  el patrón de círculos (14.5, cientos de huecos en una sola máscara),
  earcut puede elegir algún "puente" hueco-a-hueco cuyo triángulo resultante
  tiene área genuinamente ~0 (no una grieta ni una superposición) —
  `TriangleSoupData` usa `Float32Array`, y ese triángulo puede colapsar a
  colineal recién al redondear. No afecta manifold/watertight/volumen
  real (verificado explícitamente en los tests, sin tolerancia); solo se
  permite una tolerancia acotada (`MAX_BENIGN_DEGENERATE_TRIANGLES = 30`)
  en el conteo de triángulos degenerados de la máscara, documentada en el
  test en vez de ocultada. Se investigó (`Math.fround` antes de
  triangular, aumentar el jitter) sin una solución robusta a esta densidad
  de huecos sin arriesgar romper la soldadura en otras piezas — ver
  historial de la sesión de implementación.
- **Canal luminoso + letras con features complejas cerca del canal** (14.6,
  p.ej. la pata diagonal de una "R"): mismo tipo de límite del
  triangulador que el punto anterior, pero en la tapa del frente del
  cuerpo (`silueta menos canal`) — puede dejar un puñado de aristas de
  borde (`MAX_BENIGN_BOUNDARY_EDGES = 10` en el test), no una grieta de
  espesor significativo.
- **Sin sistema de materiales/3MF** (bisel, máscara/difusor, canal): las
  regiones pensadas para pintar/imprimir en blanco son geometría normal,
  identificable solo por su rango Z o su `PartKind` — asignación de
  material multi-color queda fuera de alcance de 0.4, como en versiones
  anteriores.

## 15. Stampa Maker 0.4.1 — Corrección geométrica

Iteración CORRECTIVA: cuatro errores de interpretación geométrica
detectados al probar visualmente lo implementado en 0.4 (los tests pasaban,
pero la forma física no era la esperada). Prioridad explícita: **forma
física correcta por sobre cantidad de tests**. No se agregaron familias de
carteles ni patrones nuevos — misma arquitectura modular `body/front/
patterns/parts`, mismo `SignPart[]`/export genérico, sin regresiones en
los sistemas anteriores (cuerpo standard, labio interior, tapa plana,
frente abierto, canal luminoso).

### 15.0 Herramienta compartida: perfiles de offset por bandas

Antes de las 4 correcciones puntuales, `body/shared.ts` ganó un mecanismo
genérico que las cuatro reusan (en vez de que cada modificador reimplemente
su propia aproximación por sub-bandas, como pasaba en 0.4):

- `subdivideRange(z0, z1, resolutionMm, minSteps, maxSteps)`: sub-bandas de
  altura objetivo `resolutionMm` (referencia 0.2mm en todos los usos de
  0.4.1), acotadas por un piso/techo de pasos para no explotar en rangos
  grandes.
- `footprintAtOffset(group, offsetMm)`: footprint de `group` desplazado
  `offsetMm` con signo — positivo dilata (`outsetContourGroups`), negativo
  erosiona (`insetContourGroups`) — unifica ambos detrás de una sola firma.
- `buildOffsetProfileWallPieces(group, zPoints, offsetAt)`: aproxima una
  pared cuyo footprint sigue un perfil de offset arbitrario en Z. Cada
  sub-banda se extruye con sección constante = el footprint del extremo MÁS
  ANCHO del par; el extremo angosto se resuelve con un escalón horizontal
  (mismo patrón de soldadura por coordenadas compartidas que ya usaba el
  tapered/bisel de 0.4, generalizado).
- `buildBandedOuterWallPieces(group, z0, z1, bands: ZBand[])`: combina
  varias bandas de modificador (costillas + bisel frontal + bisel lateral)
  en una sola pasada, sin que compitan por el mismo tramo de Z — reemplaza
  las dos llamadas separadas que `body/standard.ts` hacía en 0.4.
- `raisedCosineProfile(t, peakMm)`: perfil "montículo" (media onda coseno,
  0 en t=0, `peakMm` en t=0.5, 0 en t=1) — usado por costillas (peak
  positivo) y bisel lateral (peak negativo).
- `smoothstepRampProfile(t, endMm)`: perfil "rampa suave" (smoothstep,
  3t²-2t³) con pendiente 0 en ambos extremos — usado por tapered suave y
  bisel frontal suave.

**Bug encontrado al implementar el tapered suave, corregido acá:** en los
tramos CHATOS de un perfil suave (los extremos de un smoothstep, pendiente
~0), muchos z-samples consecutivos piden un offset casi, pero no
exactamente, igual (diferencias de centésimas de mm). Sin cuantizar, cada
uno disparaba su propio cálculo de Clipper y el escalón entre ambos
(`differenceContourGroups`) podía terminar siendo un anillo válido pero
extremadamente fino, que earcut no siempre trianguló de forma manifold en
letras con trazos próximos entre sí (reproducido con "B" tapered suave:
153 aristas abiertas). Fix: `buildOffsetProfileWallPieces` cuantiza el
offset a 0.01mm antes de pedir su footprint (con cache), así que
z-samples casi-iguales piden EXACTAMENTE el mismo offset → el mismo
footprint cacheado → un escalón EXACTAMENTE vacío, en vez de un anillo
casi-nulo. Beneficia a los cuatro usos (costillas, tapered suave, bisel
frontal suave, bisel lateral) por igual.

### 15.1 Costillas: de prisma a montículo progresivo

**Problema (spec):** la costilla se veía como un "camino rectangular"
extruido abruptamente desde la pared — protrusión completa de golpe al
entrar a la banda, y de vuelta a golpe al salir.

**Corrección:** perfil matemático `raisedCosineProfile` — media onda
coseno: `protrusion(t) = ribProtrusionMm * (0.5 - 0.5*cos(2πt))`, con `t`
normalizado a `[0,1]` dentro de la banda. En `t=0` (borde de la banda) da
0 exacto (empalma al ras con la pared normal, sin escalón); en `t=0.5`
(mitad de la banda) da el máximo; en `t=1` vuelve a 0. Aproximado con
sub-bandas de `subdivideRange` (resolución 0.2mm, 8-60 pasos según el
ancho de costilla) vía `buildOffsetProfileWallPieces`. `ribs.ts` pasó de
exponer `buildRibbedOuterWallPieces` (construía la pared completa) a
exponer sólo `computeRibBands` (posición, sin cambios) +
`ribBandsToZBands` (banda → perfil), reusado por
`body/standard.ts#buildBandedOuterWallPieces` junto con bisel/bisel
lateral.

1 costilla y 2 costillas siguen siendo montículos independientes (no se
fusionan salvo que los parámetros sean geométricamente incompatibles, sin
cambios). El offset sigue afectando exterior Y counters a la vez
(`footprintAtOffset`, mismo mecanismo uniforme que 0.4).

### 15.2 Tapered: dos estilos, `stepped` y `smooth`

`BodyType` no cambió; se agregó `TaperStyle = "stepped" | "smooth"`
(`params.taperStyle`, sólo se usa/valida si `bodyType === "tapered"`).

- **`stepped`** (default, sin cambios de comportamiento respecto a 0.4):
  bandas grandes (~2mm, mínimo 8), perfil LINEAL — el aspecto escalonado
  es un estilo a propósito, no un defecto a esconder.
- **`smooth`**: mismo destino (0 en el frente, `rearExpansionMm` en la
  base), pero con `subdivideRange` a resolución 0.2mm (10-120 pasos —
  acotado para no pasar de ~120 pasos incluso en cuerpos profundos, "no
  explotar polígonos" por sobre mantener 0.2mm exacto) + perfil
  `smoothstepRampProfile` en vez de lineal. Ambos estilos comparten la
  misma construcción (`buildOffsetProfileWallPieces`, anclado por el
  extremo más ancho) — sólo cambian los breakpoints y la función de
  offset.

La transición se sigue aplicando a exterior Y counters a la vez (mismo
`footprintAtOffset` de siempre), verificado explícitamente para "smooth"
igual que ya se verificaba para "stepped".

### 15.3 Bisel frontal: suavizado + continuidad con la tapa

**Problema (spec):** el bisel se percibía "demasiado segmentado" y no se
aplicaba coherentemente a la tapa (tapa de tamaño nominal sobresaliendo de
un cuerpo ya biselado).

**Corrección — suavizado:** mismo mecanismo que el tapered suave:
resolución fina (0.2mm, 10-150 pasos) + `smoothstepRampProfile` en vez de
las sub-bandas de 0.5mm con interpolación LINEAL de 0.4. `bevel.ts` pasó
de exponer `buildBeveledOuterWallPieces` a exponer `bevelBandToZBand`
(banda → perfil), reusado junto con costillas/bisel lateral en
`buildBandedOuterWallPieces`. `beveledFrontFootprint` (footprint del
frente cuando hay bisel) no cambió de comportamiento — sigue siendo
`footprintAtOffset(group, -bevelInsetMm)`, ahora también reusado por la
tapa (ver abajo).

**Corrección — continuidad con la tapa:** `geometry/lid.ts` ganó
`bevelPlateInsetMm(params)` — 0 si no hay bisel activo o `bodyType` no es
`"standard"` (el bisel no aplica con tapered, sin cambios); si hay bisel,
el mismo `bevelInsetMm` que angosta el borde real del cuerpo. La tapa
(plana **y** encastrable) usa `footprintAtOffset(group, -plateInsetMm)`
para su propia silueta (exterior Y counters) en vez de la silueta nominal
— así el borde de la tapa queda exactamente del mismo tamaño que el borde
real que deja la pared biselada, sin escalón ni voladizo. Para la tapa
encastrable, esto obligó a mover el cálculo de placa+labio a un único loop
por contorno original (antes recibía `plateGroups` ya armado desde afuera):
el labio se posiciona sobre la cavidad REAL (`wallMm`, ajena al bisel — el
bisel sólo angosta la silueta visible cerca del frente, nunca la cavidad
oculta), pero la "repisa" (huella de la placa menos el anillo del labio)
necesita la huella de placa YA angostada del mismo contorno para no
desalinearse.

**Hardening:** si el bisel erosiona toda la placa para alguna letra
(trazo muy fino + bisel grande), nuevo código `BEVEL_PLATE_COLLAPSED`
(mismo patrón que `LIP_COLLAPSED`/`CHANNEL_COLLAPSED`) bloquea la
exportación con un mensaje por letra, en vez de degradarse en silencio.

### 15.4 Bisel lateral / doble bisel (nuevo modificador)

Modificador SEPARADO del bisel frontal — spec: "FRONT BEVEL modifica el
borde frontal. DOUBLE/LIGHT BEVEL genera una cintura en mitad de la
pared", no deben confundirse. Nombre elegido: `grooveEnabled` (+
`grooveInsetMm`, `grooveWidthMm`, `groovePositionMm`) — "groove" en vez de
"lightBevel"/"doubleBevel" por ser el término técnico más directo para
una cintura/canal tallado en una pared, evitando la palabra "bevel"
repetida en dos conceptos distintos.

- `grooveWidthMm`: extensión total en Z de la banda (entra + vuelve a
  salir).
- `groovePositionMm`: distancia desde el FRENTE (`z=depthMm`) hasta el
  CENTRO de la banda — misma convención "medida desde el frente" que
  `bevelDepthMm`.
- `grooveInsetMm`: desplazamiento máximo hacia adentro, en el centro de la
  banda.

Geometría (`body/modifiers/groove.ts`): perfil `raisedCosineProfile(t,
-grooveInsetMm)` — el MISMO montículo que las costillas, con el pico en
signo NEGATIVO (erosiona en vez de dilatar): 0 en el borde de la banda,
máxima erosión a mitad de banda, 0 en el otro borde — "entra
progresivamente, alcanza el máximo, vuelve a salir", sin un modificador
nuevo de construcción, sólo un signo distinto sobre la misma
infraestructura de bandas.

**Combinación con costillas/bisel frontal:** `body/standard.ts` computa
las tres bandas (costillas, bisel frontal, bisel lateral) y las combina en
una sola pasada por `buildBandedOuterWallPieces`. Las costillas ceden
lugar tanto al bisel frontal (sin cambios de 0.4) como al bisel lateral
(nuevo: cualquier banda de costilla que se superponga con la banda del
bisel lateral se descarta, mismo criterio). Bisel frontal + bisel lateral,
en cambio, NO se resuelven automáticamente si se superponen —
`validateLetterSignParams` bloquea la combinación con un mensaje claro en
`groovePositionMm` (el pedido explícita permite esto: "no hace falta
permitir todas las combinaciones si inicialmente generan conflictos
geométricos... validarla/bloquearla claramente"). Sin superposición,
ambos activos a la vez es una combinación válida y probada.

### 15.5 Frente perforado — orden explosionado corregido

**Problema (spec):** el orden físico correcto, del observador hacia
atrás, es MÁSCARA → DIFUSOR → CUERPO; la vista explosionada invertía la
separación entre máscara y difusor.

**Causa de raíz:** `createLetterGeometry.ts#PART_ORDER` listaba `"mask"`
antes que `"diffuser"`; `MakerViewport.tsx` asignaba el salto de
explosión (`EXPLODE_OFFSET_MM * índice`) recorriendo `geometry.parts` en
ESE orden — el difusor (más cerca del cuerpo en la vista ensamblada)
terminaba con un salto MENOR que la máscara (más lejos), invirtiendo su
separación relativa en la vista explosionada.

**Corrección (dos partes, ninguna toca coordenadas de exportación):**

1. `PART_ORDER` pasa a `["body", "lid", "diffuser", "mask",
   "channelDiffuser"]` — refleja el orden físico real.
2. `MakerViewport.tsx` deja de asignar el salto por orden de recorrido:
   ahora calcula `explodeRankRef` a partir de la posición Z REAL de cada
   pieza (`meshMinZ`, sólo lee `positions`) — la pieza más cerca del
   cuerpo recibe el salto más chico, la más lejana el más grande, sin
   importar en qué orden aparezcan en `geometry.parts`. El rank se
   calcula una vez (cuando cambia `geometry`) y se reusa tanto al crear
   los meshes como al alternar Ensamblada/Explosionada, así no hay
   ninguna dependencia oculta del orden del array.

### 15.6 Frente perforado — máscara como carcasa con faldón lateral

**Problema (spec):** la máscara era sólo una placa plana; debía funcionar
como una carcasa que también cubre lateralmente parte del cuerpo.

**Parámetros nuevos** (sólo se usan/validan si `frontType === "perforated"`):

| Campo | Rol | Default | Rango |
|---|---|---|---|
| `maskThicknessMm` | espesor de la CARA frontal (ya existía, redocumentado) | 1mm | 0.4-5mm |
| `maskWallThicknessMm` | espesor de la pared del faldón lateral | 1.2mm | 0.4-5mm |
| `maskSideDepthMm` | cobertura lateral, medida desde el frente hacia atrás | 5mm | 0-depthMm |
| `maskClearanceMm` | holgura por lado entre el faldón y la silueta real del cuerpo | 0.2mm | 0-2mm |

No se reutilizó `lidJoint`: es un concepto de unión cuerpo↔tapa, no de
carcasa↔cuerpo (spec: "NO reutilizar lidJoint de manera conceptualmente
incorrecta").

**Geometría** (`front/perforated.ts`, reescrito):

```
outerGroups  = footprintAtOffset(group, maskClearanceMm + maskWallThicknessMm)
innerGroups  = footprintAtOffset(group, maskClearanceMm)
skirtRingGroups = differenceContourGroups(outerGroups, innerGroups)  // SIN limpiar (ver más abajo)
```

`outerGroups` (exterior Y counters crecidos uniformemente, mismo mecanismo
`footprintAtOffset` que costillas/tapered) es la huella de la CARA
frontal perforada — no la silueta original: cubre exterior, concavidades
y counters con holgura+espesor de pared, sin bounding boxes.
`skirtRingGroups` (el faldón) es el anillo entre ambas huellas — para un
trazo anular ("O") da naturalmente 2 bandas (una hugging el exterior, otra
hugging el counter), mismo patrón multi-`ContourGroup` que el resto del
pipeline (labio interior, costillas), sin lógica especial por letra: así
el faldón cubre "perímetro exterior; concavidades; counters/interiores"
sin distinguir casos.

El faldón se extruye desde `maskZ0 - maskSideDepthUsedMm` hasta `maskZ0`
(donde empieza la cara), **con tapa en AMBOS extremos**
(`capStart`+`capEnd`): es un anillo (footprint con "hoyo"), no un disco,
así que necesita su propia tapa en cada extremo para ser watertight por sí
solo. La tapa de la cara (que cubre el disco COMPLETO de `outerGroups`,
incluida el área que ocupa el faldón) termina coincidiendo exactamente con
la tapa superior del faldón en `z=maskZ0`: redundante (dos superficies en
el mismo plano) pero no rompe manifold/watertight — mismo criterio que el
resto de las piezas del frente (cuerpo/tapa/máscara/difusor se TOCAN sin
fusionarse a propósito). Lo que conecta cara y faldón en 1 solo componente
son las coordenadas EXACTAMENTE compartidas del borde exterior/de cada
counter en `z=maskZ0`.

**Bug encontrado al implementar esto, corregido en `patterns/circles.ts`:**
`punchCirclePattern` limpiaba su salida con `CleanPolygons`
(`cleanContourGroups`) antes de 0.4.1 — inofensivo cuando la máscara era
una pieza plana independiente ("no suelda con nada", comentario original),
pero rompía la soldadura cara↔faldón: `CleanPolygons` puede alterar
levemente el borde exterior/de counter (hasta `CLEAN_TOLERANCE_MM=0.005mm`),
y ese borde es justo el que necesita coincidir EXACTO con
`skirtRingGroups`. Reproducido con "O"/"B"/"8": 452/243/457 aristas
abiertas. Fix: se quitó `cleanContourGroups` de `punchCirclePattern` (ya
no limpia su salida, mismo criterio que `differenceContourGroups` en el
resto del pipeline desde 0.3.1) — el triángulo degenerado ocasional que
esto podía producir con muchos agujeros cercanos ya está cubierto por el
jitter determinístico de `extrudePolygon.ts` y tolerado explícitamente en
los tests (`MAX_BENIGN_DEGENERATE_TRIANGLES`).

**Cobertura:** `maskSideDepthMm` se acota una sola vez en
`createLetterGeometry.ts` contra `depthMm` completo (el faldón cubre el
LATERAL del cuerpo, que existe en toda su profundidad — a diferencia de
`insertDepthMm`/`channelDepthMm`, que se acotan contra la cavidad hueca,
no contra la base maciza), con warning `MASK_SIDE_DEPTH_CLAMPED` si se
pide más de lo disponible. `maskSideDepthMm ≈ depthMm` da cobertura lateral
completa (el faldón llega hasta `z=0`); `maskSideDepthMm = 0` da el mismo
resultado que una placa (sin faldón, sólo la cara crecida por holgura).

**Patrón:** las perforaciones (`punchCirclePattern`) se aplican SÓLO a
`outerGroups` (la cara) — el faldón nunca pasa por el patrón, a propósito.

**Hardening:** si el faldón se erosiona por completo para alguna letra
(`skirtRingGroups` con área ~0), nuevo código `MASK_SKIRT_COLLAPSED`
(mismo patrón que `LIP_COLLAPSED`) bloquea la exportación. Como el faldón
crece hacia AFUERA (`outset`, nunca erosiona el cuerpo), esta condición es
prácticamente inalcanzable con los rangos válidos actuales — se mantiene
como red de seguridad simétrica al resto de los colapsos documentados, no
porque se haya podido reproducir con parámetros válidos.

### 15.7 UI

- **Tapered:** selector `Modo` (Escalonado/Suave), contextual a `bodyType
  === "tapered"`, antes del campo de expansión de base.
- **Bisel:** separado en dos toggles con nombres distintos — "Bisel
  frontal" (ya no "Bisel frontal interior") y "Bisel lateral luminoso"
  (nuevo, con Desplazamiento/Ancho/Posición).
- **Perforado:** se agregaron "Cobertura lateral" (`maskSideDepthMm`),
  "Espesor lateral" (`maskWallThicknessMm`) y "Holgura"
  (`maskClearanceMm`) junto a los campos existentes.
- Costillas: sin cambios de controles (mismos campos, geometría corregida
  por debajo).

### 15.8 Limitaciones conocidas (0.4.1)

- **`MASK_SKIRT_COLLAPSED` no se pudo reproducir con parámetros dentro de
  los rangos válidos** (ver 15.6) — el faldón crece hacia afuera, no
  erosiona, así que prácticamente no puede desaparecer. Se mantiene el
  código de todos modos, mismo patrón que el resto de los colapsos.
- **Tapered sigue sin combinar con costillas ni bisel** (14.8, sin
  cambios) — `bodyType === "tapered"` sigue ignorando `ribsCount` y
  `bevelEnabled` en silencio. El bisel LATERAL (nuevo, 15.4) tampoco
  aplica con `bodyType === "tapered"` (mismo criterio: `body/tapered.ts`
  no conoce ningún modificador de 0.4/0.4.1).
- **Bisel lateral + canal luminoso**: no evaluado/probado en esta
  corrección (fuera del alcance de las 4 correcciones pedidas); igual que
  el bisel frontal, `body/standard.ts` no aplica bandas de modificador al
  cuerpo macizo del canal luminoso.
- **Verificación manual en navegador no realizada** — mismo motivo que
  versiones anteriores (sin credenciales Paid en este entorno). Validado
  en su lugar: `npx tsc --noEmit` limpio, `npm run build` exitoso, 199
  tests Maker, y la suite completa del repo (693 tests, 1 fallo
  preexistente no relacionado en `stampy-product-stock-tools.test.mjs`,
  falla de resolución de módulos en el harness del test, ajeno a Stampa
  Maker).
- **Verificación manual en navegador no realizada** (14.7) — mismo motivo
  que 0.1-0.3.1 (sin credenciales Paid en este entorno).

## 16. Stampa Maker 0.4.2 — Bevel system completion

Iteración puntual: completa el sistema de biseles del cuerpo/tapa y corrige
DEFINITIVAMENTE el orden explosionado del frente perforado. NO implementa el
canal luminoso interior de 0.4/0.4.1 (eso ya existía) ni ningún patrón/body
nuevo — misma arquitectura modular `body/front/patterns/parts`, mismo
`SignPart[]`/export genérico. Explícitamente fuera de alcance de esta
iteración (sin cambios): light channel (ya existente, no se toca), gyroid,
nuevos patterns, honeycomb, triangle pattern, materiales, 3MF, LEDs,
cableado, nuevos bodies.

### 16.1 Fix definitivo del orden explosionado (frente perforado)

**Problema:** el fix de 0.4.1 (sección 15.5) derivaba el rank de la vista
explosionada de `meshMinZ` — el Z mínimo REAL de cada malla. Volvió a
romperse al agregar la máscara-carcasa con faldón lateral (0.4.1 sección
15.6, la misma sesión): el faldón extiende su geometría hacia ATRÁS del
difusor (hasta `depthMm - maskSideDepthMm`, potencialmente cerca de Z=0),
así que el `minZ` de la máscara terminaba siendo MENOR que el del difusor
aunque la máscara sea la pieza más externa — invirtiendo el rank calculado.

**Corrección:** el orden de armado es una propiedad SEMÁNTICA de cada
`PartKind` (qué rol cumple, no dónde llegan a extenderse sus vértices), así
que se declara explícitamente en una tabla central en vez de inferirse de la
malla. Nuevo módulo `src/lib/maker/geometry/explodeOrder.ts`:

- `PART_ASSEMBLY_LAYER: Record<PartKind, number>` — 0 = cuerpo (nunca se
  explota); `lid`/`diffuser`/`channelDiffuser` = 1 (nunca coexisten entre sí,
  son mutuamente excluyentes por `frontType` — cada una es, cuando existe,
  la única pieza intermedia); `mask` = 2 (más externa, coexiste con
  `diffuser` en `frontType === "perforated"` y va SIEMPRE por delante).
- `computeExplodeRanks(kinds: PartKind[]): Map<PartKind, number>` — deriva
  el rank (1, 2, 3...) de cada `PartKind` presente a partir de esa tabla,
  ordenando por capa creciente y deduplicando por capa. Función PURA, sin
  ninguna dependencia de mesh/three.js — testeada directamente (sin
  necesidad de generar geometría) con el orden de entrada normal Y
  invertido, confirmando que el resultado no depende del orden del array.

`MakerViewport.tsx` reemplaza el cálculo por `meshMinZ` (eliminado) por
`computeExplodeRanks(presentKinds)`, sobre los `kind` de
`geometry.parts` con triángulos — ninguna lógica de ordering dispersa en el
componente. `createLetterGeometry.ts#PART_ORDER` (orden de
combinación/exportación, sin cambios de valores) ahora documenta que
`PART_ASSEMBLY_LAYER` es la fuente de verdad para el rank visual, no ese
array.

La posición geométrica real (assembled/export) no cambió: es una
transformación puramente visual de `MakerViewport.tsx`, igual que en 0.4.1.

### 16.2 Bisel posterior del cuerpo

Equivalente TRASERO del bisel frontal (14.4/15.3): la pared (exterior y
counters) se erosiona progresivamente en una banda pegada a la BASE (Z=0) en
vez de al frente (Z=depthMm). Reutiliza toda la infraestructura de bandas de
0.4.1 (`subdivideRange`, `buildOffsetProfileWallPieces`,
`smoothstepRampProfile`, `buildBandedOuterWallPieces`) — nuevo módulo
`src/lib/maker/geometry/body/modifiers/rearBevel.ts`, mismo patrón que
`bevel.ts` pero espejado:

- `computeRearBevelBand(depthMm, rearBevelEnabled, rearBevelDepthMm)`:
  banda `[0, min(rearBevelDepthMm, depthMm)]`. A diferencia del bisel
  frontal, NO se acota contra `baseMm` — el bisel posterior reshapea
  justamente el extremo trasero, incluida la base maciza (spec: "debe
  aplicarse desde Z=0 hacia Z=rearBevelDepthMm").
- `rearBevelBandToZBand`: mismo perfil smoothstep que el bisel frontal, con
  el inset MÁXIMO en `Z=0` (el extremo trasero) y `0` (nominal) en
  `Z=rearBevelDepthMm` — pendiente 0 en ambos extremos, sin escalón.
- `beveledRearFootprint`: equivalente trasero de `beveledFrontFootprint` —
  la pieza "fondo" del cuerpo (antes `fondoGroups` sin modificar) ahora usa
  este footprint erosionado cuando el bisel posterior está activo, mismo
  mecanismo que el "frente" ya usaba para el bisel frontal.

**Parámetros** (`rearBevelEnabled`, `rearBevelDepthMm` default 2mm,
`rearBevelInsetMm` default 1mm) con validaciones equivalentes al bisel
frontal (rangos (0,20] / (0,10] mm).

**Combinación:**

- Con costillas: el PISO de las costillas (antes fijo en `baseMm`) ahora
  cede lugar a la banda del bisel posterior, mismo criterio que ya cedían
  contra el bisel frontal/lateral — `body/standard.ts#ribsFloorMm`.
- Con bisel frontal: ambos activos a la vez es válido SI sus bandas no se
  superponen — `validateLetterSignParams` bloquea la combinación con un
  error en `rearBevelDepthMm` si `frontDepth + rearDepth` haría que las
  bandas se toquen, en vez de generar geometría autointersectada (mismo
  criterio que el choque bisel frontal + bisel lateral de 0.4.1).
- Con bisel lateral (groove): mismo criterio de bloqueo por superposición,
  agregado por simetría/seguridad (no pedido explícitamente, pero evita el
  mismo tipo de autointersección).
- Con body standard: sí. Con `bodyType === "tapered"`: NO aplica (mismo
  criterio que `bevelEnabled`/`ribsCount`, `body/tapered.ts` no conoce
  ningún modificador de 0.4/0.4.1/0.4.2) — limitación documentada, no un
  rediseño de esta iteración.
- El perfil se aplica automáticamente a exterior, counters y concavidades
  (mismo `footprintAtOffset` uniforme de siempre) — probado con O/8/B.

### 16.3 Bisel de tapa/difusor

Modificador INDEPENDIENTE de los biseles del cuerpo, aplicado a la pieza
frontal imprimible que corresponda según `frontType`: la tapa
(`frontType === "lid"`, cualquier `lidJoint`) o el difusor plano
(`frontType === "perforated"`). NUNCA se aplica a la máscara perforada
(tiene su propia geometría de carcasa) ni al difusor de canal luminoso
(fuera de alcance de esta iteración, ver 16.6).

Nuevo módulo compartido `src/lib/maker/geometry/plateBevel.ts` — a
diferencia del bisel del CUERPO (que opera sobre una pared con cavidad
interior propia), una placa es un sólido macizo: el bisel solo cambia la
PARED LATERAL + la TAPA de la cara VISIBLE (`z1`, la cara frontal de la
pieza), nunca la cara trasera (`z0`) — eso preserva el sistema de encastre
(el labio de una tapa encastrable no cambia, ver más abajo).

- `computePlateBevelBand(plateZ0, plateZ1, enabled, bevelDepthMm)`: banda
  pegada a la cara visible `[max(plateZ0, plateZ1-bevelDepthMm), plateZ1]`.
- `buildBeveledPlateWallAndTopCap`: pared lateral + tapa de `z1` con el
  perfil de bisel (mismo mecanismo `buildOffsetProfileWallPieces` de
  siempre); NUNCA emite la tapa de `z0` — el llamador decide cómo cerrar
  esa cara (tapa completa para una placa "glue"/el difusor, o dejarla
  abierta para que la repisa/el labio de una tapa encastrable la cierren).

**Parámetros:** `lidBevelEnabled`, `lidBevelDepthMm` (banda en Z, medida
desde la cara visible hacia atrás) + `lidBevelInsetMm` (desplazamiento
máximo en la cara visible) — combinación depth+inset (no solo un
`lidBevelWidthMm`) porque, igual que el bisel del cuerpo, una pieza fina
necesita controlar ambos de forma independiente para no perforarse.

**Límite automático al espesor real de la pieza:** `lidBevelDepthMm` NUNCA
puede superar el espesor real de la pieza a la que se aplica (`lidMm` para
la tapa, `diffuserThicknessMm` para el difusor) sin perforarla. Igual que
`insertDepthMm`/`channelDepthMm`/`maskSideDepthMm`, el valor efectivo se
calcula UNA vez en `createLetterGeometry.ts` (parámetro global, no depende
de la letra) y, si el pedido excede el espesor disponible, se acota con un
warning explícito (`LID_BEVEL_DEPTH_CLAMPED`) — nunca un clamp silencioso.

**Preserva el sistema de encastre (interior lip):** para `lidJoint ===
"interior-lip"`, el bisel solo reconstruye la pared+tapa de la placa desde
`depthMm` hasta `depthMm+lidMm` (la cara visible); el labio (que entra en la
cavidad, `depthMm-insertDepthEfectivo` hasta `depthMm`) y la repisa que lo
soldaba a la placa no se tocan — verificado con un test que compara byte a
byte toda la geometría con Z ≤ depthMm entre bisel activo/inactivo. El
espesor total de la tapa (`depthMm` → `depthMm+lidMm`) tampoco cambia: el
bisel angosta la silueta, nunca el rango de Z.

**Difusor perforado:** cuando existe máscara+difusor+cuerpo, el difusor
puede tener bisel propio sin tocar `maskClearanceMm`/`maskSideDepthMm`/el
orden ensamblado (la máscara sigue siendo la pieza más externa, ver 16.1) —
la máscara NUNCA recibe bisel.

**Multipieza / hardening:** si el bisel erosiona la cara visible de una
letra/counter por completo (trazo demasiado angosto para el desplazamiento
pedido), no se genera geometría corrupta: nuevo código `LID_BEVEL_COLLAPSED`
(mismo patrón que `LIP_COLLAPSED`/`BEVEL_PLATE_COLLAPSED`) bloquea la
exportación con un mensaje por letra. Para la tapa ("glue"/"interior-lip"),
el colapso es GLOBAL (toda la tapa de esa letra queda descartada, mismo
criterio que `BEVEL_PLATE_COLLAPSED`, su vecino en el mismo archivo). Para
el difusor del frente perforado, el colapso es POR CONTORNO: como el difusor
es una pieza OBLIGATORIA del frente perforado (siempre 2 piezas), un
contorno que colapsa degrada a difusor plano SOLO en esa zona (mismo
criterio que `LIP_COLLAPSED`) en vez de descartar la pieza entera — el error
sigue bloqueando la exportación hasta ajustar los parámetros.

### 16.4 Modelo con los 4 efectos

Los cuatro modificadores (bisel frontal, bisel posterior, bisel lateral
luminoso/doble bisel, bisel de tapa) son independientes entre sí y pueden
combinarse simultáneamente cuando sus bandas no se superponen — probado con
los cuatro activos a la vez sobre "O" (cuerpo + tapa, ambos manifold/
watertight/1 componente conectado, sin errores de validación ni de
geometría). No se agregó un preset dedicado — sigue siendo composición
explícita de parámetros, como el resto de 0.4/0.4.1.

### 16.5 UI

- **Modificadores de cuerpo:** nuevo toggle "Bisel posterior" (Profundidad/
  Desplazamiento), junto a "Bisel frontal" y "Bisel lateral luminoso" — sin
  cambios en los dos existentes.
- **Tapa/difusor:** nuevo toggle "Bisel de tapa" (Profundidad/
  Desplazamiento), visible solo cuando existe una pieza compatible
  (`frontType === "lid"` o `"perforated"`) — oculto con frente abierto,
  canal luminoso, o cualquier combinación sin tapa/difusor.

### 16.6 Limitaciones conocidas (0.4.2)

- **Tapered sigue sin combinar con ningún modificador de pared** (bisel
  posterior incluido) — `body/tapered.ts` no conoce ribs/bevel/groove/
  rearBevel, sin cambios respecto a 14.8/15.8.
- **Bisel de tapa NO aplica al difusor de canal luminoso**
  (`channelDiffuser`) — el pedido lo marcaba como aplicación "si en el
  futuro se reutiliza"; fuera de alcance de esta iteración puntual. El
  difusor de canal se sigue generando exactamente igual que en 0.4/0.4.1.
- **Bisel lateral + canal luminoso**: sigue sin evaluarse (14.8/15.8, sin
  cambios) — `body/standard.ts` no aplica bandas de modificador de forma
  probada al cuerpo macizo del canal luminoso.
- **Verificación manual en navegador no realizada** — mismo motivo que
  todas las versiones anteriores (sin credenciales Paid en este entorno).
  Validado en su lugar: `npx tsc --noEmit` limpio, `npm run build` exitoso
  (incluye `/stampa-maker/carteles`), 242 tests Maker, y la suite completa
  del repo (736 tests, 1 fallo preexistente no relacionado en
  `stampy-product-stock-tools.test.mjs`, mismo problema de resolución de
  módulos del harness ya documentado en 15.8 — ajeno a Stampa Maker).

## 17. Stampa Maker 0.5 — Importación SVG / PNG

Permite crear carteles/formas desde un archivo **SVG** o **PNG**, además del
texto, reutilizando TODO el motor existente: no hay `createSvgBody()` ni
`createPngBody()`, ni un preview o exportador paralelos.

### 17.1 Arquitectura: `DesignSource` -> `ContourGroup[]` -> motor

```
DesignSource
  ├─ text  -> OpenType -> contornos -> ContourGroup[]   (createLetterGeometry, sin cambios de comportamiento)
  ├─ svg   -> extractSvgShapes ──┐
  └─ png   -> traceRaster ───────┴-> RawDesign -> normalizeRawDesign -> ContourGroup[] (mm)
                                                          │
                                   createGeometryFromContourPieces(ContourPiece[], params)
                                   ├─ body/ (standard, tapered, ribs, bevels, groove)
                                   ├─ front/ (open, lid, interior lip, perforated, light-channel)
                                   └─ parts: SignPart[] -> MakerViewport / exportWord / STL
```

- `geometry/createLetterGeometry.ts` se partió en dos: `createLetterGeometry(font,
  params)` (texto -> `ContourPiece[]`, mismo resultado que antes: los 242 tests
  previos pasan sin cambios) y **`createGeometryFromContourPieces(pieces,
  params)`**, el motor compartido. Un `ContourPiece` es `{char, label,
  contourGroups}`; `label` solo cambia cómo se nombra la pieza en los errores
  (`la letra "S" (posición 1)` vs `el diseño importado`).
- La frontera de importación es `src/lib/maker/import/`:

```
import/types.ts        DesignSource, DesignImportError (+códigos), IMPORT_LIMITS, RawDesign, ImportedDesign, PngImportOptions
import/xml.ts          parser XML cerrado (sin DOM), produce un árbol de datos
import/svgGeometry.ts  transform, path (M L H V C S Q T A Z), formas básicas, aplanado de curvas
import/svgImport.ts    extractSvgShapes: árbol -> formas visibles rellenas (+ seguridad)
import/rasterTrace.ts  PNG raster -> campo -> marching squares -> tiny-removal -> Douglas-Peucker
import/pngImport.ts    decodePng (upng-js, validaciones) + extractPngShapes
import/normalize.ts    normalizeRawDesign: escala uniforme a mm, unión Clipper, jerarquía, origen (0,0)
import/importDesign.ts importDesign / extractRawDesign / normalizeDesign / designToContourPieces / detectFileKind
hooks/maker/useDesignImport.ts   estado de carga + debounce + cache de la etapa 1
```

- Dos etapas: **1)** `extractRawDesign` (SVG parseado / PNG trazado, en unidades
  de la fuente; cacheable, no depende del alto) y **2)** `normalizeDesign`
  (escala + unión, barata). Cambiar solo el alto en mm re-ejecuta la etapa 2.
- Un diseño importado es UNA sola `ContourPiece` (`char: "diseno"`) con todas sus
  islas: exporta como el "diseño completo" (`<nombre>.stl`, o `.zip` con
  `_cuerpo/_tapa/...` si hay frente). El ZIP "Letras individuales" se oculta en
  modo archivo (export por isla: fuera de alcance, ver 17.9).
- `validateLetterSignParams(params, { textSource: false })` omite texto y alto
  de texto para el origen archivo (el alto del diseño se valida al importar,
  0 < alto <= 2000 mm).

### 17.2 Pipeline SVG (vectorial, sin rasterizar)

1. `parseXml` (parser propio) -> árbol de datos. 2. `scanTree`: chequeo de
seguridad sobre TODO el árbol (17.7). 3. Se leen estilos (`fill`, `fill-rule`,
`fill-opacity`, `opacity`, `display`, `visibility`) de atributos de
presentación, `<style>` (selectores simples `tag`, `.clase`, `#id`, `tag.clase`,
`*`) y `style=""`, con herencia (fill/fill-rule/visibility/fill-opacity).
4. Recorrido: `svg`/`g`/`a`/`switch` son contenedores; `defs`/`symbol`/etc. no se
dibujan salvo vía `<use href="#id">` interno. 5. Formas: `path`, `rect` (con
`rx/ry`), `circle`, `ellipse`, `polygon`, `polyline` (relleno cerrado implícito,
>= 3 puntos). 6. Transforms `translate/scale/rotate(a cx cy)/skewX/skewY/matrix`,
anidados (composición de matrices). Arcos -> cúbicas exactas; las cúbicas se
aplanan **después** de transformar, con tolerancia ~1/3000 del lado mayor del
dibujo. 7. Se ignoran stroke, `fill:none`, `display:none`, `visibility:hidden`,
`opacity:0`, `fill-opacity:0` (y no cuentan para el bounding box). Colores y
gradientes no se conservan (`fill:url(#g)` cuenta como relleno).

Sin formas rellenas -> `SVG_EMPTY`. `clip-path`/`mask`/`filter` (valor != none),
animaciones, `<image>` -> `SVG_UNSUPPORTED`; `<text>`/`tspan` -> `SVG_TEXT`
("Este SVG contiene texto editable. Convertí el texto a curvas/trazados antes
de importarlo."); no se descargan fuentes ni recursos.

### 17.3 Pipeline PNG

`decodePng` (firma + tamaño de archivo + dimensiones leídas del IHDR ANTES de
decodificar; luego `upng-js`) -> `traceRaster`:

1. **Campo escalar** `[0,1]` ("cuánto material"): si hay transparencia real
   (>= 0.1% de píxeles con alpha < 250) manda el **alpha** (umbral interno 0.5,
   controles de umbral/invertir ocultos en la UI, `pngMode: "alpha"`); si no,
   **luminosidad** compuesta sobre blanco: `luminosidad < Umbral` = material,
   **Invertir** da vuelta el criterio (logo blanco sobre negro). Imágenes > 1600 px
   se promedian por bloques para el trabajo (el resultado se re-escala igual).
2. **Suavizado** (Bajo/Medio/Alto = sigma 0.5/1.0/2.0 px): desenfoque gaussiano
   separable del campo. Con marching squares + interpolación lineal sub-píxel
   el borde sale curvo, no pixelado.
3. **Marching squares** (casos de silla resueltos con el promedio del centro) ->
   lazos cerrados. El campo lleva un margen vacío >= radio del desenfoque
   (`3σ+2`) para que todo contorno cierre — con 1 sola celda de margen el
   desenfoque "sangraba" material hacia el borde y los lazos quedaban abiertos
   (bug encontrado con el test de umbral, corregido).
4. **Tiny removal**, 5. **Douglas-Peucker**, 6. normalización: ver 17.5/17.6.

### 17.4 Elección del trazador (sin dependencia de tracing)

Se evaluó potrace (WASM/browser) e imagetracerjs. **Se descartaron**: marching
squares con interpolación + Douglas-Peucker son ~150 líneas determinísticas y
testeables, dan curvas suaves sobre un campo desenfocado y no suman WASM, fetch
ni código de terceros en el camino de un archivo del usuario. Única dependencia
nueva: **`upng-js`** (+ `@types/upng-js` en dev; trae `pako`), solo para
**decodificar** PNG en cliente y en los tests (también genera los fixtures).
Se prefirió a `pngjs` porque este último depende de `zlib`/`Buffer` de Node.

### 17.5 Counters, islas y unión (normalize.ts)

`normalizeRawDesign` es la ÚNICA frontera con el motor: escala **uniforme**
(`heightMm / alto de la forma`, aspect ratio intacto), Y hacia arriba, mínimo en
(0,0). Cada forma se resuelve con su propia regla (`evenodd`/`nonzero`) vía
Clipper y luego todas se **unen** (nonzero): formas solapadas dan UN sólido, sin
shells duplicados. Los counters salen de `regroupClipperSolution` (jerarquía
par/impar): un donut es UN grupo `{outer, holes:[inner]}`, nunca dos sólidos.
Las islas desconectadas son grupos separados, sin puentes, en sus posiciones
relativas originales (un anillo con una isla dentro del hueco da 2 grupos). El
motor las procesa como componentes físicos independientes de la misma pieza.
Se descartan grupos < 0.0025 mm² (ruido numérico) y se re-ancla el mínimo tras
la limpieza de Clipper.

### 17.6 Simplificación y contornos pequeños (PNG)

- **Tiny removal:** lazos con área < `max(6 px², 2e-5 × área del campo)` se
  descartan, islas Y agujeros por igual (motas y pinholes). Es proporcional al
  tamaño de la imagen: en 400×400 el piso es 6 px² (~2.5 px de diámetro), en
  4096×4096 (trabajado a 1600 px) ~ 51 px². Un counter de ~20 px de diámetro en
  400 px se conserva (test). Se informa `Se descartaron N motas/agujeros diminutos`.
- **Douglas-Peucker cerrado** con `epsilon = max(0.4, 0.5σ)` px; si el total
  supera `maxVertices/2` (30 000) se reintenta con epsilon x1.7 (hasta 8 veces).
  Un círculo de 700 px de diámetro queda en cientos de vértices, no miles, con
  <1% de error de área (test).
- Gate final `maxVertices = 60 000` (post-unión): por encima -> `TOO_COMPLEX`.

### 17.7 Seguridad SVG

El SVG es contenido del usuario: **nunca** se usa `DOMParser`, `innerHTML`,
`eval` ni `Function` (un test lee el código de xml/svgImport/svgGeometry y lo
verifica); el parser produce datos y solo se leen geometría/estilo. Se rechazan
(`SVG_UNSAFE`): `<script>`, `foreignObject`, `iframe/embed/object/audio/video/
canvas`, atributos con `javascript:`/`vbscript:`/`data:`, cualquier `href` que no
sea `#id` interno, `url()` que no sea `url(#id)` (atributos y `<style>`),
`@import`, y DTDs con `<!ENTITY>` (XXE/bombas de expansión). Los handlers `on*`
nunca se leen: se ignoran. Límites: 10 MB, 200 000 nodos, profundidad 200, 50 000
formas, 600 000 vértices previos a la unión, `<use>` anidado <= 16.

### 17.8 UI

"Origen del diseño" `[Texto | SVG / PNG]` arriba del panel. **Texto:** UI
exactamente igual. **SVG / PNG:** zona de carga (arrastrar o "Seleccionar
archivo", `.svg`/`.png`), nombre del archivo con "quitar", **Alto del diseño**
(mm) + "Ancho resultante", y para PNG: **Umbral** (slider 0–255) + **Invertir**
(solo si no hay transparencia real) y **Suavizado** (Bajo/Medio/Alto). Estado
"Procesando archivo…" y errores en rojo (mensajes de `DesignImportError`, nunca
excepciones crudas); warnings en ámbar. Debajo siguen todos los controles
normales (profundidad, pared, fondo, cuerpo, modificadores, frente). Preview y
descarga usan `MakerViewport`/`exportWord` sin cambios.

### 17.9 Limitaciones conocidas (0.5)

- Solo SVG y PNG (sin JPG/WEBP/PDF/AI/EPS/DXF). PNG entrelazado/paleta/16 bits
  dependen de `upng-js`; si no decodifica -> `PNG_INVALID`.
- SVG: sin clip-path/mask/filter/texto/imágenes/animaciones (rechazo con
  mensaje). CSS solo con selectores simples; `preserveAspectRatio`/`viewBox` no
  cambian el resultado (se normaliza por el bounding box de las formas
  visibles); `svg` anidados se tratan como grupos (sin x/y/viewBox propios);
  unidades porcentuales/`em` no se resuelven.
- Un diseño es UNA pieza: sin export individual por isla (no encajaba sin
  complicar el alcance).
- El trazo (`stroke`) se ignora: un logo hecho solo de líneas da SVG_EMPTY.
- PNG con bordes semitransparentes usa alpha >= 0.5.
- La importación corre en el hilo principal (sin Worker): ~0.2 s para 4096×4096
  en pruebas sintéticas; archivos patológicos pueden congelar brevemente la pestaña.
- **Verificación manual en navegador no realizada** (sin credenciales Paid en
  este entorno): validado con typecheck, build, tests y la suite completa.


## 18. Sprint UX/productividad — Presets

> Sprint sin geometría nueva: el motor (`createLetterGeometry`, body/front/
> patterns/parts/export, `SignPart`) no se tocó. 287 tests Maker previos
> intactos + 25 nuevos en `tests/maker-workspace.test.mjs` (312).

**PRESET = receta reusable; PROJECT = trabajo concreto.** Un preset guarda la
receta de fabricación (todo `LetterSignParams` salvo `text`, `fontId`,
`heightMm`); nunca texto, SVG/PNG, alto del diseño, fuente, cámara, Modelo/
Cama, explosionada ni el slider.

- `lib/maker/defaults.ts`: `DEFAULT_LETTER_SIGN_PARAMS` (antes local a la página).
- `lib/maker/presets/presetSettings.ts`: `PRESET_SETTING_KEYS` (whitelist
  EXPLÍCITA; el test "cobertura de claves" falla si un campo nuevo de
  `LetterSignParams` no se clasifica como receta o diseño),
  `extractPresetSettings`, `applyPresetSettings` (conserva el diseño actual),
  `normalizePresetSettings` (lectura tolerante: faltantes/inválidos/
  desconocidos -> default; sin migraciones de JSON en v1), `resolveInitialParams`
  (preset predeterminado o defaults de Stampa), `isPresetModified` (solo mira
  campos de receta). `PRESET_SCHEMA_VERSION = 1`.
- UI (`MakerLibraryPanel`, arriba del panel izquierdo): selector, "Nombre •
  Modificado", actualizar / guardar como nuevo / renombrar / duplicar /
  predeterminado / eliminar. Al entrar, si hay predeterminado se aplica solo.
- Persistencia: tabla `maker_presets` (id, user_id, name, settings jsonb,
  schema_version, is_default, created_at, updated_at); índice por `user_id`;
  índice único parcial `(user_id) where is_default` (máx. 1 default);
  RPC `maker_set_default_preset(uuid|null)` (SECURITY INVOKER, transacción
  única: desmarca y marca). `user_id` lo completa `default auth.uid()` — el
  frontend nunca lo envía.
- RLS: select/insert/update/delete solo con `user_id = auth.uid()` + policy
  RESTRICTIVE que exige `has_platform_access` o admin (`authenticated != paid`).
- No hay presets "de sistema" todavía (por eso no existe la restricción de
  borrado); si se agregan presets Stampa, deben ser filas de solo lectura.

## 19. Proyectos

- Un proyecto guarda el ORIGEN, no la geometría: `maker_projects` (id, user_id,
  name, source_type text|svg|png, source_data jsonb, settings jsonb, preset_id
  nullable, schema_version, timestamps).
  - text: `{text, fontId, heightMm}`.
  - svg/png: `{storagePath, originalFilename, mimeType, heightMm, sizeBytes,
    pngOptions?}`. El archivo vive en Storage; al abrir se descarga y se
    re-procesa con el motor vigente (nunca se persisten `ContourGroup`s).
  - `source_data` tiene un CHECK de tamaño (< 16 KB): no entra binario/base64.
- Bucket PRIVADO `maker-projects` (10 MB, `image/svg+xml`/`image/png`), path
  `{user_id}/{project_id}/source.svg|png`. Policies sobre `storage.objects`:
  la primera carpeta debe ser `auth.uid()` (+ acceso de plataforma para
  leer/escribir). El usuario A no lee el archivo del usuario B. Al eliminar un
  proyecto el cliente borra también el objeto.
- `maker_projects` RLS: dueño-solamente (+ restrictiva de plataforma); INSERT/
  UPDATE además exigen que `preset_id` sea un preset propio.
- `lib/maker/projects/projectData.ts`: `serializeProject`, `deserializeProject`
  (tolerante), `projectSourcePath`, `projectSignature`, `isProjectDirty`.
- Dirty state: firma del trabajo (origen + receta + preset referenciado + meta
  del archivo) contra la firma de la última carga/guardado; además, reemplazar
  el archivo (identidad del objeto) marca "Modificado". Abrir/Nuevo con cambios
  pide confirmación (`confirmAction`). Un proyecto referencia el preset usado
  pero puede divergir sin modificarlo.
- Capa Supabase: `lib/maker/persistence/makerRepository.ts` (`toUserMessage`
  traduce errores a mensajes comprensibles, sin SQL crudo);
  `hooks/maker/useMakerLibrary.ts` (estados loading/éxito/error vía toasts).
- No hay dashboard de proyectos (solo diálogo "Abrir"), ni autosave, ni
  cámara persistida.

## 20. Workspace, Vista Modelo y Vista Cama

**Layout** (`app/stampa-maker/carteles/page.tsx`): en `lg` (>=1024px) la página
es un workspace: contenedor `lg:h-[calc(100dvh-4rem)] lg:overflow-hidden` (4rem =
`Header` desktop `h-16`), con `lg:-mx-8 lg:-my-8` para cancelar el padding de
`<main>` (main-layout.tsx, sin tocarlo). Columna izquierda `lg:w-[380px]
lg:overflow-y-auto` (scroll propio, `min-h-0`); derecha `lg:flex-1` sin scroll,
el viewport ocupa toda la altura. En mobile es flujo vertical (controles ->
viewport de 70dvh).

**Overlays** (`MakerViewportOverlays.tsx`, mismo estilo `stampa-surface` +
blur): TOP-RIGHT exportación ("Palabra completa" para texto, "Diseño completo"
para SVG/PNG; `.stl`/`.zip` según piezas; letras individuales solo texto — la
lógica de export no cambió); BOTTOM-RIGHT Modelo|Cama, Ensamblada|Explosionada
(solo si hay >1 pieza física) + slider "Separación" 0-100 % (default 45), o en
Cama perfil/medidas y selector de placa `N / M`.

**Explosión**: `computeExplodeStepMm({height, depth}, pct)` = `pct * (0.8*depth
+ 0.2*height)`; la pieza de rank `r` se mueve `r*step` en su Object3D. Sigue
usando `computeExplodeRanks` (orden semántico perforado: difusor < máscara).
100 % de visual, no toca geometría/STL/bounding boxes.

**Modelo**: sin grid, piso ni ejes; fondo neutro (gradiente CSS), orbit/zoom/
pan, auto-fit, cámara 3/4 propia. **Cama**: `MakerViewport` construye una
segunda escena con instancias visuales (mismo `TriangleSoupData`, matriz de
escena por pieza) sobre el perfil; cada modo guarda su cámara (Cama:
superior 3/4 estilo slicer). Grid en mm (10 mm, marcado cada 50), contorno
físico y label (perfil, medidas, placa).

**PrinterProfile** (`printBed/printerProfiles.ts`): `{id, name, widthMm,
depthMm, heightMm}`; único perfil `bambulab-a1` 256×256×256. Agregar A1 Mini/
P1S/X1C/K1 = sumar una entrada (aún no hay selector de perfil).

**Orientación** (`printBed/bedLayout.ts`): cada pieza física de cada letra es un
ítem (si no hay `letters`, las piezas combinadas). Se apoya sobre Z=0
(`-minZ`); tapa y máscara se voltean 180° (cara visible contra la cama).

**Auto-arrange V1** (`printBed/packing.ts`, puro): shelf packing determinístico
sobre el bbox XY, rotación 0°/90° (prefiere apaisada), separación 5 mm, orden
por fondo decreciente. Si no entra en la placa actual abre otra: **placas
múltiples** con selector compacto (una cama a la vez). Pieza que no entra ni
girada -> NO se coloca, warning "Esta pieza supera el área de impresión de la
Bambu Lab A1." con medidas; altura > 256 mm -> warning aparte.

## 21. Migración y pasos manuales

- Nueva: `supabase/migrations/20260919120000_maker_presets_projects.sql`
  (solo objetos nuevos, idempotente, sin cambios destructivos). Dependencias:
  `profiles`, `is_admin`, `has_platform_access`, `set_updated_at`.
- NO se ejecutó contra el Supabase remoto: hay que aplicarla
  (`supabase db push` o SQL editor) antes de usar presets/proyectos. Sin ella,
  la UI muestra un mensaje genérico de error al cargar/guardar.
- Sin cambios de variables de entorno.

### Limitaciones conocidas (este sprint)

- "Autoacomodar" manual no se agregó: el layout es determinístico y siempre
  vigente, un botón no cambiaría el resultado.
- El layout de cama coloca letras/piezas sueltas; no agrupa por letra ni
  conserva la posición relativa de la palabra.
- La orientación de impresión (volteo de tapa/máscara) es una sugerencia fija.
- Los presets aún no tienen "de sistema"; un solo perfil de impresora.
- Verificación visual del workspace/cama en navegador NO realizada (requiere
  sesión de usuario); Storage/RLS remotos no probados contra Supabase real.


## 22. Orientación de impresión (fuente única) y safe zone de Stampy

**Overlay**: en desktop (`lg`) la card inferior derecha del viewport se corre a
la izquierda (`lg:pr-[5.5rem]` sobre su fila) para dejar libre el botón flotante
de Stampy (`.mobile-floating-stampy`: 56 px, a 24 px del borde). Verticalmente no
cambió; en mobile no se toca (Stampy usa otra ubicación sobre la barra inferior).

**PrintTransform** (`lib/maker/printOrientation.ts`): `{rotationXDeg,
rotationYDeg, rotationZDeg}` por `PartKind`, en `PRINT_TRANSFORM_BY_KIND`
(`Record<PartKind, …>`: un PartKind nuevo obliga a decidir su orientación).

| PartKind | Rotación de impresión | Motivo |
| --- | --- | --- |
| `body` | ninguna | apoya en su base (Z=0), cavidad hacia arriba |
| `lid` | Y = 180° | cara visible contra la cama, labio interior hacia arriba (sin voladizos) |
| `mask` | Y = 180° | cara plana perforada contra la cama, faldón hacia arriba |
| `diffuser`, `channelDiffuser` | ninguna | placas planas: cualquiera de sus caras apoya |

Un único módulo, dos consumidores (nada de lógica de rotación duplicada):

- Vista Cama: `printBed/bedLayout.ts` (`makeBedItem`, `placementMatrix`) usa
  `printRotationMatrix(getPrintTransform(kind))` para la huella del packing y la
  matriz de escena (compuesta con el giro 0°/90° del packing).
- Exportación STL: `exporters/parts.ts#partFileEntries` aplica
  `orientMeshForPrint(mesh, kind)` — rota alrededor del centro XY de la caja de la
  pieza (queda en su lugar en el plano) y la apoya en `minZ = 0` (nunca Z
  negativo). Con orientación identidad devuelve la MISMA malla (el cuerpo sale
  byte a byte como antes). `exportWord` (una sola pieza) y `exportLettersZip`
  pasan por `partFileEntries`.

El Model View y la geometría fuente (`SignPart`) no cambian.

**Cambio respecto de 0.5.1**: la Vista Cama volteaba tapa/máscara 180° en X; se
unificó en Y 180° (mismo efecto físico: cara visible hacia abajo; la huella no
cambia, solo el espejado lateral de la pieza, irrelevante para imprimir).

## 23. Recortes traseros (Back Cutouts)

Aberturas PASANTES en la base trasera (Z=0..`baseMm`) que abren hacia la
cavidad hueca. El motor trabaja sobre **formas paramétricas**, sin lógica por
"uso" (USB-C, cable, colgador son solo medidas de una forma).

```ts
type BackCutout = CircleCutout | CapsuleCutout | KeyholeCutout   // types.ts
// común: id, x, y (mm, relativo al CENTRO de la caja del diseño; Y arriba, visto de frente)
// circle:  diameterMm
// capsule: widthMm, heightMm, rotationDeg          (extremos semicirculares; width<height => vertical)
// keyhole: headDiameterMm, neckWidthMm, neckLengthMm, tailDiameterMm, rotationDeg
```

- **Círculo**: polígono regular con vértices en 0/90/180/270° (bbox exacto =
  diámetro), tolerancia de arco 0.02 mm.
- **Cápsula**: dos semicírculos sobre el lado corto + tramo recto; con
  `width == height` es un círculo; rotación en el plano XY.
- **Keyhole**: `x/y` es el centro de la cabeza; con rotación 0° el cuello baja
  (−Y). Es la unión Clipper de cabeza (círculo) + cuello (rectángulo de
  `neckWidthMm`) + extremo redondeado (círculo `tailDiameterMm` a `neckLengthMm`
  del centro de la cabeza): UN solo contorno continuo. Rotación alrededor de
  `x/y`.
- **Resta 2D** (`geometry/backCutouts.ts`, sin CSG 3D): `planBackCutouts` valida
  cada recorte y funde los válidos (Clipper `union`: los solapados forman una sola
  abertura). Cada cuerpo (`body/standard.ts`, `body/tapered.ts`) llama a
  `applyBackCutoutsToBase`, que intersecta la región con la cavidad de ESE
  carácter y agrega el contorno como hueco de la tapa trasera (Z=0) y de la
  repisa (Z=`baseMm`), más sus paredes entre 0 y `baseMm` (normales hacia el
  hueco). Los mismos lazos alimentan las tres piezas, por eso la malla queda
  soldada/watertight. Un recorte solo afecta a la letra/región que cubre (no se
  replica en todas). Sin recortes el resultado es idéntico byte a byte.
- **Validación contra bordes**: zona segura = núcleo de cada carácter (cavidad
  erosionada por `wallMm`) achicado `BACK_CUTOUT_EDGE_MARGIN_MM = 1` (interno, no
  en la UI); con bisel posterior también se limita a la huella de la base. Un
  recorte que la excede queda SIN cortar y produce el error
  `BACK_CUTOUT_INVALID`: "Recorte N: El recorte está demasiado cerca del borde o
  fuera del cuerpo." (bloquea la exportación, igual que `LIP_COLLAPSED`). Los
  counters quedan protegidos por el mismo criterio (el núcleo excluye los
  counters). Parámetros inválidos (medidas <= 0, cuello >= cabeza, > 50
  recortes, NaN) se reportan como `FieldError` sobre `backCutouts`.
- **Compatibilidad**: `standard` y `tapered`. Con frente de canal luminoso
  (cuerpo macizo, sin cavidad) el recorte da error explícito.
- **Preview/exportación**: la geometría es la real (no hay mallas falsas): se ve
  en Model View girando el cartel, está en Vista Cama y en el STL del cuerpo. No
  hay archivos extra en el ZIP.
- **Presets/proyectos**: `backCutouts` es parte de `LetterSignParams` pero está
  en `DESIGN_PARAM_KEYS` -> NUNCA viaja en un preset (su posición es específica
  del diseño). El proyecto lo guarda en `settings.backCutouts` (JSONB, sin
  columna nueva, `schema_version` sin cambios); proyectos viejos sin el campo
  cargan con `[]` (`normalizeBackCutouts`, tolerante).
- **UI**: `MakerBackCutoutsSection` ("Montaje y conexiones"): agregar,
  duplicar, eliminar, tipo, medidas, X/Y y rotación (solo capsule/keyhole).
  Sin drag & drop ni selección gráfica (futuro).
- Fuera de alcance / futuro: counterbore, avellanado, imanes, conectores
  completos, cavidades parciales, presets de cutouts, cortes laterales.

Limitaciones conocidas: X/Y son numéricos (sin edición gráfica); visto desde
atrás el eje X aparece espejado; el margen de 1 mm es fijo.


## 24. Editor visual de recortes traseros (seleccionar + arrastrar)

Iteración de UX sobre los Back Cutouts (sección 23); no agrega tipos de recorte
ni toca el motor de geometría.

**Keyhole por defecto = 180°.** Un keyhole NUEVO (`createDefaultBackCutout`,
`KEYHOLE_DEFAULT_ROTATION_DEG`) nace con `rotationDeg = 180`: círculo grande
ABAJO y cuello hacia arriba (el tornillo entra por el círculo y al bajar el
cartel el vástago queda en el cuello). Los recortes ya guardados no se tocan:
un `rotationDeg` explícito (incluido 0) se conserva tal cual al abrir un
proyecto. Cambiar el tipo de un recorte a keyhole y duplicar también respetan
esto (duplicar copia medidas y rotación).

**Arquitectura** (todo dentro del MISMO `MakerViewport`, sin segundo canvas):

- `components/maker/cutoutEditorScene.ts` (`createCutoutEditor`): cámara
  ortográfica trasera + `OrbitControls` propios (sin rotación ni paneo, solo zoom
  con la rueda) + grupo de HANDLES. Los handles son helpers de edición
  (relleno semitransparente + contorno, `depthTest: false`) construidos con
  `backCutoutPolygons` — la MISMA función que el motor — así coinciden
  exactamente en forma, medidas, rotación y X/Y. No son parte de ningún
  `SignPart` ni se exportan.
- `lib/maker/backCutoutEditor.ts`: lógica pura y testeada (conversiones,
  `updateBackCutoutPosition`, validez, `duplicateBackCutout`).
- `MakerViewport` recibe `cutoutEditing` (null = apagado). Al activarlo entra a
  la vista trasera; la cámara perspectiva y sus controles quedan intactos y se
  deshabilitan, así que al salir el Model View vuelve exactamente como estaba.
- Página: `editingCutouts` + `selectedBackCutoutId` (una única selección
  compartida entre la lista y el viewport). Al entrar se fuerza Modelo (si
  estaba en Cama) y Ensamblada (`viewMode` efectivo; el estado previo del
  usuario no se pisa, así que al salir vuelve solo). El modo se abre con
  «Editar posiciones» y se cierra con «Terminar edición» (sidebar o card del
  viewport). No hay edición sobre la Vista Cama.

**Cámara**: `OrthographicCamera` mirando perpendicular a la base (hacia +Z desde
−Z, Y arriba), centrada en el centro del diseño (`geometry.designCenter`), con
encuadre según el tamaño del diseño. Sin orbit: el zoom con la rueda funciona.

**Raycasting y conversión**: pointer -> NDC -> `Raycaster` -> intersección con
el plano de la base (Z=0) -> punto de escena (mm reales, no deltas de píxeles)
-> `worldToDesign` (resta el centro del diseño) -> `x/y` del recorte
(redondeados a 0.01 mm; no es snapping). La escena usa las mismas coordenadas que
el diseño, así que `designToWorld/worldToDesign` son solo una traslación.

**Espejo de la vista trasera**: lo aporta ÚNICAMENTE la cámara (mirando desde −Z,
la derecha de la pantalla es −X). El handle sigue al cursor exactamente; como
convención de guardado se mantiene «X visto de frente», por lo que arrastrar a la
derecha en pantalla DISMINUYE la X guardada. No hay ninguna inversión de signo al
guardar (`designToBackViewScreen` / `backViewScreenToDesign` documentan y testean
el mapeo; el banner del editor lo aclara).

**Selección y drag**: click en un handle lo selecciona y empieza el drag (con
offset, sin saltos); `OrbitControls` del editor se deshabilita durante el drag
(pointer capture) y se rehabilita al soltar; click en vacío deselecciona; click
sin mover no reescribe la posición. Cursor `grab` al pasar / `grabbing` al
arrastrar. Pointer Events (mouse; touch/lápiz funcionan razonablemente). El
seleccionado se ve naranja Stampa, los demás gris, los inválidos rojo.

**Validación visual**: `LetterGeometryResult.backCutoutSafeZone` (zona segura de
la base; solo se calcula si hay recortes) permite validar en vivo con la misma
prueba del motor (`isCutoutInsideSafeZone`). Inválido => handle rojo y mensaje
«El recorte está demasiado cerca del borde.». Sin clamp: la posición inválida se
conserva y el motor genera `BACK_CUTOUT_INVALID`, que sigue bloqueando la
exportación.

**Sincronización X/Y**: `params.backCutouts` es la única fuente. Arrastrar
actualiza x/y (los campos de la card, ahora «Ajuste fino X/Y», se resincronizan:
`NumberField` reacciona a cambios externos de `value`); escribir x/y mueve el
handle.

**Performance**: el handle se mueve por ref a cada frame (sin React); solo se
hace commit al estado cada 80 ms (`LIVE_COMMIT_INTERVAL_MS`) y uno final exacto
al soltar. La geometría real sigue con su debounce de 200 ms, por lo que durante
un drag continuo solo se regenera en las pausas y al soltar. Los meshes de los
handles se reutilizan: solo se reconstruye la silueta si cambia la FORMA, no la
posición; no se recrean escena ni renderer.

Persistencia: sin cambios de schema; el drag solo modifica x/y (el estado sucio
del proyecto lo detecta). Los presets siguen sin guardar recortes.

Limitaciones: sin snapping, selección múltiple, resize ni gizmo de rotación (la
rotación es numérica); los handles muy chicos son difíciles de acertar sin zoom;
las piezas frontales no se ocultan en la vista trasera.

### 24.1 Separación como única fuente (0.6.2)

Se eliminó el selector Ensamblada/Explosionada y el estado `viewMode`: el slider **Separación** (`explosionAmount`, 0-100 %) es la única fuente. 0 % = ensamblado; 1-100 % = progresivamente explosionado (`computeExplodeOffsetMm`, mismo orden semántico por `computeExplodeRanks`). Arranca en 0 (antes arrancaba en "Ensamblada"). Durante Editar recortes el valor efectivo es 0 (`effectiveExplosionAmount`) sin pisar la preferencia del usuario, que vuelve al salir; cambiar Modelo/Cama no lo modifica. Es solo visualización: no va a presets, proyectos, exportación ni geometría.

## 25. Neon LED (0.1) — `/stampa-maker/neon`

Segunda herramienta de Stampa Maker. Genera un **canal en U abierto por arriba**
alrededor de un recorrido central (centerline); el Neon Flex se introduce desde
arriba. NO es una letra maciza, ni un tubo cerrado, ni el contorno de una fuente
normal: el motor parte de RECORRIDOS.

### 25.1 Arquitectura y reutilización

```
src/lib/maker/neon/                      módulo nuevo, sin depender de createLetterGeometry.ts
  types.ts                NeonPath, NeonParams, NeonSource, NeonIssue, NeonInputError
  defaults.ts             defaults, channelInnerWidth/OuterWidth, margen +5 %
  createNeonGeometry.ts   orquestador: buildNeonPaths (INPUT) y createNeonGeometry (GEOMETRÍA + métricas)
  fonts/glyphs.ts         glifos de trazos (paths SVG, cap height = 100)
  fonts/neonFonts.ts      catálogo de fuentes Neon
  paths/textToNeonPaths.ts, svgToNeonPaths.ts, flattenNeonPath.ts
  geometry/bufferPath.ts  buffer (stroke) de recorridos con Clipper
  geometry/createChannelGeometry.ts   huellas 2D -> malla del canal U
  metrics/pathLength.ts, curvature.ts
  validation/validateNeonParams.ts
src/hooks/maker/useNeonGeometry.ts       debounce; NeonPaths solo se recalculan si cambia fuente/alto
src/components/maker/MakerNeonControls.tsx   panel izquierdo + tarjeta de exportación
src/app/stampa-maker/neon/page.tsx
tests/maker-neon.test.mjs (34) + tests/maker-neon-svg-fonts.test.mjs (22) + tests/maker-neon-raster.test.mjs (48)
```

**Se reutiliza tal cual**: `MakerViewport` (modelo flotante, sin grid, orbit/zoom/auto-fit),
Vista Cama (`bedLayout`, `packing`, `PrinterProfile` A1 256×256×256, `BedWarnings` para
oversize), `extrudeContourGroups`/`contourHierarchy`/`offsets.ts` (Clipper),
`exportWord` + `partFileEntries` + `buildSTLBlob`, `SegmentedControl`/`NumberField`/
`CalculatorSelect`, `import/xml.ts` + `scanTree` (seguridad SVG). El resultado Neon se
adapta a `LetterGeometryResult` con **una sola pieza `body`** (identidad de orientación:
piso contra la cama, U hacia arriba), así viewport, cama y export no cambiaron.

**Cambios mínimos a código compartido**: `SubPath.closed?` (se marca al ver `Z`;
Carteles lo ignora) en `import/svgGeometry.ts`, y `export` de helpers ya existentes de
`import/svgImport.ts` (`scanTree`, `collectStyles`, `collectIds`, `selectorMatches`,
`parseDeclarations`, `parseStyleSheet`, `CssRule`). Sin cambios de comportamiento.

### 25.2 Modelo `NeonPath`

`{ points: Point2D[] (mm, Y arriba, ya aplanado); closed: boolean }`. En un path cerrado
el último punto no repite al primero. Frontera: INPUT → `NeonPath[]` → motor.

### 25.3 Texto (pipeline) y fuente

`texto → mayúsculas + NFD → por carácter: glifo (paths SVG) desplazado por el cursor
→ acentos/Ñ como trazo extra → inclinación de la fuente → aplanado de curvas (0.05 mm)
→ escala (alto de mayúscula = "Alto del diseño") → NeonPath[]`.

- **(Actualizado en 26.6: ahora hay más fuentes.)** Fuentes originales: "Stampa Línea (recta)" y "Stampa Línea (inclinada 12°)". Es una fuente de
  trazos **propia, dibujada para este proyecto** (A–Z, 0–9, `. , - _ ! ? : + = / '`, tildes
  agudas/graves/diéresis y Ñ). **Licencia: sin datos de terceros, no hay atribución que
  cumplir.** Se evaluó Hershey (licencia permisiva pero con atribución obligatoria) y no se
  incorporó: no se vendoreó ningún dataset externo en esta versión. Agregar Hershey u otra es
  registrar otro `NeonFontDefinition` con sus glifos; el pipeline no cambia.
- Una letra puede ser varios NeonPaths (la A = 2 lados + travesaño = 2 paths); "STAMPA" = 9.
- Solo mayúsculas y un renglón; caracteres sin trazo se omiten con warning `UNSUPPORTED_CHARS`.
- Escala del texto: el alto es el de la **mayúscula** (no la caja del recorrido).

### 25.4 SVG (pipeline)

El SVG representa **recorridos**. Cuentan como centerline `<path>`, `<line>`, `<polyline>`,
`<polygon>`, `<circle>`, `<ellipse>` (y `<rect>`) que tengan **trazo** (`stroke`, por atributo,
CSS o herencia) **o no tengan relleno** (`fill="none"`); `<line>` siempre. `Z`/círculo/elipse/
polygon/rect ⇒ cerrado. Se aplican transforms anidados (translate/scale/rotate/skew/matrix),
`<use>`, `<defs>` y la traslación del `viewBox`; la escala uniforme se absorbe al normalizar
por el alto del recorrido. Las formas solo rellenas se ignoran (warning `IGNORED_FILLED_SHAPES`);
si no queda ningún recorrido: error **«Este SVG contiene formas rellenas. Para Neon LED
necesitás un SVG de línea/trazo…»** (sin geometría). Una línea puramente horizontal no tiene
alto para escalar: error `SVG_ZERO_HEIGHT`. Seguridad idéntica a Carteles: parser XML propio sin
DOM, sin scripts, `foreignObject`, `javascript:`/`data:`, recursos externos, entidades,
animaciones; los handlers `on*` nunca se leen. Texto editable, imágenes, clip-path/mask/filter
se rechazan.

### 25.5 Escala y convención de ancho

- **Alto del diseño** (default 200 mm) = alto del **recorrido central** (aspect ratio fijo;
  1 unidad = 1 mm). El canal impreso es más grande (suma el ancho exterior): la UI muestra
  "Ancho resultante" (recorrido) y "Ancho/Alto total diseño" (pieza impresa).
- **Holgura = TOTAL, no por lado.** `innerWidth = neonWidth + clearance` (6 + 0.3 = 6.3 mm);
  `outerWidth = innerWidth + 2 × wallThickness` (8.7 mm). La UI muestra el ancho interior.
- Defaults: pared 8 mm, espesor pared 1.2, fondo 1.6, radio mínimo 10 mm. Altura total 9.6 mm.

### 25.6 Footprints y construcción de la U

```
inner  = buffer(paths, innerW/2)              (corredor / cavidad)
outer  = buffer(paths, innerW/2 + pared)      (huella del piso)
pared  = outer − inner                        (Clipper, nonzero)
```
`buffer` = un único `ClipperOffset` con todos los paths: **join redondo**, **tapas redondas**
en paths abiertos (`etOpenRound`), `etClosedLine` en cerrados (anillo, **sin tapas**). Como la
unión la resuelve Clipper, canales que se cruzan/solapan y paths autointersecados quedan
fundidos en una región (sin paredes internas duplicadas); la cavidad del cruce queda abierta.

3D sin CSG: todo se arma con las **mismas coordenadas de los anillos de `pared`** (cada
anillo se clasifica como borde exterior o borde de cavidad probando de qué lado no hay
material): base `z=0` + paredes exteriores `0→top`; piso de la cavidad `z=floor`; paredes
interiores `floor→top` (normales invertidas); corona `z=top`. **No se dibuja piso bajo las
paredes** (no hay caras internas). Comparte grilla 0.0001 mm y jitter determinístico con
`extrudePolygon.ts`. Tests: sin aristas abiertas/no-manifold, sin triángulos degenerados,
volumen consistente con la teoría (±1 %), piso 1.6 / altura 9.6 / paredes 1.2 / interior 6.3,
cavidad abierta arriba en todo el recorrido.

### 25.7 Métricas y validaciones

- **Longitud** = suma de los centerlines ANTES del offset (cerrados incluyen el cierre);
  **recomendado = +5 %** fijo (`NEON_LENGTH_MARGIN`, sin configuración).
- **Radio mínimo** (warning `MIN_BEND_RADIUS`, no bloquea): estimación por muestreo, radio de la
  circunferencia por 3 puntos (vértice y ±0.4×radio configurado de arco). Avisa solo si el
  mínimo medido < 85 % del configurado, con "Radio detectado ≈ X mm; mínimo configurado Y mm".
  Es una estimación, no una medición exacta. Las esquinas vivas (A, M, Z, L…) siempre avisan:
  el motor NO redondea esquinas del recorrido.
- **Paredes finas** (warning `THIN_WALL`): apertura morfológica de la huella de pared con un
  umbral de 0.5× el espesor configurado (dos recorridos separados por menos de `innerW + 0.6`
  mm dejan una pared compartida más fina). Corredores que se solapan se funden (válido).
- **Errores** (bloquean exportación): `NO_PATHS`, `CAVITY_COLLAPSED`, `GEOMETRY_FAILED`, y los de
  entrada (SVG relleno/inseguro, texto vacío).

### 25.8 Viewport, cama y exportación

Viewport y Vista Cama son los de Carteles (sin separación: una pieza). Origen de la pieza:
esquina mínima incluyendo el canal en (0,0), `minZ=0`. Oversize (> 256×256, p.ej. el default
de 200 mm con "STAMPA") usa la advertencia existente; **no hay división automática**.
Exportación: **un solo `<nombre>.stl`** con todos los strokes en su posición relativa
(`exportWord`). No se implementó el helper visual del Neon dentro del canal.

### 25.9 Projects y presets (NO incluidos en 0.1)

`maker_projects.source_type` tiene un CHECK (`text|svg|png`) y `maker_presets` no tiene
discriminador de herramienta: soportar Neon requiere una migration (`tool_type` con default
`'sign'` + ampliar el CHECK; RLS sin cambios) y tocar `makerRepository`/`projectData`/
`presetSettings`. Se dejó fuera para no mezclar el schema de Carteles ni aplicar SQL sin
autorización; el estado de la página ya es serializable (`NeonParams` + fuente). Proyectos
y presets de Carteles intactos.

### 25.10 Limitaciones conocidas

- Sin PNG, skeletonization/medial axis ni conversión de fuentes normales o logos rellenos.
- Fuente propia solo mayúsculas/un renglón/pocos símbolos; sin kerning por par.
- Sin redondeo automático de esquinas del recorrido; sin puentes, clips, cable holes, división
  por cama, G-code ni electricidad (fuera de alcance).
- El radio mínimo es una estimación por muestreo (warning, no bloqueo).
- La ruta exige sesión con acceso de plataforma (igual que Carteles): la verificación visual
  de la página completa en navegador NO se hizo (sin credenciales). Se verificó el render 3D
  real de la malla (three.js) en un harness aparte y la UI compila (`next build`).

## 26. Neon LED 0.1.1 — importador SVG corregido y biblioteca de fuentes single-line

Iteración correctiva sobre la sección 25 (sin avanzar a 0.2: no hay skeletonization, PNG ni
unión de letras).

### 26.1 Causa raíz del rechazo SVG

Diagnóstico con fixtures de exportadores reales (antes de tocar código): los casos simples
(`stroke` como atributo, `style=""`, herencia desde `<g>`, clase CSS simple, `fill`+`stroke`)
**ya se clasificaban bien**. No era "todo SVG cae como relleno"; eran cuatro causas concretas:

1. **CSS de `<style>` con selectores no simples** (`svg path{}`, `.wrap path{}`, `g > path{}`,
   listas con combinadores): el matcher solo entendía `tag`/`.clase`/`#id` sueltos, así que la
   regla no aplicaba, el stroke quedaba sin resolver y el path caía como "solo relleno".
2. **`<text>` rechazado** con un error genérico en vez de convertirse.
3. **Texto convertido a contornos** (Illustrator/Inkscape "convertir a curvas", Figma "flatten"):
   son paths cerrados rellenos sin stroke. **Es relleno genuino** y sigue rechazándose (sección 26.4);
   probablemente la mayoría de los rechazos reportados.
4. **Un único mensaje** para casos distintos (sin recorridos / solo relleno / elementos no compatibles).

Además el resolvedor viejo no tenía cascada real (sin especificidad, sin `!important`, `style=""`
mezclado por orden), y un `stroke="none"` explícito con relleno no se contaba como forma rellena.

### 26.2 Resolución de estilos (`neon/paths/svgStyles.ts`)

- **Cascada real**: atributos de presentación < reglas CSS (especificidad `#id` > `.clase` > `tag`,
  luego orden) < `style=""`; `!important` por encima de todo.
- **Selectores soportados**: `tag`, `*`, `.clase` (varias), `#id`, combinaciones (`tag.clase`, `.a.b`),
  combinadores descendiente (` `) e hijo (`>`), listas con coma, hojas dentro de `<defs>`/CDATA.
  **No soportados** (la regla se ignora entera, nunca a medias): pseudo-clases/elementos, selectores
  de atributo, hermanos (`+`, `~`); `@media` se aplica sin condicionar; `var(--x)` cuenta como
  "hay pintura visible"; `@import` y `url()` externos se rechazan (seguridad, igual que Carteles).
- **Herencia** al recorrer el árbol: `fill`, `stroke`, `fill-opacity`, `stroke-opacity`, `visibility`,
  `font-size`, `text-anchor`, `color` (`currentColor`), `inherit`. `opacity`/`display` de un grupo
  descartan todo su subárbol. También aplica a elementos referenciados por `<use>`.
- **Sin pintura** (`isNoPaint`): `none`, `transparent`, `rgba/hsla(...,0)`, `#rgba`/`#rrggbbaa` con alfa 0.
- Un **stroke utilizable** = definido, no "sin pintura" y `stroke-opacity > 0`. `stroke-width` NO
  interviene: el stroke SVG solo aporta el centerline; el ancho físico lo define Neon + holgura.

### 26.3 Clasificación por elemento (fill / stroke)

| Caso | Resultado |
|---|---|
| stroke visible (con o sin fill) | **recorrido**; el fill se ignora (fill+stroke usa el stroke) |
| sin stroke y fill visible (incl. `stroke="none"` explícito) | forma rellena: se cuenta, se ignora |
| fill none y stroke sin especificar | recorrido (línea sin pintar; leniencia) |
| fill none y stroke none explícitos, o oculto | invisible: se cuenta como ignorado |
| `<line>` | siempre recorrido salvo stroke explícitamente invisible |
| `<text>` | se convierte (26.5) |

Mensajes distintos: sin ningún recorrido y con formas rellenas → «Este SVG contiene únicamente formas
rellenas. Neon LED necesita recorridos de línea. La conversión automática a línea central se agregará más
adelante.»; sin nada utilizable → «No se encontraron recorridos de línea en el SVG.»; clip-path/mask/filter/
imágenes → «El SVG contiene elementos no compatibles. …». Con **mezcla** de trazos y formas rellenas se
importan los trazos y NO se bloquea: «Se importaron X recorridos. Y formas rellenas fueron ignoradas.»

**Debug info** (no visible al usuario): `svgToNeonPaths(...).stats` e `inspectNeonSvg(content)` devuelven
`{ shapes, strokeRoutes, fillOnly, textElements, ignored, paths }`.

### 26.4 Texto convertido a contornos: sigue rechazado

Contornos cerrados rellenos sin stroke son *fill geometry* y NO se confunden con `<text>`. Convertirlos a
centerline requiere skeletonization/medial axis: fuera de alcance. Error de solo-relleno (26.3).

### 26.5 `<text>` del SVG

Se extrae el texto (incluye `<tspan>`; un `tspan` con `x`/`y` propios abre otra línea), posición `x`/`y`,
`font-size` (px/pt/em; la mayúscula se dimensiona como 0.7 × font-size), `text-anchor` (start/middle/end,
calculado sobre el avance como hace SVG) y el transform acumulado. Se compone con `layoutNeonText` (mismo motor
que el modo Texto: kerning, espaciado) usando **la fuente Neon elegida en la UI**; la `font-family` original
NO se reproduce. Aviso: «El texto del SVG se convirtió usando <fuente>.». Limitaciones: sin `textPath`
(se lee como texto normal), sin `dx/dy/rotate` por glifo, sin `textLength`, sin `letter-spacing` CSS.

### 26.6 Biblioteca de fuentes single-line

Registro central `neon/fonts/neonFonts.ts` (`NeonFontDefinition`: id, label, categoría, descripción, origen,
licencia, `caseMode`, métricas, `getGlyph`/`getKerning`). Categorías Script / Moderna / Geométrica / Técnica.
Orden del selector: Mistral SingleLine (Script), Relief SingleLine (Moderna), Stampa Línea, Stampa Línea
inclinada. **Selector con mini vista previa 2D** de cada fuente dibujada con su propia geometría de trazo único
(SVG liviano, sin 3D). Default: Mistral SingleLine.

| Fuente | Formato real usado | Origen | Licencia |
|---|---|---|---|
| **Mistral SingleLine** (Script) | **UFO** `sources/Mistral_SingleLine.ufo`: contornos ABIERTOS (no el OTF de contornos cerrados ni el OpenType-SVG) | `isdat-type/Mistral-SingleLine` @ `fc23517` | SIL OFL 1.1 — © 2025 The Mistral SingleLine Project Authors. Sin Reserved Font Name |
| **Relief SingleLine** (Moderna) | **SVG Font** `fonts/open_svg/ReliefSingleLineSVG-Regular.svg` (paths abiertos) | `isdat-type/Relief-SingleLine` @ `01dfc57` | SIL OFL 1.1 — © 2021/2022 The Relief SingleLine Project Authors. Sin Reserved Font Name |
| Stampa Línea (+ inclinada) | glifos propios como paths SVG | código de Stampa | propia |

Textos de licencia versionados en `neon/fonts/licenses/OFL-*.txt`.

**Preprocesamiento** (`scripts/build-neon-fonts.mjs`, herramienta de desarrollo, no corre en build ni runtime;
la salida `neon/fonts/data/*.ts` está versionada y su cabecera declara origen, SHA, licencia y modificaciones):
- Mistral: se leen los `.glif` (contornos abiertos, sin componentes); los contornos consecutivos que se tocan se
  **encadenan en un solo trazo**; se descartan ligaduras y alternativas contextuales (GSUB, `features.fea`); el
  kerning UFO con clases (`public.kern1/2`) se resuelve a pares planos; **`capHeight` calibrado** sobre las
  mayúsculas reales (664 vs 580 declarado): así "Alto del diseño" coincide con la altura visible de las capitales.
- Relief: se conserva el path data original (comandos relativos incluidos); `hkern` (g1/g2/u1/u2) → pares planos.
- Charset: ASCII imprimible + Latin-1 (áéíóúüñ, ¿ ¡ …), 160 glifos por fuente. Kerning por letra base (una tilde
  usa el kerning de su letra).
- Sin modificar las formas: solo cambia el formato. Al ser OFL, las obras derivadas conservan la licencia y su
  aviso de copyright; no se usa ningún nombre reservado.

**Evaluadas y NO incorporadas: Custom-Script / Custom-Square** (`Shriinivas/inkscapestrokefont`). Los SVG Font no
llevan aviso de licencia; el `strokefontdata/OFL.txt` del repo es la *plantilla sin completar* (sin titular);
el repo es GPL-2 (código de las extensiones de Inkscape); y la derivación de Pinyon Script (OFL, Pinyon Project
Authors, sin RFN) y Square Grotesk/Squarion (OFL, con Reserved Font Name «EXO» del original) solo consta en el
README. Se verificó que ambas fuentes de origen son OFL, pero la cadena de licencia del asset concreto es
indirecta; por la regla de no usar assets con licencia dudosa quedaron fuera. Su formato (SVG Font, `d`
absoluto M/C) es el mismo que ya lee el conversor: incorporarlas sería sumar la entrada al script y al registro
si se confirma la licencia con el autor.

### 26.7 Espaciado y kerning

`layoutNeonText`: avance del glifo + **kerning del par** + espaciado extra. Control **Espaciado entre letras**
(`letterSpacingPct`, −20 % a +100 %, default 0 = recomendado por la fuente; 100 % = +¼ de la altura de mayúscula
por carácter). También rige el `<text>` de un SVG. Se aplica al ancho de los espacios entre palabras.

**Continuidad script**: se mantienen los trazos que da la fuente (un NeonPath por trazo, sin fusionar letras).
Si dos trazos se tocan o cruzan, el buffer/unión del canal los funde (sección 25.6); no se inventan puentes.

### 26.8 Tests (`tests/maker-neon-svg-fonts.test.mjs`, 22; `tests/maker-neon.test.mjs`, 34)

Fixtures SVG 1–10 del pedido (fill none+stroke, fill-only, fill+stroke, `style`, herencia `<g>`, CSS clase/tag/
descendiente/hijo/id/CDATA/especificidad/`!important`, mezcla 2+1 con warning, `<text>` con la fuente elegida,
contornos rellenos → error, transforms, `<use>`), más anchors/tamaños/tspan/transform de `<text>`, "sin pintura",
mensajes diferenciados, seguridad y stats. Fuentes: registro y licencias (archivos OFL presentes, sin RFN, cabecera
generada), charset y paths abiertos, y para cada fuente ABC/abc/0123/STAMPA/Neon/amor: glifos, trazos abiertos, escala
(cap height), avances, kerning, espaciado y **canal U manifold y sin errores** en amor/neon/bar/Stampa.

### 26.9 Limitaciones conocidas

- Sin GSUB (ligaduras/alternativas contextuales): Mistral usa sus glifos base; algunas uniones script pueden ser
  menos fluidas que en un motor OpenType completo.
- Selectores CSS avanzados y `@media` condicionado no se resuelven (ver 26.2).
- En fuentes script el "Alto del diseño" es la altura de la MAYÚSCULA; una palabra en minúsculas ("amor") mide menos.
- Las esquinas/curvas cerradas de las fuentes script pueden disparar el warning de radio mínimo (esperable a 10 mm).
- Verificación visual de la página completa en navegador no realizada (requiere sesión); se verificó el render
  2D de las fuentes en un harness aparte.

## 27. Neon LED 0.2 — imágenes raster (PNG / JPEG)

Genera el RECORRIDO CENTRAL (centerline) de una imagen raster y lo entrega al motor Neon existente. **No** es
PNG -> SVG de contorno: no hay ningún paso vectorial de contornos rellenos. El pipeline termina en `NeonPath[]` y de ahí
en `createNeonGeometry()` (sin `createPngNeonGeometry`): Model View, Vista Cama y STL funcionan sin lógica especial.

Desarrollo en dos fases sobre UN solo motor. **Checkpoint Fase A (PNG), antes de implementar JPEG:** tests
raster/PNG 36/36, Neon 92/92, Maker 446/446, `tsc` limpio, ESLint limpio en lo nuevo, `next build` OK. Fase B (JPEG)
solo agregó el decodificador JPEG, el contraste y la poda con radio local; no hay un segundo motor.

### 27.1 Arquitectura (`src/lib/maker/neon/raster/`, sin React ni DOM)

```
types.ts               RasterImage, RasterSettings (+defaults), RASTER_LIMITS, RasterStats/Preview/Conversion
decodeRasterImage.ts   firma -> PNG (upng-js) | JPEG (jpeg-js, dimensiones/EXIF leídos SIN decodificar); cache por bytes
imageProcessing.ts     campos alpha/luminancia, Otsu, máscara, recorte, remuestreo, blur, componentes, islas/agujeros,
                       mayoría 3×3, transformada de distancia exacta (EDT)
skeletonize.ts         Guo–Hall + limpieza de esquinas en escalera
skeletonGraph.ts       grafo (extremos/bifurcaciones/aristas/lazos), contracción de grado 2, puentes de huecos, resumen
pruneSkeleton.ts       poda de ramas terminales cortas
traceSkeletonPaths.ts  extensión de extremos + grafo -> recorridos
simplifyNeonPaths.ts   Ramer–Douglas–Peucker      smoothNeonPaths.ts   Taubin (λ|μ)
rasterToNeonPaths.ts   orquestador puro: RasterImage + RasterSettings + alto(mm) -> NeonPath[] (mm) + preview + stats
```
Integración: `NeonSource` suma `{ type: "image", bytes, kind, raster }` y `buildNeonPaths` lo enruta (un JPEG fuerza
luminosidad); `useNeonGeometry` expone `raster` (máscara + paths en px + stats); UI en `MakerRasterPanel.tsx`.

### 27.2 Pipeline

`bytes -> RGBA -> campo (alpha | luminancia+contraste) -> umbral (alpha fijo | Otsu | manual) -> máscara (+Invertir) ->
recorte del foreground -> resolución de trabajo -> limpieza -> skeleton -> grafo -> puentes -> poda -> extensión de
extremos -> recorridos -> simplificación -> suavizado -> NeonPath (mm)`.

- **Skeleton: Guo–Hall** (2 sub-iteraciones, determinístico, ~100 líneas, sin dependencias). Elegido sobre Zhang–Suen
  (mejor conectividad, menos escaleras y espolones) y sobre una biblioteca/WASM (peso injustificado para el problema). Es un
  adelgazamiento, no el eje medial exacto: preserva topología (loops, componentes, bifurcaciones); los extremos se retraen
  ~medio ancho del trazo, por eso `extendEndpoints` los prolonga por su tangente mientras siga dentro de la máscara.
- **Resolución de trabajo**: nunca se procesa la imagen original. Lado mayor del recorte <= **1024 px** (área promedio al
  reducir); recortes < 320 px se amplían (bilinear SOBRE EL CAMPO, antes del umbral, máx. 4×). El skeleton corre a esa
  resolución; la escala física se aplica después.
- **Recorte automático** del foreground (margen técnico 2 % / mín. 2 px): un logo de 500 px en un lienzo de 2000×2000 no da
  un diseño diminuto.
- **PNG con alpha**: `alpha > umbral` (default 128) es material. **Luminosidad**: luminancia Rec. 709
  (0.2126 R + 0.7152 G + 0.0722 B sobre sRGB, píxeles semitransparentes compuestos sobre blanco); material = `lum <= umbral`.
  **Automático**: alpha si > 1 % de los píxeles tiene alpha < 250; si no, luminosidad.
- **Umbral**: Otsu (punto medio de la meseta de máximos; con un histograma 0/255 puro da ~127, no 0) o manual 0-255; el
  valor detectado se muestra. **Invertir** invierte la MÁSCARA, nunca los paths. **Contraste** (−100..100, común a PNG en
  luminosidad y a JPEG): `(v−128)·f+128`.
- **Limpieza** (0 ninguna / 1 suave / 2 media / 3 fuerte): blur gaussiano del campo (σ 0.8/1.5/2.2 px) -> umbral -> islas y
  agujeros diminutos -> mayoría 3×3 (niveles 2-3). Los píxeles aislados nunca forman recorrido.
- **Grafo**: 8-conectividad; extremo = grado 1, bifurcación = grado ≥ 3 (píxeles de bifurcación adyacentes fundidos en un
  nodo, posición = centroide); aristas = cadenas de grado 2. Los nodos de grado 2 se contraen. **Lazos**: una arista que vuelve
  a su nodo (o una componente sin nodos, como la "O") sale como `closed = true`; `stats.loops` es el número ciclomático
  (una "O" = 1, un "8" = 2), independiente de cómo se partan en paths. **Bifurcaciones**: se permiten; warning «El recorrido
  contiene N bifurcaciones. Las bifurcaciones pueden requerir segmentos separados de Neon Flex.» (no bloquea). Cada arista es
  un NeonPath que termina exactamente en el punto de la bifurcación, así que el buffer del canal los une.
- **Puentes**: dos extremos libres a <= 0.4 % del lado mayor (mín. 2.5 px) se unen con un segmento recto (cortes del umbral);
  no se une nada más lejos.
- **Poda**: solo ramas TERMINALES (extremo libre -> bifurcación) más cortas que `pruneMm` (default 2 mm sobre el diseño final,
  convertido a px con la escala física) **o** ~1.3× el radio local del trazo en su bifurcación (EDT): los vértices gruesos
  (el pico de una "A") generan abultamientos de esquina de ese largo. Nunca toca lazos, aristas entre dos bifurcaciones ni
  ramas largas. Un trazo suelto o lazo diminuto (< umbral) se descarta como ruido. `pruneMm = 0` desactiva todo.
- **Escala física**: el **alto del diseño** es el alto del foreground recortado (no del skeleton), así una barra horizontal
  (skeleton de alto 0) también escala y mm↔px de la poda no es circular. La longitud Neon se calcula DESPUÉS de escalar.
- **Simplificación** (RDP, tolerancia 0.6/1.3/2.6 px de trabajo; extremos y bifurcaciones exactos; los cerrados se parten en
  dos mitades) y **suavizado** (0-100 -> 0-30 iteraciones Taubin sobre el recorrido re-muestreado cada 2 px; extremos fijos,
  no encoge círculos ni lazos).

### 27.3 UX

Origen **[ Texto | SVG | Imagen ]**; "Imagen" acepta PNG/JPG/JPEG (la firma decide, no la extensión ni el MIME). Panel de
conversión con preview 2D **Original / Máscara / Recorrido**, modo de detección (Automático / Transparencia / Luminosidad;
un JPEG muestra "Luminosidad"), umbral con el valor Otsu detectado, Contraste, Invertir, Limpieza, «Eliminar ramas menores
de N mm», Simplificación, Suavizado y estadísticas (recorridos, bifurcaciones, extremos, longitud y +5 %). Recalcula con
debounce (200 ms) y muestra «Analizando imagen…». Un JPEG recién cargado arranca con limpieza media (artefactos de
compresión); son los mismos controles que PNG.

### 27.4 Errores y límites

Archivo <= 10 MB; lado <= 8192 px y <= 40 megapíxeles (leídos del IHDR/SOF ANTES de decodificar); EXIF de JPEG aplicado.
Mensajes: imagen inválida/dañada, demasiado grande, sin foreground ("probá Umbral/Invertir"), foreground casi total,
limpieza que borró todo, skeleton vacío (p.ej. un círculo sólido: no tiene línea central), y «Esta imagen es demasiado
compleja para generar un recorrido Neon limpio. Usá un logo, dibujo o imagen de alto contraste.» cuando hay > 150
componentes, > 2500 aristas de grafo o > 400 recorridos (aviso previo a partir de 40 componentes / 120 recorridos).
Una fotografía no se convierte "inteligentemente": da ese error o un aviso.

### 27.5 Rendimiento (medido)

2000×1500 px con un logo complejo -> ~250-370 ms en Node (resolución de trabajo 1028×449); decodificar suele ser lo más caro
y se cachea por identidad de los bytes. **No se introdujo Web Worker** (no hizo falta medido); si en el futuro las imágenes
o la resolución de trabajo crecen, el orquestador es puro y se puede mover a un Worker sin cambios.

### 27.6 Proyectos (migration `20260920120000_maker_neon_projects.sql`, NO aplicada)

Reusa `maker_projects`; los proyectos Neon usan `source_type` con prefijo `neon-` (`neon-text|neon-svg|neon-png|neon-jpg`),
así que Carteles (que ahora filtra por sus propios tipos) no los lista ni los rompe. Se guarda el ORIGEN (texto, o el archivo
en el bucket privado `maker-projects` como `source.png|jpg|svg`) y la receta: alto del diseño, parámetros del canal,
fuente/espaciado (texto y `<text>` de SVG) y `RasterSettings` completos (`detectionMode`, umbrales, `invert`, `contrast`,
`cleaning`, `pruneMm`, `simplify`, `smoothing`). **Nunca** el skeleton ni los NeonPaths: al abrir se descarga el original y
se repite el pipeline (mejoras futuras del motor reprocesan proyectos viejos). Lectura tolerante (campos faltantes o fuera de
rango -> defaults). La migration amplía el CHECK de `source_type` y agrega `image/jpeg` al bucket (privado, RLS intacta).
**Paso manual**: aplicarla (`supabase db push`/SQL editor) antes de guardar proyectos Neon. Presets: sin cambios (no se
guardan imágenes ni defaults raster en presets).

### 27.7 Diferencias PNG / JPEG

| | PNG | JPEG |
|---|---|---|
| Decodificador | `upng-js` (ya existía) | `jpeg-js` (nuevo, BSD-3, puro JS) |
| Modo | Automático / Transparencia / Luminosidad | siempre Luminosidad |
| Extras | — | orientación EXIF, limpieza media inicial |
| Resto | idéntico: máscara, skeleton, grafo, poda, simplificación, suavizado, canal U | idéntico |

### 27.8 Tests (`tests/maker-neon-raster.test.mjs`, 48; total Neon 104)

Procesamiento (Otsu, luminancia, máscara/invertir, remuestreo, blur, componentes, EDT), propiedades del skeleton (barra ->
un recorrido horizontal, donut -> un lazo, T/+ -> 1 bifurcación, espolón podado, puentes), simplificación/suavizado, pipeline
completo con fixtures programáticos (rectángulo, línea gruesa, círculo sólido -> error claro, donut y "O", "8", islas, alpha,
negro/blanco e invertido, Otsu/manual, ruido, espolón, T, márgenes, resolución, escala física), errores y límites (firma,
IHDR/SOF falsificados, > 10 MB, EXIF), calidad con texto real engrosado (Relief "STAMPA"/"neon 8", Mistral "amor": > 95 %
de los puntos a <= 0.9 mm del centerline original), end to end PNG y JPEG -> canal U manifold/watertight -> STL -> cama,
JPEG (calidad 50/20/8, invertido, umbral, PNG vs JPEG equivalentes, contraste, foto -> error/aviso) y proyectos
(serialización, round-trip, tolerancia, repositorio con cliente simulado, migration).

### 27.9 Limitaciones conocidas

- Es un adelgazamiento: en formas muy gruesas respecto de su largo la línea central es una aproximación (círculos/manchas
  sólidas no tienen recorrido); los cruces gruesos pueden desplazar ligeramente la bifurcación.
- Sin color, múltiples capas ni fondos con degradé o fotografías (error o aviso de complejidad).
- El "alto del diseño" de una imagen es el del foreground (incluye el grosor del trazo original); el canal impreso suma su
  ancho exterior, como en texto/SVG.
- Un JPEG progresivo o con perfil de color raro se lee por `jpeg-js` (CMYK y algunos formatos raros dan error claro).
- Sin edición del skeleton, ni puentes automáticos entre letras, ni división por cama.
- Verificación visual de la página completa en navegador no realizada (requiere sesión de plataforma).

### 27.10 A futuro (NO implementado)

El mismo pipeline sirve para convertir un **SVG relleno** en recorrido: `SVG fill -> render a máscara -> skeleton ->
NeonPaths`. `rasterToNeonPaths` ya recibe una `RasterImage`, así que solo haría falta rasterizar el SVG (fuera de este sprint).

## 28. Jarros 3D (0.1) — `/stampa-maker/jarros`

Tercera herramienta de Stampa Maker. Un **motor paramétrico independiente** (`src/lib/maker/mugs/`, sin importar la
geometría de Carteles ni de Neon; un test lo verifica). NO es un cilindro con asa: cuerpo revolucionado con cavidad
real, asa barrida y unida topológicamente, y modificadores combinables.

```
MugDefinition -> validateMug -> planMugBody (perfil 2D) -> revolveProfile (con ventanas de unión)
              -> buildHandle (loft pegado a las ventanas) -> malla indexada única -> soup + métricas -> preview / cama / STL
```

### 28.1 Arquitectura y archivos

```
src/lib/maker/mugs/
  types.ts                MugDefinition, MugDesignProposal (futura IA), MugDecoration (futuro), MugMetrics, MugIssue
  defaults.ts             DEFAULT_MUG, deriveHandleDefaults, normalizeMugDefinition (lectura tolerante)
  presets.ts              presets de SISTEMA = recetas (MugRecipe) + applyMugRecipe
  createMug.ts            orquestador: createMug(def, {quality, printer}) -> MugResult
  body/profiles.ts        radio exterior continuo por estilo (recto/cónico/barril/abombado)
  body/createMugBody.ts   planMugBody: perfil 2D (exterior, borde, interior, piso), radiusAt, calidad
  handle/handlePaths.ts   eje central plano: clásica (Bézier cúbica), cuadrada, angular
  handle/createHandle.ts  ventanas de unión + loft
  modifiers/bands.ts      bandas; modifiers/ribs.ts  facetas y ranuras
  geometry/mesh.ts        malla indexada, analyzeMesh (cerrada/manifold/orientada), meshToSoup (normales con ángulo de pliegue)
  geometry/revolveProfile.ts   revolución robusta con polos y hueco (skipQuad)
  geometry/sweep.ts       polilíneas redondeadas, remuestreo, marcos de barrido
  geometry/merge.ts       loft entre dos anillos ya existentes de la malla
  validation/validateMug.ts    errores (bloquean) y warnings (imprimibilidad)
  metrics/capacity.ts     capacidad geométrica aproximada
  projects/mugProjectData.ts   serialización a maker_projects
src/hooks/maker/useMugGeometry.ts (debounce 150 ms, calidad preview), useMugProjects.ts
src/components/maker/MakerMugControls.tsx, src/app/stampa-maker/jarros/page.tsx
tests/maker-mugs.test.mjs (45 tests)
```

Se reutiliza: `MakerViewport` (+ prop `helperMesh`, ver 28.9), Vista Cama (`bedLayout`, A1 256³), `exportWord`/`partFileEntries`
(una pieza `body` -> `jarro.stl`), `SegmentedControl`/`NumberField`, `MakerNeonProjectsPanel` (ahora acepta `emptyText`/`showType`),
`makerRepository`. **Sin dependencias nuevas.**

### 28.2 `MugDefinition` (única fuente de verdad)

`mode` (`printed` | `insert-shell`), `heightMm`, `top/bottomDiameterMm`, `wall/bottomThicknessMm`, `bodyStyle`
(`straight|conical|barrel|bulged`), `bodyBulgePct`, `rim` (`simple|thick|rounded`), `base` (`normal|reinforced`),
`surface {style: smooth|faceted, sides}`, `grooves {enabled,count,depthMm}`, `bands {enabled,count,heightMm,reliefMm}`,
`handle {enabled,style,auto,heightMm,projectionMm,thicknessMm,sectionWidthMm,verticalPositionPct}`, `insert {heightMm,
top/bottomDiameterMm, clearanceMm}`, `decorations[]` (reservado, vacío). La UI y los presets SOLO editan este objeto; la
geometría sale únicamente de `createMug`. La calidad (`preview`/`export`) es una opción del motor, no parte de la definición.

Defaults: printed, 150 alto, 90 sup., 82 inf., pared 2.4, base 4, asa clásica automática.

### 28.3 Perfil, revolución y pared interior

- Perfil exterior `r(z)` continuo: recto = radio medio; cónico = lineal base→boca; barril = lineal + `sin(π·t)`;
  abombado = lineal + `1 − |2t−1|^2.6` (pendiente finita en base y boca, más lleno que el barril). Diámetros de base y boca
  se conservan siempre. Máximo abombado: barril 20 %, abombado 26 % del radio medio × `bodyBulgePct`.
- El perfil 2D `(r, z)` es un contorno abierto de eje a eje (piso exterior → pared → borde → pared interior → piso interior)
  y `revolveProfile` lo gira alrededor de Z (Z vertical, asa hacia +X). Los puntos con `r = 0` son polos (un solo vértice,
  sin triángulos degenerados). Un vértice compartido por fila/columna: la malla nace **cerrada y manifold** por construcción.
- **Pared interior (aproximación V1):** `r_in(z) = r_out(z) − wall·√(1 + r_out'(z)²)`: espesor **normal** a la pared para
  pendientes suaves (exacto en recto/cónico; en tramos muy curvos no se compensa la curvatura). La pared exterior conserva
  siempre >= `wall` porque todos los modificadores son **aditivos hacia afuera**.
- Base reforzada: piso ×1.5 + empalme cuarto de círculo (r <= 6 mm) en la esquina interior. Ignorada en modo inserto.
- Bordes: simple (cierre plano), grueso (el interior se cierra hasta 0.6·pared en los últimos 5 mm, dimensiones exteriores
  intactas; en modo inserto engorda hacia AFUERA para no tocar la cavidad), redondeado (semicírculo de 8 segmentos).
- Resolución: preview = filas de 2 mm y 72 segmentos; export = 0.75 mm y 192 (el STL se regenera aparte al descargar).
  Los segmentos son múltiplo de `2×lados` y `2×ranuras` para que esquinas/valles caigan en vértices.

### 28.4 Modificadores (combinables, no excluyentes)

Todos suman radio (>= 0) sobre el perfil, ponderados por `mw` del punto: bandas (meseta con flancos de coseno, distribución
uniforme entre 12 % y 88 % de la altura, siguen el radio local), ranuras (sinusoide; valle = radio base, cresta = +profundidad,
atenuadas cerca de base y boca) y facetado (polígono con la **apotema** en el radio base, esquinas a `R/cos(π/n)`; una cara
plana mira al asa). La cavidad interior es siempre redonda y no cambia con los modificadores (la capacidad tampoco).

### 28.5 Asa y unión asa/cuerpo (sin CSG)

Se evaluó CSG y se descartó: dos shells intersectadas no dan un STL válido y una dependencia CSG robusta es grande. En su
lugar la unión es **topológica**:

1. En la pared exterior se omiten los cuadriláteros de una **ventana rectangular** ancha (semi-alto >= 8 mm y semi-ancho
   >= 8 mm) arriba y abajo (`skipQuad`).
2. El asa es un **loft** cuyos anillos primero y último son *exactamente* los vértices del borde de esas ventanas (mismos
   índices: la superficie del asa y la del cuerpo comparten vértices, sin costura ni gaps).
3. Cada anillo pasa gradualmente (smoothstep, hasta 14 mm) de la ventana a la sección **oval** (ancho × espesor). Eso da
   las zonas de unión anchas (attachment bosses) y una sección ergonómica.

Recorrido plano en XZ con marcos exactos (sin torsión): `classic` = Bézier cúbica con tangentes horizontales (C suave),
`square` = rectángulo de esquinas redondeadas, `angular` = quebrada con esquinas suaves. `projectionMm` = distancia máxima del
eje central al cuerpo. `auto = true` deriva altura (60 % del jarro, máx. 110), proyección (46 % del diámetro máximo) y
posición (55 %); la UI las muestra. Los tests verifican: una sola componente conexa, sin aristas de borde ni no-manifold.

### 28.6 Modo "Carcasa para inserto"

La cavidad es el inserto + holgura por lado (`r_in = insert/2 + clearance`, base a `bottomThickness`), la carcasa suma `wall`
(normal) y, si el estilo es barril/abombado, volumen exterior. Altura total = base + altura del inserto. La UI muestra el
**diámetro interior resultante**. El *insert helper* (`MugResult.insertHelper`) es una malla aparte, semitransparente, que
**no** entra en `geometry`, en la cama ni en el STL (toggle «Mostrar inserto»). Sin claims regulatorios ("food safe").

### 28.7 Métricas y validación

- Capacidad geométrica aproximada = suma de troncos de cono del perfil interior hasta el borde (`π·h·(r1²+r1r2+r2²)/3`); se
  llama así porque no descuenta menisco ni volumen útil. Volumen de material por integral de la malla (divergencia). Sin peso.
- Errores (bloquean): espesores <= 0, rangos, radio interior < 3 mm, base demasiado alta, bandas que no entran, holgura
  negativa, espesor de asa < 3 mm, proyección que entra en el cuerpo, asa que no cabe en la pared o demasiado corta.
- Warnings (no bloquean): pared < 1.2 mm, asa muy fina (< 6 mm), diámetro > cama, altura > Z de la impresora.

### 28.8 Proyectos y presets

Proyectos: `maker_projects.source_type = 'mug'`, `source_data.definition = MugDefinition`, sin Storage. Carteles (`text|svg|png`)
y Neon (`neon-*`) filtran por sus propios tipos y nunca ven los proyectos Jarro. **Migration nueva (NO aplicada al remoto):**
`supabase/migrations/20260921120000_maker_mug_projects.sql` amplía el CHECK de `source_type`. Hasta aplicarla, guardar un
proyecto Jarro falla con el mensaje comprensible del repositorio.

Presets: 5 de sistema (Clásico, Barril, Taberna, Geométrico, Industrial) = `MugRecipe` aplicada con `applyMugRecipe`; no
pisan modo ni dimensiones. **Presets de usuario:** arquitectura preparada (misma forma `MugRecipe`), no persistidos en 0.1.

### 28.9 Viewport, Cama y STL

`MakerViewport` gana la prop `helperMesh` (solo Modelo, `depthWrite: false`, fuera de `partMeshesRef`, del auto-fit y de la
cama). Cama: el jarro es una pieza `body` (orientación identidad, minZ = 0, apoyado sobre la base); se validan X/Y y altura Z
con el perfil A1. Exportar: `createMug(def, {quality: "export"})` -> `exportWord` -> un solo `jarro.stl` (X/Y mínimos en 0).

### 28.10 Futuro (NO implementado)

- **IA:** implementada en 0.3 (sección 30): `prompt -> MugDesignProposal -> applyMugDesignProposal -> validateMug -> createMug`. La propuesta nunca arma geometría.
- **Branding/texturas (0.2+):** `MugDefinition.decorations[]` (implementado en 0.2, sección 29): texto, SVG, logos, relieves, ruido, Voronoi y
  heightmaps se sumarían como modificadores sobre `radiusAt`, sin cambiar el pipeline.

### 28.11 Limitaciones conocidas (0.1)

- La UI no se pudo validar visualmente en esta sesión (la ruta exige login); el motor, la malla, tsc y el build sí están verificados.
- El offset interior no compensa curvatura (28.3). En modo inserto, `Recto` sigue la conicidad del inserto.
- El asa siempre está a +X y es plana (recorrido en el plano XZ); la sección siempre es oval. Ranuras atenuadas cerca del borde.
- El STL de alta calidad (~185 k triángulos con asa) se genera de forma síncrona (~0.3 s) solo al descargar.
- No hay editor de posiciones de bandas, ni tapa, ni múltiples piezas, ni peso estimado.

## 29. Jarros 0.2 — Personalización (texto, SVG, PNG/JPG)

Decoraciones sobre el cuerpo del jarro como **relieve**, **grabado** o **medallón**, que **siguen la superficie real** (se
envuelven; no son una placa delante del jarro). Se integran *durante la construcción del cuerpo* como un desplazamiento
radial de la misma superficie: **sin CSG**, una sola malla cerrada/manifold, mismo STL. Sin IA (0.3).

```
Texto / SVG / PNG-JPG -> Artwork (etapa 1, cacheada por contenido)
  -> DecorationField (SDF 2D en mm, etapa 2, cacheado por contenido + tamaño + resolución)
  -> mapeo superficial (ángulo, arco vertical, radio local, rotación)
  -> desplazamiento radial con bevel -> radiusAt() del cuerpo -> malla -> STL
```

### 29.1 Modelo `MugDecoration` (serializable, sin React, apto para IA)

`MugDefinition.decorations: MugDecoration[]` (máx. 10). Cada una: `id`, `name`, `enabled`, `source`, `mode`
(`emboss|engrave|medallion`), `position {angleDeg, centerZMm}`, `size {widthMm, heightMm, lockAspectRatio}`,
`rotationDeg`, `depthMm`, `edgeBevelMm`, `medallion {shape: oval|circle|rounded-rect, baseDepthMm, paddingMm, cornerRadiusMm}`.
`source` es una unión: `text {text, fontId, align}`, `svg {assetId, fileName}`, `raster {assetId, fileName, format, detection,
threshold, invert}` o `none` (solo medallón liso). **Los archivos nunca van dentro de la definición**: solo `assetId`.
`normalizeDecorations` (lectura tolerante) se ejecuta dentro de `normalizeMugDefinition`: proyectos 0.1 (sin `decorations`)
siguen abriendo. **Futura IA (0.3):** `prompt -> MugDesignProposal { definition, decorations } -> normalizeMugDefinition ->
validateMug -> createMug`; un arte generado se registraría como un asset más. Cubierto por un test ("futura IA").

### 29.2 Archivos

```
src/lib/maker/mugs/decorations/
  decorationDefaults.ts    createDecoration, normalizeDecorations, límites (10 decoraciones, grabado: margen 1 mm)
  artwork.ts               etapa 1: prepareTextArt / prepareSvgArt / prepareRasterArt -> Artwork (vector | máscara)
  artworkProvider.ts       MugAsset, createArtworkProvider (cache por contenido), artworkKey
  field.ts                 rasterizeArtwork, fieldFromMask, getDecorationField (cache LRU), sampleSd
  evaluator.ts             ángulos semánticos, coverage/bevel, SDF del medallón, resolveDecorations, createDecorationEvaluator
  validateDecorations.ts   fase 1 (rangos, grabado, texto/archivo) y fase 2 (ancho, margen seguro, asa)
src/hooks/maker/useMugArtwork.ts (assets + fuentes + proveedor), useMugGeometry.ts (recibe el proveedor), useMugProjects.ts (assets en Storage)
src/components/maker/MakerMugDecorationsPanel.tsx (lista + editor), MakerMugControls.tsx (slot `decorationsPanel`, después de ASA)
tests/maker-mug-decorations.test.mjs (46 tests)
```

### 29.3 Representación 2D común: `DecorationField`

Texto, SVG e imagen terminan en la misma cosa: un **campo de distancia con signo** (mm, positivo dentro de la silueta) en
una grilla centrada en el origen local (x derecha, y arriba), evaluado con `sampleSd` (bilinear). Se reutiliza la
`distanceTransform` exacta de Neon raster (Felzenszwalb, dos pasadas: dentro y fuera) — no hay un algoritmo duplicado. Un
único motor de relieve/grabado evalúa cualquier fuente y el bevel sale de la distancia.

- **Resolución:** `resolución de campo` = 0.5 mm/px (preview) y 0.25 mm/px (export), grilla acotada a 8–768 px por lado
  (el costo depende del detalle, no del tamaño absoluto). Determinístico: misma entrada = mismo campo.
- **Cache:** etapa 1 (`Artwork`) por contenido (texto+fuente+alineación, `assetId`, ajustes raster): mover, escalar, rotar o
  cambiar profundidad **no** re-parsea el SVG ni re-decodifica la imagen. Etapa 2 (campo) por contenido + grilla + medidas
  (LRU de 32): mover / profundidad / bevel / rotación reutilizan el campo; cambiar el tamaño lo reconstruye (ms).
- Con proporción desbloqueada la distancia es isotrópica con la escala media (aproximación; el bevel puede diferir < 1 %).

### 29.4 Pipelines de fuente

- **Texto:** `opentype.js` + `textToOpentypePath` + `flattenOpentypePath` de Carteles y las fuentes normales de Maker
  (Montserrat / Montserrat Bold; **no** las single-line de Neon). Siluetas rellenas (`nonzero`). Mayúsculas, minúsculas,
  números, tildes, Ñ y símbolos comunes. **Multi-línea real** (hasta 4 líneas, 80 caracteres) con alineación
  Izquierda/Centro/Derecha por ancho de tinta; vacío / demasiadas líneas se rechazan con mensaje; caracteres sin glifo se
  omiten con aviso.
- **SVG:** el importador **seguro** de Carteles (`extractSvgShapes`: parser XML propio sin DOM; `path/rect/circle/ellipse/
  polygon/polyline` con fill, transforms anidados, viewBox, `<use>`, `fill-rule`; rechaza script, foreignObject, recursos
  externos, handlers, `javascript:`). Cuentan los **rellenos**. **Stroke:** el importador ignora los trazos y **no** se
  convierten a forma en 0.2 (no hay offsetting robusto en ese importador): un SVG solo de trazos falla con un mensaje claro;
  hay que convertir el trazo a contorno en el editor vectorial.
- **PNG/JPG/JPEG:** decoder y utilidades de Neon 0.2 (`decodeRasterImage`, EXIF, Otsu, `foregroundMask`). Detección
  Automática (alpha si hay transparencia significativa, si no luminosidad) / Transparencia / Luminosidad, umbral (auto = Otsu
  o 128 en alpha), invertir. **Silueta completa, sin skeleton**, recortada al contenido y acotada a 1024 px.
  UI: vista previa «Original | Máscara».

### 29.5 Sistema de coordenadas superficial

Convención **semántica** (la única que ve la UI y la IA): **0° = frente, +90° = derecha (lado del asa), 180° = atrás,
−90° = izquierda**. Internamente el asa vive en +X (θ = 0) y el frente mira a −Y, así que **θ = angleDeg − 90°**
(`semanticToTheta` / `thetaToSemantic`). Crece en el mismo sentido en que se lee un texto visto de frente. Los accesos
Frente / Atrás / Izquierda / Derecha solo cambian `angleDeg`. Vertical = `centerZMm` desde la base (rango 0–altura).

### 29.6 Algoritmo de wrap y perfiles variables

Para cada vértice de la pared exterior `(z, θ)`: `Δθ` se envuelve a (−π, π] (**sin costura en ±180°**);
`u = Δθ · r_local(z)`; `v = arco(z) − arco(centro)`; rotación en el plano (u, v) **antes** del envolvimiento; se evalúa el
campo en (x, y) locales.

- `r_local(z)` es el radio de la **superficie ya modificada** (perfil + bandas + facetas), no el del perfil base: en
  cónico, barril y abombado el mismo logo subtiende ángulos distintos según la altura (test de barril).
- `v` es **longitud de arco del perfil** (no Δz) y el desplazamiento es `depth · √(1 + r′(z)²)`: profundidad **normal** a
  la pared (misma regla que la pared interior). Aproximación: el desplazamiento es radial (no se corre en z); exacta en
  paredes rectas y muy buena en las suaves. Se documenta el límite en pendientes extremas.
- **Facetado:** se usa el radio angular medio del polígono (`tan(π/n)/(π/n)`) para el mapeo tangencial y el desplazamiento
  se suma **sobre la superficie facetada real** (apotema + extra de faceta): el relieve no flota entre caras ni hay un
  segundo sistema para facetas. Aproximación: `u` es lineal en Δθ (el arco real de una cara plana no es uniforme).

### 29.7 Relieve, grabado, medallón y bevel

- **Relieve:** `+depth` (default 1.5 mm) sobre la superficie exterior. El interior no cambia.
- **Grabado:** `−depth` (default 1.0 mm). **Nunca atraviesa la pared:** `depth < pared − 1.0 mm` (`ENGRAVE_SAFETY_MM`); si no,
  error «El grabado dejaría una pared demasiado fina.» (bloquea). Como todos los modificadores solo suman, la pared local
  nunca es menor que `pared − depth`. Vale también en modo inserto.
- **Bevel** (default 0.4 mm, 0 = recto): cobertura `smoothstep(sd / bevel)` dentro de la silueta (0 en el borde real, 1 a
  `bevel` mm hacia adentro): la silueta no se agranda y la pared del relieve no es vertical.
- **Medallón:** base envuelta (óvalo / círculo / rectángulo redondeado, SDF analítico, sin raster) con `baseDepthMm` (1.5 mm)
  + arte encima (`depthMm`, 1 mm) ajustado dentro del medallón menos `paddingMm`. Modelo: `backingField + artworkField`;
  también existe el medallón liso (`source: none`). `size` es el del medallón.
- **Interior:** relieves y grabados **no** cambian la cavidad; en modo inserto la envolvente interior y el helper son
  idénticos con/sin decoración (test).

### 29.8 Múltiples decoraciones, superposición y orden de modificadores

Pipeline del radio exterior: **perfil base → facetas/ranuras/bandas → decoraciones → radio final**. Una decoración que
cruza una banda sigue la superficie ya modificada (test: banda 1.5 + logo 1 = R + 2.5).
Superposición, determinística por orden de stack (primera = fondo): relieve+relieve = **máximo**; grabado+grabado = **el más
profundo**; relieve/grabado = **la posterior gana** (se mezcla linealmente en su bevel). El orden se cambia con ↑/↓.

### 29.9 Validación y avisos

Errores (bloquean): >10 decoraciones, rangos (ancho/alto 3–300, profundidad 0.1–5, bevel 0–5, rotación ±180°, altura 0–H),
texto vacío, falta de archivo, grabado demasiado profundo, más ancha que el contorno del jarro (95 % de la circunferencia).
Warnings (no bloquean, la malla sigue válida): margen seguro de **5 mm** a la boca y a la base, y «Parte de la decoración se
superpone con la zona del asa» (no se recorta automáticamente). Una decoración cuyo arte no está disponible (archivo o
fuente sin cargar) se omite con aviso.

### 29.10 Resolución de malla

Sin decoraciones la malla es **exactamente la de 0.1** (test: mismos 21 600 triángulos). Con decoraciones se afina el cuerpo:
paso máximo de filas y de arco de **1.2 mm (preview)** / **0.55 mm (export)**, con techo de 450 filas y 900 segmentos (los
segmentos siguen siendo múltiplo de 2×lados y 2×ranuras; el helper del inserto conserva su resolución base). Medido en esta
máquina: preview de regeneración ≈ 40 ms (~130 k triángulos) y export ≈ 190 ms (~640 k triángulos); no hizo falta Web Worker.

### 29.11 Proyectos y assets

`maker_projects.source_type = 'mug'`; `source_data = { definition (con decorations[]), assets: MugAssetRef[] }`. Cada asset
(`assetId` uuid inmutable) se sube **una vez** al bucket privado `maker-projects` en
`{user}/{project}/assets/{assetId}.{svg|png|jpg}` (`uploadProjectAsset`); las policies de Storage solo exigen la primera
carpeta = dueño, así que **no hace falta migration nueva** (la de 0.1, `20260921120000_maker_mug_projects.sql`, sigue
pendiente de aplicar). Guardar sube solo assets nuevos y limpia (best-effort) los que ya no usa ninguna decoración; abrir
descarga los originales y **reconstruye el campo** con el motor vigente (nunca se guarda el raster/SDF procesado); eliminar
el proyecto borra sus assets. Cualquier cambio de decoración (texto, profundidad, posición, tamaño, archivo, ajustes)
cambia la firma y marca el proyecto como modificado. Carteles/Neon no se tocaron (`makerRepository` solo suma funciones).
El texto se guarda como `text + fontId + align` (sin archivo).

### 29.12 Exportación y Cama

El STL es la misma malla única del preview en calidad export: cuerpo + asa + bandas + ranuras + relieves + medallones +
grabados. No se exporta ni la imagen original ni el helper ni overlays. Vista Cama = geometría final decorada.

### 29.13 Limitaciones conocidas (0.2)

- La UI no se pudo validar visualmente en esta sesión (la ruta exige login): motor, tests, `tsc` y build sí están verificados.
- SVG solo de trazos no se convierte (29.4). Sin dibujo de bordes de texto con contorno (solo relleno).
- Desplazamiento radial (no normal exacto) y mapeo tangencial lineal en Δθ sobre facetas (29.6).
- Unlock de proporción usa distancia isotrópica media (29.3). Una decoración más ancha que ~95 % del contorno se rechaza.
- Con decoraciones la malla es densa (≈ 130 k tri preview / ≈ 640 k export); el STL export pesa ≈ 30 MB.
- Sin presets decorativos (la arquitectura los permite: una receta podría incluir `decorations[]`), ni reordenar por
  drag & drop (botones ↑/↓), ni texto en arco / sobre curvas.

---

## 30. Jarros 0.3 — AI Design Planner ("Diseñar con IA")

El usuario describe el jarro en lenguaje natural y el modelo **configura el motor paramétrico existente**. La IA no genera
STL, mallas ni geometría: solo propone parámetros de `MugDefinition` / `MugDecoration[]` dentro de un schema cerrado.

```
prompt -> [server action] planMugDesign -> modelo (structured output) -> sanitizeMugDesignProposal
       -> MugDesignProposal -> diff + preview (sin dirty) -> el usuario acepta
       -> applyMugDesignProposal -> MugDefinition -> validateMug -> createMug -> STL
```

### 30.1 Archivos

```
src/lib/maker/mugs/ai/
  types.ts             MugDesignProposal, MugPatch, MugDecorationOp, MugDesignRequest/Result, MUG_AI_SCHEMA_VERSION (= 1)
  schema.ts            FUENTE ÚNICA: enums (importados de defaults/decorationDefaults) + rangos -> JSON schema strict,
                       bloque de límites del prompt y sanitizador
  prompt.ts            system prompt (solo server), mensaje de usuario, normalizeMugAiPrompt
  sanitizeProposal.ts  sanitizeMugDesignProposal (única puerta de entrada de la salida del modelo)
  applyProposal.ts     applyMugDesignProposal (PURA), resolveAssetChoice, pendingAssetChoices
  diff.ts              diffMugDefinitions -> [{group, label, before, after, kind}]
  planner.ts           planMugDesign(request, complete) (retry, errores) — sin OpenAI/Supabase, testeable con mocks
  rateLimit.ts         checkMugAiRateLimit
src/app/stampa-maker/jarros/actions.ts   designMugWithAiAction (auth + membresía + rate limit + OpenAI + log)
src/components/maker/MakerMugAiDesigner.tsx   UI (sin lógica geométrica)
tests/maker-mug-ai.test.mjs                   28 tests, sin red
```

`defaults.ts` y `decorations/decorationDefaults.ts` ahora exportan sus arrays de enums (`MUG_BODY_STYLES`, `MUG_HANDLE_STYLES`,
`MUG_DECORATION_MODES`, …) para no duplicarlos. El antiguo tipo placeholder `MugDesignProposal {prompt, definition: unknown}` de
`types.ts` se reemplazó por el de `ai/types.ts`.

### 30.2 Infra reutilizada

- SDK `openai` ya instalado y `OPENAI_API_KEY` (la misma que Stampy). Modelo: `MUG_AI_MODEL` → `OPENAI_MODEL` → `gpt-4o-mini`.
  Llamada `chat.completions.create` con `response_format: json_schema, strict: true`; timeout 45 s, `maxRetries: 0`.
- Auth: `getCurrentUserAccess`; exige `capabilities.useStampy` (membresía/grant activos): `authenticated != paid`.
- Rate limit: `stampy_usage_logs` (sin migration; la CHECK de `mode` solo admite `openai|error|blocked|direct`). Cada llamada deja una
  fila con `model = "mug-designer:<modelo>"`; se cuentan por usuario, 15/h y 60/día (`MUG_AI_MAX_PER_HOUR`, `MUG_AI_MAX_PER_DAY`).
  **Acople conocido:** el limitador de Stampy cuenta todas las filas del usuario, así que estas también consumen su cupo.
- No se agregó ninguna dependencia (no hay Zod en el repo; el schema es propio y se valida en runtime en `sanitizeProposal.ts`).
- No hay infraestructura de analytics en el proyecto: no se agregaron eventos.

### 30.3 Contrato (structured output)

Objeto plano con todos los campos requeridos y `null` = "no especificado": `mode` (`full|patch`, debe coincidir con el pedido),
`name`, `description`, `mugMode`, grupos `dimensions | body | grooves | bands | handle | insert`, `replaceDecorations`,
`decorations[]` (ops `add|update|remove` con `sourceKind: text|asset|none`), `warnings[]`, `unsupportedRequests[]`.
El JSON schema se genera desde `MUG_PATCH_FIELDS`/`DECORATION_FIELDS`. Los rangos reflejan `validateMug` (un test comprueba que los
extremos del schema nunca disparen errores `RANGE`); si se cambian los límites del validador hay que actualizar `schema.ts`.

### 30.4 Sanitización (la IA nunca es trusted)

- Campos desconocidos descartados; `mode` distinto al pedido, no-objeto o propuesta vacía (sin cambios ni unsupported) → inválida.
- Enum desconocido (p. ej. asa `dragon-claw`) → el campo se **ignora con aviso** (nunca cae a otra geometría).
- Números: NaN/Infinity/no numéricos se descartan; el resto se acota al rango y se avisa; enteros redondeados.
- Ángulos: se envuelven a [-180, 180]; |ángulo| > 3600 se rechaza.
- Strings sin caracteres de control; nombre ≤ 60, descripción ≤ 400, notas ≤ 200 (máx. 6), texto de decoración ≤ 80 y ≤ 4 líneas.
- Máx. 10 operaciones de decoración; `update/remove` solo sobre ids existentes.
- Prompt del usuario: 3–1500 caracteres, sin control, delimitado en `<pedido_del_usuario>` (tratado como dato).

### 30.5 Full vs patch

Unión discriminada por `mode`, elegida por el usuario en la UI (no se infiere). **patch**: parte de la definición actual y solo cambia
lo propuesto. **full**: parte de `DEFAULT_MUG` pero conserva **modo (jarro/inserto), medidas del inserto y decoraciones actuales**;
las decoraciones solo se reemplazan si `replaceDecorations = true` y el panel lo avisa explícitamente antes de aplicar.
`applyMugDesignProposal` además reconcilia: pedir N bandas/ranuras las activa (0 bandas = desactivadas), bandas que no entran se reducen,
tocar altura/proyección/posición del asa la pasa a manual derivando lo no dicho del tamaño del jarro, y cada decoración se acota
(altura, profundidad de grabado < pared − 1 mm, ancho ≤ 85 % del contorno). La física final sigue siendo de `validateMug`; la UI
deshabilita "Aplicar" si la propuesta genera errores.

### 30.6 Decoraciones, logos y no soportado

- "Que diga X" → `text`/`emboss`/`angleDeg 0` (determinístico). Fuente por defecto Montserrat Bold, centrado.
- Assets (SVG/PNG/JPG ya cargados): el modelo solo recibe id/tipo/nombre (nunca el contenido). Un único asset → se usa; varios y sin
  id válido → `needsAssetChoice` y la UI pide elegir (no se adivina); ninguno → aviso "cargá un logo". No se analiza el contenido de imágenes.
- `unsupportedRequests` (texturas, escultura, tapas, etc.) se muestran en un bloque "Todavía no disponible"; una propuesta que solo
  contiene eso es válida y no cambia nada.
- Insert mode: la IA puede pedir `insert-shell`; si no da medidas del inserto se conservan las actuales.

### 30.7 UX

Botón "✨ Diseñar con IA" (arriba del panel lateral; en mobile el panel se apila, sin overflow) → panel expandible: modo (desde cero /
modificar), textarea con contador, chips de ejemplo (solo rellenan el prompt), "Generar diseño" / "Modificar con IA". La propuesta se
muestra como ANTES → DESPUÉS (`diffMugDefinitions`, sin JSON) con `Ver propuesta` (preview temporal), `Aplicar diseño`, `Regenerar`,
`Cancelar`. **Preview = `previewDef` en la página**: solo cambia lo que se dibuja; `def`, el estado "modificado" del proyecto y la
descarga STL no se tocan (la descarga se deshabilita mientras hay preview). Aplicar sí reemplaza `def` (dirty). Tras aplicar, el
panel pasa a modo "¿Qué cambiarías?" (patch sobre la definición actual). Accesibilidad: labels, `role=status/alert`,
`aria-expanded/pressed`, botones deshabilitados. La IA solo se llama en acciones explícitas (nunca al mover sliders). Doble submit
bloqueado; "Cancelar" descarta la respuesta en curso (el server action no se puede abortar: la llamada termina y se ignora).

### 30.8 Errores y persistencia

Códigos: `auth`, `membership`, `rate_limit`, `prompt`, `unavailable` (proveedor/clave/429/5xx), `timeout`, `invalid`, `unknown`, con
mensajes en español que no filtran detalles. Salida inválida → 1 reintento automático (informando el problema) y luego `invalid`. Ante
cualquier error el diseño actual no se toca. **Persistencia:** solo la `MugDefinition` (`source_data.definition`); no se guarda prompt,
propuesta ni historial (`aiDesignSchemaVersion` viaja en la respuesta/propuesta, no en el proyecto). Abrir un proyecto nunca llama a la IA.

### 30.9 Preparado para el futuro (NO implementado)

Jarros 0.4 (concept image → interpretación paramétrica) y decoración IA (prompt → imagen/SVG → `MugDecoration`) encajan como nuevas
entradas del mismo pipeline: la propuesta ya referencia assets por id y `MugDecorationOp.add` acepta cualquier `MugDecorationSource`.
Fuera de alcance: text/image-to-3D, visión, generación de SVG/PNG, historial conversacional persistente, formas escultóricas.

### 30.10 Limitaciones conocidas (0.3)

- UI no verificada visualmente ni contra el proveedor real (la ruta exige login/membresía y clave); lógica, tests, `tsc` y build sí.
- Los rangos de `schema.ts` duplican los de `validateMug` (protegido por test, no derivado).
- El rate limit comparte tabla/cupo con Stampy (30.2). Cancelar no aborta la llamada al proveedor.
- Coste por generación con `gpt-4o-mini` (~3–4 k tokens de entrada incl. schema, ~0,5–1 k de salida): del orden de USD 0,001. Es una
  estimación a partir de tarifas públicas, no medida con esta infraestructura.

---

## 31. Jarros 3D — Status: Beta / Admin Only (desarrollo pausado)

Jarros 3D queda **congelado temporalmente**: sigue funcionando completo (motor, decoraciones, IA, proyectos, STL) pero solo para
administradores y marcado BETA. No se eliminó código, geometría, proyectos, tests ni documentación.

- Política: `src/lib/maker/availability.ts` (`MAKER_TOOL_AVAILABILITY`, `canAccessMakerTool`, `visibleMakerTools`). Para reabrir la herramienta
  basta quitar `adminOnly` (y `beta` al salir de beta) de la entrada de Jarros.
- Rol: `getCurrentUserAccess(...).access.capabilities.accessAdmin` (misma infraestructura que `/admin`; no hay un segundo sistema de permisos).
- Landing `/stampa-maker` (server component): usuarios normales no ven la card; el admin la ve con badge "Beta".
- Ruta: `src/app/stampa-maker/jarros/layout.tsx` (server) redirige a `/stampa-maker` si el usuario no es admin.
- `designMugWithAiAction` también exige admin, para que el endpoint no quede abierto a usuarios pagos no-admin.
- Carteles y Neon no cambian. Tests: `tests/maker-availability.test.mjs`.


## 32. Carteles — Sistema de instalación (Installation 0.1)

> Sprint 2026-09-21. Módulo nuevo `src/lib/maker/installation/`; el motor geométrico
> (body/front/joints/modifiers) solo recibe un contexto opcional. Tests:
> `tests/maker-installation.test.mjs` (35). Sin migración: todo vive en el JSON `settings` del
> proyecto/preset. No hay dependencias nuevas.

### 32.1 Principio: el objetivo es que el sistema mecánico sea IMPRIMIBLE

El contacto eléctrico NUNCA lo hace plástico impreso. El usuario hace los empalmes (cable,
soldadura/empalme apropiado, aislación) y Stampa entrega la geometría para **sostener, ordenar,
separar, proteger y aliviar tensión**. No hay bornera/conector/componente comercial en el diseño.
Los cables son helpers visuales y **nunca** entran a un STL. Solo baja tensión DC: no existe
ninguna feature de red 110/220 V dentro de las letras (la fuente AC/DC queda fuera del cartel).

### 32.2 Identidad física de cada letra (`letterInstances.ts`)

`LetterInstance { id, index, char, label, boundsMm, contourGroups, positionInWord }`, una por
carácter con tinta, calculada en `createGeometryFromContourPieces` y expuesta en
`LetterPieceResult.instance`. El id es `L1..Ln` (nunca el carácter). **Etiquetas de visualización
determinísticas**: los caracteres repetidos llevan número de ocurrencia — "STAMPA" ⇒
`S, T, A1, M, P, A2` (elegido `A1/A2`, no `A (3)`). Esa etiqueta es la que usan la plantilla, la
guía de cableado, el kit ZIP y el panel. (El ZIP de "letras individuales" histórico conserva su
nombre `03_A.stl`/`06_A.stl` para no romper la exportación existente; el kit usa `03_A1`/`06_A2`.)
Un SVG/PNG importado es UNA instancia ("Diseño").

### 32.3 Modelo y persistencia

- `InstallationRecipe { mounting, wiring, template }` — configuración **global** (`LetterSignParams.installation`).
  **Viaja en presets** (clave `installation` en `PRESET_SETTING_KEYS`, normalización tolerante propia).
- `InstallationOverrides` — por letra, indexada por `LetterInstance.id` (`LetterSignParams.installationOverrides`):
  posiciones manuales de montaje (`mountPoints`, mm relativos al centro del diseño como los
  `BackCutout`), `mountCount`. **Específico del proyecto**: está en
  `DESIGN_PARAM_KEYS`, NUNCA viaja en un preset; el proyecto lo guarda en `settings.installationOverrides`.
- Proyectos viejos sin estos campos cargan con defaults (`normalizeInstallationRecipe/Overrides`).
- Dirty state: `projectSignature` serializa todo el payload, así que cualquier cambio (montaje,
  separación, puertos, empalmes, cable, dirección, posiciones manuales) marca «Modificado».
- El único cambio a un test existente: `maker-back-cutouts` verificaba que el preset no contuviera
  la cadena `"keyhole"`; ahora la receta de instalación tiene una clave `keyhole` propia, por lo que
  la aserción busca `"type":"keyhole"` (un RECORTE keyhole) — la intención (los recortes no viajan) es la misma.

### 32.4 Auto-layout determinístico y zonas reservadas (`layout.ts`)

`planInstallation()` produce un `InstallationPlan` (posiciones relativas al centro del diseño) que es
la **única fuente de verdad** de motor 3D, plantilla, guía y helpers. Determinismo: grilla fija por
letra (paso ≥ 2 mm), desempates por (x, y), sin aleatoriedad — mismo diseño + mismos ajustes ⇒ mismas
posiciones (test).

Todo feature nace dentro del **núcleo de la cavidad** de la letra (la misma región que usan los
recortes traseros, con margen de borde), es decir sobre material real y nunca en un counter, fuera
de la letra ni en una pared. **`BackFeatureZone`** (`mount | cutout | cable-clip |
cable-port | label`) reserva `footprint + margen`; el layout resta las zonas ya reservadas y los
recortes traseros manuales (margen 1 mm) antes de buscar posición, y una validación posterior detecta
solapes (auto o manuales) entre features y contra recortes manuales:
`ZONES_OVERLAP`, `PORT_INVADES_MOUNT`, `MOUNT_INVALID`, `PORT_INVALID`, `SPLICE_CLIP_INVALID` (ERRORES: bloquean la
exportación) y `MOUNT_NONE`, `MOUNT_FEWER_THAN_TWO`, `CLIP_NO_SPACE`, `PORT_NO_SPACE`,
`REAR_PORT_FLUSH`, `KEYHOLE_DEPTH` (avisos). Falta de espacio en una letra ⇒ aviso (no hay geometría
inválida que bloquear); una `I` estrecha nunca bloquea el cartel.

**Orden de reserva**: montaje → puertos bipolares → etiquetas → retención local (clips).

### 32.5 Montaje

`mounting.type`: `none | keyhole | standoff`, independientes.

**Keyhole** (reusa la geometría de Back Cutouts: `keyholePolygons` + rotación 180°: círculo grande
abajo, cuello arriba). Defaults: cabeza 7 mm, cuello 4 mm, largo de cuello 9 mm, profundidad 4 mm,
margen 2 mm; sin marca de tornillo. Los keyholes son agujeros pasantes en la base (se suman a la
región de recortes). `depthMm` es el espacio libre que necesita la cabeza del tornillo detrás de la
base: se valida contra la cavidad (`KEYHOLE_DEPTH`).

**Cantidad automática** (`autoMountCount`): `2 + floor(maxDim/300)` (máx. 6), derivada del tamaño de
la letra, no de su carácter; override por letra (`mountCount`). Posiciones repartidas hacia los
extremos (12 %..88 % del eje principal, horizontal si `ancho ≥ 0.8·alto`, vertical si no; keyholes
sesgados hacia arriba, para colgar) eligiendo el candidato válido más cercano a cada objetivo con
separación mínima. Una letra ancha nunca queda con un punto si caben dos (aviso
`MOUNT_FEWER_THAN_TWO` si no).

**Separadores impresos (standoff)** — defaults: separación 20 mm, cuerpo Ø12, espiga Ø8, encastre
7 mm, holgura 0.2 mm POR LADO (receptor Ø8.4), agujero de tornillo Ø3.5 (sin marca hardcodeada),
rebaje de cabeza Ø5.8 (0 = sin rebaje), refuerzo 2 mm.

- **Receptor en la letra**: un **boss macizo dentro de la cavidad** (cilindro Ø ≈ 12.4 mm desde la
  repisa hasta `insertDepth + 1.2 mm`) con el **socket** (Ø = espiga + holgura) abierto desde la cara
  trasera Z=0, con chaflán de entrada escalonado (0.6 mm, 3 pasos) y techo cerrado. El encastre no
  depende de los 1.2 mm de base: hay ~8 mm de material alrededor. Es topológico (huellas 2D apiladas
  soldadas por coordenadas compartidas: mismo mecanismo que Back Cutouts/tapered), **sin CSG 3D**;
  manifold, un solo shell por letra (tests).
- **Nada sobresale por detrás de Z=0**: la letra apoya plana sobre la cama y la orientación de impresión no
  cambia. La separación de pared la aportan los separadores.
- **Separador** (`wallSpacer.ts`): cuerpo Ø12 × 20 mm + espiga Ø8 × (encastre − 0.4 mm) con chaflán, agujero
  pasante Ø3.5 y rebaje de cabeza; impreso con la base contra la cama y la espiga arriba (sin voladizos).
  Se exporta como **una sola pieza + cantidad** (`InstallationAuxPart`, `wall-spacer-12x20.stl`, ×N);
  agrupado por geometría (hoy siempre una variante).
- Validación: `pegDiameter < bodyDiameter`, agujero de tornillo con ≥ 0.8 mm de pared en la espiga, rebaje
  mayor que el agujero, boss vs. cavidad disponible (descontando el labio de una tapa encastrable),
  `insertDepth > baseMm`.

### 32.6 Cableado: encadenado físico, PARALELO eléctrico (`wiring.ts`)

`wiring.mode`: `off | chained`; `direction`: `ltr | rtl` (default ltr). El orden depende solo del
índice y la dirección; **los ids no cambian** al invertir, solo el rol. Roles derivados del orden:
primera = alimentación + salida; intermedias = entrada + salida; última = solo entrada.

`WiringModel` (`topology: "parallel"`): dentro de cada letra los terminales `IN+ = LED+ = OUT+` y
`IN- = LED- = OUT-` pertenecen a la misma red; cada tramo de cable une `OUT+→IN+` y `OUT-→IN-` (misma
polaridad, nunca LED→LED). `computeElectricalBuses` (unión-búsqueda) verifica que existan exactamente
**dos buses** (uno + y uno -) y que nunca se toquen; un cruce serie/polaridad es rechazado por
`isParallelWiring` (test explícito). `powerEntry` reserva `usb-c-5v | usb-c-pd` para el futuro; V1 solo expone
«Cable directo + / -» (sin USB-C funcional). El voltaje LED (5/12/24/otro) es solo etiqueta de documentación: no
dimensiona nada eléctrico.

### 32.7 Puerto de cable BIPOLAR — estrategia elegida y por qué

> **Corrección conceptual (2026-09-21, 2ª iteración).** La primera versión del sprint modeló cada entrada/salida
> como UN solo agujero y colocó "alojamientos de empalme" (splice bays) dentro de la parte trasera de cada letra.
> Ambas cosas eran incorrectas para el producto: los carteles usan cableado **bipolar** (entre dos letras siempre
> viajan `+` y `-` juntos) y el empalme ocurre **fuera** de las letras, en el espacio entre ellas. Se eliminaron los
> bays internos, sus zonas reservadas, el ruteo interno, los clips que llevaban hacia ellos y sus ajustes; se
> reemplazaron por el `BipolarCablePort` y el `ExternalSpliceClip` (32.8).

Cada IN / OUT / ALIM es un **`BipolarCablePort`**: una unidad con DOS agujeros circulares paralelos (`○ ○`, `+` arriba y `-`
abajo, visto de frente). Se ubica, valida, reserva (una sola `BackFeatureZone` que cubre ambos agujeros + margen) y se
muestra como un bloque; los agujeros nunca son features independientes. Defaults: **Ø 2.8 mm por agujero y 4.5 mm entre
centros** (`wireHoleDiameterMm`, `holeCenterSpacingMm`, configurables; `wireDiameterMm` = 2 mm es el conductor,
informativo: el agujero debe ser ≥ conductor y quedar ≥ 1.2 mm de pared entre agujeros, si no `PORT_INVALID`). Geometría: DOS
perforaciones circulares pasantes en la base (nunca una ranura ni un agujero único), sumadas a la región de recortes
traseros; el test mide el área quitada = 2 círculos de Ø2.8 por puerto.

Placement: la búsqueda exige que los dos agujeros quepan juntos en la cavidad real con margen de 1 mm y sin tocar otras
zonas. Roles (sin cambios): primera = ALIM + OUT; intermedias = IN + OUT; última = IN; entradas a la izquierda y salidas a
la derecha (invertido en R→L), sobre una línea de cable común al 30 % de la altura.

`CablePortPlacement { kind, preferred, fallback, reason }`. La preferencia de producto sigue siendo la salida lateral
(`side-wall`); **V1 usa el fallback `rear-edge`** (agujeros pasantes en la base, cerca del borde lateral), siempre con
`preferred: "side-wall"` y `fallback: true`, y en ambos casos DOS agujeros y el footprint del par completo. **Por qué**: un
puerto lateral exige perforar la pared vertical en dirección horizontal; no es una extrusión 2D y obligaría a CSG 3D o a
rehacer las paredes por bandas con costillas/biseles/tapered — frágil para el motor estable. Con **montaje Keyhole** la
letra apoya contra la pared y el cable sale hacia ella: aviso `REAR_PORT_FLUSH`.

### 32.8 Soporte de empalmes EXTERNO (`ExternalSpliceClip`) y retención local

**El empalme ocurre fuera de las letras.** Entre `A OUT (+/-)` y `P IN (+/-)` viajan dos cables, se hacen dos empalmes
(uno + y uno -), y siguen dos cables. Para sostenerlos existe una **pieza auxiliar imprimible independiente**
(`spliceClip.ts`, `bipolar-splice-clip.stl`): NO es un conector eléctrico, no conduce corriente y no reemplaza la
soldadura ni el termocontraíble; solo **sostiene, ordena, separa y retiene suavemente** los dos empalmes ya terminados y
aislados. Sin borneras, Wago, marcas ni diámetro fijo de termocontraíble.

- **Geometría**: una placa base con DOS canales U abiertos y paralelos (`+` y `-`); cada canal tiene dos rieles de 1.2 mm y
  cuatro pestañas de retención cortas (voladizo 0.4 mm, extremos abiertos: los cables salen y el empalme se retira con el dedo).
  Abierto por arriba: se inserta DESPUÉS de empalmar (no hay que pasar el cable antes). Un solo sólido soldado por capas
  (sin CSG, watertight, un único componente, sin piezas flotantes), impreso plano sobre la placa. Defaults:
  Ø empalme 5 mm, largo 25 mm, separación entre ejes 12 mm, holgura 0.4 mm/lado (interior 5.8 × 25.8 mm); la separación debe dejar
  ≥ 1.2 mm de pared entre canales (`SPLICE_CLIP_INVALID`). Ajustes en `wiring.spliceClip { enabled, diameterMm, lengthMm, spacingMm, clearanceMm }`.
- **Pieza universal**: todas las conexiones usan los mismos ajustes ⇒ UN STL y la cantidad **letras − 1** (1 letra → 0, 2 → 1,
  6 → 5); se muestra «cantidad necesaria: N» y nunca se generan N archivos idénticos.
- **NO anclado a la pared** en esta versión (sin tornillo, adhesivo ni orejas): variante futura.
- **Retención local (strain relief)**: la letra conserva UN clip sencillo junto a cada puerto que abraza los dos conductores
  del par (`interior → clip → ○ ○ → cable exterior`), del lado interior de la letra. Se eliminaron los clips que conducían a bays
  internos y toda ruta interna. Van dentro de la cavidad, sobre la repisa (prismas apilados soldados, sin CSG).
- **Etiquetas** en relieve de 0.6 mm (`labelFont.ts`): `IN`/`OUT` sobre el par y `+`/`-` junto a cada agujero, si caben.

### 32.9 Conexiones (datos de ruta), helpers y editor de montaje

- **`WireConnection`** (uno por tramo, `plan.connections`): `fromLetter/fromPort/toLetter/toPort`, `positivePath` y `negativePath`
  (de cada agujero de OUT al de IN) y `clipPosition` (punto medio y ángulo del recorrido). Es la única fuente del helper, la
  plantilla y la guía. Longitud entre letras: distancia entre los centros de los pares OUT(N) → IN(N+1) + margen de servicio
  (default 30 mm). Métrica física, sin dimensionado eléctrico.
- **Helper de cableado** («Mostrar cableado», no exportable, `helper.ts`): DOS conductores paralelos por tramo — `+` continuo y
  `-` discontinuo, con marcas `+` / `-` y flecha (no depende del color) — y un soporte de empalmes de referencia a mitad de
  camino. «Mostrar pared de referencia» sigue igual. Nada de esto entra a STL, ZIP ni Vista Cama.
- **Editar montaje**: reusa el editor de Back Cutouts (puntos de montaje como recortes sintéticos, zona segura, rojo si es
  inválido). Los puertos NO tienen edición manual todavía; si se agrega, el `BipolarCablePort` deberá arrastrarse como una
  única unidad (mueve ambos agujeros).

### 32.10 Plantilla de instalación 1:1 y PDF (`installation/pdf/`)

- **Sin dependencias nuevas**: el proyecto solo tenía `@react-pdf/renderer` (documentos de flujo). Se escribió un escritor PDF
  vectorial mínimo (`pdfWriter.ts`, base-14, sin rasterizar) para garantizar y testear la escala: cada página declara su
  `MediaBox` real y una matriz fija `72/25.4` (1 unidad = 1 mm); 100 mm miden 283.46 pt.
- **Una sola fuente de verdad**: contornos = los `ContourGroup` reales; posiciones = las del `InstallationPlan` (test: la marca
  `M-S1` es el centro real del socket; el punto del keyhole es el centro del extremo de su cuello; **cada puerto son dos marcas
  `IN+`/`IN-`… en las mismas posiciones que los dos agujeros 3D**).
- Contenido: contorno de cada letra, línea de nivel, ancho total y alto máximo, ids (A1/A2), `○` perforación keyhole «M1-K1»,
  `⊙` receptor/separador «M-S1» (Ø de perforación y huella del cuerpo), **`● ●` paso de cable bipolar (+ / -)**, dos líneas
  punteadas (+ trazo largo, - trazo corto) entre letras y el soporte de empalmes de referencia. Leyenda que no depende del color.
  **No se inventan perforaciones en la pared**: el cableado solo aporta pasos por la letra y referencias.
- Papel A4 / Carta / A3 (default A4), orientación con menos hojas, tiling con superposición (10 mm), «Página X / Y», marcas de
  corte y alineación, control de 100 mm con «Imprimir al 100% / Tamaño real. Verificar que esta referencia mida 100 mm.».

### 32.11 Guía de conexión (PDF)

`wiringGuide.ts`. Página 1: orden físico `FUENTE → S → T → A1 → M → P → A2` (flechas reales), «CONEXIÓN ELÉCTRICA EN PARALELO», esquema
de dos buses (+ línea llena, - punteada), diagramas por letra (`IN+ ─┬─ OUT+`, `LED+`) y tabla de roles y longitudes. Página 2:
**diagrama de conexión bipolar** `A OUT ○ ○ ── [empalme +] ── ○ ○ P IN` / `[empalme -]` con el **soporte impreso** dibujado alrededor de los
dos empalmes como sujeción mecánica, NO eléctrica; la cantidad de soportes (letras − 1); el texto «Realizá y aislá los empalmes antes de
colocarlos en el soporte impreso.» y los 7 pasos para principiantes (preparar cables, pasar los pares, empalmar fuera de las letras,
aislar, colocar en el soporte, verificar polaridad, probar antes del montaje final). Baja tensión DC únicamente.

### 32.12 Exportación (`exporters/exportInstallKit.ts`)

Panel «Exportar → Instalación»: Separadores ×N, **Soporte empalmes ×(letras−1)**, Plantilla 1:1 (PDF), Guía de conexión (PDF) y
**Kit completo (.zip)**:

```
<nombre>-kit.zip
  STL/     01_S.stl … 06_A2.stl   bipolar-splice-clip.stl (una sola pieza)   wall-spacer-12x20.stl (si hay separadores)
  INSTALL/ plantilla-instalacion.pdf  guia-conexion.pdf
  LEEME.txt   (cantidades de cada pieza, «Cantidad de soportes de empalme: letras - 1», orden físico, baja tensión)
```

Todo se bloquea mientras `result.errors` no esté vacío. Las piezas auxiliares no se mezclan con el packing de la Vista Cama.

### 32.13 Persistencia y migración

`wiring` cambió respecto de la primera versión del sprint: se eliminaron `splice` (bays internos) y `portClearanceMm`, y por letra
`spliceEnabled/splicePlus/spliceMinus`; se agregaron `wireHoleDiameterMm`, `holeCenterSpacingMm` y `spliceClip`. Todo sigue en el
JSON `settings` (sin migration SQL, `PROJECT_SCHEMA_VERSION` sin cambios). **Compatibilidad**: `normalizeInstallationRecipe` lee los
proyectos del sprint anterior — `wiring.splice` se migra a `wiring.spliceClip` (Ø, largo, holgura, interruptor), el resto de claves
antiguas se descarta y el agujero/separación toman los defaults nuevos; los overrides antiguos de empalmes se ignoran.

### 32.14 Limitaciones conocidas

- Puertos laterales (side-wall) diferidos; solo `rear-edge` (ver 32.7). Los puertos aún no se editan a mano.
- El soporte de empalmes no se ancla a la pared (sin tornillo/adhesivo/orejas) y su posición en Model View es solo visual.
- Sin frente de canal luminoso (cuerpo macizo, sin cavidad): error explícito `NOT_SUPPORTED_FRONT`.
- El separador y el receptor asumen UN separador por punto (sin variantes por letra). Etiquetas impresas solo `+ - IN OUT`.
- Kit ZIP: los STL usan el mismo recentrado por letra que el ZIP de letras individuales.
- Verificación visual del panel/viewport en navegador NO realizada (la ruta exige sesión con acceso a plataforma); sí se verificó
  visualmente el render de los PDF y toda la geometría por tests (watertight, un shell por letra).
- **Halo LED / retroiluminación y USB-C NO implementados**; la separación de pared (20 mm) deja espacio para esa futura iluminación trasera.

## 33. Neon LED 0.3 — Sistema de instalación

> Sprint 2026-09-23. Módulo nuevo `src/lib/maker/neon/installation/` (+ `src/lib/maker/unionFind.ts`, compartido con Carteles). El motor geométrico del canal (`createChannelGeometry.ts`) solo recibe un contexto opcional (`passThroughFootprints`/`bridgeFootprints`); sin él, produce exactamente la misma malla que antes de este sprint. Tests: `tests/maker-neon-installation.test.mjs` (53). No avanza a Neon 0.4.

### 33.1 `NeonSegment`: identidad física por recorrido

Capa de metadata PURA sobre `NeonPath[]` (`installation/segments.ts`), calculada ANTES de cualquier buffer/unión Clipper — nunca toca `createChannelGeometry.ts`. `NeonSegment { id, pathIndex, closed, points, lengthMm, bounds, start, end, connectionAnchorT }`:

- **Segmentos abiertos**: `start`/`end` con punto + tangente unitaria SALIENTE (apunta más allá de la punta). Un carácter puede aportar varios `NeonPath` (la "A" = 2 lados + travesaño) — ya llegan separados desde `textToNeonPaths.ts`/`svgToNeonPaths.ts`, así que `NeonSegment` es un wrapper casi 1:1, sin lógica nueva de separación de trazos.
- **Loops cerrados**: sin extremos naturales, así que se elige determinísticamente un `connectionAnchorT` (fracción de longitud de arco `[0,1)`) — el vértice más RECTO del loop (menor ángulo de giro local, muestreado con el mismo criterio que `metrics/curvature.ts`), no una esquina viva. Empate → primer índice, nunca al azar.
- **IDs**: posicionales (`N1..Nn`, índice en la corrida actual) — mismo esquema que `LetterInstance.id` de Carteles (único precedente real en el repo), NO content-hash.

**`reconcileSegments.ts`**: al cambiar texto/SVG/PNG/fuente/alto los IDs pueden dejar de corresponder al mismo segmento físico. Se hace un match best-effort por SIMILITUD GEOMÉTRICA (distancia de centroide para loops, distancia de extremos —probando ambas orientaciones— para abiertos, más diferencia de longitud, todo normalizado por la media geométrica de ambas longitudes para no dejar que un trazo enorme "absorba" la distancia a uno diminuto), greedy por confianza descendente, cada ID usado una sola vez. Por debajo del umbral de confianza el match se descarta — **nunca se remapea una posición vieja a un segmento equivocado** (Sección 45/59 del pedido). Esta función existe y está probada (incluye un caso adversarial: mismo conteo, formas muy distintas → 0 matches), pero **todavía no está conectada al flujo de edición en vivo** — ver limitaciones (33.12): hoy la persistencia de overrides usa el criterio más simple de Carteles (ID debe existir en la corrida actual), con descarte controlado si no.

### 33.2 `NeonWiringPlan`: orden + IN/OUT

`installation/wiring.ts`. Corrección conceptual respecto de Carteles: Carteles cablea N letras como N redes eléctricas PARALELAS independientes (empalme en T por letra); Neon es UNA sola tira LED continua cortada en N segmentos — dentro de un segmento no hay empalme, las mismas dos vías corren IN→OUT en serie física, y el jumper extiende esas mismas vías. La condición de aceptación sigue siendo la misma (`computeNeonBuses`, unión-búsqueda: exactamente un bus + y un bus −, nunca en corto) pero con un modelo de terminales más simple (2 por segmento, no 6).

Planificador: nearest-neighbor (arranca en el segmento de menor ID, agrega en cada paso el candidato — ID + orientación, cada segmento abierto aporta 2 orientaciones posibles = invertible — más cercano al punto de salida actual) + 2-opt first-improvement acotado a `min(200, N²)` evaluaciones de par. Determinístico, NO promete el óptimo (no hace falta TSP perfecto). Primer segmento = alimentación + salida; último = solo entrada; intermedios = entrada + salida. `buildManualWiringPlan` arma un plan directo desde un orden + conjunto de inversiones ya decididos (editor manual, sin correr NN/2-opt de nuevo). Se probó con un caso de 6 segmentos contra un orden manual artificialmente malo: el plan automático siempre da menos cable total (no exige el óptimo matemático).

`src/lib/maker/unionFind.ts` es la unión-búsqueda genérica extraída de la implementación inline que ya tenía `installation/wiring.ts` de Carteles (refactor puro, sin cambio de comportamiento, Carteles pasa a importarla) — la reutilizan también el MST de puentes (33.4) y `computeNeonBuses`.

### 33.3 `NeonCablePassThrough`: agujero bipolar único

`installation/passThrough.ts`. UNA sola abertura tipo cápsula (no dos agujeros circulares como el puerto de Carteles). Por segmento abierto: uno en el lado IN (siempre hay alimentación o un jumper entrando ahí) y otro en el lado OUT si `hasOut`. Loops cerrados: uno solo, en su `connectionAnchorT` (IN y OUT del cableado comparten el mismo agujero físico).

- **Posición**: a `endpointInsetMm` (default 10 mm) de la punta — nunca exactamente ahí —, acotado a la mitad del segmento en trazos cortos para que los dos huecos de un mismo segmento nunca se crucen.
- **Orientación**: eje largo de la cápsula alineado con la TANGENTE LOCAL del recorrido (encaja con más margen dentro de un corredor angosto que perpendicular). `capsulePolygon()` no siempre nace con su eje largo en X (depende de si width>=height), así que la rotación aplicada compensa ese caso.
- **Validez**: la cápsula debe caer ENTERA dentro de la cavidad, con margen (`PASS_THROUGH_EDGE_MARGIN_MM = 0.5`) — misma técnica que `isCutoutInsideSafeZone` de Carteles (diferencia de áreas exacta vía Clipper, no muestreo de puntos).

**Geometría (split de piso por bandas, gateado)**: la única extrusión de `outerGroups` (piso+pared, `z:0→zTop`) se divide en dos SOLO cuando hay pass-throughs: banda 1a (`z:0→zFloor`, con el agujero restado) + banda 1b (`z:zFloor→zTop`, huella original sin cambios, continúa la pared exterior). Con la misma huella sale también el mismo agujero en la tapa de la cavidad (pieza 2, "techo del piso"), así el pass-through atraviesa de punta a punta — nunca queda como bolsillo ciego. Sin pass-throughs (`passThroughFootprints` vacío), la malla es BIT A BIT idéntica a antes de este sprint (test de regresión explícito). Verificado con manifold/watertight, volumen removido ≈ área de cada cápsula × espesor de piso (±10%), y un rayo vertical por el centro del pass-through que no encuentra material entre `z=0` y `z=zFloor` (mientras que lejos del agujero el piso sigue sólido).

### 33.4 Puentes traseros (MST) — sólidos independientes, NO soldados por Clipper

`installation/bridges.ts`. Grafo completo nodo=segmento, costo=distancia mínima entre huellas EXTERIORES por segmento (`segmentOuterFootprint`: buffer de un solo `NeonPath` a la vez, desechable, nunca toca el buffer fusionado real del canal). MST vía Kruskal (comparte `UnionFind` con 33.2), determinístico. Para N segmentos desconectados da ~N-1 puentes.

**Decisión de arquitectura (con impacto en el resultado final, aprobada explícitamente por el usuario tras probarse en este sprint)**: el pedido original pide "unión 2D con el floor footprint antes de extrusión... evitar CSG 3D", lo que se intentó primero como una unión Clipper de la cápsula del puente contra `outerGroups`. **Se abandonó tras confirmarlo con debugging directo**: Clipper puede resamplear tramos del contorno lejos de cualquier intersección real al reconstruir la tapa de la protuberancia, dejando bordes no-manifold puntuales que el redondeo de grilla (0.0001 mm) no alcanza a compensar — no es un problema de precisión numérica, es que dos operaciones booleanas distintas sobre las mismas curvas no siempre teselan idéntico.

En su lugar, cada puente se extruye como su PROPIO sólido cerrado independiente (`z:0→zFloor`, con sus dos tapas — misma técnica sin CSG que `wallSpacer.ts`/`spliceClip.ts` de Carteles), concatenado en la MISMA malla/STL. Su footprint (`bridgeFootprintPolygon`) se extiende `BRIDGE_OVERLAP_MM = 1` más allá de cada punto de conexión, hacia adentro de la huella del segmento correspondiente, para SOLAPAR de verdad en ÁREA (no solo tocar) — dos sólidos watertight independientes con volumen 3D genuinamente superpuesto imprimen como una sola pieza (el slicer no necesita que la malla esté soldada por vértices, solo que el volumen se toque). Mismo principio que ya usa este proyecto para tapa/cuerpo de Carteles (sección 11: "no es una soldadura... es la unión de dos sólidos independientes").

Verificado: cada pieza (segmentos + puentes) es individualmente manifold/watertight (0 bordes no-manifold, 0 triángulos degenerados); la conectividad real se probó por SOLAPE DE ÁREA (unión-búsqueda sobre intersección Clipper > 0 entre las huellas de segmentos y puentes) — no por vértices compartidos, que no aplica a sólidos superpuestos-no-soldados. N=4 componentes desconectados → 3 puentes → 1 sola pieza imprimible (por solape); modo Independientes preserva el conteo de componentes original.

**Validación por edge del MST**: si el candidato cruza la cavidad de CUALQUIER segmento (footprint del puente intersecta `cavityGroups`, área > tolerancia) se rechaza (`NEON_BRIDGE_CROSSES_CAVITY`) y Kruskal sigue con el siguiente candidato más barato — probado con un caso de 3 nodos donde el camino directo más corto está bloqueado por una cavidad sintética y el plan final igual conecta todo por el desvío. Puente por encima de `bridgeLengthWarningMm` (default 250 mm) avisa (`NEON_BRIDGE_TOO_LONG`) sin bloquear.

Mechanical bridge y electrical jumper son conceptos DIFERENTES a propósito (Sección 26 del pedido): `bridges.ts` no sabe nada de `NeonWiringPlan`, aunque puedan coincidir visualmente.

**Espesor del puente**: ocupa el MISMO rango Z que el piso (`0..zFloor`), nunca más grueso — satisface por construcción la preferencia del pedido ("igual o menor que floorThickness") sin necesitar una tercera banda Z independiente ni un parámetro `bridgeThicknessMm` separado.

### 33.5 `NeonWallClip`: pieza auxiliar paramétrica

`installation/wallClip.ts`. Independiente del STL principal (`installation/types.ts`: `NeonAuxPart`, tipo LOCAL de Neon — no se amplía el `InstallationAuxPart.kind` compartido de Carteles, evita forzar a `exportInstallKit.ts` de Carteles a lidiar con un valor que no le pertenece). Función PURA de `(NeonChannelParams, NeonWallClipSettings)`: se regenera sola al cambiar cualquiera de los dos, sin paso manual.

Geometría (mismo mecanismo sin CSG que `wallSpacer.ts`/`spliceClip.ts`, huellas 2D apiladas y soldadas por capas vía `installation/prismStack.ts` reutilizado tal cual): eje Z local = "alejándose de la pared" (base apoyada en Z=0, mismo criterio que `wallSpacer.ts`).

- **Placa base + poste**: la placa tiene una "oreja" que sobresale del poste en la dirección a lo largo del canal, con el agujero de tornillo centrado ahí — así nada queda por encima bloqueando el acceso del destornillador (probado con un rayo recto desde arriba que no encuentra ningún triángulo hasta la base). Rebaje de cabeza opcional (counterbore, `screwHeadDiameterMm=0` = sin rebaje).
- **Poste**: alto = `wallGapMm` (separación de pared, default 5 mm, rango 0-20).
- **Bolsillo/rieles**: ancho = `channelOuterWidth(params) + clipClearanceMm` (holgura TOTAL, misma convención que el resto de Neon). El canal se presiona hacia -Z (hacia la pared) dentro del bolsillo; los rieles lo abrazan por los costados en toda su altura (`channelHeight + clearance`).
- **Retención SUAVE**: pestañas cortas con voladizo hacia adentro justo en la boca del bolsillo (`RAIL_TAB_OVERHANG_MM = 0.4`, mismo valor ya probado en `spliceClip.ts`) — nunca snap agresivo.

Se exporta como UNA sola pieza STL + cantidad (todos los clips de un proyecto comparten sección de canal, son geométricamente idénticos).

### 33.6 Posición automática de clips

`installation/clipPlacement.ts`, extiende `installation/arclength.ts` (caminador de longitud de arco genérico, ya usado por 33.1/33.3: `buildArclengthTable`, `pointAtT`, reserva de intervalos 1D `Interval`/`intervalsOverlap`). Se prefirió un esquema 1D por longitud de arco en vez de portar el sistema de zonas 2D de Carteles (`layout.ts`, pensado para una cavidad 2D) — Neon es fundamentalmente un recorrido, no una cavidad.

Candidatos cada `clipSpacingMm` (default 100, sugerido 80-120) + uno extra cerca de cada extremo si el último regular queda a más de `spacingMm/2` del borde. Se evita: zonas reservadas (pass-through, con margen — bordes de puentes NO se reservan explícitamente en V1, ver limitaciones) y curvas demasiado cerradas (radio local estimado por muestreo de 3 puntos, mismo criterio que `metrics/curvature.ts`, umbral = `minBendRadiusMm` del canal). Si el candidato en la posición objetivo no es válido, se busca el más cercano válido (`±2mm, ±4mm...` hasta `spacingMm/2`) antes de descartarlo. Sin ningún candidato válido en todo el segmento: `NEON_CLIP_NO_SPACE`, sin crash.

Probado: tramo recto de 500 mm da varios clips cerca del spacing configurado + uno extra por extremo; ninguno cae sobre un pass-through reservado; ninguno cae en una curva cerrada sintética (fixture en "L", esquina de 90°).

### 33.7 Orquestador (`installation/orchestrate.ts`) — tres toggles independientes

`planNeonInstallation()` une segments → wiring → pass-through → bridges → clips en un solo resultado (`NeonInstallationResult`). **Cableado, puentes y montaje son TRES conceptos independientes** (no uno depende del otro): `bridgeMode: "bridged"` genera puentes aunque el cableado esté apagado; `mountMode: "clips"` genera clips igual. Solo los pass-through están atados al cableado (no tendría sentido un agujero de cable sin un plan de cableado que lo motive). Probado explícitamente: puentes y clips con `wiringEnabled: false`.

`createNeonGeometry.ts` hace DOS pasadas de `createChannelGeometry`: una primera SIN instalación (da el `cavityGroups` "baseline" contra el que se valida cada pass-through/puente — nunca tocan la pared), y si hay algo que agregar, una segunda CON el contexto de instalación ya validado. Sin ningún toggle activo, es una sola pasada — mismo resultado byte a byte que antes de este sprint (test de regresión).

### 33.8 UI: sección "Instalación"

`MakerNeonControls.tsx`, insertada después de "Curvatura" y antes de "Información" (mismo patrón plano de `<section>`, sin acordeón, que el resto del panel). Tres bloques (Sección 60 del pedido): CABLEADO (toggle + tamaño de pass-through + margen de servicio + lista de orden con invertir/reordenar cuando se está editando + "Mostrar cableado"), UNIÓN (Independientes/Puentes traseros + ancho de puente) y PARED (Sin montaje/Clips + separación + distancia entre clips + holgura + "Mostrar montaje"). Resúmenes en vivo (segmentos, pass-through generados, cable auxiliar total, puentes, clips) directamente desde `NeonGeometryResult.installation`.

`useNeonGeometry.ts` extendido con un tercer argumento opcional `{recipe, overrides}`, debounceado junto con `params` pero **fuera** de la dependencia de `buildNeonPaths`: cambiar cualquier ajuste de Instalación (incluido arrastrar un pass-through) NUNCA reprocesa el parseo de texto/SVG/imagen (Sección 59 del pedido) — solo el memo de `createNeonGeometry`.

### 33.9 Malla helper (cableado + montaje) — nunca se exporta

`installation/helperMesh.ts`. Reusa el mecanismo YA EXISTENTE de `MakerViewport`'s prop `helperMesh` (el mismo que usa el inserto de Jarros) — no hizo falta tocar el viewport. Combina, en una sola malla translúcida:

- **Cableado** ("Mostrar cableado"): una barra (cápsula) + una flecha triangular por jumper, apuntando de OUT (from) a IN (to) — nunca depende solo del color.
- **Montaje** ("Mostrar montaje"): un disco marcador en cada posición de clip calculada (convertida de longitud de arco a punto real vía `pointAtT`) + un plano de referencia de la pared a `z = -wallGapMm`.

Todo a Z negativo (detrás del piso, Z=0) para no colisionar visualmente con la geometría real. Bar y flecha se extruyen POR SEPARADO (no como un contorno unido por Clipper): cerca de la punta se solapan, y unirlos ahí dejaba un triángulo degenerado ocasional (mismo tipo de problema que 33.4, resuelto con la misma estrategia de sólidos independientes en vez de forzar una unión).

### 33.10 Editor manual — reutiliza el editor de Back Cutouts existente

`installation/editing.ts`. Los pass-through se representan como `BackCutout` SINTÉTICOS de tipo `"capsule"` (mismo patrón que ya usa Carteles para sus puntos de montaje: `mountEditorCutouts()`) — se reutiliza `cutoutEditorScene.ts`/`MakerViewport`'s prop `cutoutEditing` TAL CUAL, sin escribir ni un componente nuevo ni un segundo canvas (Sección 17 del pedido: "Reutilizar MakerViewport... No crear canvas separado"). El arrastre (raycast a Z=0, cámara ortográfica trasera, throttle de 80 ms, validación en vivo roja/verde) es exactamente el mismo código ya probado de Carteles.

- **Zona segura del editor** (`computePassThroughSafeZone`): unión de las cavidades de TODOS los segmentos, erosionada el mismo margen que usa el motor — expuesta en `NeonGeometryResult.passThroughSafeZone`, calculada solo cuando Instalación está activa.
- **Mover pass-through**: el drag commitea un override `{passThroughStart|passThroughEnd: [x,y]}` por segmento — reemplaza el centro calculado automáticamente, conserva la rotación auto.
- **Invertir IN/OUT**: lista de segmentos en orden de cableado (visible solo mientras se edita), cada uno con botones ↑/↓ (mover antes/después, reordenar sin drag-drop) e "invertir".
- **Reset automático**: vuelve todos los overrides (orden + por segmento) a automático.

### 33.11 Export y persistencia

**Export** (`neon/exporters/exportNeonInstallKit.ts`, LOCAL a Neon — `exportInstallKit.ts` de Carteles itera `result.letters`, siempre vacío en Neon, no reutilizable tal cual): tarjeta flotante con NEON (Descargar STL Neon, sin cambios) + INSTALACIÓN (Wall Clip × N, Kit completo). Kit ZIP: `STL/` (canal + clip) + `INSTALL/installation-summary.txt` (segmentos, longitud total, jumpers con longitud, cable auxiliar total, puentes, clips — Sección 43). Sin PDF (Neon no tiene esa infraestructura todavía); el ZIP queda estructurado para agregarlo después sin cambiar el layout.

**Persistencia** (`neon/projects/neonProjectData.ts`): `NeonWorkState` gana `installationRecipe`/`installationOverrides`. Se serializan anidados en el MISMO campo jsonb `settings` (`settings.installation = {recipe, overrides}`) — **sin migration nueva** (el jsonb no tiene schema que alterar). Neon no tiene presets todavía, así que la receta completa viaja en el proyecto (no hace falta el split preset-vs-proyecto de Carteles). Lectura tolerante (`normalizeNeonInstallationRecipe`/`normalizeNeonInstallationOverrides` en `installation/types.ts`): proyectos guardados antes de este sprint (sin la clave `installation`) cargan con todo en automático/apagado, sin throw. `neonProjectSignature` detecta cambios de instalación automáticamente (ya serializa todo `settings`).

### 33.12 Limitaciones conocidas

- **`reconcileSegments` (33.1) no está conectada al flujo de edición en vivo todavía** — existe y está probada, pero la aplicación de overrides sigue el criterio más simple de Carteles (ID debe existir en la corrida actual). Es el mismo nivel de robustez que Carteles ya tiene en producción, no una regresión — pero es la mejora más clara para una iteración futura.
- **Los puentes traseros NO están soldados por Clipper al resto de la malla** (33.4): son sólidos independientes con overlap físico real. Imprimen como una sola pieza (verificado por solape de área real, Z compartido y ausencia de bordes no-manifold por pieza) pero esto **no se verificó contra un slicer real** (Bambu Studio/OrcaSlicer) — queda pendiente de que el usuario lo confirme.
- La posición automática de clips (33.6) evita pass-throughs reservados y curvas cerradas, pero **no evita explícitamente una unión de puente** — el margen práctico entre features suele alcanzar, pero no hay una reserva de arco dedicada para bridge junctions en V1.
- El editor manual (33.10) solo permite arrastrar PASS-THROUGH; los clips de pared se ven (helper mesh, 33.9) pero no se arrastran — coincide con el mínimo aceptado explícitamente por el pedido (Sección 38: "Como mínimo: auto placement + lista/visual helper").
- Sin PDF de instalación para Neon (plantilla 1:1, guía de conexión) — explícitamente fuera de alcance de este sprint, ZIP estructurado para agregarlo después.
- **Verificación visual completa en navegador NO realizada** (misma limitación documentada para Neon 0.1/0.2: la ruta exige sesión con acceso a plataforma, sin credenciales en este entorno). Se verificó: `npx tsc --noEmit` limpio, `npm run build` exitoso (85 páginas estáticas generadas incluyendo `/stampa-maker/neon`), 683/684 tests Maker (1 skip preexistente, no relacionado), y toda la geometría nueva por tests (manifold/watertight, volumen, raycast, solape de área).
- USB-C, cálculo de fuente/potencia, AWG/caída de tensión, RGB/data line, halo, plantilla PDF mural compleja, wall anchors, generación de tornillos, slicing/G-code — explícitamente fuera de alcance (Sección 61 del pedido), no implementados.

## 34. Neon LED — corrección de cableado y puentes de refuerzo (0.3.2)

> Sprint 2026-09-23, sobre el estado de la sección 33. Pedido explícito: corregir dos
> problemas conceptuales puntuales (topología de pass-throughs y rigidez de puentes),
> **sin agregar features nuevas**. No se rehizo nada de 33.1-33.12; se auditó contra el
> código real (no contra un reporte) antes de tocar nada.

### 34.1 Causa real del "under-generation" de pass-throughs

El pedido describía el bug como `"1 segmento → 1 pass-through"`. Auditado contra el
código real de `orchestrate.ts` (no contra el reporte): la fórmula `2N-1` para cadenas
de segmentos abiertos **ya estaba bien implementada** — se verificó con un probe directo
(N=1..4, incluso con fuentes reales: "AMOR", "STAMPA", "H") y el resultado siempre dio
exactamente `2N-1` pass-throughs, con IN/OUT correctamente asociados a los DOS endpoints
reales del segmento (nunca al mismo extremo). El gap real, confirmado, era otro: cuando
la posición por defecto de un pass-through (a `endpointInsetMm` de la punta) no entraba
en la cavidad — trazo curvo o angosto cerca de la punta —, el agujero se descartaba EN
SILENCIO con solo un warning, sin intentar una posición cercana (a diferencia de
`planClipPositionsForSegment`, que sí busca una alternativa antes de rendirse). Esta es
la explicación más plausible de pass-throughs "faltantes" en capturas reales con
geometría curva.

### 34.2 Nuevo role model

`NeonPassThroughRole = "powerIn" | "in" | "out" | "inOut"` (`passThrough.ts`), calculado
en `orchestrate.ts` a partir del `NeonWiringPlan` ya existente (`hasPowerIn`/`hasOut`):
el `IN` del primer segmento es `powerIn` (alimentación, sin jumper entrante); los demás
`IN` y `OUT` según el lado real; un loop cerrado siempre es `inOut` (agujero único
compartido). "Cada agujero físico corresponde 1:1 a un rol" ya era cierto
estructuralmente (cada `NeonPassThrough` tiene su propio `segmentId`+`side`); lo que
faltaba era exponer el rol explícitamente para no tener que re-derivarlo en cada
consumidor. Se muestra en la UI (`MakerNeonControls.tsx`, línea "Roles" bajo "Pass-through
generados": `"1 POWER IN · 1 IN · 1 OUT"`).

### 34.3 Fórmula/casos open segments (bloqueado con tests)

`2N-1` para N segmentos abiertos en una única cadena, verificado con tests exactos
(no `>= 4` como antes) para N=1..5 y los casos explícitos del pedido: 2 segmentos → 3
huecos (`Segmento 1: POWER IN + OUT`, `Segmento 2: IN`); 4 segmentos → 7 huecos. Se
verificó además que el `OUT` del primer segmento queda asociado al endpoint OPUESTO al
`POWER IN` (nunca al mismo lado).

### 34.4 Endpoint enforcement

Ya estaba garantizado por construcción: `planPassThrough` solo puede posicionar un
pass-through sobre `segment.start`/`segment.end` (offsetado por `insetMm` a lo largo del
MISMO path) — no existe ningún camino que permita un anchor arbitrario a mitad de
recorrido. El nuevo `planValidPassThrough` (34.1) mantiene esta invariante: la búsqueda
de una posición alternativa SOLO varía la distancia de inset sobre el mismo lado/segmento,
nunca cambia de endpoint ni de segmento.

### 34.5 Closed loop handling

Sin cambios de comportamiento (Sección 9 del pedido: "no romper los loops que ya
funcionan"). Un loop sigue con UN agujero bipolar compartido en su `connectionAnchorT`,
ahora con `role: "inOut"` explícito. `planValidPassThrough` no intenta reposicionar loops
(no hay "otro lado" al que moverse — el único punto sugerido ya es el vértice más recto
del loop).

### 34.6 Cambios del manual editor

El botón "Invertir segmento" (Sección 14 del pedido) ya existía en el editor de
conexiones (`toggleInvertOverride`) — no requirió cambios. Se agregó una capa **PUENTES**
nueva (Sección 28): selector de par de segmentos + "Agregar puente" + lista de puentes
manuales con indicador visual válido/inválido (verde/rojo, Sección 29) + eliminar
individual + "Vaciar todos". El drag completo de endpoints queda fuera de este sprint
(el pedido acepta explícitamente ese piso mínimo cuando el editor visual completo no
entra en el sprint).

### 34.7 Causa real del "under-reinforcement" de puentes

Confirmada, no era un malentendido: `bridges.ts` implementaba un MST puro (Kruskal) — por
construcción, un `UnionFind` solo permite **una** arista entre cualquier par de
componentes ya conectados (`if (uf.connected(...)) continue`), así que dos componentes
nunca podían tener más de 1 puente entre sí. El pedido lo describe correctamente:
"SegmentPair NO puede estar limitado a un único bridge".

### 34.8 BridgeConnection vs BridgeInstance

No se creó un tipo `BridgeConnection` separado (el par `fromSegmentId`/`toSegmentId` de
cada `BridgeEdge` ya lo identifica) — sí se separó `BridgeInstance` (`bridges.ts`):
`{ ...BridgeEdge, id, kind: "primary"|"reinforcement"|"manual", footprint }`. El grafo MST
decide qué PARES deben conectarse (conectividad); el modo (`minimal`/`reinforced`/
`custom`) decide cuántas instancias físicas usa cada relación.

### 34.9 Reinforcement algorithm

`planReinforcementBridges()`: por cada arista primaria del MST, candidatos generados
muestreando el CENTRO de ambos segmentos cada 15mm de longitud de arco (no los vértices
de la huella ya bufferizada — un tramo recto largo solo tiene 2 vértices reales en su
huella, en las puntas, lo que amontonaba los candidatos en los extremos en vez de
distribuirlos; ver 34.10 para el detalle del bug intermedio encontrado y corregido en
este mismo sprint). Cada candidato se desplaza `outerRadiusMm` hacia el otro segmento
(aproxima el borde real sin recalcular la huella completa por candidato). Selección
greedy por distancia ascendente, aceptando solo los que (a) no cruzan cavidad ni
pass-through (con margen) y (b) quedan a `minBridgeSeparationMm` (`= max(20,
bridgeWidthMm*4)`, deriva del ancho — Sección 22) de CUALQUIER puente ya elegido, no solo
los del mismo par. La cantidad deseada se deriva de `min(lengthMm de los dos segmentos) /
50mm * factorDeNivel` (`low=0.5, medium=1, high=1.75`) — nunca un conteo fijo tipo "foto 1
= 4" (Sección 25). Si la geometría no alcanza, se coloca lo que se pueda y se avisa
(`NEON_BRIDGE_REINFORCEMENT_PARTIAL`, Sección 27) — no bloquea.

### 34.10 Multi-bridge same pair / distribución espacial

Verificado con test dedicado: 2 componentes grandes paralelos (300mm) en modo Reforzada
dan varias instancias para el MISMO `SegmentPair` (nunca un pair nuevo inventado — V1
solo refuerza relaciones que el MST ya decidió conectar, ver 34.13). Los puntos medios
quedan repartidos a lo largo de toda la adyacencia (span > 100mm en el fixture de test,
nunca amontonados en una zona chica), cada par consecutivo respetando
`minBridgeSeparationMm`.

### 34.11 Bridge width / manual bridges / pass-through avoidance

**Ancho** (`bridgeWidthMm`): ya existía y ya afectaba la geometría correctamente
(`bridgeFootprintPolygon` lo usa en los tres modos automáticos y en manuales) — verificado
con test de volumen (ancho mayor → más volumen real en la malla exportada, no solo
estado de UI). **Espesor**: sin cambios — decisión ya documentada en 33.4 (ocupa
`0..zFloor`, igual o menor que el piso; no se agregó control nuevo porque no aporta
sin una tercera banda Z, tal como el pedido permite explícitamente omitir si "no
aporta"). **Puentes manuales** (`buildManualBridgeInstances`): valida que CADA extremo
toque el floor material real de su propio segmento (`touchesSegmentFootprint`, cápsula de
prueba de 6mm) antes de aceptarlo; un endpoint flotando produce
`NEON_BRIDGE_MANUAL_INVALID` — error que bloquea el export (no solo warning), igual que
pide la Sección 29. **Evasión de pass-through** (Sección 24, gap real confirmado: antes
solo se validaba contra la cavidad): los tres modos automáticos y los manuales validan
ahora también contra `passThroughFootprints` (expandidos `+1mm` de margen vía
`outsetContourGroups`).

### 34.12 Persistencia

`NeonInstallationRecipe` gana `reinforcementLevel: "low"|"medium"|"high"` (default
`"medium"`); `NeonInstallationOverrides` gana `manualBridges: NeonManualBridgeInstance[]`
(default `[]`). Mismo campo jsonb `settings.installation`, sin migration nueva (mismo
patrón que el resto de Instalación 0.3). **Compatibilidad**: `bridgeMode` pasa de
`"independent"|"bridged"` a `"independent"|"minimal"|"reinforced"|"custom"` — el valor
viejo `"bridged"` (proyectos guardados antes de esta corrección) migra a `"minimal"` en
`normalizeNeonInstallationRecipe` (mismo comportamiento, solo cambió el nombre para
alinearse con el mockup de UI del pedido). Test dedicado de migración.

### 34.13 Tests

12 tests nuevos en `tests/maker-neon-installation.test.mjs` (53 → 65; 683 → 696 tests
Maker totales): fórmula `2N-1` exacta N=1..5, casos explícitos de 2 y 4 segmentos con
roles, `planValidPassThrough` (fallback + override manual no dispara la búsqueda), 2
componentes Mínima-vs-Reforzada con multi-instancia por par, distribución espacial,
ancho de puente afecta volumen real, evasión de pass-through, puente manual
agregar/validar/eliminar (incluye endpoint flotando → error), 1 solo segmento → 0
puentes en todos los modos automáticos, y migración `"bridged"` → `"minimal"`.

### 34.14 Totales y validación

`npx tsc --noEmit` limpio. `npm run build` exitoso (todas las rutas compilan, incluida
`/stampa-maker/neon`). `node --test tests/maker-*.test.mjs`: 696 tests, 695 pasan, 1 skip
preexistente no relacionado (mismo skip documentado en `CURRENT_STATE.md`/sprints
anteriores de Maker). `tests/maker-neon-installation.test.mjs`: 65/65.

### 34.15 Limitaciones conocidas

- **Refuerzo V1 solo agrega instancias sobre pares que el MST ya conectó** — no evalúa
  "otros pairs cercanos" fuera de esas relaciones (Sección 16 lo permite como parte de
  Reforzada, pero se acotó el alcance para mantener el sprint enfocado en la corrección
  pedida). Ampliarlo es la mejora más clara para una iteración futura.
- **Editor manual de puentes**: piso mínimo aceptado explícitamente por el pedido
  (agregar por par + eliminar + lista), sin drag de endpoints ni "reset auto" desde
  Reforzada (ese último requeriría exponer `baselineCavityGroups`/`shiftedPaths` fuera del
  pipeline interno de `createNeonGeometry.ts`, evaluado y descartado por complejidad
  desproporcionada para este sprint — "Vaciar todos" cubre el caso de uso real). IDs
  posicionales `mb1..mbN` dentro de la corrida.
- **`minBridgeSeparationMm` se deriva del ancho, sin control de UI propio** — el pedido
  permite explícitamente "derivarlo automáticamente" como alternativa a exponer un
  control nuevo.
- Ningún cambio de esta corrección tocó `channel U`, `Text`, `SVG`, `PNG/JPG`, skeleton,
  wall clips, Proyectos ni export de Carteles — verificado por la suite completa de Maker
  en verde (696/696 salvo el skip preexistente).
