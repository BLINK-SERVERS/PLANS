-- ── auth.uid() en Neon ─────────────────────────────────────────────────
-- El panel viejo escribía políticas del estilo `using (id = auth.uid())`
-- contra GoTrue, que pone el claim `sub` del JWT en la variable de
-- transacción `request.jwt.claims`. En Neon no existe el esquema `auth` de
-- Supabase, pero el mecanismo es el mismo: quien atiende la petición (la
-- Data API vía pg_session_jwt, o la Function `datos` con SET LOCAL) deja el
-- JWT en esa variable y desde ahí se lee.
--
-- Por eso la función se llama igual y vive en el mismo sitio: las 6 políticas
-- y las 2 funciones del esquema viejo se puertan sin tocar una coma.
create schema if not exists auth;

-- Los dos roles con los que la Function `datos` hace `SET ROLE`. Nadie los
-- creaba: en la rama del piloto ya existían porque Neon los trae al
-- aprovisionar la Data API, y la producción ya no usa Data API (ADR-002).
-- Medido en db/importar/ (simulacro sobre una base recién creada): una base
-- nueva de Neon no trae NINGUNO, y el montaje se caía en el primer `grant`.
--
-- También se otorgan al dueño de la base — el rol con el que conectan las
-- Functions. Sin membresía, `set local role authenticated` responde 42501 y
-- toda la capa de datos se cae; con ella, RLS decide y el dueño no se salta
-- nada porque el `SET ROLE` siempre ocurre antes de consultar.
--
-- Pero **membresía no es lo mismo que poder hacer SET ROLE**, y esto se midió
-- del peor modo: la rama de producción quedó con toda la capa de datos caída
-- (42501 `permission denied to set role "anonymous"`) teniendo la guarda de
-- arriba satisfecha. Desde PostgreSQL 16 la fila de `pg_auth_members` trae
-- opciones propias (`inherit_option`, `set_option`), y Neon otorga estos dos
-- roles al dueño con `admin_option = true` pero `set_option = false`. La
-- guarda antigua veía la membresía y saltaba el `grant`, dejando un `SET ROLE`
-- prohibido. En la rama del piloto no se notaba porque allí el `grant` del
-- piloto había añadido una segunda fila con `set_option = true`.
-- Se comprueba `set_option`, no la existencia.
do $$
declare
    r text;
begin
    foreach r in array array['authenticated', 'anonymous'] loop
        if not exists (select 1 from pg_roles where rolname = r) then
            execute format('create role %I nologin', r);
        end if;
        if not exists (
            select 1 from pg_auth_members m
              join pg_roles mem on mem.oid = m.member
             where m.roleid = (select oid from pg_roles where rolname = r)
               and mem.rolname = current_user
               and m.set_option
        ) then
            execute format('grant %I to %I', r, current_user);
        end if;
    end loop;
end
$$;

-- Devuelve un claim como texto, o NULL si no hay JWT (petición anónima).
-- `nullif(...,'')` importa: current_setting('request.jwt.claims', true)
-- responde la cadena vacía cuando la variable no está puesta, y
-- ''::jsonb lanza 22P02 en vez de dar NULL.
create or replace function auth.claim(p_claim text)
returns text
language sql stable
as $$
    select nullif(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> p_claim,
        ''
    );
$$;

-- Identidad del usuario. Better Auth guarda `user.id` como TEXT, pero el
-- proyecto viejo ya tiene UUIDs y todas las FK de negocio son uuid: el
-- `::uuid` del final es lo que permite conservar los ids sin remapear.
-- Si un id no fuera uuid válido, esto da 22P02 (error duro), que es el
-- comportamiento deseable: mejor una petición que falla que un id cruzado
-- que convierte a un cliente en admin.
create or replace function auth.uid()
returns uuid
language sql stable
as $$
    select auth.claim('sub')::uuid
$$;

-- Rol del JWT: 'authenticated' | 'anonymous' | NULL. Es el claim que la Data
-- API de Neon usa para el SET ROLE; lo duplicamos aquí para que las funciones
-- de negocio puedan decidir sin depender de current_user.
create or replace function auth.role()
returns text
language sql stable
as $$
    select coalesce(auth.claim('role'), 'anonymous')
$$;

-- Los roles ya estaban creados arriba (bloque DO), así que aquí solo se abre
-- el esquema `auth` y se publican las tres funciones.
grant usage on schema auth to authenticated, anonymous;
grant execute on function auth.claim(text), auth.uid(), auth.role() to authenticated, anonymous;

comment on function auth.uid() is
  'Identidad del JWT en request.jwt.claims. Reemplaza a auth.uid() de Supabase.';
