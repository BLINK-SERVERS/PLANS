import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchGanancias, fetchResumen } from '../lib/api'
import type { GananciaRow } from '../lib/types'
import { fmtDate, fmtNum, fmtUSD, fmtVES, hoy, round2 } from '../lib/format'
import { errMsg } from '../lib/err'
import { CintaTasa } from '../components/CintaTasa'
import {
  Card,
  EmptyState,
  ErrorMsg,
  Loading,
  PageHeader,
  Segmento,
  StatCard,
  Table,
  Td,
} from '../components/ui'

const DESDE = (mes: string) => (mes === 'todo' ? '0001-01-01' : hoy().slice(0, 7) + '-01')

// Lo que se ganó, calculado sobre los bolívares que entraron.
//
// La regla está en la vista `v_ganancias` (migración 0007) y no se repite acá:
// un cobro en Bs vale `monto ÷ tasa oficial del día de ESE cobro`. El dólar que
// quedó guardado en `equivalente_usd` se muestra al lado, con la diferencia,
// porque el número se escribió a mano al cobrar y una tasa vencida lo deja mal.
export default function Ganancias() {
  const [filas, setFilas] = useState<GananciaRow[]>([])
  const [resumen, setResumen] = useState<Awaited<ReturnType<typeof fetchResumen>> | null>(null)
  const [rango, setRango] = useState<'mes' | 'todo'>('mes')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    try {
      const [g, r] = await Promise.all([fetchGanancias(), fetchResumen()])
      setFilas(g)
      setResumen(r)
      setError('')
      // Arrancar en «este mes» con el mes vacío deja la pantalla sin una sola
      // fila y el dueño no ve nada al abrir. Si el mes no tiene cobros pero el
      // historial sí, se abre el historial: el segmento sigue diciendo qué
      // rango se está mirando.
      const desde = hoy().slice(0, 7) + '-01'
      if (!g.some((x) => x.fecha_pago >= desde) && g.length > 0) setRango('todo')
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const desde = DESDE(rango)
  const visibles = useMemo(() => filas.filter((f) => f.fecha_pago >= desde), [filas, desde])

  const total = useMemo(() => {
    let bs = 0
    let usdDelDia = 0
    let usdGuardado = 0
    let sinTasa = 0
    for (const f of visibles) {
      bs += f.bs_recibidos ?? 0
      if (f.usd_del_dia == null) sinTasa += 1
      usdDelDia += f.usd_del_dia ?? f.usd_registrado
      usdGuardado += f.usd_registrado
    }
    return {
      bs: round2(bs),
      usdDelDia: round2(usdDelDia),
      usdGuardado: round2(usdGuardado),
      diferencia: round2(usdGuardado - usdDelDia),
      sinTasa,
    }
  }, [visibles])

  if (cargando) return <Loading />
  if (error) return <ErrorMsg message={error} />

  const ganancia =
    rango === 'mes'
      ? {
          ingreso: resumen?.ingresosMesUSD ?? 0,
          ganancia: resumen?.gananciaMesUSD ?? 0,
          egreso: resumen?.egresosMesUSD ?? 0,
        }
      : {
          ingreso: resumen?.ingresosTotalesUSD ?? 0,
          ganancia: resumen?.gananciaTotalUSD ?? 0,
          egreso: resumen?.egresosTotalesUSD ?? 0,
        }
  const margen = ganancia.ingreso > 0 ? Math.round((ganancia.ganancia / ganancia.ingreso) * 100) : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ganancias"
        subtitle="Cobros en Bs convertidos a la tasa BCV oficial del día de cada pago"
      />

      <CintaTasa onActualizada={() => void cargar()} />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          label={rango === 'mes' ? 'Ingresos del mes' : 'Ingresos (todo)'}
          value={fmtUSD(total.usdDelDia)}
          hint={total.bs > 0 ? `${fmtVES(total.bs)} recibidos` : 'Sin cobros en Bs'}
        />
        <StatCard
          label={rango === 'mes' ? 'Ganancia del mes' : 'Ganancia (todo)'}
          value={fmtUSD(ganancia.ganancia)}
          hint={
            margen == null
              ? 'Sin ingresos en el rango'
              : `${margen}% sobre lo cobrado · egresos ${fmtUSD(ganancia.egreso)}`
          }
        />
        <StatCard
          label="Comisiones pendientes"
          value={fmtUSD(resumen?.comisionesPendientesUSD ?? 0)}
          hint="30% del USD de cada cobro referido"
        />
        <StatCard
          label="Diferencia vs lo guardado"
          value={fmtUSD(total.diferencia)}
          hint={
            total.diferencia === 0
              ? 'El dólar registrado coincide con el Bs recalculado'
              : `${total.sinTasa > 0 ? `${total.sinTasa} cobro(s) sin tasa · ` : ''}lo guardado − lo que dice el Bs`
          }
        />
      </div>

      <Card title="Cobros">
        <div className="mb-3">
          <Segmento
            valor={rango}
            onChange={setRango}
            opciones={[
              { id: 'mes', label: 'Este mes' },
              { id: 'todo', label: 'Todo el historial' },
            ]}
          />
        </div>
        {visibles.length === 0 ? (
          <EmptyState
            message={
              rango === 'mes'
                ? 'Todavía no hay cobros registrados este mes.'
                : 'No hay cobros registrados.'
            }
          />
        ) : (
          <>
            <Table
              headers={[
                'Fecha',
                'Cliente',
                'Recibido',
                'Tasa del día',
                'USD al tasa del día',
                'USD guardado',
                'Diferencia',
              ]}
            >
              {visibles.map((f) => (
                <tr key={f.pago_id}>
                  <Td>{fmtDate(f.fecha_pago)}</Td>
                  <Td className="font-medium">{f.cliente ?? '—'}</Td>
                  <Td className="font-mono text-nota">
                    {f.bs_recibidos != null
                      ? fmtVES(f.bs_recibidos)
                      : `${fmtNum(f.monto_recibido)} ${f.moneda}`}
                  </Td>
                  <Td className="font-mono text-nota">
                    {f.tasa_del_dia != null ? fmtNum(f.tasa_del_dia, 4) : '—'}
                    {f.tasa_del_dia != null && f.tasa_rescatada_de_tabla ? (
                      <span className="ml-1 text-legenda-2 text-ink-tertiary">tabla</span>
                    ) : null}
                  </Td>
                  <Td className="font-semibold">
                    {f.usd_del_dia != null ? fmtUSD(f.usd_del_dia) : 'sin tasa'}
                  </Td>
                  <Td className="text-ink-secondary">{fmtUSD(f.usd_registrado)}</Td>
                  <Td
                    className={
                      f.diferencia_usd != null && Math.abs(f.diferencia_usd) >= 0.01
                        ? 'font-semibold text-[#9a5b00]'
                        : 'text-ink-tertiary'
                    }
                  >
                    {f.diferencia_usd != null && Math.abs(f.diferencia_usd) >= 0.01
                      ? `${f.diferencia_usd > 0 ? '+' : ''}${fmtUSD(f.diferencia_usd)}`
                      : '—'}
                  </Td>
                </tr>
              ))}
            </Table>
            <p className="mt-3 text-nota leading-[18px] text-ink-secondary">
              La tasa usada es la que se guardó con el cobro; solo si el pago se registró sin ella se
              busca en <span className="font-mono text-legenda">tasas_cambio</span> la fila de esa
              fecha. Un cobro en USDT o en USD entra 1:1 y no depende del BCV. La ganancia del mes
              resta los egresos registrados; si la tabla de egresos está vacía, la ganancia sale igual
              al ingreso y ese número no es un margen real.
            </p>
          </>
        )}
      </Card>
    </div>
  )
}
