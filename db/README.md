# `db/` — el esquema Neon y la importación de los datos reales

Dos cosas viven aquí y no se parecen en nada:

* `0000…0003` — **el esquema vivo**, versionado. Montan una base desde cero.
* `importar/` — **el traslado de los datos** del proyecto viejo (Supabase), y
  un fixture sintético para probarlo sin tocar a ningún cliente.

`supabase/migrations/` (fuera de esta carpeta) NO se ejecuta: es el registro
histórico del proyecto viejo. Cuatro de esas migraciones contienen `INSERT` con
UUIDs fijos de demostración, un `DROP CONSTRAINT` y un `DELETE` que borrarían
datos reales si alguien las corriera encima de la base viva.

## El orden, y por qué ese orden

| # | Archivo | Qué hace |
|---|---|---|
| 0000 | `0000_auth_uid.sql` | crea el esquema `auth` con `auth.uid()`, `auth.role()`, `auth.claim()` sobre `request.jwt.claims` **y los dos roles** `authenticated` / `anonymous`, otorgados al dueño de la base |
| 0001 | `0001_esquema_negocio.sql` | las 12 tablas de negocio, funciones, disparadores, políticas RLS y vistas (`security_invoker = true`) |
| 0002 | `0002_grants.sql` | `GRANT` por rol: `anonymous` solo lee el catálogo público; `authenticated` lee/escribe lo suyo |
| 0003 | `0003_better_auth.sql` | `public.user / account / session / verification`, con `revoke ... from public` para que el hash de clave no sea un dato legible por otro rol |

```bash
for f in db/0000_auth_uid.sql db/0001_esquema_negocio.sql \
         db/0002_grants.sql    db/0003_better_auth.sql; do
  psql "$NUEVO" -X -q -v ON_ERROR_STOP=1 -f "$f"
done
```

Estos cuatro archivos **sí** se pueden correr contra una base vacía, y ahora se
comprueba de verdad: se montó una base nueva de Neon en blanco y salió entera,
con las 16 tablas, los 6 disparadores y las políticas. Costó dos bugs que
ninguna rama existente podía delatar, porque `esquema-base` ya los tenía
resueltos a mano desde el piloto:

1. **Los roles `authenticated` y `anonymous` no los creaba nadie.** Existían en
   la rama del piloto porque Neon los provisiona al encender la **Data API** — y
   la producción ya no usa Data API (ADR-002). En una base recién creada no
   estaba ninguno: `ERROR: role "authenticated" does not exist` en el primer
   `grant` de `0000`. Y sin membresía del dueño, `set local role authenticated`
   de la Function `datos` responde 42501, o sea **toda la capa de datos caída**.
   Ahora `0000` los crea y se los otorga a `current_user` (medido: `create role`
   y `grant` están permitidos al dueño de la base en Neon, y `set role anonymous`
   funciona después).
2. **`CREATE SCHEMA public` a secas.** `0001` es salida de `pg_dump --schema-only`
   y venía con el `CREATE SCHEMA public` pelado; en Neon la base nueva ya tiene
   `public` (es de `pg_database_owner`), así que el montaje se cortaba en la
   línea 47 con 42P06 y no creaba nada. Es `CREATE SCHEMA IF NOT EXISTS`.

## La importación

En dos pasos, cada uno con **informe primero y escritura después**. Ninguno
escribe nada sin `--aplicar`, y las cadenas de conexión se pasan **por entorno**
(argv se lee en `ps` y se queda en el historial del shell).

```bash
export VIEJO='postgresql://postgres.<ref>:<pass>@aws-0-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require'
export NUEVO="$(sed 's|/neondb?|/<base destino>?|' <<<"$DATABASE_URL_UNPOOLED")"

db/importar/volcar.sh                      # 1 · preflight + pg_dump, no restaura
db/importar/volcar.sh --aplicar            # 1 · restaura y verifica paridad
node db/importar/cuentas.mjs               # 2 · informe de identidades
node db/importar/cuentas.mjs --aplicar     # 2 · traduce auth.users → user/account
```

`volcar.sh` mueve **los datos de `public`** (negocio: clientes, suscripciones,
pagos, comisiones, tasas) y `cuentas.mjs` mueve **las identidades**, que son las
tablas `auth.*` de Supabase — esas no se vuelcan porque aquí no existen.

## Siete trampas que este directorio ya midió

### 1 · Restaurar con los disparadores despiertos no es un traslado: es una recalculación

El esquema nuevo hereda del viejo los disparadores que sostienen el dinero —
cupos, comisiones, renovaciones. Si el volcado los deja activos, cada fila
histórica vuelve a *ejecutar la regla de negocio*. Medido en el simulacro, con
el mismo archivo restaurado dos veces:

