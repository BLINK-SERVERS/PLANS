// ============================================================
//  Sonda: ¿qué refresca la caché de claves de la Data API?
//
//  Medido antes de este script: con el proveedor externo registrado, las
//  llamadas con una JWT válida se alternaban 200 / `400 jwk not found`, y
//  más tarde pasaron a fallar todas (10/10) con la MISMA clave (kid único
//  tanto en /jwks como en la tabla public.jwks).
//  Re-crear el proveedor con `neon data-api create` no tocó nada
//  (updated_at siguió en 10:41:50), así que queda por probar el ciclo real:
//  DELETE del proveedor + POST para volver a añadirlo, que es lo que hace la
//  consola al "Replace a provider".
//
//  Se mide la racha de respuestas en cada momento:
//    inmediato, +30 s, +60 s, +2 min, +5 min  (JWT nueva en cada ronda)
//  Si la racha buena decae con el tiempo, la caché tiene TTL y hay que
//  mantenerla tibia; si no vuelve a fallar en 5 min, el refresco fue real.
// ============================================================
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
)
const A = 'https://br-quiet-star-beinsyb9-blinkauth.compute.c-9.us-east-2.aws.neon.tech'
const DATA = env.NEON_DATA_API_URL
const PROJECT = 'curly-hill-13460111'
const BRANCH = 'br-quiet-star-beinsyb9'

const api = (method, path, body) =>
  JSON.parse(
    execFileSync('neon', ['api', path, '-X', method, ...(body ? ['-d', JSON.stringify(body)] : []), '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  )

const base = { origin: A, 'content-type': 'application/json' }
const kidDe = (j) => JSON.parse(Buffer.from(j.split('.')[0], 'base64url').toString('utf8')).kid

async function jwtNueva() {
  const si = await fetch(`${A}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: base,
    body: JSON.stringify({ email: 'cliente.viejo@a.test', password: 'Clave#Vieja2026' }),
  })
  const cookie = (si.headers.getSetCookie() ?? []).map((c) => c.split(';')[0]).join('; ')
  const j = await fetch(`${A}/api/auth/token`, { headers: { ...base, cookie } }).then((r) => r.json())
  return j?.token
}

async function ronda(nombre) {
  const jwt = await jwtNueva()
  if (!jwt) return console.log(`${nombre.padEnd(28)} sin JWT (¿proveedor caído?)`)
  const estados = []
  const err = new Set()
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`${DATA}/planes?select=id&limit=1`, { headers: { authorization: `Bearer ${jwt}` } })
    estados.push(r.status)
    if (!r.ok) err.add((await r.text()).replace(/\s+/g, ' ').slice(0, 46))
    await new Promise((res) => setTimeout(res, 120))
  }
  const ok = estados.filter((s) => s === 200).length
  console.log(`${nombre.padEnd(28)} ${estados.join(' ')} → ${ok}/5 · kid=${kidDe(jwt).slice(0, 8)}… ${ok < 5 ? [...err].join(' | ') : ''}`)
}

const actuales = api('GET', `/projects/${PROJECT}/jwks`)
console.log('proveedores antes:', actuales.jwks.map((j) => `${j.id} (añadido ${j.created_at})`).join(', ') || '—')

for (const j of actuales.jwks) {
  console.log(`DELETE /projects/${PROJECT}/jwks/${j.id} →`, api('DELETE', `/projects/${PROJECT}/jwks/${j.id}`))
}
await ronda('justo tras el DELETE')

console.log(
  'POST de alta →',
  api('POST', `/projects/${PROJECT}/jwks`, {
    jwks_url: `${A}/api/auth/jwks`,
    provider_name: 'blink-plans-piloto',
    branch_id: BRANCH,
    jwt_audience: A,
  }),
)

const t0 = Date.now()
await ronda('t+0 s (recién añadido)')
for (const hito of [30_000, 60_000, 120_000, 300_000]) {
  const faltan = hito - (Date.now() - t0)
  if (faltan > 0) await new Promise((res) => setTimeout(res, faltan))
  await ronda(`t+${hito / 1000} s`)
}
console.log(`\nhuella en /jwks: ${JSON.stringify((await fetch(`${A}/api/auth/jwks`).then((r) => r.json())).keys.map((k) => k.kid))}`)
