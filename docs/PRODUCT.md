# PRODUCT

## 1. Principios de producto

Stampa debe mantener una separación conceptual clara:

- **Academia:** aprender.
- **Mi Taller:** fabricar.
- **Mi Negocio:** vender.
- **Calculadora:** estimar costos y precios.
- **Stampy IA:** asistir usando contexto de Stampa sin saltarse permisos.

La interfaz debe reducir complejidad sin ocultar reglas necesarias. Mobile es una prioridad. Evitar UI nativa inconsistente cuando exista un componente propio.

## 2. Acceso Anonymous / Free / Paid

### Anonymous

Puede usar la misma Calculadora con una configuración Demo válida.

Puede modificar variables del cálculo como gramos, tiempo, margen y extras. Los selectores de impresora/filamento deben verse como controles reales, pero la personalización abre un CTA de registro.

El usuario debe obtener valor antes de registrarse.

### Free

Es un usuario autenticado sin acceso premium.

Puede:

- usar la Calculadora;
- elegir varias impresoras de catálogo para calcular;
- elegir varios filamentos de catálogo para calcular;
- guardar defaults/preferencias de Calculadora.

No puede acceder a:

- Mi Taller;
- Mi Negocio;
- Academia premium;
- Stampy premium;
- mutaciones o datos premium por URL, API, RPC o acceso directo.

El usuario Free puede ver que esas áreas existen, pero no debe recibir la interfaz interna completa de cada módulo.

### Paid

Mantiene la experiencia completa de plataforma. La Calculadora debe reutilizar sus entidades reales cuando corresponda.

### Admin

Los permisos administrativos son independientes del estado Free/Paid y deben respetar la arquitectura real de acceso.

## 3. Calculadora

La Calculadora pública y la Calculadora de miembros deben reutilizar **el mismo motor de cálculo**. No crear fórmulas o calculadoras paralelas.

### Demo

La configuración Demo debe usar una impresora y un filamento válidos del catálogo, claramente identificados como Demo.

### Free

Seleccionar un template de filamento significa:

> “Uso este material para calcular”.

No significa:

> “Poseo una bobina física con X gramos”.

Por lo tanto Free no debe crear stock físico ficticio.

La última decisión de arquitectura es:

- Anonymous → template Demo.
- Free → referencias seleccionadas a `printer_templates` y `filament_templates`.
- Paid → impresoras/filamentos físicos reales.

Los nombres concretos de tablas y estado de implementación **REQUIEREN VERIFICACIÓN EN REPO**.

## 4. Mi Taller

Mi Taller representa **cómo se fabrica**.

Arquitectura conceptual:

- Impresoras
- Filamentos
- Productos
- Inventario

### Impresoras

Las impresoras físicas del usuario deben poder vincularse al catálogo de modelos. La imagen oficial pertenece al modelo del catálogo y puede reutilizarse por todos los usuarios.

Un futuro override con foto personalizada del usuario es posible, pero no es requisito base.

### Filamentos

Una bobina física corresponde a una entidad física. Regla UX:

> una bobina física = una card.

No confundir templates/materiales de catálogo con bobinas disponibles en inventario.

### Productos

Mi Taller → Productos describe **cómo fabricar** un producto:

- receta;
- filamentos;
- gramos;
- componentes;
- impresora/configuración;
- tiempo;
- costos;
- pricing.

No duplicar datos productivos dentro del Catálogo comercial.

### Inventario

Representa unidades terminadas.

Dos operaciones distintas:

- **Registrar producción:** consume materiales y aumenta producto terminado.
- **Ajustar inventario:** corrige cantidad sin consumir filamento.

No crear dos contadores contradictorios para las mismas unidades fabricadas.

## 5. Pricing

La implementación real del motor es la única fuente de verdad técnica.

Modelo conceptual:

`costo base = material + electricidad + mano de obra + depreciación + packaging + otros costos`

`precio final = (base + extras) × (1 + margen)`

Reglas:

- soportar multifilamento;
- soportar productos ensamblables/componentes;
- no contar dos veces la misma receta;
- nunca sumar simultáneamente fuentes legacy y normalizadas si representan el mismo consumo;
- los cambios de UI deben reutilizar el motor existente, no reimplementarlo.

El detalle exacto de fórmulas y tablas **REQUIERE VERIFICACIÓN EN REPO**.

## 6. Mi Negocio

Mi Negocio representa **qué se vende y cómo se opera comercialmente**.

Arquitectura objetivo:

- Catálogo
- Venta rápida
- Ventas
- Reposición
- Métricas
- Presupuestos
- Mi Tienda

`Clientes` no debe ser un destino de navegación redundante si su gestión está integrada en Presupuestos u otro flujo.

La estructura final visible **REQUIERE VERIFICACIÓN EN REPO**.

## 7. Productos fabricados vs reventa

Un artículo comercial puede ser:

### Fabricado

Vinculado a un producto de Mi Taller.

No duplicar:

- receta;
- costo productivo;
- stock terminado.

### Reventa

Existe comercialmente sin receta productiva.

Ejemplos:

- filamento cerrado;
- impresoras;
- boquillas;
- accesorios.

Puede tener costo de compra, precio, SKU, barcode y stock comercial.

## 8. Catálogo comercial

Mi Negocio → Catálogo contiene la capa de venta:

