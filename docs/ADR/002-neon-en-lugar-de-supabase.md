# ADR-002 — Neon (Lakebase Postgres + Functions) en lugar de Supabase

- **Estado**: Aceptado (2026-11-10)
- **Sustituye a**: [ADR-001](001-backend-como-servicio.md) (Supabase como BaaS), que queda como referencia histórica.
- **Decisión**: mover el proyecto a **Neon** — Lakebase Postgres gestionado, **Better Auth self-hosted** dentro de una Neon Function y **Neon Functions** para la API de datos y las automatizaciones — con el front servido desde GitHub Pages en `plans.blink.com.ve`.

## Contexto

No es un cambio de proveedor por moda. Tres presiones concretas, más una promesa que no se puede romper:

- **Cuesta dinero donde no genera valor.** El plan Pro de Supabase se paga por volumen de datos y por las instancias que corren aunque nadie las use. El panel lo abren cuatro personas por semana.
- **El esquema vive atado al proveedor.** `auth.users`, `auth.uid()`, `cron.job` y la `service_role` son Supabase; nada de eso es portable y todo eso está en el medio de cada cambio de modelo.
- **Hay que bifurcar la base para probar.** Un ambiente de pruebas contra la base real de clientes que pagan no es un ambiente de pruebas.
- **La promesa que no se rompe**: ningún cliente restablece su contraseña. Los hash son bcrypt de GoTrue y solo un proveedor que deje escribir en la columna de contraseñas permite verificarlos y migrarlos en el primer login correcto.

Con esa última restricción sobre la mesa, se hizo un **piloto de siete experimentos medidos** (rama `piloto-neon`, `piloto/RESULTADOS.md`) **antes** de tocar un solo dato real, con un criterio de corte explícito: si los experimentos 1, 2, 6 o 7 fallaban, la migración se abandonaba y se volvía al plan original. **Pasaron los siete.** Este ADR registra lo que se decidió después de medir, no antes.

## Opciones consideradas

1. **Quedarse en Supabase** — cero riesgo de migración, pero mantiene el coste, el lock-in de esquema y el problema de los ambientes de prueba.
2. **Neon con Managed Better Auth** — la vía «oficial» y la que menos código propio exige.
3. **Neon con Better Auth self-hosted en una Function** — se controla la columna `account.password`, que es lo que hace falta para la promesa de las contraseñas.
4. **Neon Postgres + servidor propio (Fly, VPS, etc.)** — portabilidad total, pero hay que mantener un servidor, TLS, despliegue y escalado.

## Decisión

**Opción 3.** Con dos ajustes que salieron de medir y no de leer:

**a) Nada de Managed Better Auth.** La documentación de Neon dice que las cuentas con contraseña propia **no son migrables** a Managed Better Auth. Es exactamente el caso de este proyecto, así que self-hosted no es la opción barata: es la única que cumple la promesa. El config vive en `functions/auth/index.mjs` y su comportamiento crítico está cubierto por `piloto/sonda-bcrypt.mjs`.

**b) Nada de Data API para tráfico autenticado.** El piloto midió que la Data API de Neon, con un proveedor de JWKS externo, **alterna 200 y 400 `jwk not found` con el mismo JWT válido**, sin que nada del repo lo controle: en la ventana de 8,5 minutos con 8 fallos, la Function de auth recibió 2 invocaciones — ambas del experimentador. La Data API **no re-consulta** el JWKS; solo un `DELETE` + `POST` del proveedor lo re-primaba, con unos 2 minutos de propagación. La consecuencia de diseño es que hay **un solo camino de datos**: la Function `datos`, que verifica nuestro JWT HS256, hace `set local role` dentro de una transacción y deja decidir a RLS. Tener dos caminos —PostgREST para lo público y Functions para lo autenticado— habría significado dos clientes, dos vistas de permisos y dos superficies de error en un panel que mueve plata.

## Consecuencias

**Positivas**

- Ramas de Neon = la base **y** las Functions se bifurcan juntas; cada ambiente de prueba tiene su propia URL y sus propios datos. `esquema-base` es hoy ese ambiente.
- RLS sigue siendo la capa de autorización: el compilador de `datos` no decide permisos, los decide la base, con las mismas políticas heredadas del esquema viejo. Promover o degradar un admin sigue siendo un `UPDATE` de una columna.
- Scale to zero: el panel no cuesta compute cuando nadie lo usa. La cadencia diaria sale de Function Triggers, no de instancias encendidas.
- La contraseña nunca se restablece: bcrypt se verifica y se reescribe a scrypt en el mismo request del primer login correcto. Medido: `32 hex + ':' + 128 hex` escrito en `account.password`, segundo login con la misma clave en 200 y sin re-hash en bucle.
- El bundle del front no lleva ninguna clave compartida: se fue `VITE_SUPABASE_ANON_KEY` y con ella la última credencial publicable.

