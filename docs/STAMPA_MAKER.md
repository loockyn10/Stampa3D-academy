# STAMPA MAKER

> 0.1 (2026-09-17): MVP del Creador de Carteles, fix del motor geométrico
> (huecos tapados / paredes sin espesor real, sección 6) y exportación de
> letras individuales soldadas como un único sólido por letra (sección 9).
> 0.2 (2026-09-17): segundo modo de frente — tapa frontal plana como pieza
> separada del cuerpo (sección 11).

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
