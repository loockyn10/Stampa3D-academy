# Stampa Maker — Lámparas V4: experimento de pantalla de DOBLE PARED (informe técnico)

Estado: **experimento aislado** (2026-11-01). No es una herramienta, no está en la UI ni en el catálogo, no toca `LampDefinition`, las pantallas sólidas/caladas, los difusores ni la base E27. Código en `src/lib/maker/lamps/experiments/doubleWall/`; STL e informe medido en `tests/fixtures/maker-double-wall/`; generador `scripts/generate-double-wall-prototypes.mjs`; tests `tests/maker-lamps-v4-double-wall.test.mjs`.

> **Aviso importante.** No había ningún laminador en el entorno (ni Bambu Studio, ni Orca, ni PrusaSlicer) y no se descargó ninguno. **No hay resultados de laminado.** Todo lo de este informe es geometría medida sobre las mallas y un análisis de capas propio (corte por plano de la malla, `sliceAnalysis.ts`), que muestra *qué recibe* un laminador pero **no es un laminador**: no genera perímetros ni trayectorias. Las cifras de material son estimaciones geométricas. Nada acá declara que el modo jarrón funcione.

## 1. Método geométrico

Dos paredes de revolución-con-relieve, concéntricas y de siluetas independientes, construidas como un **loft** de una sección horizontal a lo largo de z (sin CSG):

- **Pared exterior** — abombada: el motor de siluetas ya existente (`openwork/silhouette.ts: createSilhouette`, reutilizado sin modificar) da el radio de las *crestas* `Rc(z)`; las estrías son `r(θ,z) = Rc − A/2 + (A/2)·cos(n(θ − τ(z)))` (A = profundidad cresta–valle, n = estrías, τ = torsión). Su cara interior (la que mira a la cámara) es el desfase por el espesor medido a lo largo de la normal: `r − t·√(1 + (r_θ/r)² + r_z²)`.
- **Pared interior** — de revolución, reloj de arena: la misma función de silueta con cintura (intensidad, posición, curvatura); su cara que mira al vacío central es el desfase por el espesor.
- Cada sección se calcula con **la misma cantidad de vértices en todas las filas** (una fila cada 2 mm; 12 muestras por estría); las caras laterales unen filas consecutivas y las tapas inferior y superior se arman con tiras de cuadriláteros entre pares de lazos (contorno ↔ hueco). Los planos de los flancos/nervios se resuelven con `planeAngle` (intersección exacta del plano con la curva `r(θ)`, estrías incluidas).
- **Separación**: `measureChamberGap` toma cada punto de la cara de la pared exterior que mira a la cámara (todas las alturas, todo el ángulo, estrías incluidas) y mide su **distancia euclídea 3D** a la cara de la pared interior (exacta: la interior es de revolución, distancia a su perfil). El mínimo es la distancia mínima entre las superficies. Los tests la repiten con distancias punto–triángulo sobre las mallas reales (coinciden). Si es menor que `minGapMm`, `validateDoubleWall` devuelve `DW_GAP` con el motivo: **no se corrige solo**.

### Parámetros de la geometría de referencia y ajustes documentados

| Parámetro | Pedido | Usado |
|---|---|---|
| Altura | 120 mm | 120 mm |
| Diámetro exterior máximo | 140 mm | 140 mm (en las crestas; medido 139,9 mm en la malla) |
| Silueta exterior / patrón | abombada / estrías verticales | abombada (máx. a 60 mm), 24 estrías de 3 mm de profundidad |
| Silueta interior | reloj de arena | Ø60 en los bordes → Ø≈37 en la cintura (a 60 mm) |
| Separación mínima | 20 mm | **20,8 mm medidos** (en los bordes, z = 0 y 120; es el mínimo real, no un nominal) |
| Orientación | vertical | vertical, base en z = 0 |

