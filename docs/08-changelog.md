# 08 — Changelog

> Historial de cambios del proyecto. Se actualiza **en el mismo commit** que los
> cambios de código. Formato de líneas: `- [tipo] descripción`
> (tipo: feat / fix / docs / chore / security / refactor).

## 2026-11-25 — Fase 9: las Functions sobre `main` y el CORS que better-auth no pinta

Rama `migracion-neon`. Las tres Functions se desplegaron sobre la rama `main` de
Neon (la de producción), con `.env.local` apuntando a `br-rough-shadow-bdyzi3a5`,
y la identidad de administración se renombró a `admin@blink.com.ve` en la misma
transacción que su fila de `public.usuarios`. La sonda de salud responde
`{"ok":true,"function":"auth","rama":"main"}`.

- **fix** `functions/auth/index.mjs` pinta ahora `Access-Control-Allow-Origin`
  sobre lo que devuelve `auth.handler`. better-auth 1.7.19 resuelve el preflight
  con su opción `cors`, pero **no** agrega la cabecera en las respuestas de sus
  propias rutas: medido en la rama desplegada, `OPTIONS` salía 204 con cabeceras
  y el `401` de sign-in —y el `200` de `get-session`— salían sin ninguna. El
  navegador no puede leer un body sin ACAO, así que el login se veía muerto
  aunque la base hubiera respondido. La Function es la dueña del origen, así que
  lo agrega ella (`conCors`).
- **medido** tras el redepliegue, con `Origin: https://plans.blink.com.ve`:
  sign-in → `http=401` con `access-control-allow-origin: https://plans.blink.com.ve`
  y body `INVALID_EMAIL_OR_PASSWORD`; `get-session` → `http=200` con la misma
  cabecera. El 401 dice dos cosas buenas a la vez: la identidad importada
  resuelve y el bcrypt del viejo compara contra la hash importada.
- **fix** también salió al desplegar: la primera sonda a `/sign-in/email` dio
  404 y se leyó como despliegue roto. Era mi sonda — falta el `basePath`
  `/api/auth` que usa el front (`src/lib/sesion.ts`). Las dos ramas se
  comportaban igual, así que no era regresión de `main` contra `esquema-base`.

- **fix** el error de login salía **en inglés** en el panel español. El mapa de
  `src/lib/sesion.ts` reconocía `Invalid login credentials` e
  `Incorrect email or password`, pero la Function contestaba
  `Invalid email or password` con `code: INVALID_EMAIL_OR_PASSWORD` — ninguna
  coincidencia y el body crudo se pintaba tal cual. Ahora el patrón se prueba
  también contra el `code`, que es lo que no cambia entre versiones.
- **medido** en navegador real contra `https://plans.blink.com.ve`: la raíz
  monta y redirige a `#/login`, y con contraseña errónea la interfaz **leyó** el
  401 de la Function — antes del arreglo CORS ese body era ilegible
  cross-origin. Cero requests fallidos; en consola solo el 401 esperado. Tras el
  fix del idioma, la misma prueba pinta `Correo o contraseña incorrectos`. El
  bundle publicado (`assets/index-q8-lR9y0.js`) es el mismo que salió del build
  local, así que lo que se midió es lo que se construyó.
- **chore** las tres Variables `VITE_BLINK_{AUTH,DATOS,TASA}_URL` del repo
  apuntan a la rama `main` de Neon (`br-rough-shadow-bdyzi3a5-*`); el bundle
  publicado no contiene ni una referencia a `br-long-morning-bdq3ioau` ni a
  `supabase.co` (medido sobre `assets/index-*.js`).
- **docs** el router es `HashRouter`: `/login`, `/panel` devuelven 404 en
  GitHub Pages y **está bien** — el servidor nunca ve esas rutas, viven detrás
  del `#`. Es la razón por la que la redirección del viejo conserva el hash.

## 2026-11-25 — Fase 4: el traslado, ensayado contra los datos reales

Rama `migracion-neon`. El bloqueo de la Fase 4 era una credencial, y resultó ser
**dos cosas distintas**: la contraseña de base no era la que se había pasado, y el
host directo del proyecto viejo sigue sin ser alcanzable desde esta máquina
(IPv6-only). Con la contraseña correcta y el pooler de sesión, el ciclo completo
corrió contra `xbmewcmpfnligeodggop` en una rama desechable de `main`
(`import-a-real`), y `main` no se tocó.

- **fix** `cuentas.mjs` añadía `uselibpqcompat=true` a la conexión del viejo. El
  paso 1 (`volcar.sh`) va por libpq, donde `sslmode=require` cifra sin validar la
  cadena; el `pg` de Node la trata como `verify-full` desde v8, y el pooler de
  Supabase trae un intermedio auto-firmado: `SELF_SIGNED_CERT_IN_CHAIN` antes de
  leer una fila. Con el simulacro no aparecía jamás — sus dos extremos son Neon.
- **fix** `cuentas.mjs` pregunta al catálogo si `auth.identities` tiene
  `credentials` antes de mencionarla. El GoTrue del viejo no tiene esa columna, y
  el informe entero se caía con `42703` mientras el bcrypt sí estaba, en
  `auth.users.encrypted_password`.
- **docs** `db/README.md`: de cinco a **siete** trampas, con las dos nuevas y el
  motivo de forma — un traslado entre dos sistemas solo queda probado cuando se
  prueba contra los dos sistemas reales.
