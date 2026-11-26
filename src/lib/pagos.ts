// Métodos de pago del checkout (#/checkout).
//  · Pago Móvil → bolívares. Las Apple Gift Cards van ANCLADAS AL EURO
//    (precio EUR × tasa_eur_bs); los planes usan la tasa BCV (USD → Bs).
//  · USDT / USDC / Zinli / Binance → mismo número que el precio de
//    referencia: gift cards en EUR (3.29 USDT por una de 3.29 €),
//    planes en USD (2.99 USDT por el plan de 2.99 $).

export type MetodoPago = 'pagomovil' | 'usdt' | 'usdc' | 'zinli' | 'binance'

/**
 * El vocabulario del libro de ingresos (`pagos_ingresos.metodo_pago`), que es
 * otro mundo distinto al de los ids del checkout: lo fija
 * `pagos_ingresos_metodo_pago_check` en la base y así están escritas las filas
 * históricas. Quien valide una renovación tiene que mandar una de estas seis
 * cadenas, o el INSERT revierte la transacción completa con 23514.
 */
export const METODOS_LIBRO = [
  'Zelle',
  'Pago Movil',
  'Pago Movil Binance',
  'Binance',
  'Transferencia',
  'Otro',
] as const

// Traducción de lo que el cliente eligió en #/renovar a lo que acepta el libro.
// Solo hay equivalencia segura en dos: el Pago Móvil y el P2P de Binance, que son
// el mismo medio de pago en los dos vocabularios. USDT, USDC y Zin dicen la
// moneda o el producto, no por dónde entró la plata — un USDT puede venir de
// Binance, de una billetera externa o de un pago entre personas — así que caen en
// 'Otro' y el admin elige el medio correcto al validar, que es quien ve el
// comprobante.
export const METODO_LIBRO: Record<MetodoPago, string> = {
  pagomovil: 'Pago Movil',
  binance: 'Binance',
  usdt: 'Otro',
  usdc: 'Otro',
  zinli: 'Otro',
}

export interface MetodoInfo {
  id: MetodoPago
  nombre: string
  moneda: 'BS' | 'USDT' | 'USDC' | 'USD'
  descripcion: string
  icono: string
}

export const METODOS_PAGO: MetodoInfo[] = [
  { id: 'pagomovil', nombre: 'Pago Móvil', moneda: 'BS', descripcion: 'Bolívares (Bs)', icono: '🏦' },
  { id: 'usdt', nombre: 'USDT', moneda: 'USDT', descripcion: 'Tether', icono: '₮' },
  { id: 'usdc', nombre: 'USDC', moneda: 'USDC', descripcion: 'USD Coin', icono: '🪙' },
  { id: 'zinli', nombre: 'Zinli', moneda: 'USD', descripcion: 'Tarjeta virtual prepagada', icono: '💳' },
  { id: 'binance', nombre: 'Binance', moneda: 'USDT', descripcion: 'Pago P2P de Binance', icono: '🟡' },
]

/**
 * Datos de cobro del negocio, partido por campo para que el cliente pueda copiar
 * el teléfono, la cédula o el banco por separado desde #/checkout y #/renovar.
 * Un método sin datos cargados queda en `null` y las dos pantallas avisan por
 * WhatsApp en lugar de inventar un número.
 */
export interface DatoCobro {
  etiqueta: string
  valor: string
}

export const DATOS_COBRO: Record<MetodoPago, DatoCobro[] | null> = {
  pagomovil: [
    { etiqueta: 'Teléfono', valor: '04246603660' },
    { etiqueta: 'Cédula', valor: '34201580' },
    { etiqueta: 'Banco', valor: 'BNC' },
  ],
  usdt: null, // 'PENDIENTE — dirección TRC20'
  usdc: null, // 'PENDIENTE — dirección de red'
  zinli: null, // 'PENDIENTE — número de tarjeta / teléfono'
  binance: null, // 'PENDIENTE — correo o ID de pago'
}

// El texto que va al WhatsApp y al portapapeles en bloque.
export const textoCobro = (m: MetodoPago): string | null => {
  const d = DATOS_COBRO[m]
  return d ? d.map((x) => `${x.etiqueta}: ${x.valor}`).join('\n') : null
}

export const etiquetaMetodo = (m: MetodoPago): string =>
  METODOS_PAGO.find((x) => x.id === m)?.nombre ?? m

// Lo que se muestra cuando el método todavía no tiene datos de cobro cargados.
// Una sola frase para el checkout y para /renovar, porque las dos dicen lo
// mismo y no hay que inventar ni un teléfono mientras el dueño no los dé.
export const AVISO_DATOS_POR_CONFIRMAR =
  'Los datos de cobro te los pasamos por WhatsApp apenas registres la renovación.'

// ---------- Cálculo del cobro ----------

export interface TasasCobro {
  bcv: number | null // USD → Bs
  eur: number | null // € → Bs (gift cards)
}

// Monto a cobrar para una línea del carrito según el método.
//  · pagomovil: gift card → precio_eur × tasa_eur ; plan → precio_usd × tasa_bcv
//  · cripto / Zinli: el mismo número del precio de referencia (EUR o USD)
export function montoCobro(
  metodo: MetodoPago,
  precioRef: number,
  refMoneda: 'EUR' | 'USD',
  tasas: TasasCobro,
): number | null {
  if (metodo === 'pagomovil') {
    const t = refMoneda === 'EUR' ? tasas.eur : tasas.bcv
    if (t == null || t <= 0) return null
    return precioRef * t
  }
  return precioRef
}

export function monedaCobro(metodo: MetodoPago): 'BS' | 'USDT' | 'USDC' | 'USD' {
  return METODOS_PAGO.find((x) => x.id === metodo)?.moneda ?? 'USDT'
}

// ---------- Formato ----------

const n2 = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const nBs = new Intl.NumberFormat('es-VE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export const fmtUsd = (n: number): string => `${n2.format(n)} USD`
export const fmtMonedaCobro = (moneda: string, monto: number): string => {
  if (moneda === 'BS') return `${nBs.format(monto)} Bs`
  return `${n2.format(monto)} ${moneda}`
}

export const fmtPrecioCobro = (m: MetodoPago, precioRef: number, refMoneda: 'EUR' | 'USD', tasas: TasasCobro): string => {
  const monto = montoCobro(m, precioRef, refMoneda, tasas)
  return monto == null ? '—' : fmtMonedaCobro(monedaCobro(m), monto)
}