Dos valores **no estaban en el pedido** y los fijé yo: Ø de los bordes de la pared exterior = **110 mm** (hace falta algún valor para que sea abombada) y Ø de los bordes de la interior = **60 mm** (el mayor, a paso de 1 mm, que mantiene ≥ 20 mm: con 62 mm la separación baja a 19,8 mm). Espesor del modelo de las paredes y de los flancos/nervios = **1,2 mm**. La separación **real es menor que la nominal** entre crestas (a media altura: cresta 70 mm − cara de la pared interior 18,3 mm = 51,7 mm nominales) por las estrías y por la pendiente de las paredes; el mínimo cae en los bordes.

## 2. Topología de cada prototipo

**A — `double-wall-vase-test.stl` (sección en C).** Cada capa es **un único contorno exterior y un único hueco**:
- contorno exterior (antihorario, material a la izquierda): cara exterior de la pared exterior (arco casi completo, 288 vértices) → **flanco** (plano `y = +1 mm`, atraviesa pared exterior, placa y pared interior) → cara de la pared interior que mira al **vacío central** (arco casi completo, recorrido en sentido horario) → flanco opuesto (`y = −1 mm`) → vuelta al inicio;
- hueco: la **cámara de aire** (cara interior de la pared exterior, placa, cara de la pared interior que mira a la cámara, placa);
- la **abertura posterior** (eje hacia −X, ancho `slitMm`, 2 mm por defecto; configurable: 1, 1,5, 2, 3 mm en los tests) atraviesa en línea recta la pared exterior, la cámara y la pared interior: comunica el vacío central con el exterior. **Las dos placas de unión** (1,2 mm) quedan a cada lado de la abertura y unen las paredes en altura completa. Por eso el contorno exterior de la capa incluye *las dos paredes*: es lo que un laminador en modo jarrón recorre como una sola línea.
- Longitud del contorno exterior por capa: 600–667 mm (promedio 629 mm); varía sin saltos (máximo 0,06 % entre capas consecutivas de 0,2 mm, medido en las 600 capas). Una malla, una componente, cerrada y orientada.

**B — `double-wall-conventional-test.stl` (anillos cerrados).** Pared exterior cerrada, pared interior cerrada y **4 nervios radiales de 1,2 mm de altura completa** que las unen. Cada capa: 1 contorno exterior circular y 5 huecos (el vacío central y 4 sectores de la cámara). Sin abertura, sin puentes, sin voladizos, sin tapas: se imprime vertical sin soportes. Una componente, cerrada y orientada.

**Estrategia de unión elegida para B (y por qué).** Alternativas: (a) anillo de piso que cierre la cámara por abajo; (b) anillo superior que la cierre por arriba; (c) nervios radiales de altura completa. (b) obliga a puentear 20 mm sin soporte (se descartó: es justo lo que el pedido prohíbe). (a) agrega una geometría que A no tiene y no une las paredes en altura. **(c)** es la más sencilla, no tiene voladizos ni puentes, y se parece a las placas de A (también conectan las paredes en altura completa). Se pueden variar `ribs` (2–12) y `ribMm`. Los nervios se verían a través del material translúcido: es una diferencia visual menor entre A y B.

Comparten (verificado sobre las mallas): superficie exterior, cara de la pared interior, cara hacia la cámara, altura, base en z = 0 y separación.

## 3. Restricciones de la impresión en espiral (modo jarrón)

Lo que exige el modo jarrón y cómo se cubrió/falta cubrir:

