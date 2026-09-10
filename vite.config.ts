import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Dual-mode Vite config:
 *   npm run dev / preview  → multi-page app (demo + editor)
 *   npm run build:lib      → library bundle (ESM + CJS + .d.ts)
 *   npm run build          → multi-page app build (demo + editor)
 */
const isLib = process.env.BUILD_MODE === 'lib';

export default defineConfig({
  build: isLib
    ? {
        target: 'es2020',
        lib: {
          entry:    resolve(__dirname, 'src/index.ts'),
          name:     'LuxIso',
          fileName: (format) => `luxiso.${format === 'es' ? 'mjs' : 'cjs'}`,
          formats:  ['es', 'cjs'],
        },
        rollupOptions: {
          // No external deps — pure Canvas 2D, no runtime dependencies
          external: [],
        },
        // Emit .d.ts via tsc separately (see build:lib script)
        copyPublicDir: false,
      }
    : {
        target: 'es2022',
        rollupOptions: {
          input: {
            main:         resolve(__dirname, 'index.html'),
            editor:       resolve(__dirname, 'editor.html'),
            spriteEditor: resolve(__dirname, 'sprite-editor.html'),
            webglNext:    resolve(__dirname, 'webgl-next/index.html'),
            examples:     resolve(__dirname, 'examples/index.html'),
            ex01:         resolve(__dirname, 'examples/01-minimal-scene/index.html'),
            ex02:         resolve(__dirname, 'examples/02-character-movement/index.html'),
            ex03:         resolve(__dirname, 'examples/03-combat-system/index.html'),
            ex04:         resolve(__dirname, 'examples/04-hud-debug-inputmap/index.html'),
            ex05:         resolve(__dirname, 'examples/05-whisper-plains/index.html'),
            ex06:         resolve(__dirname, 'examples/06-voxel-lake/index.html'),
            ex07:         resolve(__dirname, 'examples/07-desert-ruins/index.html'),
            ex08:         resolve(__dirname, 'examples/08-volcano/index.html'),
            ex09:         resolve(__dirname, 'examples/09-slopes/index.html'),
            ex10:         resolve(__dirname, 'examples/10-arpg/index.html'),
          },
        },
      },
});
