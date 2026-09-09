import { defineConfig, devices } from '@playwright/test';

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
    // The approved-baseline gate from webgl-next/ACCEPTANCE.md.
    toHaveScreenshot: { maxDiffPixelRatio: 0.015 },
  },
  // One baseline set, not one per OS/project. The runner is pinned
  // (Chromium/SwiftShader, 1280x720, DPR 1) and baselines are produced only by
  // CI via the `webgl-baselines` workflow, so a platform suffix would just invite
  // a second, conflicting set from a developer machine.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 720 },
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
