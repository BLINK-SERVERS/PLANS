// Piloto Etapa A — experimentos 1, 2 y 3 del gate.
//
// Habla con la Data API con el cliente real (@neon/neon-js 0.10.2) en su
// variante de "proveedor de auth externo": createClient({dataApi:{url,getToken}}).
// Esa es EXACTAMENTE la forma que va a tener producción en la Fase 6, donde el
// JWT lo firma nuestro propio Better Auth self-hosted y la Data API lo valida
// por JWKS. No es un atajo: es el mismo cable, con el emisor cambiado.
//
// El JWT se pide al servicio de Neon Auth del proyecto piloto:
//   · autenticado → POST /sign-in/email (cookie) y GET /token con esa cookie
//   · anónimo     → GET /token/anonymous (sin credencial)
// En Node la cookie hay que llevarla a mano; en el navegador viene sola.
//
// Cada bloque imprime su veredicto/exp/EXP y no asume nada: las escrituras se
// releren por lectura independiente.
import { createClient } from '@neon/neon-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
)

const AUTH_URL = env.NEON_AUTH_BASE_URL
const DATA_API_URL = env.NEON_DATA_API_URL
const EMAIL = 'piloto@blink.test'
const PASSWORD = 'Piloto#2026ok'
const ORIGEN = 'https://plans.blink.com.ve'

const veredicto = (id, ok, detalle) => {
  console.log(`\n### ${id}: ${ok ? 'PASA' : 'FALLA'}`)
  console.log(detalle)
}

// ── obtención de JWT ───────────────────────────────────────────────────
const post = async (url, body, cookie) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGEN, ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => null), cookie: (res.headers.getSetCookie()[0] ?? '').split(';')[0] }
}

const get = async (url, cookie) => {
  const res = await fetch(url, { headers: { Origin: ORIGEN, ...(cookie ? { Cookie: cookie } : {}) } })
  return { status: res.status, json: await res.json().catch(() => null) }
}

const claimsDe = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'))

let JWT = null // autenticado, role=authenticated
let JWT_ANON = null // anónimo, role=anonymous
{
  const signIn = await post(`${AUTH_URL}/sign-in/email`, { email: EMAIL, password: PASSWORD })
  if (signIn.status !== 200 || !signIn.cookie) {
    // primera vez: hay que crear la cuenta
    const up = await post(`${AUTH_URL}/sign-up/email`, { email: EMAIL, password: PASSWORD, name: 'Piloto' })
    const re = await post(`${AUTH_URL}/sign-in/email`, { email: EMAIL, password: PASSWORD })
    if (re.status !== 200) {
      console.log('### sesión: FALLA', JSON.stringify({ signIn, up, re }))
      process.exit(1)
    }
    signIn.status = re.status
    signIn.cookie = re.cookie
  }
  const t = await get(`${AUTH_URL}/token`, signIn.cookie)
  JWT = t.json?.token ?? null
  const a = await get(`${AUTH_URL}/token/anonymous`)
  JWT_ANON = a.json?.token ?? null

  console.log('### sesión')
  console.log(`  GET /token            → HTTP ${t.status} · ${JWT ? JWT.length + ' chars' : 'sin token'}`)
  console.log(`  GET /token/anonymous  → HTTP ${a.status} · ${JWT_ANON ? JWT_ANON.length + ' chars' : 'sin token'}`)
  if (JWT) console.log('  claims autenticado  →', JSON.stringify(claimsDe(JWT)))
  if (JWT_ANON) console.log('  claims anónimo      →', JSON.stringify(claimsDe(JWT_ANON)))
}
if (!JWT || !JWT_ANON) process.exit(1)

const con = (token) =>
  createClient({ dataApi: { url: DATA_API_URL, getToken: async () => token, options: { global: { headers: { Origin: ORIGEN } } } } })

const client = con(JWT)

