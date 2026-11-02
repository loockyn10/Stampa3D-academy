# Stampa Maker — Lámparas V4 / V4.1: experimento de pantalla de DOBLE PARED (informe técnico)

Estado (2026-11-02): la **doble pared convencional ya está integrada** en el generador real (selector «Doble pared», `src/lib/maker/lamps/doublewall/`, ver docs/STAMPA_MAKER.md §38.19). Lo que sigue **aislado** es el prototipo en C para **modo jarrón** (`src/lib/maker/lamps/experiments/doubleWall/`): no está en la UI porque no se verificó con un laminador. Este informe analiza ambos. Los STL de prueba siguen en `tests/fixtures/maker-double-wall/` (no sustituyen la exportación real de la herramienta); STL e informe medido en `tests/fixtures/maker-double-wall/`; generador `scripts/generate-double-wall-prototypes.mjs`; tests `tests/maker-lamps-v4-double-wall.test.mjs`.

> **Aviso importante.** No había ningún laminador en el entorno (ni Bambu Studio, ni Orca, ni PrusaSlicer) y no se descargó ninguno. **No hay resultados de laminado.** Todo lo de este informe es geometría medida sobre las mallas y un análisis de capas propio (cortes horizontales y verticales de la malla, `sliceAnalysis.ts`), que muestra *qué recibe* un laminador pero **no es un laminador**: no genera perímetros ni trayectorias. Las cifras de material son estimaciones geométricas. Nada acá declara que el modo jarrón o la impresión sin soportes funcionen.

## 0. Qué cambió en V4.1

V4 dejaba los extremos de ambas paredes sin cerrar ni conectar. V4.1 agrega:

- **Unión inferior (piso):** una unión anular maciza de `floorMm` (2,4 mm = 12 capas de 0,2 mm) entre la cara exterior de la pared exterior y la cara de la pared interior que mira al vacío central. Es parte de la misma malla, apoya sobre la cama (sin voladizos) y **no tapa la abertura central**.
- **Unión superior (techo):** en los últimos `roofHeightMm` (24 mm) las dos paredes se inclinan una hacia la otra: la cara exterior hacia adentro, la interior hacia afuera, hasta que la cámara mide `topGapMm` (1,2 mm). No hay ningún puente horizontal de 20 mm: solo caras inclinadas (máximo **44,4° respecto de la vertical**, medido). En la estrategia convencional un cielorraso de `roofCapMm` (2,4 mm) cierra la cámara; en la de modo jarrón la ranura queda abierta (ver §3).
- Los nervios de V4 (4 nervios radiales) se eliminaron del prototipo convencional: el piso y el techo ya unen las paredes.
- Nuevas mediciones: inclinaciones de todas las caras (`measureLean`), cuerpos y cavidades (`shellReport`), secciones verticales (`sliceMeshAxis`), superficies horizontales y condiciones de modo jarrón (`VaseReadiness`).

## 1. Método geométrico

Dos paredes concéntricas de siluetas independientes, construidas como un **loft** de una sección horizontal a lo largo de z (sin CSG):

- **Pared exterior** — abombada: el motor de siluetas existente (`openwork/silhouette.ts: createSilhouette`, reutilizado sin modificar) da el radio de las *crestas* `Rc(z)`; las estrías son `r(θ,z) = Rc − A/2 + (A/2)·cos(n(θ − τ(z)))` (A = profundidad, n = estrías, τ = torsión). Su cara interior es el desfase por el espesor a lo largo de la normal.
- **Pared interior** — de revolución, reloj de arena (la misma función con cintura); su cara que mira al vacío central es el desfase por el espesor.
- **Techo:** con `e(z)` = smoothstep sobre la zona de techo, `r' = r + (objetivo − r)·e`: la cara de la cámara de cada pared converge a `rm ± topGap/2` (`rm` = punto medio entre las dos caras donde arranca el techo) y las caras exteriores a ese valor ± el espesor. Las estrías se desvanecen hasta un círculo arriba. Como las paredes convergen, **en el techo ya no son independientes**; en la zona de paredes rectas sí (test: cambiar una no mueve ningún vértice de la otra).
- Cada sección se calcula con la misma cantidad de vértices en todas las filas (una fila cada 2 mm más las alturas del piso, del arranque del techo y del cielorraso); las caras laterales unen filas consecutivas y las superficies horizontales (tapas, piso y cielorraso de la cámara) se arman con *zippers* entre pares de lazos. Los flancos de la abertura se resuelven con `planeAngle` (intersección exacta del plano con la curva, estrías incluidas).
- **Separación:** `measureChamberGap` mide, para cada punto de la cara de la pared exterior que mira a la cámara (entre el piso y el arranque del techo, todo el ángulo, estrías incluidas), su **distancia euclídea 3D** a la cara de la interior (exacta: la interior es de revolución). Los tests la repiten con distancias punto–triángulo sobre las mallas reales (coinciden). En el techo la cámara se cierra a propósito y esa zona no se mide como separación. Si es menor que `minGapMm`: `DW_GAP` con el motivo; **no se corrige solo**.