- **medido** origen ↔ destino sin diferencias en las 11 tablas reales: 70 filas
  (`usuarios 19`, `suscripciones 17`, `pago_suscripciones 6`, `pagos_ingresos 6`,
  `planes 11`, `cuentas_madre 5`, `plataformas 4`, `proveedores 1`,
  `tasas_cambio 1`, `comisiones 0`, `pagos_egresos 0`), sumas
  `equivalente_usd 53.57` / `cupos_ocupados 16` / `tasa_bcv 42.5000`, tres
  invariantes en `0`, seis disparadores dormidos y reactivados, y `2 user / 2
  account` con los bcrypt byte a byte y las nueve comprobaciones en verde.
- **docs** La única diferencia del diff, `pedidos|0|`, queda explicada: el esquema
  nuevo tiene esa tabla y la producción del viejo nunca la tuvo — la migración
  `0011` nunca corrió contra ese proyecto. Tabla extra vacía ≠ datos faltantes.

**Cerrado el mismo día**: el ciclo se repitió contra la rama `main` de Neon — que
estaba vacía (0 tablas, 0 disparadores, 0 roles) — con idéntico resultado: `user=2`,
`account=2`, `session=0`, `suscripciones 17`, `usuarios 19`, `usd 53.57`, `cupos 16`,
`tasa 42.5000`, 6/6 disparadores activos y las mismas firmas de `verificar.sql`. La rama
de ensayo se borró después, para no dejar una segunda copia de los hashes de los
clientes. Resetear la contraseña del viejo no cortó el servicio: el panel publicado y su
API siguen en 200 porque hablan por clave anónima, no por contraseña de base.

**Pendiente al cerrar esta entrada**: cotejar a mano esas cifras contra el panel viejo
(el `diff` prueba fealidad del traslado, no que el número coincida con lo que el dueño
recuerda). Y Fase 9 entera: `main` del repo sigue en el estado del piloto
(`migracion-neon` sin mergear), cero Functions desplegadas en la rama de producción, el
repo está **private** y Pages responde 404 — el DNS de `plans.blink.com.ve` ya apunta a
`blink-servers.github.io`, así que el fallo de TLS de hoy es «no hay sitio», no «mal
apuntado».

## 2026-11-10 — Migración a Neon y rebranding Blink Plans

Rama `migracion-neon`. Las fases siguen el plan de migración; lo que está
acá es lo que se ejecutó y midió, no lo que el plan prometía.

### Fases 1–3 · gate de viabilidad

- **feat** Proyecto Neon **aislado** para este panel (no compartido con Pay/POS
  ni con BackOffice), con `neon.ts` como infraestructura declarada: las tres
  Functions (`auth`, `datos`, `tasabcv`) y su env, cada una con su
  `invocation_url` por rama.
- **chore** `piloto/`: los 7 experimentos que decidieron la arquitectura antes
  de escribir una línea de producción — entre ellos la Data API con JWT propio,
  que alterna `200` y `400 jwk not found` con el mismo token válido. Ese
  resultado es la razón por la que **no hay Data API** en la arquitectura.

### Fase 4 · esquema y datos

- **feat** `db/`: el esquema vivo portado a Neon en orden (`0000` roles,
  `0001` modelo de negocio con RLS, `0002` permisos, `0003` tablas de Better
  Auth), más `db/_port_raw.sql` para que el port sea revisable contra el
  original.
- **feat** `db/importar/`: `volcar.sh` (mueve el `public` viejo con los triggers
  dormidos y exige paridad de filas y sumas), `cuentas.mjs` (traduce
  `auth.users`/`auth.identities` a Better Auth conservando UUID y bcrypt) y
  `verificar.sql`. Ambos scripts son **seco por defecto**.
- **docs** `db/README.md` con las cinco trampas medidas, y la corrección de la
  primera: `pg_restore` **sí** sale con código 1 cuando ignora errores de COPY;
  el `0` que se había anotado venía de leer `$?` detrás de una tubería.
- **security** Los volcados nunca se versionan: `supabase/migrations/0002_...`
  guarda la `service_role` en texto plano dentro de `cron.job`.

### Fase 5 · autenticación

- **feat** Better Auth **self-hosted** en la Function `auth`, modo bearer sin
  cookies, con `BLINK_DATA_JWT_SECRET` para acuñar el token de datos (HS256,
  15 min) y la sesión en `sessionStorage`.
- **security** Las contraseñas del proyecto viejo se verifican con bcrypt y se
  re-hashean a scrypt en el primer inicio de sesión correcto: ningún cliente
  tiene que restablecer la suya. Medido con `piloto/sonda-bcrypt.mjs`.
- **fix** El `email` almacenado se normaliza a minúsculas: Better Auth busca con
  `value = email.toLowerCase()` exacto, así que un `A@x.com` importado no
  iniciaba sesión nunca.

### Fases 6–7 · front y automatización

- **feat** `src/lib/db.ts`: el builder con la forma de `supabase-js` registra la
  cadena tal cual y la manda a la Function `datos`, que la compila a SQL
  parametrizado dentro de `begin; set local role …; set_config('request.jwt.claims', …); commit`.
  Las 42 llamadas de `api.ts` no cambiaron; cambió el import.
- **feat** La Function `tasabcv` con su Function Trigger (`0 22 * * *` UTC) para
  la tasa BCV y los vencimientos; `GET /tasa` es la única lectura sin token y
  está documentada como excepción.
- **fix** Guardas de entorno en `db.ts` y `sesion.ts`: sin
  `VITE_BLINK_DATOS_URL` / `VITE_BLINK_AUTH_URL` el bundle llamaba al host
  estático y reportaba un `HTTP 404` que parecía fallo de la base de datos. El
  error ahora dice qué variable falta.

