// ============================================================
//  functions/datos/index.mjs — la API de datos de Blink Plans
// ============================================================
//  Qué es: el único camino que tiene el navegador para leer y escribir la
//  base de datos. Habla un subconjunto de PostgREST a propósito (ver
//  «Protocolo» abajo) para que src/lib/api.ts siga casi igual que cuando
//  apuntaba a Supabase.
//
//  Qué NO es: la Data API de Neon. El gate la midió y la descartó para JWT
//  propio (piloto/RESULTADOS.md, «Proveedor externo de la Data API: la caché
//  JWKS medida»: 12/20 aciertos en 20 llamadas seguidas con el mismo token,
//  0/12 con jwt_cache_max_lifetime=3600, y la única operación que refresca
//  es DELETE+POST con ~2 min de propagación). La decisión está en el
//  encabezado de neon.ts: sin dataApi y sin auth gestionado.
//
//  Lo que NO se pierde al cambiar de camino: la autorización. Cada petición
//  abre UNA transacción, hace `set local role authenticated|anonymous` y
//  `set local request.jwt.claims`, y ahí dentro ejecuta el SQL compilado.
//  RLS evalúa las mismas 19 políticas del esquema viejo igual que las
//  evaluaba PostgREST, porque lo que leen es el mismo GUC. Esta Function no
//  decide permisos: decide sintaxis.
//
//  ── Protocolo ────────────────────────────────────────────────────────────
//  POST /consulta   { from, calls: [[metodo, ...args]] }
//      `calls` es la cadena de supabase-js registrada tal cual, sin evaluar:
//        ["select","*, usuarios(nombre)"]   ["eq","estado","activa"]
//        ["order","created_at",{ascending:false}]   ["limit",300]
//        ["insert",{...}]  ["update",{...}]  ["delete"]
//        ["select","id",{count:"exact",head:true}]  ["single"]  ["maybeSingle"]
//      responde { data, error, count } — la misma forma que supabase-js,
//      incluidos los casos: single→objeto en vez de arreglo, head→data null
//      con count número, y error con .message (eso es lo que lee errMsg()).
//  POST /rpc        { fn, args } → { data, error }
//  GET  /salud      sin BD y sin token: dice si el isolate está vivo.
//
//  ── Inyección ────────────────────────────────────────────────────────────
//  Ningún identificador llega al SQL como texto del cliente: se valida
//  contra el diccionario real de la BD (information_schema + pg_constraint,
//  en caché 60 s) y se cita. Los valores siempre son parámetros $n. Una
//  columna inexistente es un 400 nuestro, no un error de sintaxis de
//  Postgres.
//
//  ── Límites que esto NO cubre ─────────────────────────────────────────────
//  No hay rate limiting: la URL nativa de una Function es pública y el CNAME
//  de Pages va en modo DNS-only (GitHub Pages no emite certificado con la
//  nube naranja), así que no hay edge delante. Queda como endurecimiento
//  pendiente y está escrito en docs/ADR-002. Lo que sí hay es verificación
//  del token antes de abrir transacción.

import { Pool } from 'pg'
import { attachDatabasePool } from '@neon/functions'
import { verificarToken } from '../_shared/token.mjs'

// Pool a nivel de módulo: lo reutiliza cada request del mismo isolate.
// max corto porque cada isolate mantiene su propio pool (skill neon-functions).
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
attachDatabasePool(pool)

const LIMIT_MAX = 1_000
const TTL_META = 60_000

