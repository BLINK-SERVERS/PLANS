import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { db } from '../lib/db'
import { getSesion } from '../lib/sesion'
import { errMsg } from '../lib/err'
import { Button, Field, Input } from '../components/ui'
import { IconLock } from '../components/icons'

export default function Ingreso() {
  const { entrar } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setCargando(true)
    setError('')
    try {
      await entrar(email.trim(), password)
      // Redirige según el rol: admin al panel, cliente a la tienda. El id ya
      // está en la sesión guardada; antes se pedía con supabase.auth.getUser(),
      // que era una ida y vuelta más para lo mismo.
      const uid = getSesion()?.user.id
      const { data: fila } = uid
        ? await db.from('usuarios').select('rol').eq('id', uid).maybeSingle()
        : { data: null }
      navigate(fila?.rol === 'admin' ? '/panel' : '/', { replace: true })
    } catch (err) {
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
              <h1 className="text-xl font-bold text-blink-dark">Entrar</h1>
              <p className="text-sm text-blink-ink-mute">Con el correo de tu cuenta</p>
            </div>
          </div>

          {error ? (
            <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          ) : null}

          <form onSubmit={enviar} className="mt-4 space-y-4">
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
            <Field label="Contraseña">
              <Input
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>

            <Button type="submit" disabled={cargando} className="w-full justify-center">
              {cargando ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-blink-ink-mute">
            ¿No tienes cuenta?{' '}
            <Link to="/registro" className="inline-flex min-h-11 items-center px-1 font-semibold text-blink-action hover:underline">
              Regístrate
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}