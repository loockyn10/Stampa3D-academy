# Stampa3D Platform Blueprint v1.0

## 1. Objetivo del proyecto

Stampa3D no debe ser solo una plataforma de cursos. Debe ser una plataforma integral para emprendedores de impresión 3D.

El objetivo es que el usuario pueda:

- Aprender impresión 3D.
- Descargar archivos STL.
- Calcular costos.
- Presupuestar productos.
- Gestionar productos propios.
- Controlar stock.
- Participar en sorteos.
- Acceder a una comunidad.

La plataforma debe ser simple, rápida, profesional y fácil de usar.

Regla principal:

> Si una función no le ahorra tiempo, dinero o esfuerzo al usuario, no debe estar.

---

## 2. Filosofía de UX

La plataforma debe sentirse limpia, clara y rápida.

No debe parecer un ERP pesado ni una planilla de Excel con diseño moderno.

Principios:

- Pocos campos.
- Pocos clics.
- Navegación clara.
- Diseño claro con fondo claro.
- Color principal naranja.
- Sidebar lateral.
- Cards modernas.
- Formularios simples.
- Información útil, no excesiva.

El usuario entra a trabajar, no a aprender a usar la plataforma.

---

## 3. Stack tecnológico

Frontend:
- Next.js
- TypeScript
- Tailwind CSS

Hosting frontend:
- Vercel

Base de datos:
- Supabase PostgreSQL

Autenticación:
- Supabase Auth

Storage:
- Supabase Storage para imágenes, STL, PDF, ZIP y avatares.

Videos:
- Bunny Stream, Mux o Vimeo.
- Los videos NO deben alojarse en Supabase ni en Vercel.
- La base solo guarda el link o ID del video.

Pagos:
- Mercado Pago con suscripción mensual.

Repositorio:
- GitHub

---

## 4. Roles de usuario

Roles iniciales:

- member
- admin

No habrá usuario gratuito dentro de la plataforma.

Regla de acceso:

- Si el usuario no inició sesión, va a /login.
- Si el usuario inició sesión pero no tiene membresía activa, no accede a la plataforma.
- Si el usuario tiene membership_status = active, accede.
- Si el usuario tiene role = admin, accede siempre.

---

## 5. Membresía

Habrá una sola membresía principal.

Mientras esté activa, el usuario accede a:

- Cursos
- Sorteos
- Calculadora
- Librería STL
- Presupuestos
- Productos
- Stock
- Comunidad
- Perfil

Campos importantes del usuario:

- membership_status
- membership_started_at
- membership_expires_at
- active_months
- member_level

Estados de membresía:

- active
- inactive
- cancelled
- expired

La antigüedad se conserva aunque el usuario deje de pagar y vuelva más adelante.

---

## 6. Niveles de miembro

Los niveles sirven para beneficios, regalos y chances extra en sorteos.

Niveles iniciales:

- bronze
- silver
- gold
- elite

Regla inicial de sorteos:

- Algunos niveles tienen 1 participación.
- Otros niveles pueden tener 2 participaciones.

Los valores exactos podrán configurarse luego.

---

## 7. Dashboard

El dashboard debe mostrar:

- Bienvenida al usuario.
- Continuar curso.
- Próximo sorteo.
- Últimos STL agregados.
- Acceso rápido a calculadora.
- Productos con bajo stock.
- Estadísticas simples.

No debe estar sobrecargado.

---

## 8. Módulo Cursos

Estructura:

Curso
→ Módulos
→ Clases

Cada curso puede tener:

- Título
- Descripción
- Imagen
- Banner
- Instructor
- Categoría
- Nivel
- Estado
- Orden
- Destacado

Cada módulo puede tener:

- Título
- Descripción
- Orden

Cada clase puede tener:

- Video
- Descripción breve
- PDF descargable
- STL descargable
- ZIP descargable
- Links externos
- Comentarios o preguntas

Progreso:

- El usuario marca manualmente una clase como completada.
- No se implementan certificados en V1.
- La base puede quedar preparada para certificados a futuro.

---

## 9. Instructores

Cada curso puede tener un instructor distinto.

Ejemplos:

- Curso de diseño: licenciado en diseño industrial.
- Curso de láser: especialista en grabado láser.
- Curso OrcaSlicer: instructor de Stampa3D.

Campos mínimos:

