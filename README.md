# Blink Plans

Panel de reventa y gestión de suscripciones digitales (Netflix, Spotify, Canva,
Google One…): proveedores y cuentas madre, clientes, comisiones de referidos al
30 %, control cambiario USDT/BS con la tasa oficial del BCV y una tienda pública
para contratar desde el celular.

Nació como `go-plans/suscripciones`. Este repo es la versión Blink.

**Estado: en construcción.** La migración a Neon está en curso; el panel que
funciona hoy sigue en https://go-plans.github.io/suscripciones/ hasta que este
esté verificado de extremo a extremo.

- **Sitio:** https://plans.blink.com.ve
- **Redirección legacy:** https://go-plans.github.io/suscripciones/ → este panel
- **Ecosistema:** https://www.blink.com.ve/

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | Vite 8 + React 19 + TypeScript estricto (SPA estática, `HashRouter`) |
| Estilos | Tailwind CSS 4 con los tokens de marca de Blink |
| Base de datos | **Neon** (Lakebase Postgres), proyecto aislado para este panel |
| Acceso a datos | **Neon Function `datos`**: verifica nuestro JWT, hace `SET ROLE` y deja decidir a RLS |
| Autenticación | **Better Auth self-hosted** en la Function `auth`, modo bearer (sin cookies) |
| Automatización | **Neon Function Trigger** sobre `tasabcv`: tasa BCV a las 22:00 UTC y vencimientos |
| Hosting | GitHub Pages (`dist` publicado por Actions), dominio propio |

No hay Data API en la arquitectura. El piloto la midió con proveedor externo
de JWKS y alterna 200 y 400 `jwk not found` con el mismo JWT válido; la
decisión completa y sus mediciones están en
[`docs/ADR/002-neon-en-lugar-de-supabase.md`](./docs/ADR/002-neon-en-lugar-de-supabase.md).

La documentación del proyecto viejo sigue siendo la referencia del negocio:
[`docs/`](./docs/README.md), con el historial completo en
[`docs/historia-proyecto-viejo.md`](./docs/historia-proyecto-viejo.md).

## Estructura

```
PLANS/
├── src/                    frontend React (páginas por dominio del negocio)
│   ├── lib/                auth, datos (db.ts), sesión (sesion.ts), entorno
│   ├── pages/              panel admin + tienda pública
│   ├── components/         Layout, UI, tienda, marca Blink
│   └── assets/             marca/ (SVG maestros copiados literal) y fonts/
├── scripts/                marca, grises, contraste, capturas
├── functions/              server-side en Neon: auth, datos, tasa-bcv, _shared
├── db/                     esquema portado a Neon (0000 roles … 0003 Better Auth)
├── piloto/                 los 7 experimentos del gate y sus sondas
├── supabase/               esquema histórico: 12 migraciones del proyecto viejo
│   └── functions/          Edge Function Deno fetch-bcv (portada a functions/)
├── docs/                   arquitectura, BD, integraciones, flujos, seguridad, ADR
├── neon.ts                 infraestructura como código: las tres Functions y su env
├── public/                 CNAME, favicon, iconos, og.png, diseños de gift cards
└── .github/workflows/      pages.yml
```

`db/` es el esquema **vivo** y se aplica en orden: `0000` crea los roles
`authenticated`/`anonymous` (sin ellos, todo es 42501), `0001` porta el modelo
de negocio con sus políticas RLS, `0002` da permisos y `0003` fija las cuatro
tablas de Better Auth en `public`. `db/_port_raw.sql` es el material crudo del
que sale `0001`, versionado para que el port sea revisable contra el original.

`db/importar/` son las dos patas de la migración de datos: `volcar.sh` mueve el
`public` del proyecto viejo con los triggers dormidos y exige paridad de
filas y sumas, y `cuentas.mjs` traduce `auth.users`/`auth.identities` a las
tablas de Better Auth conservando el UUID y el bcrypt de cada cliente. Ambos
son **seco por defecto** (`--aplicar` para escribir) y `db/README.md` documenta
las cinco trampas que midieron.

