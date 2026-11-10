// ============================================================
//  src/lib/sesion.ts — cliente de login y reserva del token de datos
// ============================================================
//  Es un cliente HTTP de ~100 líneas en vez de `better-auth/client`. Motivo
//  concreto, no estética: en la versión instalada (1.7.19) el paquete de
//  plugins de cliente no exporta `bearerClient` (se comprueba con
//  `node -e "import('better-auth/client/plugins').then(m=>console.log(Object.keys(m)))"`),
//  y el modo bearer es justamente la decisión que sostiene todo el despliegue
//  — GitHub Pages no puede mandar cookies cross-site a la Function. El
//  surface de auth que usa este panel son cuatro llamadas (sign-in, sign-up,
//  sign-out, get-session); escribirlas a mano es menos riesgo que pelearse
//  con la API de un cliente que además hay que embutir en el bundle.
//
//  Dos tokens, y cada uno hace una sola cosa:
//    · token de sesión  → el de Better Auth. Autentica contra la Function
//      `auth` (cerrar sesión, reacuñar).
//    · token de datos   → el JWT HS256 de 15 min que emite POST /token y que
//      verifica la Function `datos`. Se reacuña solo, antes de vencer, o al
//      recibir un 401.
//  Ambos en sessionStorage: cerrar la pestaña cierra la sesión.

import { CLAVE_TOKEN, URL_AUTH } from './entorno'

export interface UsuarioSesion {
  id: string
  email: string
  name?: string
}

export interface Sesion {
  user: UsuarioSesion
  // `token` es el token de sesión de Better Auth; se guarda porque sin él no
  // se puede ni cerrar sesión ni reacuñar el de datos.
  token: string
}

export interface ErrorAuth {
  message: string
  code?: string
}

type Respuesta<T> = { data: T | null; error: ErrorAuth | null }

// ------------------------------------------------------------------ almacén
let sesion: Sesion | null = null
try {
  const crudo = sessionStorage.getItem(CLAVE_TOKEN)
  if (crudo) sesion = JSON.parse(crudo) as Sesion
} catch {
  sesion = null
}

const oidores = new Set<(s: Sesion | null) => void>()

function publicar(s: Sesion | null) {
  sesion = s
  try {
    if (s) sessionStorage.setItem(CLAVE_TOKEN, JSON.stringify(s))
    else sessionStorage.removeItem(CLAVE_TOKEN)
  } catch {
    // Navegación privada con sessionStorage lleno: la sesión sigue viva en
    // memoria y se pierde al recargar, que es el peor caso aceptable.
  }
  for (const o of oidores) o(s)
}

export const getSesion = (): Sesion | null => sesion

export function suscribir(
  cb: (event: 'SIGN_IN' | 'SIGN_OUT' | 'INITIAL', s: Sesion | null) => void,
): () => void {
  const o = (s: Sesion | null) => cb(s ? 'SIGN_IN' : 'SIGN_OUT', s)
  oidores.add(o)
  return () => oidores.delete(o)
}

// --------------------------------------------------------------------- HTTP
async function pedir<T>(
  ruta: string,
  opciones: RequestInit = {},
  conSesion = true,
): Promise<Respuesta<T>> {
  const cabeceras = new Headers({ 'Content-Type': 'application/json', ...(opciones.headers ?? {}) })
  // El bearer va en cada llamada: Better Auth identifica la sesión por el
  // token (tabla session) y no por cookie, así que `credentials: 'omit'` de
  // abajo es obligatorio — con cookies el servidor intentaría validar el
  // Origin contra su baseURL y el front vive en otro origin.
  if (conSesion && sesion?.token) cabeceras.set('Authorization', `Bearer ${sesion.token}`)

  let res: Response
  try {
    res = await fetch(`${URL_AUTH}${ruta}`, { ...opciones, headers: cabeceras, credentials: 'omit' })
  } catch (e) {
    return { data: null, error: { message: `sin conexión con el login: ${(e as Error).message}` } }
  }

  let cuerpo: unknown = null
  try {
    cuerpo = await res.json()
  } catch {
    /* 204, HTML de error, o Function dormida */
  }

  if (!res.ok) {
    const c = cuerpo as { message?: string; code?: string; error?: { message?: string; code?: string } } | null
    const mensaje = c?.message ?? c?.error?.message ?? `HTTP ${res.status}`
    // Better Auth devuelve 404 con USER_NOT_FOUND; el front quiere español.
    return {
      data: null,
      error: {
        message: /USER_NOT_FOUND|Invalid login credentials|Incorrect email or password/i.test(mensaje)
          ? 'Correo o contraseña incorrectos'
          : /USER_ALREADY_EXISTS|already/i.test(mensaje)
            ? 'Ese correo ya está registrado'
            : /PASSWORD_TOO_SHORT/i.test(mensaje)
              ? 'La contraseña necesita al menos 8 caracteres'
              : mensaje,
        code: c?.code ?? c?.error?.code,
      },
    }
  }
  return { data: cuerpo as T, error: null }
}

