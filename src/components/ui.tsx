import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import {
  IconAbajo,
  IconAlerta,
  IconCheckcirculo,
  IconSearch,
  IconX,
  IconXcirculo,
  type PropsSimbolo,
} from './icons'

/* ============================================================
   Kit de UI del panel — calado a las medidas de Human Interface
   Guidelines (Apple) y a las páginas de Apple en la web.

   Lo que se copió medido, no de memoria:
     · objetivo táctil 44 pt (HIG: mínimo para el dedo),
     · cuerpo de texto 17 pt con interlineado 22 (no 14, que en un teléfono
       es letra secundaria),
     · tintas semánticas label / secondaryLabel / separator / fill,
     · radio de tarjeta 14 y de hoja 22 (la esquina continua de iOS no existe
       en CSS: se aproxima con radios algo mayores que los de la retícula),
     · botón pulsado = 80 % de opacidad, no otro color,
     · hairline de separación en vez de filas rayadas.
   Todo eso vive en src/index.css (`@theme`), acá solo se compone.
   ============================================================ */

// ---------- Botones ----------
type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'tinted' | 'link'
type BtnTam = 'compacto' | 'normal' | 'grande'

const BTN_VARIANTS: Record<BtnVariant, string> = {
  primary: 'bg-sys-blue text-white shadow-[0_1px_2px_rgba(0,0,0,0.16)]',
  // El secundario de iOS es relleno gris, no borde gris: pesa menos que el
  // primario sin convertirse en un recuadro vacío.
  secondary: 'bg-ink-fill-3 text-ink-label',
  danger: 'bg-sys-red text-white',
  ghost: 'bg-transparent text-ink-secondary',
  tinted: 'bg-blink-soft text-blink-action-hover',
  link: 'bg-transparent text-sys-blue underline-offset-2 hover:underline',
}

const BTN_TAM: Record<BtnTam, string> = {
  compacto: 'min-h-8 px-3 text-subheadline rounded-[9px]',
  normal: 'min-h-11 px-5 text-headline rounded-full',
  grande: 'min-h-[50px] px-7 text-llamado rounded-full',
}

export function Button({
  variant = 'primary',
  tam = 'normal',
  className = '',
  bloque = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant
  tam?: BtnTam
  /** Ocupa todo el ancho: en móvil la acción principal es una fila entera. */
  bloque?: boolean
}) {
  return (
    <button
      className={`inline-flex select-none items-center justify-center gap-2 font-semibold transition-[opacity,background-color,transform] duration-150 active:opacity-80 disabled:pointer-events-none disabled:opacity-40 ${BTN_VARIANTS[variant]} ${BTN_TAM[tam]} ${bloque ? 'w-full' : ''} ${className}`}
      {...props}
    />
  )
}

// ---------- Campos ----------
const CAMPO_BASE =
  'w-full min-h-11 rounded-[10px] border border-sys-gray4 bg-white px-3.5 text-cuerpo text-ink-label placeholder:text-ink-tertiary transition-[border-color,box-shadow] duration-150 focus:border-sys-blue focus:shadow-[0_0_0_3.5px_rgba(0,122,255,0.16)] focus:outline-none'

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${CAMPO_BASE} ${className}`} {...props} />
}

// El `select` nativo pinta la flecha del sistema operativo (en Chromium un
// triángulo gris que no combina con ningún token). Se apaga y se dibuja el
// `chevron.down` de la retícula encima.
//
// `compacto` es para el selector que vive DENTRO de una fila de tabla: ahí 44 px
// de alto y el ancho completo no caben, y la fila ya trae su propio badge.
export function Select({
  className = '',
  compacto = false,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { compacto?: boolean }) {
  const base = compacto
    ? 'w-auto min-h-9 rounded-[9px] border border-sys-gray4 bg-white px-2.5 pr-7 text-nota font-medium'
    : `${CAMPO_BASE} pr-10`
  return (
    <span className={compacto ? 'relative inline-flex items-center' : 'relative block'}>
      <select className={`${base} appearance-none ${className}`} {...props} />
      <IconAbajo
        tam={compacto ? 12 : 15}
        peso="medio"
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-secondary ${
          compacto ? 'right-1.5' : 'right-3.5'
        }`}
      />
    </span>
  )
}

