// Iconos vectoriales calados a la retícula de SF Symbols.
//
// Apple no permite embutir la fuente de SF Symbols fuera de sus plataformas (la
// licencia de las Symbol Apps amarra los glifos a apps de Apple), así que acá no
// hay ninguna fuente: cada glifo es un `<path>` propio dibujado sobre las
// medidas públicas del sistema, que es lo que hace que se lea igual:
//
//   lienzo 24 × 24 · caja del glifo 16 × 16 centrada (de 4 a 20) ·
//   altura de la cap ≈ 14 · grosor del trazo ≈ 13 % de la cap ·
//   empalmes y remates redondos, radios entre 1,8 y 2,2 ·
//   el glifo toca la caja por un solo lado (arriba o abajo), nunca por los dos.
//
// El grosor se expresa como peso, igual que en la fuente: un símbolo de 20 pt en
// peso `regular` lleva 1,9 de trazo, y en `semipesado` 2,4. Se hereda el color
// por `currentColor`, como hace SF Symbols con la tinta de la fila.
import type { PropsWithChildren, SVGProps } from 'react'

export type PesoSimbolo = 'fino' | 'regular' | 'medio' | 'semipesado' | 'pesado'

const TRAZO: Record<PesoSimbolo, number> = {
  fino: 1.4,
  regular: 1.9,
  medio: 2.1,
  semipesado: 2.4,
  pesado: 2.8,
}

export type PropsSimbolo = SVGProps<SVGSVGElement> & {
  tam?: number
  peso?: PesoSimbolo
  /** Los símbolos `.fill` de Apple: superficie llena, sin trazo. */
  lleno?: boolean
}

export function Simbolo({
  children,
  tam = 20,
  peso = 'regular',
  lleno = false,
  ...rest
}: PropsWithChildren<PropsSimbolo>) {
  return (
    <svg
      width={tam}
      height={tam}
      viewBox="0 0 24 24"
      fill={lleno ? 'currentColor' : 'none'}
      stroke={lleno ? 'none' : 'currentColor'}
      strokeWidth={lleno ? undefined : TRAZO[peso]}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

// ---------- Navegación del panel ----------

/** square.grid.2x2 */
export const IconDashboard = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <rect x="3.6" y="3.6" width="7.4" height="7.4" rx="1.9" />
    <rect x="13" y="3.6" width="7.4" height="7.4" rx="1.9" />
    <rect x="13" y="13" width="7.4" height="7.4" rx="1.9" />
    <rect x="3.6" y="13" width="7.4" height="7.4" rx="1.9" />
  </Simbolo>
)

/** person.2 */
export const IconUsers = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <circle cx="9.2" cy="8.2" r="3.5" />
    <path d="M3.5 19.5c0-3.1 2.6-5.1 5.7-5.1s5.7 2 5.7 5.1" />
    <path d="M16.3 5.1a3.4 3.4 0 0 1 0 6.5" />
    <path d="M18 14.9c1.7.7 2.8 2.3 2.8 4.6" />
  </Simbolo>
)

/** person */
export const IconPersona = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <circle cx="12" cy="8" r="3.8" />
    <path d="M4.8 20c0-3.6 3.2-6 7.2-6s7.2 2.4 7.2 6" />
  </Simbolo>
)

/** repeat — la renovación de un período */
export const IconPackage = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M4.4 9.4A7.6 7.6 0 0 1 17.9 6.6L20 8.6" />
    <path d="M20 4.2v4.4h-4.4" />
    <path d="M19.6 14.6A7.6 7.6 0 0 1 6.1 17.4L4 15.4" />
    <path d="M4 19.8v-4.4h4.4" />
  </Simbolo>
)

/** tray.full — la bandeja de pedidos */
export const IconInbox = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M3.4 13.2 6 5.4a1.9 1.9 0 0 1 1.8-1.3h8.4A1.9 1.9 0 0 1 18 5.4l2.6 7.8" />
    <path d="M3.4 13.2h4.3l1.4 2.5h5.8l1.4-2.5h4.3v4.9a1.9 1.9 0 0 1-1.9 1.9H5.3a1.9 1.9 0 0 1-1.9-1.9z" />
  </Simbolo>
)

