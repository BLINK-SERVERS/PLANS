import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { db } from './db'
import { errMsg } from './err'
import {
  cargarSesion,
  getSesion,
  registrarse,
  suscribir,
  entrar as authEntrar,
  salir as authSalir,
  type Sesion,
} from './sesion'
import type { Rol } from './types'

// ============================================================
//  src/lib/auth.tsx — la sesión de Better Auth, con la forma de antes
// ============================================================
//  El contexto conserva los mismos campos que tenía con Supabase
//  (session, cargando, rol, rolCargando, perfil, entrar, registrar, salir)
//  para que las ocho pantallas que lo consuman no se toquen: todas leen
//  `session.user.id`, `session.user.email` y `perfil.rol`. Lo que cambió por
//  dentro es el proveedor: ya no hay un `SupabaseClient` con autoRefreshToken
//  ni un `onAuthStateChange`; hay un cliente HTTP de ~200 líneas (sesion.ts)
//  que guarda el bearer de Better Auth en sessionStorage y reacuña el token de
//  datos de 15 minutos contra la Function `auth`.
//
//  Dos cosas que este archivo soluciona y no un efecto lateral:
//    · el ROL de la app no viene del token. El claim `role` del JWT de datos es
//      el ROL DE POSTGRES ('authenticated'|'anonymous'); el rol de negocio
//      (admin/cliente/agente) vive en public.usuarios.rol y lo consultan las
//      políticas (es_admin(), cliente_ve_su_fila). Así que `rol` se lee de la
//      propia fila, igual que antes con auth.uid().
//    · el teléfono del registro. Con Supabase viajaba en raw_user_meta_data y
//      un trigger de auth lo copiaba a `usuarios`. Better Auth no tiene ese
//      webhook: el hook de `functions/auth` crea la fila con nombre y correo,
//      y el teléfono —que no es campo core— lo escribe el front justo después,
//      amparado por la política cliente_edita_su_fila.

// Perfil del usuario autenticado: su propia fila en `usuarios`
// (creada por el hook de registro de la Function auth).
export interface PerfilPropio {
  rol: Rol
  nombre: string
  email: string | null
  telefono: string | null
}

interface AuthContextValue {
  session: Sesion | null
  cargando: boolean
  rol: Rol | null
  rolCargando: boolean
  perfil: PerfilPropio | null
  entrar: (email: string, password: string) => Promise<void>
  registrar: (
    email: string,
    password: string,
    datos: { nombre: string; telefono: string },
  ) => Promise<boolean>
  salir: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Sesion | null>(getSesion())
  const [cargando, setCargando] = useState(true)
  const [rol, setRol] = useState<Rol | null>(null)
  const [rolCargando, setRolCargando] = useState(false)
  const [perfil, setPerfil] = useState<PerfilPropio | null>(null)

  // Carga la fila propia en `usuarios` (rol, nombre, teléfono).
  const cargarPerfil = async (userId: string | undefined) => {
    if (!userId) {
      setRol(null)
      setPerfil(null)
      return
    }
    setRolCargando(true)
    const { data, error } = await db
      .from('usuarios')
      .select('rol, nombre, email, telefono')
      .eq('id', userId)
      .maybeSingle()
    if (!error) {
      setPerfil((data as PerfilPropio | null) ?? null)
      setRol(data ? (data as PerfilPropio).rol : null)
    }
    setRolCargando(false)
  }

  useEffect(() => {
    let activo = true

    // Suscripción primero: cualquier publicar() posterior (login en otra
    // pestaña, expiración del token de sesión, logout) llega aquí.
    const cerrar = suscribir((_evento, s) => {
      if (!activo) return
      setSession(s)
      if (s) void cargarPerfil(s.user.id)
      else {
        setRol(null)
        setRolCargando(false)
        setPerfil(null)
      }
    })

    // Revalida lo que quedó en sessionStorage. Sin esto, un token de sesión
    // revocado en el servidor daría un panel "logueado" que falla en cada
    // consulta; con esto arranca limpio.
    void cargarSesion().finally(() => {
      if (activo) setCargando(false)
    })

    return () => {
      activo = false
      cerrar()
    }
  }, [])

  const entrar = async (email: string, password: string): Promise<void> => {
    const { error } = await authEntrar(email, password)
    if (error) throw new Error(errMsg(error))
    // Carga inmediata del perfil (el suscriptor también lo hará).
    await cargarPerfil(getSesion()?.user.id)
  }

  // Registro público. Better Auth responde con sesión porque la verificación
  // de correo está apagada a propósito (el panel es de cobro inmediato y no
  // hay proveedor de correo contratado); por eso `registrar` casi siempre
  // devuelve true y Registro.tsx entra directo a la tienda.
  const registrar = async (
    email: string,
    password: string,
    datos: { nombre: string; telefono: string },
  ): Promise<boolean> => {
    const { data, error } = await registrarse({
      nombre: datos.nombre,
      email,
      password,
    })
    if (error) throw new Error(errMsg(error))
    const uid = data?.user.id
    if (!uid) return false
    // El teléfono no viaja en el signup de Better Auth: se escribe después.
    // Si esa escritura falla, la cuenta ya existe y ya tiene sesión — no por
    // eso se le va a decir al cliente que el registro falló.
    if (datos.telefono) {
      const { error: errTel } = await db
        .from('usuarios')
        .update({ telefono: datos.telefono })
        .eq('id', uid)
      if (errTel) console.warn('registro: el teléfono no se guardó:', errMsg(errTel))
    }
    await cargarPerfil(uid)
    return true
  }

  const salir = async (): Promise<void> => {
    await authSalir()
    setSession(null)
    setRol(null)
    setRolCargando(false)
    setPerfil(null)
  }

  return (
    <AuthContext.Provider
      value={{ session, cargando, rol, rolCargando, perfil, entrar, registrar, salir }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
