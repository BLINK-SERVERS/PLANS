-- ============================================================
-- 0006 · El cliente declara la renovación desde la landing
-- ============================================================
-- Regla de negocio que sostiene este archivo: el cliente declara, el admin
-- valida, el trigger renueva. Ningún camino nuevo del navegador escribe
-- `pago_suscripciones`; la única forma de llegar ahí sigue siendo validar.
--
-- Tres cosas más que el diseño original no preveía y que se midieron en
-- producción antes de escribir (2026-11-25):
--
-- 1. `suscripciones` tiene UNA sola política, `admin_acceso_total`
--    (`for all to public using (es_admin())`). La vista propuesta es
--    `security_invoker = true`, o sea que expande con los privilegios del que
--    consulta: un cliente leería CERO filas y la pantalla de renovación
--    quedaría vacía. Sin esta política la vista no sirve, no importa cuántas
--    políticas tenga la vista encima. Por eso va `cliente_ve_sus_suscripciones`.
--
-- 2. `pedidos.cliente_crea_su_pedido` es `with check (cliente_id = auth.uid())`
--    y no dice nada de `suscripcion_id`. Con el índice parcial del punto 4,
--    eso es un candado: cualquiera mete un pedido `nuevo` apuntando a la
--    suscripción de otro y bloquea la renovación legítima de ese cliente
--    hasta que el admin borre el pedido basura. La política se reemplaza con
--    la misma condición más la pertenencia.
--
-- 3. `editar_pago` borra y reinserta las asignaciones, y `trg_renovar_susc_por_pago`
--    es `AFTER INSERT`. Editar un pago ya validado sumaba los días del plan una
--    segunda vez, con el mismo dinero. Se arregla aquí, no en el front.
--
-- Orden de montaje en blanco: 0001, 0002, [0003 si existe], 0004, 0005, 0006.

SET search_path TO public;

-- ------------------------------------------------------------
-- 1 · Auto-lectura de suscripciones + vista de la pantalla
-- ------------------------------------------------------------
-- El alcance es la fila propia y nada más: `suscripciones` no tiene columnas de
-- costo (costo_renovacion_usd, cupos_* y fecha_corte_proveedor viven en
-- cuentas_madre, que sigue sin política de lectura para cliente), así que el
-- cliente ve su plan, su corte y su estado. `cuenta_madre_id` es el de él.
create policy cliente_ve_sus_suscripciones on public.suscripciones
  for select to authenticated
  using (cliente_id = auth.uid());

-- 7 columnas, ninguna sensible, ninguna escribible.
create view public.v_mis_suscripciones with (security_invoker = true) as
select s.id                                            as suscripcion_id,
       pl.nombre                                       as plataforma,
       p.duracion_dias,
       p.precio_venta_usd                              as monto_renovacion_usd,
       s.estado,
       s.fecha_corte_cliente,
       (s.fecha_corte_cliente - current_date)          as dias_restantes
  from public.suscripciones s
  join public.planes p      on p.id = s.plan_id
  join public.plataformas pl on pl.id = p.plataforma_id
 where s.cliente_id = auth.uid();

comment on view public.v_mis_suscripciones is
  'Lo que el cliente ve para renovar: su suscripción, el plan y el corte. '
  'security_invoker: la puerta real es cliente_ve_sus_suscripciones.';

-- Sin política sobre la vista: medido en esta rama, Postgres 18 la rechaza por
-- los dos lados. `create policy ... on v_mis_suscripciones` da "is not a table"
-- y `alter view ... enable row level security` da "not supported for views".
-- Lo que protege la vista son dos cosas: el grant de abajo y
-- cliente_ve_sus_suscripciones de arriba, porque security_invoker expande la
-- vista con el rol que consulta. Es el mismo arreglo de v_catalogo_publico, que
-- tampoco tiene RLS (relrowsecurity = f) y vive de sus grants y de
-- catalogo_publico_planes.
grant select on public.v_mis_suscripciones to authenticated;

