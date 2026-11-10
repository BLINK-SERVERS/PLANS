// Piloto Etapa B — experimentos 6 y 7 del gate, contra la base Neon del piloto.
//
// Se levanta el Better Auth self-hosted de auth.config.mjs en un servidor HTTP
// local (mismo handler que va a correr dentro de la Neon Function en la Fase 5)
// y se comprueba, con evidencia y no con fe:
//
//  6. Un usuario creado con el UUID del proyecto viejo — no remapeado por
//     email — sirve de identidad real de Better Auth y una tabla de negocio
//     (public.usuarios) lo referencia por FK sin romper nada.
//  7. Un hash bcrypt heredado de Supabase ($2a$/$2b$) verifica, y tras el
//     primer login correcto queda re-hasheado al scrypt nativo de Better
//     Auth; el segundo login con el hash nuevo también funciona.
//
// Cada bloque imprime su veredicto explícito.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import bcrypt from 'bcryptjs'
import auth, { pool } from './auth.config.mjs'

const env = Object.fromEntries(
  readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
)
const DATA_API_URL = env.NEON_DATA_API_URL

const veredicto = (id, ok, detalle) => {
  console.log(`\n### ${id}: ${ok ? 'PASA' : 'FALLA'}`)
  console.log(detalle)
}

const UUID_VIEJO_1 = '0f1e2d3c-4b5a-9877-6655-4433221100aa' // hash $2a$
const UUID_VIEJO_2 = '0f1e2d3c-4b5a-9877-6655-4433221100bb' // hash $2b$
const CLAVE_VIEJA = 'Clave#Vieja2026'

