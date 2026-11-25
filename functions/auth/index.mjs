// ============================================================
//  functions/auth/index.mjs — Better Auth self-hosted de Blink Plans
// ============================================================
//  Es el config probado del piloto (piloto/auth-fn/auth.config.mjs,
//  experimentos 6 y 7 del gate) con tres cambios de producción:
//    · baseURL la inyecta Neon como BETTER_AUTH_URL (la URL pública de la
//      Function); Better Auth compara Origin/Referer contra ella.
//    · el id de usuario se fuerza a UUID (advanced.database.generateId), que
//      es lo que permite importar los clientes viejos con su id de siempre.
//    · nace la ruta /token, que acuña el JWT de datos que verifica la
//      Function `datos`.
//
//  Dos decisiones que vienen del gate y no son capricho:
//
//  1) Sin Neon Managed Auth. La guía de Neon dice que los usuarios con
//     contraseña propia NO son migrables a Managed Better Auth, y aquí la
//     promesa del proyecto es que ningún cliente restablece su contraseña.
//     Self-hosted es el único camino que puede verificar bcrypt y re-hashear
//     a scrypt en el primer login correcto.
//
//  2) Las tablas de Better Auth viven en `public`, no en un esquema propio.
//     Hallazgo medido en la Etapa B del piloto: `database.schemaName` no
//     separa nada — ni el CLI al migrar ni el runtime al consultar, que usa
//     nombres sin cualificar por search_path, y el endpoint pool de Neon
//     rechaza search_path en el paquete de arranque. Puesto que igualmente
//     comparten esquema, se aprovecha: no hay búsqueda cross-schema para el
//     hook de registro. La protección real es que `datos` tiene una lista
//     blanca de recursos leídos del diccionario y que estas tablas no están
//     entre los recursos que el front consulta (src/lib/api.ts no toca `user`,
//     `session`, `account` ni `verification`).
//
//  Contraseñas: `account.password` guarda scrypt (formato nativo
//  `salt:hash`, sin prefijo) o, para los clientes importados, el bcrypt
//  `$2a$/$2b$/$2y$` heredado de Supabase. `verify` distingue por prefijo, y
//  cuando un bcrypt pasa lo reescribe a scrypt en la misma llamada. El
//  cliente nunca restablece nada y el sistema se migra solo, login a login.
//
//  Registro: el viejo disparador `trg_auth_user_creado` sobre auth.users no
//  sobrevive (no hay auth.users). Su trabajo lo hace el hook
//  `databaseHooks.user.create.after`, que inserta la fila en public.usuarios
//  con rol 'cliente'. Ver la nota de autoconfirmación más abajo.

import { randomUUID } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { bearer } from 'better-auth/plugins'
import { hashPassword, verifyPassword } from 'better-auth/crypto'
import { PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import { attachDatabasePool } from '@neon/functions'
import { firmarToken } from '../_shared/token.mjs'

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 })
attachDatabasePool(pool)