-- No hay grant para anonymous: sin sesión la vista da 42501 antes de policy.

-- ------------------------------------------------------------
-- 2 · El pedido sabe contra qué suscripción se cobra
-- ------------------------------------------------------------
alter table public.pedidos
  add column if not exists suscripcion_id uuid
    references public.suscripciones(id) on delete set null;

comment on column public.pedidos.suscripcion_id is
  'Renovación: suscripción contra la que se cobra. Nulo en pedidos de tienda.';

-- `add column` sin default no reescribe la tabla ni bloquea escrituras.

-- Mismo alcance, ahora con la pertenencia: `tipo` dice qué se vende, no contra
-- qué fila se aplica, así que el pedido de renovación entra con tipo='plan'.
drop policy if exists cliente_crea_su_pedido on public.pedidos;
create policy cliente_crea_su_pedido on public.pedidos
  for insert to authenticated
  with check (
    cliente_id = auth.uid()
    and (suscripcion_id is null or exists (
          select 1
            from public.suscripciones s
           where s.id = pedidos.suscripcion_id
             and s.cliente_id = auth.uid()
        ))
  );

-- Un solo pedido abierto por suscripción: es lo que impide que el doble click
-- cree dos renovaciones y que el panel tenga dos candidatos ambigüos. No es
-- único total, porque el mismo cliente renueva mes tras mes.
create unique index if not exists pedidos_renovacion_abierta
  on public.pedidos (suscripcion_id)
  where estado = 'nuevo' and suscripcion_id is not null;

