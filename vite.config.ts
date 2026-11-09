import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Blink Plans se publica en la raíz de plans.blink.com.ve (CNAME en public/),
  // así que las rutas del build son absolutas, igual que en POS y Pay. Antes
  // era base: './' porque GitHub Pages servía el proyecto en la subruta
  // /suscripciones/.
  base: '/',
  plugins: [react(), tailwindcss()],
})