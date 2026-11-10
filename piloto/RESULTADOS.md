# Piloto de verificación Neon — Fase 3 (gate)

Rama `piloto-neon`, proyecto `plans-pilot` (`curly-hill-13460111`), rama de piloto
`br-quiet-star-beinsyb9`, región `aws-us-east-2`, base `neondb`.

Cada veredicto es lo que se ejecutó y se midió en esta rama, no lo que la
documentación de Neon promete. Los guiones de prueba quedan en el repo:
`etapa-a.mjs` (experimentos 1–3 por HTTP), `auth-fn/etapa-b.mjs` (6–7),
`funciones/tasa-bcv/` (4–5) y las sondas desechables.

## Veredictos

| # | Experimento | Veredicto |
|---|---|---|
| 1 | RPC por HTTP (`POST /rest/v1/rpc/editar_pago`) | **PASA** |
| 2 | Vistas y embeds (`select=*,proveedores(nombre)`, `count=exact`, `Range`, `!inner`) | **PASA** |
| 3 | Rol anónimo sobre vista pública + tabla privada bloqueada | **PASA** |
| 4 | Function: egress a bcv.org.ve, parse e INSERT | **PASA** (con TLS fijada, ver abajo) |
| 5 | Trigger programado (`--cron`) e idempotencia por `invocation_id` | **PASA** (4 entregas, 0 reentregas) |
| 6 | Better Auth self-hosted en Function, UUID preexistente como identidad, FK de negocio, JWT para la Data API | **PASA** |
| 7 | bcrypt heredado verifica y se re-hashea a scrypt en el primer login | **PASA** |

**Criterio de corte del plan:** «si 1, 2, 6 o 7 fallan, la migración a Neon se
abandona y se vuelve al plan original». Los cuatro pasan con evidencia, y 4 y 5
también. **La migración a Neon sigue adelante.**

## 1 · RPC por HTTP

`editar_pago(uuid, numeric, text)` en plpgsql, invocada con el JWT que minte el
propio proveedor de auth.

- Con sesión autenticada → `HTTP 200` y **efecto real** (devolución
  `{"monto":350.00,"estado":"pagado"}` y relectura independiente por `psql`
  confirma la fila cambiada).
- Con JWT `role=anonymous` → `HTTP 403` con `code: "42501"` y el mensaje propio
  `editar_pago prohibido al anónimo`. La función decide, no la capa REST.

Dos cosas que costaron tiempo y hay que arrastrar a la Fase 4:

- Un `UPDATE … RETURNING` dentro de plpgsql sin `INTO` devuelve `42601 query has
  no destination for result data`. Se resuelve con `declare fila record; … into
  fila;` y `return query select …`.
- El claim que manda el rol es `role`. Sin él la Data API cae en `anonymous`,
  aunque el JWT sea válido y el usuario exista.

## 2 · Vistas y embeds

`v_catalogo_publico` (`security_invoker = true`, join de `planes` con
`proveedores`, filtra `publicado`).

- El embed funciona **solo si la vista es *key-preserving***: tiene que exponer
  la PK de la tabla base y la FK real **sin renombrarlas**. Con
  `p.proveedor_id as proveedor` PostgREST responde `PGRST200 Could not find a
  relationship`; con `p.proveedor_id` a secas responde
  `"proveedores":{"id":…,"nombre":"Proveedor 1"}`.
- `Prefer: count=exact` → `Content-Range: 0-25/26`.
- `Range: 10-…` → 10 filas exactamente.
- `planes!inner(proveedor:…)` sobre la vista → 3 filas, es decir el `!inner`
  atraviesa la vista.
- **Tras cualquier DDL hay que refrescar la caché**:
  `neon data-api refresh-schema --project-id … --branch …`. Sin eso la Data API
  sigue sirviendo el diccionario viejo y los embeds fallan aunque la vista esté
  bien. `NOTIFY pgrst, 'reload schema'` por sí solo **no** hace el efecto.