### Parámetros de la geometría de referencia y ajustes documentados

| Parámetro | Pedido | Usado |
|---|---|---|
| Altura | 120 mm | 120 mm |
| Diámetro exterior máximo | 140 mm | 140 mm (crestas; 139,9 mm medidos en A) |
| Silueta exterior / patrón | abombada / estrías verticales | abombada (máx. a 60 mm), 24 estrías de 3 mm |
| Silueta interior | reloj de arena | Ø60 en los bordes → Ø≈37 en la cintura (60 mm) |
| Separación mínima | 20 mm | **20,84 mm medidos** (en el arranque de la cámara, sobre el piso) |
| Orientación | vertical | vertical, base en z = 0 |

Valores que **no estaban en el pedido** y fijé yo: Ø de los bordes de la pared exterior = **110 mm**, de la interior = **60 mm** (con 62 mm la separación baja a 19,8 mm), espesor del modelo = **1,2 mm**, piso = 2,4 mm, techo = 24 mm, rim superior = 2,4 mm, ancho final de la cámara = 1,2 mm. El techo de 24 mm sale de que 14 mm daban 54° (voladizo excesivo) y 24 mm da 44,4°.

## 2. Topología de cada prototipo

Orientación de las capas, de abajo hacia arriba: **piso (z < 2,4)** → **paredes rectas (2,4 a 93,6)** → **techo (93,6 a 117,6)** → **rim (117,6 a 120)**.

**A — `double-wall-vase-test.stl` (sección en C, candidato a modo jarrón).**
- Piso: una placa maciza en C (sin hueco): 1 contorno exterior, 0 huecos (12 capas).
- Paredes y techo: **un único contorno exterior continuo** (cara exterior de la pared exterior → flanco de la abertura → cara de la pared interior que mira al vacío central → flanco opuesto) y **un hueco**, la cámara. La **abertura posterior** (eje hacia −X, 2 mm; configurable 1/1,5/2/3 mm) atraviesa pared exterior, cámara, pared interior **y el piso**: comunica el vacío central con el exterior. Dos placas de 1,2 mm (los flancos) unen las paredes en toda la altura.
- Arriba: la cámara termina en una **ranura abierta de 1,2 mm** (sin cielorraso). Longitud del contorno exterior por capa 523–667 mm, sin saltos (máximo 0,22 % entre capas consecutivas, 600 capas).
- Una superficie cerrada, un cuerpo, sin cavidades. Superficies horizontales: base (z = 0, −z), piso de la cámara (z = 2,4, +z) y cara superior (z = 120, +z). **Ninguna horizontal hacia abajo salvo la base.**

**B — `double-wall-conventional-test.stl` (anillos cerrados, impresión convencional).**
- Pared exterior cerrada, pared interior cerrada (sin abertura), unidas por el piso y por el techo. La cámara queda **cerrada**: una cavidad interna con piso plano (z = 2,4), caras inclinadas y cielorraso plano a z = 117,6 de 1,2 mm de ancho (rim macizo de 2,4 mm arriba). La malla tiene **dos superficies** (el exterior y la cavidad: normales hacia adentro de la cavidad, volumen negativo) pero es **un solo cuerpo sólido** (`shellReport`: 1 cuerpo, 1 cavidad).
- Capas: piso y rim = 1 contorno + 1 hueco (la abertura central); paredes y techo = **2 islas** (cada pared es un anillo) cada una con su hueco → 2 contornos + 2 huecos. Superficies horizontales: base (−z), piso (+z), **cielorraso (−z, a 117,6)**, cara superior (+z).

