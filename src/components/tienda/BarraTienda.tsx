import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { IconCart, IconLogout } from '../icons'
import { MarcaBlink } from '../marca-blink'
import { useCarrito } from './CarritoProvider'

// Barra superior compartida del sitio público (landing y detalle de plataforma)
export default function BarraTienda({ volver = false }: { volver?: boolean }) {
  const { session, rol, perfil, salir } = useAuth()
  const { total } = useCarrito()
  const navigate = useNavigate()

  const salirDeTienda = async () => {
    await salir()
    navigate('/', { replace: true })
  }

  const saludo = perfil?.nombre || (session?.user.email ?? '').split('@')[0] || ''

  return (
    <header className="sticky top-0 z-40 border-b border-blink-line bg-white/92 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {volver ? (
            <Link
              to="/"
              aria-label="Volver al inicio"
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-blink-line-strong px-3 text-sm font-medium text-blink-muted hover:bg-blink-soft"
            >
              ←<span className="hidden sm:inline">Inicio</span>
            </Link>
          ) : null}
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--blink-primary)] text-white">
              <MarcaBlink className="h-5 w-auto" />
            </span>
            {/* A 390 px el letrero escrito más los tres enlaces no caben en una
                fila: `flex-wrap` los partía en dos filas de barra y el hero se
                veía a través del vidrio. El letrero queda desde `sm` y en el
                teléfono manda el isotipo, que es la marca igual. */}
            <span className="hidden whitespace-nowrap text-lg font-bold text-blink-dark sm:inline">
              Blink Plans
            </span>
          </Link>
        </div>
        <nav className="flex shrink-0 flex-nowrap items-center justify-end gap-1.5 text-sm sm:gap-2">
          <Link
            to="/carrito"
            aria-label={`Carrito (${total} artículo${total === 1 ? '' : 's'})`}
            className="relative inline-flex items-center justify-center rounded-full border border-blink-line-strong p-2 text-blink-muted transition-colors hover:bg-blink-soft"
          >
            <IconCart className="h-5 w-5" />
            {total > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-blink-action px-1 text-[10px] font-bold text-white">
                {total}
              </span>
            ) : null}
          </Link>
          {session ? (
            <>
              {rol === 'admin' ? (
                <Link
                  to="/panel"
                  className="inline-flex min-h-11 items-center rounded-full bg-blink-action px-4 py-2 font-semibold text-white hover:bg-blink-action-hover"
                >
                  Panel admin
                </Link>
              ) : (
                <span className="hidden max-w-[10rem] truncate px-2 text-blink-muted sm:inline">
                  Hola, {saludo} 👋
                </span>
              )}
              <button
                onClick={salirDeTienda}
                className="inline-flex min-h-11 items-center gap-1 rounded-full border border-blink-line-strong px-3 text-blink-muted hover:bg-blink-soft"
              >
                <IconLogout className="h-4 w-4" /> Salir
              </button>
            </>
          ) : (
            <>
              <Link
                to="/ingreso"
                className="inline-flex min-h-11 items-center rounded-full border border-blink-line-strong px-4 py-2 font-semibold text-blink-muted hover:bg-blink-soft"
              >
                Ingresar
              </Link>
              <Link
                to="/registro"
                className="inline-flex min-h-11 items-center rounded-full bg-blink-action px-4 py-2 font-semibold text-white hover:bg-blink-action-hover"
              >
                Registrarse
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}