import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { actualizarEstadoPedido, fetchPedidos, validarRenovacion } from '../lib/api'
import type { EstadoPedido, Moneda, Pedido } from '../lib/types'
import { fmtDateTime, hoy, round2 } from '../lib/format'
import { errMsg } from '../lib/err'
import { disenoPorId, dolar, euro } from '../lib/giftcards'
import { etiquetaDuracion, precioUsd } from '../lib/tienda'
import { linkWhatsApp, msjContactoPedido } from '../lib/pedidos'
import { METODOS_LIBRO, METODOS_PAGO, METODO_LIBRO, fmtMonedaCobro, type MetodoPago } from '../lib/pagos'
import {
  Badge,
  Button,
  EmptyState,
  ErrorMsg,
  Field,
  Input,
  Loading,
  Modal,
  ModalFooter,
  PageHeader,
  Select,
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

// El pedido de renovación no tiene un `tipo` propio (el CHECK de la tabla sigue
// siendo plan | giftcard): se reconoce porque trae suscripcion_id.
const esRenovacion = (p: Pedido): boolean => !!p.suscripcion_id

// La moneda del cobro que declaró el cliente es la misma que recibe
// `pagos_ingresos`, salvo BS, que en esa tabla se escribe VES.
const MONEDA_INGRESO: Record<string, Moneda> = {
  BS: 'BS',
  USD: 'USD',
  USDT: 'USDT',
  USDC: 'USD',
}

interface FormValidar {
  monto: string
  moneda: Moneda
  tasa: string
  fecha_pago: string
  metodo_pago: string
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
      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-blink-dark">
        {p.plataforma}
        {esRenovacion(p) ? (
          <span className="inline-block rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
            renovación
          </span>
        ) : null}
      </p>
      <p className="text-xs text-blink-ink-mute">
        {etiquetaDuracion(p.duracion_dias ?? 0)} · {precioUsd(p.precio_usd ?? 0)}
      </p>
    </div>
  )
}

const FILTROS: Array<{ id: EstadoPedido | 'renovacion' | ''; label: string }> = [
  { id: '', label: 'Todos' },
  { id: 'nuevo', label: 'Nuevos' },
  { id: 'renovacion', label: 'Renovaciones' },
  { id: 'contactado', label: 'Contactados' },
  { id: 'completado', label: 'Completados' },
  { id: 'cancelado', label: 'Cancelados' },
]

