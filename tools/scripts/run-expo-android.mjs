/**
 * Runs `pnpm expo run:android` from `apps/mobile`, forwards stdout/stderr line-by-line, and drops
 * a known noisy PowerSync log line. Replaces `… | grep -v …` so the process exit code matches
 * Expo (portable; works without `grep` on Windows).
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOISE_SUBSTRING = 'Trying to close for the second time';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..', '..');
const mobileRoot = join(repoRoot, 'apps', 'mobile');

const child = spawn('pnpm', ['expo', 'run:android'], {
  cwd: mobileRoot,
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
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

child.on('close', (code, signal) => {
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.removeListener(sig, forwardSignal);
  }
  if (signal) {
    process.exit(1);
  }
  process.exit(code === null || code === undefined ? 1 : code);
});
