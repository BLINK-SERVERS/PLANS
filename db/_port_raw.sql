-- ┌─ puerto de 0001_initial_schema.sql ──────────────────────────────
-- ============================================================
--  Sistema Integral de Gestión de Suscripciones — ESQUEMA INICIAL
--  Proyecto: go-plans/suscripciones (Supabase xbmewcmpfnligeodggop)
--  Basado en: prd_sistema_de_suscripciones.md
--  Ejecutar en: Supabase Dashboard -> SQL Editor (o supabase db push)
-- ============================================================

create extension if not exists "pgcrypto";

-- ============================================================
--  1. CATÁLOGO E INVENTARIO (PROVEEDORES)
-- ============================================================

create table public.plataformas (
    id           uuid primary key default gen_random_uuid(),
    nombre       text not null unique,
    logo_url     text,
    activa       boolean not null default true,
    created_at   timestamptz not null default now()
);

create table public.planes (
    id                uuid primary key default gen_random_uuid(),
    plataforma_id     uuid not null references public.plataformas(id) on delete cascade,
    duracion_dias     integer not null check (duracion_dias > 0),
    precio_venta_usd  numeric(12,2) not null check (precio_venta_usd >= 0),
    created_at        timestamptz not null default now(),
    unique (plataforma_id, duracion_dias)
);

create table public.proveedores (
    id                     uuid primary key default gen_random_uuid(),
    nombre                 text not null,
    contacto               text,
    metodo_pago_preferido  text,
    created_at             timestamptz not null default now()
);

create table public.cuentas_madre (
    id                     uuid primary key default gen_random_uuid(),
    proveedor_id           uuid not null references public.proveedores(id) on delete restrict,
    plataforma_id          uuid not null references public.plataformas(id) on delete restrict,
    correo_cuenta          text not null,
    cupos_totales          integer not null check (cupos_totales > 0),
    cupos_ocupados         integer not null default 0
        check (cupos_ocupados >= 0 and cupos_ocupados <= cupos_totales),
    costo_renovacion_usd   numeric(12,2) not null check (costo_renovacion_usd >= 0),
    fecha_corte_proveedor  date not null,
    estado                 text not null default 'activa'
        check (estado in ('activa','suspendida','baja')),
    created_at             timestamptz not null default now()
);

-- ============================================================
--  2. USUARIOS, SUSCRIPCIONES Y REFERIDOS
--  Convención: usuarios.id = auth.uid() cuando el usuario tiene
--  cuenta de autenticación en Supabase Auth.
-- ============================================================

create table public.usuarios (
    id            uuid primary key default gen_random_uuid(),
    rol           text not null default 'cliente'
        check (rol in ('admin','agente','cliente')),
    nombre        text not null,
    email         text unique,
    telefono      text,
    referido_por  uuid references public.usuarios(id) on delete set null,
    created_at    timestamptz not null default now()
);

create table public.suscripciones (
    id                     uuid primary key default gen_random_uuid(),
    cliente_id             uuid not null references public.usuarios(id) on delete cascade,
    plan_id                uuid not null references public.planes(id) on delete restrict,
    cuenta_madre_id        uuid not null references public.cuentas_madre(id) on delete restrict,
    fecha_inicio           date not null,
    fecha_corte_cliente    date not null,
    estado                 text not null default 'activa'
        check (estado in ('activa','vencida','cancelada')),
    created_at             timestamptz not null default now(),
    check (fecha_corte_cliente >= fecha_inicio)
);

-- ============================================================
--  3. FINANZAS Y CONTROL CAMBIARIO
-- ============================================================

create table public.tasas_cambio (
    id        uuid primary key default gen_random_uuid(),
    fecha     date not null unique,
    tasa_bcv  numeric(12,4) not null check (tasa_bcv > 0),
    created_at timestamptz not null default now()
);

create table public.pagos_ingresos (
    id                  uuid primary key default gen_random_uuid(),
    cliente_id          uuid not null references public.usuarios(id) on delete cascade,
    monto_pagado        numeric(12,2) not null check (monto_pagado >= 0),
    moneda              text not null check (moneda in ('USD','BS','USDT')),
    tasa_bcv_aplicada   numeric(12,4),
    equivalente_usd     numeric(12,2) not null check (equivalente_usd >= 0),
    metodo_pago         text check (metodo_pago in ('Zelle','Pago Movil','Pago Movil Binance','Efectivo','Transferencia','Otro')),
    fecha_pago          date not null default current_date,
    comprobante_url     text,
    created_at          timestamptz not null default now()
);

create table public.comisiones (
    id                    uuid primary key default gen_random_uuid(),
    agente_id             uuid not null references public.usuarios(id) on delete cascade,
    pago_id               uuid not null references public.pagos_ingresos(id) on delete cascade,
    monto_comision_usd    numeric(12,2) not null check (monto_comision_usd >= 0),
    estado                text not null default 'pendiente'
        check (estado in ('pendiente','liquidada')),
    created_at            timestamptz not null default now()
);

create table public.pago_suscripciones (
    id                   uuid primary key default gen_random_uuid(),
    pago_ingreso_id      uuid not null references public.pagos_ingresos(id) on delete cascade,
    suscripcion_id       uuid not null references public.suscripciones(id) on delete restrict,
    monto_asignado_usd   numeric(12,2) not null check (monto_asignado_usd >= 0),
    created_at           timestamptz not null default now(),
    unique (pago_ingreso_id, suscripcion_id)
);

create table public.pagos_egresos (
    id                  uuid primary key default gen_random_uuid(),
    proveedor_id        uuid not null references public.proveedores(id) on delete restrict,
    cuenta_madre_id     uuid not null references public.cuentas_madre(id) on delete restrict,
    monto_pagado_usd    numeric(12,2) not null check (monto_pagado_usd >= 0),
    fecha_pago          date not null default current_date,
    comprobante_url     text,
    created_at          timestamptz not null default now()
);

-- ============================================================
--  ÍNDICES (performance en FKs y búsquedas frecuentes)
-- ============================================================

create index idx_planes_plataforma    on public.planes(plataforma_id);
create index idx_cuentas_proveedor    on public.cuentas_madre(proveedor_id);
create index idx_cuentas_plataforma   on public.cuentas_madre(plataforma_id);
create index idx_susc_cliente         on public.suscripciones(cliente_id);
create index idx_susc_cuenta_madre    on public.suscripciones(cuenta_madre_id);
create index idx_susc_corte           on public.suscripciones(fecha_corte_cliente);
create index idx_comisiones_agente    on public.comisiones(agente_id);
create index idx_pagos_ing_cliente    on public.pagos_ingresos(cliente_id);
create index idx_pagos_egr_prov       on public.pagos_egresos(proveedor_id);
create index idx_ps_pago              on public.pago_suscripciones(pago_ingreso_id);
create index idx_ps_susc              on public.pago_suscripciones(suscripcion_id);

