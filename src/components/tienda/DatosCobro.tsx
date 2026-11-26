import { useRef, useState } from 'react'
import { DATOS_COBRO, textoCobro, type MetodoPago } from '../../lib/pagos'
import { IconCheck, IconCopiar } from '../icons'

// El portapapeles solo existe en contexto seguro; si el navegador lo niega, un
// textarea oculto hace el mismo trabajo. Sin las dos vías, el número de la
// cédula queda en pantalla y el cliente lo transcribe de a cinco dígitos.
async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = texto
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

export default function DatosCobro({ metodo }: { metodo: MetodoPago }) {
  const datos = DATOS_COBRO[metodo]
  const [copiado, setCopiado] = useState<string | null>(null)
  const reloj = useRef<number | null>(null)

  if (!datos) return null

  const llevar = async (clave: string, texto: string) => {
    if (!(await copiar(texto))) return
    setCopiado(clave)
    if (reloj.current) window.clearTimeout(reloj.current)
    reloj.current = window.setTimeout(() => setCopiado(null), 1800)
  }

  return (
    <div className="mt-2.5 flex flex-col gap-2">
      {datos.map((d) => (
        <button
          key={d.etiqueta}
          type="button"
          onClick={() => llevar(d.etiqueta, d.valor)}
          aria-label={`Copiar ${d.etiqueta.toLowerCase()}`}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-blink-line bg-white px-3.5 text-left transition-colors hover:bg-blink-fill"
        >
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-blink-ink-mute">
            {d.etiqueta}
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={`truncate text-sm font-bold tabular-nums ${
                copiado === d.etiqueta ? 'text-blink-action' : 'text-blink-dark'
              }`}
            >
              {d.valor}
            </span>
            {copiado === d.etiqueta ? (
              <IconCheck tam={16} className="shrink-0 text-blink-action" />
            ) : (
              <IconCopiar tam={16} className="shrink-0 text-blink-ink-mute" />
            )}
          </span>
        </button>
      ))}

      <button
        type="button"
        onClick={() => llevar('todo', textoCobro(metodo) ?? '')}
        className="mt-1 flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-blink-action px-5 text-sm font-semibold text-white transition-colors hover:bg-blink-action-hover"
      >
        {copiado === 'todo' ? (
          <>
            <IconCheck tam={16} /> Copiado
          </>
        ) : (
          <>
            <IconCopiar tam={16} /> Copiar todos los datos
          </>
        )}
      </button>
    </div>
  )
}
