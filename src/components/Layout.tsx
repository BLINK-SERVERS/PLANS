import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useMemo, useState, type ComponentType } from 'react'
import { useAuth } from '../lib/auth'
import { MarcaBlink } from './marca-blink'
import { Button, Loseta, Modal, ProveedorConfirmar } from './ui'
import {
  IconBuilding,
  IconCard,
  IconCasa,
  IconDashboard,
  IconGanancias,
  IconInbox,
  IconList,
  IconLogout,
  IconMas,
  IconPackage,
  IconPercent,
  IconServer,
  IconStore,
  IconUsers,
  type PropsSimbolo,
} from './icons'

/* La barra del panel, armada como la lista lateral de Ajustes de iOS: columnas
   translúcidas, loseta de color de sistema por destino, agrupación con etiqueta
   en gris secundario y hairline en vez de cajas. En el teléfono eso no cabe,
   así que la navegación baja a una barra de pestañas de cinco destinos y lo
   demás se abre en una hoja. */

interface Destino {
  to: string
  label: string
  icono: ComponentType<PropsSimbolo>
  tono: string
  end?: boolean
}

const SECCIONES: Array<{ titulo: string; items: Destino[] }> = [
  {
    titulo: 'Operación',
    items: [
      { to: '/panel', label: 'Dashboard', icono: IconDashboard, tono: 'var(--color-sys-blue)', end: true },
      { to: '/panel/clientes', label: 'Clientes', icono: IconUsers, tono: 'var(--color-sys-green)' },
      { to: '/panel/suscripciones', label: 'Suscripciones', icono: IconPackage, tono: 'var(--color-sys-indigo)' },
      { to: '/panel/pedidos', label: 'Pedidos', icono: IconInbox, tono: 'var(--color-sys-orange)' },
    ],
  },
  {
    titulo: 'Catálogo',
    items: [
      { to: '/panel/plataformas', label: 'Plataformas', icono: IconStore, tono: 'var(--color-sys-teal)' },
      { to: '/panel/planes', label: 'Planes', icono: IconList, tono: 'var(--color-sys-purple)' },
      { to: '/panel/cuentas-madre', label: 'Cuentas madre', icono: IconServer, tono: 'var(--color-sys-gray)' },
      { to: '/panel/proveedores', label: 'Proveedores', icono: IconBuilding, tono: 'var(--color-sys-brown)' },
    ],
  },
  {
    titulo: 'Dinero',
    items: [
      { to: '/panel/ganancias', label: 'Ganancias', icono: IconGanancias, tono: 'var(--color-sys-green)' },
      { to: '/panel/pagos', label: 'Pagos', icono: IconCard, tono: 'var(--color-sys-pink)' },
      { to: '/panel/comisiones', label: 'Comisiones', icono: IconPercent, tono: 'var(--color-sys-mint)' },
    ],
  },
]

const TODOS = SECCIONES.flatMap((s) => s.items)
const ACTIVIDAD = (to: string) => to === '/panel'

function Marca() {
  return (
    <div className="flex items-center gap-2.5">
      <Loseta tam={34} className="text-white">
        <MarcaBlink className="h-[15px] w-[19px]" />
      </Loseta>
      <div className="leading-tight">
        <p className="text-headline font-semibold text-ink-label">Blink Plans</p>
        <p className="text-legenda-2 text-ink-secondary">Gestión de suscripciones</p>
      </div>
    </div>
  )
}

function FilaNav({ item, onClick }: { item: Destino; onClick?: () => void }) {
  const Icono = item.icono
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onClick}
      className={({ isActive }) =>
        `flex h-[var(--control-normal)] items-center gap-2.5 rounded-[10px] px-2.5 text-subheadline font-medium transition-colors ${
          isActive
            ? 'bg-velo-blue text-blink-action-text'
            : 'text-ink-label hover:bg-ink-fill-4'
        }`
      }
    >
      <Loseta tam={22} tono={item.tono}>
        <Icono tam={14} peso="semipesado" />
      </Loseta>
      <span className="truncate">{item.label}</span>
    </NavLink>
  )
}

