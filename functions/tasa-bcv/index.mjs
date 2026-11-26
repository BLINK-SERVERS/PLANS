// ============================================================
//  functions/tasa-bcv/index.mjs — tasa BCV diaria y vencimientos
// ============================================================
//  Port de supabase/functions/fetch-bcv/index.ts a una Neon Function. Cambia
//  el envoltorio (Deno → Node 24, `new Response` igual) y el cliente de BD
//  (la service_role de la Edge Function → DATABASE_URL que inyecta Neon). La
//  lógica de parseo se porta literal porque es la que produce el número con
//  el que se cobra: 4 decimales, coma decimal, y la fecha la da el **Fecha
//  Valor** del BCV, nunca `new Date()`.
//
//  Verificado en el piloto (experimentos 4 y 5, piloto/RESULTADOS.md):
//    · el egreso a bcv.org.ve exige fijar la cadena Sectigo (ca-sectigo.mjs):
//      el servidor del BCV no manda el intermedio R36 y fetch/https del
//      sistema cortan con UNABLE_TO_VERIFY_LEAF_SIGNATURE. Acá no se baja el
//      nivel de TLS: en un panel que mueve plata, una tasa intermediada por un
//      MITM sería un fallo grave.
//    · el 2026-11-25 ese fijado dejó de alcanzar. El BCV reemitió su certificado
//      bajo el perfil OV y la Function respondía «unable to verify the first
//      certificate»: la tasa llevaba 66 días sin refrescar (42,50 del 2026-09-20
//      contra 924,35 reales). Ahora se intentan las dos cadenas y la respuesta
//      dice cuál verificó. Medido contra la Function desplegada tras el arreglo:
//      HTTP 200, USD 924,3534, fecha valor 2026-11-26.
//    · desde el 2026-11-26 el raspado ya no es fuente única: si bcv.org.ve no
//      verifica, el mismo promedio oficial se lee por JSON a ve.dolarapi.com y
//      la fila guarda en `tasas_cambio.fuente` cuál de las dos lo dio. Cuando el
//      raspado sí funciona, las dos se consultan igual y la respuesta trae
//      `desvio_entre_fuentes` en porcentaje, para enterarse de un desacuerdo
//      antes de cobrar con él.
//    · Function Trigger con `--cron` despierta el compute (escala a cero) y
//      entrega at-least-once; la cabecera x-neon-trigger-invocation-id la
//      pone Neon y el borde la quita a los clientes, así que su presencia es
//      la prueba de procedencia.
//
//  Idempotencia, y por qué no hace falta la tabla de invocaciones del piloto:
//  las dos tareas son idempotentes por naturaleza, así que una re-entrega
//  vuelve a escribir el mismo valor y no duplica nada.
//    · tasa: `unique (fecha)` ya existe en tasas_cambio → ON CONFLICT DO UPDATE.
//    · vencimientos: es un UPDATE cuyo predicado deja de cumplirse en cuanto
//      se aplica (`estado='activa'` pasa a 'vencida'), o sea la segunda
//      pasada no encuentra filas.
//  El `invocation_id` sí se registra en el log: si alguna vez hay que
//  reconstruir "¿se corrió este disparo?", está en `neon logs query`.

import https from 'node:https'
import { Pool } from 'pg'
import { attachDatabasePool } from '@neon/functions'
import { parseTriggerDelivery } from '@neon/functions/triggers'
import { verificarToken } from '../_shared/token.mjs'
import { CADENAS_BCV } from './ca-sectigo.mjs'

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 })
attachDatabasePool(pool)

const BCV_URL = 'https://www.bcv.org.ve/seccionportal/tipo-de-cambio-oficial-del-bcv'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const ORIGENES = (
  process.env.BLINK_ALLOWED_ORIGINS ??
  'https://plans.blink.com.ve,https://go-plans.github.io,http://localhost:5173'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// ── parseo portado del Edge Function viejo ─────────────────────────────
function parseBcvNum(cru) {
  const limpio = String(cru).replace(/\s+/g, '').replace(/\.(?=\d{3}\D)/g, '')
  const n = Number(limpio.replace(/,/g, '.'))
  return Number.isFinite(n) ? n : NaN
}

// El BCV publica la tabla con un <div id="dolar"> / <div id="euro"> y dentro
// el valor en un span de clase strong-tb. Misma ruta de búsqueda que el
// viejo, parametrizada por moneda para poder llenar tasa_eur_bs.
function extraerTasa(html, ancla) {
  const idx = html.indexOf(`id="${ancla}"`)
  if (idx === -1) return null
  const bloque = html.slice(idx, idx + 4000)
  const m = bloque.match(/strong-tb">\s*([0-9][0-9.,]*)\s*</)
  if (!m) return null
  const tasa = parseBcvNum(m[1])
  return tasa > 0 ? tasa : null
}

function extraerFechaValor(html) {
  const m = html.match(/property="dc:date"[^>]*content="(\d{4}-\d{2}-\d{2})/)
  return m?.[1] ?? null
}

// GET con la cadena fijada: es la única forma de verificar a BCV sin apagar
// TLS (medido en el piloto).
function obtener(url, headers = {}, ca = undefined) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers, servername: new URL(url).hostname, timeout: 30000, ...(ca ? { ca } : {}) },
      (res) => {
        let cuerpo = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (cuerpo += c))
        res.on('end', () => resolve({ estado: res.statusCode, cuerpo, cabeceras: res.headers }))
      },
    )
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('timeout de 30 s esperando el destino')))
  })
}

