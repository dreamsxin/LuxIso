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
        statements: 68.9,
        branches: 67.4,
        functions: 74.9,
        lines: 70.6,
        // Isometric projection, depth sort, colour math — fully unit-testable.
        'src/math/**':     { statements: 90, branches: 88, functions: 92, lines: 92 },
        // Collision and A*: where the tunnelling and corner-cut bugs lived.
        'src/physics/**':  { statements: 90, branches: 85, functions: 94, lines: 93 },
        'src/lighting/**': { statements: 90, branches: 84, functions: 92, lines: 94 },
        'src/ecs/**':      { statements: 86, branches: 83, functions: 76, lines: 90 },
        'src/animation/**':{ statements: 81, branches: 75, functions: 89, lines: 81 },
        'src/audio/**':    { statements: 78, branches: 71, functions: 77, lines: 80 },
        'src/core/**':     { statements: 76, branches: 69, functions: 83, lines: 77 },
        // Renderable objects: much of the body is canvas drawing code.
        'src/elements/**': { statements: 57, branches: 53, functions: 73, lines: 61 },
      },
    },
  },
});
