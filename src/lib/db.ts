// ============================================================
//  src/lib/db.ts — el cliente de datos, con la forma de supabase-js
// ============================================================
//  Por qué existe este archivo en vez de un find/replace a `client.from()`
//  (que era el plan original, vía @neon/neon-js/supabase): el gate midió que
//  la Data API de Neon con JWT propio no es fiable (piloto/RESULTADOS.md),
//  así que los datos autenticados pasan por la Function `datos`. Si además
//  reescribiera las 42 llamadas de api.ts a endpoints hechos a medida, el
//  diff de esta migración sería ilegible y cada endpoint nuevo sería una
//  superficie sin revisar.
//
//  Entonces: el builder registra la cadena tal cual la escribiría
//  supabase-js y la manda como datos al servidor, que la compila a SQL
//  parametrizado. api.ts sigue diciendo
//      .from('suscripciones').select('*, usuarios(nombre)').eq('estado','activa')
//      .order('fecha_corte_cliente').limit(300)
//  y la única línea que cambia es el import. La fidelidad importa de verdad
//  en tres sitios: `single` devuelve objeto y no arreglo; `head:true + count`
//  devuelve `count` con `data:null`; y el error trae `.message` porque eso es
//  lo que lee errMsg().
//
//  El token de datos se adjunta si hay sesión; si no, la llamada sale
//  anónima y RLS responde con el catálogo público — que es exactamente como
//  funcionaba con la anon key, pero sin una clave compartida en el bundle.

import { URL_DATOS } from './entorno'
import { invalidarToken, reacuñar, tokenParaDatos } from './sesion'

type Llamada = [string, ...unknown[]]

export interface ErrorDatos {
  message: string
  code?: string
  details?: string
  hint?: string
}

export interface Resultado<T = any> {
  data: T | null
  error: ErrorDatos | null
  count: number | null
}

const cabeceras = (token: string | null): HeadersInit => ({
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
})

async function enviar(
  ruta: '/consulta' | '/rpc',
  cuerpo: unknown,
  reintento = true,
): Promise<Resultado> {
  let token: string | null
  try {
    token = await tokenParaDatos()
  } catch {
    token = null
  }

  let res: Response
  try {
    res = await fetch(`${URL_DATOS}${ruta}`, {
      method: 'POST',
      headers: cabeceras(token),
      body: JSON.stringify(cuerpo),
      credentials: 'omit',
    })
  } catch (e) {
    return {
      data: null,
      count: null,
      error: { message: `sin conexión con la base de datos: ${(e as Error).message}` },
    }
  }

  // 401 con token: el de datos venció (dura 15 min). Se reacuña y se pita
  // una sola vez; si aun así falla, es que la sesión se fue y el front debe
  // volver al login, no reintentar en bucle.
  if (res.status === 401 && reintento && token) {
    invalidarToken()
    await reacuñar(true)
    return enviar(ruta, cuerpo, false)
  }

  let cuerpoRespuesta: Partial<Resultado> | null = null
  try {
    cuerpoRespuesta = (await res.json()) as Partial<Resultado>
  } catch {
    /* la Function dormida, un proxy delante, o un HTML de error */
  }

  if (!res.ok && !cuerpoRespuesta?.error) {
    return {
      data: null,
      count: null,
      error: { message: `la base de datos respondió HTTP ${res.status}`, code: String(res.status) },
    }
  }

  return {
    data: cuerpoRespuesta?.data ?? null,
    count: cuerpoRespuesta?.count ?? null,
    error: cuerpoRespuesta?.error ?? null,
  }
}

class Constructora<T = any> implements PromiseLike<Resultado<T>> {
  private llamadas: Llamada[] = []
  private promesa: Promise<Resultado<T>> | null = null
  private readonly recurso: string

  // Sin parameter property (`constructor(private readonly recurso)`) porque
  // el tsconfig trae `erasableSyntaxOnly: true`: esa sintaxis deja asignación
  // en el emitido y el compilador la rechaza.
  constructor(recurso: string) {
    this.recurso = recurso
  }

  // supabase-js es thenable: `await supabase.from(...).select(...)`. Aquí el
  // await dispara la petición, una sola vez por cadena aunque alguien la
  // espere dos veces.
  then<TResult1 = Resultado<T>, TResult2 = never>(
    onfulfilled?: ((r: Resultado<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((razon: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    if (!this.promesa) {
      this.promesa = enviar('/consulta', { from: this.recurso, calls: this.llamadas }).then(
        (r) => r as Resultado<T>,
      )
    }
    return this.promesa.then(onfulfilled, onrejected)
  }

  private anotar(...c: Llamada): this {
    this.llamadas.push(c)
    return this
  }

  select(columnas = '*', opciones?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
    return this.anotar('select', columnas, ...(opciones ? [opciones] : []))
  }

  insert(valores: Record<string, unknown> | Record<string, unknown>[]) {
    return this.anotar('insert', valores)
  }

  /** El viejo `.upsert` no se usa en Plans; si alguien lo pide, que sea
   *  explícito que todavía no está implementado en la Function. */
  update(valores: Record<string, unknown>) {
    return this.anotar('update', valores)
  }

  delete() {
    return this.anotar('delete')
  }

  eq(col: string, val: unknown) {
    return this.anotar('eq', col, val)
  }
  neq(col: string, val: unknown) {
    return this.anotar('neq', col, val)
  }
  gt(col: string, val: unknown) {
    return this.anotar('gt', col, val)
  }
  gte(col: string, val: unknown) {
    return this.anotar('gte', col, val)
  }
  lt(col: string, val: unknown) {
    return this.anotar('lt', col, val)
  }
  lte(col: string, val: unknown) {
    return this.anotar('lte', col, val)
  }
  like(col: string, val: string) {
    return this.anotar('like', col, val)
  }
  ilike(col: string, val: string) {
    return this.anotar('ilike', col, val)
  }
  is(col: string, val: null | boolean) {
    return this.anotar('is', col, val)
  }
  in(col: string, vals: unknown[]) {
    return this.anotar('in', col, vals)
  }

  order(col: string, opciones?: { ascending?: boolean; nullsFirst?: boolean }) {
    return this.anotar('order', col, opciones ?? {})
  }

  limit(n: number) {
    return this.anotar('limit', n)
  }

  /** Como supabase-js: límites INCLUSIVE, así que la cantidad es hasta-desde+1. */
  range(desde: number, hasta: number) {
    return this.anotar('range', desde, hasta - desde + 1)
  }

  single() {
    return this.anotar('single')
  }

  maybeSingle() {
    return this.anotar('maybeSingle')
  }
}

export interface ClienteDatos {
  from<T = any>(recurso: string): Constructora<T>
  rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<Resultado<T>>
}

export const db: ClienteDatos = {
  from: <T>(recurso: string) => new Constructora<T>(recurso),
  rpc: async <T>(fn: string, args: Record<string, unknown>) =>
    (await enviar('/rpc', { fn, args })) as Resultado<T>,
}