-- ============================================================
--  VISTA: catálogo público de venta (Fase 3)
-- ============================================================

create or replace view public.v_catalogo_publico as
select pl.nombre              as plataforma,
       pl.logo_url,
       p.duracion_dias,
       p.precio_venta_usd
  from public.planes p
  join public.plataformas pl on pl.id = p.plataforma_id
 where pl.activa;

-- ============================================================
--  TRIGGERS
-- ============================================================

-- 1) Comisión 30% automática para referidos
create or replace function public.registrar_comision_por_referido()
returns trigger
language plpgsql
as $$
declare
    v_cliente  uuid;
    v_referido uuid;
begin
    select cliente_id into v_cliente
      from public.suscripciones
     where id = new.suscripcion_id;

    if v_cliente is null then
        return new;
    end if;

    select referido_por into v_referido
      from public.usuarios
     where id = v_cliente;

    if v_referido is not null then
        insert into public.comisiones (agente_id, pago_id, monto_comision_usd, estado)
        values (v_referido, new.pago_ingreso_id,
                round(new.monto_asignado_usd * 0.30, 2), 'pendiente');
    end if;

    return new;
end $$;

create trigger trg_comision_referido
    after insert on public.pago_suscripciones
    for each row execute function public.registrar_comision_por_referido();

-- 2) Control de cupos de cuentas madre
create or replace function public.gestionar_cupos_cuenta_madre()
returns trigger
language plpgsql
as $$
declare
    v_cupos  integer;
    v_total  integer;
begin
    if tg_op = 'INSERT' then
        if new.estado = 'activa' then
            select cupos_ocupados, cupos_totales into v_cupos, v_total
              from public.cuentas_madre
             where id = new.cuenta_madre_id;
            if not found then
                raise exception 'Cuenta madre % no existe', new.cuenta_madre_id;
            end if;
            if v_cupos >= v_total then
                raise exception 'Cuenta madre sin cupos disponibles (limite %)', v_total;
            end if;
            update public.cuentas_madre
               set cupos_ocupados = cupos_ocupados + 1
             where id = new.cuenta_madre_id;
        end if;

    elsif tg_op = 'UPDATE' then
        if old.estado = 'activa' and new.estado <> 'activa' then
            update public.cuentas_madre
               set cupos_ocupados = greatest(cupos_ocupados - 1, 0)
             where id = old.cuenta_madre_id;
        elsif old.estado <> 'activa' and new.estado = 'activa' then
            select cupos_ocupados, cupos_totales into v_cupos, v_total
              from public.cuentas_madre
             where id = new.cuenta_madre_id;
            if v_cupos >= v_total then
                raise exception 'Cuenta madre sin cupos disponibles (limite %)', v_total;
            end if;
            update public.cuentas_madre
               set cupos_ocupados = cupos_ocupados + 1
             where id = new.cuenta_madre_id;
        end if;

    elsif tg_op = 'DELETE' then
        if old.estado = 'activa' then
            update public.cuentas_madre
               set cupos_ocupados = greatest(cupos_ocupados - 1, 0)
             where id = old.cuenta_madre_id;
        end if;
    end if;

    return coalesce(new, old);
end $$;

create trigger trg_cupos_after_insert
    after insert on public.suscripciones
    for each row execute function public.gestionar_cupos_cuenta_madre();

create trigger trg_cupos_after_update
    after update of estado on public.suscripciones
    for each row execute function public.gestionar_cupos_cuenta_madre();

create trigger trg_cupos_after_delete
    after delete on public.suscripciones
    for each row execute function public.gestionar_cupos_cuenta_madre();

-- ============================================================
--  ROW LEVEL SECURITY (RLS)
--  Admin: acceso total. Agentes: solo sus comisiones.
--  Convención: para que un usr sea admin, su fila en `usuarios`
--  debe tener id = auth.uid() y rol = 'admin'.
-- ============================================================

create or replace function public.es_admin()
returns boolean
language sql stable
security definer
as $$
    select exists (
        select 1
          from public.usuarios u
         where u.id = auth.uid()
           and u.rol = 'admin'
    );
$$;

alter table public.plataformas          enable row level security;
alter table public.planes               enable row level security;
alter table public.proveedores          enable row level security;
alter table public.cuentas_madre        enable row level security;
alter table public.usuarios             enable row level security;
alter table public.suscripciones        enable row level security;
alter table public.comisiones           enable row level security;
alter table public.tasas_cambio         enable row level security;
alter table public.pagos_ingresos       enable row level security;
alter table public.pago_suscripciones   enable row level security;
alter table public.pagos_egresos        enable row level security;

-- Admin: acceso total a las 11 tablas de gestión
do $$
declare t text;
begin
    foreach t in array array[
        'plataformas','planes','proveedores','cuentas_madre','usuarios',
        'suscripciones','comisiones','tasas_cambio','pagos_ingresos',
        'pago_suscripciones','pagos_egresos'
    ]
    loop
        execute format(
            'create policy "admin_acceso_total" on public.%I for all
             using (public.es_admin()) with check (public.es_admin())', t);
    end loop;
end $$;

-- Agente: solo lectura de sus propias comisiones pendientes/liquidadas
create policy "agente_lee_su_comision" on public.comisiones
    for select using (agente_id = auth.uid());

-- Catálogo público de venta (consultas anónimas permitidas)
create policy "catalogo_publico_lectura" on public.plataformas
    for select using (true);

create policy "catalogo_publico_planes" on public.planes
    for select using (true);

-- ┌─ puerto de 0002_automatizaciones.sql ──────────────────────────────
-- ============================================================
--  AUTOMATIZACIONES (pg_cron + pg_net)
--  Requisitos en Supabase Dashboard -> Database -> Extensions:
--    enable pg_cron  (www/async)
--    enable pg_net   (www/async)
-- ============================================================

-- ------------------------------------------------------------
-- 1) Estados automáticos: marcar suscripciones vencidas
--    Corre todos los días a las 00:00
-- ------------------------------------------------------------
-- [NEON] se retira: cron.schedule vencimientos-diarios → ver db/README.md


