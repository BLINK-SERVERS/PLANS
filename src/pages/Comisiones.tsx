import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchComisiones, liquidarComision } from '../lib/api'
import type { ComisionRow } from '../lib/types'
import { fmtDate, fmtNum, fmtUSD, fmtVES } from '../lib/format'
import { errMsg } from '../lib/err'
import { CintaTasa } from '../components/CintaTasa'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorMsg,
  Loading,
  PageHeader,
  Select,
  StatCard,
  Table,
  Td,
  useConfirmar,
} from '../components/ui'

const n = (v: unknown): number => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

// El cobro del que salió la comisión, con la tasa oficial de su día: la comisión
// es un porcentaje de un dólar que llegó como bolívares, y al agente se le paga
// en bolívares. Sin el cobro detrás, el 30 % no se puede auditar.
interface FilaComision extends ComisionRow {
  bsDelCobro: number | null
  tasa: number | null
  bsDeLaComision: number | null
}

const conBolivares = (c: ComisionRow): FilaComision => {
  const cobro = c.pagos_ingresos
  const monto = cobro?.monto_pagado != null ? n(cobro.monto_pagado) : null
  const tasa = cobro?.tasa_bcv_aplicada != null ? n(cobro.tasa_bcv_aplicada) : null
  const bs = cobro?.moneda === 'BS' ? monto : null
  return {
    ...c,
    bsDelCobro: bs,
    tasa,
    bsDeLaComision: bs != null && tasa ? Math.round(n(c.monto_comision_usd) * tasa * 100) / 100 : null,
  }
}

export default function Comisiones() {
  const [comisiones, setComisiones] = useState<ComisionRow[]>([])
  const [filtro, setFiltro] = useState<'todas' | 'pendiente' | 'liquidada'>('todas')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    try {
      setComisiones(await fetchComisiones())
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

  const filas = useMemo(() => comisiones.map(conBolivares), [comisiones])

  const filtradas = useMemo(
    () => (filtro === 'todas' ? filas : filas.filter((c) => c.estado === filtro)),
    [filas, filtro],
  )

  const { confirmar } = useConfirmar()

  const liquidar = async (id: string) => {
    if (!(await confirmar('¿Marcar esta comisión como liquidada?', { boton: 'Liquidar' }))) return
    try {
      await liquidarComision(id)
      await cargar()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const resumen = useMemo(() => {
    let pendiente = 0
    let liquidada = 0
    let pendienteBs = 0
    for (const c of filas) {
      if (c.estado === 'pendiente') {
        pendiente += n(c.monto_comision_usd)
        pendienteBs += c.bsDeLaComision ?? 0
      } else liquidada += n(c.monto_comision_usd)
    }
    return { pendiente, liquidada, pendienteBs }
  }, [filas])

  if (cargando) return <Loading />
  if (error) return <ErrorMsg message={error} />

  return (
    <div className="space-y-6">
      <PageHeader
        title="Comisiones de referidos"
        subtitle="30% del dólar que entró, calculado sobre los Bs recibidos a la tasa del día"
      />

      <CintaTasa onActualizada={() => void cargar()} />

      <div className="grid grid-cols-2 gap-4 xl:w-2/3">
        <StatCard
          label="Pendientes"
          value={fmtUSD(resumen.pendiente)}
          hint={resumen.pendienteBs > 0 ? `${fmtVES(resumen.pendienteBs)} a pagar` : undefined}
        />
        <StatCard label="Liquidadas" value={fmtUSD(resumen.liquidada)} />
      </div>

      <Card title="Historial">
        {comisiones.length === 0 ? (
          <EmptyState
            message={
              'Todavía no hay comisiones generadas. El disparo que las crea solo actúa sobre las plataformas marcadas con «aplica comisión», y hoy esa marca la tienen Google One y Google One 5 TB, que están fuera de venta. Marcar Canva o Spotify en la pantalla de plataformas es lo que enciende este libro.'
            }
          />
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-legenda font-semibold uppercase tracking-wide text-ink-secondary">
                Filtrar
              </span>
              <Select
                className="w-48"
                value={filtro}
                onChange={(e) => setFiltro(e.target.value as typeof filtro)}
              >
                <option value="todas">Todas</option>
                <option value="pendiente">Pendientes</option>
                <option value="liquidada">Liquidadas</option>
              </Select>
            </div>
            <Table
              headers={[
                'Agente',
                'Cobro',
                'Recibido',
                'Tasa del día',
                'Comisión USD',
                'Comisión Bs',
                'Estado',
                'Acciones',
              ]}
            >
              {filtradas.map((c) => (
                <tr key={c.id}>
                  <Td className="font-medium">{c.usuarios?.nombre ?? '—'}</Td>
                  <Td className="text-ink-secondary">
                    {fmtDate(String(c.pagos_ingresos?.fecha_pago ?? c.created_at))}
                  </Td>
                  <Td className="font-mono text-nota">
                    {c.bsDelCobro != null ? fmtVES(c.bsDelCobro) : '—'}
                  </Td>
                  <Td className="font-mono text-nota">
                    {c.tasa != null ? fmtNum(c.tasa, 4) : '—'}
                  </Td>
                  <Td className="font-semibold">{fmtUSD(c.monto_comision_usd)}</Td>
                  <Td className="font-semibold">
                    {c.bsDeLaComision != null ? fmtVES(c.bsDeLaComision) : '—'}
                  </Td>
                  <Td>
                    <Badge value={c.estado} />
                  </Td>
                  <Td>
                    {c.estado === 'pendiente' ? (
                      <Button variant="secondary" onClick={() => void liquidar(c.id)}>
                        Liquidar
                      </Button>
                    ) : (
                      <span className="text-nota text-ink-secondary">—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
            <p className="mt-3 text-nota leading-[18px] text-ink-secondary">
              «Comisión Bs» es el dólar de la comisión multiplicado por la tasa BCV del día en que se
              cobró: es con el número que se le paga al agente. El monto en USD lo produce el disparo
              <span className="font-mono text-legenda"> registrar_comision_por_referido() </span>
              sobre el dólar asignado a la suscripción.
            </p>
          </>
        )}
      </Card>
    </div>
  )
}