// ---------- Campos con etiqueta (fila agrupada) ----------
// En escritorio la etiqueta va al lado, como en Ajustes; en móvil sube arriba
// porque 150 px de etiqueta dejan 3 párrafos de campo en un iPhone.
export function Field({
  label,
  children,
  nota,
  required,
}: {
  label: string
  children: ReactNode
  nota?: ReactNode
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-1 text-subheadline font-medium text-ink-secondary md:mb-1">
        {label}
        {required ? <span className="text-sys-red">*</span> : null}
      </span>
      <span className="block">{children}</span>
      {nota ? <span className="mt-1.5 block text-nota leading-[18px] text-ink-secondary">{nota}</span> : null}
    </label>
  )
}

// ---------- Segmento (control segmentado de iOS) ----------
export function Segmento<T extends string>({
  opciones,
  valor,
  onChange,
}: {
  opciones: Array<{ id: T; label: string; simbolo?: ReactNode }>
  valor: T
  onChange: (v: T) => void
}) {
  return (
    <div
      role="tablist"
      className="flex w-full max-w-full gap-0.5 overflow-x-auto rounded-[10px] bg-ink-fill-3 p-0.5"
    >
      {opciones.map((o) => {
        const activo = o.id === valor
        return (
          <button
            key={o.id}
            role="tab"
            aria-selected={activo}
            onClick={() => onChange(o.id)}
            className={`flex min-h-9 flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] px-3 text-subheadline font-medium transition-colors ${
              activo ? 'bg-white text-ink-label shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-ink-secondary'
            }`}
          >
            {o.simbolo}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ---------- Loseta de símbolo ----------
// El cuadrado de color detrás del símbolo, como en la barra lateral de
// Ajustes y en las filas de notificaciones. `tono` acepta los colores de
// sistema declarados en el tema.
export function Loseta({
  children,
  tono = 'var(--color-sys-blue)',
  tam = 28,
  className = '',
}: {
  children: ReactNode
  tono?: string
  tam?: 24 | 28 | 30 | 34 | 38
  className?: string
}) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-loseta text-white ${className}`}
      style={{ background: tono, width: tam, height: tam }}
    >
      {children}
    </span>
  )
}

// ---------- Listas agrupadas (el formato de Ajustes) ----------
export function Grupo({
  titulo,
  pies,
  children,
  className = '',
}: {
  titulo?: string
  pies?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      {titulo ? (
        <h2 className="mb-1.5 px-1 text-nota font-semibold uppercase tracking-[0.02em] text-ink-secondary">
          {titulo}
        </h2>
      ) : null}
      <div className="overflow-hidden rounded-tarjeta border border-ink-quaternary bg-white shadow-tarjeta">
        <div className="divide-y divide-ink-separator/60">{children}</div>
      </div>
      {pies ? <p className="mt-1.5 px-1 text-nota leading-[18px] text-ink-secondary">{pies}</p> : null}
    </section>
  )
}

export function Fila({
  titulo,
  detalle,
  valor,
  accion,
  icono,
  tono,
  className = '',
}: {
  titulo: ReactNode
  detalle?: ReactNode
  valor?: ReactNode
  accion?: ReactNode
  icono?: ReactNode
  tono?: string
  className?: string
}) {
  return (
    <div className={`flex items-center gap-3 px-3.5 py-3 ${className}`}>
      {icono ? <Loseta tono={tono}>{icono}</Loseta> : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-headline font-medium text-ink-label">{titulo}</p>
        {detalle ? <p className="truncate text-nota text-ink-secondary">{detalle}</p> : null}
      </div>
      {valor ? <div className="shrink-0 text-subheadline text-ink-secondary">{valor}</div> : null}
      {accion ? <div className="flex shrink-0 items-center gap-1.5">{accion}</div> : null}
    </div>
  )
}

// ---------- Tablas ----------
// Debajo de 1280 px la tabla se reordena como lista agrupada (`.tabla-ficha` en
// index.css). Para ello cada celda necesita el título de su columna, y como las
// páginas lo escriben una sola vez en `headers`, acá se clona sobre cada `Td`
// en orden: ninguna página repite la etiqueta a mano.
export function Table({
  headers,
  children,
  sticky = true,
}: {
  headers: string[]
  children: ReactNode
  sticky?: boolean
}) {
  const filas = Children.map(children, (tr) => {
    if (!isValidElement(tr)) return tr
    let i = 0
    const celdas = Children.toArray((tr.props as { children?: ReactNode }).children).map((celda) => {
      if (isValidElement<TdProps>(celda) && celda.type === Td) {
        const etiqueta = headers[i]
        i += 1
        return etiqueta ? cloneElement(celda, { 'data-col': etiqueta }) : celda
      }
      return celda
    })
    return cloneElement(tr, {}, celdas)
  })

  return (
    <div className="tabla-ficha overflow-hidden rounded-tarjeta border border-ink-quaternary bg-white shadow-tarjeta">
      <div className="max-h-[72vh] overflow-auto">
        {/* `min-w-max` en escritorio empujaba la columna de Acciones fuera de la
            pantalla en 1440: la tabla cabe si las celdas largas se rompen, y para
            eso está `break-words` en Td. */}
        <table className="w-full">
          <thead
            className={`${sticky ? 'sticky top-0 z-10' : ''} material text-ink-secondary`}
          >
            <tr>
              {headers.map((h) => (
                <th
                  key={h}
                  className="border-b border-ink-separator px-4 py-2.5 text-left text-nota font-semibold"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{filas}</tbody>
        </table>
      </div>
    </div>
  )
}

interface TdProps {
  children?: ReactNode
  className?: string
  'data-col'?: string
}

export function Td({ children, className = '', ...rest }: TdProps) {
  return (
    <td className={`break-words px-4 py-3 align-middle text-subheadline text-ink-label ${className}`} {...rest}>
      {children}
    </td>
  )
}

// ---------- Badges ----------
// Color de sistema + tinta oscura del mismo tono para que el texto passe AA
// sobre el velo claro (el verde #34C759 con blanco da 1,9:1: inalcanzable).
const badgeColors: Record<string, string> = {
  activa: 'bg-[rgba(52,199,89,0.14)] text-[#1c7c34]',
  vencida: 'bg-ink-fill-3 text-ink-secondary',
  cancelada: 'bg-ink-fill-3 text-ink-secondary',
  suspendida: 'bg-[rgba(255,149,0,0.16)] text-[#9a5b00]',
  baja: 'bg-ink-fill-3 text-ink-secondary',
  pendiente: 'bg-[rgba(255,149,0,0.16)] text-[#9a5b00]',
  liquidada: 'bg-[rgba(52,199,89,0.14)] text-[#1c7c34]',
  admin: 'bg-[rgba(175,82,222,0.14)] text-[#7d2fa3]',
  agente: 'bg-[rgba(48,176,199,0.16)] text-[#1f7186]',
  cliente: 'bg-ink-fill-3 text-ink-secondary',
  nuevo: 'bg-[rgba(0,122,255,0.12)] text-[#0062cc]',
  contactado: 'bg-[rgba(255,149,0,0.16)] text-[#9a5b00]',
  completado: 'bg-[rgba(52,199,89,0.14)] text-[#1c7c34]',
  cancelado: 'bg-ink-fill-3 text-ink-secondary',
}

const DOT: Record<string, string> = {
  activa: '#34c759',
  completado: '#34c759',
  liquidada: '#34c759',
  pendiente: '#ff9500',
  contactado: '#ff9500',
  suspendida: '#ff9500',
  nuevo: '#007aff',
  vencida: '#8e8e93',
  cancelada: '#8e8e93',
  cancelado: '#8e8e93',
}

export function Badge({ value }: { value: string }) {
  const color = badgeColors[value] ?? 'bg-ink-fill-3 text-ink-secondary'
  const punto = DOT[value]
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-legenda font-semibold ${color}`}
    >
      {punto ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: punto }} /> : null}
      {value}
    </span>
  )
}

// ---------- Tarjetas ----------
export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded-tarjeta border border-ink-quaternary bg-white p-4 shadow-tarjeta md:p-5">
      {title ? (
        <h2 className="mb-3 text-nota font-semibold uppercase tracking-[0.02em] text-ink-secondary">
          {title}
        </h2>
      ) : null}
      {children}
    </div>
  )
}

