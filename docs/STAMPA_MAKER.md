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
