/* ============================================================
   scripts/marca.mjs — los entregables de marca de Blink Plans
   ------------------------------------------------------------
   Produce, en un solo comando y desde los masters aprobados:

     · public/favicon.svg            (el master de favicon, copiado tal cual)
     · public/favicon-16.png / 32.png / 180.png / 512.png
     · public/og.png                 1200×630 exactos

   y antes de escribir nada comprueba lo único que importa: que los tres
   trazos del isotipo que viajan en cada composición son EXACTAMENTE los del
   master, carácter por carácter. Si uno solo difiere, el script sale con
   código distinto de cero y no toca ningún archivo. No se redibuja la marca
   aquí; se le da contexto (campo azul, blanco de marca, centro geométrico).

   Por qué rasteriza Chromium y no ImageMagick: `convert` delega SVG a
   `rsvg-convert` — que no está instalado en esta máquina — o a su renderer
   interno MSVG, que no implementa `currentColor`, los `transform` anidados ni
   el kerning de texto. El PNG tiene que coincidir con lo que ve el navegador
   que va a servir el SVG, así que se rasteriza en el navegador.

   La tarjeta OG no la diseña un ilustrador: la diseña el propio producto. Se
   monta con los mismos ingredientes del panel —el wordmark aprobado inline,
   el descriptor en la pila de la CAPA 1 de `src/index.css`, los tokens de la
   marca— para que el enlace compartido no parezca de un sitio distinto. El
   campo es el azul de marca #007AFF y la tinta el blanco #FFFEFB, la misma
   convención del icono de Blink Pay. No se redistribuye SF Pro: la pila pide
   Inter, que es el respaldo documentado de la CAPA 1 y está en el repo bajo
   SIL OFL (src/assets/fonts/LICENSE-Inter.txt).

   CHROMIUM_PATH=/usr/bin/chromium node scripts/marca.mjs
   ============================================================ */
import { chromium } from "playwright-core";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

const RAIZ = new URL("..", import.meta.url);
const MARCA = (n) => new URL(`src/assets/marca/${n}`, RAIZ);
const PUB = (n) => new URL(`public/${n}`, RAIZ);

/* ---------- 1. la prueba de la silueta: `===`, no a ojo ---------------- */
const MAESTRO = readFileSync(MARCA("blink-isotipo.svg"), "utf8");
const trazosMaestro = [...MAESTRO.matchAll(/ d="([^"]*)"/g)].map((m) => m[1]);
if (trazosMaestro.length !== 3) {
  console.error(`✗ el master del isotipo debe tener 3 trazos y tiene ${trazosMaestro.length}`);
  process.exit(1);
}

const limpiarsvg = (archivo) =>
  readFileSync(MARCA(archivo), "utf8")
    .replace(/<\?xml[^>]*\?>/, "")
    .replace(/\sid="[^"]*"/g, "")
    .replace(/\s(?:xmlns:|inkscape:)[a-z-]+="[^"]*"/g, "");

const wordmark = limpiarsvg("blink-wordmark.svg");

const COMPOSICIONES = ["blink-plans-favicon.svg", "blink-plans-icono-app.svg"];
for (const nombre of COMPOSICIONES) {
  const codigo = readFileSync(MARCA(nombre), "utf8");
  const trazos = [...codigo.matchAll(/ d="([^"]*)"/g)].map((m) => m[1]);
  if (trazos.length !== 3) {
    console.error(`✗ ${nombre}: se esperaban 3 trazos y se encontraron ${trazos.length}`);
    process.exit(1);
  }
  trazos.forEach((d, i) => {
    if (d !== trazosMaestro[i]) {
      console.error(`✗ ${nombre}: el trazo ${i + 1} no es idéntico al del master`);
      process.exit(1);
    }
  });
  console.log(`✓ ${nombre}: los 3 trazos del isotipo son idénticos al master (===)`);
}

/* ---------- 2. el favicon SVG es el master, sin intermediarios --------- */
copyFileSync(MARCA("blink-plans-favicon.svg"), PUB("favicon.svg"));
console.log("✓ public/favicon.svg  (copia literal del master)");

/* ---------- 3. raster ----------------------------------------------- */
const JOBS = [
  { src: "blink-plans-favicon.svg", out: "favicon-32.png", size: 32 },
  { src: "blink-plans-favicon.svg", out: "favicon-16.png", size: 16 },
  { src: "blink-plans-icono-app.svg", out: "apple-touch-icon.png", size: 180 },
  { src: "blink-plans-icono-app.svg", out: "icono-512.png", size: 512 },
];

const navegador = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
});

