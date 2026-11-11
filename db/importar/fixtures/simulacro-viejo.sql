-- ============================================================
--  db/importar/fixtures/simulacro-viejo.sql
--  Fuente SINTÉTICA con la forma exacta del proyecto viejo.
-- ============================================================
--  No hay ni un dato de cliente real aquí: son UUIDs inventados y tres
--  bcrypt que se generaron para este archivo sobre la clave `ClaveReal123`
--  (verificado con bcryptjs al escribirlo). Sirve para medir el importador
--  de punta a punta sin tocar la base de producción, que es lo único que se
--  puede hacer mientras no existan credenciales del Supabase viejo.
--
--  Simula DOS cosas que el esquema nuevo no tiene:
--    · el esquema `auth` de GoTrue (auth.users / auth.identities), de donde
--      sale el hash bcrypt, y
--    · 6 disparadores de negocio sobre las tablas de public.
--
--  Se aplica sobre una base vacía:
--     psql "$VIEJO" -v ON_ERROR_STOP=1 -f db/0000_auth_uid.sql \
--                   -f db/0001_esquema_negocio.sql \
--                   -f db/importar/fixtures/simulacro-viejo.sql
--
--  Los casos que cubre cada usuario, por si hace falta volver a añadir uno:
--    1111  bcrypt $2a$, confirmado, con fila en usuarios        → el caso normal
--    2222  email MIX case (María@...)                           → el importador
--                                                                 tiene que bajarlo
--    3333  encrypted_password NULL, el hash vive en identity_data → ruta de respaldo
--    4444  el hash vive en credentials                            → segunda ruta de respaldo
--    5555  sin hash en ningún lado (alta por enlace/OAuth)        → se informa, no se inventa
--    6666  usuario de auth SIN fila en public.usuarios            → hay que crearla
--    7777  cliente más, con el mismo bcrypt que 1111              → dos cuentas, un hash
--    (1111 va referida por 4444 y pagó: la cadena que el disparador de
--     comisiones del destino vuelve a ejecutar si se le deja)
--    aaaa  is_sso_user = true, correo `...@builtin-email.fake`    → se descarta
-- ============================================================

-- ------------------------------------------------------------
-- 1) auth.users / auth.identities, recortados a lo que lee el importador.
--    En Supabase son tablas de un esquema gestionado con muchas más columnas;
--    aquí solo interesan las que se nombran abajo. `is_sso_user` existe desde
--    GoTrue v2.64 y el importador la probea en information_schema antes de
--    usarla, por eso se incluye: hay que probar la rama que la encuentra.
-- ------------------------------------------------------------
create schema if not exists auth;

create table if not exists auth.users (
    id                 uuid primary key,
    email              text unique,
    encrypted_password text,
    email_confirmed_at timestamptz,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    is_sso_user        boolean not null default false,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

create table if not exists auth.identities (
    id            text primary key,
    user_id       uuid not null references auth.users(id) on delete cascade,
    provider_id   text not null,
    identity_data jsonb not null default '{}'::jsonb,
    credentials   jsonb,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2) Los disparadores de negocio se tiran abajo AQUÍ, en la fuente.
--    Motivo: hay que sembrar `cupos_ocupados` y la fila de `comisiones` con
--    el valor histórico real, y los disparadores lo recalcularían al insertar.
--    No distorsiona la prueba: lo que se vuelca son los DATOS de la fuente, y
--    los disparadores que importan son los del destino, que siguen vivos.
-- ------------------------------------------------------------
drop trigger if exists trg_cupos_after_insert        on public.suscripciones;
drop trigger if exists trg_cupos_after_update        on public.suscripciones;
drop trigger if exists trg_cupos_after_delete        on public.suscripciones;
drop trigger if exists trg_validar_plataforma_susc   on public.suscripciones;
drop trigger if exists trg_comision_referido         on public.pago_suscripciones;
drop trigger if exists trg_renovar_susc_por_pago     on public.pago_suscripciones;

-- ------------------------------------------------------------
-- 3) Catálogo y cuentas madre.
-- ------------------------------------------------------------
insert into public.plataformas (id, nombre, activa, aplica_comision) values
  ('cccc0000-0000-4000-8000-000000000001', 'Netflix', true, true);

insert into public.planes (id, plataforma_id, duracion_dias, precio_venta_usd) values
  ('cccc0000-0000-4000-8000-000000000010', 'cccc0000-0000-4000-8000-000000000001', 30, 5.00);

