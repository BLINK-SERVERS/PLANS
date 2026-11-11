# Índice de Documentación

> Documentación del **Sistema Integral de Gestión de Suscripciones**.
> Esta carpeta sigue el estándar *docs-as-code*: cada documento versionado junto al código, actualizado con cada cambio.

## Capítulos

| # | Documento | Contenido |
|---|---|---|
| 0 | [`README.md`](../README.md) | Vista general del proyecto |
| 1 | [`01-arquitectura.md`](./01-arquitectura.md) | Stack, estructura, decisiones de diseño |
| 2 | [`02-base-de-datos.md`](./02-base-de-datos.md) | Entidades, relaciones, triggers, RLS, vistas, cron |
| 3 | [`03-integraciones.md`](./03-integraciones.md) | Supabase, GitHub, claves, variables de entorno |
| 4 | [`04-flujos-negocio.md`](./04-flujos-negocio.md) | Referidos, BCV, multi-suscripción, proveedores |
| 5 | [`05-seguridad.md`](./05-seguridad.md) | Gestión de secretos, RLS, rotación de claves |
| 6 | [`06-desarrollo.md`](./06-desarrollo.md) | Setup, comandos, convenciones de código |
| 7 | [`07-despliegue.md`](./07-despliegue.md) | Edge Functions, cron, verificación |
| 8 | [`08-changelog.md`](./08-changelog.md) | Historial de cambios por versión |

## Registros de decisión (ADR)

- [`ADR/001-backend-como-servicio.md`](./ADR/001-backend-como-servicio.md) — Supabase como BaaS (2026-09-19). **Superado por ADR-002**, se conserva porque la convención de esta carpeta es no reescribir ADR aprobados.
- [`ADR/002-neon-en-lugar-de-supabase.md`](./ADR/002-neon-en-lugar-de-supabase.md) — Neon + Better Auth self-hosted + Functions (2026-11-10). **Vigente**, con las mediciones del gate y los fallos encontrados al desplegar.

## Estado de cada capítulo tras la migración a Neon

| # | Documento | Estado |
|---|---|---|
| 01 | Arquitectura | El modelo cliente-servidor sigue siendo el descrito; **la tabla de tecnologías y el diagrama de Supabase no**. Ver ADR-002 y `README.md` del repo. |
| 02 | Base de datos | **Vigente en el modelo de datos** (entidades, relaciones, dinero, conversiones). Obsoleto en `auth.uid()`, `cron.job` y las rutas de migración: el esquema vivo es `db/`. |
| 03 | Integraciones y claves | **Histórico.** Describe el proyecto Supabase (ref, anon/service key, Edge Functions). Las variables actuales están en `.env.example`. |
| 04 | Flujos de negocio | **Vigente.** Los flujos (referidos 30 %, cupos, BCV, multi-suscripción) no cambiaron con el proveedor. |
| 05 | Seguridad | Vigente en el modelo de roles y RLS. Obsoleto en todo lo que mencione la `service_role` o la anon key: aquí no viaja ninguna clave en el bundle. |
| 06 | Desarrollo | **Histórico** para el setup (ya no `supabase start` / `supabase db push`, sino `neon dev` / `neon deploy`). |
| 07 | Despliegue | **Histórico** para Edge Functions y pg_cron; sustituidos por Neon Functions y un Function Trigger (`0 22 * * *`, UTC). |

La regla 1 de más abajo se sigue cumpliendo: un capítulo se actualiza en el
mismo commit que cambia el código. Donde aún no se reescribió el capítulo, la
tabla anterior dice exactamente qué está obsoleto, para que nadie opere con un
documento que describe algo que ya no existe.

## Convenciones de esta documentación

1. **Todo cambio de código debe reflejarse** en el documento correspondiente y en el `08-changelog.md` en el mismo commit.
2. **Los secretos nunca se documentan en texto claro** excepto con marcador `<placeholder>`; los valores reales viven solo en `.env` / gestor de claves.
3. Cada documento es **independiente**: puede leerse sin depender de otro.
4. Código SQL/fuente citado en la documentación debe coincidir con la versión commiteada.
5. Actualización de una decisión de diseño → **nuevo ADR** (nunca se reescribe un ADR aprobado).

## Cómo mantenerla viva

- Antes de mergear una feature: comprobar que `docs/` y `CHANGELOG` están al día.
- Los logs de ejecución van a `../logs/` y no se documentan.