-- ------------------------------------------------------------
-- 2) Alerta de proveedores en dashboard:
--    vista de conveniencia con los cortes próximos (3 días)
-- ------------------------------------------------------------
create or replace view public.v_vencimientos_proveedores as
select cm.id,
       p.nombre        as proveedor,
       pl.nombre       as plataforma,
       cm.correo_cuenta,
       cm.cupos_ocupados,
       cm.cupos_totales,
       cm.costo_renovacion_usd,
       cm.fecha_corte_proveedor,
       (cm.fecha_corte_proveedor - current_date) as dias_restantes
  from public.cuentas_madre cm
  join public.proveedores p  on p.id  = cm.proveedor_id
  join public.plataformas pl on pl.id = cm.plataforma_id
 where cm.estado = 'activa'
   and cm.fecha_corte_proveedor <= current_date + 3;

-- ------------------------------------------------------------
-- 3) Tasa BCV diaria vía Edge Function (fetch-bcv).
--    Requiere pg_net y la URL de la función + anon key (desde .env):
--      SUPABASE_URL=https://xbmewcmpfnligeodggop.supabase.co
--      SUPABASE_ANON_KEY=sb_publishable_...
--
--    Ejecutar una vez (después de desplegar la función fetch-bcv):
--    IMPORTANTE (zona horaria): pg_cron interpreta la hora en la zona de la BD
--    (Supabase usa UTC por defecto). Venezuela = UTC-4. El BCV publica la tasa
--    ~16:00 VET = 20:00 UTC. Este cron corre 2h después (22:00 UTC = 18:00 VET)
--    para capturar la tasa ya publicada del día. Si la BD estuviera en
--    America/Caracas, usar '0 18 * * *'.
--    select cron.schedule(
--      'tasas-bcv-diaria',
--      '0 22 * * *',
--      $$ select net.http_post(
--             url    := 'https://xbmewcmpfnligeodggop.supabase.co/functions/v1/fetch-bcv',
--             headers := jsonb_build_object(
--                          'Content-Type','application/json',
--                          'Authorization', 'Bearer ' || 'TU_ANON_KEY_SERVICE_ROLE'),
--             body   := '{}'
--         ) $$
--    );
-- ------------------------------------------------------------

-- ┌─ puerto de 0003_seed.sql ──────────────────────────────
-- ============================================================
--  SEED — Datos de ejemplo
--  Opcional: ejecutar solo para probar el funcionamiento.
-- ============================================================

-- Plataformas base
insert into public.plataformas (nombre, logo_url) values
    ('Netflix',  null),
    ('Spotify',  null),
    ('Disney+',  null),
    ('Canva',    null),
    ('ChatGPT',  null)
on conflict (nombre) do nothing;

-- Planes de ejemplo (precios anclados en USD)
insert into public.planes (plataforma_id, duracion_dias, precio_venta_usd)
select pl.id, valores.duracion, valores.precio
  from public.plataformas pl
 cross join (values
    ('Netflix', 30,  12.00),
    ('Spotify', 30,   4.50),
    ('Disney+', 30,   6.00),
    ('Canva',   30,   8.00),
    ('ChatGPT', 30,  10.00)
 ) valores(plataforma, duracion, precio)
 where pl.nombre = valores.plataforma
on conflict (plataforma_id, duracion_dias) do nothing;

-- Tasa BCV de ejemplo (se reemplazará con la real)
insert into public.tasas_cambio (fecha, tasa_bcv)
values (current_date, 42.5000)
on conflict (fecha) do nothing;

-- ┌─ puerto de 0004_demo.sql ──────────────────────────────
-- ============================================================
-- 0004_demo.sql — Datos de demostración para el panel (Fase 2)
-- idempotente: borra y recarga los IDs demo '00000000-...'
-- ============================================================

-- ---------- Limpieza (idempotencia, respetando dependencias) ----------
DELETE FROM pago_suscripciones
WHERE pago_ingreso_id IN ('00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000041');

DELETE FROM comisiones
WHERE pago_id IN ('00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000041');

DELETE FROM pagos_ingresos
WHERE id IN ('00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000041');

DELETE FROM suscripciones
WHERE id BETWEEN '00000000-0000-0000-0000-000000000030' AND '00000000-0000-0000-0000-000000000034';

DELETE FROM cuentas_madre
WHERE id IN ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000021');

DELETE FROM proveedores WHERE id = '00000000-0000-0000-0000-000000000010';

DELETE FROM usuarios
WHERE id BETWEEN '00000000-0000-0000-0000-000000000001' AND '00000000-0000-0000-0000-000000000005';

-- ---------- Agente y clientes ----------
INSERT INTO usuarios (id, rol, nombre, email, telefono, referido_por) VALUES
('00000000-0000-0000-0000-000000000001','agente','Ana Agente','ana@ejemplo.com','+58 412 100 0001',NULL),
('00000000-0000-0000-0000-000000000002','cliente','Carlos Cliente','carlos@ejemplo.com','+58 414 200 0002','00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000003','cliente','María López','maria@ejemplo.com','+58 416 300 0003',NULL),
('00000000-0000-0000-0000-000000000004','cliente','Pedro Gómez','pedro@ejemplo.com',NULL,'00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000005','cliente','Luisa Fernández','luisa@ejemplo.com',NULL,NULL);

-- ---------- Proveedor ----------
INSERT INTO proveedores (id, nombre, contacto, metodo_pago_preferido) VALUES
('00000000-0000-0000-0000-000000000010','Almacén VIP','@almacenvip (Telegram)','Zelle');

-- ---------- Cuentas madre (fecha corte: 2 y 10 días) ----------
INSERT INTO cuentas_madre (id, proveedor_id, plataforma_id, correo_cuenta, cupos_totales, costo_renovacion_usd, fecha_corte_proveedor)
SELECT '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', p.id, 'netflix01@pventa.com', 4, 30.00, CURRENT_DATE + 2
FROM plataformas p WHERE p.nombre = 'Netflix';

INSERT INTO cuentas_madre (id, proveedor_id, plataforma_id, correo_cuenta, cupos_totales, costo_renovacion_usd, fecha_corte_proveedor)
SELECT '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000010', p.id, 'disney01@pventa.com', 4, 25.00, CURRENT_DATE + 10
FROM plataformas p WHERE p.nombre = 'Disney+';

-- ---------- Suscripciones (el trigger gestiona cupos ocupados) ----------
-- Carlos → Netflix (activa)
INSERT INTO suscripciones (id, cliente_id, plan_id, cuenta_madre_id, fecha_inicio, fecha_corte_cliente, estado)
SELECT '00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000002', pl.id, '00000000-0000-0000-0000-000000000020', CURRENT_DATE - 25, CURRENT_DATE + 5, 'activa'
FROM planes pl JOIN plataformas pf ON pf.id = pl.plataforma_id
WHERE pf.nombre = 'Netflix' LIMIT 1;