const servidor = createServer(async (req, res) => {
  const body = req.method === 'POST' ? await new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)) }) : undefined
  const r = await auth.handler(new Request(`http://localhost:4000${req.url}`, { method: req.method, headers: req.headers, body }))
  res.writeHead(r.status, Object.fromEntries(r.headers))
  res.end(Buffer.from(await r.arrayBuffer()))
})
await new Promise((r) => servidor.listen(4000, r))
const base = 'http://localhost:4000/api/auth'
const api = async (ruta, cuerpo, headers = {}) => {
  const res = await fetch(`${base}${ruta}`, {
    method: cuerpo ? 'POST' : 'GET',
    // Better Auth exige Origin en las peticiones con cuerpo (anti-CSRF): en el
    // navegador viene sola, aquí hay que declararla.
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:4000', ...headers },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  })
  return {
    status: res.status,
    json: await res.json().catch(() => null),
    setCookie: res.headers.getSetCookie(),
    headers: Object.fromEntries(res.headers),
  }
}

// ── alta "migrada": el UUID viejo es la identidad, sin remapear por email ──
// Hallazgo del gate: Better Auth declara user.id como TEXT, no UUID. Una FK
// directa uuid→text se rechaza con 42804 "incompatible types". Lo que sí
// funciona: la columna de negocio es text (guarda el uuid viejo tal cual) y
// se expone una generada uuid para seguir JOIN-eando en uuid sin tocar nada.
{
  await pool.query('begin')
  // Se limpio antes de sembrar: el experimento tiene que ver UN $2a$ y UN $2b$
  // frescos en cada corrida, no el hash ya upgradeado de la corrida anterior.
  // El borrado va en orden inverso a las FK: session → account → user.
  await pool.query(`delete from public.session where "userId" in ($1, $2)`, [UUID_VIEJO_1, UUID_VIEJO_2])
  await pool.query(`delete from public.account where "userId" in ($1, $2)`, [UUID_VIEJO_1, UUID_VIEJO_2])
  await pool.query(`delete from public.usuarios where id in ($1, $2)`, [UUID_VIEJO_1, UUID_VIEJO_2])
  await pool.query(`delete from public."user" where id in ($1, $2)`, [UUID_VIEJO_1, UUID_VIEJO_2])
  await pool.query(`
    create table if not exists public.usuarios (
      id         text primary key references "public"."user"(id) on delete cascade,
      uid        uuid generated always as (id::uuid) stored,
      telefono   text,
      es_admin   boolean not null default false
    )`)
  const hash2a = '$2a$' + bcrypt.hashSync(CLAVE_VIEJA, 10).slice(4)
  const hash2b = bcrypt.hashSync(CLAVE_VIEJA, 10)
  for (const [id, email, hash, prefijo] of [
    [UUID_VIEJO_1, 'cliente.viejo@a.test', hash2a, '$2a$'],
    [UUID_VIEJO_2, 'cliente.viejo@b.test', hash2b, '$2b$'],
  ]) {
    await pool.query(
      `insert into "public"."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, 'Cliente Migrado', $2, false, now(), now())
       on conflict (id) do nothing`,
      [id, email],
    )
    // Regla leída en better-auth/dist/api/routes/sign-in.mjs:318: para aceptar
    // un login por contraseña, el account tiene que ser providerId='credential'
    // Y accountId === user.id. Con accountId = email el login NUNCA llega a
    // verificar la contraseña y devuelve el aviso "INVALID_EMAIL_OR_PASSWORD"
    // (es el señuelo anti-enumeración, no un fallo de bcrypt).
    await pool.query(
      `insert into public.account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
       values (gen_random_uuid()::text, $1, 'credential', $1, $2, now(), now())
       on conflict do nothing`,
      [id, hash],
    )
    console.log(`  sembrado ${email} con hash ${prefijo}… (${hash.slice(0, 7)}…, id=${id})`)
  }
  await pool.query(`insert into public.usuarios (id, telefono, es_admin) values ($1, '+58 414 000 0000', true)
                    on conflict do nothing`, [UUID_VIEJO_1])
  await pool.query('commit')
}

// ── experimento 7: bcrypt → scrypt en el primer login ──────────────────
{
  const antes = await pool.query(
    `select a.password from public.account a join "public"."user" u on u.id = a."userId" where u.email = $1`,
    ['cliente.viejo@a.test'],
  )
  const login = await api('/sign-in/email', { email: 'cliente.viejo@a.test', password: CLAVE_VIEJA })
  const despues = await pool.query(
    `select a.password from public.account a join "public"."user" u on u.id = a."userId" where u.email = $1`,
    ['cliente.viejo@a.test'],
  )
  const origen = antes.rows[0]?.password ?? ''
  const nuevo = despues.rows[0]?.password ?? ''
  // Formato nativo medido en la BD: 32 hex (sal) ':' 128 hex (clave) = 161 chars.
  const esScrypt = /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(nuevo)

  // Segundo login: el hash ya nativo tiene que seguir verificando.
  const login2 = await api('/sign-in/email', { email: 'cliente.viejo@a.test', password: CLAVE_VIEJA })
  // Y la clave mala tiene que seguir rechazándose, con hash upgradeado o sin él.
  const loginMal = await api('/sign-in/email', { email: 'cliente.viejo@a.test', password: 'no-es-la-clave' })

  // El otro usuario, con $2b$, por si el formato importa.
  const loginB = await api('/sign-in/email', { email: 'cliente.viejo@b.test', password: CLAVE_VIEJA })

  veredicto(
    '7 bcrypt heredado verifica y se re-hashea a scrypt',
    login.status === 200 && origen.startsWith('$2a$') && esScrypt && login2.status === 200 && loginMal.status !== 200 && loginB.status === 200,
    [
      `hash antes:  ${origen.slice(0, 12)}… (${origen.slice(0, 4)})`,
      `hash después:${nuevo.slice(0, 12)}…  formato scrypt nativo = ${esScrypt}`,
      `login 1 (bcrypt)          → HTTP ${login.status}`,
      `login 2 (ya scrypt)       → HTTP ${login2.status}`,
      `login clave incorrecta    → HTTP ${loginMal.status} ${JSON.stringify(loginMal.json?.message ?? loginMal.json?.code ?? '')}`,
      `login con hash $2b$       → HTTP ${loginB.status}`,
      `id devuelto por Better Auth: ${login.json?.user?.id} (¿es el UUID viejo? ${login.json?.user?.id === UUID_VIEJO_1})`,
    ].join('\n'),
  )
}

// ── experimento 6: identidad, FK y JWT con claim role ──────────────────
{
  const login = await api('/sign-in/email', { email: 'cliente.viejo@a.test', password: CLAVE_VIEJA })
  const cookie = login.setCookie.map((c) => c.split(';')[0]).join('; ')

  const fk = await pool.query(
    `select u.id, u.email, n.uid, n.telefono, n.es_admin
       from "public"."user" u
       join public.usuarios n on n.id = u.id
      where u.id = $1`,
    [UUID_VIEJO_1],
  )

  // El endpoint /token del plugin jwt pide sesión: se la damos con la cookie
  // que devolvió el sign-in. En producción el navegador la trae sola; el panel
  // de BLINK que llame por API usará el token de sesión como bearer.
  const tok = await api('/token', null, { Cookie: cookie })
  const jwt = tok.json?.token
  const claims = jwt ? JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')) : null

  // ¿El JWT sirve como credencial de sesión (plugin bearer)? NO — hallazgo de
  // la Etapa B leyendo dist/plugins/bearer/index.mjs: el bearer recibe el token
  // de sesión firmado con el secret de la app (lo que Better Auth devuelve en
  // la cabecera `set-auth-token`), no el JWT del plugin jwt. El JWT es la
  // credencial de la Data API; el token de sesión es la de Better Auth.
  const tokenSesion = login.headers['set-auth-token']
  const porBearer = await api('/get-session', null, { Authorization: `Bearer ${tokenSesion}` })
  const bearerConJWT = await api('/get-session', null, { Authorization: `Bearer ${jwt}` })

  const jwks = await fetch('http://localhost:4000/api/auth/jwks').then((r) => r.json())

  // ¿La Data API acepta un JWT firmado por nuestro propio Better Auth?
  // Solo cuando el project registre el jwksUrl; aquí se comprueba el claim,
  // que es lo que decide el SET ROLE.
  const dataApi = jwt ? await fetch(`${DATA_API_URL}/planes?select=id&limit=1`, { headers: { Authorization: `Bearer ${jwt}` } }) : null
  const dataApiCuerpo = dataApi ? await dataApi.text() : null

  veredicto(
    '6 UUID existente como identidad de Better Auth, con FK y JWT propio',
    login.status === 200 && login.json?.user?.id === UUID_VIEJO_1 && fk.rows.length === 1 && claims?.role === 'authenticated' && porBearer.json?.user?.id === UUID_VIEJO_1,
    [
      `sign-in con UUID impuesto → user.id = ${login.json?.user?.id}`,
      `FK pública: public.usuarios→public.user → ${fk.rows.length === 1 ? 'OK' : 'ROTA'} (${JSON.stringify(fk.rows[0])})`,
      `GET /token (bearer)       → HTTP ${tok.status} · ${jwt ? jwt.length + ' chars' : 'sin token'}`,
      `claims                    → ${JSON.stringify(claims)}`,
      `claim role (= SET ROLE de la Data API) → ${JSON.stringify(claims?.role)}`,
      `GET /jwks                 → ${jwks?.keys?.length ?? 0} clave(s) ${jwks?.keys?.[0] ? `alg=${jwks.keys[0].alg} kid=${String(jwks.keys[0].kid).slice(0, 8)}…` : ''}`,
      `Bearer <set-auth-token> → /get-session HTTP ${porBearer.status} · ${String(JSON.stringify(porBearer.json?.user?.email ?? porBearer.json ?? null)).slice(0, 120)}`,
      `Bearer <JWT>            → /get-session HTTP ${bearerConJWT.status} · ${String(JSON.stringify(bearerConJWT.json ?? null)).slice(0, 60)} (se espera null: el JWT no es token de sesión)`,
      `Data API con NUESTRO JWT  → HTTP ${dataApi?.status ?? 'n/a'} · ${String(dataApiCuerpo).slice(0, 160)}`,
      '   (la Data API solo valida JWTs de proveedores registrados; esto se cierra en la Fase 5 al publicar el jwksUrl)',
    ].join('\n'),
  )
}

servidor.close()
await pool.end()
console.log('\n(fin de la Etapa B)')
