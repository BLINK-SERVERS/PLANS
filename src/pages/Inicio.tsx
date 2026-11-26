import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { fetchCatalogoPublico } from '../lib/api'
import {
  agruparCatalogo,
  esCanva,
  esGoogle,
  esSpotify,
  precioUsd,
  slugPlataforma,
  varianteHorizontal,
  type PlataformaTienda,
} from '../lib/tienda'
import { errMsg } from '../lib/err'
import { METODOS_PAGO } from '../lib/pagos'
import { desdeGiftCardsEur } from '../lib/giftcards'
import BarraTienda from '../components/tienda/BarraTienda'
import BarraCompra from '../components/tienda/BarraCompra'
import TarjetasHorizontales from '../components/tienda/TarjetasHorizontales'
import { IconoApple, IconoCanvaC, IconoSpotify } from '../components/tienda/IconosMarca'

const FONT_DISPLAY = 'var(--font-display), system-ui, sans-serif'

// Google One salió de venta (migración 0005). Si el catálogo llegara a
// devolverlo igual, la landing lo filtra: no se anuncia lo que no se puede cobrar.
function puertasDelCatalogo(items: PlataformaTienda[]): PlataformaTienda[] {
  return items.filter((p) => !esGoogle(p.nombre) && (esCanva(p.nombre) || esSpotify(p.nombre)))
}

// ---------- Puerta de Apple (gift cards, tarifa fija en código) ----------
function PuertaApple() {
  return (
    <Link
      to="/tienda/apple"
      className="group flex flex-col items-start gap-1 rounded-2xl border border-blink-line bg-white p-6 transition-shadow hover:shadow-lg"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#1D1D1F]">
        <IconoApple className="h-7 w-7" fill="#FFFFFF" />
      </span>
      <h3 className="mt-2 text-lg font-bold text-[#1D1D1F]">Apple Gift Cards</h3>
      <p className="text-sm text-blink-ink-mute">Tarjetas de $2 a $100, cobradas en euros.</p>
      <p className="mt-2 text-sm font-semibold text-[#0071E3]">Desde {desdeGiftCardsEur()}</p>
      <span className="mt-3 text-sm font-semibold text-[#0071E3] group-hover:underline">
        Ver tarjetas →
      </span>
    </Link>
  )
}

// ---------- Puerta de plataforma (Canva / Spotify) ----------
function Puerta({ p }: { p: PlataformaTienda }) {
  const desde =
    p.planes.length === 0 ? null : precioUsd(Math.min(...p.planes.map((pl) => pl.precio_venta_usd)))
  const canva = esCanva(p.nombre)

  return (
    <Link
      to={`/tienda/${slugPlataforma(p.nombre)}`}
      className="group flex flex-col items-start gap-1 rounded-2xl border border-blink-line bg-white p-6 transition-shadow hover:shadow-lg"
    >
      {canva ? (
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#6D28D9] to-[#7D2AE8]">
          <IconoCanvaC className="h-7 w-7" fill="#FFFFFF" />
        </span>
      ) : (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0F0F0F]">
          <IconoSpotify className="h-7 w-7" fill="#1ED760" />
        </span>
      )}
      <h3 className="mt-2 text-lg font-bold text-blink-dark">{p.nombre}</h3>
      <p className="text-sm text-blink-ink-mute">
        {canva
          ? 'Canva Pro, con los beneficios del plan familiar.'
          : 'Spotify Premium, cuenta propia dentro del plan familiar.'}
      </p>
      <p className={`mt-2 text-sm font-semibold ${canva ? 'text-[#6D28D9]' : 'text-[#1DB954]'}`}>
        Desde {desde ?? '—'}
      </p>
      <span
        className={`mt-3 text-sm font-semibold group-hover:underline ${
          canva ? 'text-[#6D28D9]' : 'text-[#1DB954]'
        }`}
      >
        Ver planes →
      </span>
    </Link>
  )
}