-- María → Netflix (activa, corte en 2 días)
INSERT INTO suscripciones (id, cliente_id, plan_id, cuenta_madre_id, fecha_inicio, fecha_corte_cliente, estado)
SELECT '00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000003', pl.id, '00000000-0000-0000-0000-000000000020', CURRENT_DATE - 28, CURRENT_DATE + 2, 'activa'
FROM planes pl JOIN plataformas pf ON pf.id = pl.plataforma_id
WHERE pf.nombre = 'Netflix' LIMIT 1;

-- Luisa → Netflix (activa, corte en 20 días)
INSERT INTO suscripciones (id, cliente_id, plan_id, cuenta_madre_id, fecha_inicio, fecha_corte_cliente, estado)
SELECT '00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000005', pl.id, '00000000-0000-0000-0000-000000000020', CURRENT_DATE - 10, CURRENT_DATE + 20, 'activa'
FROM planes pl JOIN plataformas pf ON pf.id = pl.plataforma_id
WHERE pf.nombre = 'Netflix' LIMIT 1;

-- Carlos → Disney+ (VENCIDA, corte hace 2 días → KPI vencidas > 0)
INSERT INTO suscripciones (id, cliente_id, plan_id, cuenta_madre_id, fecha_inicio, fecha_corte_cliente, estado)
SELECT '00000000-0000-0000-0000-000000000033','00000000-0000-0000-0000-000000000002', pl.id, '00000000-0000-0000-0000-000000000021', CURRENT_DATE - 30, CURRENT_DATE - 2, 'vencida'
FROM planes pl JOIN plataformas pf ON pf.id = pl.plataforma_id
WHERE pf.nombre = 'Disney+' LIMIT 1;

-- Pedro → Disney+ (activa, corte en 15 días)
INSERT INTO suscripciones (id, cliente_id, plan_id, cuenta_madre_id, fecha_inicio, fecha_corte_cliente, estado)
SELECT '00000000-0000-0000-0000-000000000034','00000000-0000-0000-0000-000000000004', pl.id, '00000000-0000-0000-0000-000000000021', CURRENT_DATE - 15, CURRENT_DATE + 15, 'activa'
FROM planes pl JOIN plataformas pf ON pf.id = pl.plataforma_id
WHERE pf.nombre = 'Disney+' LIMIT 1;

-- ---------- Pagos + distribución (dispara comisión 30% del referido) ----------
-- Pago 1: María paga en BS (510 BS ÷ 42.5 = 12.00 USD) — sin referido, sin comisión
INSERT INTO pagos_ingresos (id, cliente_id, monto_pagado, moneda, tasa_bcv_aplicada, equivalente_usd, metodo_pago, fecha_pago) VALUES
('00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000003', 510.00, 'BS', 42.5000, 12.00, 'Pago Movil', CURRENT_DATE);

INSERT INTO pago_suscripciones (pago_ingreso_id, suscripcion_id, monto_asignado_usd) VALUES
('00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000031', 12.00);

-- Pago 2: Carlos paga 12.00 USDT → comisión 30% = 3.60 pendiente para Ana
INSERT INTO pagos_ingresos (id, cliente_id, monto_pagado, moneda, tasa_bcv_aplicada, equivalente_usd, metodo_pago, fecha_pago) VALUES
('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000002', 12.00, 'USDT', NULL, 12.00, 'Otro', CURRENT_DATE);

INSERT INTO pago_suscripciones (pago_ingreso_id, suscripcion_id, monto_asignado_usd) VALUES
('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000030', 12.00);

-- ---------- Verificación ----------
SELECT 'clientes' AS item, count(*) AS total FROM usuarios WHERE rol = 'cliente'
UNION ALL SELECT 'suscripciones activas', count(*) FROM suscripciones WHERE estado = 'activa'
UNION ALL SELECT 'suscripciones vencidas', count(*) FROM suscripciones WHERE estado = 'vencida'
UNION ALL SELECT 'comisiones pendientes', count(*) FROM comisiones WHERE estado = 'pendiente'
UNION ALL SELECT 'ingresos USD del mes', COALESCE(round(sum(equivalente_usd),2),0) FROM pagos_ingresos
WHERE fecha_pago >= date_trunc('month', CURRENT_DATE);

-- ┌─ puerto de 0005_sistema_gestion.sql ──────────────────────────────
-- ============================================================
-- 0005_sistema_gestion.sql — Gestión pulida (Fase 2.1)
--  • Cascadas FK para poder borrar clientes/suscripciones sin errores
--  • Plataformas: columna aplica_comision (comisiones solo en Google One o las que elijas)
--  • Cuentas madre: proveedor opcional (Directo) y corte/costo opcional (cuentas eternas tipo Canva docente)
--  • Pagos: tasa de cambio Binance (USDT)
--  • Datos demo de comisión movidos a Google One
-- ============================================================

-- ---------- 1) FK CASCADA para gestión ----------
ALTER TABLE public.pago_suscripciones DROP CONSTRAINT pago_suscripciones_suscripcion_id_fkey;
ALTER TABLE public.pago_suscripciones ADD CONSTRAINT pago_suscripciones_suscripcion_id_fkey
  FOREIGN KEY (suscripcion_id) REFERENCES public.suscripciones(id) ON DELETE CASCADE;

ALTER TABLE public.pago_suscripciones DROP CONSTRAINT pago_suscripciones_pago_ingreso_id_fkey;
ALTER TABLE public.pago_suscripciones ADD CONSTRAINT pago_suscripciones_pago_ingreso_id_fkey
  FOREIGN KEY (pago_ingreso_id) REFERENCES public.pagos_ingresos(id) ON DELETE CASCADE;

-- Borrar una cuenta madre limpia sus suscripciones e historial
ALTER TABLE public.suscripciones DROP CONSTRAINT suscripciones_cuenta_madre_id_fkey;
ALTER TABLE public.suscripciones ADD CONSTRAINT suscripciones_cuenta_madre_id_fkey
  FOREIGN KEY (cuenta_madre_id) REFERENCES public.cuentas_madre(id) ON DELETE CASCADE;

-- Borrar un proveedor: las cuentas pasan a 'Directo' y se borran sus egresos
ALTER TABLE public.cuentas_madre DROP CONSTRAINT cuentas_madre_proveedor_id_fkey;
ALTER TABLE public.cuentas_madre ADD CONSTRAINT cuentas_madre_proveedor_id_fkey
  FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id) ON DELETE SET NULL;

ALTER TABLE public.pagos_egresos DROP CONSTRAINT pagos_egresos_proveedor_id_fkey;
ALTER TABLE public.pagos_egresos ADD CONSTRAINT pagos_egresos_proveedor_id_fkey
  FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id) ON DELETE CASCADE;

