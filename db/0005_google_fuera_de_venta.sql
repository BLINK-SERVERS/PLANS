-- ── Google One fuera del catálogo público ──────────────────────────────
-- Google One dejó de estar disponible. Se retira de la venta, no de la
-- historia: `activa = false` es la bandera que ya existe y que la vista
-- `v_catalogo_publico` respeta (db/0001_esquema_negocio.sql). Borrar la
-- plataforma o sus planes rompería el embed de las 10 suscripciones activas
-- que todavía viven ahí, y `planes_plataforma_id_fkey` apunta a
-- `on delete cascade`: borrar la plataforma se llevaría los planes por
-- delante. Eso no es retirar un producto, es borrarlo.
--
-- 'Google One 5 TB' ya estaba inactiva en el port (db/_port_raw.sql). Esta
-- línea deja las dos variantes de Google fuera de la misma forma, y deja
-- constancia de por qué: el panel sigue viéndolas porque lee `plataformas`
-- y `suscripciones` directas, nunca la vista pública.
--
-- Lo que NO hace esto, y queda dicho a propósito: no toca `pedidos` ni
-- `pagos_ingresos`. Un pedido viejo que menciona Google One sigue siendo
-- legible en el panel.

begin;

update public.plataformas
   set activa = false
 where nombre ilike 'Google One%';

do $$
begin
    if exists (
        select 1 from public.plataformas
         where nombre ilike 'Google One%' and activa
    ) then
        raise exception 'quedó alguna plataforma de Google activa en el catálogo';
    end if;
    if not exists (
        select 1 from public.plataformas
         where nombre ilike 'Google One%' and not activa
    ) then
        raise exception 'no había ninguna plataforma de Google que desactivar';
    end if;
end
$$;

commit;

select nombre, activa from public.plataformas order by nombre;
