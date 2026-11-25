# Renovar desde la landing — plan de implementación

Verificado en producción: `trg_renovar_susc_por_pago` es `AFTER INSERT ON pago_suscripciones`
(`tgtype=5`) y no toca `cuenta_madre_id`. 0012 ya aplicada (`pedidos` con sus dos políticas y su
grant). Datos: 16 activas (cortes 2026-11-29 → 2029-09-16), 1 vencida, 17 clientes, `pedidos` = 0
filas, `pago_suscripciones` = 6 con `UNIQUE (pago_ingreso_id, suscripcion_id)`, Postgres 18. Los
botones de `src/pages/Inicio.tsx:145` y `:250` van a `/renovar`, ruta inexistente (`App.tsx:55-77`)
→ rebotan a `/`.

## 1 · Identidad: vista + política de auto-lectura

CORREGIDO AL EJECUTAR (2026-11-25, rama `prueba-renovar`). La idea de la vista sigue
en pie, pero la política sobre la vista **no se puede escribir**: Postgres 18 la
rechaza por los dos lados.

```
create policy ... on public.v_mis_suscripciones   → ERROR: "v_mis_suscripciones" is not a table
alter view  ... enable row level security         → ERROR: not supported for views
```

Y había un error peor de diseño: `suscripciones` solo tiene `admin_acceso_total`, así
que una vista `security_invoker = true` expande con el rol que consulta y el cliente
leía **cero filas**. Medido: con `cliente_ve_sus_suscripciones` caída, la vista
devolvió 0; con la política, devolvió las 2 suscripciones correctas de 18 totales.
La pantalla de renovación habría nacido vacía.

Lo que sí hace falta, entonces, es la política de auto-lectura en la tabla base. El
`where s.cliente_id = auth.uid()` de la vista queda como segunda capa, no como única.

```sql
-- db/0006_cliente_renueva.sql
create policy cliente_ve_sus_suscripciones on public.suscripciones
  for select to authenticated
  using (cliente_id = auth.uid());

create view public.v_mis_suscripciones with (security_invoker = true) as
select s.id as suscripcion_id, pl.nombre as plataforma,
       p.duracion_dias, p.precio_venta_usd as monto_renovacion_usd,
       s.estado, s.fecha_corte_cliente,
       (s.fecha_corte_cliente - current_date) as dias_restantes
  from suscripciones s
  join planes p         on p.id = s.plan_id
  join plataformas pl  on pl.id = p.plataforma_id
 where s.cliente_id = auth.uid();

grant select on public.v_mis_suscripciones to authenticated;   -- sin policy posible
```

Sigue valiendo el argumento de superficie: 7 columnas, y caen por la vía de la tabla
`cuenta_madre_id`, `correo_cuenta`, `cupos_*`, `costo_renovacion_usd` y
`fecha_corte_proveedor`. La prueba de that: `set local role anonymous; select * from
v_mis_suscripciones` → `permission denied for view`. Sin sesión no hay lectura.

`security_invoker=true` hace inocua la ausencia de RLS en la vista: la puerta es la
política de la tabla base, y `auth.uid()` recorta. Precedente `db/0001_esquema_negocio.sql:520`
(`v_catalogo_publico`, que tampoco tiene RLS y vive de sus grants).

## 2 · El pedido: `tipo='plan'` + columna nueva

No altero el CHECK: obliga a revalidar y toca cada discriminador (`types.ts:45`, `api.ts:276`,
`Pedidos.tsx:31,51`). `tipo` dice **qué se vende**, no **contra qué fila se aplica**; la renovación
vende el mismo plan. Falta la referencia.

```sql
alter table public.pedidos
  add column if not exists suscripcion_id uuid
    references public.suscripciones(id) on delete set null;
comment on column public.pedidos.suscripcion_id is
  'Renovación: suscripción contra la que se cobra. Nulo en pedidos de tienda.';
```

`add column` sin default no reescribe ni bloquea; el FK valida sobre 0 filas. `set null` replica
`pedidos_cliente_id_fkey`.

## 3 · El dinero: RPC nueva

`registrarPago` (`src/lib/api.ts:574-610`) **no alcanza**: dos `/consulta` en transacciones
distintas; si falla el segundo insert queda ingreso huérfano con `trg_comision_referido` corrido, y
el pedido no pasa a `completado`. Tampoco verifica propiedad. Todo en una transacción:

