import { useCallback, useEffect, useState } from 'react'
import {
  fetchResumen,
  fetchVencimientosProveedores,
} from '../lib/api'
import { fmtDate, fmtUSD, fmtVES } from '../lib/format'
import { errMsg } from '../lib/err'
import { CintaTasa } from '../components/CintaTasa'
import type { VencimientoProveedor } from '../lib/types'
import {
  Chip,
  EmptyState,
  ErrorMsg,
  Loading,
  PageHeader,
  Pagina,
  StatCard,
  Table,
  Td,
} from '../components/ui'

export default function Dashboard() {
  const [resumen, setResumen] = useState<Awaited<ReturnType<typeof fetchResumen>> | null>(null)
  const [vencimientos, setVencimientos] = useState<VencimientoProveedor[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    try {
      const [r, v] = await Promise.all([fetchResumen(), fetchVencimientosProveedores()])
      setResumen(r)
      setVencimientos(v)
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

  if (cargando) return <Loading />
  if (error) return <ErrorMsg message={error} />

  return (
    <Pagina>
      <PageHeader title="Dashboard" />

      <CintaTasa onActualizada={() => void cargar()} />

      {resumen ? (
        <div className="grid grid-cols-2 gap-5 xl:grid-cols-3">
          <StatCard label="Clientes" value={resumen.clientes} />
          <StatCard
            label="Suscripciones activas"
            value={resumen.suscripcionesActivas}
          />
          <StatCard
            label="Suscripciones vencidas"
            value={resumen.suscripcionesVencidas}
            tono="var(--color-sys-orange)"
            hint={resumen.suscripcionesVencidas > 0 ? 'Cobros pendientes por revisar' : undefined}
          />
          <StatCard
            label="Ingresos del mes"
            value={fmtUSD(resumen.ingresosMesUSD)}
            tono="var(--color-sys-green)"
            hint={resumen.bsMes > 0 ? `${fmtVES(resumen.bsMes)} cobrados` : 'Sin cobros en Bs'}
          />
          <StatCard
            label="Ganancia del mes"
            value={fmtUSD(resumen.gananciaMesUSD)}
            tono="var(--color-sys-teal)"
            hint={
              resumen.egresosMesUSD > 0
                ? `Egresos ${fmtUSD(resumen.egresosMesUSD)} registrados`
                : 'Sin egresos registrados: aún no es un margen real'
            }
          />
          <StatCard
            label="Comisiones pendientes"
            value={fmtUSD(resumen.comisionesPendientesUSD)}
            tono="var(--color-sys-purple)"
            hint="30% del USD de cada cobro referido"
          />
        </div>
      ) : (
        <Loading />
      )}

      {vencimientos.length === 0 ? (
        <EmptyState message="Ninguna cuenta madre vence en los próximos 3 días." />
      ) : (
        <Table
          titulo="Vencimientos de proveedores · próximos 3 días"
          headers={['Proveedor', 'Plataforma', 'Cuenta', 'Cupos', 'Costo', 'Fecha corte', 'Estado']}
        >
          {vencimientos.map((v) => (
            <tr key={v.id}>
              <Td className="font-medium">{v.proveedor}</Td>
              <Td>{v.plataforma}</Td>
              <Td className="font-mono text-nota">{v.correo_cuenta}</Td>
              <Td num>
                {v.cupos_ocupados}/{v.cupos_totales}
              </Td>
              <Td num>{fmtUSD(v.costo_renovacion_usd)}</Td>
              <Td>{fmtDate(v.fecha_corte_proveedor)}</Td>
              <Td>
                <Chip
                  className={
                    v.dias_restantes < 0
                      ? 'bg-velo-danger text-tinta-danger'
                      : v.dias_restantes <= 1
                        ? 'bg-velo-aviso text-tinta-aviso'
                        : 'bg-velo-info text-tinta-info'
                  }
                >
                  {v.dias_restantes < 0
                    ? `vencida ${Math.abs(v.dias_restantes)} d`
                    : v.dias_restantes === 0
                      ? 'vence hoy'
                      : `en ${v.dias_restantes} d`}
                </Chip>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Pagina>
  )
}