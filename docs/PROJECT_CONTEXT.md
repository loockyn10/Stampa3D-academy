# PROJECT_CONTEXT

## Qué es Stampa

Stampa3D / Academia Stampa es una plataforma para personas y negocios que trabajan con impresión 3D. El producto combina formación, cálculo de costos/precios, gestión del taller, gestión comercial y asistencia con IA.

La arquitectura conceptual del producto se organiza en tres dominios principales:

- **Academia = aprender**
- **Mi Taller = fabricar**
- **Mi Negocio = vender**

A estos dominios se suman **Calculadora**, **Stampy IA**, perfil/acceso, progresión/XP y la capa pública/comercial de tienda.

## Para quién existe

Usuarios objetivo:

- makers que empiezan a vender impresión 3D;
- talleres que necesitan ordenar costos, materiales, producción e inventario;
- negocios que venden productos fabricados o artículos de reventa;
- alumnos que quieren aprender impresión 3D y convertir conocimiento en una operación real.

La prioridad de UX es que Stampa siga siendo entendible para un usuario no técnico aun cuando internamente maneje reglas complejas de stock, pricing, ventas y permisos.

## Problema que resuelve

Stampa busca evitar que el usuario tenga herramientas separadas y procesos manuales para:

- aprender;
- calcular cuánto cuesta fabricar;
- definir precios;
- administrar impresoras y filamentos;
- registrar productos y producción;
- controlar inventario;
- vender y reponer stock;
- analizar el negocio;
- recibir asistencia contextual de IA.

## Modelo de acceso vigente

Conceptualmente existen cuatro estados:

- **Anonymous:** puede probar la Calculadora con configuración Demo.
- **Free:** cuenta registrada sin acceso pago; puede usar y personalizar la Calculadora, pero no acceder a las áreas premium.
- **Paid:** acceso completo según membresía/permisos.
- **Admin:** capacidades administrativas además de las capacidades correspondientes de plataforma.

Regla crítica: **estar autenticado no implica tener acceso pago**.

## Navegación conceptual

La arquitectura de información objetivo es:

- Inicio
- Stampy IA
- Calculadora
- Academia
- Mi Taller
- Mi Negocio

Mi Taller agrupa la operación productiva. Mi Negocio agrupa la operación comercial.

La navegación exacta actual **REQUIERE VERIFICACIÓN EN REPO**.

## Estado general

El proyecto está en desarrollo activo y ya contiene múltiples dominios con reglas de negocio no triviales: pricing, inventario, ubicaciones internas, ventas, acceso Free/Paid, XP, IA y e-commerce.

El repositorio y `/docs` son la fuente de verdad permanente. Las conversaciones no deben utilizarse como memoria operativa del proyecto.

## Principio de continuidad

Ante contradicción:

1. comprobar el código, migrations, tests y configuración del repositorio;
2. contrastar con `/docs`;
3. señalar la discrepancia antes de asumir cuál es correcto;
4. actualizar la documentación cuando se resuelva.

Nunca reconstruir una decisión importante solamente desde memoria de un chat.