// `sign-in/email` responde { user, session } en unas versiones y { token, user }
// en otras (el bearer plugin). Se leen ambas formas para que un upgrade de
// better-auth no rompa el login en silencio.
function normalizar(cuerpo: unknown): Sesion | null {
  const c = cuerpo as {
    token?: string
    user?: UsuarioSesion
    session?: { token?: string }
  } | null
  const token = c?.token ?? c?.session?.token
  const user = c?.user
  if (!token || !user?.id) return null
  return { token, user }
}

export async function entrar(email: string, password: string): Promise<Respuesta<Sesion>> {
  const r = await pedir<Sesion & { user?: UsuarioSesion; session?: { token?: string } }>(
    '/api/auth/sign-in/email',
    { method: 'POST', body: JSON.stringify({ email, password }) },
    false,
  )
  if (r.error || !r.data) return { data: null, error: r.error ?? { message: 'login sin respuesta' } }
  const s = normalizar(r.data)
  if (!s) return { data: null, error: { message: 'el login no devolvió sesión' } }
  publicar(s)
  await reacuñar(true)
  return { data: s, error: null }
}

export async function registrarse(input: {
  nombre: string
  email: string
  password: string
}): Promise<Respuesta<Sesion>> {
  const r = await pedir<unknown>('/api/auth/sign-up/email', {
    method: 'POST',
    // `name` es campo core de Better Auth: con él el hook de registro tiene
    // con qué crear la fila de public.usuarios.
    body: JSON.stringify({ name: input.nombre, email: input.email, password: input.password }),
  })
  if (r.error || !r.data) return { data: null, error: r.error ?? { message: 'registro sin respuesta' } }
  const s = normalizar(r.data)
  if (!s) return { data: null, error: { message: 'el registro no devolvió sesión' } }
  publicar(s)
  await reacuñar(true)
  return { data: s, error: null }
}

export async function salir(): Promise<void> {
  await pedir('/api/auth/sign-out', { method: 'POST' })
  publicar(null)
  tokenDatos = null
}

/**
 * Revalida la sesión guardada contra la Function (el token de datos puede
 * haber vencido y la sesión no). Se llama al montar el AuthProvider.
 */
export async function cargarSesion(): Promise<Sesion | null> {
  if (!sesion?.token) return null
  const r = await pedir<{ user?: UsuarioSesion; session?: { token?: string } }>('/api/auth/get-session')
  if (r.error || !r.data?.user) {
    publicar(null)
    tokenDatos = null
    return null
  }
  await reacuñar(true)
  return sesion
}

// -------------------------------------------------------- token de datos
let tokenDatos: string | null = null
let expiraEn = 0
let reacuñando: Promise<string | null> | null = null

/**
 * Devuelve un JWT de datos vivo, acuñándolo si hace falta. Las llamadas
 * concurrentes comparten una sola reacuñación (para eso está `reacuñando`),
 * porque el panel dispara siete u ocho consultas al abrir el Dashboard.
 */
export async function reacuñar(forzar = false): Promise<string | null> {
  if (!sesion?.token) return null
  if (!forzar && tokenDatos && Date.now() / 1000 < expiraEn - 30) return tokenDatos
  if (reacuñando) return reacuñando

  reacuñando = (async () => {
    const r = await pedir<{ token: string; exp: number }>('/token', { method: 'POST' })
    tokenDatos = r.data?.token ?? null
    expiraEn = r.data?.exp ?? 0
    return tokenDatos
  })().finally(() => {
    reacuñando = null
  })
  return reacuñando
}

/** Lo usa db.ts en cada llamada; null = anónimo (la tienda pública). */
export async function tokenParaDatos(): Promise<string | null> {
  return reacuñar()
}

/** Tras un 401: se descarta el token y se reacuña una sola vez. */
export function invalidarToken(): void {
  tokenDatos = null
  expiraEn = 0
}
