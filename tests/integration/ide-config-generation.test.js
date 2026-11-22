/**
 * Integration test: every IDE option produces its config files in the right place.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { readFile, writeFile, readdir } from 'fs/promises';

import { Installer } from '../../tools/installer/index.js';
import { createSandbox } from '../helpers/sandbox.js';
import { assertDirExists, assertFileExists } from '../helpers/assertions.js';

async function installWithIde(ide, options = {}) {
  const sb = await createSandbox(`ide-${ide}`);
  const installer = new Installer({
    targetDir: sb.path,
    projectName: `Test ${ide}`,
    modules: [], // minimal install
    language: 'en',
    outputFolder: '_gdks-output',
    ide,
    installerVersion: '0.4.0-alpha.1',
    ...options
  });
  const result = await installer.install();
  return { sb, result, installer };
}

describe('IDE config installation', () => {
  describe('cursor', () => {
    it('creates .cursor/rules/gdks/ with .mdc files', async () => {
      const { sb, result } = await installWithIde('cursor');
      try {
        if (!result.success) throw new Error(`Install failed: ${result.error}`);
        await assertDirExists(join(sb.path, '.cursor', 'rules', 'gdks'));
      } finally {
        await sb.cleanup();
      }
    });
  });

  describe('windsurf', () => {
    it('creates .windsurf/gdks-rules.md', async () => {
      const { sb, result } = await installWithIde('windsurf');
      try {
        if (!result.success) throw new Error(`Install failed: ${result.error}`);
        await assertFileExists(join(sb.path, '.windsurf', 'gdks-rules.md'));
      } finally {
        await sb.cleanup();
      }
    });
  });

  describe('vscode', () => {
    it('creates .vscode/ with configuration files', async () => {
      const { sb, result } = await installWithIde('vscode');
      try {
        if (!result.success) throw new Error(`Install failed: ${result.error}`);
        await assertDirExists(join(sb.path, '.vscode'));
      } finally {
        await sb.cleanup();
      }
    });
  });

  describe('claude-code', () => {
    it('creates .claude/commands/gdks/ with .md files', async () => {
      const { sb, result } = await installWithIde('claude-code');
      try {
        if (!result.success) throw new Error(`Install failed: ${result.error}`);
        await assertDirExists(join(sb.path, '.claude', 'commands', 'gdks'));
      } finally {
        await sb.cleanup();
      }
    });
  });

  describe('chatgpt-codex', () => {
    it('installs project instructions and native definitions pointing to compiled agents', async () => {
      const { sb, result } = await installWithIde('chatgpt-codex', {
        modules: ['ideation', 'engine'], targetEngine: 'godot-4', preset: 'minimal'
      });
      try {
        assert.equal(result.success, true, result.error);
        const instructions = await readFile(join(sb.path, 'AGENTS.md'), 'utf8');
        assert.ok(instructions.includes('_gdks/core/agents/gdks-master.md'));
        const agentsDir = join(sb.path, '.codex', 'agents');
        const definitions = await readdir(agentsDir);
        const expected = [];
        for (const module of ['core', 'ideation', 'engine']) {
          const sourceDir = join(sb.path, '_gdks', module, 'agents');
          for (const file of await readdir(sourceDir)) {
            if (!file.endsWith('.agent.yaml')) continue;
            const id = file.slice(0, -'.agent.yaml'.length);
            const name = `gdks-${id.replace(/^gdks-/, '')}`;
            expected.push(`${name}.toml`);
            const definition = await readFile(join(agentsDir, `${name}.toml`), 'utf8');
            assert.ok(definition.includes(`name = "${name}"`));
            assert.match(definition, /^description = ".+"$/m);
            assert.match(definition, /^developer_instructions = ".+"$/m);
            assert.ok(definition.includes(`_gdks/${module}/agents/${id}.md`));
            await assertFileExists(join(sourceDir, `${id}.md`));
          }
        }
        assert.deepEqual(definitions.sort(), expected.sort());
        assert.ok(!definitions.some(file => file.includes('ue5-')));
        assert.ok(definitions.includes('gdks-godot-architect.toml'));
      } finally {
        await sb.cleanup();
      }
    });

    it('reinstalls without missing legacy templates or duplicated instructions', async () => {
      const { sb, result, installer } = await installWithIde('chatgpt-codex');
      try {
        assert.equal(result.success, true, result.error);
        const first = await readFile(join(sb.path, 'AGENTS.md'), 'utf8');
        const second = await installer.install();
        assert.equal(second.success, true, second.error);
        assert.equal(await readFile(join(sb.path, 'AGENTS.md'), 'utf8'), first);
      } finally {
        await sb.cleanup();
      }
    });

    it('preserves project instructions and custom native agents while refreshing its block', async () => {
      const { sb, result, installer } = await installWithIde('chatgpt-codex');
      try {
        assert.equal(result.success, true, result.error);
        const target = join(sb.path, 'AGENTS.md');
        const custom = '# Project rules\r\n\r\nUse Portuguese.\r\n';
        const customAgent = join(sb.path, '.codex', 'agents', 'gdks-master.toml');
        const customDefinition = 'name = "gdks-master"\ndescription = "Custom"\ndeveloper_instructions = "Keep my instructions"\n';
        await writeFile(target, custom);
        await writeFile(customAgent, customDefinition);
        await installer.installIdeConfig();
        const merged = await readFile(target, 'utf8');
        assert.ok(merged.startsWith(custom));
        assert.ok(merged.includes('<!-- gdks:instructions:start -->'));
        await writeFile(target, merged.replace('# GD-KS instructions for ChatGPT Codex', '# Old generated instructions') + '\nUser footer.\n');
        await installer.installIdeConfig();
        const refreshed = await readFile(target, 'utf8');
        assert.ok(refreshed.startsWith(custom));
        assert.ok(refreshed.endsWith('\nUser footer.\n'));
        assert.ok(!refreshed.includes('# Old generated instructions'));
        assert.equal(refreshed.split('<!-- gdks:instructions:start -->').length, 2);
        assert.equal(await readFile(customAgent, 'utf8'), customDefinition);
      } finally {
        await sb.cleanup();
      }
    });
  });

  describe('none', () => {
    it('does not create any IDE-specific folders', async () => {
      const { sb, result } = await installWithIde('none');
      try {
        if (!result.success) throw new Error(`Install failed: ${result.error}`);
        // Only _gdks and _gdks-output should be at the root. No .cursor/.vscode/etc
        const entries = await readdir(sb.path);
        const ideFolders = entries.filter((e) =>
          ['.cursor', '.windsurf', '.vscode', '.claude', '.codex', 'AGENTS.md'].includes(e)
        );
        if (ideFolders.length > 0) {
          throw new Error(`Unexpected IDE folders created: ${ideFolders.join(', ')}`);
        }
      } finally {
        await sb.cleanup();
      }
    });
  });
});
