// Sonda: ¿qué hace Node 24 con la cadena TLS rota de bcv.org.ve?
// El servidor de BCV envía el leaf firmado por "Sectigo Public Server
// Authentication CA DV R36" pero NO envía ese intermedio (manda el antiguo
// "Sectigo RSA DV Secure Server CA"). OpenSSL no persigue AIA por sí solo, así
// que la verificación se corta: "unable to verify the first certificate".
//
// Dos arreglos posibles, y hay que saber cuál funciona antes de escribir la
// Function:
//   A) https.get con `ca` = el intermedio R36 fijado (pinning explícito).
//   B) NODE_EXTRA_CA_CERTS apuntando a ese mismo PEM, para que `fetch` siga
//      igual que en el Edge Function viejo.
import https from 'node:https'
import { readFileSync } from 'node:fs'

const URL_BCV = 'https://www.bcv.org.ve/seccionportal/tipo-de-cambio-oficial-del-bcv'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const r36 = readFileSync('/tmp/bcv-cadena-fijada.pem', 'utf8')

// ── A · fetch sin más (así llegaría la Function tal cual) ────────────────
try {
  const r = await fetch(URL_BCV, { headers: { 'User-Agent': UA } })
  console.log('A·fetch sin fijar      →', r.status, '(bytes', (await r.text()).length, ')')
} catch (e) {
  console.log('A·fetch sin fijar      → ERROR', e.cause?.code ?? e.cause?.message ?? e.message)
}

// ── B · https.get con el intermedio fijado (pinning) ─────────────────────
const conPin = await new Promise((resuelve) => {
  const req = https.get(
    URL_BCV,
    { headers: { 'User-Agent': UA, Accept: 'text/html' }, ca: [r36], servername: 'www.bcv.org.ve', timeout: 25000 },
    (res) => {
      let cuerpo = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (cuerpo += c))
      res.on('end', () => resuelve({ estado: res.statusCode, bytes: cuerpo.length, cuerpo }))
    },
  )
  req.on('error', (e) => resuelve({ error: e.code ?? e.message }))
  req.on('timeout', () => { req.destroy(); resuelve({ error: 'timeout' }) })
})
console.log('B·https.get ca=[R36]   →', JSON.stringify({ estado: conPin.estado, bytes: conPin.bytes, error: conPin.error }))

// Parseo con la lógica portada del Edge Function viejo
if (conPin.cuerpo) {
  const idx = conPin.cuerpo.indexOf('id="dolar"')
  const bloque = conPin.cuerpo.slice(idx, idx + 4000)
  const m = bloque.match(/strong-tb">\s*([0-9][0-9.,]*)\s*</)
  const f = conPin.cuerpo.match(/property="dc:date"[^>]*content="(\d{4}-\d{2}-\d{2})/)
  const limpio = String(m?.[1] ?? '').replace(/\s+/g, '').replace(/\.(?=\d{3}\D)/g, '')
  console.log('   tasa USD =', Number(limpio.replace(/,/g, '.')), '· fecha valor =', f?.[1])
}
