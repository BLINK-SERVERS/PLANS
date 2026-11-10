-- ============================================================
--  db/0003_better_auth.sql — las tablas de Better Auth, en public
-- ============================================================
--  En lugar de correr `npx @better-auth/cli migrate` contra producción se
--  versiona el DDL. Motivos, todos medidos en el piloto:
--    · el CLI abre su propia conexión y necesita la cadena SIN pooler
--      (DATABASE_URL_UNPOOLED); el pooled rechaza el search_path del paquete
--      de arranque, y dejar que el CLI decida eso en un despliegue real es
--      un fallo difícil de ver.
--    · `migrate` es idempotente a medias: si la tabla existe pero le falta
--      una columna, el resultado depende de la versión instalada.
--    · así el diff de esquema cabe en un commit revisable.
--
--  Los nombres de columna son camelCase y van entre comillas porque así los
--  creó el CLI del piloto y así los consulta el runtime: Better Auth arma
--  identificadores sin cualificar y depende del search_path. Renombrarlos o
--  ponerlos en snake_case rompe el login en silencio.
--
--  Claves:
--    · `user.id` es TEXT. Es el detalle que resuelve la Fase 4: los clientes
--      importados conservan su UUID de siempre escrito como texto, y
--      public.usuarios.id (uuid) acepta el mismo valor porque
--      advanced.database.generateId fuerza randomUUID() en las cuentas
--      nuevas (experimento 6 del gate).
--    · No hay FK entre `user` y `usuarios`: una FK uuid→text exigiría un cast
--      dentro de la restricción y Postgres no lo permite. La integridad la
--      sostiene el hook `databaseHooks.user.create.after` de
--      functions/auth/index.mjs y se comprueba con la consulta del final.

-- ------------------------------------------------------------
-- 1) Las cuatro tablas que gestiona Better Auth
-- ------------------------------------------------------------
create table if not exists public.user (
  id              text primary key,
  name            text not null,
  email           text not null unique,
  "emailVerified" boolean not null default false,
  image           text,
  "createdAt"     timestamptz not null default now(),
  "updatedAt"     timestamptz not null default now()
);

create table if not exists public.account (
  id            text primary key,
  "accountId"   text not null,
  "providerId"  text not null,
  "userId"      text not null references public.user(id) on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken"     text,
  "accessTokenExpiresAt"  timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope         text,
  password      text,
  "passwordCreatedAt"     timestamptz,
  "createdAt"   timestamptz not null default now(),
  "updatedAt"   timestamptz not null default now()
);

-- El login de credenciales busca por providerId='credential'. En la
-- importación masiva accountId = user.id (hallazgo del experimento 7: sin
-- esa igualdad el signIn responde USER_NOT_FOUND aunque el hash esté bien).
create index if not exists account_provider_user_idx
  on public.account ("providerId", "userId");

create table if not exists public.session (
  id         text primary key,
  "expiresAt" timestamptz not null,
  token      text not null unique,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  "ipAddress" text,
  "userAgent" text,
  "userId"   text not null references public.user(id) on delete cascade,
  "activeOrganizationId" text,
  "impersonatedBy" text
);

create index if not exists session_user_idx on public.session ("userId");

create table if not exists public.verification (
  id         text primary key,
  identifier text not null,
  value      text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists verification_identifier_idx
  on public.verification (identifier);

-- ------------------------------------------------------------
-- 2) Nadie de la app toca estas tablas por la API de datos
-- ------------------------------------------------------------
-- `datos` ya no las expondría (la lista blanca de recursos se arma con la
-- validación de identifiers y el front nunca las nombra), pero el retiro
-- explícito es la diferencia entre "no las usa" y "no puede": un hash de
-- contraseña que se filtra por un SQL mal escrito por nosotros sigue siendo
-- un hash de contraseña. El acceso queda solo en neondb_owner, que es con
-- quien se conectan las Functions.
revoke all on public.user, public.account, public.session, public.verification
  from public, anonymous, authenticated;

-- ------------------------------------------------------------
-- 3) El inventario de lo que se pierde al no usar Neon Managed Auth
-- ------------------------------------------------------------
-- Managed Auth (auth: true) tendría además organization, member, invitation
-- y jwks. No las creamos: Plans no tiene organizaciones, y el JWKS no sirve
-- para nada porque no hay Data API que lo consulte (gate, Fase 3).

-- ------------------------------------------------------------
-- 4) Invariante usuario ↔ fila de negocio
-- ------------------------------------------------------------
-- Debe dar 0 filas en ambos sentidos:
--   select u.id from public.user u left join public.usuarios s on s.id::text = u.id
--    where s.id is null
--   union all
--   select s.id::text from public.usuarios s left join public.user u on u.id = s.id::text
--    where u.id is null and s.rol <> 'agente';
-- La última condición existe: los agentes del seed viejo tienen fila de
-- negocio sin cuenta de login propia en el panel antiguo, así que esa
-- directionalidad es esperada hasta que se les invite.