`supabase/` se conserva como **registro histórico**, no como script a ejecutar:
las migraciones 0003, 0004, 0005 y 0011 contienen `INSERT` de datos demo con
UUIDs fijos, un `DROP CONSTRAINT` y un `DELETE` que borrarían datos reales si
volvieran a aplicarse.

## Scripts

| Comando | Para qué |
|---|---|
| `npm run dev` | desarrollo local del front contra el proyecto de Neon que diga `.env.local` |
| `npm run typecheck` | TypeScript sin emitir |
| `npm run lint` | oxlint |
| `npm run build` | `tsc -b` + `vite build` → `dist/` |
| `npm run preview` | servir el `dist` local |
| `npm run marca` | regenera favicon, iconos y `og.png` desde los SVG maestros; **sale con error** si un trazo del isotipo no es idéntico al del master |
| `npm run grises` | barre los grises `slate-*` de Tailwind a los tokens de la marca sobre `src/**/*.tsx` y falla si queda alguno |
| `npm run contraste` | mide la ratio WCAG de cada tinta de la marca sobre sus tres superficies y falla si alguna baja del umbral que declara el CSS |
| `npm run capturas -- /tmp/despues` | captura tienda, acceso y carrito en 1440×900 y 390×844 para la revisión visual |
| `neon dev --source functions/auth/index.mjs --port 4000 --env .env.local` | una Function en local, con recarga |
| `neon deploy --env .env.local` | aplicar `neon.ts` a la rama enlazada (bundlea y sube las tres Functions) |
| `node piloto/sonda-bcrypt.mjs` | la verificación de la Fase 5, contra las Functions desplegadas |

`neon dev` se lanza **de una en una**: arrancadas en paralelo, dos Functions
distintas terminaban sirviendo el mismo código en puertos distintos.

## Marca

Los activos no se redibujan: `src/assets/marca/` guarda copias **byte a byte**
de los maestros del ecosistema (`blink-isotipo.svg`, `blink-wordmark.svg`,
`blink-lockup.svg`) y `scripts/marca.mjs` compone sobre ellos el favicon, los
iconos de app y el `og.png` de 1200×630. Antes de rasterizar, el script
compara los tres trazos del isotipo con los del master y **sale con código 1**
si alguno difiere, así que un "lo arreglé de ojo" no puede colarse en un
`npm run marca`. La rasterización va por Chromium (`playwright-core` +
`CHROMIUM_PATH`), no por ImageMagick: su delegada SVG ignora `currentColor` y
los `transform`, y eso cambia la silueta.

La tipografía de marca no se redistribuye. El `og.png` fija **Inter**, servida
embebida como data URL desde `src/assets/fonts/inter-latin.woff2` (licencia
SIL OFL, `src/assets/fonts/LICENSE-Inter.txt`), porque SF Pro no se puede
publicar en un PNG ajeno; en el panel la pila sí pide SF Pro al sistema con
`local()` y cae en Inter. El razonamiento completo está en el comentario de
CAPA 1 de `src/index.css`.

Los grises del panel son los de la casa, no los de Tailwind: `@theme` en
`src/index.css` declara `blink-dark`, `blink-muted`, `blink-ink-mute`,
`blink-line`, `blink-line-strong`, `blink-fill`, `blink-fill-strong`,
`blink-soft` y `blink-scrim`, y la tabla de equivalencias `slate-* → token`
vive en el comentario de ese bloque. `npm run grises` aplica la tabla y
`npm run contraste` verifica las ratios: la tinta secundaria es **#6A6A6F**
porque da 5,38:1 sobre blanco, 5,03:1 sobre `blink-fill` y 4,57:1 sobre
`blink-fill-strong`, mientras que el `slate-400` anterior daba 2,56:1 y no
pasaba ni el AA de texto grande.

## Entorno

Solo llegan al bundle valores **públicos**. La cadena de conexión de Neon nunca
viaja al navegador, ni siquiera la del pooler.

```
VITE_BLINK_AUTH_URL=https://<rama>-auth.compute.<región>.neon.tech
VITE_BLINK_DATOS_URL=https://<rama>-datos.compute.<región>.neon.tech
VITE_BLINK_TASA_URL=https://<rama>-tasabcv.compute.<región>.neon.tech
```

