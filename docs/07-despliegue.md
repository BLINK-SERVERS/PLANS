# 07 — Despliegue

> **Estado (2026-11-10):** los apartados 1 a 7 son el procedimiento del
> proyecto Supabase y se conservan como referencia. El despliegue vigente está
> en el **apartado 8** (verificación extremo a extremo), la tabla de
> tecnologías del `README.md` y `docs/ADR/002`. Lo que cambió: las Edge
> Functions pasan a Neon Functions (`functions/`), `pg_cron` pasa a un Function
> Trigger (`tasas-y-vencimientos`, `0 22 * * *` en UTC) y el frontend se publica
> en GitHub Pages con Variables del repo en vez de claves de Supabase.

## 1. Modelo de despliegue

| Pieza | Dónde | Cómo |
|---|---|---|
| Frontend | **GitHub Pages** (repo público `go-plans/suscripciones`) | build `npm run build` + publicar `dist/` en rama `gh-pages` |
| Base de datos | Supabase (gestionado, ya activo) | migraciones `supabase/migrations/` |
| Edge Functions | Supabase Functions (Deno) | `supabase functions deploy` |
| Cron | pg_cron en Supabase | job `vencimientos-diarios` (ya activo) y `tasas-bcv-diaria` |

> GitHub Pages en el plan gratuito **exige repo público** para repositorios propios.
> El repo fue hecho público como parte del despliegue (Fase 2.2).

## 2. Desplegar el frontend (GitHub Pages)

El sitio es 100 % estático (Vite con `base: './'` + `HashRouter`), así que basta
con publicar el `dist/` en la rama `gh-pages`; la API de GitHub con
`source.branch = "gh-pages"` + `source.path = "/"` se configuró una sola vez.

```bash
cd app
npm run build              # compila con anon key (sin service_role)
# 1) commitear y pushear el cambio en main primero (así Pages no queda desincronizado)
git add -A && git commit -m "chore: release vX" && git push origin main
# 2) publicar el build en la rama gh-pages (worktree huérfano)
git worktree add --orphan -b gh-pages .ghpages
Copy-Item dist\* .ghpages\ -Recurse -Force
git -C .ghpages add -A
git -C .ghpages commit -m "deploy: release vX"
git -C .ghpages push origin gh-pages --force
git worktree remove .ghpages
```

- URL del sitio: `https://go-plans.github.io/suscripciones/`
- Rutas públicas (mismo SPA): tienda `/#/tienda`, registro `/#/registro`, entrada `/#/ingreso`.
  Login del panel admin: `/#/login` (credenciales en `API KEYS.txt`, fuera del repo).
- Verificación rápida del sitio: el título del HTML servido debe ser
  «Suscripciones · Panel administrativo» y el bundle **no** debe contener
  `service_role` (solo anon key).
- Verificación de la tienda: en vivo debe verse el catálogo con los tres diseños
  (Google One vertical, Canva Pro morado, Spotify Premium verde) con precio tachado
  y ahorros; el botón "Contratar" de cualquier plan lleva a `/#/registro`.

Variables de entorno del host (nunca commitear):

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

> ⚠️ Solo variables **públicas** (`VITE_*`). Nunca exponer `service_role`.

## 3. Desplegar la Edge Function fetch-bcv

> La función extrae la tasa oficial del **sitio del BCV** (`bcv.org.ve`, bloque USD de
> la página de tipo de cambio de referencia) y la guarda en `tasas_cambio`. Como la
> página del BCV no envía cabeceras CORS, el scrape se hace server-side (Deno), nunca
> desde el navegador. El botón **"Reflejar tasa"** de Pagos la invoca y cae a la última
> tasa almacenada si la función aún no está desplegada.

```bash
supabase login
supabase link --project-ref xbmewcmpfnligeodggop
supabase functions deploy fetch-bcv --no-verify-jwt
```

La función usa `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` del entorno de Supabase (inyectadas automáticamente).

Probar manualmente:

```bash
curl -X POST https://xbmewcmpfnligeodggop.supabase.co/functions/v1/fetch-bcv \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

## 4. Activar el cron de tasa BCV

> **Horario:** el BCV publica la tasa de referencia ~16:00 hora de Venezuela (UTC‑4).
> El cron se ejecuta a las **18:00 VET = 22:00 UTC** para capturar la tasa ya
> publicada. `pg_cron` usa la zona horaria de la BD (Supabase: UTC por defecto);
> si tu BD estuviera en `America/Caracas`, usa `'0 18 * * *'` en su lugar.

Una vez desplegada la función, ejecutar una sola vez en el SQL Editor:

```sql
show timezone; -- debe decir UTC (si no, ajusta la hora según la nota)

select cron.schedule(
  'tasas-bcv-diaria',
  '0 22 * * *',
  $$ select net.http_post(
       url := 'https://xbmewcmpfnligeodggop.supabase.co/functions/v1/fetch-bcv',
       headers := jsonb_build_object(
         'Content-Type','application/json',
         'Authorization', 'Bearer ' || '<SERVICE_ROLE_KEY>'),
       body := '{}') $$
);
```

> Ver `0002_automatizaciones.sql` para el detalle completo.

## 5. Verificación post-despliegue

```bash
# 1) Auth health
curl https://xbmewcmpfnligeodggop.supabase.co/auth/v1/health

