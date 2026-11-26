import { Link } from 'react-router-dom'
import BarraTienda from '../components/tienda/BarraTienda'
import BarraCompra from '../components/tienda/BarraCompra'
import { useCarrito } from '../components/tienda/CarritoProvider'
import { totalRef } from '../lib/carrito'
import { euro } from '../lib/giftcards'
import { precioUsd } from '../lib/tienda'

const EMOJI: Record<string, string> = {
  Apple: '🍎',
  Spotify: '🎵',
  Canva: '🎨',
  'Google One': '🗂️',
}

function preciolinea(l: {
  tipo: 'giftcard' | 'plan'
  precio_ref: number
  ref_moneda: 'EUR' | 'USD'
}): string {
  if (l.tipo === 'giftcard') return euro(l.precio_ref)
  return precioUsd(l.precio_ref)
}

// Página pública del carrito (#/carrito): revisar líneas, cantidades y pasar
// al checkout.
export default function Carrito() {
  const { lineas, setCantidad, quitar, total } = useCarrito()
  const refs = totalRef(lineas)

  if (lineas.length === 0) {
    return (
      <div className="min-h-screen bg-blink-fill">
        <BarraTienda volver />
        <div className="mx-auto max-w-3xl px-4 py-16 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blink-fill-strong text-3xl">
            🛒
          </div>
          <h1 className="mt-4 text-2xl font-bold text-blink-dark">Tu carrito está vacío</h1>
          <p className="mt-2 text-sm text-blink-ink-mute">
            Añade una gift card o un plan desde la tienda y vuelve aquí para pagar.
          </p>
          <Link
            to="/"
            className="mt-6 inline-block rounded-full bg-blink-action px-8 py-3 text-sm font-semibold text-white hover:bg-blink-action-hover"
          >
            Ir a la tienda
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-blink-fill">
      <BarraTienda volver />
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold text-blink-dark">Tu carrito</h1>
        <p className="mt-1 text-sm text-blink-ink-mute">
          {total} artículo{total === 1 ? '' : 's'} · revisa los montos y continúa al checkout
        </p>

        <div className="mt-6 space-y-3">
          {lineas.map((l) => (
            // Dos filas en lugar de cinco hijos en una sola: a 390 px el
            // icono, el título, el stepper, el total y la ✕ no caben en una
            // línea, así que el título se cortaba a «C…», el precio choca con
            // el botón de restar y «3.10 €» se partía en dos renglones. El
            // cliente no podía leer lo que estaba pagando.
            <div key={l.clave} className="rounded-2xl border border-blink-line bg-white p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blink-fill text-2xl">
                  {EMOJI[l.plataforma] ?? '📦'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-blink-dark">{l.titulo}</p>
                  <p className="truncate text-xs text-blink-ink-mute">{l.detalle}</p>
                </div>
                <p className="shrink-0 whitespace-nowrap text-sm font-bold text-blink-dark">
                  {l.tipo === 'giftcard' ? euro(l.precio_ref * l.cantidad) : precioUsd(l.precio_ref * l.cantidad)}
                </p>
                <button
                  onClick={() => quitar(l.clave)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-blink-ink-mute transition-colors hover:bg-blink-fill hover:text-red-600"
                  aria-label={`Quitar ${l.titulo} del carrito`}
                >
                  ✕
                </button>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3 pl-[60px]">
                <p className="whitespace-nowrap text-xs text-blink-ink-mute">
                  <span className="text-sm font-bold text-blink-action">{preciolinea(l)}</span> c/u
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setCantidad(l.clave, l.cantidad - 1)}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-blink-line-strong text-base font-semibold text-blink-muted transition-colors hover:bg-blink-soft"
                    aria-label="Restar uno"
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-sm font-semibold text-blink-dark">{l.cantidad}</span>
                  <button
                    onClick={() => setCantidad(l.clave, l.cantidad + 1)}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-blink-line-strong text-base font-semibold text-blink-muted transition-colors hover:bg-blink-soft"
                    aria-label="Sumar uno"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Totales de referencia */}
        <div className="mt-6 rounded-2xl border border-blink-line bg-white p-5 shadow-sm">
          {(refs.eur > 0 || refs.usd > 0) && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-blink-ink-mute">
                <strong className="text-blink-dark">Subtotal de referencia:</strong>{' '}
                {[refs.eur > 0 ? euro(refs.eur) : null, refs.usd > 0 ? precioUsd(refs.usd) : null]
                  .filter(Boolean)
                  .join(' + ')}
              </span>
              {lineas.some((l) => l.tipo === 'giftcard') ? (
                <span className="text-xs text-blink-ink-mute">
                  Las gift cards se cotizan en € (Pago Móvil anclado al euro).
                </span>
              ) : null}
            </div>
          )}
          <p className="mt-2 text-xs text-blink-ink-mute">
            El total exacto según tu método de pago (Bs, USDT, USDC, Zinli o Binance) se calcula en
            el checkout.
          </p>
        </div>

        {/* El «Finalizar compra» vive en la barra pegada al pie (BarraCompra),
            que es la que el cliente ya veía desde la tienda. Duplicarlo acá
            dejaba dos pastillas azules idénticas apiladas al final. */}
        <div className="mt-6">
          <Link to="/" className="text-sm font-medium text-blink-action hover:underline">
            ← Seguir comprando
          </Link>
        </div>
      </div>

      <BarraCompra />
    </div>
  )
}