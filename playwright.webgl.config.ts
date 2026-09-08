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
  expect: { timeout: 10_000 },
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
    // Dev server, not `vite preview`: lifecycle.pw.ts imports
    // /webgl-next/src/renderer/WebGLRenderer.ts at runtime, which only resolves
    // through Vite's dev module graph. Consequence: these tests do NOT cover the
    // production bundle. Moving fixture captures onto a preview-server project
    // is tracked as a P1 in the repo roadmap.
    command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/webgl-next/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
