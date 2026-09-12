import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration, kept separate from vite.config.ts because that file
 * switches between app and library build modes via BUILD_MODE.
 */
export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts', 'webgl-next/src/**/*.ts'],
      exclude: [
        'src/__tests__/**',
        // Entry points and DOM-driven tools: exercised by the Playwright suite
        // and by hand, not by unit tests. Counting them would only dilute the
        // signal for the modules the thresholds below actually protect.
        'src/main.ts',
        'src/editor/editor.ts',
        'src/editor/sprite-editor.ts',
        'webgl-next/src/testing/**',
      ],
      /**
       * Thresholds are ratchets set just under the current numbers, not
       * aspirations: they exist to stop the correctness-critical modules from
       * silently losing coverage. Raise them when you add tests; never lower one
       * to make a build pass.
       *
       * The per-glob floors matter more than the global figure. Every P0/P1
       * defect found in the audit lived in these directories, and each one
       * slipped through because the specific branch was untested — not because
       * the overall percentage was low.
       *
       * Note that a glob such as `src/ecs/**` also spans `src/ecs/components/**`,
       * so these numbers are lower than the per-directory rows in the `text`
       * reporter, which only counts files sitting directly in the folder.
       */
      thresholds: {
        statements: 81.8,
        branches: 77.6,
        functions: 84.1,
        lines: 83.5,
        // Isometric projection, depth sort, colour math — fully unit-testable.
        'src/math/**':     { statements: 90, branches: 88, functions: 92, lines: 92 },
        // Collision and A*: where the tunnelling and corner-cut bugs lived.
        'src/physics/**':  { statements: 90, branches: 85, functions: 94, lines: 93 },
        'src/lighting/**': { statements: 90, branches: 84, functions: 92, lines: 94 },
        'src/ecs/**':      { statements: 92, branches: 88, functions: 88, lines: 94 },
        'src/animation/**':{ statements: 88, branches: 80, functions: 95, lines: 89 },
        'src/audio/**':    { statements: 94, branches: 84, functions: 86, lines: 94 },
        'src/core/**':     { statements: 95, branches: 84, functions: 95, lines: 97 },
        // `FrameClock` owns the frame-delta contract for a dozen modules, so it
        // is held at complete coverage rather than a ratchet.
        'src/time/**':     { statements: 100, branches: 100, functions: 100, lines: 100 },
        // Renderable objects: much of the body is canvas drawing code, reachable
        // through the recording context in `src/__tests__/helpers/canvas.ts`.
        'src/elements/**': { statements: 74, branches: 72, functions: 86, lines: 77 },
        // GPU resource ownership: the texture cache and the handle registry are
        // pure bookkeeping, so they are unit-testable through a fake GL context
        // (`src/__tests__/helpers/gl.ts`) despite living in the WebGL package.
        'webgl-next/src/resources/**': { statements: 94, branches: 84, functions: 100, lines: 97 },
        // The handle registry: every GPU object the renderer owns passes through
        // it, and the context-loss story depends on its counts. Held complete —
        // the failure paths are where the shader leaks were hiding.
        'webgl-next/src/device/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    },
  },
});
