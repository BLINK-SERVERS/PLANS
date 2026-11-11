import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { actualizarEstadoPedido, fetchPedidos } from '../lib/api'
import type { EstadoPedido, Pedido } from '../lib/types'
import { fmtDateTime } from '../lib/format'
import { errMsg } from '../lib/err'
import { disenoPorId, dolar, euro } from '../lib/giftcards'
import { etiquetaDuracion, precioUsd } from '../lib/tienda'
import { linkWhatsApp, msjContactoPedido } from '../lib/pedidos'
import { METODOS_PAGO, fmtMonedaCobro } from '../lib/pagos'
import {
  Badge,
  EmptyState,
  ErrorMsg,
  Loading,
  PageHeader,
  Table,
  Td,
} from '../components/ui'

const ESTADOS: EstadoPedido[] = ['nuevo', 'contactado', 'completado', 'cancelado']

const ETIQUETA_ESTADO: Record<EstadoPedido, string> = {
  nuevo: 'Nuevo',
  contactado: 'Contactado',
  completado: 'Completado',
  cancelado: 'Cancelado',
}

// Detalle de una fila según el tipo de pedido
function detalle(p: Pedido): ReactNode {
  if (p.tipo === 'giftcard') {
    const d = disenoPorId(p.diseno_giftcard)
    return (
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-6 w-10 shrink-0 rounded-md shadow-sm"
          style={{ background: d.gradiente }}
          title={d.nombre}
        />
        <div>
          <p className="text-sm font-medium text-blink-dark">
            Apple Gift Card · {dolar(p.valor_giftcard_usd ?? 0)}
          </p>
          <p className="text-xs text-blink-ink-mute">
            {euro(p.precio_giftcard_eur ?? 0)} · {d.nombre}
          </p>
        </div>
      </div>
    )
  }
  return (
    <div>
      <p className="text-sm font-medium text-blink-dark">{p.plataforma}</p>
      <p className="text-xs text-blink-ink-mute">
        {etiquetaDuracion(p.duracion_dias ?? 0)} · {precioUsd(p.precio_usd ?? 0)}
      </p>
    </div>
  )
}

const FILTROS: Array<{ id: EstadoPedido | ''; label: string }> = [
  { id: '', label: 'Todos' },
  { id: 'nuevo', label: 'Nuevos' },
  { id: 'contactado', label: 'Contactados' },
  { id: 'completado', label: 'Completados' },
  { id: 'cancelado', label: 'Cancelados' },
]

export default function Pedidos() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [filtro, setFiltro] = useState<EstadoPedido | ''>('')
  const [guardando, setGuardando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      setPedidos(await fetchPedidos())
      setError('')
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const cambiarEstado = async (p: Pedido, estado: EstadoPedido) => {
    if (guardando) return
    setGuardando(p.id)
    try {
      await actualizarEstadoPedido(p.id, estado)
      setPedidos((prev) => prev.map((x) => (x.id === p.id ? { ...x, estado } : x)))
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setGuardando(null)
    }
  }

  const visibles = filtro ? pedidos.filter((p) => p.estado === filtro) : pedidos

  if (cargando) return <Loading />
  if (error) return <ErrorMsg message={error} />

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pedidos"
        subtitle="Pedidos de la tienda (#/tienda): gift cards y planes solicitados por clientes"
      />

      {/* Filtros por estado */}
      <div className="flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.id || 'todos'}
            onClick={() => setFiltro(f.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              filtro === f.id
                ? 'bg-blink-action text-white'
                : 'bg-blink-fill text-blink-muted hover:bg-blink-fill-strong'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visibles.length === 0 ? (
        <EmptyState message="No hay pedidos en esta vista todavía." />
      ) : (
        <Table
          headers={['Fecha', 'Cliente', 'Pedido', 'Cobro', 'Estado', 'Acciones']}
        >
          {visibles.map((p) => {
            const telefono = (p.cliente_contacto ?? '').replace(/\D/g, '')
            return (
              <tr key={p.id}>
                <Td className="whitespace-nowrap text-xs text-blink-ink-mute">
                  {fmtDateTime(p.created_at)}
                </Td>
                <Td>
                  <p className="text-sm font-medium text-blink-dark">
                    {p.cliente_nombre ?? '—'}
                  </p>
                  {p.cliente_contacto ? (
                    <p className="text-xs text-blink-ink-mute">{p.cliente_contacto}</p>
                  ) : null}
                </Td>
                <Td>{detalle(p)}</Td>
                <Td>
                  {p.metodo_pago ? (
                    <div>
                      <p className="text-xs font-semibold text-blink-muted">
                        {METODOS_PAGO.find((x) => x.id === p.metodo_pago)?.nombre ?? p.metodo_pago}
                      </p>
                      {p.monto_cobro != null ? (
                        <p className="mt-0.5 text-xs text-blink-ink-mute">
                          {fmtMonedaCobro(p.moneda_cobro ?? 'USDT', p.monto_cobro)}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-xs text-blink-ink-mute">—</span>
                  )}
                </Td>
                <Td>
                  <select
                    value={p.estado}
                    disabled={guardando === p.id}
                    onChange={(e) => void cambiarEstado(p, e.target.value as EstadoPedido)}
                    className="rounded-lg border border-blink-line px-2 py-1 text-xs font-medium text-blink-muted focus:border-blink-primary focus:outline-none"
                  >
                    {ESTADOS.map((e) => (
                      <option key={e} value={e}>
                        {ETIQUETA_ESTADO[e]}
                      </option>
                    ))}
                  </select>
                  <div className="mt-1">
                    <Badge value={p.estado} />
                  </div>
                </Td>
                <Td>
                  <div className="flex flex-col gap-1">
                    {telefono ? (
                      <a
                        href={linkWhatsApp(
                          msjContactoPedido(p.cliente_nombre ?? 'cliente', detalleTexto(p)),
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex w-fit items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-700"
                      >
                        WhatsApp
                      </a>
                    ) : (
                      <span className="text-[11px] text-blink-ink-mute">sin contacto</span>
                    )}
                  </div>
                </Td>
              </tr>
            )
          })}
        </Table>
      )}
    </div>
  )
}

function detalleTexto(p: Pedido): string {
  if (p.tipo === 'giftcard') {
    const d = disenoPorId(p.diseno_giftcard)
    return `Apple Gift Card · ${dolar(p.valor_giftcard_usd ?? 0)} · ${euro(
      p.precio_giftcard_eur ?? 0,
    )} · ${d.nombre}`
  }
  return `${p.plataforma} · ${etiquetaDuracion(p.duracion_dias ?? 0)} · ${precioUsd(
    p.precio_usd ?? 0,
  )}`
}