// ============================================================
//  db/importar/cuentas.mjs — auth.users (GoTrue) → public.user + public.account
// ============================================================
//  Después de volcar.sh, los NEGOCIOS ya están en Neon: clientes, suscripciones,
//  pagos, comisiones. Lo que falta es que esas personas puedan ENTRAR. En el
//  proyecto vivo la identidad vivía en `auth.users` de Supabase (GoTrue), un
//  esquema gestionado que aquí no existe: Better Auth lee `public.user` y
//  `public.account`, y `public.usuarios` sigue siendo la fila de negocio.
//
//  Este script traduce, y solo traduce, eso:
//
//    auth.users.id ─────────────→ public."user".id      (mismo uuid, en texto)
//    auth.users.email            → lower(email)         ← no es cosmético, ver abajo
//    auth.users.encrypted_password → public.account.password  (bcrypt VERBATIM)
//    public.usuarios             → se conserva; si falta la fila, se crea
//
//  Tres decisiones que no se pueden tomar mal, y por qué:
//
//  1) EL EMAIL SE BAJA A MINÚSCULAS. Medido en better-auth 1.7.19:
//     sign-in busca `findUserByEmail(email.toLowerCase())` y el adaptador hace
//     `where email = <minúscula>` — comparación exacta, no `lower(email) =`.
//     O sea: una cuenta importada como "Maria@Blink.com.ve" NUNCA puede entrar,
//     escriba como escriba su dueña. Y /sign-up guarda `email.toLowerCase()`,
//     así que el resto del sistema ya asume minúsculas. Si al bajarlas dos
//     cuentas chocan, el script se para antes de escribir nada: adivinar cuál
//     de las dos era la buena es peor que pedirlo.
//
//  2) EL HASH SE COPIA TAL CUAL, no se restablece ni se re-hash-anything.
//     bcrypt viaja igual que salió de GoTrue y `functions/auth` lo verifica y lo
//     reescribe a scrypt en el primer login correcto (sonda: piloto/sonda-bcrypt.mjs,
//     10/10). Un `$2a$10$…` de 60 caracteres que pierda un carácter es una
//     cliente que no puede entrar, así que el guion comprueba byte a byte que lo
//     escrito es idéntico a lo leído, y `bcrypt.compare` contra la clave del
//     fixture para probar que el viaje no lo rompió.
//
//  3) account."accountId" = user.id, con un solo account por usuario.
//     Hallazgo del piloto (RESULTADOS.md, "lo que hay que arrastrar", punto 3):
//     sin esa igualdad el signIn responde USER_NOT_FOUND aunque el hash esté
//     bien escrito, porque la resolución de cuenta de credential va por ahí.
//
//  Lo que NO hace: no inventa contraseñas. Un usuario de GoTrue sin hash en
//  ningún lado (alta por enlace mágico, u OAuth puro) se lista en el informe
//  para que esa gente reciba un correo de restablecimiento — no se les pone una
//  clave por debajo.
//
//  Uso:
//    VIEJO=postgresql://… NUEVO=postgresql://… node db/importar/cuentas.mjs        # informe
//    VIEJO=… NUEVO=… node db/importar/cuentas.mjs --aplicar                          # escribe
//  Cadena de conexión por entorno y no por argv: argv se lee en `ps` y se queda
//  en el historial del shell.
// ============================================================

import { readFileSync } from 'node:fs'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'

const APLICAR = process.argv.includes('--aplicar')
// `--prueba-clave=X` hace algo que NO se puede hacer con datos de clientes:
// comprobar que bcrypt.compare(X, hash) da true. Solo tiene sentido con el
// fixture, donde la clave se conoce de antemano. Sin la opción, la prueba se
// omite y se dice en el informe — con la base real nunca hay que pasarla.
const clavePrueba = (process.argv.find((a) => a.startsWith('--prueba-clave=')) ?? '').split('=')[1]