### Fase 8 · marca y grises

- **feat** `src/assets/marca/` con los maestros del ecosistema copiados **byte a
  byte** y `scripts/marca.mjs`, que compone el favicon, los iconos de app y el
  `og.png` (1200×630) y **sale con código 1** si un trazo del isotipo no es
  idéntico al del master. Rasteriza Chromium, no ImageMagick: su delegada SVG
  ignora `currentColor` y los `transform`.
- **feat** Tokens de gris de la casa en `@theme` (`blink-dark`, `blink-muted`,
  `blink-ink-mute`, `blink-line`, `blink-line-strong`, `blink-fill`,
  `blink-fill-strong`, `blink-soft`, `blink-scrim`) con la tabla de
  equivalencias `slate-* → token` en el propio CSS.
- **refactor** Barrido de los 239 grises `slate-*` de los `.tsx` a los tokens,
  con `scripts/grises.mjs` (falla si queda alguno) y revisión visual en
  1440×900 y 390×844 con `scripts/capturas.mjs`.
- **fix** La tinta secundaria pasa a **#6A6A6F**: `slate-400` daba 2,56:1 sobre
  blanco y no pasaba ni el AA de texto grande. `scripts/contraste.mjs` mide las
  tres superficies (5,38 / 5,03 / 4,57) y falla si alguna baja del umbral.
- **fix** `src/index.css` importa Tailwind con `source(none)` y declara
  `@source` sobre `src/**/*.{ts,tsx}` y `index.html`. La detección automática
  leía cadena por cadena todo el repo y reinyectaba en el bundle las clases que
  se **citan** —la tabla de `scripts/grises.mjs`, los comentarios del CSS, este
  changelog—: `.bg-slate-100{}` seguía en el `dist` con cero `slate-*` en los
  `.tsx`, junto a cuatro utilidades fantasma (`contents`, `isolate`, `table`,
  `transform`). Medido comparando el set de selectores antes y después: se van
  las cinco y no se pierde ninguna que el código use; el CSS baja 642 B.
- **docs** Se restaura este `08-changelog.md`, que se había perdido en el
  andamiaje, con el historial del proyecto viejo debajo.

### Pendiente al cerrar esta entrada

La importación real de datos sigue bloqueada por **una credencial que no
cuadra**, y ya está acotado de qué tipo es el bloqueo. Medido desde esta
máquina contra el proyecto viejo:

- El host directo `db.xbmewcmpfnligeodggop.supabase.co` responde solo con AAAA y
  aquí no hay salida IPv6 → `Network is unreachable`. Eso no es la base caída ni
  un firewall; es la familia de direcciones (trampa 5 en `db/README.md`).
- El pooler de sesión `aws-0-us-west-2.pooler.supabase.com:5432`, usuario
  `postgres.xbmewcmpfnligeodggop`, **sí** llega: hay handshake TLS y el servidor
  contesta. Con la contraseña guardada en `~/.config/blink-plans/viejo-db-pass`
  responde `FATAL: password authentication failed for user "postgres"`.

O sea: el camino funciona y lo que falta es el secreto correcto. Sirve cualquiera
de las dos — la contraseña actual del rol `postgres` de ese proyecto (en el
dashboard: Settings → Database → Reset database password) o un Personal Access
Token, con el que además se puede rotar esa contraseña y bajar el volcado desde
`Database → Backups` sin abrir el pooler. El despliegue en la rama por defecto
(Functions + Pages + redirección que conserve el hash) no pide credencial: pide
aprobación del dueño.

## Historial del proyecto viejo (`go-plans/suscripciones`)

Todo lo que sigue debajo es anterior a la migración: las versiones v0.1–v0.5
del panel bajo Supabase y la marca Go Plans. Se conserva tal cual se escribió
en su momento —incluidas las referencias a `app/`, a la `service_role` y a las
Edge Functions, que hoy ya no existen— porque es la única crónica de cómo
llegó el negocio hasta aquí.


## 2026-09-24 — Carrito + checkout con métodos de pago (Pago Móvil, USDT, USDC, Zinli, Binance)

### v0.5.0

- **feat** **Carrito de la tienda**: al comprar un producto ya no se cierra el pedido al instante — el botón "Añadir al carrito" (gift cards y planes) agrega la línea al **carrito** (`/#/carrito`, persistente en localStorage, con cantidades ajustables), y el icono 🛒 de la barra de la tienda muestra el total con su badge.
- **feat** **Checkout** (`/#/checkout`): resumen del pedido, datos del cliente (nombre y teléfono, prellenados con la cuenta), **método de pago** y confirmación. Al confirmar se **registran los pedidos** (una fila por línea, con `metodo_pago`, `moneda_cobro` y `monto_cobro` cotizados) y se **abre WhatsApp** con el resumen completo del carrito y las instrucciones de pago. Sin sesión, el checkout pide crear la cuenta primero (el carrito no se pierde).
- **feat** **Métodos de pago**: **Pago Móvil (Bs)**, **USDT**, **USDC**, **Zinli** y **Binance**. Las **Apple Gift Cards van ancladas al euro**: el Pago Móvil se calcula con la tasa €→Bs (`tasas_cambio.tasa_eur_bs`, migración `0012`) y USDT/USDC/Zinli/Binance cobran **el mismo número que el precio en euros** (3.10 € → 3.10 USDT, etc.). Los planes usan la tasa BCV (USD→Bs) y cobran su precio en USD para USDT/Binance.
- **feat** **Panel admin — Pedidos**: nueva columna **Cobro** con el método y el monto cotizado a cada cliente.
- **feat** `src/lib/pagos.ts`: catálogo de métodos, cálculo de montos por método y `DATOS_COBRO` (instrucciones del negocio, pendientes de los datos reales).
- **docs** changelog, base de datos y flujos de negocio actualizados (migración `0012_carrito_checkout.sql`).