1. **Un solo contorno exterior por capa**, sin islas: cumplido (600/600 capas). *El laminador recorre el contorno exterior; las paredes que solo son borde de huecos no se imprimen en modo jarrón.* Por eso la pared interior de A está en el contorno exterior (el vacío central comunica con el exterior por la abertura) y no es borde de un hueco.
2. **Los huecos (la cámara) deben ser ignorados** por el laminador. Es el punto de mayor riesgo: la sección tiene un hueco (la cámara) y no está verificado cómo lo trata Bambu Studio en modo jarrón (ver §7).
3. **Sin tapas superiores, sin relleno, una sola pared**: el modelo no tiene tapas superiores; el relleno y las capas superiores se desactivan en el laminador.
4. **Continuidad de la sección con la altura**: la topología no cambia en ninguna capa y la longitud del contorno es continua.
5. **La abertura debe sobrevivir al laminado** (cierre de huecos / reparación): 2 mm ≫ el radio de cierre por defecto (≈ 0,05 mm). *No verificado.*
6. Una espiral continua no hace "costura" ni desplazamientos en vacío; la unión entre paredes es el flanco de la abertura (26 mm radiales en los bordes y ≈ 50 mm a media altura por cada flanco y por capa).

Que la malla sea una sola pieza **no garantiza** una trayectoria de modo jarrón; lo que se verificó es la condición necesaria (un contorno, un hueco, continuidad). La trayectoria real depende del laminador.

## 4. Limitaciones de los perfiles

- Sección circular + estrías; la pared interior es de revolución (sin relieve). Torsión de las estrías soportada (`twistDeg`) pero la abertura sigue siendo vertical.
- Separación entre paredes: medida y exigida, pero no se ajusta sola (`DW_GAP`). Con la cintura del reloj de arena y las estrías de 3 mm, el Ø interior máximo en los bordes ronda 60 mm. El vacío central resulta de Ø≈34 mm en la cintura (58 mm en los bordes): **no es una lámpara E27** (un portalámparas y su bombilla no entran en el vacío de A/B tal cual); es solo el experimento de fabricación. Integrarlo a la base E27 exige otro dimensionado (§9).
- Radio de curvatura de las crestas ≥ 1,5 × espesor (`DW_FLUTE_SHARP`); en la referencia 3,3 mm.
- Cámara abierta arriba y abajo (la cámara no está cerrada). Sin rosca, sin anillo, sin portalámparas.
- Resolución: 100 040 / 101 520 triángulos (≈ 5 MB cada STL). Filas cada 2 mm: el error de la silueta por interpolación lineal es ≈ 0,01 mm.

## 5. Resultados medidos (sobre las mallas; no son de laminado)

| | A — vase-c | B — conventional |
|---|---|---|
| Archivo | `double-wall-vase-test.stl` | `double-wall-conventional-test.stl` |
| Dimensiones | 139,9 × 140,0 × 120 mm | 139,9 × 139,9 × 120 mm |
| Triángulos / STL | 100 040 / 5,00 MB | 101 520 / 5,08 MB |
| Componentes / cerrada | 1 / sí (0 aristas abiertas, 0 no-manifold, 0 invertidas, 0 degenerados) | igual |
| Separación mínima | 20,8 mm | 20,8 mm |
| Capas (0,2 mm): contornos / huecos | 1 / 1 en las 600 | 1 / 5 en las 600 |
| Longitud del contorno exterior por capa | 600–667 mm | 371–458 mm |
| Volumen del modelo (sólido) | 92,3 cm³ | 103,4 cm³ |
| Estimación geométrica de material (altura de capa 0,2 mm, línea 0,42 mm)* | jarrón: **31,7 cm³** (contorno × 0,2 × 0,42); 1 perímetro convencional: 62,9 cm³ | 1 perímetro: 70,1 cm³; 3 perímetros ≈ sólido 103 cm³ (las paredes miden 1,2 mm) |

\* Estimaciones **geométricas**: no incluyen la capa inicial, el flujo, el solapado ni ningún dato del laminador. Sirven para saber qué ratio esperar y contrastarlo con el laminador (≈ 2–3× menos material del jarrón frente a convencional **si** el laminador se comporta como se espera). El modelo de B es sólido de 1,2 mm: con 1 perímetro (0,42 mm) el laminador imprimiría paredes de 0,42 mm, igual que el jarrón; por eso la comparación justa usa B con 1 perímetro (B1) además de B con 3 (B3).

