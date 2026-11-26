import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import BarraTienda from '../components/tienda/BarraTienda'
import { useAuth } from '../lib/auth'
import { crearRenovacion, fetchMisSuscripciones, fetchTasaBcv, tasaVigente } from '../lib/api'
import type { MiSuscripcion } from '../lib/types'
import { errMsg } from '../lib/err'
import { hoy } from '../lib/format'
import { etiquetaDuracion, precioUsd } from '../lib/tienda'
import {
  AVISO_DATOS_POR_CONFIRMAR,
  DATOS_COBRO,
  METODOS_PAGO,
  etiquetaMetodo,
  fmtMonedaCobro,
  monedaCobro,
  montoCobro,
  type MetodoPago,
} from '../lib/pagos'
import { linkWhatsApp, msjRenovacion } from '../lib/pedidos'

// Regla de negocio que pidió el dueño: la renovación se declara cuando el corte
// ya está cerca. Antes de esa ventana la pantalla dice desde cuándo se puede, en
// vez de dejar un botón que no hace nada.
const VENTANA_DIAS = 15

// El estado viene de la vista en minúsculas y con las palabras del negocio, así
// que se puede mostrar directo; solo se cuida el caso de un valor inesperado.
const estadoTexto = (e: string): string =>
  e === 'activa' || e === 'vencida' || e === 'cancelada' ? e : 'sin definir'