## 3 · Tienda anónima

- `GET {auth}/token/anonymous` (sin ninguna credencial) → JWT con
  `role:"anonymous"`, caducidad 1 h.
- Con ese token: catálogo público **26 filas**; `pagos` → `42501 permission
  denied for table`. El mismo endpoint, dos destinos, porque deciden RLS y los
  grants.

## 4 · Function con egress (Node 24)

`neon functions deploy tasabcv --src piloto/funciones/tasa-bcv` →
`https://br-quiet-star-beinsyb9-tasabcv.compute.c-9.us-east-2.aws.neon.tech`.

- Runtime real: `process.version = v24.22.1`, 2048 MiB, `DATABASE_URL` inyectada
  (la Function no la declara ni la recibe por secreto).
- Egress genérico: `https://example.com` → `200`, 25 ms desde dentro de la
  Function.
- **El egress a bcv.org.ve no funciona con `fetch` a secas.** El servidor del BCV
  envía el leaf firmado por *Sectigo Public Server Authentication CA DV R36* pero
  **no envía ese intermedio** (manda el antiguo *Sectigo RSA DV Secure Server
  CA*). OpenSSL no persigue el AIA, así que tanto `fetch` como `https.get` con el
  almacén del sistema cortan con `UNABLE_TO_VERIFY_LEAF_SIGNATURE` — medido
  también desde este equipo, o sea que no es un problema de Neon.
  El arreglo que se usó: fijar la cadena (intermedio R36 + raíz R46, certificados
  de CA públicos versionados en `ca-sectigo.mjs`) y llamar con
  `https.get(url, { ca })`. **No** se desactivó la verificación: para un dato que
  mueve plata, una tasa intermediada por un MITM sería un fallo grave.
- Con la cadena fijada: `200`, 139 625 bytes, 163–784 ms de egreso.
- Parse portado del Edge Function viejo: **USD 899,2705 · fecha valor
  2026-11-10**, y el `INSERT` fue real (`efecto:"insert"` la primera vez,
  `"update"` en el upsert posterior; `select * from tasas_cambio` lo confirma).
- Arranque en frío: la primera llamada tras el deploy tardó **0,46 s** de punta a
  punta desde el cliente.
- Aislamiento: varias llamadas seguidas cayeron en el mismo isolate
  (`performance.now()` del módulo no cambiaba). **Un redeploy no recicla un
  isolate caliente**: la nueva versión no se ejecutó hasta que Neon desalojó el
  isolate (~6 min). En producción hay que contar con que el código nuevo tarda en
  verse, o provocar el desalojo.

## 5 · Trigger programado

`neon triggers create --function-slug tasabcv --cron '*/1 * * * *'
--function-path /` → `trigger-b32fe23b…` (luego borrado).

- Cuatro entregas consecutivas a las 10:39, 10:40, 10:41 y 10:42 UTC, recibidas
  entre **0,6 y 1,3 s** después del minuto programado. Cada una ejecutó el scrape
  completo (la fila de `tasas_cambio` quedó actualizada a 10:42:01).
- Forma real de la entrega: `POST` a la URL nativa con
  `{"version":1,"invocation_id":"…","trigger":{"type":"schedule","id":…,"name":…},
  "data":{"scheduled_at":"…"}}` y la cabecera `x-neon-trigger-invocation-id`.
  `parseTriggerDelivery()` de `@neon/functions/triggers` la valida (cabecera vs
  cuerpo) y devuelve `{ok:false, error:'missing_header'|'invalid_body'|
  'invocation_id_mismatch'}`.