-- ------------------------------------------------------------
-- 3 · Validar y renovar, en una sola transacción
-- ------------------------------------------------------------
-- `registrarPago` del front no alcanza: hace dos `/consulta` en transacciones
-- distintas, y si el segundo insert falla queda un ingreso huérfano con
-- trg_comision_referido ya corrido y el pedido sin cerrar. Aquí el ingreso, la
-- asignación (que dispara los dos triggers) y el cierre del pedido comparten
-- transacción, o no queda nada.
--
-- El cliente NO sale en la firma: se saca del pedido. Menos argumentos que el
-- admin pueda confundir y ningún margen para cobrarle a quien no es.
create or replace function public.validar_renovacion(
    p_pedido                uuid,
    p_monto_pagado          numeric,
    p_moneda                text,
    p_tasa_bcv_aplicada     numeric,
    p_tasa_cambio_binance   numeric,
    p_equivalente_usd       numeric,
    p_metodo_pago           text,
    p_fecha_pago            date
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_pedido pedidos%rowtype;
    v_pago   uuid;
begin
    if not public.es_admin() then
        raise exception 'Solo el admin valida renovaciones';
    end if;

    -- `for update` es lo que serializa el doble click real: la segunda
    -- transacción queda bloqueada acá hasta el commit de la primera, y al
    -- entrar ya encuentra estado <> 'nuevo'.
    select * into v_pedido
      from public.pedidos
     where id = p_pedido
       for update;

    if not found then
        raise exception 'Pedido % inexistente', p_pedido;
    end if;

    if v_pedido.suscripcion_id is null then
        raise exception 'El pedido % no es una renovación', p_pedido;
    end if;

    if v_pedido.estado <> 'nuevo' then
        return null;                       -- idempotencia: ya estaba validado
    end if;

    insert into public.pagos_ingresos
        (cliente_id, monto_pagado, moneda, tasa_bcv_aplicada,
         tasa_cambio_binance, equivalente_usd, metodo_pago, fecha_pago)
    values
        (v_pedido.cliente_id, p_monto_pagado, p_moneda, p_tasa_bcv_aplicada,
         p_tasa_cambio_binance, p_equivalente_usd, p_metodo_pago, p_fecha_pago)
    returning id into v_pago;

    -- Esta fila es la que mueve la fecha de corte. El admin no elige
    -- suscripción: la trae el pedido, y el FK + la política del punto 2 ya
    -- garantizan que es del cliente del pedido.
    insert into public.pago_suscripciones
        (pago_ingreso_id, suscripcion_id, monto_asignado_usd)
    values
        (v_pago, v_pedido.suscripcion_id, v_pedido.monto_cobro);

    update public.pedidos
       set estado = 'completado'
     where id = p_pedido;

    return v_pago;
end $$;

comment on function public.validar_renovacion(uuid, numeric, text, numeric, numeric, numeric, text, date) is
  'Cierra un pedido de renovación: crea el ingreso, asigna el pago (dispara '
  'renovación y comisión) y marca el pedido completado. Todo en una transacción.';

-- Réplica exacta del trato que recibe editar_pago: authenticated sí, anonymous no.
revoke execute on function public.validar_renovacion(uuid, numeric, text, numeric, numeric, numeric, text, date)
  from public, anonymous;
grant execute on function public.validar_renovacion(uuid, numeric, text, numeric, numeric, numeric, text, date)
  to authenticated;

-- ------------------------------------------------------------
-- 4 · editar_pago deja de sumar días la segunda vez
-- ------------------------------------------------------------
-- Snapshot de cortes ANTES de tocar, y reintegro después del re-insert para las
-- suscripciones que ya estaban asignadas a este pago. Las que se agregan ahora
-- sí se extienden (es plata nueva). Si cambia el monto, la comisión se recalcula
-- igual: trg_comision_referido dispara en el mismo re-insert.
--
-- Lo que NO hace: retirar los días de una suscripción que se quita de la
-- asignación. Ese era el comportamiento antes y sigue siendo; sacarla del pago
-- no revierte lo que ya corrió.
create or replace function public.editar_pago(
    p_pago_id uuid, p_cliente_id uuid, p_monto_pagado numeric, p_moneda text,
    p_tasa_bcv_aplicada numeric, p_tasa_cambio_binance numeric,
    p_equivalente_usd numeric, p_metodo_pago text, p_fecha_pago date,
    p_asignados jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_item    jsonb;
    v_previos jsonb;
begin
    if not public.es_admin() then
        raise exception 'Solo el admin puede editar pagos';
    end if;

    select jsonb_object_agg(
               s.id,
               jsonb_build_object('corte', s.fecha_corte_cliente,
                                  'estado', s.estado)
           )
      into v_previos
      from public.pago_suscripciones ps
      join public.suscripciones s on s.id = ps.suscripcion_id
     where ps.pago_ingreso_id = p_pago_id;

    v_previos := coalesce(v_previos, '{}'::jsonb);

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

    -- 3) Devolver el corte de lo que ya estaba: reinsertar es un INSERT nuevo
    --    y trg_renovar_susc_por_pago no sabe que ese dinero ya sumó días.
    update public.suscripciones s
       set fecha_corte_cliente = (v_previos -> s.id::text ->> 'corte')::date,
           estado              = coalesce(v_previos -> s.id::text ->> 'estado',
                                          s.estado)
      where v_previos ? s.id::text
        and exists (select 1
                      from public.pago_suscripciones ps
                     where ps.pago_ingreso_id = p_pago_id
                       and ps.suscripcion_id = s.id);
end $$;

-- ------------------------------------------------------------
-- 5 · Autocontrol: si algo no quedó, la migración falla
-- ------------------------------------------------------------
do $$
declare
    v_cols integer;
    v_pol  integer;
begin
    select count(*) into v_cols
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'v_mis_suscripciones';

    if v_cols <> 7 then
        raise exception 'v_mis_suscripciones quedó con % columnas, se esperaban 7', v_cols;
    end if;

    select count(*) into v_pol
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
     where (c.relname = 'suscripciones' and p.polname = 'cliente_ve_sus_suscripciones')
        or (c.relname = 'pedidos' and p.polname = 'cliente_crea_su_pedido');

    if v_pol <> 2 then
        raise exception 'Faltan políticas de cliente para renovar (% de 2)', v_pol;
    end if;
end $$;
