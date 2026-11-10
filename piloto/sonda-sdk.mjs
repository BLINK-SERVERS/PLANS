// ¿El SDK gestionado manda un JWT válido a la Data API? Se comprueba con el
// cliente real y una jarra de cookies (en el navegador la cookie viene sola;
// en Node hay que llevarla a mano). Imprime lo que realmente sale por HTTP.
import { createClient } from '@neon/neon-js/supabase'
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

const jar = new Map()
const fetchConCookies = async (input, init = {}) => {
  const h = new Headers(init.headers ?? {})
  const keys = [...jar.keys()]
  if (keys.length) h.set('cookie', keys.map((k) => `${k}=${jar.get(k)}`).join('; '))
  const res = await fetch(input, { ...init, ...h })
  const url = typeof input === 'string' ? input : input.url
  if (/neonauth/.test(url)) {
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';')
      const i = kv.indexOf('=')
      jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim())
    }
  }
  return res
}

// better-auth no usa `fetch`: el gancho se llama `customFetch`.
const cliente = createClient({
  auth: { url: A, allowAnonymous: true, fetchOptions: { headers: { Origin: O }, customFetch: fetchConCookies } },
  dataApi: { url: D, options: { global: { fetch: fetchConCookies } } },
})

const entrada = await cliente.auth.signInWithPassword({ email: 'piloto@blink.test', password: 'Piloto#2026ok' })
console.log('signInWithPassword →', entrada.error ? JSON.stringify(entrada.error) : 'OK')
const ses = await cliente.auth.getSession()
console.log('getSession        →', JSON.stringify(ses).slice(0, 300))
const jwt = await cliente.auth.getJWTToken?.(true)
console.log('getJWTToken       →', String(jwt).slice(0, 24), `(${jwt?.length} chars, puntos=${(jwt?.match(/\./g) ?? []).length})`)

const q = await cliente.from('planes').select('id').limit(1)
console.log('Data API por SDK  →', q.error ? JSON.stringify(q.error) : JSON.stringify(q.data))
