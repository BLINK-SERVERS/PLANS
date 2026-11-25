-- ── Precios de Canva Pro ───────────────────────────────────────────────
-- El catálogo del panel viejo tenía Canva Pro a 8.00 / 39.99 / 69.99 y así
-- llegó en el port: los datos reales se trasladaron como estaban, porque
-- trasladar es copiar, no corregir.
--
-- La corrección ya existía en el repo viejo y nunca corrió. La migración
-- `0011_pedidos_y_ajustes_catalogo.sql` decía «Canva Pro pasa a venderse
-- desde 1.99 $/mes», pero solo tocaba el plan de 30 días: los escalones de
-- 180 y 365 quedaban en 39.99 y 69.99, que con un mes a 1.99 son absurdos
-- (6 meses saldrían más caros que comprar 6 meses sueltos). Medido en la
-- base vieja: los tres precios siguen siendo los viejos, o sea que ni la
-- parte que sí estaba escrita se aplicó jamás.
--
-- Los valores nuevos vienen de las tarjetas aprobadas por el dueño:
--   1 mes   1.99 $
--   6 meses 9.69 $   (1.61 $/mes)
--   1 año  16.49 $   (1.37 $/mes)
-- y el front los valida solo, sin que nadie los escriba: `ahorra X%` se
-- deriva del plan de 30 días (src/lib/tienda.ts, agruparCatalogo). Con estos
-- tres números reproduce exactamente los badges de las tarjetas:
--   9.69  / (1.99 × 6)  = 0.811  →  ahorra 19 %
--   16.49 / (1.99 × 12) = 0.690  →  ahorra 31 %
-- Cualquier otro par de precios daría otros porcentajes, así que esto es a la
-- vez la prueba de que los valores son los correctos.
--
-- Spotify Premium no se toca: 3.49 / 16.99 / 28.99 ya coincide con sus
-- tarjetas (19 % y 31 %, mismos porcentajes).
--
-- No se pone `precio_referencia_usd`: el tachado solo se muestra en el plan
-- mensual, y en las tarjetas el mensual no lleva descuento. Dejarlo NULL es
-- lo que hace que el badge no aparezca, no un descuido.
--
-- Efecto sobre lo que ya está vendido: ninguno. El trigger
-- `renovar_suscripcion_por_pago` usa `planes.duracion_dias`, nunca el precio;
-- la plata la registra el admin en `pagos_ingresos`. Las 6 suscripciones
-- activas de Canva siguen vigentes con su corte actual.

begin;

update public.planes p
   set precio_venta_usd = v.precio
  from (values
          (30,  1.99::numeric),
          (180, 9.69::numeric),
          (365, 16.49::numeric)
        ) as v(dias, precio)
 where p.duracion_dias = v.dias
   and exists (
     select 1 from public.plataformas pl
      where pl.id = p.plataforma_id
        and pl.nombre ilike 'Canva%'
   )
   and p.precio_venta_usd is distinct from v.precio;

-- Verificación: si alguno de los tres no quedó como se pidió, esto revierte
-- la transacción en vez de dejar el catálogo a medias. Se comparan los tres
-- de una sola vez y se exige que sean tres: un catálogo con dos Canva también
-- es un catálogo roto.
do $$
declare
    malos integer;
    total integer;
begin
    select count(*) into total
      from public.planes p
      join public.plataformas l on l.id = p.plataforma_id
     where l.nombre ilike 'Canva%';

    select count(*) into malos
      from public.planes p
      join public.plataformas l on l.id = p.plataforma_id
     where l.nombre ilike 'Canva%'
       and p.precio_venta_usd <> case p.duracion_dias
                                   when 30  then 1.99
                                   when 180 then 9.69
                                   when 365 then 16.49
                                   else null
                                 end;

    if total <> 3 or malos <> 0 then
        raise exception 'Canva Pro quedó con % planes y % precios fuera de lugar', total, malos;
    end if;
end
$$;

commit;

select l.nombre as plataforma, p.duracion_dias as dias, p.precio_venta_usd as precio
  from public.planes p
  join public.plataformas l on l.id = p.plataforma_id
 where l.nombre ilike 'Canva%' or l.nombre ilike 'Spotify%'
 order by l.nombre, p.duracion_dias;
