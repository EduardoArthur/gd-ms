/**
 * Prepare CLI entry points during npm install.
 * 
 * Runs during npm install to set up the package
 */

import { chmod } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

for (const bin of ['gems.js', 'gd-ks.js']) {
  try {
    const binPath = join(__dirname, '..', 'bin', bin);
    await chmod(binPath, '755');
    console.log(`✓ Made bin/${bin} executable`);
  } catch (error) {
    // Ignore errors on Windows
    if (error.code !== 'ENOENT') {
      console.warn(`Warning: Could not set permissions on bin/${bin}`);
    }
  }
}
