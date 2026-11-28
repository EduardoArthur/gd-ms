/**
 * GEMS - Game Engine Migration System
 * 
 * Main module entry point
 * 
 * @module gems
 */

// Export version
export { version } from './version.js';

// Export CLI
export { runGemsCli as cli } from './cli/gems.js';

// Future exports for programmatic usage
// export { Installer } from './installer/index.js';
// export { AgentCompiler } from './compiler/index.js';
// export { WorkflowEngine } from './workflow/index.js';