## 2026-09-24 — Pedidos de la tienda + gestor de planes + rediseño de Apple Gift Cards

### v0.4.0

- **feat** **Rediseño de la compra de Apple Gift Cards** (`/#/tienda/apple`): en vez del mosaico de denominaciones, la sección de compra ahora tiene dos columnas — a la **izquierda un selector de diseño** (preview grande + miniaturas de `public/apple/<id>.png`, con placeholder CSS mientras no exista la imagen) y a la **derecha una lista** para elegir el monto con el resumen y el botón Comprar.
- **feat** **Pedidos registrados**: al comprar una gift card o contratar un plan con sesión iniciada se crea un **pedido** (tabla `pedidos`, migración `0011`) con el detalle completo — en las gift cards queda el **monto y el diseño** elegido; en los planes, la plataforma, duración y precio. Enlaces de export: tarifas fijas de gift cards en código (`src/lib/giftcards.ts`), WhatsApp real al 584246603660 con el pedido prellenado.
- **feat** **Botón "Contratar" para todos los planes**: las tarjetas horizontales de Canva Pro / Spotify Premium (y genéricas) ahora tienen botón de contratación igual que Google One (antes solo elegían sin CTA). Sin sesión → registro; con sesión → pedido + WhatsApp.
- **feat** **Panel admin — pestaña Pedidos** (`/#/pedidos`): lista de pedidos con filtros por estado (nuevo/contactado/completado/cancelado), detalle del cliente, swatch del diseño en gift cards, cambio de estado en línea y enlace de WhatsApp al cliente.
- **feat** **Panel admin — gestor de Planes** (`/#/planes`): CRUD de duraciones y precios por plataforma (precio de venta + precio de referencia tachado). La tienda se actualiza al instante porque es 100% de la BD.
- **fix** **Catálogo**: se eliminan los planes ≥ 540 días (el de 18 meses de Google One, ventas puntuales) y **Canva Pro pasa desde 1.99 $/mes** (antes 8.00 $). Ambos cambios en la migración `0011`.
- **docs** `01-resumen`, flujos de negocio y base de datos actualizados.

## 2026-09-23 — Rebrand: la marca queda como "Go Plans"

### v0.3.5

- **feat** **Hero de la portada de la tienda** (`Tienda.tsx`): el título grande pasa a ser **"Go Plans"** (completa el rebrand iniciado en v0.3.4: cabecera con logo "GP" + wordmark "Go Plans" en `BarraTienda`, pies "gestionado por **Go Plans**" y Login del panel ya usan la marca).
- **style** Tipografía **Google Sans** de forma explícita en la marca y los títulos (`font-family: var(--font-display)`, que arranca con "Google Sans Display" / "Google Sans"). Las referencias internas del panel admin (ruta `/suscripciones`, pestaña "Suscripciones", etc.) se mantienen.

## 2026-09-20 — Logos oficiales de Canva y Spotify

### v0.3.4

- **feat** **Logotipos oficiales vectoriales**:
  - **Spotify**: Se reemplazó el icono aproximado y el símbolo `♫` por el isotipo oficial vectorial de Spotify (círculo con las tres ondas de curvatura oficial de la marca) tanto en las tarjetas del catálogo (`Tienda.tsx`) como en la cabecera de la página de la plataforma (`TarjetasHorizontales.tsx`).
  - **Canva**: Se integró el isotipo oficial (la "C" caligráfica distintiva de Canva) en la tarjeta de la tienda y el **wordmark oficial completo de Canva** en vector en el encabezado de `TarjetasHorizontales.tsx` y en la tarjeta de `Tienda.tsx`, acompañado del badge estilizado `PRO`.
- **refactor** Exportación de `WordmarkCanva` en `src/components/tienda/IconosMarca.tsx` y parametrización de fill/color en `IconoSpotify` e `IconoCanvaC`.

## 2026-09-20 — Registro sin verificación de correo

### v0.3.3

- **fix** **Registro sin verificación de correo**: cualquier usuario nuevo queda confirmado al instante (`email_confirmed_at` se fija en el mismo INSERT) y entra **directo a la tienda** nada más crear la cuenta. Ya no aparece "¡Casi listo! revisa tu correo".
- **feat** Migración `0010_auto_confirmar_email.sql`: trigger `trg_auto_confirmar_email` (BEFORE INSERT en `auth.users`) que rellena `email_confirmed_at`/`confirmed_at = now()` si vienen NULL, más la función `public.auto_confirmar_email()`.
- **test** Verificado con signup real vía API y E2E en el navegador: el registro retorna sesión (`access_token`) y redirige a `/#/tienda` con el aviso "¡Cuenta creada con éxito!".

## 2026-09-20 — Tienda tipo catálogo con páginas por plataforma

### v0.3.2

