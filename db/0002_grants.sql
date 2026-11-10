-- ============================================================
--  db/0002_grants.sql — permisos de las dos identidades de la app
-- ============================================================
--  En Supabase esto no existía: el proyecto se aprovisiona con
--  `grant all on all tables in schema public to anon, authenticated`
--  (privilegios por defecto) y toda la autorización la ponía RLS.
--  En Neon NO hay esos privilegios por defecto: neondb_owner es el dueño
--  de todo y las tablas nacen con ACL vacía, o sea accesibles solo por el
--  dueño. Sin este archivo la API de datos devuelve 42501 en la primera
--  consulta, aunque las políticas de RLS estén perfectas.
--
--  Se ejecuta DESPUÉS de 0000_auth_uid.sql y 0001_esquema_negocio.sql.
--  Los roles `anonymous` y `authenticated` se crean arriba, no los crea
--  Neon aquí: en el piloto los creaba la Data API, y en producción no hay
--  Data API (ver el encabezado de neon.ts y piloto/RESULTADOS.md).
--
--  Modelo elegido — espejo del viejo, deliberadamente:
--    · `authenticated`  → ALL sobre las 12 tablas de gestión. La puerta es
--      RLS (las 19 políticas de 0001), no el grant. Quitarle un grant a una
--      tabla que el panel lee es un 42501 indistinguible de "no existe".
--    · `anonymous`      → SELECT al catálogo público y nada más. Ni aunque
--      una política se escriba mal podrá escribir un visitante.
--    · `tasas_cambio` es la única tabla de gestión donde `authenticated`
--      NO escribe: la llena la Function de tasa BCV con DATABASE_URL
--      (neondb_owner), y el panel solo la lee. Está comprobado en el
--      barrido: en src/lib/api.ts `tasas_cambio` aparece solo en `.select`.
-- ============================================================

-- ------------------------------------------------------------
-- anonymous: la tienda sin sesión
-- ------------------------------------------------------------
-- v_catalogo_publico es security_invoker=true, así que el visitante también
-- necesita SELECT sobre las tablas base que la vista consulta (planes y
-- plataformas); si no, da 42501 al expandir la vista.
grant select on public.plataformas, public.planes to anonymous;
grant select on public.v_catalogo_publico to anonymous;

-- ------------------------------------------------------------
-- authenticated: panel + tienda con sesión
-- ------------------------------------------------------------
grant select, insert, update, delete on public.plataformas to authenticated;
grant select, insert, update, delete on public.planes to authenticated;
grant select, insert, update, delete on public.proveedores to authenticated;
grant select, insert, update, delete on public.cuentas_madre to authenticated;
grant select, insert, update, delete on public.usuarios to authenticated;
grant select, insert, update, delete on public.suscripciones to authenticated;
grant select, insert, update, delete on public.comisiones to authenticated;
grant select, insert, update, delete on public.pedidos to authenticated;
grant select, insert, update, delete on public.pagos_ingresos to authenticated;
grant select, insert, update, delete on public.pago_suscripciones to authenticated;
grant select, insert, update, delete on public.pagos_egresos to authenticated;
grant select on public.tasas_cambio to authenticated;

grant select on public.v_catalogo_publico, public.v_vencimientos_proveedores to authenticated;

-- ------------------------------------------------------------
-- RPC del panel: editar_pago
-- ------------------------------------------------------------
-- Es security definer y se autoguarda con `if not public.es_admin() then
-- raise`, así que ejecutarla está abierto a `authenticated` sin riesgo: la
-- autorización real está dentro. `anonymous` NO la recibe — antes de este
-- grant el único camino era el rol del JWT, y conviene que el 42501 sea la
-- primera barrera, no la segunda.
revoke execute on function public.editar_pago(uuid, uuid, numeric, text, numeric, numeric, numeric, text, date, jsonb) from public, anonymous;
grant execute on function public.editar_pago(uuid, uuid, numeric, text, numeric, numeric, numeric, text, date, jsonb) to authenticated;

-- es_admin() también es security definer y la invocan las 12 políticas
-- `admin_acceso_total`, que están declaradas `to public` o sea que aplican
-- también al visitante. Se deja con el EXECUTE a PUBLIC que Postgres da por
-- defecto, sin revoked: la barrera efectiva para `anonymous` es el grant de
-- tabla, que sí se comprueba primero.
--
-- Medido en la rama de esquema, no asumido:
--   set role anonymous; select count(*) from proveedores  → 42501
--                                                       "permission denied
--                                                        for table proveedores"
--   set role anonymous; select count(*) from planes       → 18 filas
--   set role anonymous; revoke execute on es_admin()      → sigue dando 18
-- La última línea es la que derriba la sospecha de que quitarle EXECUTE a
-- es_admin() rompería el catálogo: con varias políticas permisivas, Postgres
-- corta por la que se cumple (`catalogo_publico_planes` → true) y no evalúa
-- la del admin. Aun así no se retira: no hay motivo para que una consulta
-- legítima dependa de ese orden.

-- ------------------------------------------------------------
-- Invariantes que este archivo NO puede dar por sí solo
-- ------------------------------------------------------------
-- · `neondb_owner` es dueño de las tablas y por eso elude RLS. La Function
--   de tasa BCV depende de eso (escribe sin sesión de usuario); ninguna
--   petición del navegador llega con ese rol: la Function hace
--   `set local role authenticated|anonymous` antes de tocar nada.
-- · No hay secuencias que otorgar: las 12 tablas ids en uuid con
--   gen_random_uuid(), sin serial ni identity (verificado con
--   `select count(*) from pg_class where relkind='S'` → 0).
-- · No hay `notify pgrst`: en producción no corre PostgREST, la API de
--   datos es la Function `datos` (ver neon.ts), así que no hay diccionario
--   que recargar. En el piloto sí hacía falta.
