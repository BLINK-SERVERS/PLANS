// Selector de cliente con búsqueda en vivo (nombre, correo o teléfono)
import { useMemo, useRef, useState } from 'react'
import type { Usuario } from '../lib/types'
import { IconSearch, IconX } from './icons'

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

export function SelectCliente({
  clientes,
  value,
  onChange,
}: {
  clientes: Usuario[]
  value: string
  onChange: (id: string) => void
}) {
  const [q, setQ] = useState('')
  const [abierto, setAbierto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const seleccionado = clientes.find((c) => c.id === value)

  const filtrados = useMemo(() => {
    const t = norm(q.trim())
    if (!t) return clientes.slice(0, 8)
    return clientes
      .filter(
        (c) =>
          norm(c.nombre).includes(t) ||
          norm(c.email ?? '').includes(t) ||
          norm(c.telefono ?? '').includes(t),
      )
      .slice(0, 12)
  }, [clientes, q])

  const elegir = (id: string) => {
    onChange(id)
    setQ('')
    setAbierto(false)
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <IconSearch
          width={15}
          height={15}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-blink-ink-mute"
        />
        <input
          type="text"
          className="w-full rounded-lg border border-blink-line-strong bg-white py-2 pl-8 pr-8 text-sm text-blink-dark outline-none focus:border-blink-primary focus:ring-2 focus:ring-blink-soft"
          placeholder={seleccionado ? seleccionado.nombre : 'Busca por nombre, correo o teléfono…'}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setAbierto(true)
          }}
          onFocus={() => setAbierto(true)}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
        />
        {seleccionado && !q ? (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-blink-ink-mute hover:text-rose-600"
            title="Quitar selección"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange('')
              setQ('')
            }}
          >
            <IconX width={14} height={14} />
          </button>
        ) : null}
      </div>
      {abierto && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-blink-line bg-white shadow-lg">
          {filtrados.length === 0 ? (
            <p className="px-3 py-2 text-sm text-blink-ink-mute">Sin resultados</p>
          ) : (
            filtrados.map((c) => (
              <button
                key={c.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => elegir(c.id)}
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-blink-soft ${
                  c.id === value ? 'bg-blink-soft font-medium text-blink-action-hover' : 'text-blink-muted'
                }`}
              >
                <span className="block">{c.nombre}</span>
                {c.email ? <span className="block text-xs text-blink-ink-mute">{c.email}</span> : null}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}