export default function Pedidos() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [filtro, setFiltro] = useState<EstadoPedido | 'renovacion' | ''>('')
  const [guardando, setGuardando] = useState<string | null>(null)
  const [validando, setValidando] = useState<Pedido | null>(null)
  const [form, setForm] = useState<FormValidar>({
    monto: '',
    moneda: 'USD',
    tasa: '',
    fecha_pago: hoy(),
    metodo_pago: '',
  })
  const [enviando, setEnviando] = useState(false)

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

  // Abrir el modal precargado con lo que el cliente declaró en #/renovar
  const abrirValidar = (p: Pedido) => {
    const moneda = MONEDA_INGRESO[p.moneda_cobro ?? ''] ?? 'USD'
    setForm({
      monto: p.monto_cobro != null ? String(p.monto_cobro) : '',
      moneda,
      tasa: '',
      fecha_pago: hoy(),
      // `pedidos.metodo_pago` trae el id del checkout ('usdt', 'zinli'...), que
      // no es vocabulario del libro: el SELECT de abajo solo acepta las cadenas
      // de METODOS_LIBRO. Mandar el id crudo revierte el INSERT con 23514 y se
      // pierde la validación completa.
      metodo_pago: METODO_LIBRO[(p.metodo_pago ?? '') as MetodoPago] ?? '',
    })
    setValidando(p)
    setAviso('')
    setError('')
  }

  const montoNum = Number(form.monto) || 0
  const tasaNum = Number(form.tasa) || 0
  // USD y USDT entran 1:1; en Bs se divide por la tasa BCV que el admin confirma.
  const equivalente =
    form.moneda === 'BS' ? (tasaNum > 0 ? round2(montoNum / tasaNum) : 0) : round2(montoNum)
  // El método es obligatorio: la cadena vacía también revienta el CHECK, y un
  // botón activo que va a revertir es peor que un botón apagado con motivo.
  const puedeValidar =
    !!validando && montoNum > 0 && equivalente > 0 && !!form.fecha_pago && !!form.metodo_pago

  const confirmarValidacion = async () => {
    if (!validando || enviando || !puedeValidar) return
    setEnviando(true)
    setError('')
    try {
      const pagoId = await validarRenovacion(validando.id, {
        monto_pagado: montoNum,
        moneda: form.moneda,
        tasa_bcv_aplicada: form.moneda === 'BS' ? tasaNum : null,
        tasa_cambio_binance: null,
        equivalente_usd: equivalente,
        metodo_pago: form.metodo_pago,
        fecha_pago: form.fecha_pago,
      })
      // null = el RPC encontró el pedido fuera de 'nuevo' y no tocó dinero.
      setAviso(
        pagoId
          ? `Renovación validada. El corte de ${validando.plataforma} quedó extendido.`
          : 'Este pedido ya estaba validado: no se cobró ni se sumó otro mes.',
      )
      setValidando(null)
      await cargar()
    } catch (e) {
      // El RPC ya habla en español ('Solo el admin valida renovaciones', 'Pedido
      // X inexistente', 'El pedido X no es una renovación'), así que el mensaje se
      // muestra tal cual.
      setError(errMsg(e))
    } finally {
      setEnviando(false)
    }
  }

  const visibles = filtro
    ? filtro === 'renovacion'
      ? pedidos.filter(esRenovacion)
      : pedidos.filter((p) => p.estado === filtro)
    : pedidos

  if (cargando) return <Loading />

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pedidos"
        subtitle="Pedidos de la tienda y renovaciones declaradas desde la landing"
      />

      {error ? <ErrorMsg message={error} /> : null}
      {aviso ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{aviso}</p>
      ) : null}

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
        <Table headers={['Fecha', 'Cliente', 'Pedido', 'Cobro', 'Estado', 'Acciones']}>
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
                    {esRenovacion(p) && p.estado === 'nuevo' ? (
                      <Button onClick={() => abrirValidar(p)} title="Cierra el cobro y extiende el corte">
                        Validar y renovar
                      </Button>
                    ) : null}
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

      {/* Validar renovación: crea el ingreso, lo asigna y cierra el pedido en la
          misma transacción (RPC validar_renovacion). El corte se mueve ahí, no antes. */}
      <Modal
        open={!!validando}
        title={`Validar renovación de ${validando?.cliente_nombre ?? ''}`}
        onClose={() => setValidando(null)}
      >
        {validando ? (
          <div className="space-y-3">
            <p className="text-sm text-blink-muted">
              {validando.plataforma} · {etiquetaDuracion(validando.duracion_dias ?? 0)} ·{' '}
              {precioUsd(validando.precio_usd ?? 0)}
            </p>
            {validando.monto_cobro != null ? (
              <p className="text-xs text-blink-ink-mute">
                El cliente declaró{' '}
                <strong className="text-blink-dark">
                  {fmtMonedaCobro(validando.moneda_cobro ?? 'USDT', validando.monto_cobro)}
                </strong>{' '}
                por{' '}
                {METODOS_PAGO.find((x) => x.id === validando.metodo_pago)?.nombre ??
                  validando.metodo_pago ??
                  'su método'}. Ajusta el monto si lo que
                entró al banco fue otro.
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Monto recibido *">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.monto}
                  onChange={(e) => setForm({ ...form, monto: e.target.value })}
                />
              </Field>
              <Field label="Moneda *">
                <Select
                  value={form.moneda}
                  onChange={(e) => setForm({ ...form, moneda: e.target.value as Moneda })}
                >
                  <option value="USD">USD</option>
                  <option value="BS">BS</option>
                  <option value="USDT">USDT</option>
                </Select>
              </Field>
              {form.moneda === 'BS' ? (
                <Field label="Tasa BCV aplicada *">
                  <Input
                    type="number"
                    min={0}
                    step="0.0001"
                    value={form.tasa}
                    onChange={(e) => setForm({ ...form, tasa: e.target.value })}
                  />
                </Field>
              ) : null}
              <Field label="Fecha del pago *">
                <Input
                  type="date"
                  max={hoy()}
                  value={form.fecha_pago}
                  onChange={(e) => setForm({ ...form, fecha_pago: e.target.value })}
                />
              </Field>
              <Field label="Método con que pagó *">
                <Select
                  value={form.metodo_pago}
                  onChange={(e) => setForm({ ...form, metodo_pago: e.target.value })}
                >
                  <option value="" disabled>
                    Elige el medio que dice el comprobante
                  </option>
                  {METODOS_LIBRO.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="rounded-lg bg-blink-fill px-3 py-2 text-xs text-blink-muted">
              Equivalente en USD: <strong>{equivalente.toFixed(2)}</strong>
              {form.moneda === 'BS' ? ` (${montoNum} Bs ÷ ${tasaNum || '—'})` : ''}
            </div>

            <p className="text-xs leading-relaxed text-blink-ink-mute">
              El nuevo corte arranca en la mayor de dos fechas: la que pone acá y el corte vigente.
              Si la suscripción ya había vencido, los días de atraso no se recuperan; si seguía
              activa, el período se suma completo. Ninguna validación frena una fecha mal puesta, y
              editar el pago después no devuelve los días: revísala acá.
            </p>

            <ModalFooter
              onCancel={() => setValidando(null)}
              onSave={() => void confirmarValidacion()}
              saveLabel="Validar y extender el corte"
              disabled={!puedeValidar}
              guardando={enviando}
            />
          </div>
        ) : null}
      </Modal>
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