// Suma días a una fecha 'YYYY-MM-DD' sin pasar por UTC. `dateLocal` de
// format.ts trabaja al mediodía por el mismo motivo: en Venezuela (UTC-4) la
// medianoche de un ISO date cae el día anterior.
function sumarDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d, 12)
  dt.setDate(dt.getDate() + dias)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
    dt.getDate(),
  ).padStart(2, '0')}`
}

// Réplica exacta de la aritmética de trg_renovar_susc_por_pago
// (db/0001_esquema_negocio.sql:238): greatest(coalesce(corte, hoy), hoy) + días.
// Si el corte ya pasó, la cuenta arranca desde hoy y los días vencidos se los
// come el cliente. Lo mostramos tal cual, no maquillado.
function corteQuedara(s: MiSuscripcion): string {
  const base = s.fecha_corte_cliente > hoy() ? s.fecha_corte_cliente : hoy()
  return sumarDias(base, s.duracion_dias)
}

const fmtFecha = (iso: string): string => {
  const [y, m, d] = iso.split('-')
  return new Intl.DateTimeFormat('es-VE', { day: '2-digit', month: 'long', year: 'numeric' }).format(
    new Date(Number(y), Number(m) - 1, Number(d), 12),
  )
}

const dias = (n: number): string => `${n} día${n === 1 ? '' : 's'}`

// ---------- El cliente no tiene sesión ----------
function SinSesion() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-bold text-blink-dark">Renueva tu plan</h1>
      <p className="mt-2 text-sm leading-relaxed text-blink-muted">
        Entra con el mismo correo con el que compraste. Ahí te salen tus suscripciones y lo que toca
        pagar para extenderlas. Si aún no tienes cuenta, créala con el correo que usaste.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          to="/ingreso"
          state={{ volver: '/renovar' }}
          className="rounded-full bg-blink-action px-6 py-2.5 text-sm font-semibold text-white hover:bg-blink-action-hover"
        >
          Entrar
        </Link>
        <Link
          to="/registro"
          state={{ volver: '/renovar' }}
          className="rounded-full border border-blink-line-strong bg-white px-6 py-2.5 text-sm font-semibold text-blink-muted hover:bg-blink-soft"
        >
          Crear cuenta
        </Link>
      </div>
    </div>
  )
}

// ---------- Admin: esto no es su pantalla ----------
function EsAdmin() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-bold text-blink-dark">Esta pantalla es para tus clientes</h1>
      <p className="mt-2 text-sm leading-relaxed text-blink-muted">
        Tus renovaciones entran a la lista de pedidos. Valídalas desde el panel, que ahí está el
        botón que cierra el cobro y mueve la fecha de corte.
      </p>
      <Link
        to="/panel/pedidos"
        className="mt-6 inline-block rounded-full bg-blink-action px-6 py-2.5 text-sm font-semibold text-white hover:bg-blink-action-hover"
      >
        Ir a pedidos del panel
      </Link>
    </div>
  )
}

// ---------- Una suscripción y su formulario de pago ----------
function FilaRenovacion({
  s,
  bcv,
  clienteId,
  nombre,
  telefono,
  deshabilitado,
  onDeclarada,
}: {
  s: MiSuscripcion
  bcv: number | null
  clienteId: string
  nombre: string
  telefono: string
  deshabilitado: boolean
  onDeclarada: (s: MiSuscripcion) => void
}) {
  // Pago Móvil es el método por el que pregunta casi todo el mundo, pero es el
  // único de la pantalla que necesita la tasa del BCV. Si no vino tasa vigente,
  // arrancar ahí deja el botón apagado cuando USDT, USDC, Zinli y Binance sí se
  // pueden declarar contra el precio en USD.
  const [metodo, setMetodo] = useState<MetodoPago>(() => (bcv == null ? 'usdt' : 'pagomovil'))
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [hecho, setHecho] = useState(false)
  const [wa, setWa] = useState('')

  // La renovación siempre se cobra contra el precio en USD del plan, así que la
  // referencia es USD y Pago Móvil usa tasa BCV. No hay anclaje al euro acá: eso
  // es de las gift cards.
  const monto = montoCobro(metodo, s.monto_renovacion_usd, 'USD', { bcv, eur: null })
  const faltaTasa = monto == null
  // Ventana del dueño: solo se declara dentro de los últimos 15 días del corte.
  const afuera = s.dias_restantes > VENTANA_DIAS
  const desde = sumarDias(s.fecha_corte_cliente, -VENTANA_DIAS)
  const bloqueada = deshabilitado || hecho

  const declarar = async () => {
    if (enviando || monto == null) return
    setEnviando(true)
    setError('')
    setAviso('')
    try {
      const res = await crearRenovacion({
        suscripcion_id: s.suscripcion_id,
        plataforma: s.plataforma,
        duracion_dias: s.duracion_dias,
        precio_usd: s.monto_renovacion_usd,
        cliente_id: clienteId,
        cliente_nombre: nombre.trim() || null,
        cliente_contacto: telefono.trim() || null,
        metodo_pago: metodo,
        moneda_cobro: monedaCobro(metodo),
        monto_cobro: monto,
      })
      if (!res.ok) {
        // 23505: ya hay un pedido 'nuevo' sobre esta suscripción. Es estado, no
        // fallo rojo; el admin todavía no la procesó.
        setAviso(
          res.conflicto
            ? 'Esta renovación ya estaba declarada y sigue en espera de confirmación. Escríbenos por WhatsApp si ya pagaste.'
            : `No se pudo registrar: ${res.error ?? 'intenta de nuevo'}`,
        )
        return
      }
      // El enlace se guarda y se pinta como botón en la tarjeta de confirmación.
      // `window.open` después del `await` del INSERT llega tarde para el navegador:
      // ya perdió el gesto del click y lo bloquea como pop-up, que es justo el
      // momento en que el cliente necesita mandar el comprobante.
      setWa(
        linkWhatsApp(
          msjRenovacion({
            cliente: nombre.trim() || 'cliente',
            plataforma: s.plataforma,
            duracion_dias: s.duracion_dias,
            corteActual: s.fecha_corte_cliente,
            corteQuedara: corteQuedara(s),
            cobro: fmtMonedaCobro(monedaCobro(metodo), monto),
            metodo: etiquetaMetodo(metodo),
            instrucciones: DATOS_COBRO[metodo],
          }),
        ),
      )
      setHecho(true)
      onDeclarada(s)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setEnviando(false)
    }
  }

  if (hecho)
    return (
      <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <h3 className="text-lg font-bold text-emerald-900">{s.plataforma}</h3>
        <p className="mt-1 text-sm leading-relaxed text-emerald-800">
          Renovación declarada. Abre WhatsApp con el mensaje ya escrito y mándanos el comprobante.
        </p>
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block rounded-full bg-[#25D366] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1EB857]"
        >
          Abrir WhatsApp con el monto
        </a>
        <p className="mt-3 text-xs leading-relaxed text-emerald-800/90">
          Tu corte sigue en {fmtFecha(s.fecha_corte_cliente)} hasta que confirmemos el pago. Cuando
          lo validemos pasará a {fmtFecha(corteQuedara(s))}.
        </p>
      </article>
    )

  return (
    <article className="rounded-2xl border border-blink-line bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-blink-dark">{s.plataforma}</h3>
          <p className="mt-0.5 text-xs uppercase tracking-wide text-blink-ink-mute">
            {etiquetaDuracion(s.duracion_dias)} · {estadoTexto(s.estado)}
          </p>
        </div>
        <p className="text-right text-2xl font-extrabold text-blink-dark">
          {precioUsd(s.monto_renovacion_usd)}
        </p>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-blink-ink-mute">Corte actual</dt>
          <dd className="text-sm font-semibold text-blink-dark">
            {s.fecha_corte_cliente ? fmtFecha(s.fecha_corte_cliente) : '—'}
          </dd>
          <dd className="text-xs text-blink-ink-mute">
            {s.dias_restantes < 0
              ? `venció hace ${dias(Math.abs(s.dias_restantes))}`
              : s.dias_restantes === 0
                ? 'vence hoy'
                : `faltan ${dias(s.dias_restantes)}`}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-blink-ink-mute">Quedará en</dt>
          <dd className="text-sm font-semibold text-blink-action">{fmtFecha(corteQuedara(s))}</dd>
          <dd className="text-xs text-blink-ink-mute">
            {s.fecha_corte_cliente < hoy()
              ? 'los días vencidos no se recuperan'
              : 'se suman desde tu corte'}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-blink-ink-mute">Hoy pagas</dt>
          <dd className="text-sm font-semibold text-blink-dark">
            {faltaTasa ? 'pendiente de tasa' : fmtMonedaCobro(monedaCobro(metodo), monto)}
          </dd>
          <dd className="text-xs text-blink-ink-mute">{etiquetaMetodo(metodo)}</dd>
        </div>
      </dl>

      {afuera ? (
        <p className="mt-4 rounded-xl bg-blink-fill px-4 py-3 text-xs leading-relaxed text-blink-muted">
          Todavía te faltan {dias(s.dias_restantes - VENTANA_DIAS)} para la ventana de renovación.
          Podrás declararla desde el {fmtFecha(desde)}. Si necesitas el cupo antes, escríbenos por
          WhatsApp y lo vemos a mano.
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {METODOS_PAGO.map((m) => {
              const total = montoCobro(m.id, s.monto_renovacion_usd, 'USD', { bcv, eur: null })
              const activo = metodo === m.id
              const disponible = total != null && !bloqueada && !enviando
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={!disponible}
                  onClick={() => setMetodo(m.id)}
                  className={`rounded-2xl border-2 p-3 text-left transition-colors ${
                    activo
                      ? 'border-blink-action bg-blink-soft'
                      : 'border-blink-line bg-white hover:border-blink-line-strong'
                  } ${disponible ? '' : 'cursor-not-allowed opacity-50'}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-base">{m.icono}</span>
                    <span className="text-sm font-bold text-blink-dark">{m.nombre}</span>
                  </span>
                  <span className="mt-1 block text-xs text-blink-ink-mute">{m.descripcion}</span>
                  <span className="mt-1.5 block text-sm font-extrabold text-blink-action">
                    {total == null ? 'sin tasa del día' : fmtMonedaCobro(monedaCobro(m.id), total)}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="mt-3 rounded-xl bg-blink-fill px-4 py-3 text-xs leading-relaxed text-blink-muted">
            {DATOS_COBRO[metodo] ? (
              <p>
                <strong className="text-blink-dark">Cómo pagar · {etiquetaMetodo(metodo)}:</strong>{' '}
                {DATOS_COBRO[metodo]}
              </p>
            ) : (
              <p className="text-amber-700">⚠️ {AVISO_DATOS_POR_CONFIRMAR}</p>
            )}
            <p className="mt-1 text-[11px] text-blink-ink-mute">
              Declárala con lo que realmente vas a pagar. Nosotros revisamos el ingreso y recién ahí
              movemos tu fecha de corte.
            </p>
          </div>

          {aviso ? (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">{aviso}</p>
          ) : null}
          {error ? <p className="mt-3 text-xs text-rose-700">{error}</p> : null}

          <button
            type="button"
            onClick={() => void declarar()}
            disabled={enviando || faltaTasa || bloqueada}
            className="mt-4 w-full rounded-full bg-blink-action px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blink-action-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enviando
              ? 'Registrando…'
              : faltaTasa
                ? 'Falta la tasa BCV del día'
                : `Declarar renovación · ${
                    monto == null ? '—' : fmtMonedaCobro(monedaCobro(metodo), monto)
                  }`}
          </button>
        </>
      )}
    </article>
  )
}

