# STAMPA MAKER

> MVP 0.1 — Creador de Carteles (letras corpóreas). Implementado 2026-09-17,
> fix del motor geométrico (huecos tapados / paredes sin espesor real) el
> mismo día — ver sección 6.

## 1. Qué es

Nueva sección de Stampa (`/stampa-maker`) para generar geometría 3D paramétrica
imprimible. La primera (y única, en esta fase) herramienta es el **Creador de
Carteles**: convierte texto en letras corpóreas huecas (fondo cerrado, frente
abierto) y permite previsualizarlas en 3D y exportarlas como STL.

No reemplaza ni modifica ninguna arquitectura existente de Stampa (auth,
RLS, pricing, stock). Es una sección nueva, protegida por el mismo middleware
que el resto de "Plataforma" (requiere `accessPlatform`, sin excepción Free
— no está en `isFreeAccountRoute` de `src/utils/supabase/middleware.ts`).

## 2. Dónde vive

```
src/app/stampa-maker/page.tsx              landing de la sección (lista de herramientas)
src/app/stampa-maker/carteles/page.tsx     Creador de Carteles (tool page)

src/lib/maker/
  types.ts                  tipos compartidos del pipeline (mm en todo)
  validation.ts              validación de parámetros de UI
  fonts/registry.ts          catálogo de fuentes + loader (fetch + opentype.parse, con cache)
  geometry/
    textToPaths.ts            texto -> opentype.Path (mm) y aplanado de curvas -> contornos 2D
    contourHierarchy.ts       contornos crudos -> {outer, holes}[] (par/impar, point-in-polygon)
    offsets.ts                wrapper de Clipper: inset (paredes) y difference (footprint de pared)
    extrudePolygon.ts         contornos -> mesh 3D (earcut + paredes laterales), normaliza winding
    createLetterGeometry.ts   orquesta el pipeline completo por letra/grupo de contornos
    toBufferGeometry.ts       LetterGeometryResult -> THREE.BufferGeometry
  exporters/exportSTL.ts      BufferGeometry -> descarga .stl (STLExporter binario)

src/hooks/maker/useLetterGeometry.ts   corre el pipeline con debounce, fuera del render

src/components/maker/
  MakerTextControls.tsx       panel de controles (texto, fuente, dimensiones, descarga)
  MakerViewport.tsx           visor three.js "vanilla" (sin r3f), grilla + OrbitControls

public/fonts/maker/           Montserrat-Regular.woff, Montserrat-Bold.woff (de @fontsource/montserrat)

tests/maker-letter-geometry.test.mjs   tests del pipeline geométrico (node:test)
```

Convenciones reutilizadas del resto del repo (no se creó un design system
aparte): `Card`, `Button`, `SectionTitle`, `CalculatorSelect` de
`src/components/ui/*`, colores `stampa-*` de Tailwind, `useAppFeedback` para
toasts. Entrada agregada en `src/components/layout/sidebar.tsx` (grupo
"Plataforma") y `mobile-navigation.ts`.

## 3. Pipeline geométrico

```
texto + fuente + alto(mm)
  -> textToOpentypePath          (font.getPath, fontSize calculado por capHeight)
  -> flattenOpentypePath         (subpaths cerrados, curvas Q/C aplanadas, Y invertida a "arriba positivo")
  -> buildContourHierarchy       ({outer, holes} por letra, regla par/impar vía point-in-polygon)
  -> por cada grupo:
       insetContourGroups(group, wallMm)       Clipper: erosiona el grupo hacia adentro
       differenceContourGroups(group, inset)   Clipper: grupo original menos el erosionado = pared
  -> extrudeContourGroups(fondoGroups, 0, baseMm, capStart+capEnd)       fondo, respeta los huecos del glifo
  -> extrudeContourGroups(wallGroups, baseMm, depthMm, capStart+capEnd)  pared, tapada en ambos extremos
  -> merge de ambos (triangle soup) -> THREE.BufferGeometry -> preview / STL
```

Todo el pipeline trabaja en **milímetros** (1 unidad = 1 mm), sin
conversiones intermedias.

### Decisiones clave

- **Fondo = anillo, no disco: respeta los huecos del glifo.** `fondoGroups`
  usa `{ outer: group.outer, holes: group.holes }` (los huecos ORIGINALES
  del glifo, sin offset), no `holes: []`. El fondo (0→baseMm) es un slab
  con la silueta exterior de la letra MENOS sus counters — así el hueco de
  una "O" queda completamente libre en toda la profundidad, no solo en el
  tramo de la pared. Ver el bug corregido en la sección 6: la versión
  anterior tapaba el counter con una cara sólida real a `z = baseMm`.
- **Pared tapada en ambos extremos (`capStart` y `capEnd`).** La huella de
  la pared (`wallGroups`, salida de `differenceContourGroups`) ya es un
  anillo delgado cuyo borde interior es el counter original sin modificar
  — earcut nunca triangula el interior de ese hueco (llega como
  `holeIndices`, no como área rellena), así que tapar el extremo frontal
  (`z = depthMm`) le da a la pared espesor real y visible en la punta sin
  cubrir la cavidad. Cada pieza (fondo, y cada banda de la pared) queda así
  totalmente cerrada/manifold por sí sola; "frente abierto" es la ausencia
  de geometría sobre la cavidad, no un borde sin tapar.