- Nombre
- Foto
- Bio breve
- Especialidad

---

## 10. Librería STL

Estructura:

Categoría
→ Modelo base
→ Variante

Ejemplo:

Jarro
→ Argentina
→ River
→ Boca

Todos los STL son descargables para miembros activos.

No se implementan favoritos en V1.
No es necesario relacionar STL con cursos en V1.

Cada variante STL debe tener:

- Nombre
- Descripción
- Imagen/thumbnail
- Archivo descargable
- Material recomendado
- Tiempo estimado de impresión
- Peso estimado
- Dificultad
- Si requiere soportes
- Estado activo/inactivo

---

## 11. Calculadora

La calculadora debe ser una de las herramientas principales de la plataforma.

Debe tener modo básico y modo avanzado.

### 11.1 Modo básico

Campos visibles:

- Filamento
- Gramos
- Tiempo de impresión
- Tipo de producto

El tipo de producto aplica un multiplicador preconfigurado por el usuario.

Ejemplos:

- Llavero → x3
- Jarro → x2.5
- Mate → x2.2
- Maceta → x2.8
- Cartel → x3.5
- Personalizado → libre

Resultados visibles:

- Costo estimado
- Precio normal sugerido
- Precio para Mercado Libre

El precio para Mercado Libre debe sumar un monto o comisión por defecto configurada.

Valores ocultos en modo básico:

- Precio kWh
- Consumo impresora
- Desgaste/mantenimiento
- Comisión Mercado Libre
- Monto extra Mercado Libre

Estos valores salen de configuración del usuario.

### 11.2 Modo avanzado

Secciones:

Material:
- Filamento
- Gramos
- Costo
- Porcentaje de error

Electricidad:
- Horas
- Minutos
- Consumo impresora
- Precio kWh
- Mano de obra

Margen:
- Multiplicador
- Gastos de envío
- Comisión plataforma

Costos extra:
- Mantenimiento / amortización
- Otros costos

Resultado:

- Costo real
- Precio normal sugerido
- Precio Mercado Libre
- Ganancia estimada

---

## 12. Configuración del usuario

La configuración es el cerebro de la plataforma.

Debe permitir editar:

### Perfil

- Nombre
- Foto

### Multiplicadores

El usuario puede configurar multiplicadores por tipo de producto:

- Llavero
- Jarro
- Mate
- Maceta
- Cartel
- Personalizado

### Valores de calculadora

- Precio kWh
- Comisión Mercado Libre
- Monto extra Mercado Libre
- Desgaste/mantenimiento por defecto

### Impresoras

El usuario puede registrar sus impresoras.

Campos mínimos:

- Nombre personalizado
- Modelo
- Consumo estimado
- Costo mantenimiento/amortización

Ejemplo:

- Bambu A1
- Creality Hi

La calculadora puede tomar estos valores cuando el usuario selecciona una impresora.

---

## 13. Filamentos

El módulo filamentos debe ser simple.

Campos:

- Nombre
- Tipo
- Color
- Cantidad actual/restante
- Precio

Los filamentos se reutilizan en:

- Calculadora
- Productos

No agregar campos técnicos de slicer como temperatura, retracción o flow.
Eso se gestiona en OrcaSlicer, no en Stampa3D.

---

## 14. Productos

Los productos son reutilizables en presupuestos y stock.

Campos:

- Nombre
- Imagen
- Filamento
- Gramos
- Tiempo
- Costo
- Precio
- Stock

Ejemplo:

Jarro Argentina 500cc
- Filamento: PLA blanco/celeste
- Gramos: 140
- Tiempo: 6h
- Costo: $4000
- Precio: $12000
- Stock: 8

---

## 15. Presupuestos

El presupuesto debe ser simple.

Campos:

- Cliente
- Producto
- Cantidad
- Precio
- Total
- Estado

Estados:

- draft
- sent
- approved
- rejected

Los productos creados previamente deben poder seleccionarse en presupuestos.

---

## 16. Stock

El stock debe ser simple.

Campos:

- Producto
- Cantidad

Se puede mostrar alerta de stock bajo.

No construir un ERP complejo en V1.

---

## 17. Sorteos

Todos los miembros activos participan automáticamente.

Reglas:

- Cada miembro activo tiene al menos 1 participación.
- Algunos niveles pueden tener 2 participaciones.
- Un sorteo puede tener uno o varios premios.
- Debe haber historial de sorteos.