for (const job of JOBS) {
  const svg = readFileSync(MARCA(job.src), "utf8").replace(/<\?xml[^>]*\?>/, "");
  const pagina = await navegador.newPage({ viewport: { width: job.size, height: job.size } });
  await pagina.setContent(
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0}` +
      `svg{display:block;width:${job.size}px;height:${job.size}px}</style>${svg}`,
    { waitUntil: "load" },
  );
  const png = await pagina.screenshot({ clip: { x: 0, y: 0, width: job.size, height: job.size } });
  writeFileSync(PUB(job.out), png);
  await pagina.close();
  console.log(`✓ public/${job.out}  ${job.size}×${job.size}  ${(png.length / 1024).toFixed(1)} KB`);
}

/* ---------- 4. la tarjeta para compartir: 1200×630 exactos ------------ */
const INTER = readFileSync(new URL("src/assets/fonts/inter-latin.woff2", RAIZ));
const urlInter = `data:font/woff2;base64,${INTER.toString("base64")}`;
const ANCHO = 1200;
const ALTO = 630;

const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<style>
  /* CAPA 1 de src/index.css, sin SF Pro redistribuido: en Apple el sistema
     pondría SF Pro; aquí se fija Inter, que es el respaldo que el panel ya
     usa en Windows y Linux. La tarjeta sale con la misma cara que la app. */
  @font-face {
    font-family: "Inter";
    src: url("${urlInter}") format("woff2");
    font-weight: 100 900;
    font-display: block;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    width: ${ANCHO}px; height: ${ALTO}px; overflow: hidden;
    background: #007AFF;                       /* azul de marca */
    color: #FFFEFB;                             /* blanco de marca */
    font-family: Inter, -apple-system, system-ui, sans-serif;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    text-align: center;
    padding: 0 92px 70px;
  }
  /* El mando único de la casa: wordmark vectorial aprobado + descriptor a
     1,027em del mismo tamaño de base (la razón que BWS midió para que la
     mayúscula del descriptor empate con la del wordmark). */
  .marca { display: flex; align-items: baseline; gap: 0.3em;
           font-size: 58px; margin-bottom: 46px; }
  .marca svg { width: 3.943em; height: auto; display: block; flex: none; }
  .marca span { font-size: 1.027em; font-weight: 600; line-height: 1.1;
                letter-spacing: -0.018em; opacity: 0.78; white-space: nowrap; }
  h1 { margin: 0; font-size: 84px; font-weight: 700; line-height: 1.04;
       letter-spacing: -0.035em; text-wrap: balance; max-width: 18ch; }
  .sub { margin: 24px 0 0; font-size: 33px; font-weight: 500;
         letter-spacing: -0.012em; line-height: 1.3; opacity: 0.82;
         max-width: 26ch; }
  .dominio { position: absolute; bottom: 44px; left: 0; right: 0;
             font-size: 23px; font-weight: 600; letter-spacing: 0.01em;
             opacity: 0.62; }
</style></head>
<body>
  <p class="marca">${wordmark}<span>Plans</span></p>
  <h1>Elige tu plataforma, contrata el plan.</h1>
  <p class="sub">Pagas en USDT, USD o Bs a la tasa oficial del BCV.</p>
  <p class="dominio">plans.blink.com.ve</p>
</body></html>`;

const paginaOg = await navegador.newPage({
  viewport: { width: ANCHO, height: ALTO },
  deviceScaleFactor: 2,
});
await paginaOg.setDefaultTimeout(300_000);
await paginaOg.setContent(html, { waitUntil: "load", timeout: 300_000 });
await paginaOg.evaluate(() => document.fonts.ready);
await paginaOg.waitForTimeout(600);
const png2x = await paginaOg.screenshot({ clip: { x: 0, y: 0, width: ANCHO, height: ALTO } });

/* Se renderiza al doble y se baja con el propio Chromium: los 1200×630 son
   los que declaran los metas y las guías de WhatsApp, y el trazo del
   wordmark sale más nítido bajando una imagen grande que dibujando a 1×. */
const reductor = await navegador.newPage({ viewport: { width: ANCHO, height: ALTO } });
await reductor.setContent(
  `<!doctype html><meta charset="utf-8"><body style="margin:0">
   <canvas id="c" width="${ANCHO}" height="${ALTO}"></canvas>`,
);
const png = Buffer.from(
  await reductor.evaluate(async ({ datos, ancho, alto }) => {
    const img = new Image();
    img.src = datos;
    await img.decode();
    const lienzo = document.querySelector("#c");
    const ctx = lienzo.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, ancho, alto);
    return lienzo.toDataURL("image/png").split(",")[1];
  }, { datos: `data:image/png;base64,${png2x.toString("base64")}`, ancho: ANCHO, alto: ALTO }),
  "base64",
);
writeFileSync(PUB("og.png"), png);
console.log(
  `✓ public/og.png  ${ANCHO}×${ALTO} exactos (render a 2× y bajada)  ${(png.length / 1024).toFixed(0)} KB`,
);

await navegador.close();