```
# disparadores activos                                  ← pg_restore «normaleando»
pg_restore: error: COPY falló para la tabla «suscripciones»:
            ERROR:  Cuenta madre sin cupos disponibles (limite 3)
pg_restore: error: COPY falló para la tabla «pago_suscripciones»:
            ERROR:  ... violates foreign key constraint "pago_suscripciones_suscripcion_id_fkey"
pg_restore: precaución: errores ignorados durante la recuperación: 2
            (y deja suscripciones = 0 en el destino)

# disparadores dormidos durante la restauración         ← volcar.sh
✓ idénticas filas, ids y sumas en los dos lados
```

`trg_cupos_after_insert` suma `cupos_ocupados` **sobre el valor histórico** que
trae el propio volcado: con 2 de 3 ocupados y 2 suscripciones activas que
reinsertar, revienta el cupo y aborta `suscripciones`; lo que cuelga de ella
(`pago_suscripciones`) se cae por FK después. No hay transacción que revierta:
el resto de las tablas sí entra, y las dos que importan quedan **vacías**.

Lo peligroso es cómo se comprueba. Sin `--single-transaction`, pg_restore llama
*precaución* a un desastre y sigue de largo. Con `pg_restore` 18.6 medido aquí
el exit status **sí** es 1 — pero esa señal se aplasta sola: correrlo dentro de
una tubería (`pg_restore … | tail`, `| tee`, lo que sea que se hace para leer
salida corta) devuelve el código de `tail`, y así fue exactamente como este
guion lo leyó **0** la primera vez y anotó «migración exitosa». Un exit status
que depende del versionado del cliente y del shell que lo rodea no es un control
de integridad. `volcar.sh` no confía en él: usa `--single-transaction` (si algo
falla se revierte **todo**, no se queda a medias) y termina con el `diff` de
`verificar.sql`, que es lo que de verdad prueba que los datos están.

### 2 · En Neon no hay forma de desactivar los disparadores «como siempre»

`pg_restore --disable-triggers` y `SET session_replication_role = replica`
necesitan superusuario, y Neon no lo da:

```
SET session_replication_role = replica;
ERROR:  permission denied to set parameter "session_replication_role"
```

Lo que sí funciona siendo el dueño de la tabla es `ALTER TABLE … DISABLE
TRIGGER`, que es lo que hace el script — con la lista sacada del catálogo
(`not tgisinternal`), no a mano, para que un disparador nuevo no se quede sin
dormir. Se reactivan con `trap … EXIT`, o sea también cuando la restauración
falla.

### 3 · Los correos del viejo vienen con mayúsculas, y eso es un bloqueo de acceso

Better Auth 1.7.19 (medido en `db/internal-adapter.mjs:611` y
`api/routes/sign-in.mjs:317`): el login busca `where email = <entrada.minúsculas>`
— comparación **exacta**, no `lower(email) = lower(email)`. Y `/sign-up` guarda
el correo en minúsculas. Una identidad importada como `Maria@Blink.com.ve` no
puede entrar **nunca**, escriba como escriba. `cuentas.mjs` normaliza al escribir
y, si dos cuentas del viejo chocan al normalizar, se para sin escribir nada:
adivinar cuál era la real es peor que preguntar.

### 4 · `account."accountId" = user.id` no es decorativo

Sin esa igualdad, con un solo `account` de `credential` por usuario, el SignIn
responde `USER_NOT_FOUND` aunque el bcrypt esté perfecto (piloto,
`RESULTADOS.md` → «lo que hay que arrastrar», punto 3). El importador lo escribe
así y lo comprueba después, junto con que el bcrypt viajó byte a byte.

### 5 · El host directo del viejo es IPv6-only, y desde esta máquina no hay ruta

`db.xbmewcmpfnligeodggop.supabase.co` responde **solo con AAAA** (medido:
`getent ahostsv4` no devuelve nada, `ahostsv6` sí) y esta máquina no tiene
salida IPv6 (`ip -6 route get …` → `Network is unreachable`). Con la cadena de
conexión «la de siempre» del dashboard, `volcar.sh` corta en el preflight con

```
psql: error: connection to server at "db.xbmewcmpfnligeodggop.supabase.co" failed: Network is unreachable
```

que se lee como «la base está caída» o «el firewall me bloquea» y no es ninguna
de las dos: es la familia de direcciones. El camino que sí llega es el **pooler
de sesión**, que tiene registro A — `aws-0-us-west-2.pooler.supabase.com:5432`,
usuario `postgres.<ref>` (lo documenta `docs/03-integraciones.md`) — y desde ahí
el servidor contesta hasta el `password authentication failed`, que es un
problema de credencial y no de red. La diferencia importa porque el primer
mensaje te hace esperar caído algo que está levantado.

