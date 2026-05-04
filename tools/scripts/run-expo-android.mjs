/**
 * Runs `pnpm expo run:android` from `apps/mobile`, forwards stdout/stderr line-by-line, and drops
 * a known noisy PowerSync log line. Replaces `… | grep -v …` so the process exit code matches
 * Expo (portable; works without `grep` on Windows). If the child exits because of a signal
 * (e.g. Ctrl+C / SIGINT), the wrapper exits with **128 + signal number** so shells and CI match
 * `pnpm expo run:android` instead of always using `1`.
 *
 * On Windows, `pnpm` is typically a `.cmd` shim; `child_process.spawn('pnpm', …)` without a shell
 * often cannot start it. We set `shell: true` on win32 so the same script works there.
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { constants as osConstants } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOISE_SUBSTRING = 'Trying to close for the second time';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..', '..');
const mobileRoot = join(repoRoot, 'apps', 'mobile');

const isWindows = process.platform === 'win32';

const child = spawn('pnpm', ['expo', 'run:android'], {
  cwd: mobileRoot,
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: isWindows,
});

/**
 * @param {import('node:stream').Readable | null} stream
 * @param {NodeJS.WriteStream} out
 */
function pipeFilteredLines(stream, out) {
  if (!stream) {
    return;
  }
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (line.includes(NOISE_SUBSTRING)) {
      return;
    }
    out.write(`${line}\n`);
  });
}

pipeFilteredLines(child.stdout, process.stdout);
pipeFilteredLines(child.stderr, process.stderr);

const forwardSignal = (/** @type {NodeJS.Signals} */ sig) => {
  try {
    child.kill(sig);
  } catch {
    // ignore
  }
};
for (const sig of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  process.on(sig, forwardSignal);
}

/**
 * POSIX-style exit status when a process was terminated by a signal (same convention as bash).
 *
 * @param {NodeJS.Signals} signal
 * @returns {number}
 */
function exitCodeForSignal(signal) {
  const n = osConstants.signals[signal];
  return typeof n === 'number' ? 128 + n : 1;
}

child.on('close', (code, signal) => {
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.removeListener(sig, forwardSignal);
  }
  if (signal) {
    process.exit(exitCodeForSignal(signal));
  }
  process.exit(code === null || code === undefined ? 1 : code);
});
