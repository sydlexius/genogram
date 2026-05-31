#!/usr/bin/env node
/**
 * Lasting guard against the npm optional-dependency pruning bug (npm/cli#4828).
 *
 * Several build-time deps (lightningcss, @rolldown/binding, ...) ship per-platform
 * native binaries as OPTIONAL dependencies. When package-lock.json is regenerated
 * on macOS, npm prunes the other platforms' binaries out of the lockfile. The
 * result builds fine locally (the dev's darwin binary is present) but `npm ci`
 * on Linux CI / Alpine Docker never installs the linux binary, and the build
 * crashes deep inside Vite with a cryptic "Cannot find module ...node" error.
 *
 * This script fails FAST with an actionable message: for every macOS native
 * package recorded in the lockfile, it requires the matching Linux variants that
 * CI (ubuntu / glibc) and Docker (node:*-alpine / musl) need at install time.
 *
 * Fix when this fails: pin the missing "<base>-linux-x64-gnu" and
 * "<base>-linux-x64-musl" packages in package.json "optionalDependencies"
 * (mirroring the existing pins), then run `npm install` to record them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));

// Platforms that must be installable from the lockfile, beyond the dev's macOS:
//   linux-x64-gnu  -> GitHub Actions ubuntu-latest (glibc)
//   linux-x64-musl -> Dockerfile node:*-alpine (musl)
const REQUIRED_LINUX_SUFFIXES = ['linux-x64-gnu', 'linux-x64-musl'];
const MAC_SUFFIX = 'darwin-arm64';

const names = Object.keys(lock.packages ?? {})
  .filter((p) => p.startsWith('node_modules/'))
  .map((p) => p.slice('node_modules/'.length));
const present = new Set(names);

const problems = [];
for (const name of names) {
  if (!name.endsWith(`-${MAC_SUFFIX}`)) continue;
  const base = name.slice(0, -(`-${MAC_SUFFIX}`.length));
  for (const suffix of REQUIRED_LINUX_SUFFIXES) {
    const required = `${base}-${suffix}`;
    if (!present.has(required)) {
      problems.push({ base, required });
    }
  }
}

if (problems.length > 0) {
  console.error('\n✗ Native-dependency lockfile guard FAILED\n');
  console.error(
    'These macOS native binaries are in package-lock.json but their Linux\n' +
      'counterparts are missing, so `npm ci` will fail on CI / Docker:\n',
  );
  for (const { base, required } of problems) {
    console.error(`  • ${base}: missing "${required}"`);
  }
  console.error(
    '\nFix: add the missing packages to "optionalDependencies" in package.json\n' +
      '(same version as the base package), then run `npm install`. See\n' +
      'scripts/check-native-deps.mjs for the full explanation.\n',
  );
  process.exit(1);
}

console.log(
  `✓ Native-dependency lockfile guard passed (checked ${
    names.filter((n) => n.endsWith(`-${MAC_SUFFIX}`)).length
  } macOS native package(s) for required Linux variants).`,
);
