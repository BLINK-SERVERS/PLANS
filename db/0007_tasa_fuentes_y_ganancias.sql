-- ============================================================
-- 0007 · De qué fuente salió cada tasa, y las ganancias en Bs
-- ============================================================
-- Dos cosas, y las dos nacen del mismo problema: el número con el que se
-- cobra en bolívares no puede depender de un solo raspado de HTML.
--
-- 1. `tasas_cambio.fuente` — hasta hoy la tabla guardaba el valor sin decir
--    de dónde salió. El 2026-11-25 el BCV reemitió su certificado y el raspado
--    dejó de alcanzar: la tabla estuvo 66 días con 42,50 (la fila vieja del
--    2026-09-20) mientras el BCV publicaba 924,35. Un cobro en Bs dividido por
--    ese número sale 21 veces más alto. Con la fuente guardada, la fila vieja
--    se reconoce como la fila vieja, y el panel puede decir «esta tasa la dio
--    bcv.org.ve» o «la dio dolarapi porque el raspado cayó».
--
-- 2. `v_ganancias` — lo que se ganó, calculado sobre los bolívares que de
--    verdad entraron. `pagos_ingresos.equivalente_usd` es un número escrito al
--    guardar el cobro; si la tasa usada estaba vencida, el USD queda mal y la
--    mesa de dinero lo repite. La vista recalcula cada cobro con la tasa del
--    día de ESE cobro y deja al lado el valor guardado, para que la
--    diferencia se vea en lugar de adivinarse. Regla: el USD de un cobro en Bs
--    es `monto_pagado / tasa_del_dia`, y USDT/USD entran 1:1.
--
-- Orden de montaje en blanco: 0001, 0002, [0003], 0004, 0005, 0006, 0007.

-- ------------------------------------------------------------ 1 · la fuente
alter table public.tasas_cambio
  add column if not exists fuente text;

comment on column public.tasas_cambio.fuente is
  'bcv-html (raspado del sitio oficial) | dolarapi (JSON de respaldo) | null = fila importada del proyecto viejo, origen no registrado';

-- ------------------------------------------------------------ 2 · ganancias
-- `security_invoker = true`, como las otras tres vistas: expande con los
-- privilegios del que consulta y deja decidir a RLS sobre las tablas base. El
-- panel (admin) ve todo; un cliente que llamara a la vista leería cero filas.
--
-- `tasa_del_dia` prioriza `tasa_bcv_aplicada` —la oficial del día en que se
-- cobró, guardada junto al cobro— sobre `tasas_cambio`. Es deliberado: la tabla
-- de tasas solo tiene las fechas en que alguien refrescó (medido en producción:
-- 2026-11-26 y la basura del 2026-09-20), y para un cobro del 2026-09-15
-- dividir por la fila del 2026-09-20 daría 42,50 en vez de 845,00. La tasa
-- guardada con el pago ES la tasa del día; `tasas_cambio` entra de respaldo
-- cuando el cobro se registró sin ella.
create or replace view public.v_ganancias
  with (security_invoker = true) as
select
  p.id                                              as pago_id,
  p.fecha_pago,
  p.cliente_id,
  u.nombre                                          as cliente,
  p.moneda,
  p.metodo_pago,
  p.monto_pagado                                    as monto_recibido,
  case when p.moneda = 'BS' then p.monto_pagado end as bs_recibidos,
  coalesce(p.tasa_bcv_aplicada, t.tasa_bcv)         as tasa_del_dia,
  -- Para que la pantalla distinga «tasa del cobro» de «tasa rescatada de la
  -- tabla», que no es lo mismo y conviene verlo cuando el número se discute.
  (p.tasa_bcv_aplicada is null)                     as tasa_rescatada_de_tabla,
  case
    when p.moneda = 'BS'
      then round(p.monto_pagado / nullif(coalesce(p.tasa_bcv_aplicada, t.tasa_bcv), 0), 2)
    else round(p.monto_pagado, 2)
  end                                               as usd_del_dia,
  p.equivalente_usd                                 as usd_registrado,
  case
    when p.moneda = 'BS'
      then round(p.equivalente_usd
                   - round(p.monto_pagado / nullif(coalesce(p.tasa_bcv_aplicada, t.tasa_bcv), 0), 2), 2)
    else 0::numeric
  end                                               as diferencia_usd,
  a.asignado_usd,
  c.comision_usd,
  c.comision_estado
from public.pagos_ingresos p
left join public.usuarios u
  on u.id = p.cliente_id
left join lateral (
  select tc.tasa_bcv
  from public.tasas_cambio tc
  where tc.fecha = p.fecha_pago
  order by tc.tasa_bcv desc
  limit 1
) t on true
left join lateral (
  select round(sum(ps.monto_asignado_usd), 2) as asignado_usd
  from public.pago_suscripciones ps
  where ps.pago_ingreso_id = p.id
) a on true
left join lateral (
  select round(sum(cm.monto_comision_usd), 2) as comision_usd,
         string_agg(distinct cm.estado, ',')  as comision_estado
  from public.comisiones cm
  where cm.pago_id = p.id
) c on true;

comment on view public.v_ganancias is
  'Un cobro por fila: Bs recibidos, la tasa oficial de ese día, el USD recalculado y la diferencia contra lo guardado.';

grant select on public.v_ganancias to authenticated;
