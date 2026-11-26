import { useCallback, useEffect, useState } from 'react'
import {
  actualizarPlataforma,
  crearPlataforma,
  eliminarPlataforma,
  fetchPlataformasTodas,
} from '../lib/api'
import type { Plataforma } from '../lib/types'
import { fmtDate } from '../lib/format'
import { errMsg } from '../lib/err'
import {
  Badge,
  Button,
  EmptyState,
  ErrorMsg,
  Field,
  Input,
  Loading,
  Modal,
  ModalFooter,
  PageHeader,
  Pagina,
  Table,
  Td,
  useConfirmar,
} from '../components/ui'
import { IconCheck, IconPlus, IconTrash, IconX } from '../components/icons'

const vacio = { nombre: '', activa: true, aplica_comision: false }

export default function Plataformas() {
  const [plataformas, setPlataformas] = useState<Plataforma[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [editando, setEditando] = useState<Plataforma | null>(null)
  const [form, setForm] = useState(vacio)

  const cargar = useCallback(async () => {
    try {
      setPlataformas(await fetchPlataformasTodas())
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

  const abrirNuevo = () => {
    setEditando(null)
    setForm(vacio)
    setModal(true)
  }

  const abrirEditar = (p: Plataforma) => {
    setEditando(p)
    setForm({ nombre: p.nombre, activa: p.activa, aplica_comision: p.aplica_comision })
    setModal(true)
  }

  const guardar = async () => {
    if (guardando) return
    setGuardando(true)
    try {
      if (editando) {
        await actualizarPlataforma(editando.id, form)
      } else {
        await crearPlataforma(form)
      }
      setModal(false)
      await cargar()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setGuardando(false)
    }
  }

  const { confirmar } = useConfirmar()

  const borrar = async (p: Plataforma) => {
    const aceptado = await confirmar(`¿Eliminar ${p.nombre}?`, {
      detalle:
        'Se borran también sus planes, sus cuentas madre y las suscripciones asociadas. No se puede deshacer.',
      boton: 'Eliminar',
    })
    if (!aceptado) return
    try {
      await eliminarPlataforma(p.id)
      await cargar()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  if (cargando) return <Loading />
  if (error) return <ErrorMsg message={error} />

  return (
    <Pagina>
      <PageHeader
        title="Plataformas"
        subtitle="Catálogo de servicios y si generan comisión de referido (30%)"
      >
        <Button onClick={abrirNuevo}>
          <IconPlus tam={16} peso="semipesado" />
          Nueva plataforma
        </Button>
      </PageHeader>

      {plataformas.length === 0 ? (
        <EmptyState message="Todavía no hay plataformas registradas." />
      ) : (
        <Table headers={['Nombre', 'Estado', 'Comisión 30%', 'Registro', 'Acciones']}>
          {plataformas.map((p) => (
            <tr key={p.id}>
              <Td className="font-medium">{p.nombre}</Td>
              <Td>
                <Badge value={p.activa ? 'activa' : 'baja'} />
              </Td>
              <Td>
                {p.aplica_comision ? (
                  <span className="inline-flex items-center gap-1.5 text-nota font-medium text-tinta-ok">
                    <IconCheck tam={15} peso="semipesado" /> Sí
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-nota text-ink-secondary">
                    <IconX tam={15} peso="medio" /> No
                  </span>
                )}
              </Td>
              <Td>{fmtDate(p.created_at)}</Td>
              <Td>
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" tam="compacto" onClick={() => abrirEditar(p)}>
                    Editar
                  </Button>
                  <Button
                    variant="danger-suave"
                    tam="compacto"
                    soloIcono
                    title="Eliminar"
                    aria-label={`Eliminar ${p.nombre}`}
                    onClick={() => void borrar(p)}
                  >
                    <IconTrash tam={15} />
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      <Modal
        open={modal}
        title={editando ? 'Editar plataforma' : 'Nueva plataforma'}
        onClose={() => setModal(false)}
      >
        <div className="space-y-3">
          <Field label="Nombre *">
            <Input
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              placeholder="Netflix, Spotify…"
            />
          </Field>
          <label className="flex items-center gap-2.5 text-subheadline text-ink-label">
            <input
              type="checkbox"
              className="h-[18px] w-[18px] accent-sys-blue"
              checked={form.activa}
              onChange={(e) => setForm({ ...form, activa: e.target.checked })}
            />
            Activa (disponible para venta)
          </label>
          <label className="flex items-center gap-2.5 text-subheadline text-ink-label">
            <input
              type="checkbox"
              className="h-[18px] w-[18px] accent-sys-blue"
              checked={form.aplica_comision}
              onChange={(e) => setForm({ ...form, aplica_comision: e.target.checked })}
            />
            Genera comisión de referido (30%)
          </label>
          <ModalFooter
            onCancel={() => setModal(false)}
            onSave={() => void guardar()}
            disabled={!form.nombre.trim()}
            guardando={guardando}
          />
        </div>
      </Modal>
    </Pagina>
  )
}