import { defineConfig } from "@neon/config/v1";

// Piloto de verificación (Fase 3). Etapa A: Data API con Neon Auth para
// comprobar la mecánica del camino PostgREST — RPC por HTTP, count=exact,
// Range, embeds a través de vistas y el rol anónimo de la tienda.
// La Etapa B cambia `auth: true` por el proveedor externo de la Data API, con
// el JWKS de Better Auth self-hosted, que es el diseño real. Se registró por
// CLI (no por aquí) porque el `neon deploy` de esta rama aún lleva `auth: true`
// y la Data API solo admite un proveedor activo:
//
//   neon data-api create --database neondb --auth-provider external \
//     --jwks-url https://<branch>-blinkauth<suffix>/api/auth/jwks \
//     --jwt-audience https://<branch>-blinkauth<suffix>
//
// Ver piloto/RESULTADOS.md, experimentos 6 y 7, y la sección «Caché JWKS».
export default defineConfig({
  auth: true,
  dataApi: true,
  functions: {
    blinkauth: {
      name: 'Better Auth self-hosted (piloto)',
      source: 'piloto/auth-fn/function.mjs',
    },
    tasabcv: {
      name: 'Scrape de la tasa BCV + triggers (piloto)',
      source: 'piloto/funciones/tasa-bcv/index.mjs',
    },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
