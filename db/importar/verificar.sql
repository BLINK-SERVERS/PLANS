-- ============================================================
--  db/importar/verificar.sql — paridad origen ↔ destino
-- ============================================================
--  Se puede correr contra CUALQUIERA de los dos lados: lee el catálogo, así
--  que cubre las tablas que existan sin que haya que mantener la lista a mano.
--  volcar.sh lo ejecuta en ambos y hace `diff`; si algo no coincide, la salida
--  es el diff.
--
--  Cada tabla aporta filas + una firma del conjunto de ids. La firma es lo que
--  distingue "restauré 4.000 filas" de "restauré las 4.000 filas correctas":
--  un uuid de más o de menos cambia el md5, y con un count() no se entera nadie.
--
--  Uso:  psql "$BASE" -X -q -At -f db/importar/verificar.sql
-- ============================================================

\pset footer off

-- 1) Filas y firma por tabla de public (las que tienen columna `id`).
select format(
         'select %L as tabla, count(*)::text as filas, %s as firma from public.%I',
         c.relname,
         case when exists (
                select 1 from information_schema.columns col
                 where col.table_schema = 'public'
                   and col.table_name = c.relname
                   and col.column_name = 'id'
              )
              then 'coalesce(md5(string_agg(id::text, '','' order by id::text)),'''')'
              else '''(sin id)'''
         end,
         c.relname
       )
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind in ('r','p')
   and c.relpersistence = 'p'
 order by c.relname \gexec

-- 2) El dinero, en claro. Son las cuatro cifras que si cambian se notan en la
--    calle: lo cobrado, lo pagado a agentes, los cupos consumidos y la última
--    tasa BCV. Se redondean a 2 decimales porque numeric(12,2) es el tipo real.
select 'suma|pagos_ingresos.equivalente_usd|' || coalesce(sum(equivalente_usd)::numeric(14,2)::text, '0')
  from public.pagos_ingresos;
select 'suma|comisiones.monto_comision_usd|' || coalesce(sum(monto_comision_usd)::numeric(14,2)::text, '0')
  from public.comisiones;
select 'suma|cuentas_madre.cupos_ocupados|' || coalesce(sum(cupos_ocupados)::text, '0')
  from public.cuentas_madre;
select 'suma|tasas_cambio.tasa_bcv|' || coalesce(sum(tasa_bcv)::text, '0')
  from public.tasas_cambio;

-- 3) Invariantes del negocio que los disparadores sostienen. Si el volcado
--    recalculó algo, estos conteos dejan de ser 0.
select 'invariante|cupos_fuera_de_rango|' || count(*)::text
  from public.cuentas_madre
 where cupos_ocupados < 0 or cupos_ocupados > cupos_totales;

select 'invariante|suscripciones_activas_distintas_de_cupos|' || count(*)::text
  from public.cuentas_madre m
  join lateral (
    select count(*) s from public.suscripciones
     where cuenta_madre_id = m.id and estado = 'activa'
  ) s on true
 where m.cupos_ocupados is not null
   and s.s <> greatest(m.cupos_ocupados, 0);

select 'invariante|pago_sin_comision_de_referido|' || count(*)::text
  from public.pago_suscripciones ps
  join public.suscripciones s on s.id = ps.suscripcion_id
  join public.usuarios u      on u.id = s.cliente_id
  join public.planes p        on p.id = s.plan_id
  join public.plataformas pf  on pf.id = p.plataforma_id and pf.aplica_comision
 where u.referido_por is not null
   and not exists (
     select 1 from public.comisiones c where c.pago_id = ps.pago_ingreso_id
   );