**Negativas / costes**

- **Cuatro componentes propios en vez de cero**: el cliente de sesión, el builder de datos con forma de supabase-js, el compilador de consultas a SQL y el config de Better Auth. Cada uno es superficie que hay que mantener y revisar en cada upgrade.
- **La autorización se prueba, no se hereda.** Con PostgREST, RLS se ejercitaba solo en cada request; aquí hay que verificar que `datos` manda el rol correcto y que el SQL compilado no se desvía. Por eso el repo conserva sondas y por eso `piloto/sonda-bcrypt.mjs` corre contra las Functions desplegadas, no contra un config exportado.
- **El runtime de la Function no es un navegador y no es la máquina local**: `nodejs24` desplegado frente a Node 22 en dev. Cualquier cosa que dependa de la versión de Node se comprueba en la rama.
- **Vendor lock-in de otro tipo**: `neon.ts`, las URLs de Function por rama y el modelo de branches. Menos extenso que el de Supabase (no hay `auth.*` ni `cron.*` en el esquema), pero real.

## Riesgos aceptados, por escrito

- **Registro sin verificación de correo** (`requireEmailVerification: false`, heredado del panel viejo porque montar SMTP es otra fase). Cualquiera que sepa un correo puede crear una cuenta. Lo que no obtiene es privilegios: la fila de negocio nace con `rol='cliente'` y sin teléfono. La señal de abuso es `select count(*) from public.usuarios group by dia`.
- **Las tablas de Better Auth viven en `public`**, no en un esquema propio. Se midió que `database.schemaName` no separa nada: ni el CLI al migrar ni el runtime al consultar, que usa nombres sin cualificar por `search_path`, y el endpoint pooler rechaza `search_path` en el paquete de arranque. La protección real es la lista blanca de recursos de `datos`: `user`, `account`, `session` y `verification` no están entre lo que el front puede consultar.
- **El scrape del BCV es un punto frágil externo**: hay que fijar la cadena de CA porque el BCV no envía el intermedio (Sectigo R36), y no hay respaldo de tasa. El panel puede quedarse sin tasa nueva si el sitio cambia de formato; se detecta por `select max(fecha) from tasas_cambio`.

## Mediciones que sostienen las decisiones de esta migración

No son notas de diseño: son resultados obtenidos ejecutando contra la rama.

- `SET LOCAL x = $1` es **42601**; hay que usar `set_config($1, $2, true)` (is_local=true es el equivalente exacto).
- `RETURNING` no admite alias de tabla ni subconsultas: el fragmento de fila se construye sin cualificar y los embeds en RETURNING se rechazan con mensaje explícito.
- Las claves de `jsonb_build_object` son **literales de texto**, no identificadores (42703 `column "usuarios" does not exist`).
- Los numéricos hay que emitirlos con `::text` para conservar la forma que el front ya compara (`"6.00"`, no `6`).
- `information_schema.parameters.specific_name` lleva sufijo de oid (`editar_pago_25365`), por eso parecía que la RPC no existía: se busca por `routines.routine_name`, y los parámetros `json`/`jsonb` exigen `JSON.stringify` (22P02).
- `cors.origin` **no** alimenta la comprobación de origen de Better Auth: `validateFormCsrf` fuerza `validateOrigin` en cuanto el request trae cabecera `Origin`, y la compara solo contra `trustedOrigins` + el origen de `baseURL`. Sin `trustedOrigins`, todo login cross-origin devuelve 403 INVALID_ORIGIN — local funcionaba, producción habría roto.
- El plan Free no puede desactivar scale-to-zero y `pg_cron` con scale-to-zero no dispara: las automatizaciones pasan a Function Triggers.
- `--cron` se interpreta **en UTC** (medido con un trigger a `*/1 * * * *`: tres entregas registradas a 14:59, 15:00 y 15:01Z, cada una con su `invocation_id`, cero reentregas).
- **Un redeploy no recicla un isolate caliente.** Declarar tarde `BLINK_DATA_JWT_SECRET` para `tasabcv` dejó el POST manual devolviendo 500 «BLINK_DATA_JWT_SECRET falta» incluso con `current_deployment` ya en la versión 2 y la variable listada en su `environment`. El 200 llegó después, cuando el isolate se quedó frío. Regla práctica: tras cambiar `env`, la verificación se hace en la siguiente ventana de arranque en frío.
- La verificación del alta también exige que la Function tenga el secreto: el `POST /token` de `auth` y la comprobación de `datos` comparten `BLINK_DATA_JWT_SECRET`, **distinto** de `BETTER_AUTH_SECRET`, para que un secreto no sea punto de fallo de login y de datos a la vez.

