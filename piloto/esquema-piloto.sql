-- Piloto de verificación, Etapa A (Fase 3 del plan).
-- No es el esquema del producto: son las FORMAS que el producto usa, para
-- medir si la Data API de Neon las sirve. Cada bloque corresponde a un
-- experimento y se ejecuta de arriba abajo.

-- ── roles ──────────────────────────────────────────────────────────────
-- La Data API de Neon casa el claim `role` del JWT con un rol de Postgres y
-- hace SET ROLE. Hallazgo del piloto: al aprovisionar la Data API, Neon YA
-- crea `authenticated` y `anonymous` y YA los otorga a `neondb_owner` y al
-- `authenticator` (los otorga cloud_admin vía neon_service). No hay que
-- crearlos ni otorgarlos — y además no se puede: neondb_owner no tiene la
-- ADMIN OPTION sobre ellos, y reintentar el grant da
-- "permission denied to grant role". Aquí solo se comprueba el cableado.
do $$
declare
  faltan text;
begin
  select string_agg(r, ', ') into faltan
    from unnest(array['authenticated','anonymous']) r
   where not exists (select 1 from pg_roles where rolname = r);

  if faltan is not null then
    raise exception 'faltan roles de la Data API: %', faltan;
  end if;

  if not exists (
    select 1 from pg_auth_members
     where roleid = 'authenticated'::regrole
       and member = to_regrole(current_user)
  ) then
    raise exception 'el rol de conexión (%) no es miembro de authenticated: la Data API dará 42501', current_user;
  end if;

  raise notice 'roles OK: authenticated y anonymous existen y % es miembro de ambos', current_user;
end $$;

-- ── tablas (formas del producto real) ──────────────────────────────────
create table if not exists proveedores (
  id     uuid primary key default gen_random_uuid(),
  nombre text not null
);

create table if not exists planes (
  id            uuid primary key default gen_random_uuid(),
  proveedor_id  uuid references proveedores(id),
  nombre        text not null,
  precio        numeric(10,2) not null,
  duracion_dias integer not null,
  publicado     boolean not null default true
);

create table if not exists pagos (
  id     uuid primary key default gen_random_uuid(),
  monto  numeric(12,2) not null,
  estado text not null default 'pendiente',
  nota   text,
  fecha  timestamptz not null default now()
);

-- ── experimento 1: RPC por HTTP ────────────────────────────────────────
-- Es la réplica de la función homónima del panel viejo: muta y devuelve
-- algo. Interesa saber si POST /rest/v1/rpc/editar_pago responde 200 y si
-- el efecto es REAL (no solo 200 con el cambio perdido).
create or replace function editar_pago(p_id uuid, p_monto numeric, p_estado text)
returns table (id uuid, monto numeric, estado text)
language plpgsql
as $$
declare
  fila record;
begin
  -- Sin esto, un anónimo que llegue hasta aquí recibiría solo "0 filas": el
  -- error sería indistinguible de un pago inexistente. La Data API ejecuta la
  -- función con el rol del JWT (security invoker), así que RLS ya corta el
  -- caso; este raise es para que el motivo sea explícito y verificable.
  if current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'anonymous' then
    raise exception 'editar_pago prohibido al anónimo' using errcode = '42501';
  end if;

  -- El RETURNING necesita destino en plpgsql: sin `into` Postgres responde
  -- 42601 "query has no destination for result data".
  update pagos
     set monto = p_monto, estado = p_estado
   where pagos.id = p_id
  returning pagos.id, pagos.monto, pagos.estado
       into fila;

  if not found then
    raise exception 'pago % inexistente', p_id;
  end if;

  return query select fila.id, fila.monto, fila.estado;
end $$;

grant execute on function editar_pago(uuid, numeric, text) to authenticated, anonymous;

-- ── experimento 2: vista + embeds ──────────────────────────────────────
-- PostgREST detecta relaciones por FKs de TABLA, pero desde v11 resuelve
-- embeds a través de vistas SI la vista es "key preserving": tiene que
-- conservar la PK de la tabla base y la columna FK con su nombre real.
-- La versión anterior renombraba p.nombre→plan y pr.id→proveedor_id, o sea
-- tiraba la FK y PostgREST no tenía por dónde casar (PGRST200). Aquí se
-- dejan id y proveedor_id intactos a propósito: es la duda del gate.
-- security_invoker para que RLS no se salte por la vista.
-- CREATE OR REPLACE VIEW no puede renombrar columnas, así que la vista se
-- tira y se rehace: el piloto se recrea entero cuando hace falta.
drop view if exists v_catalogo_publico;
create view v_catalogo_publico
with (security_invoker = true) as
select p.id, p.proveedor_id, p.nombre, p.precio, p.duracion_dias, p.publicado,
       pr.nombre as proveedor
  from planes p
  join proveedores pr on pr.id = p.proveedor_id
 where p.publicado;

-- ── RLS ────────────────────────────────────────────────────────────────
alter table pagos enable row level security;
alter table planes enable row level security;
alter table proveedores enable row level security;

-- El admin del panel viejo se decidía por auth.uid(); aquí se lee el claim
-- sub y se consulta public.usuarios en la Fase 4. En el piloto basta con
-- que authenticated pueda escribir y anonymous no.
drop policy if exists pagos_escribe_auth on pagos;
create policy pagos_escribe_auth on pagos for all to authenticated using (true) with check (true);
drop policy if exists pagos_lee_anon on pagos;
create policy pagos_lee_anon on pagos for select to anonymous using (false);

drop policy if exists planes_lee_all on planes;
create policy planes_lee_all on planes for select to anonymous, authenticated using (publicado);
drop policy if exists prov_lee_all on proveedores;
create policy prov_lee_all on proveedores for select to anonymous, authenticated using (true);

-- ── permisos de lectura para la tienda anónima ─────────────────────────
grant usage on schema public to authenticated, anonymous;
grant select on planes, proveedores, v_catalogo_publico to authenticated, anonymous;
grant select, insert, update on pagos to authenticated;

-- ── datos de prueba (30 filas para que Range y count se noten) ──────────
-- Con guardas: sin restricción única, volver a correr el script duplicaba
-- las 30 filas y el count dejaba de significar nada.
insert into proveedores (nombre)
select 'Proveedor ' || g from generate_series(1, 3) g
where not exists (select 1 from proveedores)
on conflict do nothing;

insert into planes (proveedor_id, nombre, precio, duracion_dias, publicado)
select pr.id,
       'Plan ' || g,
       (10 + g)::numeric(10,2),
       case when g % 4 = 0 then 365 else 30 end,
       g % 7 <> 0                      -- alguna sin publicar, para probar el filtro
  from generate_series(1, 30) g
  cross join lateral (
    select id from proveedores order by nombre limit 1 offset (g % 3)
  ) pr
 where not exists (select 1 from planes)
on conflict do nothing;

insert into pagos (monto, estado)
select (g * 3.5)::numeric(12,2), 'pendiente' from generate_series(1, 5) g
 where not exists (select 1 from pagos)
on conflict do nothing;

-- Para que la Data API no sirva el diccionario viejo tras el DDL.
notify pgrst, 'reload schema';
