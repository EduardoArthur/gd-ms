import { Command, Option } from 'commander';
import { ModuleManager } from '../../tools/installer/index.js';
import { version } from '../version.js';
import { installGems } from './commands/gems-install.js';

export async function runGemsCli(argv = process.argv) {
  const program = new Command();
  const engines = ModuleManager.getAvailableEngines().map(({ id }) => id);

  program
    .name('gems')
    .description('GEMS (Game Engine Migration System)')
    .version(version);

  program
    .command('install')
    .description('Install the GEMS migration agents in the current destination project')
    .addOption(new Option('--engine <id>', 'Destination engine').choices(engines))
    .addOption(new Option('--ide <id>', 'Assistant integration').choices(['codex', 'none']))
    .option('-y, --yes', 'Skip prompts and use detected or saved settings')
    .action(options => installGems(options));

  if (argv.length <= 2) {
    program.outputHelp();
    return;
  }

  await program.parseAsync(argv);
}