/** square.stack.3d.up — plataformas apiladas */
export const IconStore = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <rect x="6.6" y="3.6" width="13.8" height="8.2" rx="2.1" />
    <path d="M18.6 15.4a2.1 2.1 0 0 1-2.1 2.1H6.7a2.1 2.1 0 0 1-2.1-2.1V7.9" />
    <path d="M3.6 19.2a2.1 2.1 0 0 1 2.1 1.2h9.7" />
  </Simbolo>
)

/** list.bullet */
export const IconList = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M9.4 6.2h11" />
    <path d="M9.4 12h11" />
    <path d="M9.4 17.8h11" />
    <circle cx="4.6" cy="6.2" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="4.6" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="4.6" cy="17.8" r="1.3" fill="currentColor" stroke="none" />
  </Simbolo>
)

/** server.rack — las cuentas madre */
export const IconServer = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <rect x="3.2" y="3.8" width="17.6" height="6.4" rx="1.9" />
    <rect x="3.2" y="13.8" width="17.6" height="6.4" rx="1.9" />
    <path d="M6.9 7h.01" />
    <path d="M6.9 17h.01" />
    <path d="M10.4 7h6.2" />
    <path d="M10.4 17h6.2" />
  </Simbolo>
)

/** building.2 — proveedores */
export const IconBuilding = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M3.6 20.4V6.2a1.8 1.8 0 0 1 1.8-1.8h5.4a1.8 1.8 0 0 1 1.8 1.8v14.2" />
    <path d="M12.6 10.4h5.2a1.8 1.8 0 0 1 1.8 1.8v8.2" />
    <path d="M2.4 20.4h19.2" />
    <path d="M6.9 8h3.4M6.9 12h3.4M6.9 16h3.4M15.6 14.4h1.6M15.6 17.6h1.6" />
  </Simbolo>
)

/** creditcard */
export const IconCard = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <rect x="2.4" y="5.4" width="19.2" height="13.2" rx="2.4" />
    <path d="M2.4 10.2h19.2" />
    <path d="M6 14.8h3.4" />
  </Simbolo>
)

/** percent */
export const IconPercent = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M18.4 5.6 5.6 18.4" />
    <circle cx="7.6" cy="7.6" r="2.6" />
    <circle cx="16.4" cy="16.4" r="2.6" />
  </Simbolo>
)

/** house */
export const IconCasa = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M3.6 10.8 12 3.8l8.4 7" />
    <path d="M5.6 12.8v6.4a1.6 1.6 0 0 0 1.6 1.6h9.6a1.6 1.6 0 0 0 1.6-1.6v-6.4" />
    <path d="M10 20.4v-5h4v5" />
  </Simbolo>
)

/** cart */
export const IconCart = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M2.8 4.4h2.1l2.5 10.6a1.9 1.9 0 0 0 1.9 1.5h7.9a1.9 1.9 0 0 0 1.8-1.4l1.7-6.7H6.4" />
    <circle cx="9.6" cy="20" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="17.2" cy="20" r="1.3" fill="currentColor" stroke="none" />
  </Simbolo>
)

/** giftcard */
export const IconRegalo = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <rect x="3.4" y="8.6" width="17.2" height="11.8" rx="1.9" />
    <path d="M2.4 5.4h19.2v3.2H2.4z" />
    <path d="M12 5.4v15" />
    <path d="M12 5.4c-1.4-2.6-5.2-2.4-5.2 0 2.6 0 4-.6 5.2 0z" />
    <path d="M12 5.4c1.4-2.6 5.2-2.4 5.2 0-2.6 0-4-.6-5.2 0z" />
  </Simbolo>
)

// ---------- Controles ----------