- nombre comercial;
- marca/categoría;
- descripción;
- precio;
- SKU;
- barcode;
- proveedor;
- imágenes/publicación.

Eliminar un artículo del catálogo debe preservar historial cuando corresponda. Preferir archivado/soft-delete y reactivación sobre duplicación de registros.

## 9. Showroom y Depósito

La separación interna de ubicaciones es opcional.

Si está desactivada, la UX no debe introducir complejidad innecesaria.

Si está activada:

`stock total = showroom + depósito`

Una transferencia entre ubicaciones no modifica el stock total.

### Venta

La disponibilidad comercial es:

`available_for_sale = showroom + depósito`

Orden de consumo:

1. Showroom.
2. Depósito por el faltante.

Ejemplo:

- showroom = 2
- depósito = 10
- venta = 5

Resultado:

- showroom = 0
- depósito = 7

No crear una transferencia ficticia Depósito → Showroom solo para completar una venta.

El backend debe calcular y validar la distribución real de stock.

## 10. Reposición

Separar dos problemas:

### Reposición de Showroom

`faltante = max(target - showroom, 0)`

`reponer = min(faltante, depósito)`

### Compras a proveedor

Debe ayudar a decidir compras usando ventas del período, stock y mínimos.

Para filamentos, convertir a kg usando el peso real de la presentación. Nunca asumir que todo rollo es de 1 kg.

La edición masiva de costos es una necesidad operacional para catálogos grandes.

## 11. Venta rápida y scanner

Scanner físico esperado: HID/keyboard wedge.

Principios:

- scan de producto = +1 al carrito;
- scans repetidos incrementan;
- no abrir un modal entre scans;
- el máximo vendible es el stock total disponible;
- el frontend no decide la distribución Showroom/Depósito;
- el backend revalida stock y ownership;
- no permitir stock negativo.

Prioridad conceptual de handlers cuando existan todos los modos:

1. ingreso de stock;
2. asignación de barcode;
3. Venta rápida;
4. Catálogo;
5. fallback global a Venta rápida.

El ingreso de stock por scanner/case barcode fue diseñado pero su implementación **REQUIERE VERIFICACIÓN EN REPO**.

## 12. Ventas y anulaciones

La acción visible puede llamarse “Eliminar venta”, pero internamente debe ser una **anulación/void auditable**, no un hard delete ciego.

Una venta anulada:

- no cuenta en facturación;
- no cuenta en unidades ni top productos;
- no cuenta en ticket promedio;
- restaura stock mediante movimientos compensatorios;
- no puede restaurar stock dos veces.

No borrar los movimientos originales.

Una venta vinculada a un pago online no debe disparar un refund financiero automático desde la acción de anulación.

El estado real de esta implementación **REQUIERE VERIFICACIÓN EN REPO**.

## 13. Métricas

Priorizar métricas operativas:

- facturación;
- cantidad de ventas;
- ticket promedio;
- unidades;
- kg cuando exista peso conocido;
- productos más vendidos;
- comparación contra período anterior cuando sea válida.

Semana objetivo: lunes a domingo usando timezone correcto.

No convertir la primera versión en un sistema de BI con KPIs no accionables.

## 14. Mi Tienda / e-commerce

Principios vigentes:

- tienda pública por vendedor/slug;
- exponer solo campos explícitamente públicos;
- nunca exponer costos, recetas o IDs internos innecesarios;
- orders y sales son conceptos distintos;
- seller isolation;
- webhooks idempotentes;
- proveedor de pagos desacoplado;
- vendedor conecta su propia cuenta de Mercado Pago mediante OAuth;
- la comisión de marketplace debe ser configurable;
- Stampa no debe depender de recibir manualmente todos los fondos para redistribuirlos.

Estado real del e-commerce **REQUIERE VERIFICACIÓN EN REPO**.

## 15. Stampy IA

Principios:

- contexto disponible no equivale a autorización;
- responder la intención exacta antes que mostrar todo el contexto;
- no inventar UI, acciones, cursos ni datos;
- no prometer una acción si no existe una tool real;
- no exponer rutas, IDs o metadata interna salvo necesidad;
- herramientas de escritura deben ser estrechas, autorizadas y validadas en servidor;
- no crear una tool genérica de “modificar base de datos”.

## 16. XP y progresión

Principios vigentes:

- XP permanente;
- no se pierde por cancelar membresía;
- premiar acciones significativas, no clicks;
- límites diarios limitan XP, no el uso de la función;
- eventos server-authoritative e idempotentes;
- frontend no decide cantidades arbitrarias de XP;
- referrals y XP son sistemas separados;
- sorteos/beneficios por nivel son opcionales y deben mantenerse desacoplados hasta revisión legal.

Estado técnico actual **REQUIERE VERIFICACIÓN EN REPO**.

## 17. UX

Reglas generales:

- dark UI moderna y neutra;
- prioridad mobile;
- dialogs propios, no `alert`, `confirm` o `prompt` nativos;
- selects/popovers propios cuando la UI nativa rompa consistencia;
- estados vacíos deben enseñar y ofrecer la acción principal;
- evitar tours largos de tooltips;
- ayuda contextual corta;
- no resolver bugs de layout con hacks como offsets arbitrarios o `window.scrollTo`;
- evitar redundancia de copy;
- reutilizar flujos en vez de crear experiencias paralelas innecesarias.