const ORIGENES = (
  process.env.BLINK_ALLOWED_ORIGINS ??
  'https://plans.blink.com.ve,https://go-plans.github.io,http://localhost:5173'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// Funciones invocables por /rpc, en lista blanca explícita. En el esquema hay
// 43 funciones y la inmensa mayoría son triggers o auxiliares de trigger; que
// una ruta pública pueda llamar a cualquiera es un inventario de sorpresas.
// El front solo llama a editar_pago (src/lib/api.ts, actualizarPago).
const RPC_PERMITIDAS = new Set(['editar_pago'])

const METODOS_FILTRO = new Set([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
])

const SQL_OPS = {
  eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike',
}

// ------------------------------------------------------------------ CORS
function cabecerasCORS(origin) {
  return {
    'Access-Control-Allow-Origin': ORIGENES.includes(origin) ? origin : ORIGENES[0],
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

const json = (obj, estado = 200, origin) =>
  new Response(JSON.stringify(obj), {
    status: estado,
    headers: { 'Content-Type': 'application/json', ...cabecerasCORS(origin) },
  })

// supabase-js devuelve el error con la forma de PostgREST
// (message/code/hint/details). errMsg() solo lee .message, pero conservar la
// forma cuesta cero y deja mirar .code más adelante.
const sinDatos = (code, message, estado) => ({
  code,
  message,
  body: { data: null, error: { code, message }, count: null },
  estado,
})

// --------------------------------------------------------- diccionario
let meta = null
let metaCaducaEn = 0

async function diccionario() {
  if (meta && Date.now() < metaCaducaEn) return meta

  const tablas = await pool.query(`
    select table_name, case table_type when 'VIEW' then 'view' else 'table' end as tipo
      from information_schema.tables
     where table_schema = 'public'
       and table_type in ('BASE TABLE','VIEW')`)

  const columnas = await pool.query(`
    select table_name, column_name, data_type
      from information_schema.columns
     where table_schema = 'public'`)

  // Lado to-one del embed: las 15 FK del esquema van de una fila hacia la
  // PK/unique de otra (verificado sobre pg_constraint), o sea todas son
  // to-one. No hace falta modelar to-many ni agregaciones.
  const relaciones = await pool.query(`
    select rel.relname  as de,
           att.attname  as columna_de,
           frel.relname as hacia,
           fatt.attname as columna_hacia
      from pg_constraint con
      join pg_class rel    on rel.oid  = con.conrelid
      join pg_class frel   on frel.oid = con.confrelid
      join pg_namespace n  on n.oid    = rel.relnamespace
      join unnest(con.conkey)  with ordinality k(a, ord)  on true
      join pg_attribute att    on att.attrelid  = con.conrelid  and att.attnum  = k.a
      join unnest(con.confkey) with ordinality kf(a, ord)  on kf.ord = k.ord
      join pg_attribute fatt   on fatt.attrelid = con.confrelid and fatt.attnum = kf.a
     where con.contype = 'f' and n.nspname = 'public'`)

  const porTabla = new Map()
  for (const { table_name: t, tipo } of tablas.rows)
    porTabla.set(t, { tipo, columnas: new Map() })
  for (const { table_name: t, column_name: col, data_type: tipo } of columnas.rows)
    porTabla.get(t)?.columnas.set(col, tipo)

  const aristas = new Map()
  for (const r of relaciones.rows) {
    const previas = aristas.get(r.de) ?? []
    previas.push(r)
    aristas.set(r.de, previas)
  }

  meta = { porTabla, aristas }
  metaCaducaEn = Date.now() + TTL_META
  return meta
}

const id = (s) => `"${String(s).replace(/"/g, '""')}"`
// Los KEYS de jsonb_build_object van como texto, no como identificador. Con
// `id(col)` Postgres lo resuelve como columna de la tabla (medido:
// `select "id", t."id" from …` devuelve la columna dos veces, y en un embed da
// 42703 column "usuarios" does not exist). El objeto se arma entonces con
// `'nombre'::llave`, que es lo que la fila debe reportar.
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`

function tabla(d, nombre) {
  const t = d.porTabla.get(nombre)
  if (!t) throw new Error(`recurso inexistente: ${nombre}`)
  return t
}

function columna(t, nombre, recurso) {
  if (!t.columnas.has(nombre))
    throw new Error(`columna inexistente en ${recurso}: ${nombre}`)
  return nombre
}

// ------------------------------------------------------- select PostgREST
// "*, usuarios(nombre, email), planes(precio_venta_usd, plataformas(nombre))"
// Parser mínimo, deliberadamente: solo la forma que usa el front. `alias:col`,
// casts y embeds !inner no están; si alguien los pide quiere un 400 claro, no
// un identificador raro llegando a SQL.
function analizarSelect(cadena) {
  const partes = []
  let profundidad = 0
  let actual = ''
  for (const ch of String(cadena || '*')) {
    if (ch === '(') profundidad++
    if (ch === ')') profundidad--
    if (ch === ',' && profundidad === 0) {
      if (actual.trim()) partes.push(actual.trim())
      actual = ''
    } else actual += ch
  }
  if (actual.trim()) partes.push(actual.trim())

  return partes.map((token) => {
    const embed = /^([A-Za-z_][A-Za-z0-9_]*)(\(.*\))$/.exec(token)
    if (embed) return { tipo: 'embed', recurso: embed[1], dentro: analizarSelect(embed[2].slice(1, -1)) }
    if (token === '*') return { tipo: 'todo' }
    if (/[:.()!]/.test(token)) throw new Error(`select no soportado: ${token}`)
    return { tipo: 'columna', nombre: token }
  })
}

// Devuelve la lista de argumentos de jsonb_build_object para `nodos` leídos
// desde la tabla `recurso` con alias `origen`. Los embeds se resuelven como
// subconsulta correlacionada por la FK — lo mismo que hace PostgREST con un
// to-one — y RLS se aplica dentro porque la subconsulta corre con el rol de
// la sesión, no con el dueño.
//
// `origen = null` es el caso RETURNING de una mutación: no hay alias que
// calificar (medido: con alias daba 42P01 missing FROM-clause entry for table
// "t") y Postgres no admite subconsultas en la lista RETURNING, así que ahí
// los embeds se rechazan en vez de armar SQL inválido.
function fragmento(nodos, recurso, origen, d) {
  const t = tabla(d, recurso)
  // `numeric` se manda como texto, que es la forma que tenía por PostgREST y
  // la que no convierte la plata en un float64 (por JSON salía 42.5000 → 42.5
  // y, peor, 6 → 6.00 perdido). El front ya envolvió siempre con Number()
  // porque con Supabase nunca recibió un número JS.
  const ref = (col) => {
    const expr = origen ? `${origen}.${id(col)}` : id(col)
    return t.columnas.get(col) === 'numeric' ? `(${expr})::text` : expr
  }
  const pares = []
  for (const n of nodos) {
    if (n.tipo === 'todo') {
      for (const col of t.columnas.keys()) pares.push(lit(col), ref(col))
      continue
    }
    if (n.tipo === 'columna') {
      pares.push(lit(n.nombre), ref(columna(t, n.nombre, recurso)))
      continue
    }
    if (!origen)
      throw new Error(
        `${recurso}.${n.recurso} no puede devolverse en una mutación: RETURNING no admite embeds`,
      )
    const candidatas = (d.aristas.get(recurso) ?? []).filter((a) => a.hacia === n.recurso)
    if (candidatas.length !== 1)
      throw new Error(
        candidatas.length === 0
          ? `${recurso} no tiene FK hacia ${n.recurso}: el embed no es posible`
          : `${recurso} tiene ${candidatas.length} FK hacia ${n.recurso}: hay que desempatar`,
      )
    const a = candidatas[0]
    const alias = `${origen}_e`
    const interno = fragmento(n.dentro, n.recurso, alias, d)
    pares.push(
      lit(n.recurso),
      `(select ${interno} from ${id(n.recurso)} ${id(alias)} ` +
        `where ${id(alias)}.${id(a.columna_hacia)} = ${origen}.${id(a.columna_de)} limit 1)`,
    )
  }
  return `jsonb_build_object(${pares.join(', ')})`
}

// ---------------------------------------------------------------- filtros
// `prefijo` es el alias de la tabla en el FROM (select) o el nombre
// cualificado (update/delete, que no llevan alias).
function compilarFiltros(calls, recurso, prefijo, d, valores) {
  const t = tabla(d, recurso)
  const condiciones = []
  for (const [metodo, ...args] of calls) {
    if (!METODOS_FILTRO.has(metodo)) continue
    const [col, val] = args
    columna(t, col, recurso)
    if (metodo === 'is') {
      const literal =
        val === null ? 'null' : val === true ? 'true' : val === false ? 'false' : null
      if (!literal) throw new Error(`is solo admite null/true/false, no ${JSON.stringify(val)}`)
      condiciones.push(`${prefijo}.${id(col)} is ${literal}`)
    } else if (metodo === 'in') {
      if (!Array.isArray(val)) throw new Error('in espera un arreglo')
      valores.push(val.map(String))
      condiciones.push(`${prefijo}.${id(col)} = any($${valores.length}::text[])`)
    } else {
      valores.push(val)
      condiciones.push(`${prefijo}.${id(col)} ${SQL_OPS[metodo]} $${valores.length}`)
    }
  }
  return condiciones
}

function compilarOrden(calls, recurso, prefijo, d) {
  const t = tabla(d, recurso)
  const pedazos = []
  for (const [, col, opts = {}] of calls.filter((c) => c[0] === 'order')) {
    columna(t, col, recurso)
    const dir = opts.ascending === false ? 'desc' : 'asc'
    const nulos =
      opts.nullsFirst === true ? ' nulls first' : opts.nullsFirst === false ? ' nulls last' : ''
    pedazos.push(`${prefijo}.${id(col)} ${dir}${nulos}`)
  }
  return pedazos.length ? `order by ${pedazos.join(', ')}` : ''
}

const metodo = (calls, nombre) => calls.find((c) => c[0] === nombre)
const tiene = (calls, ...nombres) => calls.some((c) => nombres.includes(c[0]))

// ------------------------------------------------------------------ SQL
// Devuelve { texto, valores, modo } donde modo es:
//   'filas'   → data = arreglo (u objeto si pide single)
//   'vacio'   → data = null (mutación sin select, o head sin count)
//   'count'   → count = número, data = null
function compilarConsulta(pedido, d) {
  const { from } = pedido ?? {}
  if (typeof from !== 'string') throw new Error('falta `from`')
  tabla(d, from)

  const calls = Array.isArray(pedido.calls) ? pedido.calls : []
  if (calls.some((c) => !Array.isArray(c) || typeof c[0] !== 'string'))
    throw new Error('cada elemento de `calls` debe ser [metodo, ...args]')

  const sel = metodo(calls, 'select')
  const spec = sel?.[1] ?? '*'
  const opts = sel?.[2] ?? {}
  const quiereCount = opts.count != null
  const pideFilas = tiene(calls, 'select')
  const mut = calls.find((c) => ['insert', 'update', 'delete'].includes(c[0]))
  const valores = []

  if (opts.head === true) {
    if (!quiereCount) throw new Error('head:true solo tiene sentido con count')
    const where = compilarFiltros(calls, from, 't', d, valores)
    return {
      texto:
        `select count(*)::int as cnt from ${id(from)} t` +
        (where.length ? ` where ${where.join(' and ')}` : ''),
      valores,
      modo: 'count',
    }
  }

  const nodos = analizarSelect(spec)
  // Con alias en el SELECT; sin él en el RETURNING de una mutación. La lista
  // va bajo el nombre `fila`, y el manejo de la respuesta la desempaqueta.
  const salidas = (origen) => `${fragmento(nodos, from, origen, d)} as ${id('fila')}`

  if (!mut) {
    const where = compilarFiltros(calls, from, 't', d, valores)
    const orden = compilarOrden(calls, from, 't', d)
    // `.range(desde, desde)` llega ya como [range, desde, cantidad] (ver
    // src/lib/db.ts). Sin `limit` explícito, la cantidad del range manda; si
    // no hay ninguno, el tope es LIMIT_MAX.
    const rng = metodo(calls, 'range')
    const off = Number(rng?.[1] ?? metodo(calls, 'offset')?.[1] ?? 0)
    const lim = Number(metodo(calls, 'limit')?.[1] ?? rng?.[2] ?? LIMIT_MAX)
    if (!Number.isInteger(lim) || lim < 0 || lim > LIMIT_MAX)
      throw new Error(`limit fuera de 0..${LIMIT_MAX}`)
    if (!Number.isInteger(off) || off < 0) throw new Error('offset inválido')
    return {
      texto:
        `select ${salidas('t')} from ${id(from)} t` +
        (where.length ? ` where ${where.join(' and ')}` : '') +
        (orden ? ` ${orden}` : '') +
        ` limit ${lim}` +
        (off ? ` offset ${off}` : ''),
      valores,
      modo: 'filas',
      // `count` sin `head` (Content-Range de PostgREST) no lo usa el front:
      // las cinco cifras del resumen van con head:true, modo 'count'.
    }
  }

  const [kind] = mut
  const modo = pideFilas ? 'filas' : 'vacio'

  if (kind === 'insert') {
    const filas = Array.isArray(mut[1]) ? mut[1] : [mut[1]]
    if (filas.length === 0 || filas.length > 500) throw new Error('insert de 1 a 500 filas')
    const t = tabla(d, from)
    const cols = Object.keys(filas[0])
    if (cols.length === 0) throw new Error('insert sin columnas')
    cols.forEach((c) => columna(t, c, from))
    for (const f of filas)
      if (Object.keys(f).join() !== cols.join())
        throw new Error('insert con forma desigual entre filas')
    const huecos = []
    for (const f of filas) {
      const uno = []
      for (const c of cols) {
        valores.push(f[c] === undefined ? null : f[c])
        uno.push(`$${valores.length}`)
      }
      huecos.push(`(${uno.join(', ')})`)
    }
    return {
      texto:
        `insert into ${id(from)} (${cols.map(id).join(', ')}) values ${huecos.join(', ')}` +
        (pideFilas ? ` returning ${salidas(null)}` : ''),
      valores,
      modo,
    }
  }

  // update y delete exigen filtro: sin él, un bug del panel reescribiría o
  // borraría la tabla entera amparado por una política de admin.
  const prefijo = id(from)
  const where = compilarFiltros(calls, from, prefijo, d, valores)
  if (where.length === 0) throw new Error(`${kind} sin filtro: prohibido`)

  if (kind === 'update') {
    const t = tabla(d, from)
    const set = mut[1] ?? {}
    const cols = Object.keys(set)
    if (cols.length === 0) throw new Error('update sin columnas')
    cols.forEach((c) => columna(t, c, from))
    const asignaciones = cols.map((c) => {
      valores.push(set[c] === undefined ? null : set[c])
      return `${id(c)} = $${valores.length}`
    })
    return {
      texto:
        `update ${id(from)} set ${asignaciones.join(', ')} where ${where.join(' and ')}` +
        (pideFilas ? ` returning ${salidas(null)}` : ''),
      valores,
      modo,
    }
  }

  return {
    texto:
      `delete from ${id(from)} where ${where.join(' and ')}` +
      (pideFilas ? ` returning ${salidas(null)}` : ''),
    valores,
    modo,
  }
}

// -------------------------------------------------------------------- rpc
// Los nombres de parámetro se leen de la BD: así una firma que cambie da 400
// en vez de llamar a la función con el orden equivocado.
async function compilarRpc({ fn, args = {} }) {
  if (typeof fn !== 'string' || !RPC_PERMITIDAS.has(fn))
    throw new Error(`rpc no permitida: ${String(fn).slice(0, 40)}`)

  // Por `routine_name`, no por `specific_name`: Postgres le pone sufijo de oid
  // al specific (medido en la rama: 'editar_pago_25365'), así que buscar por
  // el nombre a secas devolvía cero filas y el rpc daba 400.
  const params = await pool.query(
    `select p.parameter_name, p.data_type
       from information_schema.routines r
       join information_schema.parameters p
         on p.specific_catalog = r.specific_catalog
        and p.specific_schema  = r.specific_schema
        and p.specific_name    = r.specific_name
      where r.routine_schema = 'public' and r.routine_name = $1
        and p.parameter_mode = 'IN'
      order by p.ordinal_position`,
    [fn],
  )
  if (params.rowCount === 0) throw new Error(`rpc inexistente: ${fn}`)

  const conocidos = new Set(params.rows.map((p) => p.parameter_name))
  const sobrantes = Object.keys(args ?? {}).filter((k) => !conocidos.has(k))
  if (sobrantes.length) throw new Error(`argumentos desconocidos: ${sobrantes.join(', ')}`)

  const valores = []
  const nombres = []
  for (const p of params.rows) {
    const v = args[p.parameter_name]
    // Un arreglo JS viaja a pg como literal de array de Postgres, y para un
    // parámetro jsonb eso es 22P02 invalid input syntax for type json (medido
    // con editar_pago). Los tipos json/jsonb se mandan como texto JSON.
    const esJson = p.data_type === 'json' || p.data_type === 'jsonb'
    valores.push(
      v === undefined || v === null ? null : esJson && typeof v !== 'string' ? JSON.stringify(v) : v,
    )
    nombres.push(`${id(p.parameter_name)} := $${valores.length}`)
  }
  return { texto: `select ${id(fn)}(${nombres.join(', ')}) as r`, valores }
}

// ------------------------------------------------------------- la transacción
// El punto del diseño: SET LOCAL dentro de UNA transacción. El pooler de Neon
// está en modo transacción, o sea que solo queda asignado al mismo servidor
// mientras la transacción vive, que es justo el alcance de SET LOCAL. Un `SET`
// a secas se quedaría pegado a la conexión y contaminaría el request
// siguiente, posiblemente de otro usuario.
async function enRol(sql, valores, rol, claims) {
  const c = await pool.connect()
  try {
    await c.query('begin')
    try {
      // statement_timeout fijo: una consulta torpe no puede colgar el
      // isolate; 4 s es holgado para lo que hace el panel (ver medidas en
      // docs/ADR-002) y corto para un ataque.
      await c.query("set local statement_timeout = '4s'")
      await c.query(`set local role ${rol}`)
      // `set local x = $1` no se puede: SET no admite parámetros (medido:
      // 42601 syntax error at or near "$1"). set_config con is_local = true es
      // el equivalente exacto de SET LOCAL y sí acepta el valor enlazado.
      await c.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify(claims),
      ])
      const r = await c.query({ text: sql, values: valores })
      await c.query('commit')
      return r
    } catch (e) {
      await c.query('rollback')
      throw e
    }
  } finally {
    c.release()
  }
}

// Rol de Postgres: `authenticated` con un token válido, `anonymous` sin él.
// El rol de negocio (admin/agente/cliente) NO viaja en el JWT: lo decide
// es_admin() leyendo public.usuarios, igual que en el panel viejo, así que
// promover o degradar a un admin sigue siendo un UPDATE de una columna.
function identidad(token) {
  const p = token ? verificarToken(token) : null
  if (!p || p.role !== 'authenticated' || typeof p.sub !== 'string' || !/^[0-9a-f-]{36}$/i.test(p.sub))
    return { rol: 'anonymous', claims: { role: 'anonymous' } }
  return {
    rol: 'authenticated',
    claims: { sub: p.sub, role: 'authenticated', sid: p.sid ?? null },
  }
}

// --------------------------------------------------------------- HTTP
async function manejarConsulta(body, ident, origin) {
  let plan
  try {
    plan = compilarConsulta(body, await diccionario())
  } catch (e) {
    const f = sinDatos('PGRST200', e.message, 400)
    return json(f.body, f.estado, origin)
  }

  let r
  try {
    r = await enRol(plan.texto, plan.valores, ident.rol, ident.claims)
  } catch (e) {
    const code = e.code ?? 'XX000'
    // 42501 permission denied es la respuesta correcta de RLS cuando la
    // política no deja; 23505/23503 son los que el front debe mostrar.
    const estado = code === '42501' || code === '42883' ? 403 : ['23505', '23503', '23514'].includes(code) ? 409 : 500
    const f = sinDatos(code, e.message, estado)
    return json(f.body, f.estado, origin)
  }

  if (plan.modo === 'count')
    return json({ data: null, error: null, count: r.rows[0]?.cnt ?? 0 }, 200, origin)

  if (plan.modo === 'vacio')
    return json({ data: null, error: null, count: null }, 201, origin)

  // Cada fila salió como { fila: {…} } porque el SELECT manda un solo
  // jsonb_build_object; se desenvuelve antes de responder.
  let data = r.rows.map((x) => x.fila)
  const unico = metodo(body.calls ?? [], 'single') ?? metodo(body.calls ?? [], 'maybeSingle')
  if (unico) {
    if (data.length !== 1) {
      const f = sinDatos(
        'PGRST116',
        'JSON object requested, multiple (or no) rows returned',
        406,
      )
      return json(f.body, f.estado, origin)
    }
    data = data[0]
  }
  return json({ data, error: null, count: null }, 200, origin)
}

async function manejarRpc(body, ident, origin) {
  let plan
  try {
    plan = await compilarRpc(body)
  } catch (e) {
    const f = sinDatos('PGRST202', e.message, 400)
    return json(f.body, f.estado, origin)
  }

  try {
    await enRol(plan.texto, plan.valores, ident.rol, ident.claims)
  } catch (e) {
    const code = e.code ?? 'P0001'
    const estado = code === '42501' ? 403 : code === 'P0001' ? 400 : 500
    const f = sinDatos(code, e.message, estado)
    return json(f.body, f.estado, origin)
  }
  // editar_pago devuelve void: supabase-js también reporta data null.
  return json({ data: null, error: null, count: null }, 200, origin)
}

export default {
  async fetch(request) {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin') ?? ''

    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: cabecerasCORS(origin) })

    if (url.pathname === '/salud')
      return json(
        { ok: true, function: 'datos', rama: process.env.NEON_BRANCH ?? 'local' },
        200,
        origin,
      )

    const cab = request.headers.get('Authorization') ?? ''
    const ident = identidad(cab.startsWith('Bearer ') ? cab.slice(7).trim() : '')

    let body
    try {
      body = await request.json()
    } catch {
      const f = sinDatos('PGRST102', 'cuerpo JSON inválido', 400)
      return json(f.body, f.estado, origin)
    }

    try {
      if (url.pathname === '/consulta') return await manejarConsulta(body, ident, origin)
      if (url.pathname === '/rpc') {
        if (ident.rol !== 'authenticated') {
          const f = sinDatos('42501', 'esta llamada exige sesión iniciada', 401)
          return json(f.body, f.estado, origin)
        }
        return await manejarRpc(body, ident, origin)
      }
      const f = sinDatos('PGRST100', `ruta inexistente: ${url.pathname}`, 404)
      return json(f.body, f.estado, origin)
    } catch (e) {
      // Que el fallo sea legible en `neon logs query --source function`.
      console.error('[datos] lanzó:', e?.stack ?? e)
      const f = sinDatos('XX000', e?.message ?? String(e), 500)
      return json(f.body, f.estado, origin)
    }
  },
}
