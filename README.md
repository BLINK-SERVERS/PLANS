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
| Base de datos | **Neon** (PostgreSQL), proyecto aislado para este panel |
| Acceso a datos | **Neon Data API** (protocolo PostgREST) desde el navegador, solo con JWT |
| Autenticación | **Better Auth self-hosted** en una Neon Function, modo bearer |
| Automatización | **Neon Functions** con disparador programado (tasa BCV y vencimientos) |
| Hosting | GitHub Pages (`dist` publicado por Actions), dominio propio |

La documentación del proyecto viejo sigue siendo la referencia del negocio:
[`docs/`](./docs/README.md), con el historial completo en
[`docs/historia-proyecto-viejo.md`](./docs/historia-proyecto-viejo.md).

## Estructura

```
PLANS/
├── src/                    frontend React (páginas por dominio del negocio)
│   ├── lib/                auth, datos, dinero, tienda, pedidos
│   ├── pages/              panel admin + tienda pública
│   └── components/         Layout, UI, tienda, marca Blink
├── functions/              server-side en Neon (auth, tasa-bcv)
├── supabase/               esquema histórico: 12 migraciones del proyecto viejo
│   └── functions/          Edge Function Deno fetch-bcv (portada a functions/)
├── docs/                   arquitectura, BD, integraciones, flujos, seguridad
├── public/                 CNAME, favicon, diseños de gift cards
└── .github/workflows/      pages.yml
```

`supabase/` se conserva como **registro histórico**, no como script a ejecutar:
las migraciones 0003, 0004, 0005 y 0011 contienen `INSERT` de datos demo con
UUIDs fijos, un `DROP CONSTRAINT` y un `DELETE` que borrarían datos reales si
volvieran a aplicarse. El esquema vivo es el que resultó del volcado, y lo nuevo
se numera desde `0013`.

## Scripts

| Comando | Para qué |
|---|---|
| `npm run dev` | desarrollo local contra el proyecto de Neon que diga `.env.local` |
| `npm run typecheck` | TypeScript sin emitir |
| `npm run lint` | oxlint |
| `npm run build` | `tsc -b` + `vite build` → `dist/` |
| `npm run preview` | servir el `dist` local |

## Entorno

Solo llegan al bundle valores **públicos**. La cadena de conexión de Neon nunca
viaja al navegador, ni siquiera la del pooler.

```
VITE_NEON_DATA_API_URL=https://<endpoint>/rest/v1
VITE_NEON_AUTH_URL=https://<funcion-de-auth>
```

En GitHub están como Variables del repo (`Settings → Secrets and variables →
Actions → Variables`), y se consumen en `.github/workflows/pages.yml`. No son
Secrets porque no hay nada privado en ellas.

## Seguridad

- Cada request a la Data API lleva el JWT de la sesión; el API hace `SET ROLE`
  con el claim `role` y expone `auth.user_id()` desde el claim `sub`.
- Sin sesión existe el rol `anonymous`, con `GRANT SELECT` únicamente sobre la
  vista del catálogo público: la tienda funciona sin cuenta, el resto del panel
  no.
- RLS en todas las tablas de negocio. Las vistas corren con
  `security_invoker = true` para que hereden las políticas del que consulta.
- El rol admin no se deduce del token sino de la fila `public.usuarios.rol`, que
  es la fuente de verdad del negocio.
- Las contraseñas de los clientes del proyecto viejo se verifican con bcrypt y
  se re-hashean a scrypt en el primer inicio de sesión correcto: nadie tiene que
  restablecer su contraseña (ver `docs/ADR/002-...`).

## Pendientes de esta migración

1. `public/og.png` (1200×630) con la marca aprobada — sin él, los enlaces
   compartidos salen sin imagen.
2. `favicon` de Blink Plans.
3. Barrido de los grises `slate-*` de Tailwind a los tokens de la marca, con
   revisión visual en escritorio y móvil.
4. Actualizar `docs/01`…`docs/07` al backend nuevo (hoy describen Supabase).
