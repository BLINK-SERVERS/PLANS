// ============================================================
//  piloto/sonda-bcrypt.mjs — el login de un cliente IMPORTADO, medido
// ============================================================
//  Es la verificación que la Fase 5 exige y la que el plan convierte en
//  promesa de producto: "ningún cliente restablece su contraseña". Un
//  bcrypt de GoTrue tiene que entrar con su clave de siempre y, en ese
//  mismo request, el hash tiene que quedar reescrito a scrypt. Si esto
//  falla, la migración se para: sería peor que quedarse en Supabase.
//
//  Mide cuatro cosas, en orden, contra funciones REALES (neon dev en
//  :4000 auth, :4100 datos) y no contra el config exportado:
//
//    1) que el bcrypt se verifica  → 200 + token de sesión.
//    2) que el re-hash OCURRIÓ     → account.password ya no empieza por $2.
//    3) que el scrypt nuevo FUNCIONA → segundo login con la misma clave.
//       (Este es el punto que un test superficial deja pasar: si el formato
//       escrito no es el que `verifyPassword` espera, el cliente entra una
//       vez y queda locked out para siempre. Solo se comprueba volviendo a
//       entrar con lo que se escribió.)
//    4) que la sesión importada LLEGA A LOS DATOS → /token + /consulta, o
//       sea que el cliente ve su propia fila y solo la suya.
//
//  El Origin se manda deliberadamente cross-origin (5173 ≠ baseURL 4000),
//  que es lo que hará el navegador desde plans.blink.com.ve. Con eso se
//  detectó que `cors.origin` NO basta: el origen también tiene que estar en
//  `trustedOrigins` — ver functions/auth/index.mjs.
//
//  Uso:  node piloto/sonda-bcrypt.mjs [--quedarse]
//  Requiere las tres Functions en `neon dev` y las credenciales en
//  .env.local. Al terminar borra la fila sembrada (--quedarse la deja).

import { readFileSync } from 'node:fs'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
)

const AUTH = process.env.AUTH_URL ?? 'http://localhost:4000'
const DATOS = process.env.DATOS_URL ?? 'http://localhost:4100'
const ORIGEN = 'http://localhost:5173' // cross-origin contra baseURL: como en producción

const UID = '0a1b2c3d-0000-4000-8000-0000000000aa'
const EMAIL = 'viejo@importado.test'
const CLAVE = 'ClaveVieja123'
const QUEDARSE = process.argv.includes('--quedarse')

const pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 })
const q = (texto, valores) => pool.query(texto, valores)

const resultados = []
const marcar = (n, ok, detalle) => {
  resultados.push({ n, ok, detalle })
  console.log(`${ok ? '  ✓' : '  ✗'} ${n}${detalle ? ` — ${detalle}` : ''}`)
}

const signIn = async () => {
  const res = await fetch(`${AUTH}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGEN },
    body: JSON.stringify({ email: EMAIL, password: CLAVE }),
  })
  let cuerpo = null
  try {
    cuerpo = await res.json()
  } catch {
    cuerpo = null
  }
  return { estado: res.status, cuerpo }
}

const leerHash = async () =>
  (await q(`select password from public.account where "userId" = $1`, [UID])).rows[0]?.password ?? null

async function sembrar() {
  // Coste 10, como GoTrue. Lo que importa es el prefijo $2b$, no el coste.
  const hash = bcrypt.hashSync(CLAVE, 10)
  await q(`delete from public."user" where id = $1`, [UID]) // account/session caen por FK
  await q(
    `insert into public."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     values ($1, 'Cliente Importado', $2, true, now(), now())`,
    [UID, EMAIL],
  )
  await q(
    `insert into public.account
       (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
     values ($1, $1, 'credential', $1, $2, now(), now())`,
    [UID, hash],
  )
  await q(
    `insert into public.usuarios (id, rol, nombre, email)
     values ($1::uuid, 'cliente', 'Cliente Importado', $2)
     on conflict (id) do update set email = excluded.email`,
    [UID, EMAIL],
  )
  console.log(`semilla bcrypt: ${hash.slice(0, 7)}… (${hash.length} chars)`)
  return hash
}