### 6 · `volcar.sh` y `cuentas.mjs` no hablan el mismo TLS, y el viejo solo lo delata a él

Los dos pasos apuntan a la misma base con dos clientes distintos: `volcar.sh` usa
libpq (`psql`/`pg_dump`), donde `sslmode=require` **cifra sin validar la cadena de
certificados**; el driver `pg` de Node, desde pg v8, convierte `require` —y `prefer`
y `verify-ca`— en `verify-full`. El pooler de sesión de Supabase presenta un
intermedio auto-firmado, así que el paso 2 reventaba antes de leer una sola fila:

```
volcar.sh   →  ✓ datos restaurados, paridad verificada          (libpq: cifra y va)
cuentas.mjs →  Error: self-signed certificate in certificate chain
               code: 'SELF_SIGNED_CERT_IN_CHAIN'                 (Node: verifica)
```

El simulacro no podía verlo: sus dos extremos son bases de Neon, y Neon trae cadena
de CA pública. El arreglo es `uselibpqcompat=true` en la conexión del viejo, que es
literalmente lo que el propio aviso de Node recomienda, y deja el destino
verificando como antes. La lección de forma: **un traslado entre dos sistemas solo
queda probado cuando se prueba contra los dos sistemas reales**, no contra dos
copias del mismo.

### 7 · `auth.identities.credentials` no existe en todos los GoTrue

El hash se busca en tres sitios (`users.encrypted_password`,
`identities.identity_data`, `identities.credentials`). El proyecto viejo medido el
2026-11-25 tiene `identities` con `provider_id, user_id, identity_data, provider,
last_sign_in_at, created_at, updated_at, email, id, instance_id` — **sin
`credentials`**—, y referirla a pelo cortaba el informe entero:

```
error: column i.credentials does not exist   (42703)
```

Irónico: el hash sí estaba, en `auth.users.encrypted_password`, o sea en el primer
de los tres sitios. El script ya preguntaba al catálogo por `is_sso_user` y
`email_confirmed_at` en `auth.users`; ahora pregunta también por `credentials` en
`auth.identities` y arma el `union all` solo si existe. Un informe que se cae por
una columna ausente es peor que un informe que la echa de menos y lo dice.

## El fixture: cómo volver a medir todo esto sin datos de clientes

`fixtures/simulacro-viejo.sql` es una fuente sintética con la forma exacta del
proyecto viejo — `auth.users` + `auth.identities` de GoTrue y las tablas de
negocio —, con los ocho casos que el importador tiene que saber distinguir:
bcrypt en la tabla, bcrypt solo en `identity_data`, bcrypt solo en `credentials`,
correo con mayúsculas, cuenta sin hash, identidad sin fila de negocio, usuario
SSO a descartar y la colisión de mayúsculas (en un archivo aparte porque su
función es cortar el proceso).

```bash
# 1 · rama aparte, y dentro de ella una base por papel
neon branches create --name simulacro-import
neon env pull --branch simulacro-import --file /tmp/sim.env --service postgres
set -a; . /tmp/sim.env; set +a
V="${DATABASE_URL_UNPOOLED}"
url() { sed "s|/neondb?|/$1?|" <<<"$V"; }
psql "$V" -c 'create database sim_viejo' -c 'create database sim_nuevo' \
           -c 'create database sim_sin_dormir'

# 2 · FUENTE: esquema de negocio + la cara de GoTrue sembrada
for f in db/0000_auth_uid.sql db/0001_esquema_negocio.sql \
         db/importar/fixtures/simulacro-viejo.sql; do
  psql "$(url sim_viejo)" -X -q -v ON_ERROR_STOP=1 -f "$f"; done

# 3 · DESTINO: se monta de cero con los cuatro archivos (0000…0003)
for db in sim_nuevo sim_sin_dormir; do
  for f in db/0000_auth_uid.sql db/0001_esquema_negocio.sql \
           db/0002_grants.sql    db/0003_better_auth.sql; do
    psql "$(url $db)" -X -q -v ON_ERROR_STOP=1 -f "$f"; done; done

# 4 · importación real de los dos pasos
export VIEJO="$(url sim_viejo)"
export NUEVO="$(url sim_nuevo)"
db/importar/volcar.sh --aplicar
node db/importar/cuentas.mjs --aplicar --prueba-clave=ClaveReal123

# 5 · la trampa 1, para verla: el MISMO volcado en sim_sin_dormir, sin dormir
#     los disparadores y sin --single-transaction
pg_restore -d "$(url sim_sin_dormir)" --no-owner --no-privileges --data-only \
           "$(ls -t dumps/*.dump | head -1)"
```

