import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { errMsg } from '../lib/err'
import { Button, Field, Input } from '../components/ui'
import { IconLock } from '../components/icons'

export default function Registro() {
  const { registrar } = useAuth()
  const navigate = useNavigate()
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [telefono, setTelefono] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pendiente, setPendiente] = useState(false)
  const [cargando, setCargando] = useState(false)

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    // Ocho, no seis: el mínimo lo fija `emailAndPassword.minPasswordLength`
    // en functions/auth/index.mjs, y este chequeo existe solo para no mandar
    // un request que el servidor va a rechazar con PASSWORD_TOO_SHORT. Las
    // cuentas viejas de Supabase con 6 caracteres siguen entrando — verificar
    // una contraseña no aplica la política de longitud.
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    setCargando(true)
    setError('')
    try {
      const conSesion = await registrar(email.trim(), password, {
        nombre: nombre.trim(),
        telefono: telefono.trim(),
      })
      if (conSesion) {
        // Sin confirmación de correo (requireEmailVerification:false a
        // propósito):Better Auth responde con sesión y el cliente entra
        // directo a la tienda.
        navigate('/', { replace: true, state: { registrado: true } })
      } else {
        // Camino defensivo: hoy es inalcanzable, porque `registrar` lanza si
        // el alta no devuelve sesión. Se queda por si algún día se enciende
        // la verificación por correo, que es la única forma real de llegar
        // aquí con `conSesion === false`.
        setPendiente(true)
        setCargando(false)
      }
    } catch (err) {
      // El mensaje ya viene en español: sesion.ts traduce los códigos de
      // Better Auth (USER_ALREADY_EXISTS_…, PASSWORD_TOO_SHORT,
      // USER_NOT_FOUND) antes de que lleguen aquí.
      setError(errMsg(err))
      setCargando(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-blink-fill px-4 py-10">
      <div className="w-full max-w-md space-y-4">
        <Link
          to="/"
          className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-blink-action hover:text-blink-action-hover"
        >
          ← Volver al inicio
        </Link>

        <div className="rounded-2xl border border-blink-line bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blink-action text-white">
              <IconLock className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-blink-dark">Crear cuenta</h1>
              <p className="text-sm text-blink-ink-mute">Únete para contratar tu plan</p>
            </div>
          </div>

          {pendiente ? (
            <div className="mt-5 rounded-xl bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
              <p className="font-semibold">Cuenta creada</p>
              <p className="mt-1">
                <strong>{email}</strong> ya existe en el sistema. Entra con tu correo y tu
                contraseña para continuar.
              </p>
              <Link
                to="/ingreso"
                className="mt-3 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700"
              >
                Ir a entrar
              </Link>
            </div>
          ) : (
            <>
              {error ? (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
              ) : null}

              <form onSubmit={enviar} className="mt-4 space-y-4">
                <Field label="Nombre">
                  <Input
                    required
                    autoComplete="name"
                    placeholder="Ana Pérez"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                  />
                </Field>
                <Field label="Correo">
                  <Input
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="ana@correo.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <Field label="Teléfono (opcional)">
                  <Input
                    type="tel"
                    autoComplete="tel"
                    placeholder="+58 412 123 4567"
                    value={telefono}
                    onChange={(e) => setTelefono(e.target.value)}
                  />
                </Field>
                <Field label="Contraseña">
                  <Input
                    type="password"
                    required
                    autoComplete="new-password"
                    placeholder="Mínimo 8 caracteres"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>

                <Button type="submit" disabled={cargando} className="w-full justify-center">
                  {cargando ? 'Creando cuenta…' : 'Crear cuenta'}
                </Button>
              </form>

              <p className="mt-4 text-center text-sm text-blink-ink-mute">
                ¿Ya tienes cuenta?{' '}
                <Link to="/ingreso" className="inline-flex min-h-11 items-center px-1 font-semibold text-blink-action hover:underline">
                  Entrar
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}