const BASE_URL = process.env.BETTER_AUTH_URL ?? 'http://localhost:4000'
const ORIGENES = (
  process.env.BLINK_ALLOWED_ORIGINS ??
  'https://plans.blink.com.ve,https://go-plans.github.io,http://localhost:5173'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// El re-hash es una MEJORA: si falla, el login no puede fallar con él. La
// Set evita que dos requests concurrentes con el mismo hash antiguo repitan
// el UPDATE (es idempotente, pero cada uno cuesta una escritura).
const mejorando = new Set()

async function actualizarBcryptViejo(hashViejo, contraseña) {
  const nuevo = await hashPassword(contraseña)
  // Columnas camelCase entre comillas: así las creó el CLI de Better Auth.
  // El UPDATE va en public porque el runtime consulta por search_path.
  const r = await pool.query(
    `update public.account set "password" = $1, "updatedAt" = now() where "password" = $2`,
    [nuevo, hashViejo],
  )
  return r.rowCount
}

export const auth = betterAuth({
  appName: 'blink-plans',
  baseURL: BASE_URL,
  secret: process.env.BETTER_AUTH_SECRET,

  // Dos listas de orígenes y NO es redundancia:
  //   · `cors.origin` pinta las cabeceras de la respuesta; sin ella el
  //     navegador bloquea la lectura del body.
  //   · `trustedOrigins` es la que rechaza el request ANTES de correr el
  //     endpoint. Medido en better-auth 1.7.19
  //     (dist/api/middlewares/origin-check.mjs): `validateFormCsrf` llama a
  //     `validateOrigin(ctx, true)` en cuanto el request trae cabecera
  //     `Origin` — con o sin cookies — y la compara solo contra
  //     `trustedOrigins` + el origin de `baseURL`. `cors.origin` NO alimenta
  //     esa lista.
  //
  //  Por qué importa aquí: el front vive en https://plans.blink.com.ve y esta
  //  Function vive en https://<branch>-auth.compute…; todo fetch del navegador
  //  es cross-origin y sin `trustedOrigins` cada login devolvería
  //  403 INVALID_ORIGIN. Es exactamente el fallo que el gate busca antes de
  //  comprometer la arquitectura: local se prueba con `Origin: <baseURL>` y
  //  pasa, y en producción rompe.
  trustedOrigins: ORIGENES,
  cors: { origin: ORIGENES, credentials: true },

  database: {
    dialect: new PostgresDialect({ pool }),
    type: 'postgres',
    transaction: false,
    // schemaName omitido a propósito: ver el punto 2 del encabezado.
  },

  advanced: {
    cookiePrefix: 'blink',
    database: {
      // user.id es TEXT en Better Auth. Forzar UUID es lo que permite que
      // public.usuarios.id (uuid) acepte el mismo valor sin remapeo por
      // email, que era la duda del gate (experimento 6) y la condición de
      // la Fase 4 para conservar el historial de cada cliente.
      generateId: () => randomUUID(),
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 días: el panel se usa poco y a la semana
    updateAge: 60 * 60 * 24, // y se renueva una vez al día
  },

  // Sin `user.additionalFields` a propósito. Se podría declarar `telefono`
  // como campo de Better Auth y que el signUp lo trajera, pero eso añade
  // una columna propia a una tabla que mantiene el framework: cada upgrade
  // de better-auth habría que reconciliarla. El teléfono es dato de negocio
  // y se queda en public.usuarios — el front lo escribe justo después del
  // alta, ya con sesión, por la vía normal de `datos`.

  emailAndPassword: {
    enabled: true,
    // Autoconfirmación heredada del viejo trg_auto_confirmar_email
    // (migración 0010, retirada en el port: ver db/README.md).
    //
    // Riesgo aceptado y escrito: con esto, cualquiera que sepa un correo
    // puede crear una cuenta sin probar que es suyo. En el panel viejo era
    // un atajo para no montar SMTP, y aquí se mantiene porque montar SMTP es
    // otra fase que el plan no contempla. Lo que sí cambia: la fila de
    // negocio se crea con rol 'cliente' y sin teléfono verificado, así que
    // un registro spam no obtiene privilegios — solo una cuenta vacía. La
    // señal de abuso es `select count(*) from public.usuarios group by dia`.
    requireEmailVerification: false,
    minPasswordLength: 8,
    password: {
      hash: async (contraseña) => hashPassword(contraseña),
      verify: async ({ hash, password }) => {
        if (!hash) return false
        if (/^\$2[aby]\$/.test(hash)) {
          const ok = await bcrypt.compare(password, hash)
          if (ok && !mejorando.has(hash)) {
            mejorando.add(hash)
            try {
              const filas = await actualizarBcryptViejo(hash, password)
              console.log(`[auth] bcrypt aceptado → re-hash a scrypt (${filas} fila)`)
            } catch (e) {
              console.log(`[auth] bcrypt aceptado, PERO el re-hash falló: ${e.message}`)
            }
          }
          return ok
        }
        return verifyPassword({ hash, password })
      },
    },
  },

  plugins: [bearer()],

  databaseHooks: {
    user: {
      create: {
        // Sustituto exacto de auto_crear_usuario_cliente() + trg_auth_user_
        // creado. Si esto falla, el registro falla: una cuenta de login sin
        // fila de negocio es un usuario que no puede comprar.
        after: async (user) => {
          try {
            await pool.query(
              `insert into public.usuarios (id, rol, nombre, email, telefono)
               values ($1::uuid, 'cliente', $2, $3, $4)
               on conflict (id) do nothing`,
              [
                user.id,
                user.name ?? user.email?.split('@')[0] ?? 'Cliente',
                user.email ?? null,
                (user.phone ?? user.telefono) ?? null,
              ],
            )
          } catch (e) {
            console.error('[auth] hook de registro falló:', e.message)
            throw e
          }
        },
      },
    },
  },
})

// better-auth 1.7.19 usa `cors` para resolver el preflight, pero NO pinta
// `Access-Control-Allow-Origin` en las respuestas de sus propias rutas: medido en
// la rama desplegada, OPTIONS devuelve 204 con cabeceras y el 401 (o el 200 de
// `get-session`) salen sin ninguna. Sin ACAO el navegador no puede leer el body y
// el login se ve muerto aunque la base haya respondido bien. La Function es la
// dueña del origen, así que lo agrega ella sobre lo que devuelva better-auth.
const conCors = (res, origin) => {
  const h = new Headers(res.headers)
  h.set('Access-Control-Allow-Origin', ORIGENES.includes(origin) ? origin : ORIGENES[0])
  h.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  h.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  h.set('Vary', 'Origin')
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: h,
  })
}