**Estrategia de unión elegida para B (y alternativas).** (a) *Piso + techo inclinado + cielorraso* (elegida): el piso apoya sobre la cama; el techo converge a 44° sin puente; el cielorraso queda a 1,2 mm de ancho (puente de 1,2 mm, despreciable). (b) *Anillo horizontal arriba*: puentea 20–25 mm: descartado (justo lo que el pedido prohíbe asumir). (c) *Techo de ojiva redondeada más alto*: da menos pendiente pero resta altura a las paredes. (d) *Pieza de unión independiente* (anillo que se pega o encastra arriba): evita todo voladizo, queda como alternativa si el laminador pide soportes en el techo. (e) *Nervios radiales* (V4): unen en altura pero dejan la cámara abierta y la dividen: ya no hacen falta.

Comparten (verificado sobre las mallas): superficie exterior, cara de la pared interior, cara hacia la cámara, altura, base en z = 0, separación, abertura central y zonas.

## 3. Modo jarrón (Spiral Vase): análisis de las terminaciones

Lo que se verificó es una **condición necesaria** (la malla es cerrada, hay un contorno exterior por capa, no hay capas macizas arriba ni cielorraso). **Una malla cerrada y válida no equivale a geometría compatible con modo jarrón** (B lo demuestra: malla válida, no candidata). El modo jarrón además exige que el laminador interprete el recorrido, y eso no se pudo comprobar.

| Elemento | ¿Compatible con Spiral Vase? | Razón |
|---|---|---|
| **Piso (unión inferior)** | **Sí, en principio, con 12 capas inferiores sólidas.** *No verificado.* | Es una base maciza como la de cualquier jarrón: el laminador imprime las primeras `bottom shell layers` como capas sólidas y luego arranca la espiral. Con menos de 12 capas, el tope del piso (z = 2,4) sería una sola línea de espiral y la cámara no tendría piso. La abertura atraviesa el piso: esas capas son una placa en C. |
| **Techo inclinado** | **Sí como geometría, pero no une las paredes.** | El contorno exterior sigue siendo uno solo y continuo (las paredes se inclinan). Pero en modo jarrón se imprimen **solo líneas sobre el contorno**: la cara de la pared que mira a la cámara no se imprime. Arriba las líneas impresas quedan separadas ≈ 2·(espesor + topGap/2) = 3,6 mm (≈ 2,8 mm de aire entre líneas de 0,42 mm). **No hay soldadura.** |
| **Cielorraso / tapa superior** | **No.** | Es una superficie horizontal con capas macizas: obliga a capas superiores que interrumpen la espiral. No se generó (no es una "solución falsa"): en A la cámara queda abierta arriba. |
| **Abertura posterior** | Se conserva. | Es lo que permite que el vacío central sea parte del contorno exterior (si se cerrara, la pared interior sería el borde de un hueco, que el modo jarrón ignora). Cerrarla "para unir" sin analizar las consecuencias dejaría la pared interior sin imprimir. |

**Conclusión del análisis:** la unión inferior es compatible; la unión superior **no puede resolverse dentro del modo jarrón** (una soldadura requiere capas horizontales). Propuestas compatibles (no implementadas): (1) dejar A abierto arriba (lo actual), unido en altura solo por los flancos y el piso; (2) un **anillo superior independiente**, impreso de forma convencional, que se pega o encastra sobre las dos paredes (ranura doble); (3) priorizar el prototipo B.

## 4. Impresión: voladizos y qué no se promete

- Inclinación máxima de cualquier cara: **44,4°** respecto de la vertical (en el techo, a 102 mm); en las paredes rectas ≤ 23°. Es el límite orientativo de 45°, **sin margen**: puede pedir ventilación o dar rugosidad. No se afirma impresión sin soportes: eso lo decide el laminador.
- Cielorraso de B: un puente horizontal de 1,2 mm (tope de la cavidad) sobre caras inclinadas a 44°.
- Se aplican `DW_LEAN` (error > 68°) y `DW_OVERHANG` (aviso > 45°) al cambiar parámetros.
- Cavidad cerrada en B: aire encerrado en una pieza que se calienta; no es un problema geométrico, pero no se evaluó térmicamente.