- **feat** **La tienda ahora es un catálogo de productos**: la portada (`/#/tienda`) muestra una tarjeta por plataforma con el **icono de la marca** (G multicolor de Google, logomarca de Canva, círculo de Spotify) y la estética de cada una — Google blanco, Canva morado, Spotify verde — con lema, "Desde $" y botón "Ver planes".
- **feat** **Página de detalle por plataforma** (`/#/tienda/google`, `/#/tienda/canva`, `/#/tienda/spotify`): al pulsar una tarjeta se abre la página con los planes de esa plataforma y el diseño completo de la marca (el hero de Google One, las filas de Canva Pro y Spotify Premium) más un botón "← Tienda" para volver al catálogo.
- **refactor** Cabecera de la tienda extraída a un componente reutilizable `BarraTienda` (con la opción "volver") compartido entre el catálogo y las páginas de detalle.
- **feat** Helpers nuevos en `lib/tienda.ts`: `slugPlataforma` (rutas estables `google`/`canva`/`spotify`), `plataformaPorSlug` (resolución de la ruta) y `taglinePlataforma` (lema corto por marca).
- **feat** Componente de iconos de marca `IconosMarca.tsx` (Google G oficial multicolor, Spotify, C de Canva).
- Las plataformas del catálogo se ordenan siempre Google → Canva → Spotify (y las demás al final).

## 2026-09-20 — Pagos avanzados + Rediseño visual de la tienda

### v0.3.1

- **feat** **Fecha del pago editable**: el formulario de Pagos ahora incluye un campo `fecha_pago` (por defecto hoy, máximo hoy, permite fechas pasadas) para registrar cobros hechos antes de la web. La renovación de suscripciones se calcula desde la fecha del pago.
- **feat** **Moneda automática según método**: al seleccionar método de pago, la moneda se preselecciona sola (Pago Movil→BS, Zelle→USD, Binance/Transferencia→USDT). La moneda sigue siendo editable.
- **feat** **Método "Binance"** agregado a la lista de métodos de pago (requirió migración CHECK). Método "Efectivo" retirado (el negocio no lo usa).
- **feat** **Buscador de cliente** en el formulario de Pagos: escribir nombre o correo filtra en vivo, con componente reutilizable `SelectCliente`.
- **feat** **Filtros en la tabla de pagos**: búsqueda por cliente, filtro por método, por moneda, rango de fechas (desde/hasta), totales filtrados y botón "Limpiar filtros".
- **feat** **Editar y borrar pagos**: botones de lápiz (editar) y basura (borrar) en cada fila. Editar modifica fecha/monto/moneda/método/distribución y recalcula comisión del agente vía la función RPC `editar_pago`. Borrar elimina el pago, sus asignaciones y comisión asociada en cascada.
- **feat** **Límite de pagos** subido de 100 a 500 en `fetchPagos`.
- **fix** **fmtDate corregido**: las fechas tipo date (`YYYY-MM-DD`) ahora se parsean en hora local (mediodía) en lugar de UTC, evitando el desfase de −1 día en Venezuela.
- **fix** **Formato de precios en la tienda**: `precioUsd` ahora muestra `2.99$` (punto decimal, $ al final) en lugar de `$ 2,99`, coincidiendo con el diseño de referencia.
- **feat** **Fuentes tipográficas**: Google Sans (400/500/700) y Google Sans Display (400/500/700) descargadas a `/fonts/` y aplicadas al catálogo de Google One. Canva Sans (Regular/Bold) descargada del zip y aplicada a Canva Pro/Spotify.
- **refactor** **Diseño visual de la tienda** actualizado para coincidir con las imágenes de referencia:
  - Google One: "1 año" con colores de marca Google (azul/rojo/amarillo/verde), tipografía Google Sans Display, comparativa "Pasa de esto → A esto" refinada.
  - Canva Pro: logo "Canva" en estilo itálico/script, "PRO" en mayúsculas, tarjetas horizontales con divisor vertical y badges teal.
  - Spotify Premium: logo "♫ Spotify Premium", tarjetas negras con texto verde, badges blancos, footer con descargo BCV.
- **feat** Migración `0009_pagos_avanzados.sql`: CHECK de `metodo_pago` actualizado (agrega 'Binance', elimina 'Efectivo'), función `renovar_suscripcion_por_pago` reescrita para usar `fecha_pago` del pago (no `current_date`), función RPC `editar_pago` (edición atómica: pago + distribución + comisión).
- **security** Función `editar_pago` validada con `es_admin()` (solo admin puede editar pagos).
- **docs** Pooler de conexión actualizado: `aws-0-us-west-2.pooler.supabase.com:5432` (el host directo `db.<ref>.supabase.co` ya no resuelve).

## 2026-09-20 — Fase 3 · Tienda pública y registro de clientes

### v0.3.0

- **feat** Tienda pública de venta en `/#/tienda` (misma URL del proyecto), con el catálogo real desde `v_catalogo_publico` y tres diseños según la plataforma:
  - **Google One** (tarjetas verticales, estilo Google/Spotify/Canva): hero "5 TB de almacenamiento", comparativa *Antes → Después* (correo lleno vs. 0% en uso) y precios con **referencia tachada** + ahorro (50% / 67%).
  - **Canva Pro** (filas horizontales moradas) y **Spotify Premium** (filas horizontales verdes): una fila por duración (1 mes / 6 meses / 1 año) con precio mensual equivalente y el ahorro real calculado contra el precio mensual.
  - Footer con descargo: los precios van en USD; el equivalente en bolívares se calcula con la tasa oficial del **BCV** al momento del pago.
