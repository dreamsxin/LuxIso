# Releasing LuxIso

Releases are driven by version tags. A tag such as `v0.1.0` runs
`.github/workflows/publish.yml`, which tests and builds the library, publishes
the matching package version to npm, and creates a GitHub release containing
the npm tarball.

Source files must be UTF-8 without a BOM. Run `npm run encoding:check` before a
release. `npm run encoding:fix` converts UTF-8 BOM and UTF-16 files; legacy
files require an explicit source encoding, for example:

```bash
node scripts/normalize-encoding.mjs --write --from=gb18030 path/to/file.ts
```

## First npm release

The package must exist on npm before its settings can be connected to an OIDC
trusted publisher. Bootstrap `0.1.0` with a short-lived npm token:

1. Enable two-factor authentication on the npm account that will own `luxiso`.
2. Create a granular npm access token with read/write package permission and
   permission to bypass 2FA for CI publishing. Keep its expiration short.
3. In GitHub, create an environment named `npm`, restrict its deployment tags
   to `v*`, and add an environment secret named `NPM_TOKEN` containing the
   token. A required reviewer can be added as a final release approval gate.
4. Merge the release workflow into the default branch, then create and push the
   tag whose value exactly matches `package.json`:

   ```bash
   git tag -a v0.1.0 -m "LuxIso 0.1.0"
   git push origin v0.1.0
   ```

5. Watch the **Publish** workflow and verify both the npm package and GitHub
   release before changing authentication.

## Switch to trusted publishing

After the first package version exists, open the package settings on npmjs.com
and add a GitHub Actions trusted publisher with these exact values:

| Field | Value |
|---|---|
| Organization or user | `dreamsxin` |
| Repository | `LuxIso` |
| Workflow filename | `publish.yml` |
| Environment | `npm` |
| Allowed action | `npm publish` |

Delete the `NPM_TOKEN` environment secret after the trusted publisher is active.
Future workflow runs use GitHub OIDC and npm-generated provenance instead of a
long-lived credential.

## Later releases

Start from a clean `main` branch. `npm version` updates both `package.json` and
`package-lock.json`, creates a release commit, and creates the matching tag:

```bash
git switch main
git pull --ff-only
npm version patch
git push origin main --follow-tags
```

Use `npm version minor` or `npm version major` when the change requires it. npm
versions are immutable, so never reuse a published version or move a release
tag. Deprecate a bad version and publish a new patch instead.