- Idempotencia: `piloto_invocaciones` tiene PK sobre `invocation_id` y la escritura es
  `on conflict (invocation_id) do update set reentregas = reentregas + 1
  returning (xmax = 0) as es_insert, reentregas`. Las 4 entregas reales dieron
  **4 filas distintas y 0 reentregas**: Neon no re-entregó en la ventana de
  prueba, así que **la reentrega no se observó de forma natural**. Lo que sí está
  medido es el mecanismo que la absorbe — tres escrituras del mismo
  `invocation_id` en una transacción (`t|0`, `f|1`, `f|2`, una sola fila; hecho
  con `begin…rollback` para no ensuciar la bitácora). La garantía real de Neon es
  *at-least-once*, y con esta forma de escribir el efecto es idempotente.
- Un disparo **no se puede falsificar desde fuera**: el runtime quita la cabecera
  `x-neon-trigger-invocation-id` cuando la manda un cliente. Medido con una ruta
  `/ecos` que devuelve las cabeceras que ve la Function: la cabecera falseada no
  aparece, `parseTriggerDelivery` responde `missing_header`, y el `POST`
  suplantando un `invocation_id` no insertó ninguna fila. Consecuencia concreta
  para la Fase 7: la ruta del trigger es pública pero no suplantable, y la
  verificación seria es `parseTriggerDelivery` (cabecera contra cuerpo), no un
  secreto propio que hay que repartir.
- La ruta de trigger no puede exigir JWT ni secreto: Neon POSTea a la URL nativa
  sin credenciales. La protección es que el `invocation_id` exista y sea bien
  formado, más lo que se decida dentro.

## 6 · Better Auth self-hosted, en Function, con el UUID del proyecto viejo

`piloto/auth-fn/auth.config.mjs` corre de dos formas: en local
(`etapa-b.mjs`, servidor HTTP en `:4000`) y desplegado como Function
(`function.mjs` → `…-blinkauth.compute.c-9…`). El desplegado es el que importa
para la Fase 5.

- `POST /sign-in/email` en la Function → `200` con
  `user.id = 0f1e2d3c-4b5a-9877-6655-4433221100aa`: **el UUID del proyecto viejo
  es la identidad**, sin remapear por email. No hace falta `forceAllowId` porque
  las filas se siembran por SQL; para altas nuevas el `id` lo genera Better Auth.
- Tres restricciones del formato de Better Auth que cambian el SQL de la
  Fase 4 (medidas, no deducidas):
  1. **`user.id` es `TEXT`**, no `uuid`. Una FK `uuid → text` se rechaza con
     `42804 incompatible types`. La solución que pasó: la columna de negocio es
     `text` (guarda el uuid viejo tal cual) y se expone una generada
     `uid uuid generated always as (id::uuid) stored` para seguir join-eando en
    uuid.
  2. Para aceptar un login por contraseña, Better Auth exige
     `account.providerId = 'credential'` **y `account.accountId = user.id`**
     (`better-auth/dist/api/routes/sign-in.mjs:318`). Con `accountId = email` el
     login **nunca** llega a verificar la contraseña y devuelve el aviso
     `INVALID_EMAIL_OR_PASSWORD`, que es un señuelo anti-enumeración: parece que
     el bcrypt falla cuando ni se ejecutó. Al sembrar usuarios migrados hay que
     escribir `accountId = <mismo id>`.
  3. `database.schemaName` **no separa nada**: ni el CLI al migrar ni el runtime
     al consultar (kysely usa nombres sin cualificar por `search_path`), y el
     endpoint pool de Neon rechaza `search_path` en el paquete de arranque. Las
     tablas de Better Auth van en `public`; la protección es no darles `grant`
     (hoy no lo tienen, así que por REST no se leen) más RLS.
- El plugin `jwt` necesita sus opciones **anidadas**:
  `jwt({ jwt: { definePayload } })`. Puestas sueltas se ignoran en silencio y el
  payload sale con el objeto `user` entero, **sin `role`** — y sin `role` la Data
  API trata a un usuario autenticado como anónimo. Con el anidamiento correcto el
  JWT sale `EdDSA` con `role:"authenticated"`, `sub` = el uuid viejo, y `iss`/`aud`
  = el origin de la Function.
