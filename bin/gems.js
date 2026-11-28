#!/usr/bin/env node

import { runGemsCli } from '../src/cli/gems.js';

try {
  await runGemsCli(process.argv);
} catch (error) {
  console.error(`GEMS: ${error.message}`);
  process.exitCode = 1;
}
