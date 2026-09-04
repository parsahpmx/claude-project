#!/usr/bin/env node
import { run } from './index.js';

/**
 * The executable.
 *
 * Sets the exit code rather than calling `process.exit`, so buffered stdout is
 * flushed before the process ends — otherwise piping `meter402 endpoints` into
 * anything can lose the last lines.
 */
void run(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