/** line.3.horizontal */
export const IconMenu = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M3.6 7.2h16.8" />
    <path d="M3.6 12h16.8" />
    <path d="M3.6 16.8h16.8" />
  </Simbolo>
)

/** xmark */
export const IconX = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M6 6l12 12" />
    <path d="M18 6 6 18" />
  </Simbolo>
)

/** xmark.circle.fill — limpiar un campo de búsqueda */
export const IconXcirculo = (p: PropsSimbolo) => (
  <Simbolo {...p} lleno>
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12 2.4a9.6 9.6 0 1 0 0 19.2 9.6 9.6 0 0 0 0-19.2zm3.5 7.3a.9.9 0 0 0-1.3-1.3L12 10.7 9.8 8.4a.9.9 0 1 0-1.3 1.3L10.7 12l-2.2 2.3a.9.9 0 1 0 1.3 1.3L12 13.3l2.2 2.3a.9.9 0 1 0 1.3-1.3L13.3 12z"
    />
  </Simbolo>
)

/** plus */
export const IconPlus = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M12 5.2v13.6" />
    <path d="M5.2 12h13.6" />
  </Simbolo>
)

/** plus.circle */
export const IconPluscirculo = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 8.2v7.6" />
    <path d="M8.2 12h7.6" />
  </Simbolo>
)

/** pencil */
export const IconPencil = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M4.4 19.6l.9-3.4L16.6 5.8a2 2 0 0 1 2.8 0l.9.9a2 2 0 0 1 0 2.8L9.9 19.8l-3.4.9z" />
    <path d="M14.9 7.5l3.7 3.7" />
  </Simbolo>
)

/** trash */
export const IconTrash = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M3.6 6.6h16.8" />
    <path d="M5.8 6.6v12.2a1.9 1.9 0 0 0 1.9 1.9h8.6a1.9 1.9 0 0 0 1.9-1.9V6.6" />
    <path d="M9.4 6.6V4.9a1.5 1.5 0 0 1 1.5-1.5h2.2a1.5 1.5 0 0 1 1.5 1.5v1.7" />
    <path d="M10.3 10.6v6M13.7 10.6v6" />
  </Simbolo>
)

/** checkmark */
export const IconCheck = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M4.8 12.6l4.6 4.6L19.4 7.2" />
  </Simbolo>
)

/** checkmark.circle.fill */
export const IconCheckcirculo = (p: PropsSimbolo) => (
  <Simbolo {...p} lleno>
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12 2.4a9.6 9.6 0 1 0 0 19.2 9.6 9.6 0 0 0 0-19.2zm4.9 7.1a.9.9 0 0 0-1.3-1.3l-4.3 4.3-1.9-1.9a.9.9 0 1 0-1.3 1.3l2.5 2.6a.9.9 0 0 0 1.3 0z"
    />
  </Simbolo>
)

/** magnifyingglass */
export const IconSearch = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <circle cx="10.6" cy="10.6" r="6.6" />
    <path d="M15.4 15.4l4.6 4.6" />
  </Simbolo>
)

/** chevron.forward */
export const IconChevron = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M9.4 5.6l6.4 6.4-6.4 6.4" />
  </Simbolo>
)

/** chevron.down */
export const IconAbajo = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M5.6 9.4l6.4 6.4 6.4-6.4" />
  </Simbolo>
)

/** arrow.clockwise */
export const IconRefresh = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M19.4 12a7.4 7.4 0 1 1-2.2-5.3" />
    <path d="M19.6 3.6v4.4h-4.4" />
  </Simbolo>
)

/** rectangle.portrait.and.arrow.right — salir de la sesión */
export const IconLogout = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M11.4 3.6H6a1.9 1.9 0 0 0-1.9 1.9v13a1.9 1.9 0 0 0 1.9 1.9h5.4" />
    <path d="M15.4 8.2 19.2 12l-3.8 3.8" />
    <path d="M9.6 12h9.6" />
  </Simbolo>
)