export function StatCard({
  label,
  value,
  hint,
  icono,
  tono = 'var(--color-sys-blue)',
}: {
  label: string
  value: string | number
  hint?: string
  icono?: ReactNode
  tono?: string
}) {
  return (
    <div className="rounded-tarjeta border border-ink-quaternary bg-white p-4 shadow-tarjeta">
      <div className="flex items-center gap-2.5">
        {icono ? <Loseta tono={tono}>{icono}</Loseta> : null}
        <p className="text-nota font-medium text-ink-secondary">{label}</p>
      </div>
      <p className="mt-2 text-title-2 font-bold tracking-[-0.3px] text-ink-label [font-variant-numeric:tabular-nums]">
        {value}
      </p>
      {hint ? <p className="mt-1 text-legenda text-ink-secondary">{hint}</p> : null}
    </div>
  )
}

// ---------- Hoja (sheet) ----------
// En móvil sube desde el borde inferior con radio de hoja y área segura; en
// escritorio es el diálogo centrado de siempre. Se cierra con Escape y con el
// velo, y mientras está abierta el fondo no se mueve (en iOS la vista de abajo
// queda congelada).
export function Modal({
  open,
  title,
  onClose,
  children,
  ancho = 'max-w-lg',
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  ancho?: string
}) {
  useEffect(() => {
    if (!open) return
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', tecla)
    return () => {
      document.body.style.overflow = previo
      window.removeEventListener('keydown', tecla)
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-[2px] md:items-center md:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[var(--radius-hoja)] bg-white shadow-hoja md:max-h-[88vh] md:rounded-[18px] md:shadow-[0_24px_64px_-24px_rgba(0,0,0,0.4)] ${ancho}`}
      >
        <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-ink-tertiary md:hidden" />
        <div className="flex items-center justify-between gap-3 border-b border-ink-separator/60 px-4 py-3">
          <h3 className="min-w-0 flex-1 truncate text-headline font-semibold text-ink-label">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink-fill-3 text-ink-secondary transition-opacity active:opacity-70"
          >
            <IconX tam={14} peso="semipesado" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </div>
  )
}

// ---------- Estados de carga/error ----------
export function Loading() {
  return (
    <div className="flex items-center justify-center gap-2.5 py-10 text-nota text-ink-secondary">
      <svg width="18" height="18" viewBox="0 0 24 24" className="animate-spin" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2.4" />
        <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      Cargando…
    </div>
  )
}

export function ErrorMsg({ message }: { message: string }) {
  return (
    <p className="flex items-start gap-2.5 rounded-[12px] bg-[rgba(255,59,48,0.12)] px-3.5 py-3 text-nota leading-[18px] text-[#a11f18]">
      <IconAlerta tam={17} peso="medio" className="mt-px shrink-0 text-sys-red" />
      {message}
    </p>
  )
}

// ---------- Encabezado de página estándar ----------
// El título grande de iOS va arriba y las acciones abajo, a todo el ancho; en
// escritorio vuelven a la misma línea.
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-4">
      <div className="min-w-0">
        <h1 className="text-title-1 font-bold text-ink-label md:text-title-2">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-nota leading-[18px] text-ink-secondary">{subtitle}</p> : null}
      </div>
      {children ? (
        <div className="flex flex-wrap items-center gap-2 md:justify-end [&>button]:flex-1 md:[&>button]:flex-none">
          {children}
        </div>
      ) : null}
    </header>
  )
}

// ---------- Búsqueda estándar (campo de búsqueda de iOS) ----------
export function Buscador({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="relative w-full max-w-md">
      <IconSearch tam={16} peso="medio" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-secondary" />
      <input
        type="search"
        inputMode="search"
        className="min-h-11 w-full appearance-none rounded-[10px] border border-transparent bg-ink-fill-3 pl-9 pr-9 text-cuerpo text-ink-label placeholder:text-ink-secondary focus:border-sys-blue focus:bg-white focus:shadow-[0_0_0_3.5px_rgba(0,122,255,0.16)] focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        placeholder={placeholder ?? 'Buscar…'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value ? (
        <button
          onClick={() => onChange('')}
          aria-label="Limpiar la búsqueda"
          className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-ink-secondary transition-opacity active:opacity-60"
        >
          <IconXcirculo tam={16} />
        </button>
      ) : null}
    </div>
  )
}

// ---------- Estado vacío ----------
export function EmptyState({
  message = 'Sin registros por ahora.',
  icono,
}: {
  message?: string
  icono?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-tarjeta border border-dashed border-ink-tertiary bg-white/60 px-4 py-10 text-center">
      {icono ? (
        <Loseta tam={38} tono="var(--color-sys-gray)">
          {icono}
        </Loseta>
      ) : null}
      <p className="text-nota text-ink-secondary">{message}</p>
    </div>
  )
}

// ---------- Confirmación destructiva ----------
// `window.confirm` sale con la piel del navegador y no se puede deshacer con el
// pulgar: en iOS la acción riesgosa sube en hoja, con el verbo en rojo y el
// cancelado arriba. Es la misma hoja del kit, con el pie invertido.
export function Confirmar({
  open,
  titulo,
  detalle,
  confirmar = 'Eliminar',
  ocupado = false,
  onCancel,
  onConfirm,
}: {
  open: boolean
  titulo: string
  detalle?: ReactNode
  confirmar?: string
  ocupado?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal open={open} title={titulo} onClose={onCancel} ancho="max-w-sm">
      {detalle ? (
        <p className="text-nota leading-[18px] text-ink-secondary">{detalle}</p>
      ) : null}
      <div className="mt-4 flex flex-col gap-2">
        <Button
          variant="danger"
          bloque
          disabled={ocupado}
          onClick={onConfirm}
        >
          {ocupado ? 'Un momento…' : confirmar}
        </Button>
        <Button variant="secondary" bloque disabled={ocupado} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </Modal>
  )
}

// ---------- Aviso (éxito / atención) ----------
// Los `bg-emerald-50` sueltos de las páginas no pasan AA con su propia tinta y
// no combinan con ningún token; acá van las dos tintas de sistema cargadas.
export function Aviso({
  tono = 'ok',
  children,
}: {
  tono?: 'ok' | 'ojo'
  children: ReactNode
}) {
  const clases =
    tono === 'ok'
      ? 'bg-[rgba(52,199,89,0.14)] text-[#1c7c34]'
      : 'bg-[rgba(255,149,0,0.16)] text-[#9a5b00]'
  return (
    <div
      className={`flex items-start gap-2.5 rounded-[12px] px-3.5 py-2.5 text-nota leading-[18px] ${clases}`}
    >
      {tono === 'ok' ? (
        <IconCheckcirculo tam={17} className="mt-px shrink-0 text-[#1c7c34]" />
      ) : (
        <IconAlerta tam={17} peso="medio" className="mt-px shrink-0 text-[#9a5b00]" />
      )}
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  )
}

// ---------- Hook de confirmación ----------
// `window.confirm` no se puede vestir, y en un teléfono sale como aviso del
// navegador, cortado y sin verbo de acción. La hoja vive en el Layout
// (`ProveedorConfirmar`) para que las páginas que hacen `if (cargando) return`
// no tengan que montarla cada una, y devuelve una promesa: el `await` reemplaza
// al `window.confirm` en el mismo sitio, sin reescribir el botón que lo llama.
interface Solicitud {
  titulo: string
  detalle?: ReactNode
  boton?: string
  resolver: (v: boolean) => void
}

const ContextoConfirmar = createContext<(titulo: string, opts?: { detalle?: ReactNode; boton?: string }) => Promise<boolean>>(
  () => Promise.resolve(false),
)

export function ProveedorConfirmar({ children }: { children: ReactNode }) {
  const [solicitud, setSolicitud] = useState<Solicitud | null>(null)

  const confirmar = useCallback(
    (titulo: string, opts?: { detalle?: ReactNode; boton?: string }) =>
      new Promise<boolean>((resolver) =>
        setSolicitud({ titulo, detalle: opts?.detalle, boton: opts?.boton, resolver }),
      ),
    [],
  )

  const cerrar = (valor: boolean) => {
    solicitud?.resolver(valor)
    setSolicitud(null)
  }

  return (
    <ContextoConfirmar.Provider value={confirmar}>
      {children}
      <Confirmar
        open={!!solicitud}
        titulo={solicitud?.titulo ?? ''}
        detalle={solicitud?.detalle}
        confirmar={solicitud?.boton}
        onCancel={() => cerrar(false)}
        onConfirm={() => cerrar(true)}
      />
    </ContextoConfirmar.Provider>
  )
}

export function useConfirmar() {
  const confirmar = useContext(ContextoConfirmar)
  return { confirmar }
}

// ---------- Pie de hoja estándar (Cancelar + Guardar) ----------
export function ModalFooter({
  onCancel,
  onSave,
  saveLabel = 'Guardar',
  disabled = false,
  guardando = false,
}: {
  onCancel: () => void
  onSave: () => void
  saveLabel?: string
  disabled?: boolean
  guardando?: boolean
}) {
  return (
    <div className="sticky bottom-0 -mx-4 mt-2 flex flex-col-reverse gap-2 border-t border-ink-separator/60 bg-white/95 px-4 pb-3 pt-3 backdrop-blur md:flex-row md:justify-end pb-safe">
      <Button variant="secondary" onClick={onCancel} disabled={guardando} bloque className="md:w-auto">
        Cancelar
      </Button>
      <Button onClick={onSave} disabled={disabled || guardando} bloque className="md:w-auto">
        {guardando ? 'Guardando…' : saveLabel}
      </Button>
    </div>
  )
}

// ---------- Utilidades sueltas ----------
/** Tinta de sistema para los textos que ya no usan `text-slate-*`. */
export const tinta = {
  label: 'text-ink-label',
  secundaria: 'text-ink-secondary',
  azul: 'text-sys-blue',
  roja: 'text-sys-red',
  verde: 'text-[#1c7c34]',
  naranja: 'text-[#9a5b00]',
}

export function Chip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-ink-fill-4 px-2 py-0.5 text-legenda font-medium text-ink-secondary ${className}`}>
      {children}
    </span>
  )
}

export type { PropsSimbolo }
