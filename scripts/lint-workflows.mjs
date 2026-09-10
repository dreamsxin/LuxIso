/**
 * Dependency-free lint for GitHub Actions workflow files.
 *
 * Exists because a single bad line silently disabled the `webgl-baselines`
 * workflow: `- run: echo "Reason: ${{ inputs.reason }}"` is not valid YAML — a
 * plain (unquoted) scalar cannot contain `: ` — so GitHub refused to parse the
 * whole file and the workflow could not be dispatched at all. Nothing in the
 * repo checked workflow syntax, and GitHub's own report is an annotation on a
 * run rather than a failing check you can see locally.
 *
 * Three rules, all of them things that have actually gone wrong here:
 *
 *   1. plain-scalar-colon — a value that is not quoted, not a block scalar, and
 *      contains `: ` or ends with `:`. This is the parse error above.
 *   2. tab-indent — YAML forbids tabs in indentation.
 *   3. run-expression-injection — a `${{ inputs.* }}` or `${{ github.event.* }}`
 *      expression interpolated straight into a `run:` script. Attacker-supplied
 *      text becomes shell source; pass it through `env:` instead.
 *
 * Not a YAML parser and not a replacement for actionlint — it catches the class
 * of mistake that has bitten this repo, with no dependency to install.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOW_DIR = '.github/workflows';

/** Values that start a block scalar, optionally with chomping/indent modifiers. */
const BLOCK_SCALAR = /^[|>][+-]?\d*$/;
const KEY_LINE = /^(\s*)(?:-\s+)?([A-Za-z_][\w-]*)\s*:(?:\s+(.*))?$/;
const UNSAFE_EXPRESSION = /\$\{\{[^}]*\b(?:inputs\.|github\.event\.)/;

/** Strip a trailing YAML comment from a plain scalar. */
function stripComment(value) {
  const at = value.indexOf(' #');
  return (at === -1 ? value : value.slice(0, at)).trim();
}

function isPlainScalar(value) {
  if (!value) return false;
  return !/^['"|>&*!\[{]/.test(value);
}

/**
 * Lint one workflow file's text.
 * @returns {{line: number, rule: string, message: string}[]}
 */
export function lintWorkflow(text) {
  const findings = [];
  const lines = text.split(/\r?\n/);

  // Indentation of the key that opened the current block scalar, plus its name.
  let block = null;

  lines.forEach((raw, index) => {
    const line = index + 1;
    const indent = raw.length - raw.trimStart().length;

    if (block !== null) {
      if (raw.trim() === '' || indent > block.indent) {
        if (block.key === 'run' && UNSAFE_EXPRESSION.test(raw)) {
          findings.push({
            line,
            rule: 'run-expression-injection',
            message: `\`run:\` interpolates a caller-controlled expression: ${raw.trim()}`,
          });
        }
        return; // literal content — YAML does not parse it
      }
      block = null;
    }

    if (/^\s*#/.test(raw) || raw.trim() === '') return;

    if (/^\t| \t/.test(raw)) {
      findings.push({
        line,
        rule: 'tab-indent',
        message: 'YAML forbids tab characters in indentation.',
      });
    }

    const match = KEY_LINE.exec(raw);
    if (!match) return;
    const [, , key, rawValue = ''] = match;
    const value = rawValue.trim();

    if (BLOCK_SCALAR.test(value)) {
      block = { indent, key };
      return;
    }

    if (isPlainScalar(value)) {
      const scalar = stripComment(value);
      if (scalar.includes(': ') || /:$/.test(scalar)) {
        findings.push({
          line,
          rule: 'plain-scalar-colon',
          message:
            `Unquoted value for \`${key}:\` contains a colon, which YAML reads as a ` +
            `nested mapping: ${scalar}. Quote it or use a \`|\` block.`,
        });
      }
    }

    if (key === 'run' && UNSAFE_EXPRESSION.test(value)) {
      findings.push({
        line,
        rule: 'run-expression-injection',
        message: `\`run:\` interpolates a caller-controlled expression: ${value}`,
      });
    }
  });

  return findings;
}

/** @returns number of files with findings. */
export function lintWorkflowDir(dir = WORKFLOW_DIR, log = console.error) {
  let files;
  try {
    files = readdirSync(dir).filter((name) => /\.ya?ml$/.test(name)).sort();
  } catch {
    log(`lint-workflows: no ${dir} directory; nothing to check.`);
    return 0;
  }

  let bad = 0;
  for (const name of files) {
    const findings = lintWorkflow(readFileSync(join(dir, name), 'utf8'));
    if (findings.length === 0) continue;
    bad++;
    for (const f of findings) {
      log(`${dir}/${name}:${f.line}  ${f.rule}  ${f.message}`);
    }
  }

  if (bad === 0) log(`lint-workflows: ${files.length} workflow file(s) OK.`);
  return bad;
}

// Only act as a CLI when executed directly, so the rules stay unit-testable.
if (process.argv[1] && process.argv[1].endsWith('lint-workflows.mjs')) {
  process.exit(lintWorkflowDir() === 0 ? 0 : 1);
}
