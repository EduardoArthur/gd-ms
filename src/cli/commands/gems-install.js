import { basename, join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import inquirer from 'inquirer';
import { FileManager, Installer, ModuleManager } from '../../../tools/installer/index.js';
import { version } from '../../version.js';

async function detectEngines(targetDir, files) {
  const entries = await readdir(targetDir, { withFileTypes: true });
  const projectFiles = entries.filter(entry => entry.isFile()).map(entry => entry.name.toLowerCase());
  const markers = {
    'unreal-5': projectFiles.some(file => file.endsWith('.uproject')),
    'godot-4': projectFiles.includes('project.godot'),
    'unity-6': await files.exists(join(targetDir, 'ProjectSettings', 'ProjectVersion.txt'))
  };
  return Object.keys(markers).filter(engine => markers[engine]);
}

export async function installGems(options, targetDir = process.cwd()) {
  const files = new FileManager();
  const configPath = join(targetDir, '_gems', '_config', 'project-config.yaml');
  const existing = await files.exists(configPath) ? await files.readYaml(configPath) : null;
  const detected = await detectEngines(targetDir, files);
  const interactive = !options.yes && process.stdin.isTTY && process.stdout.isTTY;
  let targetEngine = options.engine || existing?.target_engine;

  if (!targetEngine && detected.length === 1) targetEngine = detected[0];
  if (!targetEngine && interactive) {
    const choices = ModuleManager.getAvailableEngines()
      .filter(({ id }) => detected.length === 0 || detected.includes(id))
      .map(({ id, name }) => ({ name, value: id }));
    ({ targetEngine } = await inquirer.prompt({ type: 'list', name: 'targetEngine', message: 'Destination engine:', choices }));
  }
  if (!targetEngine) {
    throw new Error('Could not determine the destination engine. Run from the destination project root and pass --engine.');
  }
  if (!ModuleManager.getAvailableEngines().some(({ id }) => id === targetEngine)) {
    throw new Error(`Unknown destination engine: ${targetEngine}. Pass --engine to choose a supported engine.`);
  }
  if (detected.length > 0 && !detected.includes(targetEngine)) {
    throw new Error(`The destination project matches ${detected.join(', ')}. Run from the matching project root or select its engine.`);
  }

  let ide = options.ide || existing?.settings?.ide;
  if (!ide && interactive) {
    ({ ide } = await inquirer.prompt({
      type: 'list',
      name: 'ide',
      message: 'Assistant integration:',
      choices: [{ name: 'Codex', value: 'codex' }, { name: 'Manual setup', value: 'none' }]
    }));
  }
  ide ||= 'codex';
  if (!['codex', 'none'].includes(ide)) {
    throw new Error(`Unknown assistant integration: ${ide}. Pass --ide codex or --ide none.`);
  }

  const installer = new Installer({
    product: 'gems',
    targetDir,
    targetEngine,
    ide,
    modules: ['migration'],
    projectName: existing?.project?.name || basename(targetDir),
    language: existing?.settings?.communication_language || 'en',
    runtimeEntry: fileURLToPath(new URL('../../../bin/gems.js', import.meta.url)),
    installerVersion: version
  });
  const result = await installer.install();
  if (!result.success) throw new Error(result.error);

  console.log(`GEMS agents installed for ${targetEngine}.`);
  console.log(ide === 'codex'
    ? 'Open the destination project in Codex and type *init.'
    : 'Load _gems/core/agents/gems-orchestrator.md in your assistant and type *init.');
}
