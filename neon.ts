import { defineConfig } from "@neon/config/v1";

// BLINK Plans — producción (proyecto `plans-prod`, aws-us-east-2).
//
// Aquí no se declaran `auth` ni `dataApi`. No es un descuido: el piloto midió
// que la Data API con proveedor EXTERNO de JWKS alterna 200 y 400 `jwk not
// found` con el mismo JWT válido y sin nada que controlemos desde el repo
// (piloto/RESULTADOS.md, «Proveedor externo de la Data API»). Con ese resultado,
// el tráfico autenticado no puede pasar por la Data API, y tener dos caminos de
// datos —PostgREST para lo público y Functions para lo autenticado— significa
// dos clientes, dos RLS-views y dos superficies de error en un panel que mueve
// plata. Así que hay UNO solo: la Function `datos`, que verifica nuestro JWT,
// hace SET ROLE y deja decidir a RLS. La Data API sigue disponible en Neon si
// algún día hace falta, pero no forma parte de la arquitectura de Plans.
//
// Verificación: Fase 10 del plan y docs/01-arquitectura.md.
export default defineConfig({
  functions: {
    auth: {
      name: "Better Auth self-hosted (login, sesiones, alta del JWT de datos)",
      source: "functions/auth/index.mjs",
      env: {
        BETTER_AUTH_SECRET: { value: process.env.BETTER_AUTH_SECRET, required: true },
        // La URL pública de ESTA function. Better Auth la compara contra
        // Origin/Referer, así que un valor aproximado da 403 en el login.
        // Se saca de `neon functions get auth` (campo invocation_url).
        BETTER_AUTH_URL: { value: process.env.BETTER_AUTH_URL, required: true },
        BLINK_DATA_JWT_SECRET: { value: process.env.BLINK_DATA_JWT_SECRET, required: true },
        BLINK_ALLOWED_ORIGINS: { value: process.env.BLINK_ALLOWED_ORIGINS, required: false },
      },
    },
    datos: {
      name: "API de datos de Plans (RLS por SET ROLE)",
      source: "functions/datos/index.mjs",
      env: {
        // El mismo secreto con el que `auth` acuña el token: dos Functions que
        // firman y verifican la misma credencial. No es BETTER_AUTH_SECRET —
        // ver functions/_shared/token.mjs.
        BLINK_DATA_JWT_SECRET: { value: process.env.BLINK_DATA_JWT_SECRET, required: true },
        BLINK_ALLOWED_ORIGINS: { value: process.env.BLINK_ALLOWED_ORIGINS, required: false },
      },
    },
    tasabcv: {
      name: "Tasa BCV diaria + vencimientos",
      source: "functions/tasa-bcv/index.mjs",
    },
  },
  branch: (branch) => {
    if (branch.isDefault) return {};
    if (!branch.exists) return { ttl: "7d" };
    return {};
  },
});
