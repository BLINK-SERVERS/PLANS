import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchComisiones, liquidarComision } from '../lib/api'
import type { ComisionRow } from '../lib/types'
import { fmtDate, fmtNum, fmtUSD, fmtVES } from '../lib/format'
import { errMsg } from '../lib/err'
import { CintaTasa } from '../components/CintaTasa'
import {
  Badge,
  Button,
  EmptyState,
  ErrorMsg,
  Loading,
  PageHeader,
  Pagina,
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
    <Pagina>
      <PageHeader
        title="Comisiones de referidos"
        subtitle="30% del dólar que entró, calculado sobre los Bs recibidos a la tasa del día"
      />

      <CintaTasa onActualizada={() => void cargar()} />

      <div className="grid grid-cols-2 gap-5">
        <StatCard
          label="Pendientes"
          value={fmtUSD(resumen.pendiente)}
          tono="var(--color-sys-orange)"
          hint={resumen.pendienteBs > 0 ? `${fmtVES(resumen.pendienteBs)} a pagar` : undefined}
        />
        <StatCard
          label="Liquidadas"
          value={fmtUSD(resumen.liquidada)}
          tono="var(--color-sys-green)"
        />
      </div>

      {comisiones.length === 0 ? (
        <EmptyState
          message={
            'Sin comisiones todavía. El disparo solo cobra sobre las plataformas marcadas con «aplica comisión», y hoy esa marca la tienen únicamente Google One y Google One 5 TB, que no están en venta.'
          }
        />
      ) : (
        <Table
          titulo={`Historial · ${filtradas.length} de ${filas.length} comisión${filtradas.length === 1 ? '' : 'es'}`}
          acciones={
            <Select
              className="w-44"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value as typeof filtro)}
            >
              <option value="todas">Todas</option>
              <option value="pendiente">Pendientes</option>
              <option value="liquidada">Liquidadas</option>
            </Select>
          }
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
              <Td num>{c.bsDelCobro != null ? fmtVES(c.bsDelCobro) : '—'}</Td>
              <Td num>{c.tasa != null ? fmtNum(c.tasa, 4) : '—'}</Td>
              <Td num className="font-semibold">
                {fmtUSD(c.monto_comision_usd)}
              </Td>
              <Td num className="font-semibold">
                {c.bsDeLaComision != null ? fmtVES(c.bsDeLaComision) : '—'}
              </Td>
              <Td>
                <Badge value={c.estado} />
              </Td>
              <Td>
                {c.estado === 'pendiente' ? (
                  <div className="flex justify-end">
                    <Button
                      variant="secondary"
                      tam="compacto"
                      onClick={() => void liquidar(c.id)}
                    >
                      Liquidar
                    </Button>
                  </div>
                ) : (
                  <span className="block text-right text-nota text-ink-secondary">—</span>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Pagina>
  )
}
