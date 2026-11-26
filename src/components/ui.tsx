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

   Dos reglas que sostienen la coherencia visual, y son la razón de que las
   alturas sean `height` y no `min-height`:
     1. Tres alturas de control, tomadas de `--control-*`: 36 en fila de tabla
        y barra de filtros, 44 (el piso táctil) fuera de la tabla, 50 para el
        llamado principal. Una página no inventa la cuarta.
     2. Toda superficie es vidrio (`--color-superficie`), no blanco duro: si una
        caja fuera opaca, el fondo ambiental desaparece y el blur de la barra no
        tiene nada que difuminar.
   ============================================================ */

// ---------- Botones ----------
type BtnVariant = 'primary' | 'secondary' | 'danger' | 'danger-suave' | 'ghost' | 'tinted' | 'link'
type BtnTam = 'compacto' | 'normal' | 'grande'

const BTN_VARIANTS: Record<BtnVariant, string> = {
  // `sys-blue` (#007AFF) con blanco da 3,16:1: no pasa AA en texto de botón.
  // El relleno de acción de la casa es #0066CC (5,8:1), y el azul de marca se
  // deja para superficies grandes. Está documentado en index.css.
  primary: 'bg-blink-action text-white shadow-[0_1px_2px_rgba(0,0,0,0.16)]',
  // El secundario de iOS es relleno gris, no borde gris: pesa menos que el
  // primario sin convertirse en un recuadro vacío.
  secondary: 'bg-ink-fill-3 text-ink-label',
  danger: 'bg-sys-red text-white',
  // El rojo saturado solo va en la confirmación. Dentro de una fila es un
  // peligro de bajo grado: velo rojo con la tinta medida, como el borrado por
  // deslizamiento de iOS. Treinta y cuatro cuadros rojos macizos en la lista de
  // clientes no existen en ninguna pantalla de Apple.
  'danger-suave': 'bg-velo-danger text-tinta-danger',
  ghost: 'bg-transparent text-ink-secondary',
  tinted: 'bg-blink-soft text-blink-action-hover',
  // `sys-blue` tampoco sirve para un enlace: a 15 px da 3,16:1 sobre blanco.
  // El texto accionable usa la misma tinta que el relleno de acción.
  link: 'bg-transparent text-blink-action-text underline-offset-2 hover:underline',
}

const BTN_TAM: Record<BtnTam, string> = {
  compacto: 'h-[var(--control-compacto)] px-3 text-nota rounded-[10px]',
  normal: 'h-[var(--control-normal)] px-5 text-headline rounded-full',
  grande: 'h-[var(--control-grande)] px-7 text-llamado rounded-full',
}

// Cuadrado perfecto por tamaño. Las clases van escritas literales: Tailwind
// rastrea el texto del fuente, y un nombre armado con interpolación no existe
// en el CSS generado.
const BTN_SOLO_ICONO: Record<BtnTam, string> = {
  compacto: 'h-[var(--control-compacto)] w-[var(--control-compacto)] px-0 text-nota rounded-[10px]',
  normal: 'h-[var(--control-normal)] w-[var(--control-normal)] px-0 text-headline rounded-full',
  grande: 'h-[var(--control-grande)] w-[var(--control-grande)] px-0 text-llamado rounded-full',
}

export function Button({
  variant = 'primary',
  tam = 'normal',
  className = '',
  bloque = false,
  soloIcono = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant
  tam?: BtnTam
  /** Ocupa todo el ancho: en móvil la acción principal es una fila entera. */
  bloque?: boolean
  /** Cuadrado, sin relleno lateral: el `px-5` de un botón normal lo haría de ~90 px. */
  soloIcono?: boolean
}) {
  return (
    <button
      className={`inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-semibold transition-[opacity,background-color,transform] duration-150 active:opacity-80 disabled:pointer-events-none disabled:opacity-40 ${BTN_VARIANTS[variant]} ${
        soloIcono ? BTN_SOLO_ICONO[tam] : BTN_TAM[tam]
      } ${bloque ? 'w-full' : ''} ${className}`}
      {...props}
    />
  )
}