```sql
create or replace function public.validar_renovacion(
  p_pedido uuid, p_cliente_id uuid, p_monto_pagado numeric, p_moneda text,
  p_tasa_bcv_aplicada numeric, p_tasa_cambio_binance numeric, p_equivalente_usd numeric,
  p_metodo_pago text, p_fecha_pago date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_pedido pedidos%rowtype; v_corte date; v_pago uuid;
begin
  if not es_admin() then raise exception 'Solo el admin valida renovaciones'; end if;

  select * into v_pedido from pedidos where id = p_pedido for update; -- serializa doble click
  if not found then raise exception 'Pedido % inexistente', p_pedido; end if;
  if v_pedido.suscripcion_id is null then raise exception 'No es una renovación'; end if;
  if v_pedido.estado <> 'nuevo' then return null; end if;            -- idempotencia

  select fecha_corte_cliente into v_corte from suscripciones
   where id = v_pedido.suscripcion_id and cliente_id = p_cliente_id;
  if v_corte is null then raise exception 'La suscripción no es de ese cliente';
  elsif p_fecha_pago < v_corte
     then raise exception 'Corte % vigente: retroactivo no suma días', v_corte; end if;

  insert into pagos_ingresos (cliente_id, monto_pagado, moneda, tasa_bcv_aplicada,
      tasa_cambio_binance, equivalente_usd, metodo_pago, fecha_pago)
  values (p_cliente_id, p_monto_pagado, p_moneda, p_tasa_bcv_aplicada,
      p_tasa_cambio_binance, p_equivalente_usd, p_metodo_pago, p_fecha_pago)
  returning id into v_pago;

  insert into pago_suscripciones (pago_ingreso_id, suscripcion_id, monto_asignado_usd)
  values (v_pago, v_pedido.suscripcion_id, v_pedido.monto_cobro); -- dispara los dos triggers

  update pedidos set estado = 'completado' where id = p_pedido;
  return v_pago;
end $$;
```

La fila correcta de `pago_suscripciones` la aseguran el FK + el chequeo de propiedad: el admin no
elige suscripción, la trae el pedido. Frente: botón "Validar y renovar" en `src/pages/Pedidos.tsx`
hacia `validarRenovacion` en `api.ts` (junto a `actualizarEstadoPedido:322`);
`functions/datos/index.mjs:72` → `new Set(['editar_pago','validar_renovacion'])`;
`db/0002_grants.sql:64-65` replica el revoke/grant de `editar_pago`. `registrarPago` intacto.

## 4 · Idempotencia

Índice único total castigaría al cliente legítimo que renueva meses seguidos, así que la guarda del
doble click es parcial:

```sql
create unique index pedidos_renovacion_abierta
  on public.pedidos (suscripcion_id) where estado = 'nuevo';
```

El segundo insert da 23505 → HTTP 409 (mapeo en `index.mjs:~525`) que `errMsg()` muestra; el front
lo trata como éxito suave. Extra: un solo pedido abierto por suscripción, lo que el panel necesita
para no ambiguar. Doble validación del admin: `return null` + `for update`, que bloquea la segunda
transacción concurrente hasta el `commit`. UX: `enviando` deshabilita el botón.

## 5 · Cuándo NO renovar por adelantado

Leído `db/0001_esquema_negocio.sql:212-246`: `greatest(coalesce(fecha_corte_cliente, v_ppago),
v_ppago) + v_dias` acumula bien hacia adelante (corte 2027 + mes → 2027+30, no se corre mal). Sí
duelen tres casos:

1. **Retroactivo**: `fecha_pago` anterior al corte vigente → `greatest` devuelve el corte y la plata
   no suma días. Con cortes a años vista es lo esperable; lo corta la excepción de §3.
2. **Vencida hace rato**: corte 2026-10-20 pagado hoy → 2026-12-29; los 40 días sin servicio se los
   come el cliente. Correcto, pero hay que decirlo en pantalla.
3. **Cuenta madre vencida**: el trigger ignora `fecha_corte_proveedor` y puede dejar `activa` un
   cupo muerto.

Regla: `/renovar` muestra corte actual y corte quedará, y deja declarar solo si
`dias_restantes <= 15`. Google One (plataforma `activa=false`, 10 suscripciones) queda fuera del
self-service: se renueva a mano.

## 6 · Archivos y orden

| # | Archivo | Línea | Cambio | Verificación |
|---|---|---|---|---|
| 1 | `db/0004_cliente_renueva.sql` | nuevo | vista, FK, índice, política, RPC | rama Neon, nunca producción primero |
| 2 | `db/0002_grants.sql` | 64-65 | grant vista + execute RPC | `select relacl from pg_class where relname='v_mis_suscripciones'` |
| 3 | `db/0001_esquema_negocio.sql` | 400, 1077 | espejar columna y política en el dump base | montaje en blanco `psql "$NUEVO" -X -v ON_ERROR_STOP=1 -f db/0004_cliente_renueva.sql` |
| 4 | `functions/datos/index.mjs` | 72-73 | `RPC_PERMITIDAS` | `curl -X POST $URL/rpc -H "Authorization: Bearer $(cat /tmp/.token-datos)" -d '{"fn":"validar_renovacion","args":{...}}'` |
| 5 | `src/lib/api.ts` | tras 322 | `fetchMisSuscripciones`, `crearRenovacion`, `validarRenovacion` | `npm run typecheck` |
| 6 | `src/lib/types.ts` | 45-69 | `Pedido.suscripcion_id?` | idem |
| 7 | `src/pages/Renovar.tsx` | nuevo | pantalla declarativa | sesión de cliente de prueba |
| 8 | `src/App.tsx` | 25, 60 | `lazy(Renovar)` + ruta pública | `Inicio.tsx:145/250` dejan de rebotar |
| 9 | `src/pages/Pedidos.tsx` | 20-27, 51-59, 91 | badge "renovación", botón validar | panel admin |

