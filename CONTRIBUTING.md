# Stampa3D Platform - Development Guidelines

## Objetivo

Construir una plataforma profesional, rápida, simple y escalable para emprendedores de impresión 3D.

Toda decisión de desarrollo debe priorizar:

- Simplicidad
- Rendimiento
- Escalabilidad
- Mantenimiento
- Buena experiencia de usuario

Nunca agregar funcionalidades innecesarias.

---

# Filosofía

La plataforma debe sentirse rápida, limpia y fácil de usar.

Si una funcionalidad agrega complejidad pero poco valor para el usuario, no debe implementarse.

Siempre preferir:

- menos clics
- menos formularios
- menos configuración
- más automatización

---

# Arquitectura

Antes de crear una funcionalidad nueva:

1. Revisar el Blueprint.
2. Revisar el Database Model.
3. Mantener la arquitectura existente.
4. No reorganizar el proyecto sin autorización.

---

# Diseño

NO modificar:

- Colores
- Tipografía
- Espaciados
- Layout
- Componentes

Salvo que la tarea lo solicite explícitamente.

El frontend actual es la referencia oficial.

---

# Base de Datos

Nunca crear tablas nuevas sin que estén definidas previamente en:

stampa3d_database_model_v1.md

Nunca inventar columnas.

Nunca modificar relaciones existentes sin autorización.

---

# Supabase

Usar únicamente:

- Supabase Auth
- PostgreSQL
- Storage
- RLS

Seguir siempre las mejores prácticas oficiales de Supabase.

---

# Código

Preferencias:

- TypeScript estricto
- Componentes pequeños
- Código reutilizable
- Evitar duplicación
- Nombres claros
- Mantener consistencia

---

# Librerías

No instalar librerías nuevas si existe una solución nativa.

Cada dependencia nueva debe estar justificada.

---

# Seguridad

Nunca utilizar:

- service_role en frontend
- claves privadas expuestas
- consultas inseguras

Respetar siempre RLS.

---

# Commits

Cada Sprint debe terminar con:

git add .
git commit
git push

Nunca mezclar varias funcionalidades en un mismo commit.

---

# Antes de finalizar cualquier tarea

Siempre ejecutar:

npm run build

Si existe algún error:

Corregirlo antes de finalizar.

Nunca entregar código con errores de compilación.

---

# Respuesta esperada

Al terminar una tarea informar:

- Archivos creados.
- Archivos modificados.
- Librerías instaladas.
- Cambios realizados.
- Resultado del build.

---

# Regla Principal

No tomar decisiones de arquitectura.

Si una decisión afecta la arquitectura del proyecto, detenerse y solicitar confirmación.

La prioridad absoluta es mantener la plataforma limpia, escalable y consistente.