// ---------- Campos ----------
// El campo de iOS va hundido en la superficie: relleno gris traslúcido y SIN
// borde, que es como se ve en Ajustes y como ya venía el buscador. Un `border`
// propio por campo suma un hairline que compite con el de la tarjeta.
const CAMPO_BASE =
  'h-[var(--control-normal)] w-full rounded-[10px] border border-transparent bg-ink-fill-4 px-3.5 text-cuerpo text-ink-label placeholder:text-ink-secondary transition-[background-color,border-color,box-shadow] duration-150 focus:border-sys-blue focus:bg-white focus:shadow-[0_0_0_3.5px_rgba(0,122,255,0.16)] focus:outline-none'

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
    ? 'h-[var(--control-compacto)] w-auto rounded-[10px] border border-transparent bg-ink-fill-4 px-2.5 pr-7 text-nota font-medium text-ink-label'
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
// La pista mide 44 (el piso táctil) y el dedo interior 36: la resta es el
// `p-1`, no una altura escrita a mano. El radio interno sale del externo menos
// el relleno, que es como Apple calcula la concéntrica.
// El dedo blanco es el único relleno sólido: sobre el gris translúcido del
// contenedor es lo que hace legible la selección sin borde ni checked.
// `tam` sigue la misma escala de `Button` para que un segmento y un botón
// compacto que comparten el encabezado de una tabla midan lo mismo.
export function Segmento<T extends string>({
  opciones,
  valor,
  onChange,
  tam = 'normal',
}: {
  opciones: Array<{ id: T; label: string; simbolo?: ReactNode }>
  valor: T
  onChange: (v: T) => void
  tam?: 'compacto' | 'normal'
}) {
  return (
    <div
      role="tablist"
      className={`flex w-full max-w-full items-stretch gap-1 overflow-x-auto rounded-[12px] bg-ink-fill-3 p-1 sin-barra ${
        tam === 'compacto' ? 'h-[var(--control-compacto)]' : 'h-[var(--control-normal)]'
      }`}
    >
      {opciones.map((o) => {
        const activo = o.id === valor
        return (
          // `basis-auto` en lugar del `flex-1` (base 0) de antes: con la base en
          // cero y `min-w-[84px]`, una etiqueta más ancha que 84 px desbordaba su
          // pastilla y se montaba sobre la siguiente ("RenovacionesContactados"
          // a 390 px). Así cada segmento mide su texto con aire y el riel solo
          // estira los que tienen espacio de sobra.
          <button
            key={o.id}
            role="tab"
            aria-selected={activo}
            onClick={() => onChange(o.id)}
            className={`flex shrink-0 grow basis-auto items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] px-3.5 font-medium transition-[background-color,color,box-shadow] ${
              tam === 'compacto' ? 'text-nota' : 'text-subheadline'
            } ${
              activo
                ? 'bg-white text-ink-label shadow-[0_1px_3px_rgba(0,0,0,0.14)]'
                : 'text-ink-secondary'
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
// sistema declarados en el tema. La loseta chica de navegación lleva su propio
// radio (la concéntrica baja con el tamaño); antes Layout dibujaba esa caja a
// mano con `h-[22px] rounded-[6px]` en dos sitios.
export function Loseta({
  children,
  tono = 'var(--color-sys-blue)',
  tam = 28,
  className = '',
}: {
  children: ReactNode
  tono?: string
  tam?: 22 | 24 | 28 | 30 | 34 | 38
  className?: string
}) {
  return (
    <span
      className={`grid shrink-0 place-items-center ${tam <= 22 ? 'rounded-[6px]' : 'rounded-loseta'} text-white ${className}`}
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
      <div className="vidrio overflow-hidden rounded-tarjeta">
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
  // `px-4` es el mismo hueco horizontal de `Table`: una lista agrupada y una
  // tabla comparten columna de datos, si no el contenido baila al cambiar de
  // vista. `min-h` deja la fila en el área táctil de 44 con un solo renglón.
  return (
    <div className={`flex min-h-[52px] items-center gap-3 px-4 py-3 ${className}`}>
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
//
// `titulo` y `acciones` existen para que la tabla NO se envuelva en un `Card`:
// cinco páginas lo hacían y el resultado eran dos marcos y dos rellenos
// anidados. La tabla ya es una superficie de vidrio; lo único que le falta
// encima es su nombre.
export function Table({
  headers,
  children,
  sticky = true,
  titulo,
  acciones,
}: {
  headers: string[]
  children: ReactNode
  sticky?: boolean
  titulo?: string
  acciones?: ReactNode
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
    <section>
      {titulo || acciones ? (
        <header className="mb-2.5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="px-1 text-nota font-semibold uppercase tracking-[0.02em] text-ink-secondary">
            {titulo}
          </h2>
          {acciones ? <div className="flex items-center gap-2">{acciones}</div> : null}
        </header>
      ) : null}
      <div className="tabla-ficha vidrio overflow-hidden rounded-tarjeta">
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
    </section>
  )
}

interface TdProps {
  children?: ReactNode
  className?: string
  'data-col'?: string
}

// `py-2.5` igual que el `th`: con botón de fila a 36 px la celda de 12 px de
// padding vertical inflaba cada renglón ~16 px por encima del de al lado.
// `num` alinea a la derecha los importes y les pone cifras tabulares, que es lo
// que hace que una columna de plata se pueda leer hacia abajo.
export function Td({
  children,
  className = '',
  num = false,
  ...rest
}: TdProps & { /** Celda de cifra: a la derecha y con `tabular-nums`. */ num?: boolean }) {
  return (
    <td
      className={`break-words px-4 py-2.5 align-middle text-subheadline text-ink-label ${
        num ? 'text-right tabular-nums' : ''
      } ${className}`}
      {...rest}
    >
      {children}
    </td>
  )
}

// ---------- Badges ----------
// Color de sistema + tinta oscura del mismo tono para que el texto passe AA
// sobre el velo claro (el verde #34C759 con blanco da 1,9:1: inalcanzable).
// `min-h-6` para que un badge apilado bajo un selector de fila mida lo mismo
// que el chip de al lado.
const badgeColors: Record<string, string> = {
  activa: 'bg-velo-ok text-tinta-ok',
  vencida: 'bg-ink-fill-3 text-ink-secondary',
  cancelada: 'bg-ink-fill-3 text-ink-secondary',
  suspendida: 'bg-velo-aviso text-tinta-aviso',
  baja: 'bg-ink-fill-3 text-ink-secondary',
  pendiente: 'bg-velo-aviso text-tinta-aviso',
  liquidada: 'bg-velo-ok text-tinta-ok',
  admin: 'bg-velo-purple text-tinta-purple',
  agente: 'bg-velo-info text-tinta-info',
  cliente: 'bg-ink-fill-3 text-ink-secondary',
  nuevo: 'bg-velo-blue text-blink-action-text',
  contactado: 'bg-velo-aviso text-tinta-aviso',
  completado: 'bg-velo-ok text-tinta-ok',
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
      className={`inline-flex min-h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-legenda font-semibold ${color}`}
    >
      {punto ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: punto }} /> : null}
      {value}
    </span>
  )
}

// ---------- Tarjetas ----------
// `p-4 md:p-5` en las dos: `Card` y `StatCard` son hermanas y StatCard se
// quedaba en 16 px en escritorio, así una grilla mixura salía despareja.
export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="vidrio rounded-tarjeta p-4 md:p-5">
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
    <div className="vidrio flex h-full flex-col rounded-tarjeta p-4 md:p-5">
      <div className="flex items-center gap-2.5">
        {icono ? <Loseta tono={tono}>{icono}</Loseta> : null}
        <p className="min-w-0 flex-1 text-nota font-medium text-ink-secondary">{label}</p>
      </div>
      <p className="mt-2 text-title-2 font-bold tracking-[-0.3px] text-ink-label tabular-nums">
        {value}
      </p>
      {hint ? <p className="mt-1 text-legenda leading-[15px] text-ink-secondary">{hint}</p> : null}
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-[3px] md:items-center md:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`vidrio-hoja flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[var(--radius-hoja)] md:max-h-[88vh] md:rounded-[18px] ${ancho}`}
      >
        <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-ink-tertiary md:hidden" />
        <div className="flex items-center justify-between gap-3 border-b border-ink-separator/60 px-4 py-3">
          <h3 className="min-w-0 flex-1 truncate text-headline font-semibold text-ink-label">{title}</h3>
          {/* Cierre del kit: mismo cuadro de 36 px que un control compacto, en
              vez del `h-8 w-8` suelto de antes. */}
          <Button
            variant="secondary"
            tam="compacto"
            soloIcono
            onClick={onClose}
            aria-label="Cerrar"
            className="shrink-0 text-ink-secondary"
          >
            <IconX tam={14} peso="semipesado" />
          </Button>
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
    <p className="flex items-start gap-2.5 rounded-[12px] bg-velo-danger px-3.5 py-3 text-nota leading-[18px] text-tinta-danger">
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

// ---------- Raíz de una pantalla del panel ----------
// Sin este envoltorio cada página ponía su `space-y` a mano — cinco en el
// catálogo, seis en Dinero— y el mismo bloque caía a distinto alto de una
// pantalla a otra. Una sola medida para las doce: 20 px, que es el paso de
// Apple entre secciones de una lista agrupada.
// Gap en lugar de `space-y-*`: los márgenes alternados se caen cuando un hijo
// es un fragmento o un condicional, y entonces dos bloques se pegan o quedan a
// 40 px. Con gap la separación de 20 px es por hijo, no por posición.
export function Pagina({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-5">{children}</div>
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
        className="h-[var(--control-normal)] w-full appearance-none rounded-[10px] border border-transparent bg-ink-fill-4 pl-9 pr-10 text-cuerpo text-ink-label placeholder:text-ink-secondary focus:border-sys-blue focus:bg-white focus:shadow-[0_0_0_3.5px_rgba(0,122,255,0.16)] focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        placeholder={placeholder ?? 'Buscar…'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value ? (
        <button
          onClick={() => onChange('')}
          aria-label="Limpiar la búsqueda"
          className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-ink-secondary transition-opacity active:opacity-60"
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
    <div className="vidrio-suave flex flex-col items-center gap-2.5 rounded-tarjeta px-4 py-10 text-center">
      {icono ? (
        <Loseta tam={38} tono="var(--color-sys-gray)">
          {icono}
        </Loseta>
      ) : null}
      <p className="max-w-md text-nota leading-[18px] text-ink-secondary">{message}</p>
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
    tono === 'ok' ? 'bg-velo-ok text-tinta-ok' : 'bg-velo-aviso text-tinta-aviso'
  return (
    <div
      className={`flex items-start gap-2.5 rounded-[12px] px-3.5 py-2.5 text-nota leading-[18px] ${clases}`}
    >
      {tono === 'ok' ? (
        <IconCheckcirculo tam={17} className="mt-px shrink-0" />
      ) : (
        <IconAlerta tam={17} peso="medio" className="mt-px shrink-0" />
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
// El pie va pegado abajo y flota sobre el contenido que se desliza, así que es
// la única parte de la hoja que necesita blur de verdad.
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
    <div className="material sticky bottom-0 -mx-4 mt-2 flex flex-col-reverse gap-2 border-t border-ink-separator/60 px-4 pb-3 pt-3 pb-safe md:flex-row md:justify-end">
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
  verde: 'text-tinta-ok',
  naranja: 'text-tinta-aviso',
}

export function Chip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex min-h-6 items-center gap-1 rounded-full bg-ink-fill-4 px-2.5 text-legenda font-medium text-ink-secondary ${className}`}>
      {children}
    </span>
  )
}

export type { PropsSimbolo }
