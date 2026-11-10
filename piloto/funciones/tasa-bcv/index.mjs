// Piloto — experimentos 4 y 5 del gate: una Neon Function que (a) hace egress
// a bcv.org.ve, raspa la tasa oficial y la guarda, y (b) registra el
// invocation_id de los Function Triggers para medir la garantía at-least-once.
//
// Es el germen de functions/tasa-bcv de la Fase 7, escrito contra la forma real
// de las APIs (@neon/functions 0.11.0: parseTriggerDelivery lee la cabecera
// x-neon-trigger-invocation-id y body.invocation_id; attachDatabasePool evita
// que un idle disconnect sea un uncaughtException que mate el isolate).
//
// No hay autenticación aquí a propósito: un trigger de Neon POSTea a la URL
// nativa sin JWT ni secreto. En producción (Fase 7) la ruta de trigger se
// protege comprobando que el invocation_id está presente y es bien formado, y
// las rutas manuales llevan un secreto server-side.
import { Pool } from 'pg'
import https from 'node:https'
import { attachDatabasePool } from '@neon/functions'
import { parseTriggerDelivery } from '@neon/functions/triggers'
import { CADENA_BCV } from './ca-sectigo.mjs'

// Módulo: se mide el arranque en frío (el coste de cargar y conectar).
const tModulo = performance.now()

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 })
attachDatabasePool(pool)

const BCV_URL = 'https://www.bcv.org.ve/seccionportal/tipo-de-cambio-oficial-del-bcv'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36'

// ── parseo portado del Edge Function viejo (supabase/functions/fetch-bcv) ──
function parseBcvNum(raw) {
  const clean = String(raw).replace(/\s+/g, '').replace(/\.(?=\d{3}\D)/g, '')
  const num = Number(clean.replace(/,/g, '.'))
  return Number.isFinite(num) ? num : NaN
}