// El BCV cambió de perfil de certificación sin avisar y la cadena equivocada no
// da un error útil: Node corta la verificación del leaf. Se prueban las dos
// cadenas fijadas y se devuelve cuál pasó, para que el log y la respuesta digan
// algo cuando la tasa se retrase.
//
// El raspado sigue siendo la autoridad (es el sitio del emisor), pero ya no es
// el único camino: `fuenteAlternativa()` lee el mismo número oficial por JSON.
// La cadena de certificados del BCV se rompió el 2026-11-25 y tardó un día
// humano en arreglarse; mientras estuvo rota, la tabla conservaba 42,50 del
// 2026-09-20. Un respaldo que no depende del HTML ni del TLS de bcv.org.ve corta
// ese episodio de 66 días a unas horas.
async function ragparBcv() {
  let ultimoError = 'ninguna cadena intentada'
  for (let i = 0; i < CADENAS_BCV.length; i++) {
    const etiqueta = i === 0 ? 'ov-r36' : 'dv-r36'
    const t0 = performance.now()
    try {
      const res = await obtener(
        BCV_URL,
        { 'User-Agent': UA, Accept: 'text/html' },
        CADENAS_BCV[i],
      )
      const ms = Math.round(performance.now() - t0)
      if (res.estado !== 200) throw new Error(`bcv.org.ve respondió ${res.estado} (${ms} ms)`)
      const tasaUsd = extraerTasa(res.cuerpo, 'dolar')
      if (!tasaUsd) throw new Error('no se encontró el valor USD en el HTML del BCV')
      return {
        fuente: 'bcv-html',
        tasaUsd,
        tasaEur: extraerTasa(res.cuerpo, 'euro'),
        fecha: extraerFechaValor(res.cuerpo),
        ms,
        bytes: res.cuerpo.length,
        estado: res.estado,
        cadena: etiqueta,
      }
    } catch (e) {
      ultimoError = `${etiqueta}: ${e?.message ?? e}`
    }
  }
  throw new Error(`bcv.org.ve no verificó con ninguna cadena fijada — ${ultimoError}`)
}

// dolarapi (ve.dolarapi.com) publica el mismo promedio oficial del BCV en JSON,
// con la fecha de actualización en la respuesta. No es un número distinto: es el
// del BCV redistribuido, así que sirve de respaldo y de contraste.
const DOLARAPI = {
  usd: 'https://ve.dolarapi.com/v1/dolares/oficial',
  eur: 'https://ve.dolarapi.com/v1/euros',
}

async function pedirJson(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`${new URL(url).pathname} respondió ${res.status}`)
  return res.json()
}

function promedioDe(cuerpo, moneda) {
  const filas = Array.isArray(cuerpo) ? cuerpo : [cuerpo]
  const oficial = filas.find((f) => f?.fuente === 'oficial' && f?.moneda === moneda)
  const n = Number(oficial?.promedio)
  // "2026-11-26T00:00:00-04:00" → la parte fecha, sin zona: el Fecha Valor del
  // BCV se guarda igual, y aquí lo que importa es el día.
  const fecha = typeof oficial?.fechaActualizacion === 'string'
    ? oficial.fechaActualizacion.slice(0, 10)
    : null
  return { valor: Number.isFinite(n) && n > 0 ? n : null, fecha }
}

async function fuenteAlternativa() {
  const t0 = performance.now()
  const [usd, eur] = await Promise.all([pedirJson(DOLARAPI.usd), pedirJson(DOLARAPI.eur)])
  const d = promedioDe(usd, 'USD')
  if (!d.valor) throw new Error('dolarapi no trajo un promedio oficial positivo')
  const e = promedioDe(eur, 'EUR')
  return {
    fuente: 'dolarapi',
    tasaUsd: d.valor,
    // Si el JSON del euro viniera sin valor, no se inventa: `guardarTasa`
    // conserva el último EUR de la fila con el `coalesce`.
    tasaEur: e.valor,
    fecha: d.fecha,
    ms: Math.round(performance.now() - t0),
  }
}

