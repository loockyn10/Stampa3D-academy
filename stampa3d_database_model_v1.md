# Stampa3D Database Model v1.0

## Principio general
Base simple, clara y escalable. No agregar campos innecesarios. Cada tabla debe existir porque ayuda a vender, gestionar contenido o ahorrar tiempo al usuario.

## Usuarios y membresías

### profiles
Extiende `auth.users` de Supabase.

Campos:
- id uuid pk references auth.users(id)
- full_name text
- avatar_url text
- role text: member | admin
- membership_status text: active | inactive | cancelled | expired
- membership_started_at timestamptz
- membership_expires_at timestamptz
- active_months integer default 0
- member_level text: bronze | silver | gold | elite
- created_at timestamptz
- updated_at timestamptz

Regla de acceso:
- admin entra siempre
- member entra solo si membership_status = active

---

## Cursos

### instructors
- id uuid pk
- name text
- bio text
- avatar_url text
- is_active boolean
- created_at timestamptz

### course_categories
- id uuid pk
- name text
- slug text unique
- description text
- sort_order integer
- is_active boolean

### courses
- id uuid pk
- category_id uuid fk course_categories.id
- instructor_id uuid fk instructors.id
- title text
- slug text unique
- description text
- thumbnail_url text
- level text: beginner | intermediate | advanced
- is_published boolean
- sort_order integer
- created_at timestamptz
- updated_at timestamptz

### course_modules
- id uuid pk
- course_id uuid fk courses.id
- title text
- description text
- sort_order integer
- is_published boolean

### lessons
- id uuid pk
- module_id uuid fk course_modules.id
- title text
- description text
- video_url text
- duration_minutes integer
- sort_order integer
- is_published boolean
- created_at timestamptz
- updated_at timestamptz

### lesson_resources
Archivos o links asociados a una clase.
- id uuid pk
- lesson_id uuid fk lessons.id
- title text
- resource_type text: pdf | stl | zip | link
- url text
- sort_order integer
- created_at timestamptz

### lesson_progress
Progreso manual por usuario.
- id uuid pk
- user_id uuid fk profiles.id
- lesson_id uuid fk lessons.id
- completed boolean default false
- completed_at timestamptz
- created_at timestamptz

Regla:
- Un usuario puede marcar una clase como completada.
- No hay certificados en V1.

---

## Librería STL

### stl_categories
- id uuid pk
- name text
- slug text unique
- description text
- thumbnail_url text
- sort_order integer
- is_active boolean

### stl_models
Modelo base. Ejemplo: Jarro, Mate, Llavero.
- id uuid pk
- category_id uuid fk stl_categories.id
- name text
- slug text unique
- description text
- thumbnail_url text
- is_active boolean
- created_at timestamptz
- updated_at timestamptz

### stl_variants
Variante descargable. Ejemplo: Argentina, River, Boca.
- id uuid pk
- model_id uuid fk stl_models.id
- name text
- description text
- thumbnail_url text
- file_url text
- material_recommended text
- estimated_print_time_minutes integer
- estimated_weight_grams integer
- difficulty text: easy | medium | hard
- download_count integer default 0
- is_active boolean
- created_at timestamptz
- updated_at timestamptz

---

## Calculadora y configuración

### user_calculator_settings
Configuraciones propias de cada usuario.
- id uuid pk
- user_id uuid fk profiles.id unique
- default_kwh_price numeric
- default_printer_consumption_watts numeric
- default_machine_wear_cost numeric
- default_mercadolibre_extra_cost numeric
- default_mercadolibre_commission_percent numeric
- created_at timestamptz
- updated_at timestamptz

### product_multipliers
Multiplicadores configurables por usuario.
- id uuid pk
- user_id uuid fk profiles.id
- name text  -- Llavero, Jarro, Mate, etc.
- multiplier numeric
- is_active boolean
- created_at timestamptz

### user_printers
Impresoras del usuario para cálculos.
- id uuid pk
- user_id uuid fk profiles.id
- name text
- consumption_watts numeric
- maintenance_cost numeric
- amortization_cost numeric
- is_default boolean
- is_active boolean
- created_at timestamptz

---

