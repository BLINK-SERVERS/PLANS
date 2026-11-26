import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { errMsg } from '../lib/err'
import { Button, ErrorMsg, Field, Input, Loseta } from '../components/ui'
import { MarcaBlink } from '../components/marca-blink'

export default function Login() {
  const { session, entrar } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  // Si ya hay sesión (p.ej. tras recargar), ir directo al panel
  useEffect(() => {
    if (session) navigate('/panel', { replace: true })
  }, [session, navigate])

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setCargando(true)
    setError('')
    try {
      await entrar(email.trim(), password)
      navigate('/panel', { replace: true })
    } catch (err) {
      setError(errMsg(err))
      setCargando(false)
    }
  }

  return (
    <div className="panel flex min-h-screen items-center justify-center px-4 py-10">
      {/* La hoja de entrada usa el mismo vidrio que las modales del panel: sin
          nada que se desplace detrás, el `backdrop-filter` sería GPU tirada a
          la basura, así que `vidrio` aporta el velo y la sombra, no el blur. */}
      <form
        onSubmit={enviar}
        className="vidrio w-full max-w-[400px] space-y-4 rounded-hoja p-6"
      >
        <div className="flex items-center gap-3">
          <Loseta tam={38} className="text-white">
            <MarcaBlink className="h-[17px] w-[21px]" />
          </Loseta>
          <div className="leading-tight">
            <h1 className="text-title-3 font-bold text-ink-label">Blink Plans</h1>
            <p className="text-legenda text-ink-secondary">Gestión de suscripciones</p>
          </div>
        </div>

        {error ? <ErrorMsg message={error} /> : null}

        <Field label="Correo">
          <Input
            type="email"
            autoComplete="email"
            required
            placeholder="nombre@blink.com.ve"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Contraseña">
          <Input
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <Button type="submit" tam="grande" bloque disabled={cargando}>
          {cargando ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
    </div>
  )
}
