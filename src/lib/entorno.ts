// ============================================================
//  src/lib/entorno.ts — de dónde vienen las tres URLs públicas
// ============================================================
//  Son las ÚNICAS variables de entorno que llegan al bundle. Las tres son
//  públicas por naturaleza (la URL de una Function no es un secreto: quien
//  abre la tienda ya la ve en la Red de Chrome); lo privado —la cadena de
//  conexión, los secretos de firma— vive solo en el despliegue de Neon y lo
//  inyecta neon.ts.
//
//  VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY se jubilan con este archivo.
//  La anon key de Supabase ya no existe en este proyecto: no hay service_role
//  que publicar ni una clave publicable que embutir, porque la autorización
//  la decide RLS sobre el rol del token, no una clave compartida por todos
//  los visitantes.

/** Base de la Function `datos` (la API de datos con RLS). */
export const URL_DATOS: string = import.meta.env.VITE_BLINK_DATOS_URL ?? ''

/** Base de la Function `auth` (Better Auth self-hosted). */
export const URL_AUTH: string = import.meta.env.VITE_BLINK_AUTH_URL ?? ''

/** Base de la Function `tasabcv` (tasa BCV + vencimientos). */
export const URL_TASA: string = import.meta.env.VITE_BLINK_TASA_URL ?? ''

/**
 * Viaja en Authorization de cada llamada. Se guarda en sessionStorage, no en
 * localStorage: un token de sesión robado de un ordenador compartido dura 30
 * días, y aquí basta con perder la sesión al cerrar la pestaña. El token de
 * datos además dura 15 minutos y se reacuña solo.
 */
export const CLAVE_TOKEN = 'blink.plans.sesion'

export const entornoListo = (): boolean => Boolean(URL_DATOS && URL_AUTH)