De la Fase 4 (importación de datos, medida contra un simulacro en `db/importar/fixtures/`):

- **Los roles `authenticated`/`anonymous` eran un efecto lateral de la Data API**, no del esquema. Al apagarla, una base Neon recién creada no tiene ninguno: `ERROR: role "authenticated" does not exist`, y sin membresía del dueño el `set local role` de `datos` contesta 42501 — o sea la capa de datos entera caída. `CREATE ROLE` y `GRANT rol TO current_user` **sí** están permitidos al dueño de la base, así que `db/0000_auth_uid.sql` los provisiona. La rama del piloto no lo delató porque ya los tenía resueltos a mano.
- **`SET session_replication_role = replica` está denegado** (`permission denied to set parameter`), porque Neon no da superusuario — y es justo lo que usan `pg_restore --disable-triggers` y el truco clásico para saltarse disparadores. El sustituto que sí funciona siendo dueño de la tabla es `ALTER TABLE … DISABLE TRIGGER`, con la lista sacada del catálogo (`not tgisinternal`) y reactivación en `trap … EXIT` para que ocurra también cuando la restauración falla.
- **`pg_restore` sin `--single-transaction` convierte un traslado en una recalculación a medias.** Con los disparadores despiertos, `trg_cupos_after_insert` suma `cupos_ocupados` sobre el valor histórico que trae el propio volcado y revienta el cupo: `COPY falló para la tabla «suscripciones»`, y `pago_suscripciones` se cae después por FK. No hay transacción que revierta: el resto de las tablas entra y esas dos quedan **vacías** (medido: `suscripciones = 0` en el destino). pg_restore lo llama «precaución: errores ignorados durante la recuperación: 2». Con `pg_restore` 18.6 el exit status de ese caso **sí** es 1 — pero no es un control de integridad: correrlo dentro de una tubería (`pg_restore … | tail`) devuelve el código de `tail`, y así fue como esta migración lo leyó 0 la primera vez y anotó «éxito». Por eso `volcar.sh` restaura en una sola transacción y termina comparando filas, ids y sumas con `verificar.sql`.
- **Better Auth 1.7.19 busca el correo en minúsculas con comparación exacta** (`api/routes/sign-in.mjs:317` → `findUserByEmail(email.toLowerCase())`; `db/internal-adapter.mjs:611` → `where: [{value: email.toLowerCase(), field: "email"}]`, sin `lower()` en SQL), y `/sign-up` lo almacena normalizado (`api/routes/sign-up.mjs:158`). Una identidad del proyecto viejo importada como `Maria@Blink.com.ve` **no puede entrar nunca**, escriba como escriba su dueño. El importador normaliza al escribir, aborta sin tocar nada si dos correos chocan al normalizar, y comprueba después que ningún `user.email` conserve mayúsculas.
- **`CREATE SCHEMA public` pelado corta el montaje de una base vacía** (42P06, porque Neon ya lo tiene y es de `pg_database_owner`): `db/0001` salió de `pg_dump --schema-only` y lo heredó literal. Es `CREATE SCHEMA IF NOT EXISTS`.

## Verificado el día del cierre

`piloto/sonda-bcrypt.mjs` contra las tres Functions **desplegadas** en `esquema-base`: 10/10 en verde (bcrypt verifica, re-hash a scrypt con la forma nativa, segundo login sin re-hash en bucle, `/token` → `/consulta` con RLS dejando ver la propia fila y 403 al anónimo). Trigger diario `0 22 * * *` creado (`tasas-y-vencimientos`, próxima ejecución 2026-11-10T22:00Z) con el scrape real del BCV escribiendo `tasa_bcv` y `tasa_eur_bs`, y `marcarVencidas()` cambiando de estado una suscripción plantada a propósito y restaurada después.
