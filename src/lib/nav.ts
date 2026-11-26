// Ruta a la que volver después de autenticarse, llevada en `location.state`
// por quien mandó al cliente a registrar o entrar (hoy: /checkout).
// Se acepta solo una ruta interna: `//host` saltaría fuera del sitio.
export function rutaVolver(state: unknown): string | null {
  const r = (state as { volver?: unknown } | null)?.volver
  return typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') ? r : null
}
