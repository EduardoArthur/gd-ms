#!/usr/bin/env node

/**
 * GD-KS CLI Entry Point
 * Game Development Knowledge System
 *
 * Usage:
 *   npx gd-ks install    - Install GD-KS in current project
 *   npx gd-ks --help     - Show help
 *   npx gd-ks --version  - Show version
 */

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import CLI
async function main() {
  try {
    const cliPath = join(__dirname, '..', 'src', 'cli', 'index.js');

    const cli = await import(pathToFileURL(cliPath).href);

    await cli.default();
  } catch (error) {
    console.error('Error starting GD-KS:', error.message);
    process.exit(1);
  }
}

main();
