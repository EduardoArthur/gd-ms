import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { installGems } from '../../src/cli/commands/gems-install.js';
import { Migration } from '../../src/gems/migration.js';
import { withSandbox } from '../helpers/sandbox.js';

async function fixture(root) {
  const destination = join(root, 'destination');
  const source = join(root, 'source');
  await mkdir(source);
  await mkdir(destination);
  await writeFile(join(source, 'project.godot'), 'source fixture\n');
  await writeFile(join(destination, 'Game.uproject'), '{}\n');
  await installGems({ yes: true, ide: 'none' }, destination);
  const put = async (name, value) => {
    const path = join(destination, '_gems-output', name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const setup = {
    kind: 'setup', source_path: '../source', source_engine: 'godot-4', source_version: '4.5.1',
    target_engine: 'unreal-5', target_version: '5.8.4', platform: 'Windows desktop'
  };
  const diagnosis = {
    kind: 'diagnosis', source_revision: 'source-r1', inventory: ['Player scene'],
    reference_scenarios: ['Jump from the floor with a single input'],
    coverage: [{ item: 'Jump input', status: 'supported', notes: 'Can be reimplemented' }], blockers: []
  };
  const plan = {
    kind: 'plan', revision: 'r1', strategy: 'Port the input and jump logic.',
    units: [
      { id: 'input', depends_on: [], paths: ['Input.cpp'], technical_checks: [{ id: 'compile', procedure: 'Compile input' }] },
      { id: 'jump', depends_on: ['input'], paths: ['Jump.cpp'], technical_checks: [{ id: 'compile', procedure: 'Compile jump' }] }
    ],
    criteria: [
      { id: 'jumps', phase: 'verification', scenario: 'Press jump', method: 'Compare recorded movement', expected: 'Player leaves floor', required: true, tolerance: null },
      { id: 'animation', phase: 'verification', scenario: 'Press jump', method: 'Inspect capture', expected: 'Animation starts', required: false, tolerance: null }
    ]
  };
  return { destination, source, put, setup, diagnosis, plan };
}

test('walks the installed workflows, preserves approval across reloads and validates a delivery', async () => {
  await withSandbox(async ({ path }) => {
    const { destination, source, put, setup, diagnosis, plan } = await fixture(path);
    let migration = await Migration.load(destination);
    assert.equal((await migration.status()).phase, 'diagnosis');
    assert.equal((await migration.advance('orchestrator')).passed, false);
    await put('migration-setup.json', { ...setup, source_path: '.' });
    await put('migration-diagnosis.json', diagnosis);
    assert.match((await migration.validate()).blockers.join(), /must not overlap/);
    await put('migration-setup.json', setup);
    assert.equal((await migration.advance('orchestrator')).next, 'planning');

    await put('migration-plan.json', plan);
    assert.equal((await migration.advance('orchestrator')).passed, false);
    await assert.rejects(migration.start('input', 'engine-specialist'), /Advance to implementation/);
    await migration.approve('r1', 'Edu');
    await put('migration-plan.json', { ...plan, strategy: 'Revised without changing the revision ID.' });
    assert.match((await migration.validate()).blockers.join(), /require approval/);
    await put('migration-plan.json', { ...plan, revision: 'r2' });
    await migration.approve('r2', 'Edu');

    migration = await Migration.load(destination);
    assert.equal((await migration.status()).approval.actor, 'Edu');
    await assert.rejects(migration.advance('orchestrator', 'diagnosis'), /current phase is planning/);
    assert.equal((await migration.advance('orchestrator')).next, 'implementation');
    await assert.rejects(migration.start('jump', 'engine-specialist'), /waiting for: input/);

    const starts = await Promise.allSettled([
      migration.start('input', 'engine-specialist'), migration.start('input', 'engine-specialist')
    ]);
    const open = starts.find(result => result.status === 'fulfilled').value;
    assert.equal(starts.filter(result => result.status === 'fulfilled').length, 1);
    await writeFile(join(destination, 'Input.cpp'), 'partial');
    migration = await Migration.load(destination);
    const recovery = await migration.resume();
    assert.equal(recovery.attempt.id, open.id);
    assert.deepEqual(recovery.changed_paths, ['Input.cpp']);
    await assert.rejects(migration.abandon(open.id, 'Review required', false, 'Edu'), /--reconciled/);
    await migration.abandon(open.id, 'Reviewed partial files and will finish in a new attempt', true, 'Edu');
    assert.equal(await readFile(join(destination, 'Input.cpp'), 'utf8'), 'partial');

    const finish = async (unit, file) => {
      const attempt = await migration.start(unit, 'engine-specialist');
      await writeFile(join(destination, file), `working ${unit}`);
      const reportPath = `attempts/${attempt.id}.json`;
      const report = {
        kind: 'implementation', attempt_id: attempt.id, unit_id: unit, plan_revision: 'r2',
        outcome: 'passed', candidate_revision: `${unit}-candidate`,
        technical_checks: [{ id: 'compile', procedure: 'Compiled the edited file', outcome: 'passed' }]
      };
      await put(reportPath, { ...report, technical_checks: [] });
      await assert.rejects(migration.finish(attempt.id, 'engine-specialist'), /technical checks must pass: compile/);
      await put(reportPath, report);
      await migration.finish(attempt.id, 'engine-specialist');
      return attempt;
    };
    await finish('input', 'Input.cpp');
    await finish('jump', 'Jump.cpp');
    await finish('input', 'Input.cpp');
    assert.match((await migration.validate()).blockers.join(), /passed current attempt: jump/);
    const candidate = await finish('jump', 'Jump.cpp');
    assert.equal((await migration.advance('orchestrator')).next, 'verification');

    const report = {
      kind: 'verification', plan_revision: 'r2', attempt_id: candidate.id, candidate_revision: 'jump-candidate',
      results: [
        { criterion_id: 'jumps', outcome: 'inconclusive', evidence: [], notes: 'Awaiting a run.' },
        { criterion_id: 'animation', outcome: 'inconclusive', evidence: [], notes: 'No capture.' }
      ]
    };
    await put('migration-verification.json', report);
    assert.match((await migration.advance('orchestrator')).blockers.join(), /Mandatory criterion jumps: inconclusive/);
    report.results[0].outcome = 'passed';
    assert.equal((await migration.status()).phase, 'verification');
    await put('migration-verification.json', report);
    assert.match((await migration.validate()).blockers.join(), /Missing evidence for passed criterion jumps/);
    report.results[0].evidence = ['jump-run.log'];
    await put('migration-verification.json', report);
    assert.match((await migration.validate()).blockers.join(), /Missing output artifact: jump-run.log/);
    await put('jump-run.log', 'Jump scenario passed.');
    await put('migration-verification.json', { ...report, attempt_id: open.id });
    assert.match((await migration.validate()).blockers.join(), /current candidate attempt/);
    await put('migration-verification.json', report);
    await writeFile(join(destination, 'Jump.cpp'), 'externally modified');
    assert.match((await migration.validate()).blockers.join(), /Candidate files changed/);
    await writeFile(join(destination, 'Jump.cpp'), 'working jump');
    assert.equal((await migration.advance('orchestrator')).next, 'complete');

    await installGems({ yes: true }, destination);
    assert.equal((await (await Migration.load(destination)).status()).phase, 'complete');
    const history = await migration.history();
    assert.deepEqual(history.map(event => event.sequence), history.map((_, index) => index + 1));
    assert.ok(history.some(event => event.type === 'attempt-abandoned' && event.attempt.plan_revision === 'r2'));
    assert.deepEqual(await migration.history('verification'), history.filter(event => event.phase === 'verification'));
    assert.equal(await readFile(join(source, 'project.godot'), 'utf8'), 'source fixture\n');
    await put('jump-run.log', 'Changed after delivery.');
    assert.match((await migration.validate()).blockers.join(), /evidence changed after completion/);
  }, 'gems-workflows');
});

test('rejects cyclic or escaping units and restarts diagnosis if its inputs changed', async () => {
  await withSandbox(async ({ path }) => {
    const { destination, put, setup, diagnosis, plan } = await fixture(path);
    const migration = await Migration.load(destination);
    await put('migration-setup.json', setup);
    await put('migration-diagnosis.json', diagnosis);
    await migration.advance('orchestrator');
    plan.units[0].depends_on = ['jump'];
    await put('migration-plan.json', plan);
    await assert.rejects(migration.approve('r1', 'Edu'), /Cyclic unit dependency/);
    plan.units[0].depends_on = [];
    plan.units[0].paths = ['../source/project.godot'];
    await put('migration-plan.json', plan);
    await assert.rejects(migration.approve('r1', 'Edu'), /Use a destination project file/);
    await put('migration-diagnosis.json', { ...diagnosis, source_revision: 'source-r2' });
    assert.deepEqual(await migration.replan('Source changed', 'Edu'), { phase: 'diagnosis' });
    assert.equal((await migration.advance('orchestrator')).next, 'planning');
  }, 'gems-contracts');
});