// Las dos fuentes se consultan siempre que el raspado alcance, para medir de
// verdad si están de acuerdo; si el raspado cae, la alternativa pasa a ser la
// fuente del número que se guarda.
async function obtenerTasa() {
  const intentos = []
  let principal = null
  try {
    principal = await ragparBcv()
    intentos.push({ fuente: 'bcv-html', ok: true, ms: principal.ms })
  } catch (e) {
    intentos.push({ fuente: 'bcv-html', ok: false, error: String(e?.message ?? e) })
  }

  let alternativa = null
  try {
    alternativa = await fuenteAlternativa()
    intentos.push({ fuente: 'dolarapi', ok: true, ms: alternativa.ms })
  } catch (e) {
    intentos.push({ fuente: 'dolarapi', ok: false, error: String(e?.message ?? e) })
  }

  if (!principal && !alternativa)
    throw new Error(`ninguna fuente de tasa respondió — ${intentos.map((i) => `${i.fuente}: ${i.error}`).join(' | ')}`)

  const elegido = principal ?? alternativa
  const desvio =
    principal && alternativa && principal.tasaUsd > 0 && alternativa.tasaUsd > 0
      ? Math.round(((alternativa.tasaUsd - principal.tasaUsd) / principal.tasaUsd) * 10000) / 100
      : null
  return { ...elegido, desvio, intentos }
}

// ── escritura ──────────────────────────────────────────────────────────
async function guardarTasa(fecha, tasaUsd, tasaEur, fuente) {
  const r = await pool.query(
    `insert into public.tasas_cambio (fecha, tasa_bcv, tasa_eur_bs, fuente)
     values ($1, $2, $3, $4)
     on conflict (fecha) do update
        set tasa_bcv    = excluded.tasa_bcv,
            tasa_eur_bs = coalesce(excluded.tasa_eur_bs, public.tasas_cambio.tasa_eur_bs),
            fuente      = excluded.fuente
     returning (xmax = 0) as es_insert`,
    [fecha, tasaUsd, tasaEur, fuente],
  )
  return r.rows[0]?.es_insert === true ? 'insert' : 'update'
}

// El UPDATE del viejo job 'vencimientos-diarios' de pg_cron, sin pg_cron:
// en el plan Free no se puede desactivar scale-to-zero, y pg_cron con
// scale-to-zero activo no dispara (Fase 7 del plan).
async function marcarVencidas() {
  const r = await pool.query(
    `update public.suscripciones
        set estado = 'vencida'
      where estado = 'activa'
        and fecha_corte_cliente < current_date`,
  )
  return r.rowCount
}

// ── HTTP ───────────────────────────────────────────────────────────────
const cabecerasCORS = (origin) => ({
  'Access-Control-Allow-Origin': ORIGENES.includes(origin) ? origin : ORIGENES[0],
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '600',
  Vary: 'Origin',
})

// `no-store` no es adorno: una tasa del día guardada en la caché de un proxy o
// de un CDN es un precio vencido servido como si fuera vigente. Medido acá
// mismo: el proxy de salida de esta máquina devolvía el `/tasa` viejo después
// de desplegar el nuevo, y solo una URL distinta mostró el cuerpo actualizado.
const json = (obj, estado = 200, origin) =>
  new Response(JSON.stringify(obj), {
    status: estado,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...cabecerasCORS(origin),
    },
  })

// Quién puede pedir un refresco manual. El trigger de Neon entra por su
// propia ruta (procedencia = cabecera x-neon-trigger-*), y el panel solo
// puede forzarlo con una sesión iniciada: sin esa restricción, cualquier
// visitante podría hacer POST y convertir la Function en un rebote de
// peticiones hacia bcv.org.ve.
async function autorizacionSuficiente(request) {
  const cab = request.headers.get('Authorization') ?? ''
  const token = cab.startsWith('Bearer ') ? cab.slice(7).trim() : ''
  return Boolean(verificarToken(token))
}

async function trabajar(cabecera, request) {
  const raspado = await obtenerTasa()
  if (!raspado.fecha) throw new Error(`${raspado.fuente} no devolvió la fecha del número`)
  const efecto = await guardarTasa(
    raspado.fecha,
    raspado.tasaUsd,
    raspado.tasaEur,
    raspado.fuente,
  )
  const vencidas = await marcarVencidas()
  return json(
    {
      ok: true,
      ...cabecera,
      fecha: raspado.fecha,
      tasa_bcv: raspado.tasaUsd,
      tasa_eur_bs: raspado.tasaEur,
      fuente: raspado.fuente,
      desvio_entre_fuentes: raspado.desvio,
      intentos: raspado.intentos,
      efecto,
      suscripciones_marcaron_vencidas: vencidas,
      bcv: {
        estado: raspado.estado,
        bytes: raspado.bytes,
        ms_egreso: raspado.ms,
        cadena: raspado.cadena,
      },
    },
    200,
    request.headers.get('Origin') ?? '',
  )
}

