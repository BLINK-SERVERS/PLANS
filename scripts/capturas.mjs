/* ============================================================
   scripts/capturas.mjs — la revisión visual, en archivo
   ------------------------------------------------------------
   El plan pide «revisión visual en escritorio y móvil» antes de dar por
   cerrado un cambio de superficie o de tinta. Eso no se hace de memoria:
   se hace con las mismas dos capturas, antes y después.

     npm run dev &                                        # 5173
     node scripts/capturas.mjs /tmp/antes                 # o /tmp/despues

   Captura las rutas que se pueden ver sin cuenta (la tienda y el acceso)
   a 1440×900 y a 390×844 —el iPhone 15 Pro—, y deja el nombre de la ruta
   y el viewport en el archivo para que el `diff` visual sea obvio. Las
   rutas de panel requieren sesión y se capturan a mano desde el navegador.
   ============================================================ */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const DESTINO = process.argv[2] ?? "/tmp/capturas";
const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const RUTAS = ["/", "/tienda", "/tienda/google", "/login", "/registro", "/carrito"];
const VIEWPORTS = [
  { nombre: "escritorio", width: 1440, height: 900 },
  { nombre: "movil", width: 390, height: 844 },
];

mkdirSync(DESTINO, { recursive: true });

const navegador = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

for (const vp of VIEWPORTS) {
  const pagina = await navegador.newPage({ viewport: { width: vp.width, height: vp.height } });
  for (const ruta of RUTAS) {
    await pagina.goto(`${BASE}/#${ruta}`, { waitUntil: "load" });
    /* La primera llamada puede despertar la Function (arranque en frío de
       Neon: segundos), así que 900 ms no alcanzan y la captura sale con
       «Cargando planes…», que no es el estado que se quiere revisar. Ni
       siquiera basta con `networkidle`: la Function puede tardar 15 s en
       responder y el idle se corta antes. Se espera de verdad a que el
       texto de carga desaparezca del DOM, con techo de 45 s, y solo luego
       se deja asentarse el layout. */
    await pagina
      .waitForFunction(() => !/Cargando|Despertando la base/i.test(document.body.innerText), {
        timeout: 45_000,
      })
      .catch(() => console.warn(`  ! ${ruta} sigue cargando tras 45 s`));
    await pagina.waitForTimeout(1200);
    const archivo = `${DESTINO}/${ruta.replace(/\//g, "_") || "_"}--${vp.nombre}.png`;
    await pagina.screenshot({ path: archivo, fullPage: false });
    console.log(`✓ ${archivo}`);
  }
  await pagina.close();
}

await navegador.close();
