/**
 * Marca Blink — isotipo aprobado, copiado VERBATIM del SVG del
 * ecosistema (BWS/src/assets/marca-blink-isotipo.svg).
 *
 * No se redibuja nada: son las tres figuras aprobadas (ojo guiñado,
 * ojo abierto y boca) con su geometría original y el mismo viewBox.
 * `fill="currentColor"` hace que herede el color del contenedor, así
 * que sale blanco sobre el badge azul de marca y azul sobre fondo claro.
 *
 * Cambiar esto es cambiar la marca: si necesitas otra cosa, se pide al
 * skill de diseño de Blink, no se edita a mano.
 */
export function MarcaBlink({ className = '' }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="76 114 360 284"
      shapeRendering="geometricPrecision"
      fill="currentColor"
      className={className}
      role="img"
      aria-label="Blink"
    >
      <title>Isotipo Blink</title>
      <path d="M 122 164 H 178 C 198 164 224 164 224 198 C 224 232 198 232 178 232 H 122 C 102 232 76 232 76 198 C 76 164 102 164 122 164 Z" />
      <path d="M 436 182 A 68 68 0 1 1 299.99 182 A 68 68 0 1 1 436 182 Z" />
      <path d="M 212 286 H 300 C 331.55 286 340.42 286 337.5 314 C 332.064081 366.125250 298 398 256 398 C 214 398 179.935919 366.125250 174.5 314 C 171.58 286 180.45 286 212 286 Z" />
    </svg>
  )
}