- **feat** Registro de clientes en `/#/registro` con **nombre, correo, teléfono (opcional) y contraseña** (Supabase Auth `signUp` con metadatos): la BD crea la fila en `usuarios` con `rol='cliente'` vía el trigger `auto_crear_usuario_cliente`. Con la confirmación de correo **activada** (tal como está el proyecto) muestra "¡Casi listo! 🎉 — revisa tu correo"; desactivada entraría directo a la tienda.
- **feat** Página `/#/ingreso` (entrar con correo del cliente) y enlaces "Ingresar / Registrarse" en la cabecera de la tienda.
- **feat** Migración `0007_tienda.sql`: columna `planes.precio_referencia_usd` (precio tachado), vista `v_catalogo_publico` ampliada (logo, duración, precio de venta y referencia; **sin** datos sensibles de inventario/RLS), trigger de registro y políticas RLS del cliente (`cliente_ve_su_fila` / `cliente_edita_su_fila`), más el seed de **Google One** con `aplica_comision`.
- **feat** Migración `0008_catalogo_venta.sql`: precios reales de venta en la BD — **Google One** 2,99 (ref. 5,99)/8,99/11,99 US$ · **Canva Pro** 8,00/39,99/69,99 US$ · **Spotify Premium** 3,49/16,99/28,99 US$. Se **desactiva** "Google One 5 TB" (plan duplicado que solo tenía 365 días) sin borrarlo.
- **security** El bundle **no** contiene la `service_role`: el registro usa solo la anon key + Supabase Auth, y la fila en `usuarios` la crea la BD (trigger), nunca el cliente.
- **refactor** `src/lib/auth.tsx` expone `rol` / `rolCargando` / `perfil`; el guard `Protegida` redirige a `/#/tienda` a todo usuario autenticado que no sea `admin`. El panel admin (Dashboard, Clientes, Suscripciones, Pagos, etc.) queda inalterado y verificado tras el refactor.
- **chore** Lazy loading de Tienda/Registro/Ingreso (chunks propios) y helpers de catálogo en `src/lib/tienda.ts` (`agruparCatalogo`, cálculo de ahorro, formatos es-VE).
- **docs** `02-base-de-datos` (trigger, políticas RLS, vistas y migraciones 0007/0008), `07-despliegue` (rutas públicas y verificación del sitio) y esta entrada.

## 2026-09-20 — Fase 2.6 · Horario del cron de la tasa BCV

### v0.2.6

- **feat** El cron diario `tasas-bcv-diaria` ahora corre a las **18:00 hora de Venezuela** (`0 22 * * *` en BD UTC, que es la configuración por defecto de Supabase) en lugar de las 7:00, para capturar la tasa que el **BCV publica ~16:00 VET** (20:00 UTC). Antes, al correr de madrugada, almacenaba la tasa del día anterior.
- **docs** `02-base-de-datos` y `07-despliegue` actualizados con la equivalencia de zonas horarias y el paso `show timezone;` (si la BD estuviera en `America/Caracas`, usar `0 18 * * *`).

## 2026-09-20 — Fase 2.4 · Tasa oficial del BCV

### v0.2.4

- **feat** La tasa oficial ahora se extrae del **sitio oficial del BCV** (`bcv.org.ve`, bloque USD de la página *Tipo de Cambio de Referencia*), no de dolarapi.com. La Edge Function `fetch-bcv` raspea el HTML oficial (server-side, porque la página del BCV no envía cabeceras CORS) y guarda la tasa con la **Fecha Valor** que publica el BCV en `tasas_cambio`.
- **feat** Botón **"Reflejar tasa"** en Pagos: llama a la Edge Function `fetch-bcv` para reflejar la tasa BCV en vivo (fuente `bcv.org.ve`); si la función aún no está desplegada, cae a la última tasa almacenada en `tasas_cambio` (que también proviene del BCV).
- **docs** `01-arquitectura`, `02-base-de-datos`, `06-desarrollo`, `07-despliegue` y `ADR/001` actualizados: fuente `bcv.org.ve` y notas de CORS/despliegue del parser.

## 2026-09-20 — Fase 2.5 · Mobile-friendly

### v0.2.5

- **feat** Diseño responsive para móviles/tablets:
  - **Navegación**: en pantallas pequeñas la barra lateral se convierte en una barra superior con menú hamburguesa (drawer deslizable con overlay y cierre al navegar); en escritorio se mantiene la barra lateral fija.
  - **Tablas**: el contenedor con scroll horizontal (ya venía con `min-w-max`) evita que las tablas rompan el ancho del viewport.
  - **Modales**: altura máxima 90 vh con scroll vertical interno para formularios largos.
  - **Formularios**: los grids de 2–3 columnas colapsan a 1 columna en pantallas pequeñas (Pagos, Suscripciones, Cuentas madre, planes/cuentas inline).
  - **Login**: ya era responsivo (`max-w-sm` + `px-4`), sin cambios.

## 2026-09-19 — Lanzamiento inicial

### v0.1.0

- **feat** Inicialización del proyecto Vite + React + TypeScript en `app/` (`npm create vite@latest`).
- **chore** Instalación de dependencias (0 vulnerabilidades).
- **chore** Repositorio GitHub privado `go-plans/suscripciones` creado; commit inicial en `main`.
- **chore** Dependencia dev `pg` para scripts de migración por pooler.
- **docs** Estructura de documentación `docs/` creada (estándar docs-as-code) + README raíz.

### Decisiones de seguridad y entorno

- **security** `API KEYS.txt` y `.env` creados fuera del repo con ACL restringido (solo el usuario propietario).
- **security** `.gitignore` endurecido en raíz de repo: `.env`, `.env.*`, `API KEYS.txt`.
- **docs** Documentación de gestión y rotación de claves (`docs/05-seguridad.md`).

