import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Generated output only. Adding `coverage` matters: the v8 HTML reporter emits
// a couple hundred files, and without this the check would walk all of them on
// every `npm run build`.
const SKIP_DIRECTORIES = new Set([
  '.git',
  '.zcode',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);
const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);
const TEXT_FILENAMES = new Set(['.gitignore', '.npmignore', 'LICENSE']);
const SUPPORTED_SOURCE_ENCODINGS = new Set([
  'gb18030',
  'utf-16be',
  'utf-16le',
  'windows-1252',
]);
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });

function usage() {
  console.log(`Usage: node scripts/normalize-encoding.mjs [options] [paths...]

Checks repository text files for UTF-8 without a BOM. Paths are relative to the
repository root; the whole repository is scanned when no path is supplied.

Options:
  --write              Convert recognized files in place
  --from=<encoding>    Decode invalid UTF-8 with gb18030, windows-1252,
                       utf-16le, or utf-16be (requires --write)
  --help               Show this help
`);
}

function parseArguments(argv) {
  const options = { write: false, from: undefined, paths: [] };

  for (const argument of argv) {
    if (argument === '--help') {
      usage();
      process.exit(0);
    }
    if (argument === '--write') {
      options.write = true;
      continue;
    }
    if (argument.startsWith('--from=')) {
      options.from = argument.slice('--from='.length).toLowerCase();
      continue;
    }
    if (argument.startsWith('--')) {
      throw new Error(`Unknown option: ${argument}`);
    }
    options.paths.push(argument);
  }

  if (options.from && !SUPPORTED_SOURCE_ENCODINGS.has(options.from)) {
    throw new Error(`Unsupported source encoding: ${options.from}`);
  }
  if (options.from && !options.write) {
    throw new Error('--from requires --write');
  }

  return options;
}

function isTextFile(path) {
  return TEXT_FILENAMES.has(basename(path)) || TEXT_EXTENSIONS.has(extname(path).toLowerCase());
}

async function collectFiles(path, files) {
  const info = await stat(path);
  if (!info.isDirectory()) {
    if (isTextFile(path)) files.push(path);
    return;
  }

  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    await collectFiles(resolve(path, entry.name), files);
  }
}

function hasPrefix(bytes, prefix) {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function looksLikeUtf16(bytes, littleEndian) {
  const sampleLength = Math.min(bytes.length, 4096);
  if (sampleLength < 4) return false;

  let expectedZeros = 0;
  let unexpectedZeros = 0;
  for (let index = 0; index < sampleLength; index += 1) {
    if (bytes[index] !== 0) continue;
    if ((index % 2 === 1) === littleEndian) expectedZeros += 1;
    else unexpectedZeros += 1;
  }

  return expectedZeros >= sampleLength / 8 && unexpectedZeros <= sampleLength / 64;
}

function inspect(bytes) {
  if (hasPrefix(bytes, [0xef, 0xbb, 0xbf])) {
    return { encoding: 'utf-8-bom', text: STRICT_UTF8.decode(bytes.subarray(3)) };
  }
  if (hasPrefix(bytes, [0xff, 0xfe])) {
    return { encoding: 'utf-16le', text: new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2)) };
  }
  if (hasPrefix(bytes, [0xfe, 0xff])) {
    return { encoding: 'utf-16be', text: new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2)) };
  }
  if (looksLikeUtf16(bytes, true)) {
    return { encoding: 'utf-16le', text: new TextDecoder('utf-16le', { fatal: true }).decode(bytes) };
  }
  if (looksLikeUtf16(bytes, false)) {
    return { encoding: 'utf-16be', text: new TextDecoder('utf-16be', { fatal: true }).decode(bytes) };
  }

  try {
    return { encoding: 'utf-8', text: STRICT_UTF8.decode(bytes) };
  } catch {
    return { encoding: 'invalid-utf-8' };
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const roots = (options.paths.length ? options.paths : ['.']).map((path) => resolve(ROOT, path));
  const files = [];
  for (const root of roots) await collectFiles(root, files);
  files.sort();

  const failures = [];
  let converted = 0;

  for (const file of files) {
    const bytes = await readFile(file);
    let result = inspect(bytes);

    if (result.encoding === 'invalid-utf-8' && options.from) {
      result = {
        encoding: options.from,
        text: new TextDecoder(options.from, { fatal: true }).decode(bytes),
      };
    }

    if (result.encoding === 'utf-8') continue;

    const displayPath = relative(ROOT, file).replaceAll('\\', '/');
    if (!options.write || result.encoding === 'invalid-utf-8') {
      failures.push(`${displayPath}: ${result.encoding}`);
      continue;
    }

    await writeFile(file, result.text, 'utf8');
    converted += 1;
    console.log(`converted ${displayPath} (${result.encoding} -> utf-8)`);
  }

  if (failures.length) {
    console.error('Encoding check failed:');
    for (const failure of failures) console.error(`  ${failure}`);
    if (!options.write) {
      console.error('Run with --write to normalize BOM/UTF-16 files. Use --from explicitly for legacy encodings.');
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Encoding check passed: ${files.length} files, ${converted} converted.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
