// ============================================================
//  Observatorio de decaimiento: ¿cuánto aguanta verde la validación de
//  nuestras JWT en la Data API SIN tocar la Function de auth?
//
//  Contexto medido hoy:
//    - Proveedor externo añadido 10:41:50 → 200 entre 10:42 y ~10:47.
//    - A partir de ~10:51 las mismas llamadas con la misma clave pasan a
//      `400 jwk not found` de forma estable (0/10, 0/5, 0/5…).
//    - DELETE + POST del proveedor (10:56:14) lo arregla, pero tarda ~2 min
//      en propagarse: t+0 0/5, t+30 0/5, t+60 0/5, t+120 5/5.
//
//  Este script mide lo que importa para la Fase 6: si la Data API refresca
//  sola el JWKS (y por tanto el panel puede vivir de ella) o si se apaga al
//  expirar la caché porque el refresco interno falla contra una Function fría.
//
//  Diseño: UNA JWT al principio (exp 15 min) y luego una llamada cada 30 s
//  durante 13 min. No se vuelve a llamar a la Function de auth: así queda
//  aislado el único que la consulta, que es el propio validador de Neon, y la
//  Function puede enfriarse como en producción real.
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
const RONDA = Number(process.argv[2] ?? 26)
const INTERVALO = Number(process.argv[3] ?? 30_000)

const base = { origin: A, 'content-type': 'application/json' }
const si = await fetch(`${A}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: base,
  body: JSON.stringify({ email: 'cliente.viejo@a.test', password: 'Clave#Vieja2026' }),
})
const cookie = (si.headers.getSetCookie() ?? []).map((c) => c.split(';')[0]).join('; ')
const jwt = (await fetch(`${A}/api/auth/token`, { headers: { ...base, cookie } }).then((r) => r.json())).token
const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'))
const kid = JSON.parse(Buffer.from(jwt.split('.')[0], 'base64url').toString('utf8')).kid
console.log(`JWT única kid=${kid} · caduca en ${(payload.exp - payload.iat) / 60} min · después NO se toca la Function`)

const t0 = Date.now()
const marcas = []
for (let i = 0; i < RONDA; i++) {
  const r = await fetch(`${DATA}/planes?select=id&limit=1`, { headers: { authorization: `Bearer ${jwt}` } })
  const cuerpo = r.ok ? '' : ' ' + (await r.text()).replace(/\s+/g, ' ').slice(0, 40)
  const seg = Math.round((Date.now() - t0) / 1000)
  marcas.push(r.status)
  console.log(`t+${String(seg).padStart(4)} s  ${r.status}${cuerpo}`)
  const falta = (i + 1) * INTERVALO - (Date.now() - t0)
  if (falta > 0) await new Promise((res) => setTimeout(res, falta))
}
const ok = marcas.filter((s) => s === 200).length
const primeraMala = marcas.findIndex((s) => s !== 200)
console.log(`\n${ok}/${marcas.length} con 200 · ${primeraMala === -1 ? 'sin fallos' : `primer fallo en t+${primeraMala * (INTERVALO / 1000)} s`}`)