insert into public.proveedores (id, nombre) values
  ('cccc0000-0000-4000-8000-000000000020', 'BLINK');

-- 3 cupos, 2 ocupados: así la restauración que dispara el trigger choca con
-- el CHECK (cupos_ocupados <= cupos_totales) en cuanto suma el tercero.
insert into public.cuentas_madre
       (id, proveedor_id, plataforma_id, correo_cuenta, cupos_totales,
        cupos_ocupados, costo_renovacion_usd, estado) values
  ('cccc0000-0000-4000-8000-000000000030', 'cccc0000-0000-4000-8000-000000000020',
   'cccc0000-0000-4000-8000-000000000001', 'madre@blink.com.ve', 3, 2, 3.50, 'activa');

insert into public.tasas_cambio (fecha, tasa_bcv, tasa_eur_bs) values
  ('2026-11-08', 890.1234, 1000.5000),
  ('2026-11-09', 899.2705, 1006.6074);

-- ------------------------------------------------------------
-- 4) Usuarios de auth con su hash bcrypt.
-- ------------------------------------------------------------
insert into auth.users
       (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at) values
  ('11111111-1111-4111-8111-111111111111', 'carlos@blink.com.ve',
   '$2a$10$QayOpBBXLKfJlCUhUK6M4ePnA1k2LQeerdh64VvBawfkiUIGpv7xi',
   '2026-01-05 10:00:00+00', '{"nombre":"Carlos Rondón","telefono":"+584140000001"}',
   '2026-01-05 10:00:00+00'),
  ('22222222-2222-4222-8222-222222222222', 'Maria@Blink.com.ve',
   '$2b$10$whwl5X1s10/5uxEAg5pJielVpfLSXYMluJtiTK5ZFonuJiHLAV2KW',
   '2026-02-06 10:00:00+00', '{"nombre":"María Pérez"}', '2026-02-06 10:00:00+00'),
  ('33333333-3333-4333-8333-333333333333', 'julio@blink.com.ve', null,
   '2026-03-07 10:00:00+00', '{"nombre":"Julio Díaz"}', '2026-03-07 10:00:00+00'),
  ('44444444-4444-4444-8444-444444444444', 'kevin@blink.com.ve', null,
   '2026-04-08 10:00:00+00', '{"nombre":"Kevin Rojas"}', '2026-04-08 10:00:00+00'),
  ('55555555-5555-4555-8555-555555555555', 'sinclave@blink.com.ve', null,
   '2026-05-09 10:00:00+00', '{"nombre":"Sin Clave"}', '2026-05-09 10:00:00+00'),
  ('66666666-6666-4666-8666-666666666666', 'ana@blink.com.ve',
   '$2y$10$9dkv9ugX/VJ9w2JGbsMZDerk8ODN2J78AoiJyCPQ9eZsnKA2QBYk6',
   '2026-06-10 10:00:00+00', '{"nombre":"Ana Agente"}', '2026-06-10 10:00:00+00'),
  ('77777777-7777-4777-8777-777777777777', 'luis@blink.com.ve',
   '$2a$10$QayOpBBXLKfJlCUhUK6M4ePnA1k2LQeerdh64VvBawfkiUIGpv7xi',
   '2026-07-11 10:00:00+00', '{"nombre":"Luis Referido"}', '2026-07-11 10:00:00+00'),
  -- Usuario de solo-SSO de Supabase: correo inventado, jamás entra con clave.
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '7f3c9a2e-1b2c-4d3e-8f90-abcdef123456@builtin-email.fake', null, null, '{}',
   '2026-08-12 10:00:00+00');

update auth.users set is_sso_user = true
 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

-- 3333: el hash solo vive en identity_data. 4444: solo en credentials.
-- Supabase escribe en los dos, pero no se puede asumir: por eso el
-- importador mira ambos antes de dar un usuario por sin-clave.
insert into auth.identities (id, user_id, provider_id, identity_data, credentials) values
  ('id-3333', '33333333-3333-4333-8333-333333333333', 'password',
   '{"sub":"33333333-3333-4333-8333-333333333333","email":"julio@blink.com.ve","email_verified":true,"password_hash":"$2b$10$whwl5X1s10/5uxEAg5pJielVpfLSXYMluJtiTK5ZFonuJiHLAV2KW"}',
   null),
  ('id-4444', '44444444-4444-4444-8444-444444444444', 'password',
   '{"sub":"44444444-4444-4444-8444-444444444444","email":"kevin@blink.com.ve","email_verified":true}',
   '{"password_hash":"$2y$10$9dkv9ugX/VJ9w2JGbsMZDerk8ODN2J78AoiJyCPQ9eZsnKA2QBYk6"}'),
  ('id-5555', '55555555-5555-4555-8555-555555555555', 'email',
   '{"sub":"55555555-5555-4555-8555-555555555555","email":"sinclave@blink.com.ve","email_verified":true}',
   null);

