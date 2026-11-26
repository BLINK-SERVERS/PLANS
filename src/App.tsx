import { lazy, Suspense } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import Layout from './components/Layout'
import { IconLock } from './components/icons'
import { CarritoProvider } from './components/tienda/CarritoProvider'

// Carga perezosa: cada página se compila al visitarse (app inicial más rápida)
const Inicio = lazy(() => import('./pages/Inicio'))
const Login = lazy(() => import('./pages/Login'))
const TiendaPlataforma = lazy(() => import('./pages/TiendaPlataforma'))
const Carrito = lazy(() => import('./pages/Carrito'))
const Checkout = lazy(() => import('./pages/Checkout'))
const Registro = lazy(() => import('./pages/Registro'))
const Ingreso = lazy(() => import('./pages/Ingreso'))
const Renovar = lazy(() => import('./pages/Renovar'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Clientes = lazy(() => import('./pages/Clientes'))
const Suscripciones = lazy(() => import('./pages/Suscripciones'))
const Plataformas = lazy(() => import('./pages/Plataformas'))
const CuentasMadre = lazy(() => import('./pages/CuentasMadre'))
const Proveedores = lazy(() => import('./pages/Proveedores'))
const Pagos = lazy(() => import('./pages/Pagos'))
const Comisiones = lazy(() => import('./pages/Comisiones'))
const Ganancias = lazy(() => import('./pages/Ganancias'))
const Planes = lazy(() => import('./pages/Planes'))
const Pedidos = lazy(() => import('./pages/Pedidos'))

// Guard: sin sesión activa nadie llega al panel. El RLS de la base ya decide
// qué puede ver cada rol; esto solo evita que un anónimo vea la interfaz del
// panel y crea que está dentro. Los clientes (rol 'cliente') vuelven a la
// landing, que es donde renewan.
function Protegida() {
  const { session, cargando, rol, rolCargando } = useAuth()
  if (cargando || (session && rolCargando))
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-blink-ink-mute">
        Verificando sesión…
      </div>
    )
  if (!session) return <Navigate to="/login" replace />
  if (rol !== 'admin') return <Navigate to="/" replace />
  return <Layout />
}

// El panel se mudó de la raíz a /panel, pero los enlaces guardados del sitio
// viejo siguen vivos: la redirección de go-plans.github.io conserva el hash,
// así que alguien que tenía #/suscripciones llega a #/suscripciones. Cada una
// de estas rutas manda a su equivalente nuevo en vez de caer en la landing.
const RUTAS_PANEL = [
  'clientes',
  'suscripciones',
  'plataformas',
  'planes',
  'pedidos',
  'cuentas-madre',
  'proveedores',
  'pagos',
  'comisiones',
  'ganancias',
] as const

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Suspense
          fallback={
            <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-blink-ink-mute">
              <IconLock className="h-4 w-4 animate-pulse" /> Cargando…
            </div>
          }
        >
          <CarritoProvider>
            <Routes>
              {/* Público: la puerta del sitio es la landing de venta */}
              <Route index element={<Inicio />} />
              <Route path="tienda" element={<Navigate to="/" replace />} />
              <Route path="tienda/:slug" element={<TiendaPlataforma />} />
              <Route path="carrito" element={<Carrito />} />
              <Route path="checkout" element={<Checkout />} />
              <Route path="registro" element={<Registro />} />
              <Route path="ingreso" element={<Ingreso />} />
              <Route path="renovar" element={<Renovar />} />
              <Route path="login" element={<Login />} />

              {/* Panel de administración */}
              <Route path="panel" element={<Protegida />}>
                <Route index element={<Dashboard />} />
                <Route path="clientes" element={<Clientes />} />
                <Route path="suscripciones" element={<Suscripciones />} />
                <Route path="plataformas" element={<Plataformas />} />
                <Route path="planes" element={<Planes />} />
                <Route path="pedidos" element={<Pedidos />} />
                <Route path="cuentas-madre" element={<CuentasMadre />} />
                <Route path="proveedores" element={<Proveedores />} />
                <Route path="pagos" element={<Pagos />} />
                <Route path="comisiones" element={<Comisiones />} />
                <Route path="ganancias" element={<Ganancias />} />
                <Route path="*" element={<Navigate to="/panel" replace />} />
              </Route>

              {RUTAS_PANEL.map((r) => (
                <Route key={r} path={r} element={<Navigate to={`/panel/${r}`} replace />} />
              ))}

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </CarritoProvider>
        </Suspense>
      </HashRouter>
    </AuthProvider>
  )
}
