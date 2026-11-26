import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useMemo, useState, type ComponentType } from 'react'
import { useAuth } from '../lib/auth'
import { MarcaBlink } from './marca-blink'
import { Modal, ProveedorConfirmar } from './ui'
import {
  IconBuilding,
  IconCard,
  IconCasa,
  IconDashboard,
  IconInbox,
  IconList,
  IconLogout,
  IconMas,
  IconPackage,
  IconPercent,
  IconPersona,
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
      { to: '/panel/pagos', label: 'Pagos', icono: IconCard, tono: 'var(--color-sys-pink)' },
      { to: '/panel/comisiones', label: 'Comisiones', icono: IconPercent, tono: 'var(--color-sys-mint)' },
    ],
  },
]

const TODOS = SECCIONES.flatMap((s) => s.items)
const ACTIVIDAD = (to: string) => to === '/panel'

function Marca({ tam = 26 }: { tam?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="grid place-items-center rounded-loseta bg-sys-blue text-white"
        style={{ width: tam + 8, height: tam + 8 }}
      >
        <MarcaBlink className="h-[15px] w-[19px]" />
      </span>
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
        `flex min-h-11 items-center gap-2.5 rounded-[10px] px-2.5 text-subheadline font-medium transition-colors ${
          isActive
            ? 'bg-[rgba(0,122,255,0.12)] text-[#0062cc]'
            : 'text-ink-label hover:bg-ink-fill-4'
        }`
      }
    >
      <span
        className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[6px] text-white"
        style={{ background: item.tono }}
      >
        <Icono tam={14} peso="semipesado" />
      </span>
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

  // Los cinco destinos que viven en la barra inferior; el resto va a la hoja.
  const pestanas = TODOS.filter((d) =>
    ['/panel', '/panel/clientes', '/panel/pedidos', '/panel/pagos', '/panel/suscripciones'].includes(
      d.to,
    ),
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
    <div className="min-h-screen xl:flex">
      {/* Sidebar — escritorio */}
      <aside className="material material-border sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col border-r border-ink-separator/60 xl:flex">
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
          <button
            onClick={() => void salir()}
            className="flex min-h-11 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-subheadline font-medium text-sys-red transition-colors hover:bg-[rgba(255,59,48,0.1)]"
          >
            <IconLogout tam={15} peso="medio" />
            <span className="truncate">{session?.user?.email ?? 'Cerrar sesión'}</span>
          </button>
        </div>
      </aside>

      {/* Barra superior — teléfono y tablet */}
      <header className="material material-border sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-ink-separator/60 px-3 py-1 xl:hidden pt-safe">
        <NavLink
          to="/"
          className="flex min-h-11 items-center gap-2 text-ink-secondary transition-opacity active:opacity-60"
        >
          <span className="grid h-7 w-7 place-items-center rounded-loseta bg-sys-blue text-white">
            <MarcaBlink className="h-3 w-[15px]" />
          </span>
          <span className="text-subheadline font-medium">Plans</span>
        </NavLink>
        <p className="min-w-0 flex-1 truncate text-center text-headline font-semibold text-ink-label">
          {titulo}
        </p>
        <button
          onClick={() => setMas(true)}
          aria-label="Más secciones"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink-fill-3 text-ink-label transition-opacity active:opacity-70"
        >
          <IconMas tam={18} peso="pesado" />
        </button>
      </header>

      {/* Contenido */}
      <main className="min-w-0 flex-1 px-4 pb-24 pt-4 xl:px-7 xl:pb-10 xl:pt-7">
        <Outlet />
      </main>

      {/* Barra de pestañas — teléfono y tablet */}
      <nav className="material fixed inset-x-0 bottom-0 z-30 flex border-t border-ink-separator/60 pb-safe xl:hidden">
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
                className="flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium"
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
                className="flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium"
              >
                {({ isActive }) => (
                  <>
                    <Icono tam={21} peso={isActive ? 'semipesado' : 'regular'} />
                    <span className={isActive ? 'text-sys-blue' : 'text-ink-secondary'}>{destino.label}</span>
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
              className="flex min-h-11 items-center gap-2.5 rounded-[10px] px-2.5 text-subheadline font-medium text-ink-label hover:bg-ink-fill-4"
            >
              <span
                className="grid h-[22px] w-[22px] place-items-center rounded-[6px] text-white"
                style={{ background: 'var(--color-sys-teal)' }}
              >
                <IconCasa tam={14} peso="semipesado" />
              </span>
              Ver la tienda pública
            </NavLink>
            <button
              onClick={salirTodo}
              className="flex min-h-11 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-subheadline font-medium text-sys-red hover:bg-[rgba(255,59,48,0.1)]"
            >
              <IconLogout tam={15} peso="medio" />
              Cerrar la sesión
            </button>
          </div>
        </div>
      </Modal>

      {/* Persona con sesión abierta pero sin destino de panel */}
      <IconPersona tam={0} className="hidden" />
    </div>
    </ProveedorConfirmar>
  )
}
