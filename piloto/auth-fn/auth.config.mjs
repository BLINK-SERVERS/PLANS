// Better Auth self-hosted del piloto (experimentos 6 y 7 del gate).
//
// Es el config que la Fase 5 va a montar dentro de una Neon Function:
//   · tablas en `public`: hallazgo de la Etapa B, `database.schemaName` no
//     separa nada (ni el CLI al migrar ni el runtime al consultar, que usa
//     nombres sin cualificar por search_path; y el endpoint pool de Neon
//     rechaza search_path en el paquete de arranque). La protección real es
//     RLS + no exponer estas tablas en la Data API.
//   · plugin jwt con definePayload → claim `role`. La Data API hace SET ROLE
//     con ese claim; sin él cae en `anonymous`.
//   · plugin bearer → el cliente manda `Authorization: Bearer <jwt>`.
//   · password.verify con bcrypt: los clientes viejos traen hash $2a$/$2b$
//     heredado de Supabase y a ninguno se le va a reiniciar la contraseña.
//     Al verificar bien, se re-hashea al scrypt nativo de Better Auth.
import { betterAuth } from 'better-auth'
import { jwt, bearer } from 'better-auth/plugins'
import { hashPassword } from 'better-auth/crypto'
import { PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import { readFileSync } from 'node:fs'

// Dos orígenes de configuración, porque el piloto corre de las dos formas:
//   · local (etapa-b.mjs): lee .env.local y escucha en localhost:4000.
//   · dentro de una Neon Function: DATABASE_URL va inyectada por Neon y la
//     baseURL tiene que ser la URL pública de la Function (Better Auth
//     compara el Origin/Referer contra ella).
let desdeArchivo = {}
try {
  // Solo existe en local: dentro de la Function el bundle es un único archivo
  // y .env.local no viaja (no se versiona).
  desdeArchivo = Object.fromEntries(
    readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
      .split('\n')
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
  )
} catch {
  desdeArchivo = {}
}
const DATABASE_URL = process.env.DATABASE_URL ?? desdeArchivo.DATABASE_URL
const BASE_URL = process.env.PILOTO_AUTH_BASE_URL ?? 'http://localhost:4000'

export const pool = new Pool({ connectionString: DATABASE_URL, max: 3 })

export const SECRET = process.env.PILOTO_AUTH_SECRET ?? 'piloto-secret-para-el-gate-no-sale-del-repo-0000'

// Actualiza el hash guardado cuando se verificó un bcrypt antiguo. No hay id
// de usuario dentro de verify(), así que se casa por el propio hash: es único
// porque bcrypt lleva la sal incrustada.
const upgrading = new Set()
async function upgradeToScrypt(oldHash, plainPassword) {
  const nuevo = await hashPassword(plainPassword)
  // Columnas camelCase entre comillas: así las creó el CLI de Better Auth.
  // El UPDATE va en public porque el runtime de Better Auth consulta por
  // search_path (hallazgo de la Etapa B: schemaName no separa las tablas).
  const r = await pool.query(
    `update public.account set "password" = $1, "updatedAt" = now() where "password" = $2`,
    [nuevo, oldHash],
  )
  return { nuevo, filas: r.rowCount }
}

export default betterAuth({
  appName: 'blink-plans-piloto',
  baseURL: BASE_URL,
  secret: SECRET,
  // CORS: la Function se llama desde plans.blink.com.ve, un origin distinto
  // del de la propia Function. Better Auth valida Origin/Referer contra
  // baseURL, así que además hace falta registrar el origin del front.
  cors: { origin: ['http://localhost:5173', 'https://plans.blink.com.ve', BASE_URL], credentials: true },
  database: {
    dialect: new PostgresDialect({ pool }),
    type: 'postgres',
    // schemaName omitido a propósito: ver el hallazgo de la Etapa B.
    transaction: false,
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    password: {
      hash: async (password) => hashPassword(password),
      verify: async ({ hash, password }) => {
        if (!hash) return false
        if (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$')) {
          const ok = await bcrypt.compare(password, hash)
          // El re-hash es una mejora: si falla, el login NO puede fallar con él.
          if (ok && !upgrading.has(hash)) {
            upgrading.add(hash)
            try {
              const { filas } = await upgradeToScrypt(hash, password)
              console.log(`   [verify] bcrypt aceptado → re-hash a scrypt (${filas} fila(s) actualizadas)`)
            } catch (e) {
              console.log(`   [verify] bcrypt aceptado, PERO el re-hash falló: ${e.message}`)
            }
          }
          return ok
        }
        // Formato nativo de Better Auth: salt(32 hex):hash(128 hex), sin prefijo.
        const { verifyPassword } = await import('better-auth/crypto')
        return verifyPassword({ hash, password })
      },
    },
  },
  plugins: [
    jwt({
      // Los ajustes del JWT van NESTADOS bajo `jwt:` (better-auth/dist/plugins/
      // jwt/sign.mjs:120 lee options.jwt.definePayload). Poniéndolos sueltos se
      // ignoran en silencio y el payload sale con el objeto user completo —
      // sin `role`, que es justo el claim que la Data API necesita para el
      // SET ROLE. Con role ausente la sesión autenticada caería en anonymous.
      jwt: {
        definePayload: ({ user }) => ({
          role: 'authenticated',
          email: user.email,
          name: user.name,
        }),
      },
    }),
    bearer(),
  ],
  advanced: { cookiePrefix: 'blink' },
})
