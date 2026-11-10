// Sonda de cómo se obtiene de verdad el JWT que consume la Data API.
// No es parte del gate: es el paso previo para que la Etapa A hable con
// el mecanismo real (cookie de sesión -> /token -> JWT -> Data API).
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
)
const A = env.NEON_AUTH_BASE_URL
const D = env.NEON_DATA_API_URL
const O = 'https://plans.blink.com.ve'

const dec = (t) => {
  try {
    return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'))
  } catch {
    return '<no es JWT>'
  }
}

const jar = new Map()
const guardar = (res) => {
  const raw = res.headers.getSetCookie?.() ?? []
  for (const c of raw) jar.set(c.split(';')[0].split('=')[0], c.split(';')[0].split('=')[1])
  return raw
}
const cab = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')

const mostrar = async (etiq, res) => {
  const txt = await res.text()
  console.log(`\n── ${etiq} → HTTP ${res.status}`)
  console.log('   ' + txt.slice(0, 400).replace(/\n/g, '\n   '))
  return txt
}

// 1) anónimo sin nada
await mostrar('GET /token/anonymous sin credencial', await fetch(`${A}/token/anonymous`, { headers: { Origin: O } }))
// 2) anónimo con Origin y Accept
await mostrar('GET /sign-in/anonymous', await fetch(`${A}/sign-in/anonymous`, { method: 'POST', headers: { Origin: O, 'Content-Type': 'application/json' }, body: '{}' }))
// 3) login real, con cookie
const sign = await fetch(`${A}/sign-in/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: O },
  body: JSON.stringify({ email: 'piloto@blink.test', password: 'Piloto#2026ok' }),
})
const cuerpo = JSON.parse(await mostrar('POST /sign-in/email', sign))
console.log('   set-cookie:', guardar(sign).join(' | '))
// 4) /token con la cookie de sesión
const conCookie = { Origin: O, Cookie: cab() }
const t1 = await fetch(`${A}/token`, { headers: conCookie })
const t1txt = await mostrar('GET /token (con cookie)', t1)
if (t1.ok) {
  const jwt = JSON.parse(t1txt).token
  console.log('   claims:', JSON.stringify(dec(jwt)))
  const r = await fetch(`${D}/planes?select=id&limit=1`, { headers: { Authorization: `Bearer ${jwt}`, Origin: O } })
  await mostrar('Data API con JWT de /token', r)
}
// 5) get-session con cookie: ¿trae token JWT?
await mostrar('GET /get-session (con cookie)', await fetch(`${A}/get-session`, { headers: conCookie }))
// 6) el token de sesión de Better Auth, ¿sirve en /token como bearer?
const t2 = await fetch(`${A}/token`, { headers: { Origin: O, Authorization: `Bearer ${cuerpo.token}` } })
await mostrar('GET /token (bearer = token de sesión)', t2)