const envDeArchivo = () => {
  // Permite `VIEJO_FILE=/ruta/al/env node cuentas.mjs` sin poner la cadena en
  // la línea de órdenes (que quedaría en el historial).
  for (const [varName, fileVar] of [['VIEJO', 'VIEJO_FILE'], ['NUEVO', 'NUEVO_FILE']]) {
    if (!process.env[varName] && process.env[fileVar]) {
      const texto = readFileSync(process.env[fileVar], 'utf8')
      const m = texto.match(new RegExp(`^${varName}=(.*)$`, 'm'))
      if (m) process.env[varName] = m[1].trim().replace(/^["']|["']$/g, '')
    }
  }
}
envDeArchivo()

const VIEJO = process.env.VIEJO
const NUEVO = process.env.NUEVO
if (!VIEJO || !NUEVO) {
  console.error('faltan VIEJO y NUEVO (cadenas de conexión, por entorno)')
  process.exit(2)
}

// `volcar.sh` llega al viejo con libpq, donde sslmode=require cifra SIN validar
// la cadena de certificados. El driver de Node no: desde pg v8 trata require,
// prefer y verify-ca como verify-full, y el pooler de sesión de Supabase
// presenta un intermedio auto-firmado — el informe moría en
// SELF_SIGNED_CERT_IN_CHAIN sobre datos reales justo donde pg_dump pasaba
// limpio, porque el simulacro apuntaba a dos bases Neon, que sí verifican.
// uselibpqcompat alinea las dos mitades del traslado; el destino sigue validando.
const conViejo = (() => {
  try {
    const u = new URL(VIEJO)
    u.searchParams.set('uselibpqcompat', 'true')
    return u.toString()
  } catch {
    return VIEJO
  }
})()

const viejo = new Pool({ connectionString: conViejo, max: 2 })
const nuevo = new Pool({ connectionString: NUEVO, max: 2 })
const Q = (pool, texto, valores) => pool.query(texto, valores)

// ------------------------------------------------------------
// 1) ¿Qué columnas hay del otro lado?
//    `is_sso_user` aparece en GoTrue 2.64 y `email_confirmed_at` es de siempre,
//    pero un proyecto viejo migrado a medias puede no tenerla. Preguntar al
//    catálogo cuesta un round trip y evita que el informe entero se caiga por
//    una columna.
// ------------------------------------------------------------
const columnas = async (pool, esquema, tabla) => {
  const { rows } = await Q(
    pool,
    `select column_name from information_schema.columns
      where table_schema = $1 and table_name = $2`,
    [esquema, tabla],
  )
  return new Set(rows.map((r) => r.column_name))
}

const cols = await columnas(viejo, 'auth', 'users')
if (!cols.has('id') || !cols.has('email')) {
  console.error('✗ no hay auth.users al otro lado (¿es el Supabase viejo?)')
  process.exit(1)
}
const tieneSSO = cols.has('is_sso_user')
const tieneConfirmado = cols.has('email_confirmed_at')
// `credentials` es de un GoTrue más nuevo: el proyecto viejo medido el
// 2026-11-25 tiene identities sin esa columna, y referirla a pelo corta el
// informe entero con 42703 aunque el hash esté en `encrypted_password`.
const tieneCredenciales = (await columnas(viejo, 'auth', 'identities')).has('credentials')

// ------------------------------------------------------------
// 2) Leer la fuente.
//    El hash se busca en tres sitios, en este orden, porque GoTrue escribe en
//    uno u otro según la versión y la ruta de alta:
//      auth.users.encrypted_password
//      auth.identities.identity_data  (cualquier valor que parezca bcrypt)
//      auth.identities.credentials    (ídem)
//    `jsonb_each_text` revienta si el jsonb no es objeto, de ahí el CASE.
// ------------------------------------------------------------
const { rows: fuente } = await Q(
  viejo,
  `select
     u.id::text                                            as id,
     u.email                                               as email,
     coalesce(nullif(btrim(u.encrypted_password), ''), '') as hash_tabla,
     coalesce(
       (select kv.v
          from auth.identities i
          cross join lateral (
            select value as v
              from jsonb_each_text(
                     case when jsonb_typeof(i.identity_data) = 'object'
                          then i.identity_data else '{}' end)
            union all
            ${tieneCredenciales
              ? `select value
              from jsonb_each_text(
                     case when jsonb_typeof(i.credentials) = 'object'
                          then i.credentials else '{}' end)`
              : `select null::text where false`}
          ) kv
         where i.user_id = u.id
           and kv.v ~ '^\\$2[aby]\\$'
         limit 1),
       ''
     )                                                     as hash_identity,
     ${tieneConfirmado ? 'u.email_confirmed_at is not null' : 'true'} as confirmado,
     ${tieneSSO ? 'coalesce(u.is_sso_user, false)' : 'false'}         as es_sso,
     coalesce(nullif(u.raw_user_meta_data ->> 'nombre', ''), '')      as nombre_meta,
     coalesce(nullif(u.raw_user_meta_data ->> 'telefono', ''), '')    as telefono_meta,
     u.created_at, u.updated_at
   from auth.users u
  order by u.created_at, u.id`,
)

// public.usuarios puede no existir todavía en la fuente (o estar vacío).
let negocio = new Map()
try {
  const { rows } = await Q(
    viejo,
    `select id::text as id, rol, nombre, email, telefono, referido_por::text, created_at
       from public.usuarios`,
  )
  negocio = new Map(rows.map((r) => [r.id, r]))
} catch {
  console.log('aviso: la fuente no tiene public.usuarios; las filas de negocio se crean todas.')
}

// ------------------------------------------------------------
// 3) Clasificar. Aquí se decide, sin tocar nada.
// ------------------------------------------------------------
const RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/
const importables = []
const sinHash = []
const ignorados = []
const porEmail = new Map()
const colisiones = []

for (const u of fuente) {
  if (u.es_sso || /@builtin-email\.fake$/.test(u.email ?? '')) {
    ignorados.push({ ...u, porque: 'usuario SSO de GoTrue (correo inventado, nunca entra con clave)' })
    continue
  }
  const email = (u.email ?? '').trim().toLowerCase()
  if (!email) {
    ignorados.push({ ...u, porque: 'sin correo en auth.users' })
    continue
  }
  const hash = u.hash_tabla || u.hash_identity || ''
  const biz = negocio.get(u.id)
  const fila = {
    id: u.id,
    email,
    emailOriginal: u.email,
    hash,
    origenHash: u.hash_tabla ? 'auth.users' : u.hash_identity ? 'auth.identities' : '—',
    confirmado: u.confirmado,
    nombre: biz?.nombre || u.nombre_meta || email.split('@')[0],
    rol: biz?.rol ?? 'cliente',
    telefono: biz?.telefono || u.telefono_meta || null,
    referidoPor: biz?.referido_por ?? null,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
    usuariosExiste: Boolean(biz),
  }
  if (!hash) {
    sinHash.push(fila)
    continue
  }
  if (!RE.test(hash)) {
    sinHash.push({ ...fila, porque: `no tiene forma de bcrypt (${hash.slice(0, 7)}…, ${hash.length} caracteres)` })
    continue
  }
  const previa = porEmail.get(email)
  if (previa) {
    colisiones.push({ email, a: previa.emailOriginal, b: fila.emailOriginal })
    continue
  }
  porEmail.set(email, fila)
  importables.push(fila)
}

// Choque también contra lo que ya está escrito en el destino.
const { rows: destinoEmails } = await Q(
  nuevo,
  `select id, lower(email) as email from public."user"`,
)
const enDestino = new Map(destinoEmails.map((r) => [r.email, r.id]))

console.log('── lectura de la fuente ─────────────────────────────────────')
console.log(`   auth.users              : ${fuente.length}`)
console.log(`   importables             : ${importables.length}`)
console.log(`     · hash en auth.users  : ${importables.filter((f) => f.origenHash === 'auth.users').length}`)
console.log(`     · hash solo en identities: ${importables.filter((f) => f.origenHash === 'auth.identities').length}`)
console.log(`     · email con mayúsculas (se normaliza): ${importables.filter((f) => f.email !== f.emailOriginal).length}`)
console.log(`     · sin fila en public.usuarios (se crea): ${importables.filter((f) => !f.usuariosExiste).length}`)
console.log(`   ya estaban en el destino: ${importables.filter((f) => enDestino.has(f.email)).length}`)
console.log(`   sin hash (aviso, no se toca): ${sinHash.length}`)
console.log(`   descartados              : ${ignorados.length}`)
for (const f of sinHash) {
  console.log(`     · ${f.emailOriginal} — ${f.porque ?? 'alta sin contraseña (enlace mágico / OAuth)'}`)
  // No se escribe a medias por decisión: crear la identidad sin credential
  // account es una ruta que ninguna prueba cubrió, y dejar al usuario fuera
  // tampoco es inofensivo — si vuelve a registrarse, `usuarios.id` cambia y
  // su historial de pagos queda apuntando a un uuid viejo. Se saca el SQL
  // hecho para que una persona lo mire antes de ejecutarlo.
  console.log(`         para resolverlo sin romper su historial:  insert into public."user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values ('${f.id}', ${f.nombre ? `'${f.nombre.replace(/'/g, "''")}'` : 'null'}, '${f.email}', ${f.confirmado}, '${f.createdAt.toISOString()}', '${f.updatedAt.toISOString()}');  — y desde la app, restablecer contraseña.`)
}
for (const f of ignorados) console.log(`     - ${f.email} — ${f.porque}`)

if (colisiones.length) {
  console.error('\n✗ dos cuentas del proyecto viejo caen en el mismo correo al bajarlas a minúscula:')
  for (const c of colisiones) console.error(`   ${c.email}  ←  "${c.a}" y "${c.b}"`)
  console.error('  No se escribe NADA. Decide cuál de las dos es la real (o únelas) y vuelve.')
  await viejo.end()
  await nuevo.end()
  process.exit(1)
}

if (!APLICAR) {
  console.log('\ninforme: no se escribió nada. Repite con --aplicar.')
  await viejo.end()
  await nuevo.end()
  process.exit(0)
}

// ------------------------------------------------------------
// 4) Escribir, todo en una transacción.
//    `on conflict (id) do nothing` + `where not exists` en account y usuarios:
//    el guion tiene que poder repetirse después de un corte a medias sin
//    duplicar una identidad.
// ------------------------------------------------------------
const client = await nuevo.connect()
const contadores = { user: 0, account: 0, usuarios: 0, ya: 0 }
try {
  await client.query('begin')
  for (const f of importables) {
    if (enDestino.has(f.email)) {
      contadores.ya++
      continue
    }
    await Q(
      client,
      `insert into public."user" as u (id, name, email, "emailVerified", "createdAt", "updatedAt")
       values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do nothing`,
      [f.id, f.nombre, f.email, f.confirmado, f.createdAt, f.updatedAt],
    )
    contadores.user++

    await Q(
      client,
      `insert into public.account (id, "accountId", "providerId", "userId",
                                   password, "passwordCreatedAt", "createdAt", "updatedAt")
       select gen_random_uuid()::text, $1, 'credential', $1, $2, now(), $3, $4
        where not exists (
          select 1 from public.account a
           where a."userId" = $1 and a."providerId" = 'credential')`,
      [f.id, f.hash, f.createdAt, f.updatedAt],
    )
    contadores.account++

    // La fila de negocio: en el proyecto viejo la creaba el disparador
    // trg_auth_user_creado sobre auth.users. Aquí se recrean solo las que
    // faltan; las que ya vienen en el volcado no se tocan (son dato de cliente).
    if (!f.usuariosExiste) {
      // Columnas de public.usuarios, tal como están en db/0001: no hay que
      // olvidar ninguna de las que el disparador viejo rellenaba.
      await Q(
        client,
        `insert into public.usuarios (id, rol, nombre, email, telefono, created_at)
         select $1::uuid, $2, $3, $4, $5, $6
          where not exists (select 1 from public.usuarios where id = $1::uuid)`,
        [f.id, f.rol, f.nombre, f.email, f.telefono, f.createdAt],
      )
      contadores.usuarios++
    }
  }
  await client.query('commit')
} catch (err) {
  await client.query('rollback')
  console.error(`\n✗ se revirtió todo: ${err.message}`)
  client.release()
  await viejo.end()
  await nuevo.end()
  process.exit(1)
}
client.release()

console.log('\n── escritas ─────────────────────────────────────────────────')
console.log(`   public."user"        : ${contadores.user}`)
console.log(`   public.account       : ${contadores.account}`)
console.log(`   public.usuarios      : ${contadores.usuarios} creadas (el resto ya venía del volcado)`)
console.log(`   omitidas ya existentes: ${contadores.ya}`)

// ------------------------------------------------------------
// 5) Comprobaciones después de escribir. Se reportan, no se asumen.
// ------------------------------------------------------------
const fallos = []
const chequear = (nombre, ok, detalle) => {
  console.log(`${ok ? '   ✓' : '   ✗'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  if (!ok) fallos.push(nombre)
}

const { rows: todo } = await Q(
  nuevo,
  `select u.id, u.email, a."accountId", a."providerId", a.password
     from public."user" u
     join public.account a on a."userId" = u.id
    where u.id = any($1::text[])`,
  [importables.map((f) => f.id)],
)
chequear('toda identidad importada tiene su account de credential',
  todo.length === importables.length, `${todo.length}/${importables.length}`)
chequear('los emails escritos están en minúscula',
  todo.every((r) => r.email === r.email.toLowerCase()))
chequear('account."accountId" = user.id (condición del login credential)',
  todo.every((r) => r.accountId === r.id))
chequear('un solo account de credential por usuario',
  new Set(todo.map((r) => r.id)).size === todo.length)

// El hash tiene que ser idéntico byte a byte al de la fuente.
const fuenteHash = new Map(importables.map((f) => [f.id, f.hash]))
const distintos = todo.filter((r) => fuenteHash.get(r.id) !== r.password)
chequear('los bcrypt viajaron sin un solo carácter de más o de menos',
  distintos.length === 0,
  distintos.length ? `difieren: ${distintos.map((r) => r.id).join(', ')}` : `${todo.length} comparados`)

// Prueba de que la cadena sirve: solo con el fixture, donde la clave es conocida.
if (clavePrueba) {
  const entran = importables.filter((f) => bcrypt.compareSync(clavePrueba, fuenteHash.get(f.id)))
  chequear('bcrypt.compare contra la clave conocida del fixture',
    entran.length === importables.length, `${entran.length}/${importables.length}`)

  // El login real, emulado contra la base ya escrita con LA MISMA consulta que
  // hace Better Auth (internal-adapter.mjs: findUserByEmail → findOne where
  // field 'email' = email.toLowerCase(), y encima compara NFC-minúsculas).
  // Se prueba con el correo tal como lo escribiría la persona, no como se
  // guardó: así la comprobación es del camino del usuario, no del nuestro.
  const simulado = []
  for (const f of importables) {
    const entrada = f.emailOriginal // con las mayúsculas del proyecto viejo
    const { rows } = await Q(
      nuevo,
      `select u.id, a.password
         from public."user" u
         left join public.account a on a."userId" = u.id and a."providerId" = 'credential'
        where u.email = $1
        limit 1`,
      [entrada.toLowerCase()],
    )
    simulado.push(
      rows.length === 1 && rows[0].password && bcrypt.compareSync(clavePrueba, rows[0].password),
    )
  }
  chequear('login simulado (correo tal cual lo escribe el cliente) encuentra y verifica',
    simulado.every(Boolean), `${simulado.filter(Boolean).length}/${simulado.length}`)

  // Y la prueba a la inversa, que es la razón del punto 1 del encabezado: si
  // el email se hubiera importado sin normalizar, la búsqueda exacta de
  // Better Auth no lo encontraría nunca.
  const conMayusculas = importables.filter((f) => f.email !== f.emailOriginal)
  if (conMayusculas.length) {
    const { rows } = await Q(
      nuevo,
      `select count(*)::int n from public."user" where email = any($1::text[])`,
      [conMayusculas.map((f) => f.emailOriginal)],
    )
    chequear(`los ${conMayusculas.length} correos con mayúsculas NO existirían buscándolos tal cual (por eso se normalizan)`,
      rows[0].n === 0)
  }
} else {
  console.log('   · prueba de clave omitida: --prueba-clave solo se pasa con el fixture, nunca con datos de clientes')
}

// Y que el re-hash de la Fase 5 no se va a caer: la forma que espera
// functions/auth es `32 hex : 128 hex`; lo importado es bcrypt y se convierte
// en el primer login. Se lista el estado de partida.
const { rows: formas } = await Q(
  nuevo,
  `select case when password ~ '^\\$2[aby]\\$' then 'bcrypt (pendiente de re-hash al entrar)'
               when password ~ '^[0-9a-f]{32}:[0-9a-f]{128}$' then 'scrypt nativo'
               else 'DESCONOCIDA' end as forma, count(*)
     from public.account group by 1 order by 2 desc`,
)
for (const f of formas) console.log(`   · ${f.forma}: ${f.count}`)

await viejo.end()
await nuevo.end()

if (fallos.length) {
  console.error(`\n✗ ${fallos.length} comprobaciones fallaron`)
  process.exit(1)
}
console.log('\n✓ importación de cuentas verificada')