ALTER TABLE public.pagos_egresos DROP CONSTRAINT pagos_egresos_cuenta_madre_id_fkey;
ALTER TABLE public.pagos_egresos ADD CONSTRAINT pagos_egresos_cuenta_madre_id_fkey
  FOREIGN KEY (cuenta_madre_id) REFERENCES public.cuentas_madre(id) ON DELETE CASCADE;

-- Borrar una plataforma limpia planes, cuentas y suscripciones asociadas
ALTER TABLE public.cuentas_madre DROP CONSTRAINT cuentas_madre_plataforma_id_fkey;
ALTER TABLE public.cuentas_madre ADD CONSTRAINT cuentas_madre_plataforma_id_fkey
  FOREIGN KEY (plataforma_id) REFERENCES public.plataformas(id) ON DELETE CASCADE;

-- ---------- 2) Plataformas: comisiones configurables ----------
ALTER TABLE public.plataformas
  ADD COLUMN aplica_comision boolean not null default true;

-- Regla inicial: comisiones SOLO en Google One (luego se elige por plataforma)
UPDATE public.plataformas SET aplica_comision = (nombre = 'Google One');

INSERT INTO public.plataformas (nombre, activa, aplica_comision)
VALUES ('Google One', true, true)
ON CONFLICT (nombre) DO UPDATE SET aplica_comision = true;

-- Plan Google One 100 GB (mensual)
INSERT INTO public.planes (plataforma_id, duracion_dias, precio_venta_usd)
SELECT id, 30, 2.00 FROM public.plataformas
WHERE nombre = 'Google One'
  AND NOT EXISTS (
    SELECT 1 FROM public.planes p2 WHERE p2.plataforma_id = id AND p2.duracion_dias = 30
  );

-- ---------- 3) Limpieza: quitar comisiones de plataformas sin comisión ----------
DELETE FROM public.comisiones c
USING public.pago_suscripciones ps
JOIN public.suscripciones s   ON s.id  = ps.suscripcion_id
JOIN public.planes p          ON p.id  = s.plan_id
JOIN public.plataformas pl    ON pl.id = p.plataforma_id
WHERE c.pago_id = ps.pago_ingreso_id
  AND pl.aplica_comision = false;

-- ---------- 4) Cuentas madre: proveedor y corte opcionales ----------
ALTER TABLE public.cuentas_madre ALTER COLUMN proveedor_id DROP NOT NULL;
ALTER TABLE public.cuentas_madre ALTER COLUMN fecha_corte_proveedor DROP NOT NULL;

-- ---------- 5) Pagos: tasa de cambio Binance (USDT) ----------
ALTER TABLE public.pagos_ingresos
  ADD COLUMN tasa_cambio_binance numeric(12,4);

-- ---------- 6) Trigger de comisión: solo si la plataforma lo habilita ----------
CREATE OR REPLACE FUNCTION public.registrar_comision_por_referido()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_cliente  uuid;
    v_referido uuid;
    v_aplica   boolean;
BEGIN
    SELECT s.cliente_id, COALESCE(pl.aplica_comision, false)
      INTO v_cliente, v_aplica
      FROM public.suscripciones s
      JOIN public.planes p        ON p.id = s.plan_id
      JOIN public.plataformas pl  ON pl.id = p.plataforma_id
     WHERE s.id = new.suscripcion_id;

    IF v_cliente IS NULL OR NOT v_aplica THEN
        RETURN new;
    END IF;

    SELECT referido_por INTO v_referido
      FROM public.usuarios
     WHERE id = v_cliente;

    IF v_referido IS NOT NULL THEN
        INSERT INTO public.comisiones (agente_id, pago_id, monto_comision_usd, estado)
        VALUES (v_referido, new.pago_ingreso_id,
                round(new.monto_asignado_usd * 0.30, 2), 'pendiente');
    END IF;

    RETURN new;
END $$;

-- ---------- 7) Vista de vencimientos: proveedor opcional + cuentas sin corte ----------
CREATE OR REPLACE VIEW public.v_vencimientos_proveedores AS
SELECT cm.id,
       COALESCE(p.nombre, 'Directo') AS proveedor,
       pl.nombre                     AS plataforma,
       cm.correo_cuenta,
       cm.cupos_ocupados,
       cm.cupos_totales,
       cm.costo_renovacion_usd,
       cm.fecha_corte_proveedor,
       (cm.fecha_corte_proveedor - current_date) AS dias_restantes
  FROM public.cuentas_madre cm
  LEFT JOIN public.proveedores p ON p.id = cm.proveedor_id
  JOIN public.plataformas pl     ON pl.id = cm.plataforma_id
 WHERE cm.estado = 'activa'
   AND cm.fecha_corte_proveedor IS NOT NULL
   AND cm.fecha_corte_proveedor <= current_date + 3;

-- ---------- 8) Demo de comisión en Google One (referido Ana) ----------
INSERT INTO public.cuentas_madre (id, proveedor_id, plataforma_id, correo_cuenta, cupos_totales, costo_renovacion_usd, fecha_corte_proveedor)
SELECT '00000000-0000-0000-0000-000000000022', NULL, id, 'googleone01@directo.com', 4, 8.00, current_date + 15
FROM public.plataformas WHERE nombre = 'Google One'
AND NOT EXISTS (SELECT 1 FROM public.cuentas_madre WHERE correo_cuenta = 'googleone01@directo.com');

INSERT INTO public.suscripciones (id, cliente_id, plan_id, cuenta_madre_id, fecha_inicio, fecha_corte_cliente, estado)
SELECT '00000000-0000-0000-0000-000000000035', '00000000-0000-0000-0000-000000000002',
       p.id, cm.id, current_date - 20, current_date + 10, 'activa'
  FROM public.planes p
  JOIN public.plataformas pl ON pl.id = p.plataforma_id
  JOIN public.cuentas_madre cm ON cm.plataforma_id = pl.id AND cm.correo_cuenta = 'googleone01@directo.com'
 WHERE pl.nombre = 'Google One' LIMIT 1;

INSERT INTO public.pagos_ingresos (id, cliente_id, monto_pagado, moneda, tasa_bcv_aplicada, tasa_cambio_binance, equivalente_usd, metodo_pago, fecha_pago)
VALUES ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000002',
        2.00, 'USDT', NULL, 43.2000, 2.00, 'Pago Movil Binance', current_date);

INSERT INTO public.pago_suscripciones (pago_ingreso_id, suscripcion_id, monto_asignado_usd)
VALUES ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000035', 2.00);