## Filamentos

### filaments
- id uuid pk
- user_id uuid fk profiles.id
- name text
- type text  -- PLA, PETG, ABS, TPU, etc.
- color text
- remaining_quantity_grams numeric
- price numeric
- created_at timestamptz
- updated_at timestamptz

Regla:
- El filamento se usa en calculadora y productos.
- Debe ser simple.

---

## Productos

### products
Productos propios reutilizables para presupuestos y stock.
- id uuid pk
- user_id uuid fk profiles.id
- filament_id uuid fk filaments.id
- name text
- image_url text
- grams numeric
- print_time_minutes integer
- cost numeric
- price numeric
- stock_quantity integer default 0
- is_active boolean
- created_at timestamptz
- updated_at timestamptz

---

## Presupuestos

### clients
- id uuid pk
- user_id uuid fk profiles.id
- name text
- phone text
- created_at timestamptz

### budgets
- id uuid pk
- user_id uuid fk profiles.id
- client_id uuid fk clients.id
- status text: draft | sent | approved | rejected
- total numeric
- notes text
- created_at timestamptz
- updated_at timestamptz

### budget_items
- id uuid pk
- budget_id uuid fk budgets.id
- product_id uuid fk products.id
- quantity integer
- unit_price numeric
- subtotal numeric

---

## Stock

En V1, el stock será simple y estará integrado en products.stock_quantity y filaments.remaining_quantity_grams.

No crear stock_movements en V1 salvo que sea imprescindible.

---

## Sorteos

### raffles
- id uuid pk
- title text
- description text
- raffle_date date
- is_active boolean
- created_at timestamptz

### raffle_prizes
Permite varios premios por sorteo.
- id uuid pk
- raffle_id uuid fk raffles.id
- name text
- description text
- image_url text
- prize_order integer

### raffle_winners
- id uuid pk
- raffle_id uuid fk raffles.id
- prize_id uuid fk raffle_prizes.id
- user_id uuid fk profiles.id
- winner_name text
- created_at timestamptz

Reglas:
- Todos los miembros activos participan automáticamente.
- Algunos niveles tienen doble participación.
- La antigüedad se mantiene acumulada.

---

## Insignias

### badges
- id uuid pk
- name text
- description text
- icon text
- is_active boolean
- created_at timestamptz

### user_badges
- id uuid pk
- user_id uuid fk profiles.id
- badge_id uuid fk badges.id
- awarded_at timestamptz

---

## Pagos

### subscriptions
- id uuid pk
- user_id uuid fk profiles.id
- mercado_pago_subscription_id text
- status text: active | paused | cancelled | expired
- amount numeric
- started_at timestamptz
- next_payment_at timestamptz
- created_at timestamptz
- updated_at timestamptz

### payments
- id uuid pk
- user_id uuid fk profiles.id
- subscription_id uuid fk subscriptions.id
- mercado_pago_payment_id text
- status text: approved | pending | rejected | cancelled
- amount numeric
- paid_at timestamptz
- created_at timestamptz

Regla:
- La membresía se activa por webhook confirmado de Mercado Pago.
- No activar membresía solo por volver del checkout.

---

## Admin
El admin puede crear, editar y desactivar:
- cursos
- módulos
- clases
- instructores
- categorías STL
- modelos STL
- variantes STL
- sorteos
- premios
- ganadores
- usuarios
- insignias

---

## Storage recomendado
Supabase Storage buckets:
- course-images
- lesson-files
- stl-files
- stl-thumbnails
- user-avatars
- product-images
- raffle-images

Videos:
- No se guardan en Supabase.
- Se guarda solo video_url o video_id de Bunny/Mux/Vimeo.

---

## Prioridad de implementación

Sprint 1:
- Supabase Auth
- profiles
- protección de rutas
- membresía activa

Sprint 2:
- cursos reales
- módulos
- clases
- progreso

Sprint 3:
- admin cursos

Sprint 4:
- STL

Sprint 5:
- calculadora + filamentos + configuración

Sprint 6:
- productos + presupuestos + stock simple

Sprint 7:
- sorteos + insignias

Sprint 8:
- Mercado Pago + webhooks
