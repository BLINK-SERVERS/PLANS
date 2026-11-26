import { useCallback, useEffect, useState } from 'react'
import { etiquetaOrigen, fetchEstadoTasa, fetchTasaBcv, type EstadoTasa } from '../lib/api'
import { fmtDate, fmtNum } from '../lib/format'
import { Button, Chip, Loseta } from './ui'
import { IconAlerta, IconCheckcirculo, IconRefresh, IconReloj } from './icons'

// Cinta de la tasa BCV: el número, de dónde salió y cuántos días tiene.
//
// Vive separada de las páginas porque el mismo dato se necesita en el dashboard,
// en el formulario de cobro y en ganancias, y la regla que importa es una sola:
// una tasa cuya fecha valor ya no cubre hoy no es un precio, es un vestigio. El
// 42,50 del 2026-09-20 estuvo 66 días en la tabla mientras el BCV publicaba
// 924,35; cualquier monto en Bs calculado con él sale 21 veces más alto. Por eso
// la cinta no muestra solo el valor: muestra la edad y ofrece el refresco.
export function CintaTasa({ onActualizada }: { onActualizada?: () => void }) {
  const [estado, setEstado] = useState<EstadoTasa | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState('')

  const cargar = useCallback(async () => {
    try {
      setEstado(await fetchEstadoTasa())
    } catch {
      setEstado(null)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const refrescar = async () => {
    setOcupado(true)
    setAviso('')
    try {
      const r = await fetchTasaBcv({ forzar: true })
      if (r.tasa == null) {
        setAviso(
          'Ninguna fuente respondió: ni el raspado de bcv.org.ve ni el JSON de respaldo. El campo de tasa queda vacío a propósito.',
        )
      } else {
        setEstado(await fetchEstadoTasa())
        onActualizada?.()
      }
    } catch {
      setAviso('La Function de tasa no contestó. Reintenta más tarde o cárgala a mano.')
    } finally {
      setOcupado(false)
    }
  }

  const vigente = estado?.vigente ?? false
  const vieja = estado?.diasVieja ?? null

  return (
    <div className="vidrio rounded-tarjeta p-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Loseta tono={vigente ? 'var(--color-sys-teal)' : 'var(--color-sys-orange)'}>
          {vigente ? <IconCheckcirculo /> : <IconAlerta peso="medio" />}
        </Loseta>
        <div className="min-w-0 flex-1">
          <p className="text-nota font-medium text-ink-secondary">Tasa BCV</p>
          <p className="text-headline font-semibold tabular-nums text-ink-label">
            {estado?.tasa != null ? `${fmtNum(estado.tasa, 4)} Bs/USD` : 'Sin tasa disponible'}
            {estado?.eur != null ? (
              <span className="ml-2 text-nota font-normal text-ink-secondary">
                {fmtNum(estado.eur, 4)} Bs/EUR
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {estado?.fecha ? (
            <Chip>
              <IconReloj tam={13} />
              fecha valor {fmtDate(estado.fecha)}
            </Chip>
          ) : null}
          {estado ? <Chip>{etiquetaOrigen(estado.origen)}</Chip> : null}
          <Button
            variant="secondary"
            tam="compacto"
            onClick={() => void refrescar()}
            disabled={ocupado}
          >
            <IconRefresh tam={15} />
            {ocupado ? 'Buscando…' : 'Actualizar'}
          </Button>
        </div>
      </div>

      {!vigente && estado?.tasa != null ? (
        <p className="mt-2.5 flex items-start gap-2 rounded-[12px] bg-velo-aviso px-3 py-2 text-nota leading-[18px] text-tinta-aviso">
          <IconAlerta tam={17} peso="medio" className="mt-px shrink-0" />
          <span>
            La última fila guardada es del {estado.fecha ? fmtDate(estado.fecha) : 'día desconocido'}
            {vieja != null && vieja > 0 ? ` (${vieja} ${vieja === 1 ? 'día' : 'días'} atrás)` : ''}. No
            cobres en Bs con ese número: actualiza la tasa o escribe la del día a mano.
          </span>
        </p>
      ) : null}

      {aviso ? (
        <p className="mt-2.5 text-nota leading-[18px] text-tinta-aviso">{aviso}</p>
      ) : null}
    </div>
  )
}