// ── experimento 1: RPC por HTTP ────────────────────────────────────────
{
  const semilla = await client.from('pagos').select('id, monto, estado').limit(1)
  if (semilla.error) {
    veredicto('1 RPC por HTTP', false, 'ni siquiera se puede leer pagos: ' + JSON.stringify(semilla.error))
    process.exit(1)
  }
  const pago = semilla.data[0]
  const nuevoMonto = Math.round((Number(pago.monto) + 111.11) * 100) / 100

  const rpc = await client.rpc('editar_pago', { p_id: pago.id, p_monto: nuevoMonto, p_estado: 'recalculado' })
  const status = rpc.error ? undefined : rpc.status

  // Verificación independiente: ¿el cambio está de verdad en la tabla?
  const despues = await client.from('pagos').select('id, monto, estado').eq('id', pago.id).single()

  const efectoReal =
    !despues.error &&
    Number(despues.data.monto) === nuevoMonto &&
    despues.data.estado === 'recalculado'

  veredicto(
    '1 RPC por HTTP (POST /rpc/editar_pago)',
    !rpc.error && efectoReal,
    [
      `error: ${rpc.error ? JSON.stringify(rpc.error) : 'ninguno'}`,
      `data devuelta por la función: ${JSON.stringify(rpc.data)}`,
      `estado en tabla tras el RPC: ${JSON.stringify(despues.data)}`,
      `antes: ${pago.monto}/${pago.estado} → ahora se esperaba ${nuevoMonto}/recalculado`,
      efectoReal ? 'EFECTO REAL: la escritura se materializó' : 'El RPC no mutó nada',
    ].join('\n'),
  )

  // RPC prohibido al anónimo: la función comprueba el claim role del JWT.
  const rpcAnon = await con(JWT_ANON).rpc('editar_pago', { p_id: pago.id, p_monto: 1, p_estado: 'deberia_fallar' })
  console.log(
    `   anónimo intentando editar_pago → HTTP ${rpcAnon.status} error=${JSON.stringify(rpcAnon.error)} (se ESPERA un 42501)`,
  )
}

// ── experimento 2: vista + embeds, count, Range, !inner ────────────────
{
  const plano = await client.from('v_catalogo_publico').select('*')
  console.log('\n### 2 vista como recurso de la Data API')
  console.log(`  select='*' → ${plano.error ? JSON.stringify(plano.error) : plano.data?.length + ' filas'}`)

  const embebido = await client.from('v_catalogo_publico').select('*, proveedores(id, nombre)')
  console.log(`  embed a través de la vista → ${embebido.error ? JSON.stringify(embebido.error) : 'sin error'}`)
  console.log(`  primera fila: ${JSON.stringify(embebido.data?.[0])}`)
  const hayObjetoRelacion =
    Array.isArray(embebido.data) &&
    embebido.data.length > 0 &&
    (typeof embebido.data[0].proveedores === 'object' || typeof embebido.data[0].planes === 'object')

  const joinDirecto = await client.from('planes').select('*, proveedores(id, nombre)').limit(2)
  console.log(`  embed sobre TABLA (control) → ${joinDirecto.error ? JSON.stringify(joinDirecto.error) : 'sin error'}`)
  console.log(`  control: ${JSON.stringify(joinDirecto.data?.[0])}`)

  const cnt = await client.from('v_catalogo_publico').select('*', { count: 'exact', head: true })
  console.log(`  count=exact → error=${JSON.stringify(cnt.error)} count=${cnt.count}`)

  const rng = await client.from('v_catalogo_publico').select('*').range(0, 9)
  console.log(`  Range 0-9 → ${rng.error ? JSON.stringify(rng.error) : rng.data?.length + ' filas (esperaba 10)'}`)

  const inner = await client.from('planes').select('*, proveedores!inner(nombre)').eq('publicado', true).limit(3)
  console.log(`  !inner sobre tabla → ${inner.error ? JSON.stringify(inner.error) : inner.data?.length + ' filas'}`)

  const innerVista = await client.from('v_catalogo_publico').select('*, proveedores!inner(nombre)').limit(3)
  console.log(`  !inner sobre VISTA → ${innerVista.error ? JSON.stringify(innerVista.error) : innerVista.data?.length + ' filas'}`)

  veredicto(
    '2 embeds a través de vistas',
    !plano.error && hayObjetoRelacion,
    hayObjetoRelacion
      ? 'La vista SÍ expone la relación embebida: se puede consultar v_catalogo_publico con join.'
      : 'La vista no resuelve embeds: hay que consultar la vista y hacer el join en cliente (o exponer el catálogo por su tabla base).',
  )
}

// ── experimento 3: anonimato ───────────────────────────────────────────
{
  const anon = con(JWT_ANON)
  const catalogo = await anon.from('v_catalogo_publico').select('*')
  const privado = await anon.from('pagos').select('*')
  console.log('\n### 3 tienda anónima (JWT role=anonymous)')
  console.log(`  catálogo → ${catalogo.error ? JSON.stringify(catalogo.error) : catalogo.data?.length + ' filas'}`)
  console.log(`  pagos    → ${privado.error ? JSON.stringify(privado.error) : 'DEVOLVIÓ DATOS: ' + privado.data?.length + ' filas'}`)
  veredicto(
    '3 rol anónimo vía JWT con role=anonymous',
    !catalogo.error && (privado.error !== null || privado.data?.length === 0),
    `catálogo visible = ${!catalogo.error}; pagos bloqueado por RLS = ${privado.error ? 'error ' + privado.error.code : (privado.data?.length ?? 0) + ' filas'}`,
  )
}

console.log('\n(fin de la Etapa A)')