- Modo bearer: la cabecera `Authorization: Bearer <x>` se valida contra **el
  token de sesión firmado con el `secret`** (el que Better Auth devuelve en
  `set-auth-token`), **no** contra el JWT. `/get-session` con el token de sesión
  → `200` y el email; con el JWT → `200` y cuerpo `null` (sin sesión). Dos
  credenciales para dos cosas: el token de sesión para Better Auth, el JWT para
  la Data API.
- La Data API acepta nuestro JWT propio tras registrarlo como proveedor
  externo:
  `neon data-api create --database neondb --auth-provider external
  --jwks-url https://…-blinkauth.compute…/api/auth/jwks
  --jwt-audience https://…-blinkauth.compute…`.
  Después: `GET /planes` → `200`, y `POST /rpc/editar_pago` → `200` con efecto
  real, todo con el JWT firmado por nuestro propio Better Auth.
- Reglas de este registro que hay que respetar en producción: **solo puede
  haber un proveedor activo** (los tokens del anterior quedan inválidos al
  cambiarlo, con `401` hasta volver a autenticarse) y `jwt_role_claim_key` es
  obligatorio al tocar la configuración por API.
- Detalle observado y por confirmar: el primer intento tras el cambio devolvió
  `jwk not found` (`400`) y el segundo inmediato `200` — cohete de caché JWKS
  fría. Ver «Caché JWKS» abajo.

## 7 · bcrypt heredado → scrypt, sin reiniciar ninguna contraseña

- Dos usuarios sembrados con hash heredado de Supabase, uno `$2a$` y otro `$2b$`.
- `password.verify` propio: detecta el prefijo bcrypt, compara con `bcryptjs` y,
  **solo si la verificación pasó**, re-hashea al formato nativo con un `UPDATE`
  casado por el hash viejo (dentro de `try/catch`: si el re-hash falla, el login
  NO falla).
- Medido: `login 1 (bcrypt)` → `200`; la fila pasa de `$2a$10$…` a
  `32 hex : 128 hex` (161 caracteres, sin prefijo — el formato nativo real,
  confirmado consultando la tabla); `login 2 (ya scrypt)` → `200`;
  `login con hash $2b$` → `200`; clave incorrecta → `401
  "Invalid email or password"`.
- Better Auth **no re-hashea solo**: sin este `verify` personalizado los hash
  bcrypt se quedan como están, y con un `verify` personalizado tampoco se
  actualizan gratis — lo hace nuestro código.

## Lo que hay que arrastrar a las próximas fases

1. `neon data-api refresh-schema` después de **cada** DDL (Fase 4).
2. Las tablas de Better Auth en `public`, con `id` `TEXT`, sin `grant` para
   `anonymous`/`authenticated` (Fase 4/5).
3. Al sembrar clientes migrados: `account.accountId = user.id` y `accountId =
   'credential'`, un `account` por usuario (Fase 4).
4. `jwt({ jwt: { definePayload } })` con el claim `role`, y `bearer()` para que
   el panel y otros servicios de BLINK llamen con el token de sesión (Fase 5).
5. El origin de producción (`https://plans.blink.com.ve`) registrado como dominio
   de confianza — en el piloto el fallo por no estarlo fue `INVALID_ORIGIN` 403
   (Fase 5/9).
6. Proveedor externo de la Data API con el `jwksUrl` de la Function de auth, y
   `jwt_audience` = ese origin (Fase 5).
7. El scrape del BCV con la cadena de CA fijada (el intermedio R36 que el BCV no
   envía) y sin apagar TLS (Fase 7).
8. Contar con reintentos cortos en la primera llamada tras un deploy o tras el
   expirar de la caché JWKS (Fase 6/7).

## Caché JWKS

(En cursa: se está comprobando si el `jwk not found` del primer intento se
reproduce al expirar la caché, para decidir si el frontend reintenta o se
mantienen las Functions despiertas.)
