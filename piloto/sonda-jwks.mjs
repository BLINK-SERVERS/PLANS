// ============================================================
//  Sonda: ¿es fiable que la Data API valide un JWT de un proveedor EXTERNO
//  (nuestro Better Auth self-hosted)?
//
//  Antecedente medido: tras registrar el jwksUrl, una ráfaga de 12 llamadas
//  con el MISMO token dio `400 {"message":"jwk not found"}` 9 veces y 200
//  tres. Hipótesis (a) caché JWKS, (b) propagación entre instancias de la
//  Data API, (c) clave de firma efímera por isolate.
//
//  Esta sonda mide además el `kid` de cada token y los `kid` que sirve
//  /jwks, que es lo que discrimina (c): si el kid cambia entre llamadas a la misma
//  Function, la clave NO es estable y ningún esquema de caché puede salvarlo.
//
//  Uso:  node piloto/sonda-jwks.mjs [n] [ms_entre_llamadas]
// ============================================================
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
)
const A = process.env.AUTH_FN ?? 'https://br-quiet-star-beinsyb9-blinkauth.compute.c-9.us-east-2.aws.neon.tech'
const DATA = env.NEON_DATA_API_URL
const N = Number(process.argv[2] ?? 12)
const espera = Number(process.argv[3] ?? 0)

const cabecerasBase = { origin: A, 'content-type': 'application/json' }

const kidDe = (jwt) => {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[0], 'base64url').toString('utf8')).kid ?? null
  } catch {
    return null
  }
}

// ── 1. login real ────────────────────────────────────────────────────────
// La cookie hay que reconstruirla EXACTAMENTE como vino en Set-Cookie: el
// valor ya viene URL-encoded por Better Auth y el plugin bearer lo verifica
// tal cual. Usar `json().token` (el token de sesión sin firmar, 32 chars)
// no sirve: /token devolvería 401 y la JWT no existiría.
const signin = await fetch(`${A}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: cabecerasBase,
  body: JSON.stringify({ email: 'cliente.viejo@a.test', password: 'Clave#Vieja2026' }),
})
const setCookies = signin.headers.getSetCookie?.() ?? []
const cookie = setCookies.map((c) => c.split(';')[0]).join('; ')
const jwt0 = await fetch(`${A}/api/auth/token`, { headers: { ...cabecerasBase, cookie } }).then((r) => r.json())
console.log(`sign-in HTTP ${signin.status} · cookies: ${setCookies.map((c) => c.split('=')[0]).join(', ') || '—'}`)
if (!jwt0?.token) {
  console.error('No se pudo obtener la JWT:', JSON.stringify(jwt0).slice(0, 200))
  process.exit(1)
}
const jwt = jwt0.token
console.log(`JWT fresca: ${jwt.length} chars · kid=${kidDe(jwt)} · alg=${JSON.parse(Buffer.from(jwt.split('.')[0], 'base64url').toString('utf8')).alg}`)

// ── 2. ráfaga a la Data API con esa JWT ──────────────────────────────────
const estados = []
const latencias = []
for (let i = 0; i < N; i++) {
  const t0 = performance.now()
  const r = await fetch(`${DATA}/planes?select=id&limit=1`, { headers: { authorization: `Bearer ${jwt}` } })
  const cuerpo = r.ok ? '' : (await r.text()).replace(/\s+/g, ' ').slice(0, 70)
  const ms = Math.round(performance.now() - t0)
  estados.push(r.status)
  latencias.push(ms)
  console.log(`  ${String(i + 1).padStart(2)} → ${r.status} (${ms} ms) ${cuerpo}`)
  if (espera) await new Promise((res) => setTimeout(res, espera))
}

// ── 3. ¿la Function sirve siempre la misma clave? ────────────────────────
const kidsJwks = new Set()
const t1 = performance.now()
for (let i = 0; i < 6; i++) {
  const j = await fetch(`${A}/api/auth/jwks`).then((r) => r.json())
  ;(j.keys ?? []).forEach((k) => kidsJwks.add(k.kid))
  if (espera) await new Promise((res) => setTimeout(res, espera))
}
console.log(`\n/jwks en 6 peticiones (${Math.round(performance.now() - t1)} ms total): ${kidsJwks.size} kid(s) distinto(s) → ${[...kidsJwks].join(', ')}`)

// ¿Y el kid de tokens recién emitidas? Si cambia, la clave es efímera.
const kidsTokens = new Set([kidDe(jwt)])
for (let i = 0; i < 5; i++) {
  const t = await fetch(`${A}/api/auth/token`, { headers: { ...cabecerasBase, cookie } }).then((r) => r.json())
  if (t?.token) kidsTokens.add(kidDe(t.token))
}
console.log(`kid(s) de 6 JWT recién emitida(s): ${kidsTokens.size} → ${[...kidsTokens].join(', ')}`)

const ok = estados.filter((s) => s === 200).length
const p50 = [...latencias].sort((a, b) => a - b)[Math.floor(N / 2)]
console.log(`\nRESULTADO: ${ok}/${N} con 200 · ${N - ok} fallidas · p50 ${p50} ms`)
console.log(
  kidsTokens.size === 1 && kidsJwks.size === 1
    ? 'Clave ESTABLE: el fallo no es rotación; es caché/propagación de la Data API.'
    : `Clave NO ESTABLE (${kidsTokens.size} kid en tokens, ${kidsJwks.size} en /jwks): cada isolate firma con su propia pareja RSA/OKP y la Data API solo puede conocer una.`,
)
