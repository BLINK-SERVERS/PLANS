import { db } from './db'
import { URL_TASA } from './entorno'
import { tokenParaDatos } from './sesion'
import { hoy, round2 } from './format'
import { errMsg } from './err'
import type {
  CatalogoItem,
  ComisionRow,
  CuentaMadre,
  CuentaMadreRow,
  EstadoPedido,
  GananciaRow,
  MiSuscripcion,
  Moneda,
  PagoRow,
  Pedido,
  PlanRow,
  Plataforma,
  Proveedor,
  SuscripcionRow,
  Usuario,
  VencimientoProveedor,
} from './types'

// ---------- Caché en memoria (TTL 20s) para agilizar la navegación ----------
const cache = new Map<string, { at: number; data: unknown }>()
const TTL = 20_000

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.data as T
  const data = await fn()
  cache.set(key, { at: Date.now(), data })
  return data
}

function invalidar(...keys: string[]) {
  for (const k of keys) cache.delete(k)
}

// ---------------------------------------------------------------- Clientes
export async function fetchClientes(): Promise<Usuario[]> {
  return cached('clientes', async () => {
    const { data, error } = await db
      .from('usuarios')
      .select('*')
      .eq('rol', 'cliente')
      .order('nombre')
    if (error) throw new Error(errMsg(error))
    return (data ?? []) as Usuario[]
  })
}

export async function fetchAgentes(): Promise<Usuario[]> {
  return cached('agentes', async () => {
    const { data, error } = await db
      .from('usuarios')
      .select('id, nombre, email')
      .eq('rol', 'agente')
      .order('nombre')
    if (error) throw new Error(errMsg(error))
    return (data ?? []) as Usuario[]
  })
}

export async function crearCliente(input: {
  nombre: string
  email?: string
  telefono?: string
  referido_por?: string | null
}): Promise<string> {
  const { data, error } = await db
    .from('usuarios')
    .insert({
      rol: 'cliente',
      nombre: input.nombre,
      email: input.email || null,
      telefono: input.telefono || null,
      referido_por: input.referido_por || null,
    })
    .select('id')
    .single()
  if (error) throw new Error(errMsg(error))
  invalidar('clientes')
  return (data as { id: string }).id
}

export async function actualizarCliente(
  id: string,
  input: { nombre: string; email?: string; telefono?: string },
): Promise<void> {
  const { error } = await db
    .from('usuarios')
    .update({
      nombre: input.nombre,
      email: input.email || null,
      telefono: input.telefono || null,
    })
    .eq('id', id)
  if (error) throw new Error(errMsg(error))
  invalidar('clientes')
}

export async function eliminarCliente(id: string): Promise<void> {
  const { error } = await db.from('usuarios').delete().eq('id', id)
  if (error) throw new Error(errMsg(error))
  invalidar('clientes', 'susc', 'pagos', 'resumen', 'comisiones')
}

// -------------------------------------------------------------- Proveedores
export async function fetchProveedores(): Promise<Proveedor[]> {
  return cached('proveedores', async () => {
    const { data, error } = await db
      .from('proveedores')
      .select('*')
      .order('nombre')
    if (error) throw new Error(errMsg(error))
    return (data ?? []) as Proveedor[]
  })
}

export async function crearProveedor(input: {
  nombre: string
  contacto?: string
  metodo_pago_preferido?: string
}): Promise<string> {
  const { data, error } = await db
    .from('proveedores')
    .insert({
      nombre: input.nombre,
      contacto: input.contacto || null,
      metodo_pago_preferido: input.metodo_pago_preferido || null,
    })
    .select('id')
    .single()
  if (error) throw new Error(errMsg(error))
  invalidar('proveedores')
  return (data as { id: string }).id
}

export async function eliminarProveedor(id: string): Promise<void> {
  const { error } = await db.from('proveedores').delete().eq('id', id)
  if (error) throw new Error(errMsg(error))
  invalidar('proveedores', 'cuentas', 'vencimientos', 'resumen')
}

// ------------------------------------------------- Plataformas y planes
export async function fetchPlataformas(): Promise<Plataforma[]> {
  // Catálogo activo (para selects y venta)
  return cached('plataformas', async () => {
    const { data, error } = await db
      .from('plataformas')
      .select('*')
      .eq('activa', true)
      .order('nombre')
    if (error) throw new Error(errMsg(error))
    return (data ?? []) as Plataforma[]
  })
}

export async function fetchPlataformasTodas(): Promise<Plataforma[]> {
  return cached('plataformas_todas', async () => {
    const { data, error } = await db
      .from('plataformas')
      .select('*')
      .order('nombre')
    if (error) throw new Error(errMsg(error))
    return (data ?? []) as Plataforma[]
  })
}

