// ============================================================
//  ¿Cuando la Data API responde 200 con nuestro JWT externo, de verdad corrió
//  como `authenticated`, o cayó silenciosamente a `anonymous`?
//
//  Importa por seguridad: si un token que no valida se degrada a anónimo en vez
//  de rechazarse, la protección real es RLS/grants y el 200 no prueba nada.
//  Discriminador elegido con lo ya medido en el piloto:
//    - `pagos` para anonymous  → 42501 permission denied (experimento 3)
//    - `rpc/editar_pago` anónimo → 403 con el mensaje propio
//      «editar_pago prohibido al anónimo» (experimento 1)
//  Así que sobre `pagos`:
//    200  = rol authenticated aplicado de verdad
//    42501/403 = el token NO se aplicó (cayó a anonymous)
//    400 «jwk not found» = rechazado en la validación
//  Se compara además con el mismo token gestionado por Neon (si el proveedor
//  externo sigue caído, el gestionado no aplica; por eso la comparación es
//  secuencial, no simultánea).
// ============================================================
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
)
const A = 'https://br-quiet-star-beinsyb9-blinkauth.compute.c-9.us-east-2.aws.neon.tech'
const DATA = env.NEON_DATA_API_URL
const base = { origin: A, 'content-type': 'application/json' }

const si = await fetch(`${A}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: base,
  body: JSON.stringify({ email: 'cliente.viejo@a.test', password: 'Clave#Vieja2026' }),
})
const cookie = (si.headers.getSetCookie() ?? []).map((c) => c.split(';')[0]).join('; ')
const jwt = (await fetch(`${A}/api/auth/token`, { headers: { ...base, cookie } }).then((r) => r.json())).token
console.log(`JWT nuestra, sub=${JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')).sub}`)

const llama = async (ruta, opts = {}) => {
  const r = await fetch(`${DATA}${ruta}`, { headers: { authorization: `Bearer ${jwt}`, ...opts } })
  const t = (await r.text()).replace(/\s+/g, ' ')
  return `${r.status} ${t.slice(0, 100)}`
}

for (let i = 1; i <= 8; i++) {
  console.log(`  ${i}  GET /pagos con la JWT → ${await llama('/pagos?select=id&limit=1')}`)
  await new Promise((r) => setTimeout(r, 200))
}

// Control: la misma tabla sin ninguna credencial. Es el rol anonymous, así que
// si arriba aparece el mismo código, el token no se aplicó.
const r = await fetch(`${DATA}/pagos?select=id&limit=1`)
console.log(`     sin Authorization       → ${r.status} ${(await r.text()).replace(/\s+/g, ' ').slice(0, 90)}`)