// ---------- Pantalla ----------
export default function Renovar() {
  const { session, cargando, rol, rolCargando, perfil } = useAuth()
  const [lista, setLista] = useState<MiSuscripcion[]>([])
  const [bcv, setBcv] = useState<number | null>(null)
  const [cargada, setCargada] = useState(false)
  const [error, setError] = useState('')
  const [declarada, setDeclarada] = useState(false)

  const clienteId = session?.user.id ?? ''
  const nombreValor = perfil?.nombre ?? ''

  const cargar = useCallback(() => {
    setError('')
    setCargada(false)
    Promise.all([fetchMisSuscripciones(), fetchTasaBcv().catch(() => null)])
      .then(([s, r]) => {
        setLista(s)
        // Una tasa vencida no es un precio. `fetchTasaBcv` ya baja al raspe
        // cuando lo guardado no está vigente; si aun así no consigue una fila del
        // día, `bcv` queda null: los métodos en Bs salen «sin tasa del día», el
        // botón arranca en USDT y nadie ve un monto calculado con un número viejo.
        setBcv(r && tasaVigente(r.fecha) ? r.tasa : null)
      })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setCargada(true))
  }, [])

  // Solo se consulta con sesión de cliente confirmada: sin token la vista
  // responde 42501, y el admin tiene su propia pantalla.
  useEffect(() => {
    if (session && rol !== 'admin') cargar()
  }, [session, rol, cargar])

  // El spinner cubre desde que se confirma el rol hasta que la vista contesta.
  // Atarlo también a «lista vacía» era un callejón: un cliente sin
  // suscripciones se quedaba mirando esqueletos para siempre y la tarjeta de
  // «no te encontramos suscripciones» nunca se pintaba.
  const esperando = rol !== 'admin' && !cargada

  // Un pedido abierto por suscripción lo impone el índice parcial de la base;
  // esto es solo para no ofrecer dos declaraciones en la misma visita.
  const bloqueada = declarada

  // `rol === null` no sirve de candado: un anónimo nunca tiene rol y se quedaba
  // mirando «Verificando tu sesión…» para siempre, sin ver nunca la pantalla de
  // entrar. El que espera de verdad es `rolCargando`.
  if (cargando || rolCargando)
    return (
      <div className="min-h-screen bg-blink-fill">
        <BarraTienda volver />
        <p className="py-24 text-center text-sm text-blink-ink-mute">Verificando tu sesión…</p>
      </div>
    )

  if (rol === 'admin')
    return (
      <div className="min-h-screen bg-blink-fill">
        <BarraTienda volver />
        <EsAdmin />
      </div>
    )

  return (
    <div className="min-h-screen bg-white">
      <BarraTienda volver />

      {!session ? (
        <SinSesion />
      ) : (
        <div className="mx-auto max-w-2xl px-4 py-10">
          <h1 className="text-2xl font-bold text-blink-dark">Renovar</h1>
          {!esperando && !error ? (
            <p className="mt-1 text-sm leading-relaxed text-blink-muted">
              Tienes {lista.length} suscripción{lista.length === 1 ? '' : 'es'}. Declara la que
              quieras extender y mándanos el comprobante por WhatsApp: nosotros confirmamos el pago
              y movemos tu fecha de corte.
            </p>
          ) : null}

          {esperando ? (
            <div className="mt-6 space-y-4">
              {[0, 1].map((i) => (
                <div key={i} className="h-44 animate-pulse rounded-2xl bg-blink-fill" />
              ))}
            </div>
          ) : error ? (
            <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
              <p className="text-sm font-medium text-rose-700">
                No pudimos traer tus suscripciones. Revisa tu conexión e intenta de nuevo.
              </p>
              <p className="mt-1 text-xs text-rose-600">{error}</p>
              <button
                type="button"
                onClick={cargar}
                className="mt-4 rounded-full bg-blink-action px-5 py-2 text-sm font-semibold text-white hover:bg-blink-action-hover"
              >
                Reintentar
              </button>
            </div>
          ) : lista.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-blink-line bg-blink-fill p-6">
              <p className="text-sm font-semibold text-blink-dark">
                No te encontramos suscripciones activas.
              </p>
              <p className="mt-1 text-sm leading-relaxed text-blink-muted">
                Si compraste antes de esta web, es probable que tu plan esté a nombre de otro correo
                o registrado a mano. Escríbenos por WhatsApp con tu correo y lo resolvemos. Si
                todavía no compraste, mira los planes disponibles.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  to="/"
                  className="rounded-full bg-blink-action px-5 py-2 text-sm font-semibold text-white hover:bg-blink-action-hover"
                >
                  Ver los planes
                </Link>
                <a
                  href={linkWhatsApp('Hola! Quiero revisar mi suscripción de Blink Plans.')}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-blink-line-strong bg-white px-5 py-2 text-sm font-semibold text-blink-muted hover:bg-blink-soft"
                >
                  Escribir por WhatsApp
                </a>
              </div>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {lista.map((s) => (
                <FilaRenovacion
                  key={s.suscripcion_id}
                  s={s}
                  bcv={bcv}
                  clienteId={clienteId}
                  nombre={nombreValor}
                  telefono={perfil?.telefono ?? ''}
                  deshabilitado={bloqueada}
                  onDeclarada={() => setDeclarada(true)}
                />
              ))}

              <div className="rounded-2xl bg-blink-dark p-5 text-white">
                <p className="text-sm font-bold">Qué pasa después de declarar</p>
                <p className="mt-1 text-sm leading-relaxed text-white/85">
                  Tu fecha de corte no se mueve sola. Una persona de Blink Plans revisa el pago, lo
                  valida en el sistema y recién ahí se extiende el corte la duración de tu plan. Te
                  avisamos por WhatsApp.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <footer className="mt-12 border-t border-blink-line bg-white py-8">
        <p className="mx-auto max-w-2xl px-4 text-center text-xs leading-relaxed text-blink-ink-mute">
          Los precios se expresan en dólares estadounidenses (USD). Si pagas en bolívares, el monto
          sale de la <strong>tasa de cambio oficial del BCV</strong> del día de tu pago. Planes
          familiares compartidos gestionados por <strong>Blink Plans</strong>.
        </p>
      </footer>
    </div>
  )
}