-- ---------- 9) Verificación ----------
SELECT 'comisiones pendientes (debe ser 1, en Google One)' AS item, count(*) FROM comisiones WHERE estado='pendiente'
UNION ALL SELECT 'plataformas c/ comisión', count(*) FROM plataformas WHERE aplica_comision
UNION ALL SELECT 'cuentas directo (sin proveedor)', count(*) FROM cuentas_madre WHERE proveedor_id IS NULL
UNION ALL SELECT 'cuentas sin corte (eternas)', count(*) FROM cuentas_madre WHERE fecha_corte_proveedor IS NULL;

-- ┌─ puerto de 0006_seguridad_renovaciones.sql ──────────────────────────────
-- ============================================================
-- 0006_seguridad_renovaciones.sql — Auditoría pre-despliegue (Fase 2.2)
--  • Vistas con security_invoker: tapa la filtración de datos
--    internos (correos de cuentas madre, costos, cortes) a
--    usuarios anónimos vía REST, manteniendo el catálogo público.
--  • Validación: el plan y la cuenta madre deben ser de la MISMA
--    plataforma (evita asignaciones cruzadas tipo Spotify→Netflix).
--  • Renovación: asignar un pago a una suscripción extiende su
--    fecha_corte_cliente por la duración del plan y la reactiva,
--    para que el cron diario no la marque vencida tras un cobro.
-- ============================================================

-- ---------- 1) SECURITY_INVOKER en vistas ----------
-- Antes, las vistas usaban semántica definer (el dueño ignora el RLS),
-- así que CUALQUIER anónimo podía leer v_vencimientos_proveedores
-- con un simple GET. Con security_invoker, el RLS de las tablas base
-- se aplica al invocador:
--   • Admin autenticado → políticas admin_acceso_total → ve todo
--   • Anónimo → sin políticas sobre cuentas_madre/proveedores → nada
-- Nota: v_catalogo_publico sigue legible anónimamente porque sus
-- tablas base (plataformas, planes) SÍ tienen política de lectura pública.
alter view public.v_catalogo_publico set (security_invoker = true);
alter view public.v_vencimientos_proveedores set (security_invoker = true);

-- ---------- 2) El plan y la cuenta madre deben compartir plataforma ----------
create or replace function public.validar_plataforma_suscripcion()
returns trigger
language plpgsql
as $$
declare
    v_plan_plataforma    text;
    v_cuenta_plataforma  text;
begin
    select pl.nombre into v_plan_plataforma
      from public.planes p
      join public.plataformas pl on pl.id = p.plataforma_id
     where p.id = new.plan_id;

    select pl.nombre into v_cuenta_plataforma
      from public.cuentas_madre cm
      join public.plataformas pl on pl.id = cm.plataforma_id
     where cm.id = new.cuenta_madre_id;

    if v_plan_plataforma is null then
        raise exception 'El plan % no existe', new.plan_id;
    end if;
    if v_cuenta_plataforma is null then
        raise exception 'La cuenta madre % no existe', new.cuenta_madre_id;
    end if;
    if v_plan_plataforma <> v_cuenta_plataforma then
        raise exception 'El plan es de % pero la cuenta madre es de %: asignación inválida',
            v_plan_plataforma, v_cuenta_plataforma;
    end if;

    return new;
end $$;

drop trigger if exists trg_validar_plataforma_susc on public.suscripciones;
create trigger trg_validar_plataforma_susc
    before insert or update of plan_id, cuenta_madre_id on public.suscripciones
    for each row execute function public.validar_plataforma_suscripcion();

-- ---------- 3) Renovación por pago ----------
create or replace function public.renovar_suscripcion_por_pago()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_dias integer;
begin
    select p.duracion_dias into v_dias
      from public.suscripciones s
      join public.planes p on p.id = s.plan_id
     where s.id = new.suscripcion_id;

    if v_dias is null then
        return new;
    end if;

    update public.suscripciones
       set fecha_corte_cliente = greatest(
               coalesce(fecha_corte_cliente, current_date), current_date
           ) + v_dias,
           estado = 'activa'
     where id = new.suscripcion_id;

    return new;
end $$;

drop trigger if exists trg_renovar_susc_por_pago on public.pago_suscripciones;
create trigger trg_renovar_susc_por_pago
    after insert on public.pago_suscripciones
    for each row execute function public.renovar_suscripcion_por_pago();

-- ---------- 4) Verificación ----------
select 'vistas con security_invoker' as item, count(*)::text as ok
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('v_catalogo_publico', 'v_vencimientos_proveedores')
   and array_to_string(c.reloptions, ',') like '%security_invoker=true%'
union all
select 'triggers nuevos', count(*)::text
  from pg_trigger
 where tgname in ('trg_validar_plataforma_susc', 'trg_renovar_susc_por_pago')
   and not tgisinternal;

-- ┌─ puerto de 0007_tienda.sql ──────────────────────────────
-- ============================================================
--  0007 — FASE 3 · TIENDA PÚBLICA + REGISTRO DE CLIENTES
--  Frontend público (#/tienda) con catálogo de venta y registro
--  de usuarios (nombre, correo y teléfono) vía Supabase Auth.
-- ============================================================

-- ------------------------------------------------------------
--  1) Precio de referencia (tachado) por plan — opcional.
--     Ej. Google One 1 mes: 2,99 $ (antes 5,99 $).
-- ------------------------------------------------------------
alter table public.planes
  add column if not exists precio_referencia_usd numeric(12,2);

-- Vista pública ampliada: expone además el precio de referencia
-- (mantiene security_invoker para que el RLS de las tablas base
--  se aplique al invocador).
create or replace view public.v_catalogo_publico
with (security_invoker = true)
as
select pl.nombre              as plataforma,
       pl.logo_url,
       p.duracion_dias,
       p.precio_venta_usd,
       p.precio_referencia_usd
  from public.planes p
  join public.plataformas pl on pl.id = p.plataforma_id
 where pl.activa;

-- ------------------------------------------------------------
--  2) REGISTRO — todo nuevo usuario de Supabase Auth recibe su
--     fila en `usuarios` (rol 'cliente') con los datos enviados
--     como metadatos del signUp (nombre y teléfono).
-- ------------------------------------------------------------
-- [NEON] se retira: funcion + trigger sobre auth.users → ver db/README.md


-- El cliente puede leer y editar su propia fila (sin poder
-- cambiar su rol: la fila solo puede seguir siendo 'cliente').
create policy "cliente_ve_su_fila"
  on public.usuarios
  for select
  to authenticated
  using (id = auth.uid());

create policy "cliente_edita_su_fila"
  on public.usuarios
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and rol = 'cliente');

