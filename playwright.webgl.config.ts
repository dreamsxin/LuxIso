import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
  testDir: './webgl-next/e2e',
  testMatch: '**/*.pw.ts',
  outputDir: './test-results/webgl-next',
  preserveOutput: 'always',
  fullyParallel: false,
  workers: 1,
  // Headless SwiftShader occasionally needs a second attempt on a cold CI
  // runner. Zero retries turned any such hiccup into a red build.
  retries: process.env.CI ? 2 : 0,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
    /**
     * The approved-baseline gate from webgl-next/ACCEPTANCE.md, as an absolute
     * pixel budget rather than the 1.5% ratio it started as.
     *
     * The ratio was 0.015 of a 1028x672 canvas — 10,362 pixels — and that was
     * measured to be far too loose to mean anything. With
     * `maxDiffPixelRatio: 0` to force the number out, a `mossy-boulder` rebuilt
     * at 120 px radius instead of 19 (six times the size) changed only 4,574
     * pixels and sailed through. The renderer is bit-deterministic here — two
     * runs of the same build report identical counts — so an absolute budget is
     * the honest instrument.
     *
     * 2,500 is a ratchet in the same spirit as the coverage floors in
     * vitest.config.ts: set above the known-good delta, only ever tightened.
     * Today the three baselines sit 935 / 976 / 919 pixels away from the current
     * build (the `maxZ` corrections shortened the boulder's shadow), so the
     * headroom is real and deliberate. **Once `webgl-baselines` regenerates
     * them that delta goes to zero and this should drop to a few hundred.**
     *
     * What no whole-canvas number can do is protect a single prop. A boulder at
     * 34 px instead of 19 moves 1,102 pixels against the same baseline the
     * `maxZ` fix moves 935 — 167 pixels apart on a canvas of 690,816. Prop-level
     * regressions need a clipped baseline or a computed invariant, not a
     * stricter global budget; see the P2 row in README.
     */
    toHaveScreenshot: {maxDiffPixels: 2500},


  },

  // One baseline set, not one per OS/project. The runner is pinned
  // (Chromium/SwiftShader, 1280x720, DPR 1) and baselines are produced only by
  // CI via the `webgl-baselines` workflow, so a platform suffix would just invite
  // a second, conflicting set from a developer machine.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: {width: 1280, height: 720},
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
  },
  projects: [{
    name: 'chromium-swiftshader',
    use: {
      ...devices['Desktop Chrome'],
      launchOptions: {
        args: [
          '--enable-webgl',
          '--ignore-gpu-blocklist',
          '--use-angle=swiftshader',
        ],
      },
    },
  }],
  webServer: {
    // `vite preview` serves dist/, so this suite exercises the production bundle
    // — the artifact we actually ship. `npm run test:webgl` builds first, which
    // is why the build is part of that script rather than a separate CI step.
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/webgl-next/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