// ---------- Página de aterrizaje pública (raíz del sitio) ----------
export default function Inicio() {
  const location = useLocation()
  // `Registro` naviga acá con este flag; sin leerlo, quien se acaba de crear la
  // cuenta no recibe ninguna confirmación (la página que lo mostraba ya no
  // existe: la tienda vieja la reemplazó esta landing).
  const registrado = (location.state as { registrado?: boolean } | null)?.registrado
  const [plataformas, setPlataformas] = useState<PlataformaTienda[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  const cargar = useCallback(() => {
    setError('')
    setCargando(true)
    fetchCatalogoPublico()
      .then((items) => {
        setPlataformas(puertasDelCatalogo(agruparCatalogo(items)))
      })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setCargando(false))
  }, [])

  useEffect(cargar, [cargar])

  const ordenadas = [...plataformas].sort((a, b) => (esCanva(a.nombre) ? -1 : esCanva(b.nombre) ? 1 : 0))

  return (
    <div className="min-h-screen bg-white">
      <BarraTienda />

      {registrado ? (
        <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-800">
          Cuenta creada. Lo que compres o renueves desde ahora queda atado a tu correo.
        </div>
      ) : null}

      {/* Hero */}
      <section className="bg-gradient-to-b from-[#F8F9FA] to-white px-4 py-16 md:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h1
            className="text-4xl font-extrabold tracking-tight text-blink-dark md:text-5xl"
            style={{ fontFamily: FONT_DISPLAY }}
          >
            Blink Plans
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-blink-ink-mute md:text-lg">
            Vendemos cupos en planes familiares de Canva Pro, Spotify Premium y Apple Gift Cards.
            Escoges el tiempo, pagas, y te activamos el acceso por WhatsApp el mismo día.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            {ordenadas.length > 0 ? (
              <a
                href="#planes"
                className="rounded-full bg-blink-action px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blink-action-hover"
              >
                Ver los planes
              </a>
            ) : null}
            <Link
              to="/renovar"
              className="rounded-full border border-blink-line-strong bg-white px-6 py-2.5 text-sm font-semibold text-blink-muted transition-colors hover:bg-blink-soft"
            >
              Ya soy cliente, quiero renovar
            </Link>
          </div>
        </div>
      </section>

      {/* Las tres puertas */}
      <section className="mx-auto max-w-5xl px-4 py-14">
        <h2
          className="mb-8 text-center text-lg font-semibold uppercase tracking-widest text-blink-ink-mute"
          style={{ fontFamily: FONT_DISPLAY }}
        >
          Qué puedes comprar aquí
        </h2>

        {cargando ? (
          <div className="grid gap-6 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-52 animate-pulse rounded-2xl bg-blink-fill" />
            ))}
          </div>
        ) : error ? (
          <div className="mx-auto max-w-md rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
            <p className="text-sm font-medium text-rose-700">
              No pudimos cargar el catálogo. Revisa tu conexión e intenta de nuevo.
            </p>
            <p className="mt-1 text-xs text-rose-600">{error}</p>
            <button
              onClick={cargar}
              className="mt-4 rounded-full bg-blink-action px-5 py-2 text-sm font-semibold text-white hover:bg-blink-action-hover"
            >
              Reintentar
            </button>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-3">
            <PuertaApple />
            {ordenadas.map((p) => (
              <Puerta key={p.nombre} p={p} />
            ))}
          </div>
        )}
      </section>

      {/* Los planes a la vista (sin catálogo no hay sección; no mostramos precios huecos) */}
      {!cargando && !error && ordenadas.length > 0 ? (
        <section id="planes" className="space-y-4">
          {ordenadas.map((p) => (
            <TarjetasHorizontales key={p.nombre} p={p} variante={varianteHorizontal(p.nombre)} />
          ))}
        </section>
      ) : null}

      {/* Cómo se paga */}
      <section className="border-t border-blink-line bg-blink-fill px-4 py-14">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-2xl font-extrabold tracking-tight text-blink-dark">Cómo se paga</h2>
          <p className="mt-3 text-sm leading-relaxed text-blink-muted">
            Cinco métodos, y tú escoges cuál te conviene más ese día:{' '}
            {METODOS_PAGO.map((m, i) => (
              <span key={m.id}>
                {i > 0 ? ', ' : ''}
                <strong className="font-semibold text-blink-dark">{m.nombre}</strong>
              </span>
            ))}
            .
          </p>
          <p className="mt-3 text-sm leading-relaxed text-blink-muted">
            Todo lo que compras tiene precio en divisas. Si pagas en bolívares, el monto se calcula
            con la tasa oficial del BCV del día de tu pago, que te confirmamos antes de que
            transfieras. No le echamos un margen por encima.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-blink-muted">
            El pedido se envía por WhatsApp. Ahí te pasamos los datos de cobro y, cuando confirmamos
            el pago, el acceso con sus instrucciones.
          </p>
        </div>
      </section>

      {/* Cliente que vuelve */}
      <section className="px-4 py-14">
        <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 rounded-2xl bg-blink-dark p-8 text-white sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold">¿Ya tienes suscripción?</h2>
            <p className="mt-1 text-sm text-white/80">
              Renueva desde acá sin tener que escribirnos primero. Entra con el mismo correo con el
              que compraste.
            </p>
          </div>
          <Link
            to="/renovar"
            className="shrink-0 rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-blink-dark transition-colors hover:bg-white/90"
          >
            Renovar ahora
          </Link>
        </div>
      </section>

      {/* Pie con el mismo descargo legal de la tienda */}
      <footer className="border-t border-blink-line bg-white py-8">
        <p className="mx-auto max-w-2xl px-4 text-center text-xs leading-relaxed text-blink-ink-mute">
          Los precios se expresan en dólares estadounidenses (USD). El equivalente en bolívares
          (VES) se calcula con la <strong>tasa de cambio oficial del BCV</strong> al momento de
          cada pago. Al contratar aceptas ser parte de un plan familiar compartido gestionado por{' '}
          <strong>Blink Plans</strong>.
        </p>
      </footer>

      <BarraCompra />
    </div>
  )
}