export async function crearPlataforma(input: {
  nombre: string
  activa?: boolean
  aplica_comision?: boolean
}): Promise<string> {
  const { data, error } = await db
    .from('plataformas')
    .insert({
      nombre: input.nombre,
      activa: input.activa ?? true,
      aplica_comision: input.aplica_comision ?? false,
    })
    .select('id')
    .single()
  if (error) throw new Error(errMsg(error))
  invalidar('plataformas', 'plataformas_todas', 'planes')
  return (data as { id: string }).id
}

export async function actualizarPlataforma(
  id: string,
  input: { nombre: string; activa: boolean; aplica_comision: boolean },
): Promise<void> {
  const { error } = await db
    .from('plataformas')
    .update(input)
    .eq('id', id)
  if (error) throw new Error(errMsg(error))
  invalidar('plataformas', 'plataformas_todas', 'planes', 'resumen')
}

export async function eliminarPlataforma(id: string): Promise<void> {
  const { error } = await db.from('plataformas').delete().eq('id', id)
  if (error) throw new Error(errMsg(error))
  invalidar('plataformas', 'plataformas_todas', 'planes', 'susc', 'cuentas', 'vencimientos', 'resumen')
}

// --------------------------------------------------------------- Tienda pública
// Vista `v_catalogo_publico`: legible con la anon key (RLS → solo
// plataformas activas). La tienda vive en las rutas /tienda, /registro
// e /ingreso, fuera del panel administrativo.
export async function fetchCatalogoPublico(): Promise<CatalogoItem[]> {
  const { data, error } = await db
    .from('v_catalogo_publico')
    .select('*')
    .order('plataforma')
    .order('duracion_dias')
  if (error) throw new Error(errMsg(error))
  return (data ?? []) as CatalogoItem[]
}

export async function fetchPlanes(): Promise<PlanRow[]> {
  return cached('planes', async () => {
    const { data, error } = await db
      .from('planes')
      .select('*, plataformas(nombre)')
      .order('duracion_dias')
    if (error) throw new Error(errMsg(error))
    return (data ?? []) as PlanRow[]
  })
}