export default function Layout() {
  const { session, salir } = useAuth()
  const location = useLocation()
  const [mas, setMas] = useState(false)

  const titulo = useMemo(() => {
    const exacto = TODOS.find((d) => d.to === location.pathname)
    if (exacto) return exacto.label
    const largo = [...TODOS]
      .sort((a, b) => b.to.length - a.to.length)
      .find((d) => location.pathname.startsWith(d.to + '/'))
    return largo?.label ?? 'Panel'
  }, [location.pathname])

  // Los destinos que viven en la barra inferior; el resto va a la hoja. Son
  // cinco porque a 390 px seis etiquetas de una palabra se montan entre sí
  // ("Suscripciones" mide ~77 px y el hueco de seis deja 65). Pagos se va a
  // «Más» con el resto del dinero: la tinta del ícono sigue marcando la ruta.
  const pestanas = TODOS.filter((d) =>
    ['/panel', '/panel/clientes', '/panel/pedidos', '/panel/suscripciones'].includes(d.to),
  ).sort((a, b) => TODOS.indexOf(a) - TODOS.indexOf(b))
  const resto = TODOS.filter((d) => !pestanas.includes(d))
  const enPestana = pestanas.some((d) => (ACTIVIDAD(d.to) ? d.to === location.pathname : location.pathname.startsWith(d.to)))

  const salirTodo = () => {
    setMas(false)
    void salir()
  }

  return (
    <ProveedorConfirmar>
    {/* El corte está en `xl`, no en `md`: con el sidebar de 264 px, por debajo de
        1280 quedan menos de 960 px de contenido y las tablas desbordaban su caja.
        Abajo de ese ancho mandan la barra superior y las pestañas, y cada tabla se
        apila como lista (`.tabla-ficha` en index.css usa el mismo corte). */}
    <div className="panel min-h-screen xl:flex">
      {/* Sidebar — escritorio */}
      <aside className="vidrio-barra material-border sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col border-r border-ink-separator/60 xl:flex">
        <div className="px-4 pb-3 pt-5">
          <Marca />
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-2.5 pb-4">
          {SECCIONES.map((seccion) => (
            <div key={seccion.titulo}>
              <p className="mb-1 px-2.5 text-legenda font-semibold uppercase tracking-[0.03em] text-ink-secondary">
                {seccion.titulo}
              </p>
              <div className="space-y-0.5">
                {seccion.items.map((item) => (
                  <FilaNav key={item.to} item={item} />
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-ink-separator/60 p-2.5">
          {/* La cuenta no es una acción destructiva: el correo va en tinta
              secundaria y lo rojo queda solo para «Cerrar la sesión». Además
              `sys-red` (#FF3B30) sobre blanco da 3,03:1 y no pasa AA a 13 px;
              la tinta medida del peligro es `tinta-danger`. */}
          <p className="truncate px-2.5 pb-1.5 pt-1 text-legenda text-ink-secondary">
            {session?.user?.email ?? ''}
          </p>
          <button
            onClick={() => void salir()}
            className="flex h-[var(--control-compacto)] w-full items-center gap-2.5 rounded-[10px] px-2.5 text-nota font-semibold text-tinta-danger transition-colors hover:bg-velo-danger"
          >
            <IconLogout tam={15} peso="medio" />
            Cerrar la sesión
          </button>
        </div>
      </aside>

      {/* Barra superior — teléfono y tablet */}
      <header className="vidrio-barra material-border sticky top-0 z-30 flex h-[var(--control-normal)] items-center justify-between gap-3 border-b border-ink-separator/60 px-3 xl:hidden pt-safe">
        <NavLink
          to="/"
          className="flex h-[var(--control-normal)] items-center gap-2 text-ink-secondary transition-opacity active:opacity-60"
        >
          <Loseta tam={24} className="text-white">
            <MarcaBlink className="h-3 w-[15px]" />
          </Loseta>
          <span className="text-subheadline font-medium">Plans</span>
        </NavLink>
        <p className="min-w-0 flex-1 truncate text-center text-headline font-semibold text-ink-label">
          {titulo}
        </p>
        <Button variant="secondary" soloIcono aria-label="Más secciones" onClick={() => setMas(true)}>
          <IconMas tam={18} peso="pesado" />
        </Button>
      </header>

      {/* Contenido */}
      <main className="min-w-0 flex-1 px-4 pb-24 pt-4 xl:px-7 xl:pb-10 xl:pt-7">
        <Outlet />
      </main>

      {/* Barra de pestañas — teléfono y tablet. La etiqueta va a 10 px porque
          ese es el caption de la tab bar de iOS: a 11 px «Suscripciones» no
          cabía en los 78 px del quinto y se cortaba con puntos suspensivos. */}
      <nav className="vidrio-barra fixed inset-x-0 bottom-0 z-30 flex border-t border-ink-separator/60 pb-safe xl:hidden">
        {[...pestanas, { to: '', label: 'Más', icono: IconMas, tono: 'var(--color-sys-gray)' } as Destino].map(
          (destino) => {
            const esMas = destino.to === ''
            const Icono = destino.icono
            const activo = esMas ? !enPestana && mas : ACTIVIDAD(destino.to) ? destino.to === location.pathname : location.pathname.startsWith(destino.to)
            return esMas ? (
              <button
                key="mas"
                onClick={() => setMas(true)}
                aria-current={activo ? 'page' : undefined}
                className="flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] leading-[12px] font-medium"
                style={{ color: activo ? '#007aff' : 'rgba(60,60,67,0.6)' }}
              >
                <Icono tam={21} peso={activo ? 'semipesado' : 'regular'} />
                Más
              </button>
            ) : (
              <NavLink
                key={destino.to}
                to={destino.to}
                end={destino.end}
                className="flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] leading-[12px] font-medium"
              >
                {({ isActive }) => (
                  <>
                    <Icono tam={21} peso={isActive ? 'semipesado' : 'regular'} />
                    <span
                      className={`max-w-full truncate px-0.5 ${isActive ? 'text-sys-blue' : 'text-ink-secondary'}`}
                    >
                      {destino.label}
                    </span>
                  </>
                )}
              </NavLink>
            )
          },
        )}
      </nav>

      {/* Hoja «Más» — el resto del panel desde el teléfono */}
      <Modal open={mas} title="Más secciones" onClose={() => setMas(false)}>
        <div className="space-y-1.5">
          {!enPestana ? (
            <p className="mb-1 text-nota text-ink-secondary">Estás en {titulo}.</p>
          ) : null}
          {resto.map((item) => (
            <FilaNav key={item.to} item={item} onClick={() => setMas(false)} />
          ))}
          <div className="mt-3 border-t border-ink-separator/60 pt-3">
            <NavLink
              to="/"
              onClick={() => setMas(false)}
              className="flex h-[var(--control-normal)] items-center gap-2.5 rounded-[10px] px-2.5 text-subheadline font-medium text-ink-label hover:bg-ink-fill-4"
            >
              <Loseta tam={22} tono="var(--color-sys-teal)">
                <IconCasa tam={14} peso="semipesado" />
              </Loseta>
              Ver la tienda pública
            </NavLink>
            <button
              onClick={salirTodo}
              className="flex h-[var(--control-normal)] w-full items-center gap-2.5 rounded-[10px] px-2.5 text-subheadline font-medium text-tinta-danger hover:bg-velo-danger"
            >
              <IconLogout tam={15} peso="medio" />
              Cerrar la sesión
            </button>
          </div>
        </div>
      </Modal>
    </div>
    </ProveedorConfirmar>
  )
}
