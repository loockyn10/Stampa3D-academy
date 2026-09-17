# STAMPA MAKER

> MVP 0.1 — Creador de Carteles (letras corpóreas). Implementado 2026-09-17.

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
  -> extrudeContourGroups(fondoGroups, 0, baseMm, capStart+capEnd)      slab sólido (fondo cerrado)
  -> extrudeContourGroups(wallGroups, baseMm, depthMm, capStart, sin capEnd)  pared hueca, frente abierto
  -> merge de ambos (triangle soup) -> THREE.BufferGeometry -> preview / STL
```

Todo el pipeline trabaja en **milímetros** (1 unidad = 1 mm), sin
conversiones intermedias.

### Decisiones clave

- **Fondo = solo el contorno exterior, sin huecos.** El "fondo cerrado" es
  un slab sólido con la silueta exterior de cada letra (ignora huecos como
  el ojal de la "O"), no la forma con huecos. Así el fondo queda realmente
  cerrado (sin perforaciones), consistente con un cartel/corpóreo real.
- **Huecos vía nonzero + Clipper, no unión previa.** No se hizo un paso de
  "unión" del glifo antes de calcular offsets: `buildContourHierarchy`
  clasifica exterior/huecos directamente por contención geométrica
  (par/impar), y esa clasificación se usa tal cual para el offset y la
  extrusión. Es más simple que pasar por una unión booleana intermedia y
  funciona igual de bien porque el resultado es el mismo agrupamiento que
  usaría la regla nonzero de la fuente.
- **Fuentes vs. salida de Clipper usan winding opuesto.** Las fuentes
  (TrueType/CFF) y las paths que devuelve Clipper tras `Difference` son cada
  una internamente consistentes (exterior y huecos van en sentidos
  opuestos) pero con convención absoluta distinta entre sí. `extrudePolygon.ts`
  normaliza explícitamente la orientación de cada contorno antes de generar
  las paredes laterales (las tapas no lo necesitan: `earcut` normaliza su
  propia salida). Este fue el bug principal encontrado durante el
  desarrollo (ver sección 6).
- **Offset con fallback sólido.** Si `wallMm` es mayor a la mitad del trazo
  más angosto, el inset da vacío para esa letra y `differenceContourGroups`
  devuelve la letra completa sin hueco (macizo) en vez de romper. Se
  reporta como warning `WALL_TOO_THICK`, no como error bloqueante.
- **Dos sólidos superpuestos, no una unión booleana 3D.** El fondo (0→baseMm)
  y la pared (baseMm→depthMm) son dos extrusiones independientes que
  comparten cara en `z = baseMm`. No se calculó una unión 3D explícita:
  ambos sólidos son válidos por separado y el slicer los trata como una
  sola pieza al superponerse (técnica estándar, evita la complejidad de un
  motor de CSG 3D para este MVP).

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

## 6. Bug encontrado y corregido durante el desarrollo

Al extruir letras con huecos (`O`, `B`, `8`, y cualquier texto que
incluyera una `A`/`P`), las paredes laterales quedaban con normales
invertidas en la interfaz fondo/pared, y algunas letras curvas (`O`, `8`)
generaban triángulos degenerados (aristas de largo cero) por puntos
duplicados que emite la fuente al empalmar segmentos de curva. Ambos casos
se detectaron con un test de topología (`tests/maker-letter-geometry.test.mjs`)
que verifica, para cada arista del mesh final, que las direcciones
opuestas estén balanceadas (sólido cerrado o borde real del frente
abierto) y que no haya triángulos de área ~0. Correcciones:

1. `extrudePolygon.ts` normaliza explícitamente la orientación de cada
   contorno antes de generar paredes laterales (ver sección 3).
2. `textToPaths.ts` deduplica puntos consecutivos casi idénticos al
   aplanar curvas.

## 7. Cómo validar

```bash
npx tsc --noEmit
npm run build
node --test tests/maker-letter-geometry.test.mjs
```

Los tests cubren: `I, L, A, O, B, 8, STAMPA, LOOCK 3D` (mesh válido +
topología correcta), conteo de huecos por letra (`O`→1, `B`→2, `8`→2,
`STAMPA`→3 contando la P), warning `WALL_TOO_THICK` con pared
desproporcionada, texto vacío, y validación de parámetros.

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
