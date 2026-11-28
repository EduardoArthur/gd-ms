import { Option } from 'commander';
import { Migration } from '../../gems/migration.js';
import { nextPhase } from '../../gems/migration-contracts.js';

const print = value => console.log(JSON.stringify(value, null, 2));

function printContract(report) {
  print(report);
  if (!report.passed) process.exitCode = 1;
}

export function registerMigrationCommands(program) {
  program.command('status')
    .description('Show the current migration phase, approval, and blockers')
    .action(async () => print(await (await Migration.load()).status()));

  program.command('history')
    .description('Show recorded migration events in sequence')
    .addOption(new Option('--phase <phase>', 'Filter by the phase where the event occurred').choices(Object.keys(nextPhase).concat('complete')))
    .action(async ({ phase }) => print(await (await Migration.load()).history(phase)));

  program.command('validate')
    .description('Check the current phase contract without changing migration state')
    .action(async () => printContract(await (await Migration.load()).validate()));

  program.command('advance')
    .description('Apply the current phase contract and record the outcome')
    .addOption(new Option('--phase <phase>', 'Require this phase before attempting the transition').choices(Object.keys(nextPhase)))
    .requiredOption('--actor <name>', 'Person or agent recording the transition')
    .action(async ({ actor, phase }) => printContract(await (await Migration.load()).advance(actor, phase)));

  program.command('approve')
    .description('Record explicit developer approval of the current plan revision')
    .requiredOption('--revision <id>', 'Exact plan revision approved by the developer')
    .requiredOption('--actor <name>', 'Developer who approved this revision')
    .action(async ({ revision, actor }) => print(await (await Migration.load()).approve(revision, actor)));

  program.command('resume')
    .description('Inspect the last consistent state and partial files from an open attempt')
    .action(async () => print(await (await Migration.load()).resume()));

  program.command('replan')
    .description('Return to planning or diagnosis and require a new approval')
    .requiredOption('--reason <text>', 'Reason for returning to an earlier phase')
    .requiredOption('--actor <name>', 'Person or agent recording the decision')
    .action(async ({ reason, actor }) => print(await (await Migration.load()).replan(reason, actor)));

  const attempt = program.command('attempt').description('Register implementation attempts');

  attempt.command('start')
    .description('Record an implementation attempt before touching destination files')
    .requiredOption('--unit <id>', 'Unit in the approved plan')
    .requiredOption('--actor <name>', 'Person or agent implementing the unit')
    .action(async ({ unit, actor }) => print(await (await Migration.load()).start(unit, actor)));

  attempt.command('finish <id>')
    .description('Register the result from attempts/<id>.json in the configured output folder')
    .requiredOption('--actor <name>', 'Person or agent recording the result')
    .action(async (id, { actor }) => print(await (await Migration.load()).finish(id, actor)));

  attempt.command('abandon <id>')
    .description('Close an incomplete attempt while preserving destination files')
    .requiredOption('--reason <text>', 'Reason for abandoning the attempt')
    .requiredOption('--actor <name>', 'Person or agent recording the decision')
    .option('--reconciled', 'Confirm that partial destination changes were reviewed')
    .action(async (id, { reason, reconciled, actor }) => print(await (await Migration.load()).abandon(id, reason, reconciled, actor)));
}
