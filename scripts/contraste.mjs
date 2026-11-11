/* ============================================================
   scripts/contraste.mjs — los números que sostienen la escala de grises
   ------------------------------------------------------------
   El barrido de `slate-*` a tokens de la marca cambia tintas, y una tinta
   se justifica con un ratio de contraste, no con una opinión. Este script
   calcula el ratio WCAG 2.1 de los pares que intervienen en el cambio y
   sale con código distinto de cero si alguno de los dos textos que van a
   quedar en el CSS se baja del umbral que declara.

   node scripts/contraste.mjs
   ============================================================ */

const lum = (hex) => {
  const [r, g, b] = hex
    .replace("#", "")
    .match(/.{2}/g)
    .map((c) => parseInt(c, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

const BLANCO = "#ffffff";
const PARES = [
  /* [etiqueta, tinta, fondo, umbral exigido, nota] */
  ["text-blink-dark sobre blanco", "#1d1d1f", BLANCO, 4.5, "texto normal"],
  ["text-blink-muted sobre blanco", "#424242", BLANCO, 4.5, "texto secundario"],
  ["text-blink-ink-mute sobre blanco", "#6a6a6f", BLANCO, 4.5, "la tinta nueva (era slate-500/400)"],
  ["text-blink-ink-mute sobre blink-fill", "#6a6a6f", "#f7f7fa", 4.5, "la misma tinta sobre fila alterna"],
  ["text-blink-ink-mute sobre blink-fill-strong", "#6a6a6f", "#ececf0", 4.5, "sobre chip/badge"],
  /* lo que se abandona, para que la comparación esté en el mismo archivo */
  ["slate-500 sobre blanco (antes)", "#64748b", BLANCO, 4.5, "se iba por esta", true],
  ["slate-400 sobre blanco (antes)", "#94a3b8", BLANCO, 4.5, "no pasaba ni AA de grande", true],
  /* los azules que ya estaban declarados en el @theme */
  ["blanco sobre text-blink-action", BLANCO, "#0066cc", 4.5, "relleno de botón"],
  ["blanco sobre azul de marca", BLANCO, "#007aff", 3.0, "solo titulares grandes"],
  ["blanco sobre blink-scrim (aprox.)", "#ffffff", "#737373", 1.0, "la vela es decorativa"],
];

let fallos = 0;
for (const [nombre, tinta, fondo, umbral, nota, informativo] of PARES) {
  const r = ratio(tinta, fondo);
  const ok = r >= umbral;
  if (!ok && !informativo) fallos += 1;
  console.log(
    `${informativo ? "·" : ok ? "✓" : "✗"}  ${r.toFixed(2).padStart(5)}:1  (exigido ≥ ${umbral})  ${nombre}  · ${nota}`,
  );
}

/* Los bordes no son texto: se reportan solo para que quede constancia de
   que la línea sigue siendo visible sobre las dos superficies de trabajo. */
for (const [nombre, hex] of [["blink-line", "#e5e5ea"], ["blink-line-strong", "#d1d1d6"]]) {
  console.log(`   ${ratio(hex, BLANCO).toFixed(2)}:1  ${nombre} vs blanco  (decorativo, no aplica AA)`);
}

if (fallos > 0) {
  console.error(`✗ ${fallos} pares por debajo de su umbral`);
  process.exit(1);
}
console.log("✓ todos los pares de tinta alcanzan el umbral que declara el comentario de @theme");