function extraerTasaUsd(html) {
  const idx = html.indexOf('id="dolar"')
  if (idx === -1) throw new Error('no se encontró el bloque #dolar en el HTML del BCV')
  const bloque = html.slice(idx, idx + 4000)
  const m = bloque.match(/strong-tb">\s*([0-9][0-9.,]*)\s*</)
  if (!m) throw new Error('no se encontró el valor USD dentro del bloque #dolar')
  const tasa = parseBcvNum(m[1])
  if (!(tasa > 0)) throw new Error(`tasa USD inválida parseada del HTML: "${m[1]}"`)
  return tasa
}

function extraerFechaValor(html) {
  const m = html.match(/property="dc:date"[^>]*content="(\d{4}-\d{2}-\d{2})/)
  return m?.[1] ?? new Date().toISOString().slice(0, 10)
}

// GET con la cadena fijada: es la única forma de verificar a BCV sin apagar
// TLS (medido: fetch e https.get con el almacén del sistema dan
// UNABLE_TO_VERIFY_LEAF_SIGNATURE porque el intermedio R36 no se envía).
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

// ── egreso: el scrape real, con la métrica que pide el experimento 4 ──────
async function ragparBcv() {
  const t0 = performance.now()
  const res = await obtener(BCV_URL, { 'User-Agent': UA, Accept: 'text/html' }, CADENA_BCV)
  const ms = Math.round(performance.now() - t0)
  await pool.query(
    `insert into piloto_egreso (destino, estado, bytes, ms, nota) values ($1, $2, $3, $4, $5)`,
    [BCV_URL, res.estado, res.cuerpo.length, ms, 'scrape bcv (CA fijada R36+R46)'],
  ).catch((e) => console.error('[egreso] no se pudo registrar:', e.message))
  if (res.estado !== 200) throw new Error(`bcv.org.ve respondió ${res.estado} (${ms} ms)`)
  return { tasa: extraerTasaUsd(res.cuerpo), fecha: extraerFechaValor(res.cuerpo), ms, bytes: res.cuerpo.length, estado: res.estado }
}

// ¿Egress genérico? Se mide un segundo destino sin fijar nada, para separar
// "Neon bloquea la salida" de "la cadena de BCV está rota".
async function sondaEgreso(destino) {
  const t0 = performance.now()
  try {
    const res = await obtener(destino, { 'User-Agent': UA })
    const ms = Math.round(performance.now() - t0)
    await pool.query(
      `insert into piloto_egreso (destino, estado, bytes, ms, nota) values ($1, $2, $3, $4, 'sonda')`,
      [destino, res.estado, res.cuerpo.length, ms],
    ).catch(() => {})
    return { destino, estado: res.estado, bytes: res.cuerpo.length, ms }
  } catch (e) {
    const ms = Math.round(performance.now() - t0)
    await pool.query(
      `insert into piloto_egreso (destino, estado, bytes, ms, nota) values ($1, null, null, $2, $3)`,
      [destino, ms, `error: ${e.message}`],
    ).catch(() => {})
    return { destino, error: e.message, ms }
  }
}

async function guardarTasa(fecha, tasa) {
  const r = await pool.query(
    `insert into tasas_cambio (fecha, tasa_bcv, fuente, actualizada_en)
     values ($1, $2, 'bcv.oficial', now())
     on conflict (fecha) do update
        set tasa_bcv = excluded.tasa_bcv, actualizada_en = now()
     returning (xmax = 0) as es_insert`,
    [fecha, tasa],
  )
  return r.rows[0]?.es_insert === true ? 'insert' : 'update'
}

// Idempotencia: la PK es el invocation_id. `xmax = 0` distingue el insert
// (disparo nuevo) del ON CONFLICT DO UPDATE (re-entrega), que solo suma.
async function registrarInvocacion(inv) {
  const r = await pool.query(
    `insert into piloto_invocaciones (invocation_id, trigger_id, trigger_name, scheduled_at, resultado)
     values ($1, $2, $3, $4, 'recibida')
     on conflict (invocation_id) do update
        set reentregas = piloto_invocaciones.reentregas + 1
     returning (xmax = 0) as es_insert, reentregas`,
    [inv.invocationId, inv.trigger?.id ?? null, inv.trigger?.name ?? null, inv.data?.scheduledAt ?? null],
  )
  return { nuevo: r.rows[0]?.es_insert === true, reentregas: r.rows[0]?.reentregas ?? 0 }
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

async function scrapeYGuarda(cabecera) {
  const raspado = await ragparBcv()
  const efecto = await guardarTasa(raspado.fecha, raspado.tasa)
  return json({
    ok: true,
    ...cabecera,
    fecha: raspado.fecha,
    tasa_bcv: raspado.tasa,
    efecto,
    fuente: 'bcv.oficial',
    bcv: { estado: raspado.estado, bytes: raspado.bytes, ms_egreso: raspado.ms },
    arranque: { modulo_ms: Math.round(tModulo), cold: !globalThis.__piloto_caliente },
  })
}

export default {
  async fetch(request) {
    globalThis.__piloto_caliente = true
    const url = new URL(request.url)

    // GET /estado → evidencia leída de la BD (lo que confirman los experimentos)
    if (request.method === 'GET' && url.pathname === '/estado') {
      const tasas = await pool.query(`select fecha, tasa_bcv, fuente, actualizada_en from tasas_cambio order by fecha desc limit 5`)
      const resumen = await pool.query(`select count(*)::int as total, coalesce(sum(reentregas),0)::int as reentregas from piloto_invocaciones`)
      const ultimas = await pool.query(`select invocation_id, trigger_name, scheduled_at, resultado, reentregas, recibida_en from piloto_invocaciones order by recibida_en desc limit 10`)
      const egreso = await pool.query(`select destino, estado, bytes, ms, nota, cuando from piloto_egreso order by id desc limit 10`)
      return json({
        DATABASE_URL: process.env.DATABASE_URL ? 'injectada ✓' : 'AUSENTE',
        env: {
          NEON_BRANCH: process.env.NEON_BRANCH,
          NEON_BRANCH_ID: process.env.NEON_BRANCH_ID,
          NEON_FUNCTION_HOST_SUFFIX: process.env.NEON_FUNCTION_HOST_SUFFIX,
          NEON_DATA_API_URL: process.env.NEON_DATA_API_URL ?? null,
          NEON_AUTH_BASE_URL: process.env.NEON_AUTH_BASE_URL ?? null,
        },
        node: process.version,
        tasas: tasas.rows,
        invocaciones: resumen.rows[0],
        ultimas_invocaciones: ultimas.rows,
        egresos: egreso.rows,
      })
    }

    // GET /sonda?destino=… → prueba de egress genérica
    if (request.method === 'GET' && url.pathname === '/sonda') {
      const destino = url.searchParams.get('destino') ?? 'https://example.com'
      return json(await sondaEgreso(destino))
    }

    // GET|POST /ecos → qué cabeceras llegan de verdad (descartar que el
    // runtime quite las cabeceras x-neon-* que mande un cliente: si las
    // quitara, la ruta de trigger no se podría falsificar desde fuera).
    if (url.pathname === '/ecos') {
      return json({
        metodo: request.method,
        cabeceras: Object.fromEntries(request.headers),
        parse: await parseTriggerDelivery(request),
      })
    }

    // POST / → disparo (manual o por trigger)
    if (request.method === 'POST' && (url.pathname === '/' || url.pathname === '/scrape')) {
      const parsed = await parseTriggerDelivery(request)
      if (parsed.ok) {
        const { nuevo } = await registrarInvocacion(parsed.invocation)
        const r = await scrapeYGuarda({
          origen: 'trigger',
          invocation_id: parsed.invocation.invocationId,
          duplicado: !nuevo,
        })
        await pool.query(`update piloto_invocaciones set resultado='ok' where invocation_id=$1`, [parsed.invocation.invocationId])
        return r
      }
      if (parsed.error === 'missing_header') {
        return await scrapeYGuarda({ origen: 'manual (sin cabecera de trigger)' })
      }
      return json({ ok: false, error: parsed.error }, 400)
    }

    return json({
      ok: true,
      rutas: ['GET /estado', 'GET /sonda?destino=', 'POST / (trigger o manual)'],
      node: process.version,
    })
  },
}
