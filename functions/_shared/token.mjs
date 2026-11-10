// ============================================================
//  functions/_shared/token.mjs — el token de datos (JWT HS256)
// ============================================================
// Lo emite la Function `auth` y lo verifica la Function `datos`. No es el
// token de sesión de Better Auth.
//
// ¿Por qué otro token si ya hay uno? Porque el camino que resolvió el piloto
// (piloto/RESULTADOS.md, «Proveedor externo de la Data API») descarta usar la
// Data API de Neon con un JWT propio: la caché JWKS de la plataforma no se
// refresca de forma predecible y las llamadas autenticadas caen a ~60 %. La
// consecuencia de diseño es que los datos autenticados pasan por `datos`, y
// entonces el verificador somos nosotros. Ahí HS256 con un secreto compartido
// entre dos Functions del mismo proyecto es lo más simple que existe: sin
// JWKS, sin fetch cruzado por petición, sin rotación que propagar.
//
// ¿Por qué no reutilizar BETTER_AUTH_SECRET? Porque un secreto que firma
// sesiones de login y además autoriza consultas a la BD es un único punto de
// fallo para dos cosas distintas. BLINK_DATA_JWT_SECRET va aparte.
//
// El claim `role` existe para que `datos` haga `set local role` y las políticas
// RLS heredadas del esquema viejo funcionen sin tocarlas: `authenticated`
// lleva `sub`, `anonymous` es la ausencia de token.

import { createHmac, timingSafeEqual } from 'node:crypto'

const ALG = 'HS256'
const ISS = 'blink-plans-auth'

function secreto() {
  const s = process.env.BLINK_DATA_JWT_SECRET
  if (!s || s.length < 32) {
    // Fallo en arranque, no por petición: un secreto ausente o corto tiene
    // que tumbar el deploy, no colar tokens firmados con cadena vacía.
    throw new Error('BLINK_DATA_JWT_SECRET falta o tiene menos de 32 caracteres')
  }
  return s
}

const b64url = (datos) => Buffer.from(datos).toString('base64url')

const firmar = (datos) =>
  b64url(createHmac('sha256', secreto()).update(datos).digest())

/** `{sub, sid, role}` → JWT HS256 de 15 minutos por defecto. */
export function firmarToken({ sub, sid, role = 'authenticated', ttlSegundos = 900 }) {
  const ahora = Math.floor(Date.now() / 1000)
  const cabecera = b64url(JSON.stringify({ alg: ALG, typ: 'JWT' }))
  const cuerpo = b64url(
    JSON.stringify({ iss: ISS, sub, sid, role, iat: ahora, exp: ahora + ttlSegundos }),
  )
  const firma = firmar(`${cabecera}.${cuerpo}`)
  return { token: `${cabecera}.${cuerpo}.${firma}`, exp: ahora + ttlSegundos }
}

/**
 * Verifica alg, firma, emisor y expiración. Devuelve el payload o null.
 * Null NO es un fallo de transporte: significa «este pedido no está
 * autenticado», y el llamador decide si responde 401 o sigue como anonymous.
 */
export function verificarToken(token) {
  if (typeof token !== 'string') return null
  const partes = token.split('.')
  if (partes.length !== 3) return null
  const [cabecera, cuerpo, firma] = partes

  let cabeza
  try {
    cabeza = JSON.parse(Buffer.from(cabecera, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  // Sin esto, un `alg: none` o un RS256 de otro emisor se cuelan en la
  // comparación de firmas.
  if (cabeza?.alg !== ALG || cabeza?.typ !== 'JWT') return null

  const esperado = firmar(`${cabecera}.${cuerpo}`)
  const a = Buffer.from(esperado)
  const b = Buffer.from(firma)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  let payload
  try {
    payload = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (payload.iss !== ISS) return null
  if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000))
    return null
  if (payload.role !== 'authenticated' && payload.role !== 'anonymous') return null
  return payload
}
