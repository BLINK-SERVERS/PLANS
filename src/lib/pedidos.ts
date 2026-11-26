// Pedidos de la tienda (#/tienda): mensajes de WhatsApp + enlace de la
// imagen de cada diseño de gift card (public/apple/<id>.png).
import { WHATSAPP_PEDIDOS } from './giftcards'

export const linkWhatsApp = (texto: string): string =>
  `https://wa.me/${WHATSAPP_PEDIDOS}?text=${encodeURIComponent(texto)}`

export const msjContactoPedido = (nombre: string, detalle: string): string =>
  [
    `Hola ${nombre} 👋`,
    'Aquí Blink Plans respecto a tu pedido:',
    `📦 ${detalle}`,
    '',
    '¿Seguimos con el pago?',
  ].join('\n')

export interface LineaMsjCheckout {
  cantidad: number
  texto: string
}

// Mensaje del resumen completo del carrito (checkout): líneas + total por el
// método elegido + instrucciones de pago del negocio.
export function msjPedidoCheckout(o: {
  cliente: string
  lineas: LineaMsjCheckout[]
  total: string
  metodo: string
  instrucciones: string | null
}): string {
  const partes = [
    `Hola! 🛒 Nuevo pedido de ${o.cliente}`,
    '',
    ...o.lineas.map((l) => `${l.cantidad > 1 ? `${l.cantidad}× ` : ''}• ${l.texto}`),
    '',
    `Total a pagar: ${o.total}`,
    `Método de pago: ${o.metodo}`,
  ]
  if (o.instrucciones) partes.push('Datos para el pago:', o.instrucciones)
  else partes.push('Instrucciones de pago: te las confirmo por este chat')
  partes.push('', 'Confirmo el pedido ✅ ¿Cómo sigo con el pago?')
  return partes.join('\n')
}

// Ruta de la imagen de un diseño (public/apple/<id>.png) con el base de Vite.
export const rutaImagenDiseno = (id: string): string =>
  `${import.meta.env.BASE_URL}apple/${id}.png`

// Renovación declarada desde #/renovar. El cliente manda el comprobante y el
// admin valida en el panel; aquí no se confirma nada todavía.
export function msjRenovacion(o: {
  cliente: string
  plataforma: string
  duracion_dias: number
  corteActual: string
  corteQuedara: string
  cobro: string
  metodo: string
  instrucciones: string | null
}): string {
  const partes = [
    `Hola! 🔄 Renovación de ${o.cliente}`,
    '',
    `• Plan: ${o.plataforma} · ${o.duracion_dias} días`,
    `• Corte actual: ${formatoLargo(o.corteActual)}`,
    `• Quedaría: ${formatoLargo(o.corteQuedara)}`,
    '',
    `Monto a pagar: ${o.cobro}`,
    `Método de pago: ${o.metodo}`,
  ]
  if (o.instrucciones) partes.push('Datos para el pago:', o.instrucciones)
  else partes.push('Me pasas los datos de cobro por acá')
  partes.push('', 'Ya declaré la renovación en la web, ¿la validan?')
  return partes.join('\n')
}

// El mensaje se pega en WhatsApp, así que la fecha va escrita como habla gente
// (25 de diciembre de 2026), no en ISO.
const formatoLargo = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Intl.DateTimeFormat('es-VE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(y, m - 1, d, 12))
}