`--prueba-clave` solo se pasa aquí: es la clave del fixture, y con datos de
clientes no se tiene ni se debe tener. Sin la opción, la comprobación se omite
y el informe lo dice.

Resultado esperado en el paso 4, y el que se obtuvo: `✓ destino vacío`, `6
disparadores desactivados`, `✓ datos restaurados`, `✓ idénticas filas, ids y
sumas en los dos lados`, luego `6 user / 6 account / 1 usuarios creada` y las
nueve comprobaciones en verde, incluidas `bcrypt.compare …  — 6/6` y
`login simulado … — 6/6`. Al final, `verificar.sql` en el destino da
`suscripciones|3`, `comisiones|1`, `suma|pagos_ingresos.equivalente_usd|5.00`,
los tres invariantes en `0` y los seis disparadores otra vez en `O` (activos).
El paso 5, en cambio, deja `suscripciones` y `pago_suscripciones` en 0 con
`pg_restore: precaución: errores ignorados durante la recuperación: 2`.

> Una lectura intermedia, a medias de un ciclo que estaba a medias, mostró
> `suscripciones` en 0 en «las dos bases de destino». Repetido el ciclo completo
> desde una base vacía con recuento explícito después de cada paso (`tras
> esquema: subs=0 → tras volcar: subs=3 → tras cuentas: subs=3`), no volvió a
> pasar y las firmas de ids coincidieron con el origen. La explicación más
> simple encaja con la lista de bases que hay en la rama: `sim_sin_dormir`
> **debe** dar 0, porque es justamente la demo de la trampa 1 — leerla a ella
> creyendo leer el destino bueno produce exactamente ese síntoma. Queda anotado
> porque en una importación real eso es lo que `verificar.sql` existe para
> pillar: el diff se corre **después** de restaurar, contra la base que se acaba
> de restaurar, y nombra la base en cada paso.

## La importación real: ensayada, qué falta

El bloqueo de credenciales se levantó el 2026-11-25: la contraseña de base no era
la que se había pasado antes, y con la correcta el pooler de sesión responde
(`PostgreSQL 17.6`, `2 auth.users` legibles). Desde ahí el traslado entero **ya está
ensayado contra los datos verdaderos**, en una rama desechable de `main`
(`import-a-real`), sin escribir en `main`:

```
preflight    : 11 tablas de origen / 16 de destino · ✓ destino vacío
volcado      : 12K · pg_dump avisa FK circulares en «usuarios», inofensivo
               porque los disparadores del destino duermen durante la restauración
restauración : 6 disparadores desactivados → ✓ datos restaurados → reactivados
paridad      : una sola diferencia → pedidos|0| (se explica abajo)
cuentas      : 2 user / 2 account · 9 comprobaciones en verde · 2 bcrypt byte a
               byte · 0 emails con mayúsculas · 0 descartes · 0 ya existentes
```

Las cifras, para cotejarlas a mano contra el panel viejo antes de tocar `main`:
`usuarios 19 · suscripciones 17 · pago_suscripciones 6 · pagos_ingresos 6 ·
planes 11 · cuentas_madre 5 · plataformas 4 · proveedores 1 · tasas_cambio 1 ·
comisiones 0 · pagos_egresos 0` — 70 filas, con
`pagos_ingresos.equivalente_usd = 53.57`, `cuentas_madre.cupos_ocupados = 16`,
`tasas_cambio.tasa_bcv = 42.5000` y los tres invariantes en `0`.

`pedidos|0|` no es datos que falten: es una tabla que el esquema nuevo tiene y la
**producción del viejo nunca tuvo**. `0011_pedidos_y_ajustes_catalogo.sql` existe en
el historial del repo pero jamás corrió contra `xbmewcmpfnligeodggop`, así que
`verificar.sql` la nombra en el destino y no puede nombrarla en el origen. En un diff
de paridad una tabla extra vacía es ruido: se lee «el destino tiene una tabla más»,
no «falta algo».

Lo que queda es la decisión de fondo, no el mecanismo: correr estos mismos comandos
contra la rama `main` de Neon — hoy **literalmente vacía**: 0 tablas, 0 disparadores,
0 roles — y después el despliegue de la Fase 9. La cadena de conexión del viejo
**nunca** se escribe en el repo: vive en `~/.config/blink-plans/viejo.env` (modo 600)
y `cuentas.mjs` la lee con `VIEJO_FILE=`, para que ni siquiera pase por `argv`. Los
`dumps/` que genera `volcar.sh` caen en `/dumps/` de `.gitignore`: con datos de
clientes, un volcado es información de terceros y no va a git ni por accidente.