## 5. Resultados medidos (sobre las mallas; no son de laminado)

| | A — vase-c | B — conventional |
|---|---|---|
| Archivo | `double-wall-vase-test.stl` | `double-wall-conventional-test.stl` |
| Dimensiones | 139,9 × 140,0 × 120 mm | 140,0 × 140,0 × 120 mm |
| Triángulos / STL | 103 316 / 5,17 MB | 101 184 / 5,06 MB |
| Malla | cerrada, orientada, sin degenerados | igual |
| Superficies / cuerpos / cavidades | 1 / 1 / 0 | 2 / 1 / 1 |
| Separación mínima (paredes rectas) | 20,84 mm | 20,84 mm |
| Capas de 0,2 mm (600) | 1 contorno; 0 huecos (12 capas del piso), 1 hueco el resto | 1 contorno (piso y rim) o 2 islas; 1–2 huecos |
| Contorno exterior por capa | 523–667 mm | 271–573 mm (no es la ruta de un jarrón) |
| Abertura central | Ø34,2 mm mínimo (cintura); Ø79,2 mm arriba | igual |
| Volumen del modelo | 104,3 cm³ | 96,4 cm³ (con la cavidad descontada) |
| Estimación geométrica de material* | jarrón: **31,2 cm³**; 1 perímetro convencional: 61,2 cm³ | 1 perímetro: 54,5 cm³; 3 perímetros ≈ sólido 96 cm³ |
| ¿Condiciones geométricas de jarrón? | **sí** (un contorno por capa, sin capas macizas arriba, sin cielorraso; 12 capas inferiores sólidas) | **no** (cámara cerrada, cielorraso, 2 islas) |

\* Estimaciones geométricas (altura de capa 0,2 mm, línea 0,42 mm): no incluyen capa inicial, flujo ni solapado. Sirven para contrastar con el laminador.

Tests: `tests/maker-lamps-v4-double-wall.test.mjs` (17). Miden: perfiles exterior e interior sobre la malla, separación con distancias punto–triángulo (10 variantes de altura/diámetro/curvatura/estrías/torsión/cintura), rechazos con motivo (`DW_GAP`, `DW_FLOOR`, `DW_ZONES`, `DW_LEAN`, `DW_OVERHANG`…), topología y cavidad (volumen de la cavidad = el de la cámara analítica ± 3 %), unión inferior (piso macizo con rayos, abertura central), unión superior (inclinaciones, ancho de la ranura y del rim por rayos, abertura central no reducida), capas horizontales (600) y secciones verticales, abertura (1/1,5/2/3 mm) a través del piso, superficies horizontales (sin triángulos invertidos, área = sección), distinción malla válida vs. geometría compatible con jarrón, exportación STL (binario, dimensiones, reproducible byte a byte, STL guardados = los del motor) y aislamiento del experimento. **Son pruebas geométricas, no de impresión.**

## 6. Instrucciones para Bambu Studio

Archivos: `tests/fixtures/maker-double-wall/*.stl` (mm, Z hacia arriba, base en Z = 0, abertura de A hacia −X). Importar sin escalar ni rotar. Los nombres de los ajustes pueden variar según la versión.

**Perfil común:** boquilla 0,4 mm, altura de capa **0,20 mm**, un filamento, ancho de línea de la pared exterior anotado (≈ 0,42), soportes **desactivados** en la primera corrida (y después activados "automáticos" para ver qué pide el techo), relleno 0 %, capas superiores 0, mismas velocidades. Brim/skirt: ninguno o el mismo en ambos.

**A (modo jarrón):** *Proceso → Otros → Modo especial → Spiral vase*. **Capas inferiores (bottom shell layers) = 12** (el piso mide 2,4 mm); probar también 3 para confirmar que sin ellas la cámara pierde el piso. Generador de paredes Clásico y después Arachne. Timelapse apagado, "smooth spiral" apagado en la primera prueba.

**B (convencional), dos corridas:** **B1** wall loops = 1 (misma pared de 0,42 mm que el jarrón); **B3** wall loops = 3. Capas inferiores = 12 (como A). Sin spiral vase.