- **Huecos vía nonzero + Clipper, no unión previa.** No se hizo un paso de
  "unión" del glifo antes de calcular offsets: `buildContourHierarchy`
  clasifica exterior/huecos directamente por contención geométrica
  (par/impar), y esa clasificación se usa tal cual para el offset y la
  extrusión.
- **Fuentes vs. salida de Clipper usan winding opuesto.** Las fuentes
  (TrueType/CFF) y las paths que devuelve Clipper tras `Difference` son cada
  una internamente consistentes (exterior y huecos van en sentidos
  opuestos) pero con convención absoluta distinta entre sí. `extrudePolygon.ts`
  normaliza explícitamente la orientación de cada contorno antes de generar
  las paredes laterales (las tapas no lo necesitan: `earcut` normaliza su
  propia salida).
- **Jitter determinístico antes de triangular.** earcut elige el "puente"
  hueco↔exterior con una heurística propia; cuando hay vértices exactamente
  alineados (mismo X o Y — común en offsets con tramos rectos, de cualquier
  fuente o letra) puede elegir un puente que deja la malla no-manifold o un
  triángulo de área ~0. `extrudePolygon.ts` aplica un jitter determinístico
  de 0.0001 mm (muy por debajo de cualquier tolerancia de impresión, y
  consistente entre llamadas separadas porque depende del hash de cada
  punto, no de su índice) antes de triangular y de generar las paredes
  laterales. Ver sección 6.
- **Offset con fallback sólido.** Si `wallMm` es mayor a la mitad del trazo
  más angosto, el inset da vacío para esa letra y `differenceContourGroups`
  devuelve la letra completa sin hueco (macizo) en vez de romper. Se
  reporta como warning `WALL_TOO_THICK`, no como error bloqueante.
- **Dos sólidos superpuestos, no una unión booleana 3D.** El fondo (0→baseMm)
  y la pared (baseMm→depthMm) son dos extrusiones independientes,
  totalmente cerradas cada una, que comparten cara en `z = baseMm`. No se
  calculó una unión 3D explícita: ambos sólidos son válidos por separado y
  el slicer los trata como una sola pieza al superponerse (técnica
  estándar, evita la complejidad de un motor de CSG 3D para este MVP).

## 4. Dependencias agregadas

| Paquete | Uso |
|---|---|
| `three` (+`@types/three`) | preview 3D, `STLExporter`, `OrbitControls` |
| `opentype.js` (+`@types/opentype.js`) | texto -> paths vectoriales |
| `earcut` | triangulación de tapas (exterior + huecos) |
| `clipper-lib` (+`@types/clipper-lib`) | offset (paredes) y difference (footprint de pared) |
| `@fontsource/montserrat` | fuente de origen de los `.woff` en `public/fonts/maker` (no se usa en runtime, solo como fuente de los archivos) |

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
- No hay unión booleana 3D real entre fondo y pared (ver sección 3). Es
  correcto para impresión FDM (el slicer las trata como una pieza), pero no
  es un sólido único desde el punto de vista de un motor CAD.
- Sin Web Workers: con textos muy largos (varias líneas, decenas de
  palabras) el cálculo podría notarse en la UI. No medido en este MVP.

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

## 7. Cómo validar

```bash
npx tsc --noEmit
npm run build
node --test tests/maker-letter-geometry.test.mjs
```

Los tests cubren: `I, L, A, O, B, 8, STAMPA, LOOCK 3D` (mesh válido +
topología correcta, incluyendo que no queden bordes abiertos: fondo y
pared quedan totalmente cerrados como piezas independientes), conteo de
huecos por letra (`O`→1, `B`→2, `8`→2, `STAMPA`→3 contando la P), y
específicamente para huecos: el counter de `O`/`B`(x2)/`8`(x2)/`A` queda
libre de geometría en toda la profundidad (rayo vertical por su centro),
el fondo no tiene ninguna cara sobre el counter pero sí tiene material
sobre el trazo (control positivo), no hay tapa exactamente en
`z = depthMm` sobre la cavidad, y la erosión de la pared queda a
~`wallMm` del contorno más cercano. Más: warning `WALL_TOO_THICK` con
pared desproporcionada, texto vacío, y validación de parámetros.

Verificación manual pendiente (no realizada en esta fase por no contar con
credenciales de una cuenta con acceso Paid): abrir `/stampa-maker/carteles`
autenticado, generar `STAMPA` en Montserrat Bold con los valores por
defecto (100/40/1.6/1.2 mm), rotar/zoomear el preview, descargar el STL y
abrirlo en un slicer (OrcaSlicer/Bambu Studio) para confirmar dimensiones y
huecos visualmente.

## 8. Próximos pasos sugeridos para 0.2 (no implementados)

- Más fuentes / catálogo más amplio.
- Ajuste fino de segmentación de curvas (adaptativa por curvatura).
- Mover el pipeline a un Web Worker si el volumen de texto lo justifica.
- Todo lo explícitamente fuera de alcance en la tarea original (tapas,
  LEDs, acrílico, DXF, encastres, costos, Supabase, etc.) — sin cambios.
