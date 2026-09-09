import { expect, test } from '@playwright/test';

test.describe('WebGL resource lifecycle', () => {
  test('restores a lost context without resetting fixture state', async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(message.text());
    });
    page.on('pageerror', (error) => runtimeErrors.push(error.message));

    await page.goto('/webgl-next/?fixture=day-ne', { waitUntil: 'networkidle' });
    const canvas = page.locator('#webgl-canvas');
    const status = page.locator('#backend-status');
    await expect(status).toContainText('就绪');
    await expect(page.locator('#textures')).toHaveText('1');
    const beforeLoss = await canvas.screenshot({ animations: 'disabled' });

    const lifecycle = await page.evaluate(() => new Promise<{
      supported: boolean;
      lostStatus: string;
      restoreMs: number;
    }>((resolve) => {
      const target = document.querySelector<HTMLCanvasElement>('#webgl-canvas');
      const gl = target?.getContext('webgl2');
      const extension = gl?.getExtension('WEBGL_lose_context');
      if (!target || !extension) {
        resolve({ supported: false, lostStatus: '', restoreMs: -1 });
        return;
      }
      const startedAt = performance.now();
      let lostStatus = '';
      target.addEventListener('webglcontextlost', () => {
        lostStatus = document.querySelector('#backend-status')?.textContent ?? '';
        setTimeout(() => extension.restoreContext(), 50);
      }, { once: true });
      target.addEventListener('webglcontextrestored', () => {
        resolve({
          supported: true,
          lostStatus,
          restoreMs: performance.now() - startedAt,
        });
      }, { once: true });
      extension.loseContext();
    }));
    expect(lifecycle.supported).toBe(true);
    expect(lifecycle.lostStatus).toContain('上下文丢失');
    await expect(status).toContainText('已恢复');
    expect(lifecycle.restoreMs).toBeLessThan(2_000);
    await expect(page.locator('#fixture')).toHaveValue('day-ne');
    await expect(page.locator('#textures')).toHaveText('1');

    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    const afterRestore = await canvas.screenshot({ animations: 'disabled' });
    expect(afterRestore.equals(beforeLoss)).toBe(true);
    expect(runtimeErrors).toEqual([]);
  });

  test('releases registered handles across repeated create and dispose cycles', async ({ page }) => {
    await page.goto('/webgl-next/?fixture=lights-off', { waitUntil: 'networkidle' });

    const result = await page.evaluate(async () => {
      // Exposed by webgl-next/main.ts. Reaching the class this way — rather than
      // dynamically importing its .ts source — is what lets this suite run
      // against the production bundle under `vite preview`.
      const hook = window.__luxisoPreview;
      if (!hook) throw new Error('window.__luxisoPreview is missing; is the preview entry loaded?');
      const { WebGLRenderer } = hook;
      const cycles: Array<{ before: number; after: number; disposedGuard: boolean }> = [];

      for (let cycle = 0; cycle < 6; cycle++) {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const renderer = new WebGLRenderer(canvas);
        const gl = canvas.getContext('webgl2');
        const before = renderer.resourceCounts.total;
        renderer.dispose();
        const after = renderer.resourceCounts.total;
        let disposedGuard = false;
        try {
          renderer.resize(64, 64, 1);
        } catch {
          disposedGuard = true;
        }
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
        cycles.push({ before, after, disposedGuard });
      }

      const lostCanvas = document.createElement('canvas');
      const lostRenderer = new WebGLRenderer(lostCanvas);
      const lostGl = lostCanvas.getContext('webgl2');
      const extension = lostGl?.getExtension('WEBGL_lose_context');
      if (!extension) return { cycles, lostCounts: -1, disposedLostCounts: -1 };
      const lost = new Promise<void>((resolve) => {
        lostCanvas.addEventListener('webglcontextlost', () => resolve(), { once: true });
      });
      extension.loseContext();
      await lost;
      const lostCounts = lostRenderer.resourceCounts.total;
      lostRenderer.dispose();
      return {
        cycles,
        lostCounts,
        disposedLostCounts: lostRenderer.resourceCounts.total,
      };
    });

    expect(result.cycles).toHaveLength(6);
    for (const cycle of result.cycles) {
      expect(cycle.before).toBeGreaterThan(0);
      expect(cycle.after).toBe(0);
      expect(cycle.disposedGuard).toBe(true);
    }
    expect(result.lostCounts).toBe(0);
    expect(result.disposedLostCounts).toBe(0);
  });
});