const json = (obj, estado = 200, origin) =>
  new Response(JSON.stringify(obj), {
    status: estado,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ORIGENES.includes(origin) ? origin : ORIGENES[0],
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      Vary: 'Origin',
    },
  })

// El puente entre sesión y datos: quien ya tiene un token de sesión de
// Better Auth (bearer) recibe un JWT de datos de 15 minutos. Se llama otra
// vez cuando `datos` devuelve 401, así que la vida corta del token no se
// nota en la interfaz.
async function rutasPropias(request, url, origin) {
  if (url.pathname === '/salud')
    return json({ ok: true, function: 'auth', rama: process.env.NEON_BRANCH ?? 'local' }, 200, origin)

  if (url.pathname !== '/token') return null

  if (request.method !== 'POST')
    return json({ error: { message: 'POST esperado' } }, 405, origin)

  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user?.id)
    return json({ error: { message: 'sesión no válida' } }, 401, origin)

  // Sin campo `rol` en la respuesta. Podríamos poner `session.user.role`, pero
  // `role` no es un campo core de Better Auth y aquí nunca se declaró como
  // additionalFields: siempre sería null, y un null en la respuesta se lee
  // como «este cliente no es admin» cuando en realidad significa «el rol no
  // viaja por acá». El rol de negocio (admin/agente/cliente) se lee de
  // public.usuarios en la propia consulta — ver src/lib/auth.tsx, cargarPerfil.
  const { token, exp } = firmarToken({ sub: session.user.id, sid: session.session.id })
  return json({ token, exp }, 200, origin)
}

export default {
  async fetch(request) {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin') ?? ''

    try {
      if (request.method === 'OPTIONS') {
        // La ruta propia también necesita el preflight.
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': ORIGENES.includes(origin) ? origin : ORIGENES[0],
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Max-Age': '600',
            Vary: 'Origin',
          },
        })
      }

      const propia = await rutasPropias(request, url, origin)
      if (propia) return propia

      return conCors(await auth.handler(request), origin)
    } catch (e) {
      // Legible en `neon logs query --source function`.
      console.error('[auth] handler lanzó:', e?.stack ?? e)
      return json({ ok: false, error: String(e?.message ?? e) }, 500, origin)
    }
  },
}