# 2) API REST (catálogo público)
curl -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  "https://xbmewcmpfnligeodggop.supabase.co/rest/v1/plataformas?select=nombre&order=nombre"

# 2b) Vista del catálogo de venta (la usa la tienda /#/tienda)
curl -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  "https://xbmewcmpfnligeodggop.supabase.co/rest/v1/v_catalogo_publico?select=plataforma,duracion_dias,precio_venta_usd,precio_referencia_usd&order=plataforma"

# 3) Cron
curl http://localhost:5173   # frontend arriba
```

## 6. Rollback

- **Esquema**: nueva migración inversa (`000N_revert_*.sql`) — nunca se editan migraciones aplicadas.
- **Frontend**: redeploy del commit anterior (los hosts estáticos permiten rollback con un clic).
- **Edge Function**: `supabase functions deploy` con versión anterior.

## 7. Entornos

- **local**: `npm run dev` contra el mismo Supabase (uno solo por ahora).
- **producción**: build estático + Supabase gestionado.
- Para añadir un entorno separado de DB: crear otro proyecto Supabase y apuntar `VITE_SUPABASE_URL` en el host.

---

## 8. Verificación extremo a extremo de la migración a Neon (vigente)

Los apartados 1 a 7 describen el despliegue sobre Supabase y se conservan como
historial. Esta es la lista que se corre antes de cortar el tráfico, en orden,
sobre la rama que recibe los datos reales. Cada bloque dice **qué se mira** y
**cuál es el fallo que lo delata**; un bloque en rojo para el corte.

**A — autenticación.** Entrar con un correo restaurado y su contraseña vieja da
200 y token de sesión. Después de ese login, `public.account.password` ya no
empieza por `$2` y tiene la forma `32 hex : 128 hex`; un segundo login con la
misma clave vuelve a dar 200 y **no** reescribe el hash. Un registro nuevo crea
su fila en `public.usuarios` con `rol='cliente'`. El rol `authenticated` existe
y está otorgado (sin él todo es 42501). El admin aterriza en el Dashboard y un
cliente rebota a `/tienda`. → `node piloto/sonda-bcrypt.mjs` cubre todo el
bloque menos el enrutado, que se ve en el navegador.

**B — dinero (lo que más duele).** `select count(*), min(fecha), max(fecha) from
tasas_cambio` coincide con el origen, sin huecos. Una conversión BS→USD da el
mismo número en los dos paneles abiertos lado a lado, con la misma tasa del día.
El cobro de un pedido coincide con lo cotizado en Checkout. → si difiere, el
sospechoso es la emisión de numéricos como texto (`::text`) o el redondeo, no
RLS.

**C — negocio.** Un pago de Google One con cliente referido genera `comisiones`
por `round(monto*0.30, 2)`. `cupos_ocupados` sube y baja, y llenar un cupo lanza
excepción con su mensaje. Asignar un plan de Spotify a una cuenta madre de
Netflix se rechaza. `editar_pago` recalcula como admin y falla como anónimo. →
esto ejercita el compilador de `datos` y las funciones plpgsql portadas en
`db/0001`.

**D — tienda.** El catálogo sale de `v_catalogo_publico` con el precio de
referencia tachado, **sin sesión**. Carrito → checkout → fila en `pedidos` con
`cliente_id` real. Un cliente solo ve sus pedidos. → la prueba inversa cuenta
igual: un anónimo que consulte `usuarios` debe recibir 403.

**E — automatización.** `neon triggers list` muestra `tasas-y-vencimientos` con
`0 22 * * *` y `next_run_at` coherente; el cron se interpreta **en UTC**, así
que 22:00Z son 18:00 VET, dos horas después de que el BCV publica. Tras forzar
un `POST /` con token de datos, `tasas_cambio` tiene la fila del día con
`tasa_eur_bs` no nula y la respuesta trae `suscripciones_marcaron_vencidas`.
Ningún log contiene `xbmewcmpfnligeodggop`. Disparar dos veces el mismo día no
duplica la fila (`on conflict (fecha)`, `efecto: "update"`).

**F — entrega.** `gh run list` en verde. `curl -sI https://plans.blink.com.ve/`
da 200 y `https://plans.blink.com.ve` responde **301 a https** si el Forzar HTTPS
está activo. Los assets salen con ruta absoluta (`/assets/…`), no relativa.
`grep -rlE "service_role|sb_secret|postgresql://[^ ]*:[^ ]*@" dist/` no devuelve
nada — este es el control de que ningún secreto se horneó en el bundle. El
barrido de referencias viejas da 0 coincidencias fuera de
`docs/historia-proyecto-viejo.md`. `https://go-plans.github.io/suscripciones/#/tienda`
redirige **conservando el hash**.

### Rollback de esta migración

- **Functions**: `neon deploy` del commit anterior (cada rama conserva su
  despliegue; un redeploy no recicla un isolate caliente, así que los cambios de
  `env` se verifican en el siguiente arranque en frío).
- **Datos**: la rama por defecto no se toca hasta que el import se verificó en
  una rama hija; el proyecto Supabase viejo **no se archiva ni se borra** — es
  el único respaldo hasta que el corte se considere definitivo.
- **Tráfico**: se revierte publicando de nuevo la rama `gh-pages` vieja de
  `go-plans/suscripciones`, que conserva el panel original intacto.
