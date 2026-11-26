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
      {/* Mismo campo que `Input` del kit: 44 px, radio 10, gris traslúcido sin
          borde y el anillo azul al foco. Antes medía 38 px con hairline, así
          que la lista de clientes se veía más baja que los campos de al lado. */}
      <div className="relative">
        <IconSearch
          tam={16}
          peso="medio"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-secondary"
        />
        <input
          type="text"
          className="h-[var(--control-normal)] w-full rounded-[10px] border border-transparent bg-ink-fill-4 pl-9 pr-10 text-cuerpo text-ink-label placeholder:text-ink-secondary transition-[background-color,border-color,box-shadow] duration-150 focus:border-sys-blue focus:bg-white focus:shadow-[0_0_0_3.5px_rgba(0,122,255,0.16)] focus:outline-none"
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
            className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-ink-secondary transition-colors hover:bg-ink-fill-3 hover:text-sys-red"
            title="Quitar selección"
            aria-label="Quitar la selección"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange('')
              setQ('')
            }}
          >
            <IconX tam={15} peso="semipesado" />
          </button>
        ) : null}
      </div>
      {abierto ? (
        <div
          role="listbox"
          className="vidrio-hoja absolute z-20 mt-1.5 max-h-64 w-full overflow-y-auto rounded-tarjeta p-1"
        >
          {filtrados.length === 0 ? (
            <p className="px-3 py-2.5 text-nota text-ink-secondary">Sin resultados</p>
          ) : (
            filtrados.map((c) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={c.id === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => elegir(c.id)}
                className={`flex w-full flex-col gap-0.5 rounded-[10px] px-3 py-2 text-left transition-colors ${
                  c.id === value
                    ? 'bg-velo-blue text-blink-action-text'
                    : 'text-ink-label hover:bg-ink-fill-4'
                }`}
              >
                <span className="text-headline font-medium">{c.nombre}</span>
                {c.email ? (
                  <span className="text-legenda text-ink-secondary">{c.email}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
