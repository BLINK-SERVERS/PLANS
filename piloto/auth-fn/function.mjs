// Better Auth self-hosted dentro de una Neon Function (experimento 6 en su
// forma real: el plan pedía probarlo EN la Function, no solo contra la BD).
//
// El mismo auth.config.mjs que se probó en local (etapa-b.mjs); aquí lo que
// cambia es el entorno: DATABASE_URL la inyecta Neon, y la baseURL tiene que
// ser la URL pública de la Function porque Better Auth compara Origin/Referer
// contra ella.
//
// Se despliega con:
//   neon functions deploy blinkauth --src piloto/auth-fn/function.mjs \
//     --env PILOTO_AUTH_BASE_URL=https://<branch_id>-blinkauth.compute…
import auth from './auth.config.mjs'

export default {
  async fetch(request) {
    try {
      return await auth.handler(request)
    } catch (e) {
      // Que el fallo sea legible en `neon logs query --source function`.
      console.error('[auth] handler lanzó:', e?.stack ?? e)
      return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  },
}
