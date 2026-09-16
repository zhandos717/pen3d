import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

// Библиотечная сборка: на выходе один ES-модуль, который index.html подключает
// обычным <script type="module">, как и остальные js/*.js — само приложение
// собирать не нужно, Vite тут только для новых Solid-кусков.
export default defineConfig({
  plugins: [solid()],
  build: {
    outDir: 'js',
    emptyOutDir: false,
    lib: {
      entry: { popovers: 'solid/popovers.js', 'props-panel': 'solid/props-panel.js' },
      formats: ['es'],
      fileName: (_format, name) => `${name}-solid.js`,
    },
  },
});
