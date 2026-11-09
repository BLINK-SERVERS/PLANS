# Changelog

Historial de **Blink Plans**. El historial del proyecto anterior está en
[`docs/historia-proyecto-viejo.md`](./docs/historia-proyecto-viejo.md), que
conserva las versiones v0.1.0 a v0.5.0 tal como se escribieron (incluidas las
referencias a `go-plans` y a Supabase, que son historia y no se reescriben).

## [Unreleased]

Migración en curso desde `go-plans/suscripciones`. Nada de esto está en
producción todavía.

### Cambiado — marca y presentación
- El producto pasa de llamarse **Go Plans** a **Blink Plans** en la tienda, el
  hero, el pie legal, el login y el mensaje de pedido (`Tienda`,
  `TiendaPlataforma`, `BarraTienda`, `Login`, `Checkout`, `Layout`, `lib/pedidos`).
- El badge "GP" de la cabecera se sustituye por el **isotipo de Blink**
  (`src/components/marca-blink.tsx`), copiado verbatim del SVG aprobado del
  ecosistema: mismas tres figuras, mismo `viewBox`, `fill="currentColor"`.
- **Fuera Google Sans y Canva Sans** (`public/fonts/`, 6,2 MB). Son tipografías
  de marca de Google y Canva, no redistribuibles en un repo público; además la
  tienda usaba la tipografía del fabricante para vender sus propios productos.
  Entran **SF Pro pedida al sistema con `local()`** e **Inter** (SIL OFL 1.1,
  28 KB recortada) servida desde `src/assets/fonts/`, el mismo criterio de BWS.
- Los acentos `indigo-*` de Tailwind (66 usos) se remapean a los tokens de Blink:
  los botones usan un relleno de acción `#0066CC` en lugar de `#007AFF`, porque
  el azul de marca sobre blanco da 3,16:1 y no llega a AA con texto pequeño.
- Filas alternadas, hover y scrollbar de las tablas salen del gris `slate` en
  crudo a superficies de la marca.
- `index.html` con título, canonical, `theme-color` y bloque Open Graph de
  Blink Plans.

### Cambiado — estructura
- `vite.config.ts`: `base: './'` → `base: '/'` (ahora se sirve en la raíz del
  dominio propio, no en la subruta `/suscripciones/`).
- `public/CNAME` → `plans.blink.com.ve`.
- `docs/08-changelog.md` → `docs/historia-proyecto-viejo.md` sin reescribir.
- `.gitignore` bloquea `/dumps/` y `*.dump`: un volcado arrastra datos de
  clientes reales y, en el caso del proyecto viejo, la `service_role` en texto
  plano dentro de `cron.job`.
- `package.json`: nombre `blink-plans` y script `typecheck` explícito para CI.
- Añadido `.github/workflows/pages.yml` (el proyecto viejo publicaba `dist/` a
  mano en la rama `gh-pages`; no tenía workflow).

### Pendiente
- Capa de datos y auth sobre Neon (`README.md` → "Pendientes").