Orden 1-3 en rama → verificar → producción → 4 → contrato → 5-8 → 9. Revisión SQL: `\d+ pedidos`,
`select polname, pg_get_expr(polqual,polrelid) from pg_policy`, `set role authenticated; select *
from v_mis_suscripciones` con JWT de cliente.

Negocio respetado: ningún camino del navegador escribe `pago_suscripciones` sin pasar por
`es_admin()`. El cliente declara, el admin valida, el trigger renueva.

## Riesgos cerrados con la rama `prueba-renovar` (2026-11-25)

Todo esto se ejecutó en la rama de Neon `br-quiet-heart-bdt9vwyl` y se comparó después
contra `main`: los siete objetos salieron **byte a byte idénticos** (`diff` de
`pg_get_viewdef`, `pg_get_functiondef`, `pg_indexes`, `pg_policy`).

| Lo que estaba en duda | Resultado medido |
|---|---|
| ¿`security_invoker` + `admin_acceso_total` bloquean al cliente? | Sí, y también al admin. Sin la política de auto-lectura la vista da 0 filas. Con ella: 2 del cliente sobre 18 totales. |
| ¿`anonymous` sobre la vista? | `permission denied for view v_mis_suscripciones`. Ni llega a la tabla. |
| ¿El índice parcial frena el doble click? | Sí: el segundo insert da `duplicate key ... pedidos_renovacion_abierta`. |
| ¿Un cliente puede meter un pedido contra suscripción ajena? | No: `new row violates row-level security policy for table "pedidos"`. Habría que poder, y con el índice parcial le bloqueaba la renovación al dueño real de esa suscripción. Por eso se reemplazó `cliente_crea_su_pedido`. |
| ¿`validar_renovacion` suma los días exactos? | Canva Pro 180 días: corte 2027-10-05 → 2028-04-02. Pedido a `completado`, `monto_asignado_usd` = 9.69 (el del pedido, no lo que se pagó). |
| ¿Revalidar el mismo pedido? | Devuelve `NULL` y el corte no se mueve. Cero ingresos duplicados. |
| ¿Cliente (no admin) llama la RPC? | Levanta `Solo el admin valida renovaciones`. |
| ¿`anonymous` llama la RPC? | `permission denied for function`. |
| ¿Comisiones tras el arreglo de `editar_pago`? | Se recalculan: 9.69 → 2.91 y, al cambiar el monto a 15.00, → 4.50. |

**El defecto de `editar_pago`, confirmado con números.** Con la versión anterior de la
función, editar un pago ya validado movió el corte de 2028-04-02 a **2028-09-29**: los
mismos 180 días sumados dos veces por la misma plata. Con la versión nueva el corte se
queda en 2028-04-02 y el monto reasignado sí cambia (10.68). No tocamos el trigger, que
está bien: el culpable es el borrado-e-reinserción de `editar_pago` contra un trigger
`AFTER INSERT`.

## Lo que NO se pudo probar y lo que sigue abierto

- **El vocabulario de `pagos_ingresos` no coincide con el del checkout.** La tabla solo
  acepta `metodo_pago` en `Zelle | Pago Movil | Pago Movil Binance | Binance | Transferencia | Otro`,
  y `moneda` en `USD | BS | USDT`. `src/lib/pagos.ts` ofrece `usdt | usdc | zinli | binance | pagomovil`.
  USDC y Zinli no tienen dónde anotarse, y `Pago Móvil` (con tilde) no es `Pago Movil`.
  Un `validar_renovacion` con `metodo_pago='usdt'` revienta por CHECK, no por permisos:
  pasó en la rama a la primera. Es un defecto previo a esta migración (`registrarPago`
  tiene el mismo muro), y las 6 filas existentes son todas `Pago Movil`/`BS` porque el
  panel de Pagos usa el vocabulario correcto. Se resuelve mapeando en el front, no
  aflojando el CHECK; eso decide el dueño.
- **La comisión por referido está inerte.** Solo `Google One` y `Google One 5 TB` tienen
  `aplica_comision = true`, y las dos están `activa = false` desde 0005. Ningún cliente con
  `referido_por` tiene suscripción en plataforma comisionable: 0 filas en `comisiones`.
  Hubo que poner `aplica_comision = true` en Canva Pro, temporalmente y en la rama, para
  probar el recálculo.
- **La tasa BCV está vieja 66 días.** `tasas_cambio` tiene UNA fila: 2026-09-20, 42.50, y
  `tasa_eur_bs` nula. Mientras no exista el trigger `tasas-y-vencimientos`, la landing no
  puede publicar un "hoy" en bolívares y el checkout calcularía Pago Móvil con la tasa de
  septiembre. La landing ya no publica el número (dice que se confirma antes de transferir).
- Ventana de 15 días sobre los datos reales: 4 suscripciones de 16 activas están adentro
  (4 clientes), 12 afuera. Google One 5 TB tiene 10 activas a 445–1026 días; salen de la
  landing pero la vista sí las devuelve, así que el admin las valida a mano si hace falta.