Tests: `tests/maker-lamps-v4-double-wall.test.mjs` (15). Miden: perfil exterior (Ø máximo, bordes, abombado, número y profundidad de estrías), perfil interior (cintura, Ø, independencia), separación con distancias punto–triángulo sobre las mallas y para 10 variantes de altura/diámetro/curvatura/estrías/torsión/cintura, rechazo con motivo (`DW_GAP`, `DW_FLUTE_SHARP`…), topología (cerradas, orientadas, sin degenerados, 1 componente, sin autointersecciones por capa), una capa = un contorno + un hueco (A) o 1 + 5 (B) en las 600 capas, ancho de la abertura medido con rayos (1/1,5/2/3 mm) y que atraviesa de la cara interior a la exterior, placas de unión, comparabilidad A/B, tapas (sin triángulos invertidos, área = sección), exportación STL (binario válido, dimensiones, byte a byte reproducible), que los STL guardados son los que genera el motor, y que el experimento no está importado por nada fuera de su carpeta. **Son pruebas geométricas, no de impresión.**

## 6. Instrucciones para Bambu Studio

Archivos: `tests/fixtures/maker-double-wall/double-wall-vase-test.stl` y `double-wall-conventional-test.stl` (mm, Z hacia arriba, base en Z = 0, abertura de A hacia −X). Importar sin escalar ni rotar. Los nombres de los ajustes pueden variar según la versión.

**Perfil base común:** impresora con boquilla 0,4 mm, un solo filamento, altura de capa **0,20 mm**, "Standard". Anotar el **ancho de línea** de la pared exterior (por defecto ≈ 0,42 mm). Soportes **desactivados**. Brim/skirt: ninguno (o el mismo en ambos). Relleno 0 %. Capas superiores (top shell) **0** en ambos. Capas inferiores (bottom shell) **el mismo número en ambos** (probar 1 y 3). Mismas velocidades/aceleraciones.

**Prototipo A (modo jarrón):** *Proceso → Otros → Modo especial → Spiral vase* (activado). Paredes (wall loops): 1 (el modo jarrón lo fuerza). Generador de paredes: probar **Clásico** y después **Arachne** (anotar si cambia). Marcar "Timelapse" apagado. Si existe, "Smooth spiral" apagado en la primera prueba.

**Prototipo B (convencional), dos corridas:** **B1**: wall loops = 1 (misma pared de 0,42 mm que el jarrón: comparación de consumo equivalente). **B3**: wall loops = 3 (las paredes del modelo miden 1,2 mm). Ambas sin spiral vase.

Laminar, abrir la **vista previa** y anotar: tiempo estimado, filamento (g / m), cantidad de capas.

## 7. Qué observar al laminar

**A (las cinco pruebas que deciden si el método sirve):**
1. **¿Se imprimen las dos paredes?** En la vista previa (capa a media altura) deben verse dos anillos concéntricos separados ≈ 20–40 mm y las dos placas de unión a cada lado de la abertura. Si falta la pared interior → el laminador solo tomó parte del contorno: el método falla.
2. **¿Trayectoria continua?** Con la barra de capas, una sola línea cerrada por capa que va por la pared exterior, entra por el flanco, recorre la interior y vuelve por el otro flanco. Sin tramos sueltos.
3. **Desplazamientos en vacío** (travel): activar *Travel* en la leyenda: no debería haber ninguno dentro de las capas (solo el de arranque). Retracciones: ninguna.
4. **¿Imprime la cámara?** Un anillo extra en el hueco (la cámara) significa que el laminador trata el hueco como otro lazo → la espiral deja de ser una sola línea. Este es el riesgo principal.
5. **¿La abertura sigue abierta?** Mirar la abertura de 2 mm en varias capas; el laminador **no debe cerrarla** (ni "reparar" ni fusionar los flancos). Una leve fusión puede ser aceptable (documentar cuánto), pero debe notarse.
Además: las capas inferiores (si el laminador agrega relleno sólido, no debe taparse la cámara de forma ilógica) y el cambio de capa continuo (sin escalones).