### Base de datos (Supabase)

- **feat** Migración `0001_initial_schema.sql`: 11 tablas + 2 vistas + índices + triggers (`trg_comision_referido`, `trg_cupos_*`) + RLS (admin/agente/catálogo anónimo) + función `es_admin`.
- **feat** Migración `0002_automatizaciones.sql`: job cron `vencimientos-diarios` (00:00) + vista `v_vencimientos_proveedores` + template de cron `tasas-bcv-diaria`.
- **feat** Migración `0003_seed.sql`: plataformas ejemplo (Netflix, Spotify, Disney+, Canva, ChatGPT), planes mensuales y tasa BCV del día.
- **feat** Edge Function `fetch-bcv` (Deno) para obtener la tasa BCV desde dolarapi.com y almacenarla en `tasas_cambio`.
- **fix** Corrección de orden de creación de tablas (FK `comisiones → pagos_ingresos`).
- **fix** Uso de `cron.schedule` (el schema correcto es `cron`, no `extensions.cron`).
- **fix** Splitter de ejecución de migraciones: gestión correcta de bloques `$$…$$` (evita `end $$$`).

### Aplicación de migraciones

- **feat** Conexión a Supabase vía **pooler de sesión** (`aws-0-us-west-2.pooler.supabase.com:5432`, usuario `postgres.<ref>`) — la conexión directa es IPv6-only y la red no tiene IPv6.
- **feat** Verificación funcional de la base (transaccional, sin datos persistentes): cupos, comisión 30% y rechazo de sobrecupo, todos ✅.
- **chore** `migracion_completa.sql` (consolidado de 0001+0002+0003 para pegar en SQL Editor) en la raíz `Suscripciones/` (fuera del repo).

## 2026-09-19 — Fase 2 · Panel administrativo

### v0.2.0

- **feat** Panel admin completo en `app/`: Tailwind CSS v4 + `@tailwindcss/vite`, `react-router-dom` v7, `@supabase/supabase-js`.
- **feat** Dashboard con KPIs (clientes, suscripciones activas/vencidas, comisiones pendientes, ingresos del mes) y alertas de `v_vencimientos_proveedores` (≤3 días).
- **feat** CRUD de clientes con campo "referido por (agente)" (trazabilidad de comisiones).
- **feat** CRUD de proveedores y cuentas madre (inventario, suspender/activar, cupos).
- **feat** CRUD de suscripciones (valida cupos disponibles; el trigger `gestionar_cupos_cuenta_madre` rechaza sobrecupo).
- **feat** Página Pagos con **calculadora BCV**: monto, moneda (USD/BS/USDT), tasa del día autocargada, equivalente USD automático, distribución por suscripción activa y "repartir automáticamente"; registro dispara comisión 30% automática.
- **feat** Página Comisiones: listado agente/monto/estado + botón Liquidar.
- **feat** Migración `0004_demo.sql` (idempotente): agente, 4 clientes, proveedor, 2 cuentas madre, 5 suscripciones, 2 pagos → comisión demo de $3.60 pendiente.
- **fix** `metodo_pago` en Pagos ahora es un `<select>` con los valores del CHECK de la DB (`Zelle, Pago Movil, Pago Movil Binance, Efectivo, Transferencia, Otro`).
- **security** Documentado el uso temporal de `service_role` en el bundle (solo localhost); pendiente migrar a Auth + RLS.
- **chore** `.env` movido a `app/.env` (Vite solo lee `.env` desde la carpeta del proyecto).
- **docs** `06-desarrollo.md` actualizado (deps, estructura `src/`, nota de seguridad, troubleshooting de npm en Windows).

## 2026-09-19 — Fase 2.1 · Gestión pulida

### v0.2.1

- **fix** Eliminar clientes, suscripciones, pagos y cuentas madre ya **no falla por FK**: migración `0005_sistema_gestion.sql` convierte las restricciones a `ON DELETE CASCADE` (clientes → suscripciones/pagos → asignaciones → comisiones; proveedores → SET NULL + cuentas como "Directo"). Verificado end-to-end en el panel (crear + borrar cliente).
- **feat** Registro **inline** desde cualquier formulario: cliente/plan/cuenta madre dentro del modal de Suscripciones, cliente en Pagos, y proveedor/plataforma en Cuentas madre (`src/components/inline.tsx`).
- **feat** Nueva página **Plataformas** (CRUD) en `/plataformas`: activa/inactiva + toggle "genera comisión 30%".
- **feat** Comisiones **configurables por plataforma** (`plataformas.aplica_comision`): el trigger solo genera el 30% en las plataformas marcadas (por defecto solo Google One).
- **feat** Cuentas madre: **proveedor opcional** ("Directo") y **fecha de corte opcional** (cuentas eternas tipo Canva docente) → la fila muestra "Sin cortes" y desaparecen de los vencimientos.
- **feat** Pagos: campo **tasa de Binance (USDT)** persistido en `pagos_ingresos.tasa_cambio_binance` (la de BCV es distinta), **botón "Reflejar tasa"** que trae la oficial del día desde dolarapi.com (fallback: última del sistema), y **protección contra doble clic** al registrar.
- **feat** Suscripciones: campos **fecha de inicio + estado** para poder cargar suscripciones vendidas/contratadas antes del sistema.
- **feat** Formatos es-VE en toda la app: punto para miles y coma para decimales; **"VES"** (ya no "Bs.S"), "USD" y "USDT".
- **feat** Iconos **vectoriales** (SVG tipo Lucide) reemplazan todos los emojis (`src/components/icons.tsx`).
- **feat** Rendimiento: **carga perezosa** por página (`React.lazy` + Suspense, split de chunks en el build) + **caché en memoria de 20 s** en `src/lib/api.ts` (invalidación automática en cada escritura).
- **feat** Tablas más organizadas: cabecera fija, scroll interno, filas alternadas/hover, buscadores en Clientes, Suscripciones y Cuentas madre; filtro por estado en Comisiones.
- **chore** `crearCliente`, `crearPlan`, `crearCuentaMadre`, `crearProveedor`, `crearPlataforma` devuelven el `id` para seleccionarlo al vuelo tras crearlo.