/** calendar */
export const IconCalendar = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <rect x="3.4" y="5.4" width="17.2" height="15" rx="2.2" />
    <path d="M8.2 3.4v3.8M15.8 3.4v3.8" />
    <path d="M3.4 10.4h17.2" />
  </Simbolo>
)

/** clock */
export const IconReloj = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 7.4V12l3.4 2.2" />
  </Simbolo>
)

/** infinity — los planes sin vencimiento */
export const IconInfinity = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M12 12c-1.9-2.5-3.7-3.8-5.6-3.8a3.8 3.8 0 1 0 0 7.6c1.9 0 3.7-1.3 5.6-3.8z" />
    <path d="M12 12c1.9 2.5 3.7 3.8 5.6 3.8a3.8 3.8 0 1 0 0-7.6c-1.9 0-3.7 1.3-5.6 3.8z" />
  </Simbolo>
)

/** lock */
export const IconLock = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <rect x="4.2" y="10.6" width="15.6" height="9.8" rx="2.3" />
    <path d="M7.8 10.6V7.6a4.2 4.2 0 0 1 8.4 0v3" />
  </Simbolo>
)

/** eye / eye.slash — mostrar la contraseña */
export const IconOjo = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M2.6 12s3.6-6 9.4-6 9.4 6 9.4 6-3.6 6-9.4 6-9.4-6-9.4-6z" />
    <circle cx="12" cy="12" r="2.8" />
  </Simbolo>
)

export const IconOjoCerrado = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M2.6 12s3.6-6 9.4-6 9.4 6 9.4 6-3.6 6-9.4 6-9.4-6-9.4-6z" />
    <circle cx="12" cy="12" r="2.8" />
    <path d="M4.2 19.8 19.8 4.2" />
  </Simbolo>
)

/** exclamationmark.triangle */
export const IconAlerta = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M10.5 4.4a1.8 1.8 0 0 1 3 0l7.1 12.4a1.8 1.8 0 0 1-1.5 2.7H4.9a1.8 1.8 0 0 1-1.5-2.7z" />
    <path d="M12 9.4v4" />
    <path d="M12 16.4h.01" />
  </Simbolo>
)

/** info.circle */
export const IconInfo = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 11v5.4" />
    <path d="M12 7.8h.01" />
  </Simbolo>
)

/** ellipsis */
export const IconMas = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <circle cx="5.6" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="18.4" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </Simbolo>
)

/** gearshape */
export const IconAjustes = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.8l1.4 2.4a7.6 7.6 0 0 1 2.2 1.3l2.6-.6 1.6 2.8-1.9 1.8a7.6 7.6 0 0 1 0 2.6l1.9 1.8-1.6 2.8-2.6-.6a7.6 7.6 0 0 1-2.2 1.3L12 21.2l-1.4-2.4a7.6 7.6 0 0 1-2.2-1.3l-2.6.6-1.6-2.8 1.9-1.8a7.6 7.6 0 0 1 0-2.6L4.2 9.1l1.6-2.8 2.6.6a7.6 7.6 0 0 1 2.2-1.3z" />
  </Simbolo>
)

/** filter */
export const IconFiltro = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M3.4 5.6h17.2l-6.6 7.8v5.6l-4-2v-3.6z" />
  </Simbolo>
)

/** doc.text */
export const IconDocumento = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M6 3.6h7.4L19 9.2v11.2a1.6 1.6 0 0 1-1.6 1.6H6a1.6 1.6 0 0 1-1.6-1.6V5.2A1.6 1.6 0 0 1 6 3.6z" />
    <path d="M13.4 3.6v5.6H19" />
    <path d="M7.6 13h8M7.6 16.4h5.4" />
  </Simbolo>
)

/** chart.bar — tres barras sobre la línea de base, la última al tope de la cap. */
export const IconGanancias = (p: PropsSimbolo) => (
  <Simbolo {...p}>
    <path d="M6.2 20v-5.2" />
    <path d="M12 20v-9.2" />
    <path d="M17.8 20V6.2" />
  </Simbolo>
)