Cada sorteo debe mostrar:

- Fecha
- Mes
- Premio/s
- Ganador/es

Ejemplo:

28/08/2026
Ganador: Juan Pérez
Premio: Bambu Lab A1 Mini Combo

---

## 18. Insignias

Las insignias son reconocimiento, no desbloquean funciones.

Insignias iniciales:

- Miembro fundador
- 3 meses activo
- 6 meses activo
- 1 año activo
- Ganador de sorteo
- 10 cursos completados
- 50 STL descargados
- 100 STL descargados

Tablas necesarias:

- badges
- user_badges

---

## 19. Perfil

El perfil debe ser simple.

Debe mostrar:

- Foto
- Nombre
- Miembro desde
- Nivel
- Meses activos
- Participaciones para sorteos
- Cursos completados
- STL descargados
- Insignias

El usuario puede editar:

- Nombre
- Foto

---

## 20. Comunidad

La comunidad por ahora será externa.

Debe tener accesos a:

- Telegram
- WhatsApp
- YouTube
- Instagram

Cada página/card debe mostrar:

- Ícono
- Descripción breve
- Botón de acceso externo

---

## 21. Panel Admin

Ruta:

/admin

El admin puede gestionar:

- Usuarios
- Cursos
- Módulos
- Clases
- Instructores
- Librería STL
- Sorteos
- Ganadores
- Insignias
- Configuración general

El admin puede:

- Crear / editar / desactivar cursos
- Crear módulos y clases
- Subir miniaturas, PDFs, ZIP y STL
- Cargar links o IDs de videos
- Crear categorías STL
- Crear modelos y variantes STL
- Crear sorteos
- Cargar ganadores
- Activar/desactivar membresías
- Cambiar nivel del miembro
- Asignar insignias

Archivos en Supabase Storage:

- course-images
- lesson-files
- stl-files
- stl-thumbnails
- user-avatars

Videos:

- No se suben a Supabase.
- El admin pega el link o ID del servicio de video.

---

## 22. Mercado Pago

Debe integrarse desde el lanzamiento.

Modelo:

- Suscripción mensual.
- Un solo plan inicial.

Flujo:

Usuario se registra
→ paga membresía
→ Mercado Pago confirma pago vía webhook
→ Supabase actualiza membership_status = active
→ usuario accede a la plataforma

Importante:

La membresía no se activa solo porque el usuario volvió del checkout.
Debe activarse cuando llega el webhook confirmado de Mercado Pago.

Tablas mínimas:

subscriptions:
- user_id
- mercado_pago_subscription_id
- status
- amount
- started_at
- next_payment_at

payments:
- user_id
- mercado_pago_payment_id
- status
- amount
- paid_at

---

## 23. Base de datos prevista

Tablas principales:

- profiles
- instructors
- course_categories
- courses
- course_modules
- lessons
- lesson_resources
- lesson_progress
- lesson_comments
- stl_categories
- stl_models
- stl_variants
- filaments
- printers
- calculator_settings
- product_multipliers
- products
- budgets
- budget_items
- raffles
- raffle_prizes
- raffle_winners
- badges
- user_badges
- subscriptions
- payments
- app_settings

---

## 24. V1: lanzamiento inicial

La V1 debe incluir:

- Login
- Registro
- Membresía activa/inactiva
- Cursos
- Librería STL
- Calculadora básica y avanzada
- Filamentos
- Impresoras en configuración
- Productos
- Presupuestos
- Stock simple
- Sorteos
- Perfil
- Insignias
- Comunidad externa
- Panel Admin
- Mercado Pago

---

## 25. V2 o futuro

No implementar en V1:

- App móvil
- Integración con OrcaSlicer
- Lectura automática de GCode/3MF
- Marketplace
- IA para presupuestar
- CRM avanzado
- Estadísticas avanzadas
- Empresas con múltiples empleados
- Certificados
- Favoritos STL
- Foro interno

---

## 26. Regla final de desarrollo

Cada módulo debe ser simple en la superficie y flexible por detrás.

Ejemplo:

- La calculadora básica debe parecer simple.
- La configuración permite personalizarla.
- El usuario no debe ver complejidad si no la necesita.

Regla:

> Primero simple. Después potente.