-- ------------------------------------------------------------
--  3) CATÁLOGO DE VENTA
--     Google One (nueva plataforma) + escalones de 6 meses y
--     1 año para las plataformas existentes (1 mes ya existía).
-- ------------------------------------------------------------
insert into public.plataformas (nombre) values ('Google One')
on conflict (nombre) do nothing;

insert into public.planes (plataforma_id, duracion_dias, precio_venta_usd, precio_referencia_usd)
select pl.id, v.duracion, v.precio, v.precio_ref
  from public.plataformas pl
  join (values
    ('Google One',  30,   2.99,  5.99),
    ('Google One', 180,   8.99,  null),
    ('Google One', 365,  11.99,  null),
    ('Spotify',   180,  23.99,   null),
    ('Spotify',   365,  39.99,   null),
    ('Netflix',   180,  59.99,   null),
    ('Netflix',   365,  99.99,   null),
    ('Disney+',   180,  29.99,   null),
    ('Disney+',   365,  49.99,   null),
    ('Canva',     180,  39.99,   null),
    ('Canva',     365,  69.99,   null),
    ('ChatGPT',   180,  49.99,   null),
    ('ChatGPT',   365,  89.99,   null)
  ) as v(plataforma, duracion, precio, precio_ref)
    on v.plataforma = pl.nombre
on conflict (plataforma_id, duracion_dias) do nothing;

-- ┌─ puerto de 0008_catalogo_venta.sql ──────────────────────────────
-- ============================================================
--  0008 — FASE 3 · CATÁLOGO DE VENTA (datos reales del negocio)
--  Agrega los escalones de 6 meses y 1 año a las plataformas
--  creadas en el panel y consolida el duplicado "Google One 5 TB".
--  Todos los precios son editables desde Panel → Plataformas.
-- ============================================================

-- Spotify Premium: 1 mes ya existía (3,49 $); se agregan 6 meses
-- y 1 año anclados a ese precio (ahorro ≈19% y ≈31%, como el diseño).
insert into public.planes (plataforma_id, duracion_dias, precio_venta_usd, precio_referencia_usd)
select pl.id, v.duracion, v.precio, null
  from public.plataformas pl
  join (values
    ('Spotify Premium', 180,  16.99),
    ('Spotify Premium', 365,  28.99)
  ) as v(nombre, duracion, precio) on v.nombre = pl.nombre
on conflict (plataforma_id, duracion_dias) do nothing;

-- Canva Pro: escalones 1 mes / 6 meses / 1 año.
insert into public.planes (plataforma_id, duracion_dias, precio_venta_usd, precio_referencia_usd)
select pl.id, v.duracion, v.precio, null
  from public.plataformas pl
  join (values
    ('Canva Pro',  30,   8.00),
    ('Canva Pro', 180,  39.99),
    ('Canva Pro', 365,  69.99)
  ) as v(nombre, duracion, precio) on v.nombre = pl.nombre
on conflict (plataforma_id, duracion_dias) do nothing;

-- "Google One 5 TB" quedó duplicado de "Google One" (ambos vendían
-- el año a 11,99 $). Se desactiva de la tienda; los datos se
-- conservan y el admin puede borrarlo desde el panel si quiere.
update public.plataformas
   set activa = false
 where nombre = 'Google One 5 TB'
   and activa = true;

-- ┌─ puerto de 0009_pagos_avanzados.sql ──────────────────────────────
-- ============================================================
-- 0009_pagos_avanzados.sql
-- Pagos: métodos nuevos, renovación por fecha del pago y edición atómica.
-- - Método 'Binance' nuevo; 'Efectivo' fuera (el negocio no lo usa).
-- - La renovación de la suscripción se calcula desde la FECHA DEL PAGO
--   (permite registrar cobros de antes de la web).
-- - Función editar_pago (RPC, solo admin): reemplaza el pago + asignación
--   y recalcula la comisión del agente en un solo paso.
-- ============================================================

-- ---------- 1) Métodos de pago ----------
-- Conserva hipotéticas filas históricas 'Efectivo' como 'Otro' para no
-- bloquear el alter (normalmente no existen, el negocio no usa efectivo).
do $$
begin
  update public.pagos_ingresos
     set metodo_pago = 'Otro'
   where metodo_pago = 'Efectivo';

  alter table public.pagos_ingresos
    drop constraint if exists pagos_ingresos_metodo_pago_check;

  alter table public.pagos_ingresos
    add constraint pagos_ingresos_metodo_pago_check
    check (metodo_pago in (
      'Zelle','Pago Movil','Pago Movil Binance',
      'Binance','Transferencia','Otro'
    ));
end $$;

-- ---------- 2) Renovación por fecha del pago ----------
create or replace function public.renovar_suscripcion_por_pago()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_dias   integer;
    v_ppago  date;
begin
    select p.duracion_dias into v_dias
      from public.suscripciones s
      join public.planes p on p.id = s.plan_id
     where s.id = new.suscripcion_id;

    if v_dias is null then
        return new;
    end if;

    -- Fecha de referencia: la fecha del pago (soporta cobros atrasados).
    select pis.fecha_pago into v_ppago
      from public.pagos_ingresos pis
     where pis.id = new.pago_ingreso_id;

    if v_ppago is null then
        v_ppago := current_date;
    end if;

    update public.suscripciones
       set fecha_corte_cliente = greatest(
               coalesce(fecha_corte_cliente, v_ppago), v_ppago
           ) + v_dias,
           estado = 'activa'
     where id = new.suscripcion_id;

    return new;
end $$;

drop trigger if exists trg_renovar_susc_por_pago on public.pago_suscripciones;
create trigger trg_renovar_susc_por_pago
    after insert on public.pago_suscripciones
    for each row execute function public.renovar_suscripcion_por_pago();