**B1 y B3:** que no pida soportes; que los nervios se impriman como paredes verticales (en B1 una línea por cara del nervio: puede fusionarse en una); que los huecos de la cámara queden abiertos.

## 8. Cómo comparar tiempo y consumo

Una tabla con **los mismos ajustes** (§6) y los datos de la vista previa de cada corrida:

| Corrida | Tiempo | Filamento (g) | Capas | ¿Soportes? | Observaciones |
|---|---|---|---|---|---|
| A jarrón |  |  |  |  |  |
| B1 (1 perímetro) |  |  |  |  |  |
| B3 (3 perímetros) |  |  |  |  |  |

Comparar **A vs B1** (misma pared de 0,42 mm): la diferencia es la estrategia (una espiral vs capas con costura y desplazamientos) y que el jarrón omite la pared del hueco. **A vs B3**: la diferencia práctica de peso y rigidez. No comparar con perfiles distintos. Contrastar el filamento de A con la estimación geométrica (31,7 cm³ ≈ 39 g de PLA a 1,24 g/cm³, solo de referencia) y el de B1 con 70 cm³: si difieren mucho, algo del laminador no se está interpretando como se espera (por ejemplo, imprime la cámara).

## 9. Recomendación técnica (con la evidencia disponible)

- **Geométricamente ambos prototipos son válidos** (cerrados, orientados, 1 componente, topología estable en las 600 capas, separación ≥ 20 mm medida sobre las mallas). Para A eso es una **condición necesaria**, no una confirmación del modo jarrón.
- **No hay datos de laminado, así que no declaro ganador.** Lo que se puede decir: B es seguro de fabricar por construcción (verticales, sin puentes ni voladizos) pero imprime más (la estimación geométrica da ≈ 2 veces el recorrido de A con 1 perímetro y ≈ 3 veces el volumen con 3). A tiene un potencial de ahorro grande **si y solo si** el laminador toma la cámara como un hueco ignorado y respeta la abertura (puntos 1, 2, 4 y 5 de §7).
- **Siguiente paso:** correr las tres corridas de §6/§8. Si A pasa los cinco chequeos y el ahorro de tiempo/filamento es significativo (la proporción la fija el equipo; sugiero revisar la ganancia de tiempo antes de aceptar la complejidad de la abertura), vale integrar el modo **Espiral / Convencional**. Si A falla en 1, 2 o 4, o la ventaja es chica, **priorizar el sistema convencional (B)**.
- **Qué se reutiliza en cualquiera de los dos casos** (la arquitectura de dos perfiles independientes queda): `profiles.ts` (perfiles exterior e interior independientes, `measureChamberGap`, `minFluteCurvatureRadius`, `planeAngle`), `build.ts` (loft con lazos de igual cantidad de vértices, tapas por tiras; las dos estrategias comparten todo salvo el armado de la unión), `sliceAnalysis.ts` (inspección por capas), `validateDoubleWall`. Un futuro `fabricationMode: "spiral" | "convencional"` solo cambiaría la unión de las paredes. Para integrarlo a la lámpara real faltan: el dimensionado para el portalámparas E27 y la bombilla (el vacío central de este experimento es demasiado chico), el cuello roscado y el reborde (la pantalla de doble pared tendría que nacer sobre el cuello existente), el anillo/terminación superior (la cámara está abierta arriba) y el encaje con los difusores. Nada de eso se hizo.

## 10. Reproducir

```bash
node scripts/generate-double-wall-prototypes.mjs        # regenera los STL y double-wall-report.json (determinista)
node --test tests/maker-lamps-v4-double-wall.test.mjs   # 15 tests geométricos
```
