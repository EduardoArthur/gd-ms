import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { withSandbox } from '../helpers/sandbox.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));

test('packs and installs the GEMS CLI with its assets and runs the migration contracts', async () => {
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, 'Run this check with npm run test:package.');

  await withSandbox(async ({ path }) => {
    const destination = join(path, 'destination project');
    const source = join(path, 'source fixture');
    const cache = join(path, 'npm-cache');
    const npm = (cwd, args, exitCode = 0) => {
      const result = spawnSync(process.execPath, [npmCli, ...args, '--offline', '--cache', cache], {
        cwd, encoding: 'utf8'
      });
      if (result.error) throw result.error;
      assert.equal(result.status, exitCode, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
      return result.stdout;
    };
    const packed = JSON.parse(npm(repository, ['pack', '--pack-destination', path, '--json']));
    const pack = Array.isArray(packed) ? packed[0] : packed.gems;
    assert.ok(pack, 'npm did not report the GEMS archive.');
    const packageFiles = new Set(pack.files.map(file => file.path));
    assert.equal(pack.name, 'gems');
    for (const file of ['bin/gems.js', 'README.md', 'docs/NPM-PUBLISH-GUIDE.md',
      'src/gems/modules/migration/templates/plan.json', 'tools/validator/schema/migration-artifact.schema.json']) {
      assert.ok(packageFiles.has(file), `Archived file is missing: ${file}`);
    }
    for (const file of packageFiles) {
      assert.doesNotMatch(file, /^(bin\/gd-ks\.js|src\/ide-configs\/|src\/core\/agents\/|tests\/|samples\/)/);
      assert.doesNotMatch(file, /src\/modules\/engines\/[^/]+\/(agents|workflows)\//);
    }

    await mkdir(destination);
    await mkdir(source);
    const projectFile = join(destination, 'Fixture.uproject');
    const project = '{"FileVersion":3}\n';
    const originalInstructions = '# Fixture instructions\n\nPreserve the project naming conventions.\n';
    await writeFile(projectFile, project);
    await writeFile(join(destination, 'AGENTS.md'), originalInstructions);
    await writeFile(join(source, 'project.godot'), 'Source fixture\n');
    await writeFile(join(destination, 'package.json'), '{"name":"gems-package-test","private":true}\n');
    // Reuse locally installed dependencies so the tarball check can run offline.
    await cp(join(repository, 'node_modules'), join(destination, 'node_modules'), {
      recursive: true, verbatimSymlinks: true
    });
    npm(destination, ['install', '--no-save', '--no-package-lock', '--no-audit', '--no-fund', join(path, pack.filename)]);

    const localMetadata = JSON.parse(await readFile(join(destination, 'node_modules/gems/package.json')));
    assert.deepEqual(localMetadata.bin, { gems: './bin/gems.js' });
    assert.equal(localMetadata.scripts.prepare, undefined);
    function gems(args, exitCode = 0) {
      const result = spawnSync(process.execPath, [npmCli, 'exec', '--offline', '--cache', cache, '--', 'gems', ...args], {
        cwd: destination, encoding: 'utf8'
      });
      if (result.error) throw result.error;
      assert.equal(result.status, exitCode, `gems ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
      return result.stdout;
    }
    const json = (args, exitCode) => JSON.parse(gems(args, exitCode));
    assert.equal(gems(['--version']).trim(), pack.version);
    gems(['install', '--yes']);

    const manifestFile = join(destination, '_gems/_config/manifest.yaml');
    const manifest = yaml.load(await readFile(manifestFile, 'utf8'));
    assert.equal(manifest.gems_version, pack.version);
    assert.equal(manifest.artifacts.filter(file => file.endsWith('.toml')).length, 5);
    assert.equal(manifest.artifacts.filter(file => file.endsWith('/workflow.yaml')).length, 4);
    await Promise.all(manifest.artifacts.map(file => access(join(destination, file))));

    const fromTemplate = async (name, changes) => ({
      ...JSON.parse(await readFile(join(destination, '_gems/migration/templates', `${name}.json`), 'utf8')),
      ...changes
    });
    const output = async (name, data) => {
      const file = join(destination, '_gems-output', name);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(data));
    };
    const advance = (phase, exitCode) => json(['advance', '--phase', phase, '--actor', 'orchestrator'], exitCode);
    await output('migration-setup.json', await fromTemplate('setup', {
      source_path: source, source_version: '4.5.1', target_version: '5.8.4'
    }));
    await output('migration-diagnosis.json', await fromTemplate('diagnosis', { source_revision: 'fixture-1' }));
    assert.equal(advance('diagnosis').next, 'planning');
    const plan = await fromTemplate('plan', {});
    await output('migration-plan.json', plan);
    assert.equal(advance('planning', 1).passed, false);
    json(['approve', '--revision', plan.revision, '--actor', 'developer']);
    assert.equal(advance('planning').next, 'implementation');

    const unit = plan.units[0];
    const attempt = json(['attempt', 'start', '--unit', unit.id, '--actor', 'engine-specialist']);
    const destinationFile = join(destination, unit.paths[0]);
    await mkdir(dirname(destinationFile), { recursive: true });
    await writeFile(destinationFile, 'Candidate fixture\n');
    assert.deepEqual(json(['resume']).changed_paths, unit.paths);
    await output(`attempts/${attempt.id}.json`, await fromTemplate('implementation', {
      attempt_id: attempt.id, unit_id: unit.id, plan_revision: plan.revision, candidate_revision: 'candidate-1',
      outcome: 'passed', technical_checks: unit.technical_checks.map(check => ({ ...check, outcome: 'passed' }))
    }));
    json(['attempt', 'finish', attempt.id, '--actor', 'engine-specialist']);
    assert.equal(advance('implementation').next, 'verification');
    const criterion = plan.criteria[0];
    await output('migration-verification.json', await fromTemplate('verification', {
      plan_revision: plan.revision, candidate_revision: 'candidate-1', attempt_id: attempt.id,
      results: [{ criterion_id: criterion.id, outcome: 'passed', evidence: ['fixture.log'], notes: 'Simulated result' }]
    }));
    assert.equal(json(['validate'], 1).passed, false);
    await writeFile(join(destination, '_gems-output/fixture.log'), 'Simulated observation\n');
    assert.equal(advance('verification').next, 'complete');
    const before = json(['status']);
    gems(['install', '--yes']);
    assert.deepEqual(json(['status']), before);
    assert.ok((await readFile(join(destination, 'AGENTS.md'), 'utf8')).startsWith(originalInstructions));
    assert.equal(await readFile(projectFile, 'utf8'), project);
    assert.equal(await readFile(join(source, 'project.godot'), 'utf8'), 'Source fixture\n');
  }, 'gems-package');
});