export async function crearPlan(input: {
  plataforma_id: string
  duracion_dias: number
  precio_venta_usd: number
  precio_referencia_usd?: number | null
}): Promise<string> {
  const { data, error } = await db
    .from('planes')
    .insert({
      plataforma_id: input.plataforma_id,
      duracion_dias: input.duracion_dias,
      precio_venta_usd: input.precio_venta_usd,
      precio_referencia_usd: input.precio_referencia_usd ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error(errMsg(error))
  invalidar('planes', 'resumen')
  return (data as { id: string }).id
}

export async function actualizarPlan(
  id: string,
  input: {
    duracion_dias?: number
    precio_venta_usd?: number
    precio_referencia_usd?: number | null
  },
): Promise<void> {
  const { error } = await db.from('planes').update(input).eq('id', id)
  if (error) throw new Error(errMsg(error))
  invalidar('planes', 'resumen')
}

export async function eliminarPlan(id: string): Promise<void> {
  const { error } = await db.from('planes').delete().eq('id', id)
  if (error) throw new Error(errMsg(error))
  invalidar('planes', 'resumen')
}

// ---------------------------------------------------------------- Pedidos
// Pedidos de la tienda (#/tienda). El cliente autenticado crea el suyo
// (RLS: cliente_id = auth.uid()); el admin los ve y gestiona desde el panel.
export async function crearPedido(input: {
  tipo: 'plan' | 'giftcard'
  plataforma: string
  duracion_dias?: number | null
  precio_usd?: number | null
  valor_giftcard_usd?: number | null
  precio_giftcard_eur?: number | null
  diseno_giftcard?: string | null
  cliente_id: string
  cliente_nombre: string | null
  cliente_contacto: string | null
  // Cobro cotizado en el checkout (v0.5.0)
  metodo_pago?: string | null
  moneda_cobro?: string | null
  monto_cobro?: number | null
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db.from('pedidos').insert({
    tipo: input.tipo,
    plataforma: input.plataforma,
    duracion_dias: input.duracion_dias ?? null,
    precio_usd: input.precio_usd ?? null,
    valor_giftcard_usd: input.valor_giftcard_usd ?? null,
    precio_giftcard_eur: input.precio_giftcard_eur ?? null,
    diseno_giftcard: input.diseno_giftcard ?? null,
    cliente_id: input.cliente_id,
    cliente_nombre: input.cliente_nombre,
    cliente_contacto: input.cliente_contacto,
    metodo_pago: input.metodo_pago ?? null,
    moneda_cobro: input.moneda_cobro ?? null,
    monto_cobro: input.monto_cobro ?? null,
  })
  if (error) return { ok: false, error: errMsg(error) }
  invalidar('pedidos')
  return { ok: true }
}

export async function fetchPedidos(): Promise<Pedido[]> {
  return cached('pedidos', async () => {
    const { data, error } = await db
      .from('pedidos')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw new Error(errMsg(error))
    return (data ?? []) as Pedido[]
  })
}

export async function actualizarEstadoPedido(id: string, estado: EstadoPedido): Promise<void> {
  const { error } = await db.from('pedidos').update({ estado }).eq('id', id)
  if (error) throw new Error(errMsg(error))
  invalidar('pedidos')
}

// ------------------------------------------------- Renovación desde la landing
// Migración 0006. El cliente DECLARA, el admin VALIDA, el trigger renueva.
// Ninguna de estas tres funciones toca `pago_suscripciones`: la única puerta
// sigue siendo `validar_renovacion`, que corre como security definer y pide
// es_admin().

// Lo que el cliente ve de sus propias suscripciones. Sin sesión la vista
// responde 42501 (no hay grant para anonymous), así que la pantalla tiene que
// pedir ingreso antes de llamar.
export async function fetchMisSuscripciones(): Promise<MiSuscripcion[]> {
  const { data, error } = await db
    .from('v_mis_suscripciones')
    .select('*')
    .order('dias_restantes')
  if (error) throw new Error(errMsg(error))
  return (data ?? []) as MiSuscripcion[]
}

/**
 * Registra la renovación que el cliente declara. `tipo` sigue siendo 'plan'
 * (el CHECK de la tabla no admite un valor nuevo y la renovación vende el
 * mismo plan); lo que la distingue es `suscripcion_id`.
 *
 * Mismas columnas de cobro que el checkout: `metodo_pago`, `moneda_cobro`,
 * `monto_cobro`, redondeadas a centavo igual que en Checkout.tsx.
 *
 * El índice parcial `pedidos_renovacion_abierta` deja UN pedido 'nuevo' por
 * suscripción, así que el doble click o una declaración repetida salen con
 * 23505 → HTTP 409. No se lanza contra eso: se devuelve { ok:false, conflicto:true }
 * para que la pantalla lo cuente como "ya la declaraste", no como fallo rojo.
 */
export async function crearRenovacion(input: {
  suscripcion_id: string
  plataforma: string
  duracion_dias: number
  precio_usd: number
  cliente_id: string
  cliente_nombre: string | null
  cliente_contacto: string | null
  metodo_pago: string
  moneda_cobro: string
  monto_cobro: number
}): Promise<{ ok: boolean; conflicto: boolean; error?: string }> {
  const { error } = await db.from('pedidos').insert({
    tipo: 'plan',
    suscripcion_id: input.suscripcion_id,
    plataforma: input.plataforma,
    duracion_dias: input.duracion_dias,
    precio_usd: round2(input.precio_usd),
    cliente_id: input.cliente_id,
    cliente_nombre: input.cliente_nombre,
    cliente_contacto: input.cliente_contacto,
    metodo_pago: input.metodo_pago,
    moneda_cobro: input.moneda_cobro,
    monto_cobro: round2(input.monto_cobro),
    estado: 'nuevo',
  })
  if (error) {
    const code = error.code ?? ''
    const yaDeclarada =
      code === '23505' || code === '409' || /duplicate key/i.test(error.message ?? '')
    return {
      ok: false,
      conflicto: yaDeclarada,
      error: errMsg(error),
    }
  }
  invalidar('pedidos')
  return { ok: true, conflicto: false }
}

/**
 * El admin cierra la renovación (RPC validar_renovacion). Devuelve el uuid del
 * pago creado, o null cuando el pedido ya estaba validado: la función responde
 * `return null` antes de tocar dinero, así que reintentar es inofensivo.
 * Falla con excepción si el pedido no es renovación o si la fecha retrocede el
 * corte vigente (el `greatest` del trigger no sumaría días).
 */
export async function validarRenovacion(
  pedidoId: string,
  input: {
    monto_pagado: number
    moneda: Moneda
    tasa_bcv_aplicada: number | null
    tasa_cambio_binance: number | null
    equivalente_usd: number
    metodo_pago: string
    fecha_pago: string
  },
): Promise<string | null> {
  const { data, error } = await db.rpc<string | null>('validar_renovacion', {
    p_pedido: pedidoId,
    p_monto_pagado: input.monto_pagado,
    p_moneda: input.moneda,
    p_tasa_bcv_aplicada: input.tasa_bcv_aplicada,
    p_tasa_cambio_binance: input.tasa_cambio_binance,
    p_equivalente_usd: input.equivalente_usd,
    p_metodo_pago: input.metodo_pago,
    p_fecha_pago: input.fecha_pago,
  })
  if (error) throw new Error(errMsg(error))
  invalidar('pedidos', 'pagos', 'comisiones', 'resumen', 'ganancias', 'susc')
  return data ?? null
}

// ---------------------------------------------------------- Cuentas madre
export async function fetchCuentasMadre(): Promise<CuentaMadreRow[]> {
  return cached('cuentas', async () => {
    const { data, error } = await db
      .from('cuentas_madre')
      .select('*, proveedores(nombre), plataformas(nombre)')
      .order('fecha_corte_proveedor', { ascending: true, nullsFirst: true })
    if (error) throw new Error(errMsg(error))
    return (data ?? []) as CuentaMadreRow[]
  })
}

export async function crearCuentaMadre(input: {
  proveedor_id: string | null
  plataforma_id: string
  correo_cuenta: string
  cupos_totales: number
  costo_renovacion_usd: number
  fecha_corte_proveedor: string | null
}): Promise<string> {
  const { data, error } = await db
    .from('cuentas_madre')
    .insert({
      proveedor_id: input.proveedor_id ?? null,
      plataforma_id: input.plataforma_id,
      correo_cuenta: input.correo_cuenta,
      cupos_totales: input.cupos_totales,
      costo_renovacion_usd: input.costo_renovacion_usd,
      fecha_corte_proveedor: input.fecha_corte_proveedor || null,
    })
    .select('id')
    .single()
  if (error) throw new Error(errMsg(error))
  invalidar('cuentas', 'vencimientos', 'resumen')
  return (data as { id: string }).id
}

export async function cambiarEstadoCuenta(
  id: string,
  estado: CuentaMadre['estado'],
): Promise<void> {
  const { error } = await db
    .from('cuentas_madre')
    .update({ estado })
    .eq('id', id)
  if (error) throw new Error(errMsg(error))
  invalidar('cuentas', 'vencimientos', 'resumen')
}

// ----------------------------------------------------------- Suscripciones
export async function fetchSuscripciones(): Promise<SuscripcionRow[]> {
  return cached('susc', async () => {
    const { data, error } = await db
      .from('suscripciones')
      .select(
        '*, usuarios(nombre, email), planes(precio_venta_usd, duracion_dias, plataformas(nombre)), cuentas_madre(correo_cuenta, cupos_ocupados, cupos_totales)',
      )
      .order('fecha_corte_cliente')
      .limit(300)
    if (error) throw new Error(errMsg(error))
    return (data ?? []) as SuscripcionRow[]
  })
}

export async function crearSuscripcion(input: {
  cliente_id: string
  plan_id: string
  cuenta_madre_id: string
  fecha_inicio: string
  fecha_corte_cliente: string
  estado: 'activa' | 'vencida' | 'cancelada'
}): Promise<string> {
  const { data, error } = await db
    .from('suscripciones')
    .insert({
      cliente_id: input.cliente_id,
      plan_id: input.plan_id,
      cuenta_madre_id: input.cuenta_madre_id,
      fecha_inicio: input.fecha_inicio,
      fecha_corte_cliente: input.fecha_corte_cliente,
      estado: input.estado,
    })
    .select('id')
    .single()
  if (error) throw new Error(errMsg(error))
  invalidar('susc', 'cuentas', 'resumen')
  return (data as { id: string }).id
}

export async function cambiarEstadoSuscripcion(
  id: string,
  estado: SuscripcionRow['estado'],
): Promise<void> {
  const { error } = await db
    .from('suscripciones')
    .update({ estado })
    .eq('id', id)
  if (error) throw new Error(errMsg(error))
  invalidar('susc', 'cuentas', 'resumen')
}

// -------------------------------------------------------------- Comisiones
export async function fetchComisiones(): Promise<ComisionRow[]> {
  return cached('comisiones', async () => {
    const { data, error } = await db
      .from('comisiones')
      .select('*, usuarios(nombre), pagos_ingresos(monto_pagado, moneda, tasa_bcv_aplicada, equivalente_usd, fecha_pago)')
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw new Error(errMsg(error))
    return (data ?? []) as ComisionRow[]
  })
}

export async function liquidarComision(id: string): Promise<void> {
  const { error } = await db
    .from('comisiones')
    .update({ estado: 'liquidada' })
    .eq('id', id)
  if (error) throw new Error(errMsg(error))
  invalidar('comisiones', 'resumen', 'ganancias')
}

// ---------------------------------------------------------- Ganancias (Bs)
// `v_ganancias` devuelve `numeric`, y numeric cruza la Function como texto (el
// contrato de `datos`): todo lo que sigue se convierte antes de sumar.
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function fetchGanancias(): Promise<GananciaRow[]> {
  return cached('ganancias', async () => {
    const { data, error } = await db
      .from('v_ganancias')
      .select('*')
      .order('fecha_pago', { ascending: false })
      .limit(1000)
    if (error) throw new Error(errMsg(error))
    return ((data ?? []) as unknown as GananciaRow[]).map((g) => ({
      ...g,
      fecha_pago: String(g.fecha_pago).slice(0, 10),
      monto_recibido: num(g.monto_recibido) ?? 0,
      bs_recibidos: num(g.bs_recibidos),
      tasa_del_dia: num(g.tasa_del_dia),
      usd_del_dia: num(g.usd_del_dia),
      usd_registrado: num(g.usd_registrado) ?? 0,
      diferencia_usd: num(g.diferencia_usd),
      asignado_usd: num(g.asignado_usd),
      comision_usd: num(g.comision_usd),
    }))
  })
}

// ------------------------------------------------------------- Tasa BCV
// Dos lecturas y un refresco:
//   · `GET /tasa` (pública, sin sesión) → lo último guardado CON fecha, fuente y
//     antigüedad. Es el camino de la tienda y del panel.
//   · la tabla `tasas_cambio` por RLS → solo admin, y sin fecha útil para
//     afirmar vigencia; queda de respaldo cuando la Function no contesta.
//   · `POST /` (la Function baja al BCV) → el refresco, necesita sesión.

// La fila de `tasas_cambio` se guarda con el «Fecha Valor» que publica el BCV,
// y esa fecha es un día adelante (el 25 se publica con fecha valor 26). Una
// fila vigente, entonces, tiene fecha mayor o igual a hoy. Si está por debajo,
// es el residuo de la última vez que alguien refrescó: usarla como «monto de
// hoy» es cobrar mal.
export const tasaVigente = (fecha: string | null | undefined): boolean =>
  fecha != null && fecha.slice(0, 10) >= hoy()

/** Quién publicó el número que se guardó. */
export type OrigenTasa = 'bcv-html' | 'dolarapi' | 'importada' | 'desconocida'

export const etiquetaOrigen = (o: OrigenTasa | null | undefined): string =>
  o === 'bcv-html'
    ? 'bcv.org.ve'
    : o === 'dolarapi'
      ? 've.dolarapi.com (promedio oficial del BCV)'
      : o === 'importada'
        ? 'importada del proyecto viejo'
        : 'sin marca de fuente'

export interface EstadoTasa {
  tasa: number | null
  eur: number | null
  /** Fecha Valor del BCV, o `null` si la fila no la trae. */
  fecha: string | null
  origen: OrigenTasa
  /** true cuando la fecha valor cubre hoy (el BCV publica con fecha valor un día adelante). */
  vigente: boolean
  /** Días de atraso de la fila respecto del día del servidor; negativa si aún cubre. */
  diasVieja: number | null
}

interface TasaPublicada {
  ok?: boolean
  fecha?: string
  tasa_bcv?: number
  tasa_eur_bs?: number | null
  fuente?: string
  vigente?: boolean
  dias_vieja?: number
  desvio_entre_fuentes?: number | null
  intentos?: Array<{ fuente: string; ok: boolean; ms?: number; error?: string }>
}

const esOrigen = (v: unknown): OrigenTasa =>
  v === 'bcv-html' || v === 'dolarapi' || v === 'importada' ? v : 'desconocida'

// La fila más reciente guardada, leída por la ruta pública. Si la Function no
// está desplegada o no hay red, se intenta la tabla (camino de admin) y la
// vigencia se calcula aquí con la fecha de la fila; sin fecha no se puede
// afirmar que sea la del día, y `fetchTasaBcv` lo interpreta como no vigente.
// Con caché corta: el checkout pide USD y EUR en paralelo, y sin ella serían
// dos viajes por cada vez que alguien abre la página.
async function tasaGuardada(): Promise<EstadoTasa> {
  return cached('tasa-publica', async () => {
    try {
      const res = await fetch(`${URL_TASA}/tasa`)
      if (res.ok) {
        const d = (await res.json()) as TasaPublicada
        const t = Number(d.tasa_bcv)
        const e = Number(d.tasa_eur_bs)
        if (t > 0)
          return {
            tasa: t,
            eur: Number.isFinite(e) && e > 0 ? e : null,
            // `fecha` llega como instante UTC ("2026-11-26T00:00:00.000Z") y
            // `fmtDate` lo leería como el 25 en Venezuela. La fecha valor es un
            // día, no una hora: se recorta acá para que toda la app la vea igual.
            fecha: d.fecha ? String(d.fecha).slice(0, 10) : null,
            origen: esOrigen(d.fuente),
            vigente: d.vigente ?? tasaVigente(d.fecha ?? null),
            diasVieja: typeof d.dias_vieja === 'number' ? d.dias_vieja : null,
          }
      }
    } catch {
      /* URL_TASA vacío en desarrollo local, o la Function no contesta */
    }
    const { data, error } = await db
      .from('tasas_cambio')
      .select('fecha, tasa_bcv, tasa_eur_bs, fuente')
      .order('fecha', { ascending: false })
      .limit(1)
    if (error) return { tasa: null, eur: null, fecha: null, origen: 'desconocida', vigente: false, diasVieja: null }
    const fila = (data ?? [])[0] as
      | { fecha?: string; tasa_bcv?: number | string; tasa_eur_bs?: number | string | null; fuente?: string | null }
      | undefined
    const t = Number(fila?.tasa_bcv)
    const e = Number(fila?.tasa_eur_bs)
    return {
      tasa: Number.isFinite(t) && t > 0 ? t : null,
      eur: Number.isFinite(e) && e > 0 ? e : null,
      fecha: fila?.fecha?.slice(0, 10) ?? null,
      origen: esOrigen(fila?.fuente),
      vigente: tasaVigente(fila?.fecha ?? null),
      diasVieja: null,
    }
  })
}

export type FuenteTasa = 'bcv-directo' | 'sistema' | 'ninguna'

/**
 * Tasa oficial del día, con su edad y su fuente. Es lo que hay que mostrar en
 * cualquier pantalla donde el número se usa para cobrar.
 */
export async function fetchEstadoTasa(): Promise<EstadoTasa> {
  return tasaGuardada()
}

/**
 * Solo la tasa si está vigente. Devuelve `null` cuando la fila guardada es de un
 * día anterior, aunque exista: un formulario de cobro prellenado con 42,50
 * produce un monto 21 veces más alto, y eso es peor que un campo vacío.
 */
export async function fetchTasaDelDia(): Promise<number | null> {
  const e = await tasaGuardada()
  return e.vigente ? e.tasa : null
}

// Tasa € → Bs del día (Pago Móvil de las Apple Gift Cards, ancladas al euro).
// Vive en `tasas_cambio.tasa_eur_bs`. Misma regla de vigencia que el USD: sin
// fecha valor de hoy no se presta para un cobro.
export async function fetchTasaEurDelDia(): Promise<number | null> {
  try {
    const e = await tasaGuardada()
    return e.vigente ? e.eur : null
  } catch {
    return null
  }
}

/**
 * Tasa oficial del día.
 *
 * `forzar: true`  → invoca la Function `tasabcv` para que baje al BCV y guarde
 *                   la fila (el botón «Actualizar tasa» de Pagos; requiere
 *                   sesión porque la Function la autoriza con el token de datos).
 * `forzar: false` → lectura de `GET /tasa`: lo último guardado, sin egreso al
 *                   BCV y sin sesión. Pero si esa fila ya no está vigente (su
 *                   fecha valor quedó atrás) se baja a raspar igual, porque el
 *                   número sale en una pantalla donde el cliente va a pagar.
 *
 * En la versión de Supabase el checkout rapeaba en cada carga usando la anon
 * key. Con la tasa del día ya guardada eso dejó de tener sentido (un egreso y
 * una escritura por visita), así que ahora el raspe solo ocurre cuando lo
 * guardado no sirve: tabla vacía —las primeras horas tras la migración, o una
 * rama recién creada— o fecha vencida. Medido el 2026-11-25: sin esta
 * condición `tasas_cambio` tenía una sola fila, del 2026-09-20 a 42,50, cuando
 * el BCV publicaba 924,35. Un cobro en Bs calculado con esa fila sale mal por
 * 21 veces.
 */
export async function fetchTasaBcv(
  opciones: { forzar?: boolean } = {},
): Promise<{
  tasa: number | null
  eur: number | null
  fuente: FuenteTasa
  origen: OrigenTasa
  fecha: string | null
  vigente: boolean
  desvio: number | null
}> {
  const leidos = await tasaGuardada()
  const envoltura = (extra: Partial<EstadoTasa> = {}, fuente: FuenteTasa) => ({
    tasa: leidos.tasa,
    eur: leidos.eur,
    fecha: leidos.fecha,
    origen: leidos.origen,
    vigente: leidos.vigente,
    desvio: null,
    ...extra,
    fuente,
  })

  const irAlBcv = async () => {
    try {
      const token = await tokenParaDatos()
      const res = await fetch(`${URL_TASA}/`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}`} : {}),
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
      if (!res.ok) return null
      const data = (await res.json()) as TasaPublicada
      const t = Number(data.tasa_bcv)
      if (!data.ok || !(t > 0)) return null
      // El raspado escribió: las lecturas anteriores quedan obsoletas.
      invalidar('tasa', 'tasa-publica')
      const eur = Number(data.tasa_eur_bs)
      const fecha = data.fecha ? String(data.fecha).slice(0, 10) : null
      return {
        tasa: t,
        eur: eur > 0 ? eur : null,
        fuente: 'bcv-directo' as const,
        origen: esOrigen(data.fuente),
        fecha,
        vigente: data.vigente ?? tasaVigente(fecha),
        desvio: typeof data.desvio_entre_fuentes === 'number' ? data.desvio_entre_fuentes : null,
      }
    } catch {
      // Function dormida, sin sesión o sin conexión.
      return null
    }
  }

  if (opciones.forzar || leidos.tasa == null || !leidos.vigente) {
    const fresca = await irAlBcv()
    if (fresca) return fresca
  }
  return leidos.tasa != null
    ? envoltura({}, 'sistema')
    : {
        tasa: null,
        eur: null,
        fecha: null,
        vigente: false,
        desvio: null,
        origen: 'desconocida' as OrigenTasa,
        fuente: 'ninguna' as const,
      }
}

// --------------------------------------------------------------- Pagos
export async function registrarPago(input: {
  cliente_id: string
  monto_pagado: number
  moneda: Moneda
  tasa_bcv_aplicada: number | null
  tasa_cambio_binance: number | null
  equivalente_usd: number
  metodo_pago: string
  fecha_pago: string
  asignados: Array<{ suscripcion_id: string; monto_usd: number }>
}): Promise<void> {
  // 1) Insertar el pago (ingreso)
  const { data, error } = await db
    .from('pagos_ingresos')
    .insert({
      cliente_id: input.cliente_id,
      monto_pagado: input.monto_pagado,
      moneda: input.moneda,
      tasa_bcv_aplicada: input.tasa_bcv_aplicada,
      tasa_cambio_binance: input.tasa_cambio_binance,
      equivalente_usd: input.equivalente_usd,
      metodo_pago: input.metodo_pago || null,
      fecha_pago: input.fecha_pago,
    })
    .select('id')
    .single()
  if (error) throw new Error(errMsg(error))

  const pagoId = (data as { id: string }).id

  // 2) Distribuir en suscripciones (trigger generará comisión si aplica)
  const rows = input.asignados.map((a) => ({
    pago_ingreso_id: pagoId,
    suscripcion_id: a.suscripcion_id,
    monto_asignado_usd: round2(a.monto_usd),
  }))
  if (rows.length > 0) {
    const { error: err2 } = await db.from('pago_suscripciones').insert(rows)
    if (err2) throw new Error(errMsg(err2))
  }
  invalidar('pagos', 'comisiones', 'resumen', 'ganancias', 'tasa')
}

/** Asignación actual de un pago (para prellenar el formulario al editar). */
export async function fetchAsignacionesDePago(
  pagoId: string,
): Promise<Array<{ suscripcion_id: string; monto_usd: number }>> {
  const { data, error } = await db
    .from<Array<{ suscripcion_id: string; monto_asignado_usd: number | string }>>(
      'pago_suscripciones',
    )
    .select('suscripcion_id, monto_asignado_usd')
    .eq('pago_ingreso_id', pagoId)
  if (error) throw new Error(errMsg(error))
  return (data ?? []).map((r) => ({
    suscripcion_id: r.suscripcion_id,
    monto_usd: Number(r.monto_asignado_usd),
  }))
}

/** Reemplaza un pago y su distribución de forma atómica (RPC editar_pago). */
export async function actualizarPago(
  pagoId: string,
  input: {
    cliente_id: string
    monto_pagado: number
    moneda: Moneda
    tasa_bcv_aplicada: number | null
    tasa_cambio_binance: number | null
    equivalente_usd: number
    metodo_pago: string
    fecha_pago: string
    asignados: Array<{ suscripcion_id: string; monto_usd: number }>
  },
): Promise<void> {
  const { error } = await db.rpc('editar_pago', {
    p_pago_id: pagoId,
    p_cliente_id: input.cliente_id,
    p_monto_pagado: input.monto_pagado,
    p_moneda: input.moneda,
    p_tasa_bcv_aplicada: input.tasa_bcv_aplicada,
    p_tasa_cambio_binance: input.tasa_cambio_binance,
    p_equivalente_usd: input.equivalente_usd,
    p_metodo_pago: input.metodo_pago,
    p_fecha_pago: input.fecha_pago,
    p_asignados: input.asignados.map((a) => ({
      suscripcion_id: a.suscripcion_id,
      monto_usd: a.monto_usd,
    })),
  })
  if (error) throw new Error(errMsg(error))
  invalidar('pagos', 'comisiones', 'resumen', 'ganancias')
}

/** Borra un pago (cascada: asignaciones y comisión asociada). */
export async function eliminarPago(pagoId: string): Promise<void> {
  const { error } = await db.from('pagos_ingresos').delete().eq('id', pagoId)
  if (error) throw new Error(errMsg(error))
  invalidar('pagos', 'comisiones', 'resumen', 'ganancias')
}

export async function fetchPagos(): Promise<PagoRow[]> {
  return cached('pagos', async () => {
    const { data, error } = await db
      .from('pagos_ingresos')
      .select('*, usuarios(nombre)')
      .order('fecha_pago', { ascending: false })
      .limit(500)
    if (error) throw new Error(errMsg(error))
    return (data ?? []) as PagoRow[]
  })
}

// ------------------------------------------------------------- Dashboard
export async function fetchVencimientosProveedores(): Promise<
  VencimientoProveedor[]
> {
  return cached('vencimientos', async () => {
    const { data, error } = await db
      .from('v_vencimientos_proveedores')
      .select('*')
      .order('dias_restantes')
    if (error) throw new Error(errMsg(error))
    return (data ?? []) as VencimientoProveedor[]
  })
}

export interface Resumen {
  clientes: number
  suscripcionesActivas: number
  suscripcionesVencidas: number
  comisionesPendientesUSD: number
  /** Ingresos del mes en Bs divididos por la tasa oficial de cada día. */
  ingresosMesUSD: number
  /** Suma de los bolívares que realmente entraron este mes. */
  bsMes: number
  /** Lo que se pagó a proveedores este mes; 0 si nadie ha cargado egresos. */
  egresosMesUSD: number
  gananciaMesUSD: number
  /** Lo mismo pero sobre todo el historial, para el rango ancho de Ganancias. */
  ingresosTotalesUSD: number
  bsTotal: number
  egresosTotalesUSD: number
  gananciaTotalUSD: number
  /** Cuántos USD de diferencia hay entre lo guardado y lo recalculado en Bs. */
  diferenciaMesUSD: number
  tasa: EstadoTasa
}

// Los contadores del dashboard, con el dinero en la única moneda que entró
// intacta al país: los bolívares. `ingresosMesUSD` sale de `v_ganancias`
// (monto recibido ÷ tasa del día de ESE cobro), no de `equivalente_usd`, que es
// el número que alguien escribió al guardar el pago. Si ese número se escribió
// con una tasa vencida, el dashboard repetía el error; ahora se ve la
// diferencia en `diferenciaMesUSD`.
export async function fetchResumen(): Promise<Resumen> {
  return cached('resumen', async () => {
    const desde = hoy().slice(0, 7) + '-01'
    const [clientes, activas, vencidas, comPend, egresos, egresosTodo, ganancias, tasa] =
      await Promise.all([
        db
          .from('usuarios')
          .select('id', { count: 'exact', head: true })
          .eq('rol', 'cliente'),
        db
          .from('suscripciones')
          .select('id', { count: 'exact', head: true })
          .eq('estado', 'activa'),
        db
          .from('suscripciones')
          .select('id', { count: 'exact', head: true })
          .eq('estado', 'vencida'),
        db.from('comisiones').select('monto_comision_usd').eq('estado', 'pendiente'),
        db
          .from('pagos_egresos')
          .select('monto_pagado_usd')
          .gte('fecha_pago', desde),
        // El historial completo, sin filtro de fecha: la pantalla de ganancias
        // deja elegir «todo el historial», y sin este número la ganancia del
        // rango ancho sería un ingreso menos nada.
        db.from('pagos_egresos').select('monto_pagado_usd'),
        fetchGanancias().catch(() => [] as GananciaRow[]),
        fetchEstadoTasa().catch(() => ({
          tasa: null,
          eur: null,
          fecha: null,
          origen: 'desconocida' as OrigenTasa,
          vigente: false,
          diasVieja: null,
        })),
      ])

    if (clientes.error || activas.error || vencidas.error || comPend.error || egresos.error || egresosTodo.error)
      throw new Error('No se pudo consultar el resumen')

    const sumCom = (rows: Array<{ monto_comision_usd: number | string }>) =>
      rows.reduce((acc, r) => acc + Number(r.monto_comision_usd ?? 0), 0)

    const delMes = ganancias.filter((g) => g.fecha_pago >= desde)
    const ingresosMesUSD = round2(
      delMes.reduce((acc, g) => acc + (g.usd_del_dia ?? g.usd_registrado), 0),
    )
    const egresosMesUSD = round2(
      ((egresos.data ?? []) as Array<{ monto_pagado_usd: number | string }>).reduce(
        (acc, r) => acc + Number(r.monto_pagado_usd ?? 0),
        0,
      ),
    )

    const egresosTodoUSD = round2(
      ((egresosTodo.data ?? []) as Array<{ monto_pagado_usd: number | string }>).reduce(
        (acc, r) => acc + Number(r.monto_pagado_usd ?? 0),
        0,
      ),
    )
    const ingresosTotalesUSD = round2(
      ganancias.reduce((acc, g) => acc + (g.usd_del_dia ?? g.usd_registrado), 0),
    )

    return {
      clientes: clientes.count ?? 0,
      suscripcionesActivas: activas.count ?? 0,
      suscripcionesVencidas: vencidas.count ?? 0,
      comisionesPendientesUSD: round2(
        sumCom((comPend.data ?? []) as Array<{ monto_comision_usd: number | string }>),
      ),
      ingresosMesUSD,
      bsMes: round2(delMes.reduce((acc, g) => acc + (g.bs_recibidos ?? 0), 0)),
      egresosMesUSD,
      gananciaMesUSD: round2(ingresosMesUSD - egresosMesUSD),
      ingresosTotalesUSD,
      bsTotal: round2(ganancias.reduce((acc, g) => acc + (g.bs_recibidos ?? 0), 0)),
      egresosTotalesUSD: egresosTodoUSD,
      gananciaTotalUSD: round2(ingresosTotalesUSD - egresosTodoUSD),
      diferenciaMesUSD: round2(
        delMes.reduce((acc, g) => acc + (g.diferencia_usd ?? 0), 0),
      ),
      tasa,
    }
  })
}