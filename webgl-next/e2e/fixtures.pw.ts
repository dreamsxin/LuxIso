import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { PREVIEW_LIGHTING_FIXTURES } from '../src/testing/PreviewLightingFixtures';

/**
 * Fixtures compared against a committed baseline with the 1.5% pixel-diff gate.
 * The rest still run the heuristic assertions only — see ACCEPTANCE.md.
 */
const PIXEL_GATED_FIXTURES = new Set(['day-ne', 'low-angle', 'night-lanterns']);


test.describe('WebGL deterministic fixture matrix', () => {
  for (const fixture of PREVIEW_LIGHTING_FIXTURES) {
    test(`${fixture.id} renders a stable candidate`, async ({ page }, testInfo) => {
      const runtimeErrors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') runtimeErrors.push(message.text());
      });
      page.on('pageerror', (error) => runtimeErrors.push(error.message));

      await page.goto(`/webgl-next/?fixture=${fixture.id}`, { waitUntil: 'networkidle' });
      await expect(page).toHaveTitle('LuxIso WebGL Next');
      await expect(page.locator('#backend-status')).toContainText('就绪');
      await expect(page.locator('#fixture')).toHaveValue(fixture.id);
      await expect(page.locator('#orbit')).not.toBeChecked();
      await expect(page.locator('#ambient')).toHaveValue(String(fixture.ambient.intensity));

      const enabledOmniLights = fixture.omniLights.filter((light) => light.enabled).length;
      await expect.poll(() => page.locator('#lights').innerText()).toBe(String(enabledOmniLights));

      const canvas = page.locator('#webgl-canvas');
      await expect(canvas).toBeVisible();
      // The sprite atlas is decoded from a data URL through `new Image()`, so the
      // texture lands one or more frames after load. Without this gate the upload
      // can happen BETWEEN the two screenshots below and the stability assertion
      // fails spuriously. The lifecycle spec already waits on the same counter.
      await expect(page.locator('#textures')).toHaveText('1');
      const firstFrame = await canvas.screenshot({ animations: 'disabled' });
      const pixels = analyzePng(firstFrame);
      expect(pixels.width).toBeGreaterThan(900);
      expect(pixels.height).toBeGreaterThan(500);
      expect(pixels.uniqueColors).toBeGreaterThan(64);
      expect(pixels.luminanceDeviation).toBeGreaterThan(5);

      await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      const secondFrame = await canvas.screenshot({ animations: 'disabled' });
      expect(secondFrame.equals(firstFrame)).toBe(true);

      // `-viewport` in the name on purpose. This is a `#viewport` capture — the
      // GL canvas *plus* the DOM overlays, minimap and caption — kept only as
      // review context, whereas the approved baseline below is a `#webgl-canvas`
      // capture (GL pixels only). Both used to be written as `<id>.png`, in two
      // different artifacts, so the two sets looked interchangeable once
      // downloaded and a viewport capture could be filed as a baseline. It would
      // fail the gate rather than pass silently, but the names should not invite
      // the mistake in the first place.
      const candidatePath = testInfo.outputPath(`${fixture.id}-viewport.png`);
      await page.locator('#viewport').screenshot({
        path: candidatePath,
        animations: 'disabled',
      });
      const metadataPath = testInfo.outputPath(`${fixture.id}.json`);
      await writeFile(metadataPath, JSON.stringify({
        fixture: fixture.id,
        renderer: await page.locator('#backend-status').innerText(),
        browser: testInfo.project.name,
        viewport: testInfo.project.use.viewport,
        deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
        commit: process.env.GITHUB_SHA ?? 'local',
        pixels,
      }, null, 2));
      await testInfo.attach(`${fixture.id}-viewport`, {
        path: candidatePath,
        contentType: 'image/png',
      });

      // Approved-baseline gate. Only a subset is pinned for now: three fixtures
      // that between them cover day lighting, a low sun with long projected
      // shadows, and practical local lights at low ambient — enough to catch a
      // real regression without putting nine binaries under review.
      //
      // CI-only on purpose. Baselines are generated exclusively by the
      // `webgl-baselines` workflow so there is one authoritative set; letting a
      // developer machine write them would mint a second, conflicting one.
      //
      // The baseline must also already exist. `toHaveScreenshot` treats a
      // missing snapshot as a failure — it writes the actual and reports
      // "A snapshot doesn't exist at ..." — so simply enabling the gate before
      // any baseline was committed turned every CI run red rather than leaving
      // the check inert. Skipping with an annotation keeps the signal visible
      // without failing on the absence of a file only the baselines workflow is
      // allowed to produce. That workflow sets LUXISO_WRITE_BASELINES=1 to force
      // the assertion and mint the missing snapshots.
      if (PIXEL_GATED_FIXTURES.has(fixture.id) && process.env.CI) {
        const baseline = testInfo.snapshotPath(`${fixture.id}.png`);
        if (process.env.LUXISO_WRITE_BASELINES === '1' || existsSync(baseline)) {
          await expect(canvas).toHaveScreenshot(`${fixture.id}.png`, {
            animations: 'disabled',
          });
        } else {
          testInfo.annotations.push({
            type: 'pixel-gate-skipped',
            description:
              `no committed baseline at ${relative(process.cwd(), baseline)} — ` +
              'run the webgl-baselines workflow and commit the reviewed PNGs',
          });
        }
      }


      expect(runtimeErrors).toEqual([]);
    });
  }
});


function analyzePng(buffer: Buffer): {
  width: number;
  height: number;
  uniqueColors: number;
  luminanceDeviation: number;
} {
  const image = PNG.sync.read(buffer);
  const colors = new Set<number>();
  let samples = 0;
  let luminanceSum = 0;
  let luminanceSquaredSum = 0;

  for (let pixel = 0; pixel < image.width * image.height; pixel += 16) {
    const offset = pixel * 4;
    const red = image.data[offset];
    const green = image.data[offset + 1];
    const blue = image.data[offset + 2];
    colors.add((red << 16) | (green << 8) | blue);
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    luminanceSum += luminance;
    luminanceSquaredSum += luminance * luminance;
    samples++;
  }

  const mean = luminanceSum / samples;
  const variance = Math.max(0, luminanceSquaredSum / samples - mean * mean);
  return {
    width: image.width,
    height: image.height,
    uniqueColors: colors.size,
    luminanceDeviation: Math.sqrt(variance),
  };
}
