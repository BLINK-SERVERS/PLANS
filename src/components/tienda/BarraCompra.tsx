import { Link, useLocation } from 'react-router-dom'
import { totalRef } from '../../lib/carrito'
import { euro } from '../../lib/giftcards'
import { precioUsd } from '../../lib/tienda'
import { useCarrito } from './CarritoProvider'

// Barra de compra pegada al pie, en las páginas donde se añaden artículos.
//
// El problema que resuelve es de atención, no de estética: al tocar «Contratar»
// a 1400 px de profundidad en la landing, lo único que cambiaba era la etiqueta
// del botón y un enlace de 10 px. El cliente seguía bajando y encontraba más
// botones «Contratar», así que seguía tocando. Aquí el pie de pantalla queda
// ocupado por el único paso siguiente real.
//
// `sticky bottom-0` en lugar de `fixed`: la barra toma espacio al final del
// contenido, así que no tapa el pie de página ni necesita un `padding-bottom`
// coordinado desde cada vista.
export default function BarraCompra() {
  const { lineas, total } = useCarrito()
  const { pathname } = useLocation()

  // Checkout tiene su propio «Confirmar pedido» con el monto ya convertido al
  // método de pago; dos botones de pago en la misma pantalla es peor que uno.
  if (total === 0 || pathname.startsWith('/checkout')) return null

  const refs = totalRef(lineas)
  const monto = [refs.eur > 0 ? euro(refs.eur) : null, refs.usd > 0 ? precioUsd(refs.usd) : null]
    .filter(Boolean)
    .join(' + ')

  return (
    <div className="sticky bottom-0 z-40 border-t border-blink-line bg-white/92 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))]">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-blink-dark">{monto}</p>
          <p className="truncate text-[11px] text-blink-ink-mute">
            {total} {total === 1 ? 'artículo' : 'artículos'} en el carrito
          </p>
        </div>
        <Link
          to="/checkout"
          className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-blink-action px-5 text-sm font-semibold text-white transition-colors hover:bg-blink-action-hover"
        >
          Finalizar compra <span aria-hidden className="ml-1">→</span>
        </Link>
      </div>
    </div>
  )
}