## 2026-09-19 — Fase 2.2 · Auditoría + despliegue seguro (GitHub Pages)

### v0.2.2

- **security** La `service_role` **ya no se incrusta en el bundle** del navegador. El panel ahora usa solo la **anon key** y todo el acceso pasa por **Supabase Auth + RLS** (`es_admin()` por `auth.uid()`): login en `/#/login` (`src/lib/auth.tsx`, `src/pages/Login.tsx`), sesión persistida, y guard de rutas en `App.tsx`. Usuario admin de ejemplo creado por script (`admin@go-plans.app`, credenciales en `API KEYS.txt`, fuera del repo).
- **security** Fuga anónima cerrada: las vistas `v_vencimientos_proveedores` y `v_catalogo_publico` ahora son `security_invoker`, así el RLS de las tablas base se aplica al invocador. Verificado: un anónimo lee 0 filas de vencimientos/cuentas madre (antes las leía todas) y el catálogo público sigue funcionando.
- **fix** Asignación cruzada plan↔cuenta madre: antes se podía poner un plan de una plataforma en una cuenta de otra (p. ej. Spotify → Netflix). Ahora el formulario de Suscripciones **solo ofrece cuentas de la misma plataforma** del plan y la BD **rechaza** cualquier cruce (`trg_validar_plataforma_susc`).
- **fix** **Renovación por pago**: registrar un pago ahora extiende `fecha_corte_cliente` de cada suscripción por la duración del plan y la deja en `activa` (`trg_renovar_susc_por_pago`), evitando que el cron matutino marque como vencida una suscripción ya cobrada.
- **fix** Fechas en **zona horaria local**: `hoy()` ya no usa UTC (`toISOString`), así en Venezuela (UTC‑4) un pago después de las 20:00 se registra el día correcto; aplica también a "ingresos del mes" del dashboard.
- **chore** `vite.config.ts` con `base: './'` + `HashRouter`: el build funciona servido desde cualquier subruta (GitHub Pages `/suscripciones/`) sin configuración de servidor.
- **infra** Despliegue inicial a **GitHub Pages** desde la rama `gh-pages` (build local con anon key, sin secretos).

## 2026-09-20 — Fase 2.3 · Pulido, estandarización y publicación

### v0.2.3

- **infra** Repo **publicado en GitHub** (go-plans/suscripciones, visibilidad pública) y
  **GitHub Pages activado** vía API (`gh-pages` + path `/`). El sitio responde HTTP 200 en
  `https://go-plans.github.io/suscripciones/`.
- **refactor** Primitivas de UI compartidas en `ui.tsx`: `PageHeader` (encabezado estándar),
  `Buscador` (input + lupa), `EmptyState` y `ModalFooter` (Cancelar + Guardar con estado
  `guardando`). Todas las páginas e inline components las usan.
- **refactor** Patrón de carga unificado en las 8 páginas: estado `cargando` inicial → `Loading`;
  error → `ErrorMsg`; **lista vacía → `EmptyState`** (antes una lista sin datos mostraba
  «Cargando…» indefinidamente).
- **refactor** `src/lib/err.ts` con `errMsg(e)`; todos los `catch` de páginas, `api.ts` y
  `inline.tsx` lo usan (retirados los `(e as Error).message` a mano y el helper local `msg`).
- **fix** Protección contra doble clic en todos los formularios de creación (páginas + registro
  inline) mediante el estado `guardando`.
- **fix** Fechas de tabla en Pagos/Clientes ahora usan `fmtDate`/`fmtDateTime` (es-VE) en lugar de
  `toLocaleDateString` a mano; el badge del dashboard distingue «vencida» (días negativos) de
  «0» (corte hoy).
- **chore** `crearSuscripcion` devuelve el `id` como el resto de creadores (consistencia de API).
- **chore** `index.html`: `lang="es"`, título «Suscripciones · Panel administrativo» y meta
  description (antes `lang="en"` y título `app`).
- **docs** `README.md` raíz (repo público, migraciones 0001-0006, Fase 2 completa), `.env.example`
  versionado, `05-seguridad.md` (sección Auth + RLS y checklist), `06-desarrollo.md` (estructura
  y convenciones de UI), `07-despliegue.md` (procedimiento real Pages), `08-changelog.md` (esta
  entrada).

## Próximos (entonces)

- **security** Rotación de claves expuestas en el chat (la `service_role` ya no viaja en el bundle, pero conviene emitir una nueva y descartar la actual).
- **feat** Deploy de la Edge Function `fetch-bcv` y activación del cron `tasas-bcv-diaria`.

Los dos se cerraron con la migración: en este repo no existe la `service_role`
—la autorización la decide RLS sobre el rol del token— y `fetch-bcv` es hoy la
Function `tasabcv` con su Trigger `0 22 * * *` UTC. Quedan escritos porque así
consta en qué punto se quedó el proyecto viejo.
