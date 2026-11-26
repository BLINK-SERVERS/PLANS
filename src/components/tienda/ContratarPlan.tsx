import { useState } from 'react'
import { useCarrito } from './CarritoProvider'
import type { PlanTienda } from '../../lib/tienda'

// Botón "Contratar / Añadir" de un plan: agrega la línea al carrito.
// El pago/Checkout (y el registro de pedido) ocurre en /#/checkout.
export default function ContratarPlan({
  className = '',
  plataforma,
  plan,
  etiqueta = 'Contratar',
}: {
  className?: string
  plataforma: string
  plan: PlanTienda
  etiqueta?: string
}) {
  const { agregar } = useCarrito()
  const [añadido, setAñadido] = useState(false)

  const añadir = () => {
    agregar({
      clave: `plan:${plataforma}:${plan.duracion_dias}`,
      tipo: 'plan',
      plataforma,
      titulo: plataforma,
      detalle: plan.etiqueta,
      precio_ref: plan.precio_venta_usd,
      ref_moneda: 'USD',
      cantidad: 1,
      duracion_dias: plan.duracion_dias,
      precio_usd: plan.precio_venta_usd,
    })
    setAñadido(true)
  }

  // Solo el cambio de etiqueta. El enlace «Ver carrito» de 10 px que había acá
  // estaba bajo el piso táctil de HIG y competía con la barra pegada al pie,
  // que ahora es el único paso siguiente visible.
  return (
    <button onClick={añadir} className={className} aria-pressed={añadido}>
      {añadido ? '✓ En el carrito' : etiqueta}
    </button>
  )
}