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

-- Los roles de la Data API existen desde que Neon aprovisiona el servicio y no
-- se pueden crear ni otorgar desde aquí (piloto/RESULTADOS.md, experimento 1).
-- Solo hace falta abrir el esquema `auth`.
grant usage on schema auth to authenticated, anonymous;
grant execute on function auth.claim(text), auth.uid(), auth.role() to authenticated, anonymous;

comment on function auth.uid() is
  'Identidad del JWT en request.jwt.claims. Reemplaza a auth.uid() de Supabase.';