Son el campo `invocation_url` de cada Function (`neon functions get auth`), y
cada rama tiene el suyo. [`.env.example`](./.env.example) explica cuáles son
públicas, cuáles son secretas (`BETTER_AUTH_SECRET`, `BLINK_DATA_JWT_SECRET`,
`BETTER_AUTH_URL`, `BLINK_ALLOWED_ORIGINS`) y por qué no son intercambiables.

En GitHub las tres `VITE_*` están como **Variables** del repo
(`Settings → Secrets and variables → Actions → Variables`) y las consume
`.github/workflows/pages.yml`. No son Secrets porque no hay nada privado en
una URL de Function.

## Seguridad

- Un solo camino de datos: la Function `datos` verifica el JWT HS256 que acuña
  `auth`, abre una transacción, hace `set local role` con el claim `role` y
  deja `request.jwt.claims` en `set_config` para que las políticas lean `sub`.
  El compilador no decide permisos; los decide RLS.
- Sin sesión existe el rol `anonymous`, con `GRANT SELECT` únicamente sobre la
  vista del catálogo público: la tienda funciona sin cuenta, el resto del panel
  no. Medido: `usuarios` responde 403 al anónimo.
- RLS en todas las tablas de negocio. Las vistas corren con
  `security_invoker = true` para que hereden las políticas del que consulta.
- El rol admin no se deduce del token sino de la fila `public.usuarios.rol`,
  que es la fuente de verdad del negocio: promover a un admin sigue siendo un
  `UPDATE` de una columna.
- Las contraseñas de los clientes del proyecto viejo se verifican con bcrypt y
  se re-hashean a scrypt en el primer inicio de sesión correcto: nadie tiene que
  restablecer su contraseña (ver `docs/ADR/002-...` y `piloto/sonda-bcrypt.mjs`).
- La única excepción documentada a RLS es `GET /tasa` en `tasabcv`: lectura de
  la última tasa publicada, sin token, porque el dato es público por naturaleza
  y la tabla `tasas_cambio` es de solo admin.

## Pendientes de esta migración

1. **Cotejar a mano las cifras importadas.** Los datos reales ya están en la rama
   `main` de Neon (`db/importar/`, receta y ocho trampas en `db/README.md`): 70 filas,
   paridad exacta con el viejo en las 11 tablas, `2 user / 2 account` con los bcrypt
   byte a byte y las nueve comprobaciones en verde. Lo que el `diff` no puede probar es
   que `suscripciones 17`, `usuarios 19` y `equivalente_usd 53.57` sean lo que el dueño
   ve en el panel. Hay que leerlos contra el panel viejo antes de mover un cliente.
2. **La redirección del proyecto viejo, que es lo único que falta de la Fase 9.**
   Ya está desplegado: las tres Functions corren en la rama `main` de Neon, el repo
   es público y GitHub Pages sirve el sitio en `plans.blink.com.ve` con HTTPS
   forzado. Lo que no se pudo instalar es el `index.html` que redirige conservando
   el hash: vive en la rama `gh-pages` de `go-plans/suscripciones`, y esta sesión
   tiene `pull` pero no `push` sobre ese repo. O lo empuja su dueño o da permiso de
   escritura.
3. **El cron de producción no existe todavía.** `neon triggers list --branch main`
   no devuelve nada; el `tasas-y-vencimientos` con `0 22 * * *` solo está en la rama
   del piloto. Sin él, la rama `main` no publica la tasa del día ni marca
   vencimientos. Se crea en un minuto, pero escribe en `tasas_cambio` cada día: se
   hace con consentimiento explícito.
4. Verificación de extremo a extremo sobre datos reales (bloques A–F de
   `docs/07-despliegue.md`). Lo primero y lo que más pesa: **el primer login real
   con la contraseña vieja**. Con `admin@blink.com.ve` ya renombrado, ese acceso es
   el que comprueba dos cosas que ninguna sonda intermedia puede comprobar — que la
   identidad importada entra sin restablecer nada, y que el bcrypt pasa a scrypt en
   `public.account` en la misma llamada.
5. `docs/02`, `03`, `05`, `06` y `07` aún describen Supabase. `docs/ADR/002`
   es la corrección de fondo; cada capítulo marcado como histórico dice qué
   sigue vigente y qué no.