-- ---------- 3) Edición atómica de un pago (RPC, solo admin) ----------
-- Reemplaza los datos del pago y su distribución, y deja que el trigger de
-- comisión recalcule la comisión del agente (si aplica).
create or replace function public.editar_pago(
    p_pago_id             uuid,
    p_cliente_id          uuid,
    p_monto_pagado        numeric,
    p_moneda              text,
    p_tasa_bcv_aplicada   numeric,
    p_tasa_cambio_binance numeric,
    p_equivalente_usd     numeric,
    p_metodo_pago         text,
    p_fecha_pago          date,
    p_asignados           jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_item jsonb;
begin
    if not public.es_admin() then
        raise exception 'Solo el admin puede editar pagos';
    end if;

    -- 1) Actualizar el ingreso (las validaciones de moneda/método aplican).
    update public.pagos_ingresos
       set cliente_id          = p_cliente_id,
           monto_pagado        = p_monto_pagado,
           moneda              = p_moneda,
           tasa_bcv_aplicada   = p_tasa_bcv_aplicada,
           tasa_cambio_binance = p_tasa_cambio_binance,
           equivalente_usd     = p_equivalente_usd,
           metodo_pago         = p_metodo_pago,
           fecha_pago          = p_fecha_pago
     where id = p_pago_id;

    -- 2) Recomponer la asignación y la comisión (el trigger de comisión
    --    solo dispara en INSERT, así que se borra todo y se reinserta).
    delete from public.pago_suscripciones where pago_ingreso_id = p_pago_id;
    delete from public.comisiones          where pago_id          = p_pago_id;

    for v_item in select * from jsonb_array_elements(p_asignados)
    loop
        insert into public.pago_suscripciones
            (pago_ingreso_id, suscripcion_id, monto_asignado_usd)
        values (
            p_pago_id,
            (v_item->>'suscripcion_id')::uuid,
            (v_item->>'monto_usd')::numeric
        );
    end loop;
end $$;

-- ---------- 4) Verificación ----------
select 'metodo_pago_check'::text as item,
       pg_get_constraintdef(oid)::text as ok
  from pg_constraint
 where conrelid = 'pagos_ingresos'::regclass
   and conname = 'pagos_ingresos_metodo_pago_check'
union all
select 'renovar_suscripcion_por_pago'::text,
       case when pg_get_functiondef(oid)::text like '%fecha_pago%'
            then 'usa fecha del pago' else 'usa current_date' end
  from pg_proc
 where proname = 'renovar_suscripcion_por_pago'
union all
select 'editar_pago'::text, 'creada'
  from pg_proc
 where proname = 'editar_pago';

-- ┌─ puerto de 0010_auto_confirmar_email.sql ──────────────────────────────


-- ┌─ puerto de 0011_pedidos_y_ajustes_catalogo.sql ──────────────────────────────
-- ============================================================
--  0011 — PEDIDOS DE LA TIENDA + AJUSTES DEL CATÁLOGO
--  · Elimina del catálogo los planes largos (>= 540 días / 18 meses)
--    que solo se vendieron de forma puntual (p. ej. Google One 546 días).
--  · Canva Pro pasa a venderse desde 1.99 $/mes.
--  · Nueva tabla `pedidos`: pedidos de la tienda (gift cards y planes)
--    que se muestran en el panel admin (monto y diseño en las gift cards).
--  Ejecutar en: Supabase Dashboard -> SQL Editor (o supabase db push)
-- ============================================================

-- ---------- 1) Catálogo ----------
-- 18 meses puntuales fuera del catálogo.
delete from public.planes
 where duracion_dias >= 540;

-- Canva Pro: el mes pasa a 1.99 $ (antes 8.00 $).
update public.planes p
   set precio_venta_usd = 1.99
 where p.duracion_dias = 30
   and exists (
     select 1 from public.plataformas pl
      where pl.id = p.plataforma_id
        and pl.nombre ilike 'Canva%'
   );

-- ---------- 2) Pedidos ----------
create table public.pedidos (
    id                   uuid primary key default gen_random_uuid(),
    tipo                 text not null check (tipo in ('plan','giftcard')),
    plataforma           text not null,
    -- Detalle de plan
    duracion_dias        integer,
    precio_usd           numeric(12,2),
    -- Detalle de gift card
    valor_giftcard_usd   numeric(12,2),
    precio_giftcard_eur  numeric(12,2),
    diseno_giftcard      text,
    -- Cliente que lo solicitó
    cliente_id           uuid references public.usuarios(id) on delete set null,
    cliente_nombre       text,
    cliente_contacto     text,
    -- Seguimiento
    estado               text not null default 'nuevo'
        check (estado in ('nuevo','contactado','completado','cancelado')),
    created_at           timestamptz not null default now()
);

create index idx_pedidos_created on public.pedidos(created_at desc);
create index idx_pedidos_cliente on public.pedidos(cliente_id);
create index idx_pedidos_estado  on public.pedidos(estado);

alter table public.pedidos enable row level security;

-- Admin: acceso total a los pedidos.
create policy "admin_pedidos_total" on public.pedidos
  for all using (public.es_admin()) with check (public.es_admin());

-- Cliente registrado: crea sus propios pedidos y consulta los suyos.
create policy "cliente_crea_su_pedido" on public.pedidos
  for insert to authenticated
  with check (cliente_id = auth.uid());

create policy "cliente_ve_sus_pedidos" on public.pedidos
  for select to authenticated
  using (cliente_id = auth.uid());

-- ---------- 3) Verificación ----------
select 'planes_540_quedan'::text as item,
       count(*)::text as ok
  from public.planes
 where duracion_dias >= 540
union all
select 'canva_mes_precio',
       precio_venta_usd::text
  from public.planes p
  join public.plataformas pl on pl.id = p.plataforma_id
 where pl.nombre ilike 'Canva%'
   and p.duracion_dias = 30
union all
select 'pedidos_tabla',
       case when exists (
         select 1 from pg_tables where schemaname = 'public' and tablename = 'pedidos'
       ) then 'creada' else 'falta' end;

-- ┌─ puerto de 0012_carrito_checkout.sql ──────────────────────────────
-- ============================================================
--  0012 — CARRITO Y CHECKOUT: cobro en el pedido + tasa del euro
--  · `pedidos` guarda el método de pago con que el cliente dijo
--    que pagará, la moneda cotizada y el monto exacto.
--  · `tasas_cambio` gana `tasa_eur_bs` para las gift cards de Apple
--    (Pago Móvil anclado al euro).
--  Ejecutar en: Supabase Dashboard -> SQL Editor (o supabase db push)
-- ============================================================

alter table public.pedidos
  add column if not exists metodo_pago  text,
  add column if not exists moneda_cobro text,
  add column if not exists monto_cobro  numeric(12,2);

comment on column public.pedidos.metodo_pago  is
  'Método con que el cliente pagará: pagomovil | usdt | usdc | zinli | binance';
comment on column public.pedidos.moneda_cobro is
  'Moneda cotizada del cobro: BS, USDT, USDC o USD (Zinli)';
comment on column public.pedidos.monto_cobro is
  'Monto exacto cotizado en el checkout (la tasa puede cambiar después)';

-- Tasa del euro (€ → Bs) para las Apple Gift Cards (Pago Móvil anclado al €).
alter table public.tasas_cambio
  add column if not exists tasa_eur_bs numeric(12,4);

-- ---------- Verificación ----------
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'pedidos'
   and column_name in ('metodo_pago','moneda_cobro','monto_cobro')
order by column_name;
