-- Esquema del piloto para los experimentos 4 y 5 (Function + egress, trigger
-- programado). Se aplica con psql sobre la rama de piloto; después de cada DDL
-- HAY que refrescar la caché de la Data API:
--   neon data-api refresh-schema --project-id <id> --branch <rama>
-- (hallazgo de la Etapa A: sin eso la Data API sigue serviendo el diccionario
--  viejo y los embeds dan PGRST200 aunque la vista ya esté bien.)

-- ── 4. tabla que escribe la Function: la tasa que se raspa del BCV ───────
-- Es la misma forma que tasas_cambio en el proyecto viejo (fecha + tasa),
-- para que la Fase 4 pueda copiar el histórico encima sin remodelar.
drop table if exists tasas_cambio;
create table tasas_cambio (
  fecha           date primary key,
  tasa_bcv        numeric(12,6) not null,
  fuente          text not null default 'bcv.oficial',
  actualizada_en  timestamptz not null default now()
);

-- ── 5. bitácora de invocaciones: prueba el idempotencia at-least-once ───
-- La PK es el invocation_id que Neon manda en la cabecera
-- x-neon-trigger-invocation-id. Un disparo nuevo inserta; una re-entrega del
-- MISMO invocation_id no duplica la fila, solo suma `reentregas`. Así la
-- garantía at-least-once queda observable en la propia tabla.
drop table if exists piloto_invocaciones;
create table piloto_invocaciones (
  invocation_id  text primary key,
  trigger_id     text,
  trigger_name   text,
  scheduled_at   timestamptz,
  resultado      text,
  reentregas     integer not null default 0,
  recibida_en    timestamptz not null default now()
);

-- ── 4/5. bitácora de egreso: qué se alcanzó, cuánto tardó, qué tamaño ───
drop table if exists piloto_egreso;
create table piloto_egreso (
  id        bigserial primary key,
  destino   text not null,
  estado    smallint,
  bytes     integer,
  ms        integer,
  nota      text,
  cuando    timestamptz not null default now()
);

-- La Function entra con DATABASE_URL (neondb_owner), así que no necesita
-- grants. Los grants solo importarían si la Data API tuviera que leer esto,
-- y en el piloto se lee por la propia Function (GET /estado).
