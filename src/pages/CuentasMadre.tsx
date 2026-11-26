import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  cambiarEstadoCuenta,
  crearCuentaMadre,
  fetchCuentasMadre,
  fetchPlataformas,
  fetchProveedores,
} from '../lib/api'
import type { CuentaMadreRow, Plataforma, Proveedor } from '../lib/types'
import { fmtDate, fmtUSD } from '../lib/format'
import { errMsg } from '../lib/err'
import {
  Badge,
  Button,
  Buscador,
  EmptyState,
  ErrorMsg,
  Field,
  Input,
  Loading,
  Modal,
  ModalFooter,
  PageHeader,
  Pagina,
  Select,
  Table,
  Td,
} from '../components/ui'
import { NuevaPlataforma, NuevoProveedor } from '../components/inline'
import { IconInfinity, IconPlus } from '../components/icons'

const vacio = {
  proveedor_id: '',
  plataforma_id: '',
  correo_cuenta: '',
  cupos_totales: '4',
  costo_renovacion_usd: '',
  fecha_corte_proveedor: '',
}

type FormState = typeof vacio

export default function CuentasMadre() {
  const [cuentas, setCuentas] = useState<CuentaMadreRow[]>([])
  const [plataformas, setPlataformas] = useState<Plataforma[]>([])
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [form, setForm] = useState<FormState>(vacio)

  const cargar = useCallback(async () => {
    try {
      const [c, p, pr] = await Promise.all([
        fetchCuentasMadre(),
        fetchPlataformas(),
        fetchProveedores(),
      ])
      setCuentas(c)
      setPlataformas(p)
      setProveedores(pr)
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

  const cargarY = async (actualizar: (f: FormState) => FormState) => {
    await cargar()
    setForm((f) => actualizar(f))
  }

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return cuentas
    return cuentas.filter((c) =>
      [c.correo_cuenta, c.plataformas?.nombre, c.proveedores?.nombre]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    )
  }, [cuentas, busqueda])

  const guardar = async () => {
    if (guardando) return
    setGuardando(true)
    try {
      await crearCuentaMadre({
        proveedor_id: form.proveedor_id || null,
        plataforma_id: form.plataforma_id,
        correo_cuenta: form.correo_cuenta,
        cupos_totales: Number(form.cupos_totales),
        costo_renovacion_usd: Number(form.costo_renovacion_usd || 0),
        fecha_corte_proveedor: form.fecha_corte_proveedor || null,
      })
      setModal(false)
      setForm(vacio)
      await cargar()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setGuardando(false)
    }
  }

  const cambiarEstado = async (c: CuentaMadreRow) => {
    const nuevo = c.estado === 'activa' ? 'suspendida' : 'activa'
    try {
      await cambiarEstadoCuenta(c.id, nuevo)
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
        title="Cuentas madre"
        subtitle="Inventario de cuentas, comprado a un proveedor o directo"
      >
        <Button onClick={() => setModal(true)}>
          <IconPlus tam={16} peso="semipesado" />
          Nueva cuenta madre
        </Button>
      </PageHeader>

      {cuentas.length === 0 ? (
        <EmptyState message="Todavía no hay cuentas madre registradas." />
      ) : (
        <>
          <Buscador
            value={busqueda}
            onChange={setBusqueda}
            placeholder="Buscar por correo, plataforma o proveedor…"
          />

          <Table
            titulo={`${filtradas.length} de ${cuentas.length} cuentas`}
            headers={['Correo', 'Proveedor', 'Plataforma', 'Cupos', 'Costo', 'Fecha corte', 'Estado', 'Acciones']}
          >
            {filtradas.map((c) => (
              <tr key={c.id}>
                {/* El span con `overflow-wrap: anywhere` es lo que cabe: `Td` ya trae
                    `break-words`, que según la especificación no reduce el ancho
                    mínimo de la celda, y hay correos que son un solo token de 28
                    caracteres sin un espacio donde romper. */}
                <Td className="font-mono text-nota font-medium">
                  <span className="[overflow-wrap:anywhere]">{c.correo_cuenta}</span>
                </Td>
                <Td>{c.proveedores?.nombre ?? 'Directo'}</Td>
                <Td>{c.plataformas?.nombre ?? '—'}</Td>
                <Td num>
                  {c.cupos_ocupados}/{c.cupos_totales}
                </Td>
                <Td num>{fmtUSD(c.costo_renovacion_usd)}</Td>
                <Td>
                  {c.fecha_corte_proveedor ? (
                    fmtDate(c.fecha_corte_proveedor)
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-nota text-ink-secondary">
                      <IconInfinity tam={15} peso="medio" /> Sin cortes
                    </span>
                  )}
                </Td>
                <Td>
                  <Badge value={c.estado} />
                </Td>
                <Td>
                  <div className="flex justify-end">
                    <Button
                      variant="secondary"
                      tam="compacto"
                      onClick={() => void cambiarEstado(c)}
                    >
                      {c.estado === 'activa' ? 'Suspender' : 'Activar'}
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </>
      )}

      <Modal open={modal} title="Nueva cuenta madre" onClose={() => setModal(false)}>
        <div className="space-y-3">
          <Field label="Proveedor">
            <Select
              value={form.proveedor_id}
              onChange={(e) => setForm({ ...form, proveedor_id: e.target.value })}
            >
              <option value="">Directo (sin proveedor)</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </Select>
            <NuevoProveedor onCreated={(id) => void cargarY((f) => ({ ...f, proveedor_id: id }))} />
          </Field>
          <Field label="Plataforma *">
            <Select
              value={form.plataforma_id}
              onChange={(e) => setForm({ ...form, plataforma_id: e.target.value })}
            >
              <option value="">Selecciona…</option>
              {plataformas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </Select>
            <NuevaPlataforma onCreated={(id) => void cargarY((f) => ({ ...f, plataforma_id: id }))} />
          </Field>
          <Field label="Correo de la cuenta *">
            <Input
              value={form.correo_cuenta}
              onChange={(e) => setForm({ ...form, correo_cuenta: e.target.value })}
              placeholder="cuenta@proveedor.com"
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Cupos totales *">
              <Input
                type="number"
                min={1}
                value={form.cupos_totales}
                onChange={(e) => setForm({ ...form, cupos_totales: e.target.value })}
              />
            </Field>
            <Field label="Costo renovación (USD) *">
              <Input
                type="number"
                step="0.01"
                min={0}
                value={form.costo_renovacion_usd}
                onChange={(e) => setForm({ ...form, costo_renovacion_usd: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Fecha corte al proveedor">
            <Input
              type="date"
              value={form.fecha_corte_proveedor}
              onChange={(e) => setForm({ ...form, fecha_corte_proveedor: e.target.value })}
            />
            <p className="text-nota text-ink-secondary">
              Déjala vacía si la cuenta no tiene renovación, como Canva docente.
            </p>
          </Field>
          <ModalFooter
            onCancel={() => setModal(false)}
            onSave={() => void guardar()}
            disabled={!form.plataforma_id || !form.correo_cuenta.trim() || !form.cupos_totales}
            guardando={guardando}
          />
        </div>
      </Modal>
    </Pagina>
  )
}