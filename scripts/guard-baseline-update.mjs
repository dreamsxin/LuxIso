/**
 * Guard for `npm run test:webgl:update`.
 *
 * The pixel-diff gate compares against a single baseline set captured on the
 * pinned CI runner (Chromium/SwiftShader, 1280x720, DPR 1, ubuntu-latest).
 * `playwright.webgl.config.ts` deliberately uses one baseline directory with no
 * platform suffix, so a set regenerated on a developer machine lands in exactly
 * the path CI reads — and Linux vs Windows/macOS rasterisation differs by more
 * than the 1.5% threshold allows. Committing local captures therefore turns the
 * gate red (or, worse, quietly re-baselines a real regression).
 *
 * Baselines come from the `webgl-baselines` workflow. This script makes that
 * rule enforced rather than merely documented.
 *
 * To regenerate locally anyway — useful when iterating on the fixtures
 * themselves, as long as the result is not committed:
 *
 *   LUXISO_ALLOW_LOCAL_BASELINES=1 npm run test:webgl:update
 */
if (process.env.CI) process.exit(0);
if (process.env.LUXISO_ALLOW_LOCAL_BASELINES === '1') {
  console.warn(
    'test:webgl:update: LUXISO_ALLOW_LOCAL_BASELINES=1 — writing baselines on ' +
    `${process.platform}. Do NOT commit them; the gate expects CI captures.`,
  );
  process.exit(0);
}

console.error(
  [
    '',
    `Refusing to regenerate WebGL baselines on ${process.platform} outside CI.`,
    '',
    'The gate compares against one baseline set captured on the pinned CI',
    'runner. Local captures land in the same directory but differ by more than',
    'the 1.5% threshold, so committing them breaks the gate.',
    '',
    'Regenerate via the manual workflow, then commit the reviewed artifact:',
    '',
    '  gh workflow run webgl-baselines.yml -f reason="<why>"',
    '  gh run download <run-id> -n webgl-baselines-<sha> -D webgl-next/e2e/__screenshots__',
    '',
    'or trigger "WebGL Baselines" from the Actions tab.',
    '',
    'To capture locally without committing (fixture iteration only):',
    '',
    '  LUXISO_ALLOW_LOCAL_BASELINES=1 npm run test:webgl:update',
    '',
  ].join('\n'),
);
process.exit(1);