async function main() {
  const hashViejo = await sembrar()

  // ---- 1) el bcrypt se verifica ------------------------------------------
  console.log('\n── 1) primer login con el bcrypt heredado')
  const uno = await signIn()
  const token = uno.cuerpo?.token
  marcar('sign-in devuelve 200', uno.estado === 200, `HTTP ${uno.estado} ${JSON.stringify(uno.cuerpo?.error ?? uno.cuerpo?.message ?? '').slice(0, 90)}`)
  marcar('devuelve token de sesión (bearer)', Boolean(token), token ? `${token.slice(0, 10)}…` : 'sin token')
  if (!token) throw new Error('sin token no hay nada que seguir midiendo')

  // ---- 2) el re-hash ocurrió --------------------------------------------
  console.log('\n── 2) account.password después del login')
  // Se sondea en vez de leer una vez: el UPDATE va dentro del mismo request,
  // pero el pool puede servir la primera lectura antes de que se vea. Null
  // significa "todavía no", no "no hay fila" — por eso la condición no puede
  // ser un simple `!== hashViejo`.
  let hashNuevo = null
  for (let i = 0; i < 30 && (hashNuevo === null || hashNuevo === hashViejo); i++) {
    await new Promise((r) => setTimeout(r, 200))
    hashNuevo = await leerHash()
  }
  marcar('el hash cambió', hashNuevo !== null && hashNuevo !== hashViejo, `ahora empieza por ${String(hashNuevo).slice(0, 12)}…`)
  marcar('ya NO es bcrypt', !/^\$2[aby]\$/.test(hashNuevo ?? ''))
  // Better Auth escribe scrypt como `salt:hash` (32 hex + ':' + 128 hex), sin prefijo.
  marcar('con la forma nativa salt:hash', /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(hashNuevo ?? ''), `${(hashNuevo ?? '').split(':')[0]?.length}+${(hashNuevo ?? '').split(':')[1]?.length} hex, ${String(hashNuevo).length} chars`)

  // ---- 3) el scrypt nuevo verifica --------------------------------------
  console.log('\n── 3) segundo login con el hash reescrito')
  const dos = await signIn()
  marcar('vuelve a entrar con la misma clave', dos.estado === 200, `HTTP ${dos.estado} ${JSON.stringify(dos.cuerpo?.error ?? dos.cuerpo?.message ?? '').slice(0, 90)}`)
  const hashTres = await leerHash()
  marcar('y no se re-hashea en bucle', hashTres === hashNuevo, 'el scrypt no vuelve a escribirse')

  // ---- 4) la sesión importada llega a los datos --------------------------
  console.log('\n── 4) /token → /consulta con la cuenta importada')
  const tok = await fetch(`${AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${dos.cuerpo.token}` , Origin: ORIGEN },
  }).then((r) => r.json())
  marcar('POST /token acuña JWT de datos', Boolean(tok?.token), tok?.exp ? `exp ${new Date(tok.exp * 1000).toISOString()}` : JSON.stringify(tok).slice(0, 90))

  const consulta = await fetch(`${DATOS}/consulta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok.token}`, Origin: ORIGEN },
    body: JSON.stringify({ from: 'usuarios', calls: [['select', 'id,rol,nombre,email'], ['eq', 'id', UID], ['single']] }),
  }).then((r) => r.json())
  marcar('RLS deja ver SU fila', consulta?.data?.rol === 'cliente', JSON.stringify(consulta?.data ?? consulta?.error).slice(0, 120))

  // La prueba inversa: sin token, esa misma fila no se lee.
  const anon = await fetch(`${DATOS}/consulta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGEN },
    body: JSON.stringify({ from: 'usuarios', calls: [['select', 'id,rol'], ['eq', 'id', UID]] }),
  })
  marcar('y un anónimo NO la lee', anon.status === 403, `HTTP ${anon.status}`)

  if (!QUEDARSE) {
    await q(`delete from public."user" where id = $1`, [UID])
    await q(`delete from public.usuarios where id = $1::uuid`, [UID])
    console.log('\nsemilla borrada (--quedarse para inspeccionarla)')
  }

  const fallan = resultados.filter((r) => !r.ok)
  console.log(`\n${'─'.repeat(58)}`)
  console.log(`${resultados.length - fallan.length}/${resultados.length} controles en verde`)
  if (fallan.length) {
    console.log('FALLOS:')
    for (const f of fallan) console.log(`  · ${f.n}: ${f.detalle}`)
    process.exitCode = 1
  }
}

main()
  .catch((e) => {
    console.error('\nsonda interrumpida:', e?.message ?? e)
    if (e?.stack) console.error(e.stack.split('\n').slice(0, 4).join('\n'))
    process.exitCode = 1
  })
  .finally(() => pool.end())
