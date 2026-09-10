import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error - plain .mjs build script, no type declarations
import { lintWorkflow } from '../../scripts/lint-workflows.mjs';

/**
 * The `webgl-baselines` workflow was undispatchable for several commits because
 * one line was not valid YAML, and nothing in the repo checked workflow syntax:
 * GitHub reports it as an annotation on a run, not as a check you can reproduce
 * locally. These tests pin the three rules and assert the repo's own workflows
 * stay clean.
 */

interface Finding { line: number; rule: string; message: string }

const lint = lintWorkflow as (text: string) => Finding[];

function rules(text: string): string[] {
  return lint(text).map(f => f.rule);
}

describe('lint-workflows — plain scalar colons', () => {
  it('catches the exact line that broke webgl-baselines', () => {
    const findings = lint([
      'jobs:',
      '  regenerate:',
      '    steps:',
      '      - run: echo "Reason: ${{ inputs.reason }}"',
    ].join('\n'));

    expect(findings[0].line).toBe(4);
    expect(findings[0].rule).toBe('plain-scalar-colon');
    // GitHub reported "line 27, column 26" for the real file; the rule is the
    // same one, so the local report has to name the same line.
    expect(findings.map(f => f.rule)).toContain('run-expression-injection');
  });

  it('flags a value that merely ends with a colon', () => {
    expect(rules('name: Build:')).toContain('plain-scalar-colon');
  });

  it('accepts a quoted value containing a colon', () => {
    expect(rules("    description: 'Why: reason'")).toEqual([]);
    expect(rules('    description: "Why: reason"')).toEqual([]);
  });

  it('accepts a block scalar and its indented content', () => {
    expect(rules([
      '      - run: |',
      '          echo "Reason: $REASON"',
      '          echo "done"',
    ].join('\n'))).toEqual([]);
  });

  it('resumes checking after a block scalar ends', () => {
    const findings = lint([
      '      - run: |',
      '          echo "Reason: $REASON"',
      '      - name: broken: here',
    ].join('\n'));
    expect(findings.length).toBe(1);
    expect(findings[0].line).toBe(3);
  });

  it('leaves a colon without a following space alone', () => {
    // `https://x` and `key:value` are legal plain scalars.
    expect(rules('      - run: curl https://example.com/a')).toEqual([]);
    expect(rules('      - run: node --stack-size=4000')).toEqual([]);
  });

  it('ignores comments, including one that contains a colon', () => {
    expect(rules([
      '# note: this is fine',
      'jobs:',
      '  build:',
      '    steps: []',
    ].join('\n'))).toEqual([]);
  });

  it('ignores a trailing comment after a plain value', () => {
    expect(rules('    node-version: 22 # pinned: LTS')).toEqual([]);
  });
});

describe('lint-workflows — other rules', () => {
  it('flags tab indentation', () => {
    expect(rules('jobs:\n\tbuild: x')).toContain('tab-indent');
  });

  it('flags a caller-controlled expression inside a run block', () => {
    const findings = lint([
      '      - run: |',
      '          echo ${{ inputs.reason }}',
    ].join('\n'));
    expect(findings.map(f => f.rule)).toEqual(['run-expression-injection']);
    expect(findings[0].line).toBe(2);
  });

  it('flags github.event expressions too', () => {
    expect(rules('      - run: echo ${{ github.event.issue.title }}'))
      .toContain('run-expression-injection');
  });

  it('allows a safe expression such as github.sha', () => {
    expect(rules('      - run: echo ${{ github.sha }}')).toEqual([]);
  });

  it('allows caller input passed through env', () => {
    expect(rules([
      '      - name: Log the stated reason',
      '        env:',
      '          REASON: ${{ inputs.reason }}',
      '        run: |',
      '          echo "Reason: $REASON"',
    ].join('\n'))).toEqual([]);
  });
});

describe('lint-workflows — this repository', () => {
  it('every committed workflow passes', () => {
    const dir = '.github/workflows';
    const files = readdirSync(dir).filter(name => /\.ya?ml$/.test(name));
    expect(files.length).toBeGreaterThan(0);

    const failures: string[] = [];
    for (const name of files) {
      for (const f of lint(readFileSync(join(dir, name), 'utf8'))) {
        failures.push(`${name}:${f.line} ${f.rule} ${f.message}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
