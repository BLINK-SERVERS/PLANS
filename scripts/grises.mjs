#!/usr/bin/env node
// ============================================================
//  scripts/grises.mjs — el barrido de los grises slate a tokens
// ============================================================
//  Deja de ser un find/replace a medida que crece el panel: la tabla vive
//  en el comentario de `@theme` (src/index.css) y aquí está en el mismo
//  orden, porque el ORDEN ES EL RESULTADO. Si primero se sustituye la regla
//  pelada `bg-slate-100 → bg-blink-fill`, la variante `hover:bg-slate-100`
//  se reemplaza con ella y termina en `hover:bg-blink-fill` — gris en vez
//  del velo de acento al 8 % que pide HIG. Por eso las reglas `hover:` van
//  delante, y por eso este archivo las recorre de arriba abajo sin mezclar.
//
//  Cada regla es una cadena literal: no hay regex que pueda comerse
//  `translate-y` (que contiene "slate" y se habría llevado por delante un
//  patrón `slate-\w` relajado).
//
//  Se ejecuta, no se lee: `npm run grises` reescribe src/**/*.tsx y deja
//  el diff a la vista con git. Idempotente — la segunda pasada no cambia
//  nada porque ya no queda ningún literal que casar.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REGLAS = [
  // — variantes first: definen el estado, la pelada definiría la superficie
  ['hover:bg-slate-100', 'hover:bg-blink-soft'],
  ['hover:bg-slate-50', 'hover:bg-blink-soft'],
  ['hover:bg-slate-200', 'hover:bg-blink-fill-strong'],
  ['hover:border-slate-300', 'hover:border-blink-line-strong'],
  // — tinta: tres niveles, no cinco. slate-400 (2,56:1) y slate-500 bajaban
  //   juntos a una tinta que sí pasa AA; slate-900/800 suben a la misma.
  ['text-slate-900', 'text-blink-dark'],
  ['text-slate-800', 'text-blink-dark'],
  ['text-slate-700', 'text-blink-muted'],
  ['text-slate-600', 'text-blink-muted'],
  ['text-slate-500', 'text-blink-ink-mute'],
  ['text-slate-400', 'text-blink-ink-mute'],
  // — líneas
  ['border-slate-200', 'border-blink-line'],
  ['border-slate-300', 'border-blink-line-strong'],
  ['divide-slate-100', 'divide-blink-line'],
  // — rellenos
  ['bg-slate-50', 'bg-blink-fill'],
  ['bg-slate-100', 'bg-blink-fill'],
  ['bg-slate-200', 'bg-blink-fill-strong'],
  // — la vela de los modales: negra con alpha, no gris opaco
  ['bg-slate-900/50', 'bg-blink-scrim'],
]

function tsx(dir, dentro = '') {
  return readdirSync(join(dir, dentro)).flatMap((nombre) => {
    const ruta = join(dentro, nombre)
    if (statSync(join(dir, ruta)).isDirectory()) return tsx(dir, ruta)
    return /\.(tsx|jsx)$/.test(nombre) ? [join(dir, ruta)] : []
  })
}

const raiz = process.argv[2] ?? 'src'
const archivos = tsx(process.cwd(), raiz).filter((r) => r.endsWith('.tsx'))

let total = 0
const porRegla = new Map()

for (const ruta of archivos) {
  const original = readFileSync(ruta, 'utf8')
  let texto = original
  for (const [de, a] of REGLAS) {
    const n = texto.split(de).length - 1
    if (!n) continue
    texto = texto.split(de).join(a)
    total += n
    porRegla.set(de, (porRegla.get(de) ?? 0) + n)
  }
  if (texto !== original) writeFileSync(ruta, texto)
}

// El control: si quedó algún `slate-<número>` fuera de un comentario, el
// barrido está incompleto y esto tiene que sonar.
const sobrantes = []
for (const ruta of archivos) {
  readFileSync(ruta, 'utf8')
    .split('\n')
    .forEach((linea, i) => {
      const c = linea.match(/(?:bg|text|border|divide)-slate-\d+(?:\/\d+)?/g)
      if (c) sobrantes.push(`${ruta}:${i + 1} ${c.join(' ')}`)
    })
}

console.log(`barrido: ${total} clases en ${archivos.length} archivos`)
for (const [de, n] of [...porRegla].sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(n).padStart(3)}×  ${de}`)

if (sobrantes.length) {
  console.error(`\n✗ quedan ${sobrantes.length} grises de Tailwind:`)
  sobrantes.forEach((s) => console.error(`  ${s}`))
  process.exit(1)
}
console.log('\n✓ no queda ningún slate-* en los tsx')