export default {
  async fetch(request) {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin') ?? ''

    try {
      if (request.method === 'OPTIONS')
        return new Response(null, { status: 204, headers: cabecerasCORS(origin) })

      if (url.pathname === '/salud')
        return json(
          {
            ok: true,
            function: 'tasabcv',
            rama: process.env.NEON_BRANCH ?? 'local',
            node: process.version,
          },
          200,
          origin,
        )

      // Lectura para verificar sin escribir: qué hay en la tabla ahora mismo.
      if (request.method === 'GET' && url.pathname === '/estado') {
        const r = await pool.query(
          `select fecha, tasa_bcv, tasa_eur_bs, fuente, created_at,
                  (current_date - fecha) as dias_vieja
             from public.tasas_cambio
            order by fecha desc limit 5`,
        )
        return json({ ok: true, tasas: r.rows, hoy: new Date().toISOString().slice(0, 10) }, 200, origin)
      }

      // Lectura pública de la última tasa: la usa el checkout, que también es
      // una página abierta por quien aún no inició sesión.
      //
      // Es la única lectura de la BD que no pasa por RLS, y es deliberado. En
      // `public.tasas_cambio` la política del esquema viejo es
      // `admin_acceso_total` (USING es_admin()), así que por la Function
      // `datos` un cliente o un visitante anónimo obtienen cero filas. Eso ya
      // rompía el checkout antes de migrar: `fetchTasaEurDelDia()` devolvía
      // null para todo el que no fuera admin, y el checkout se quedaba sin
      // precio en Bs. El número del BCV es público por naturaleza (bcv.org.ve
      // lo publica sin login), aquí solo se sirve lo ya guardado, y la ruta es
      // de solo lectura: no rayea, no fuerza el scrape, no devuelve ni una
      // fila de negocio. Por eso puede vivir fuera del sistema de tokens.
      if (request.method === 'GET' && url.pathname === '/tasa') {
        const r = await pool.query(
          `select fecha, tasa_bcv, tasa_eur_bs, fuente,
                  (current_date - fecha) as dias_vieja
             from public.tasas_cambio
            order by fecha desc limit 1`,
        )
        const fila = r.rows[0]
        if (!fila) return json({ ok: false, error: 'no hay tasa guardada' }, 404, origin)
        return json(
          {
            ok: true,
            fecha: fila.fecha,
            tasa_bcv: Number(fila.tasa_bcv),
            tasa_eur_bs: fila.tasa_eur_bs == null ? null : Number(fila.tasa_eur_bs),
            // Una fila escrita antes de existir la columna no tiene prueba de
            // quién la metió: decir «importada» sería inventar. Se reporta como
            // desconocida y el panel lo muestra tal cual.
            fuente: fila.fuente ?? 'desconocida',
            // `vigente` es lo que le dice al cliente y al checkout que el número
            // es el de hoy. Sin él, una fila vieja (como el 42,50 que quedó del
            // proyecto viejo) se lee como si fuera el precio del día.
            vigente: Number(fila.dias_vieja) <= 0,
            dias_vieja: Number(fila.dias_vieja),
          },
          200,
          origin,
        )
      }

      const entregado = await parseTriggerDelivery(request)
      if (entregado.ok) {
        // Disparo de Neon: la cabecera es la procedencia. El invocation_id va
        // al log por si hay que reconstruir la tanda de entregas.
        console.log(
          `[tasabcv] trigger ${entregado.invocation.trigger?.name ?? '?'} ` +
            `invocation=${entregado.invocation.invocationId} ` +
            `programado=${entregado.invocation.data?.scheduledAt ?? '?'}`,
        )
        return await trabajar(
          { origen: 'trigger', invocation_id: entregado.invocation.invocationId },
          request,
        )
      }

      if (entregado.error === 'missing_header') {
        if (request.method !== 'POST')
          return json({ ok: false, error: 'se espera POST' }, 405, origin)
        if (!(await autorizacionSuficiente(request)))
          return json({ ok: false, error: 'sesión no válida' }, 401, origin)
        return await trabajar({ origen: 'manual' }, request)
      }

      // Cabecera presente pero inválida: alguien la está fabricando.
      console.warn('[tasabcv] entrega de trigger rechazada:', entregado.error)
      return json({ ok: false, error: entregado.error }, 400, origin)
    } catch (e) {
      console.error('[tasabcv] lanzó:', e?.stack ?? e)
      return json({ ok: false, error: String(e?.message ?? e) }, 500, origin)
    }
  },
}
