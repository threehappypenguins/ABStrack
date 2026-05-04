/**
 * Runs `pnpm expo run:android` from `apps/mobile`, forwards stdout/stderr line-by-line, and drops
 * a known noisy PowerSync log line. Replaces `… | grep -v …` so the process exit code matches
 * Expo (portable; works without `grep` on Windows). If the child exits because of a signal
 * (e.g. Ctrl+C / SIGINT), the wrapper exits with **128 + signal number** so shells and CI match
 * `pnpm expo run:android` instead of always using `1`.
 *
 * On Windows, `pnpm` is typically a `.cmd` shim; `child_process.spawn('pnpm', …)` without a shell
 * often cannot start it. We set `shell: true` on win32 so the same script works there.
 *
 * Listens for `error` on the child (e.g. `ENOENT` if `pnpm` is not on `PATH`) so startup failures
 * exit with code `1` after removing signal forwarders instead of throwing unhandled.
 *
 * Before `process.exit`, the script waits for forwarded readline streams to close and drains
 * `stdout`/`stderr` so buffered Expo lines are not truncated (Node does not flush stdio on exit).
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { constants as osConstants } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOISE_SUBSTRING = 'Trying to close for the second time';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..', '..');
const mobileRoot = join(repoRoot, 'apps', 'mobile');

const isWindows = process.platform === 'win32';

/**
 * Best-effort drain of a writable so buffered chunks reach the terminal before `process.exit`.
 *
 * @param {NodeJS.WriteStream} stream
 * @returns {Promise<void>}
 */
async function flushWritable(stream) {
  if (!stream || stream.destroyed) {
    return;
  }
  for (;;) {
    const len =
      typeof stream.writableLength === 'number' ? stream.writableLength : 0;
    const needDrain = stream.writableNeedDrain === true || len > 0;
    if (!needDrain) {
      return;
    }
    try {
      await once(stream, 'drain');
    } catch {
      return;
    }
  }
}

/**
 * Yields one turn of the event loop, drains stdio, then exits with `code`.
 *
 * @param {number} code
 * @returns {Promise<void>}
 */
async function flushAndExit(code) {
  await new Promise((resolve) => setImmediate(resolve));
  try {
    await flushWritable(process.stdout);
    await flushWritable(process.stderr);
  } catch {
    // ignore
  }
  process.exit(code);
}

const child = spawn('pnpm', ['expo', 'run:android'], {
  cwd: mobileRoot,
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: isWindows,
});

/**
 * Forwards lines to `out`, filtering noise. Resolves when the readline interface closes (child
 * stream ended and trailing line processed).
 *
 * @param {import('node:stream').Readable | null} stream
 * @param {NodeJS.WriteStream} out
 * @returns {Promise<void>}
 */
function pipeFilteredLines(stream, out) {
  if (!stream) {
    return Promise.resolve();
  }
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (line.includes(NOISE_SUBSTRING)) {
      return;
    }
    out.write(`${line}\n`);
  });
  return once(rl, 'close').then(() => undefined);
}

const stdoutClosed = pipeFilteredLines(child.stdout, process.stdout);
const stderrClosed = pipeFilteredLines(child.stderr, process.stderr);

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

/** Ensures we exit once and drop SIGINT/SIGTERM forwarders (spawn may never emit `close`). */
let childSettled = false;

function removeSignalForwarders() {
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.removeListener(sig, forwardSignal);
  }
}

child.on('error', (err) => {
  console.error(
    '[run-expo-android] Failed to start child process:',
    err instanceof Error ? err.message : String(err),
  );
  if (childSettled) {
    return;
  }
  childSettled = true;
  removeSignalForwarders();
  void Promise.all([stdoutClosed, stderrClosed])
    .catch(() => undefined)
    .then(() => flushAndExit(1));
});

child.on('close', (code, signal) => {
  if (childSettled) {
    return;
  }
  childSettled = true;
  removeSignalForwarders();
  const exitCode = signal
    ? exitCodeForSignal(signal)
    : code === null || code === undefined
      ? 1
      : code;
  void Promise.all([stdoutClosed, stderrClosed])
    .catch(() => undefined)
    .then(() => flushAndExit(exitCode));
});