-- ------------------------------------------------------------
-- 5) public.usuarios: los de arriba, menos 6666 (que se la tiene que inventar
--    el importador) y con Ana marcada como agente.
-- ------------------------------------------------------------
insert into public.usuarios (id, rol, nombre, email, telefono, referido_por, created_at) values
  -- Carlos es referido de Kevin (agente): con el pago de abajo, el disparador
  -- del destino vuelve a generar la comisión que ya viene en el volcado. Ese
  -- duplicado ES la medición, no un error del fixture.
  ('11111111-1111-4111-8111-111111111111', 'cliente', 'Carlos Rondón', 'carlos@blink.com.ve',
   '+584140000001', '44444444-4444-4444-8444-444444444444', '2026-01-05 10:00:00+00'),
  ('22222222-2222-4222-8222-222222222222', 'cliente', 'María Pérez', 'Maria@Blink.com.ve',
   null, null, '2026-02-06 10:00:00+00'),
  ('33333333-3333-4333-8333-333333333333', 'cliente', 'Julio Díaz', 'julio@blink.com.ve',
   null, null, '2026-03-07 10:00:00+00'),
  ('44444444-4444-4444-8444-444444444444', 'agente', 'Kevin Rojas', 'kevin@blink.com.ve',
   null, null, '2026-04-08 10:00:00+00'),
  ('55555555-5555-4555-8555-555555555555', 'cliente', 'Sin Clave', 'sinclave@blink.com.ve',
   null, null, '2026-05-09 10:00:00+00'),
  ('77777777-7777-4777-8777-777777777777', 'cliente', 'Luis Referido', 'luis@blink.com.ve',
   null, null, '2026-07-11 10:00:00+00');

-- ------------------------------------------------------------
-- 6) Negocio: dos suscripciones activas + una vencida, un pago y la comisión
--    histórica del 30 % que en su día generó el disparador.
-- ------------------------------------------------------------
insert into public.suscripciones
       (id, cliente_id, plan_id, cuenta_madre_id, fecha_inicio, fecha_corte_cliente, estado, created_at) values
  ('dddd0000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'cccc0000-0000-4000-8000-000000000010', 'cccc0000-0000-4000-8000-000000000030',
   '2026-10-05', '2026-11-04', 'activa', '2026-10-05 10:00:00+00'),
  ('dddd0000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222',
   'cccc0000-0000-4000-8000-000000000010', 'cccc0000-0000-4000-8000-000000000030',
   '2026-10-20', '2026-11-19', 'activa', '2026-10-20 10:00:00+00'),
  ('dddd0000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333',
   'cccc0000-0000-4000-8000-000000000010', 'cccc0000-0000-4000-8000-000000000030',
   '2026-07-01', '2026-07-31', 'vencida', '2026-07-01 10:00:00+00');

insert into public.pagos_ingresos
       (id, cliente_id, monto_pagado, moneda, tasa_bcv_aplicada, equivalente_usd,
        metodo_pago, fecha_pago, created_at) values
  ('eeee0000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   4451.36, 'BS', 890.2720, 5.00, 'Pago Movil', '2026-10-25', '2026-10-25 10:00:00+00');

insert into public.pago_suscripciones
       (id, pago_ingreso_id, suscripcion_id, monto_asignado_usd, created_at) values
  ('ffff0000-0000-4000-8000-000000000001', 'eeee0000-0000-4000-8000-000000000001',
   'dddd0000-0000-4000-8000-000000000001', 5.00, '2026-10-25 10:00:00+00');

insert into public.comisiones
       (id, agente_id, pago_id, monto_comision_usd, estado, created_at) values
  ('99990000-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444',
   'eeee0000-0000-4000-8000-000000000001', 1.50, 'pendiente', '2026-10-25 10:00:00+00');