Laminar, abrir la vista previa y anotar tiempo, filamento (g / m) y capas.

## 7. Qué observar al laminar

**A (modo jarrón):**
1. **¿Ambas paredes en una trayectoria continua?** A media altura debe verse una sola línea cerrada: pared exterior → flanco → pared interior → flanco. Si falta la pared interior el método falla.
2. **Sin desplazamientos en vacío ni retracciones** dentro de las capas de la espiral (activar *Travel* y *Retraction*).
3. **¿Imprime el contorno de la cámara?** Un anillo extra en el hueco rompe la espiral (riesgo principal).
4. **La abertura de 2 mm** debe seguir abierta en todas las capas, incluidas las del piso (el laminador no debe cerrarla ni "repararla").
5. **El piso:** las capas 1–12 sólidas; en la 13 la espiral arranca sin pausa; el tope del piso a 2,4 mm.
6. **Arriba:** las líneas deben converger y terminar sin tapa; ¿qué hace el laminador en las capas 580–600 (rim de 2,4 mm)? Registrar si agrega algo.
7. Las paredes de 0,42 mm de 120 mm de alto unidas solo por los flancos: ¿se tambalean? (estabilidad real, solo se ve imprimiendo).

**B (convencional):** que se impriman ambas paredes y el piso; que el techo (44°) salga sin soportes o diga cuáles pide; que el cielorraso de 1,2 mm no genere relleno ni soportes inesperados en la cavidad; que la abertura central quede libre; que el laminador reconozca la cavidad interna como hueco (sin relleno dentro).

## 8. Cómo comparar tiempo y consumo

Misma tabla con **los mismos ajustes** (§6):

| Corrida | Tiempo | Filamento (g) | Capas | ¿Soportes? | Observaciones |
|---|---|---|---|---|---|
| A jarrón (12 capas inferiores) |  |  |  |  |  |
| B1 (1 perímetro) |  |  |  |  |  |
| B3 (3 perímetros) |  |  |  |  |  |

**A vs B1** (misma pared de 0,42 mm): la diferencia es la estrategia. **A vs B3**: peso y rigidez. Contrastar el filamento de A con 31,2 cm³ (≈ 39 g de PLA a 1,24 g/cm³, solo orientativo) y el de B1 con ≈ 54,5 cm³: si difieren mucho, el laminador no interpreta la pieza como se espera (por ejemplo, imprime la cámara).

## 9. Recomendación técnica (con la evidencia disponible)

- **B (convencional) es la opción segura y exportable:** malla cerrada y válida, un cuerpo con la cámara cerrada, unión inferior y superior reales, abertura central conservada, sin puentes largos. Pendiente solo de laminado (voladizo del techo a 44°).
- **A (modo jarrón) no puede cerrar el extremo superior** dentro del modo jarrón; la unión inferior es compatible si se usan 12 capas inferiores sólidas. Si el laminador la acepta, queda una pantalla de doble pared unida abajo y por los dos flancos, **abierta arriba**. Que eso sea suficiente estructuralmente solo lo dirá la impresión.
- **No hay datos de laminado, así que no declaro ganador.** **Priorizar B** para la integración; A queda como experimento a validar (con el anillo superior independiente de §3 como forma de unirla arriba).
- **Se reutiliza en cualquiera de los dos casos:** `profiles.ts` (perfiles independientes, `measureChamberGap`, `measureLean`, zonas), `build.ts` (loft con piso/techo), `sliceAnalysis.ts` (capas, cortes verticales, cuerpos/cavidades), `validateDoubleWall`. Un futuro `fabricationMode: "spiral" | "convencional"` solo cambiaría el cierre superior. Para integrarlo a la lámpara real faltan: el dimensionado para portalámparas E27 y bombilla (el vacío central de este experimento es Ø34 mm en la cintura), el cuello roscado y el reborde, y el encaje con los difusores.

## 10. Reproducir

```bash
node scripts/generate-double-wall-prototypes.mjs        # regenera los STL y double-wall-report.json (determinista)
node --test tests/maker-lamps-v4-double-wall.test.mjs   # 17 tests geométricos
```
