/**
 * GD-KS Installer
 * Main installation logic
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFile } from 'fs/promises';
import { ModuleManager } from './module-manager.js';
import { FileManager } from './file-manager.js';
import { AgentCompiler } from './agent-compiler.js';
import { ManifestGenerator } from './manifest-generator.js';
import { GitignoreGenerator } from './gitignore-generator.js';
import { MigrationState } from '../../../src/gems/migration-state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SRC_ROOT = join(__dirname, '..', '..', '..', 'src');
const IDE_CONFIGS_PATH = join(SRC_ROOT, 'ide-configs');

export class Installer {
  constructor(options = {}) {
    this.targetDir = options.targetDir || process.cwd();
    this.product = options.product === 'gems' ? 'gems' : 'gdks';
    this.installFolder = `_${this.product}`;
    this.installDir = join(this.targetDir, this.installFolder);
    this.gdksDir = this.installDir;
    this.outputFolder = options.outputFolder || `${this.installFolder}-output`;
    this.outputDir = join(this.targetDir, this.outputFolder);
    this.config = options;

    this.fileManager = new FileManager();
    this.moduleManager = new ModuleManager({
      targetEngine: options.targetEngine,
      srcRoot: this.product === 'gems' ? join(SRC_ROOT, 'gems') : SRC_ROOT
    });
    this.agentCompiler = new AgentCompiler();
    this.manifestGenerator = new ManifestGenerator();
  }

  /**
   * Run the installation
   */
  async install(progressCallback = () => {}) {
    try {
      // Step 1: Create directory structure
      progressCallback('Creating directory structure...');
      await this.createDirectoryStructure();

      // Step 2: Install core module (always required)
      progressCallback('Installing core module...');
      await this.installModule('core');

      // Step 3: Install selected modules
      const modules = this.config.modules || [];
      for (const moduleName of modules) {
        if (moduleName !== 'core') {
          progressCallback(`Installing ${moduleName} module...`);
          await this.installModule(moduleName);
        }
      }

      if (this.product === 'gems' && modules.includes('migration')) {
        progressCallback('Installing engine profiles...');
        await this.installGemsEngineProfiles();
      }

      // Step 4: Compile all agents
      progressCallback('Compiling agents...');
      await this.compileAgents();

      // Step 5: Create configuration files
      progressCallback('Creating configuration files...');
      await this.createConfigFiles();

      if (this.product === 'gems') {
        progressCallback('Creating output directories...');
        await this.fileManager.ensureDir(this.outputDir);
        if (modules.includes('migration')) await new MigrationState(this.targetDir).initialize();
      } else {
        progressCallback('Generating manifest...');
        await this.generateManifest();
        progressCallback('Creating .gitignore...');
        await this.createGitignore();
        progressCallback('Creating output directories...');
        await this.createOutputDirectories();
        progressCallback('Initializing project state...');
        await this.initializeState();
        progressCallback('Installing handoff contracts...');
        await this.installContracts();
      }

      // Step 11: Install IDE configuration
      if (this.config.ide && this.config.ide !== 'none') {
        progressCallback(`Installing ${this.config.ide} configuration...`);
        await this.installIdeConfig();
      }

      if (this.product === 'gems') {
        progressCallback('Generating manifest...');
        await this.generateManifest();
      }

      return {
        success: true,
        [`${this.product}Dir`]: this.installDir,
        outputDir: this.outputDir,
        ide: this.config.ide
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Create the main directory structure
   */
  async createDirectoryStructure() {
    if (this.product === 'gems') {
      await this.fileManager.ensureDir(join(this.installDir, '_config'));
      return;
    }

    const directories = [
      this.gdksDir,
      join(this.gdksDir, 'core'),
      join(this.gdksDir, 'core', 'agents'),
      join(this.gdksDir, 'core', 'workflows'),
      join(this.gdksDir, '_memory'),
      join(this.gdksDir, '_config'),
      join(this.gdksDir, '_state'),
      join(this.gdksDir, '_state', 'checkpoints'),
      join(this.gdksDir, '_state', 'history'),
      join(this.gdksDir, '_contracts')
    ];

    for (const dir of directories) {
      await this.fileManager.ensureDir(dir);
    }
  }

  /**
   * Install a specific module
   */
  async installModule(moduleName) {
    const moduleTarget = join(this.installDir, moduleName);

    await this.fileManager.ensureDir(moduleTarget);
    await this.moduleManager.installModule(moduleName, moduleTarget);
  }

  async installGemsEngineProfiles() {
    const { EngineProfileManager } = await import('../../../src/core/engines/engine-profile-manager.js');
    const profiles = new EngineProfileManager();
    const profileDir = join(this.installDir, 'migration', 'engine-profiles');

    for (const { id } of ModuleManager.getAvailableEngines()) {
      const { schema_version, engine, paradigms, capabilities } = await profiles.load(id);
      await this.fileManager.writeYaml(join(profileDir, `${id}.yaml`), {
        schema_version,
        engine,
        paradigms,
        capabilities
      });
    }
  }

  /**
   * Compile all agents from YAML to MD.
   * If a preset is active, agents disabled by the preset are removed
   * (both .agent.yaml source and any compiled .md) from the installed tree.
   */
  async compileAgents() {
    const modules = new Set(['core', ...(this.config.modules || [])]);

    // Load preset if one is configured
    let preset = null;
    if (this.config.preset) {
      try {
        const { PresetManager } = await import('../../../src/core/presets/preset-manager.js');
        const pm = new PresetManager();
        preset = await pm.load(this.config.preset);
      } catch (err) {
        // Fall through — no preset filtering
        console.warn(`Warning: could not load preset "${this.config.preset}": ${err.message}`);
      }
    }

    for (const moduleName of modules) {
      const agentsDir = join(this.installDir, moduleName, 'agents');

      // Remove disabled agents before compiling
      if (preset) {
        await this._prunePresetDisabledAgents(agentsDir, moduleName, preset);
      }

      await this.agentCompiler.compileAll(agentsDir, this.config);
    }
  }

  /**
   * Remove agent YAML/MD files that are disabled by the active preset.
   *
   * The preset's agents_active/agents_disabled lists were written with
   * Unreal Engine 5 agent ids in mind (`ue5-architect`, etc.). When the
   * user picks a different engine (godot-4, unity-6), we substitute
   * those references for the equivalents from that engine's profile.
   */
  async _prunePresetDisabledAgents(agentsDir, moduleName, preset) {
    if (!(await this.fileManager.exists(agentsDir))) return;
    const { unlink } = await import('fs/promises');

    // For the "engine" module, resolve the preset's UE5-centric agent list
    // to whatever the target engine actually provides.
    let resolvedActive = new Set(preset.agents_active?.[moduleName] || []);
    let resolvedDisabled = new Set(preset.agents_disabled || []);

    if (moduleName === 'engine' && this.config.targetEngine && this.config.targetEngine !== 'unreal-5') {
      try {
        const { EngineProfileManager } = await import('../../../src/core/engines/engine-profile-manager.js');
        const epm = new EngineProfileManager();
        const profile = await epm.load(this.config.targetEngine);

        // If the preset lists any UE5 engine agents, substitute for the
        // full set provided by the active engine. This keeps the "size"
        // of the engine team consistent with the preset's intent.
        const ue5Agents = [
          'ue5-architect', 'ue5-programmer-lead', 'ue5-systems-specialist',
          'ue5-blueprint-specialist', 'engine-coordinator'
        ];
        const hadUE5Active = Array.from(resolvedActive).some((a) => ue5Agents.includes(a));

        if (hadUE5Active) {
          // Drop UE5 agents from both sets
          for (const a of ue5Agents) {
            resolvedActive.delete(a);
            resolvedDisabled.delete(a);
          }
          // Add the full set of this engine's agents as active
          for (const a of profile.agents_provided || []) {
            resolvedActive.add(a);
          }
        }
      } catch (err) {
        console.warn(`Warning: could not resolve engine agents for ${this.config.targetEngine}: ${err.message}`);
      }
    }

    const files = await this.fileManager.listFiles(agentsDir, '.agent.yaml');

    for (const file of files) {
      const agentId = file.replace('.agent.yaml', '');
      // Keep if explicitly active (module-level)
      if (resolvedActive.has(agentId)) continue;
      // Remove if in disabled list
      if (resolvedDisabled.has(agentId)) {
        await unlink(join(agentsDir, file));
        const mdPath = join(agentsDir, agentId + '.md');
        if (await this.fileManager.exists(mdPath)) {
          await unlink(mdPath);
        }
      }
    }
  }

  /**
   * Create configuration files
   */
  async createConfigFiles() {
    const configPath = join(this.installDir, '_config', 'project-config.yaml');
    if (this.product === 'gems') {
      const existing = await this.fileManager.exists(configPath) ? await this.fileManager.readYaml(configPath) : {};
      await this.fileManager.writeYaml(configPath, {
        ...existing,
        project: { name: this.config.projectName, ...existing?.project },
        target_engine: this.config.targetEngine,
        runtime: this.config.runtimeEntry ? { entry: this.config.runtimeEntry } : existing?.runtime,
        settings: {
          ...existing?.settings,
          output_folder: this.outputFolder,
          communication_language: this.config.language || 'en',
          ide: this.config.ide || 'codex'
        },
        modules: { installed: ['core', ...(this.config.modules || [])] }
      });
      return;
    }

    // Project config
    const projectConfig = {
      project: {
        name: this.config.projectName || 'My Game Project',
        version: '0.1.0'
      },
      settings: {
        output_folder: this.config.outputFolder || '_gdks-output',
        communication_language: this.config.language || 'en',
        ide: this.config.ide || 'cursor'
      },
      modules: {
        installed: ['core', ...(this.config.modules || [])]
      }
    };

    await this.fileManager.writeYaml(
      configPath,
      projectConfig
    );
  }

  /**
   * Generate installation manifest
   */
  async generateManifest() {
    const manifestPath = join(this.installDir, '_config', 'manifest.yaml');
    const existing = this.product === 'gems' && await this.fileManager.exists(manifestPath)
      ? await this.fileManager.readYaml(manifestPath)
      : null;
    const manifest = this.manifestGenerator.generate({
      product: this.product,
      version: this.config.installerVersion || '0.1.0-alpha.1',
      installedAt: existing?.installed_at,
      modules: ['core', ...(this.config.modules || [])],
      config: {
        projectName: this.config.projectName,
        language: this.config.language,
        outputFolder: this.outputFolder,
        targetEngine: this.config.targetEngine,
        ide: this.config.ide
      }
    });

    if (this.product === 'gems') manifest.artifacts = await this.gemsArtifacts(manifest.modules.installed);
    await this.fileManager.writeYaml(manifestPath, manifest);
  }

  async gemsArtifacts(modules) {
    const files = new Set([`${this.installFolder}/_config/project-config.yaml`]);
    for (const name of new Set(modules)) {
      const modulePath = `${this.installFolder}/${name}`;
      const descriptor = await this.moduleManager.getModuleConfig(name);
      files.add(`${modulePath}/module.yaml`);
      for (const entry of descriptor.agents ?? []) {
        const id = typeof entry === 'string' ? entry : entry.id;
        files.add(`${modulePath}/agents/${id}.agent.yaml`);
        files.add(`${modulePath}/agents/${id}.md`);
        if (['codex', 'chatgpt-codex'].includes(this.config.ide)) {
          files.add(`.codex/agents/${this.codexAgentName(id)}.toml`);
        }
      }
      for (const entry of descriptor.workflows ?? []) {
        const id = typeof entry === 'string' ? entry : entry.id;
        files.add(`${modulePath}/workflows/${id}/workflow.yaml`);
        files.add(`${modulePath}/workflows/${id}/instructions.md`);
      }
      const templates = join(this.moduleManager.getModulePath(name), 'templates');
      for (const file of await this.fileManager.listFiles(templates)) files.add(`${modulePath}/templates/${file}`);
      if (name === 'migration') {
        for (const { id } of ModuleManager.getAvailableEngines()) files.add(`${modulePath}/engine-profiles/${id}.yaml`);
      }
    }
    if (['codex', 'chatgpt-codex'].includes(this.config.ide)) files.add('AGENTS.md');
    return [...files].sort();
  }

  /**
   * Create an engine-specific .gitignore without replacing user-maintained
   * project settings during an update or reinstallation.
   */
  async createGitignore() {
    const gitignorePath = join(this.targetDir, '.gitignore');
    if (await this.fileManager.exists(gitignorePath)) {
      return;
    }

    const engine = this.config.targetEngine || 'unreal-5';
    await this.fileManager.writeFile(gitignorePath, GitignoreGenerator.generate(engine));
  }

  /**
   * Create output directories for generated documents
   */
  async createOutputDirectories() {
    const outputDirs = [
      this.outputDir,
      join(this.outputDir, '01-ideation'),
      join(this.outputDir, '02-design'),
      join(this.outputDir, '03-planning'),
      join(this.outputDir, '04-engine')
    ];

    for (const dir of outputDirs) {
      await this.fileManager.ensureDir(dir);
    }

    // Create .gitkeep files
    for (const dir of outputDirs.slice(1)) {
      await this.fileManager.writeFile(join(dir, '.gitkeep'), '');
    }
  }

  /**
   * Initialize the project-state.yaml (v0.4 Sprint 2).
   * Idempotent: if state already exists, leave it alone.
   */
  async initializeState() {
    const { StateManager } = await import('../../../src/core/state/state-manager.js');
    const { EventLogger } = await import('../../../src/core/state/event-logger.js');
    const sm = new StateManager({ projectRoot: this.targetDir });
    if (await sm.exists()) {
      return; // upgrading an existing install — don't overwrite
    }
    await sm.init({
      projectName: this.config.projectName,
      preset: this.config.preset,
      targetEngine: this.config.targetEngine || 'unreal-5',
      language: this.config.language || 'en'
    });

    // Log the install event
    const logger = new EventLogger({ projectRoot: this.targetDir });
    await logger.log({
      type: 'project_initialized',
      version: this.config.installerVersion,
      modules: this.config.modules || [],
      ide: this.config.ide || 'none'
    });
  }

  /**
   * Copy default handoff contracts into the user's project (v0.4 Sprint 2).
   * Does not overwrite user-customized contracts.
   */
  async installContracts() {
    const { ContractLoader } = await import('../../../src/core/contracts/contract-loader.js');
    const sourceDir = ContractLoader.getPackageContractsDir();
    const targetDir = join(this.gdksDir, '_contracts');

    if (!await this.fileManager.exists(sourceDir)) {
      return; // no defaults shipped — skip
    }

    const files = await this.fileManager.listFiles(sourceDir, '.contract.yaml');
    for (const file of files) {
      const target = join(targetDir, file);
      // Don't overwrite user-customized contracts on upgrade
      if (await this.fileManager.exists(target)) continue;
      await this.fileManager.copy(join(sourceDir, file), target);
    }
  }

  /**
   * Install IDE-specific configuration files
   */
  async installIdeConfig() {
    const ide = this.config.ide || 'cursor';

    switch (ide) {
    case 'cursor':
      await this.installCursorConfig();
      break;
    case 'windsurf':
      await this.installWindsurfConfig();
      break;
    case 'vscode':
      await this.installVSCodeConfig();
      break;
    case 'claude-code':
      await this.installClaudeCodeConfig();
      break;
    case 'codex':
    case 'chatgpt-codex':
      await this.installChatGPTCodexConfig();
      break;
    default:
      // No IDE config to install
      break;
    }
  }

  /**
   * Install Cursor IDE configuration
   */
  async installCursorConfig() {
    const cursorRulesDir = join(this.targetDir, '.cursor', 'rules', 'gdks');
    await this.fileManager.ensureDir(cursorRulesDir);

    // Copy all .mdc files from cursor config
    const sourceDir = join(IDE_CONFIGS_PATH, 'cursor', 'rules');

    if (await this.fileManager.exists(sourceDir)) {
      const files = await this.fileManager.listFiles(sourceDir, '.mdc');

      for (const file of files) {
        await this.fileManager.copy(
          join(sourceDir, file),
          join(cursorRulesDir, file)
        );
      }
    }
  }

  /**
   * Install Windsurf IDE configuration
   */
  async installWindsurfConfig() {
    const windsurfDir = join(this.targetDir, '.windsurf');
    await this.fileManager.ensureDir(windsurfDir);

    const sourceFile = join(IDE_CONFIGS_PATH, 'windsurf', 'gdks-rules.md');

    if (await this.fileManager.exists(sourceFile)) {
      await this.fileManager.copy(
        sourceFile,
        join(windsurfDir, 'gdks-rules.md')
      );
    }
  }

  /**
   * Install VS Code configuration
   */
  async installVSCodeConfig() {
    const vscodeDir = join(this.targetDir, '.vscode');
    await this.fileManager.ensureDir(vscodeDir);

    // Copy settings and README
    const sourceDir = join(IDE_CONFIGS_PATH, 'vscode');

    if (await this.fileManager.exists(sourceDir)) {
      const files = await this.fileManager.listFiles(sourceDir);

      for (const file of files) {
        await this.fileManager.copy(
          join(sourceDir, file),
          join(vscodeDir, file.replace('gdks-', ''))
        );
      }
    }
  }

  /**
   * Install Claude Code configuration
   */
  async installClaudeCodeConfig() {
    const claudeDir = join(this.targetDir, '.claude', 'commands', 'gdks');
    await this.fileManager.ensureDir(claudeDir);

    const sourceDir = join(IDE_CONFIGS_PATH, 'claude-code', 'commands');

    if (await this.fileManager.exists(sourceDir)) {
      const files = await this.fileManager.listFiles(sourceDir, '.md');

      for (const file of files) {
        await this.fileManager.copy(
          join(sourceDir, file),
          join(claudeDir, file)
        );
      }
    }
  }

  /**
   * Install ChatGPT Codex project instructions.
   *
   * Maintain the installed product's block and preserve project instructions.
   */
  async installChatGPTCodexConfig() {
    await this.installCodexAgents();

    const targetFile = join(this.targetDir, 'AGENTS.md');
    const configRoot = this.product === 'gems' ? join(SRC_ROOT, 'gems', 'ide-configs') : IDE_CONFIGS_PATH;
    const templateDir = join(configRoot, 'chatgpt-codex');
    const template = await this.fileManager.readFile(join(templateDir, 'AGENTS.md'));
    const start = `<!-- ${this.product}:instructions:start -->`;
    const end = `<!-- ${this.product}:instructions:end -->`;
    const block = `${start}\n${template.trim()}\n${end}\n`;
    const current = await this.fileManager.exists(targetFile)
      ? await this.fileManager.readFile(targetFile)
      : '';
    const startIndex = current.indexOf(start);
    const endIndex = current.indexOf(end, startIndex + start.length);
    let content;
    if (startIndex !== -1 && endIndex !== -1) {
      content = current.slice(0, startIndex) + block.trimEnd() + current.slice(endIndex + end.length);
    } else if (current.replaceAll('\r\n', '\n').trim() === template.replaceAll('\r\n', '\n').trim()) {
      content = block;
    } else {
      content = current + (current ? '\n\n' : '') + block;
    }
    await this.fileManager.writeFile(targetFile, content);
  }

  /**
   * Register installed roles as project-scoped Codex subagents.
   */
  async installCodexAgents() {
    const targetDir = join(this.targetDir, '.codex', 'agents');
    await this.fileManager.ensureDir(targetDir);

    for (const moduleName of new Set(['core', ...(this.config.modules || [])])) {
      const sourceDir = join(this.installDir, moduleName, 'agents');
      for (const file of await this.fileManager.listFiles(sourceDir, '.agent.yaml')) {
        const id = file.slice(0, -'.agent.yaml'.length);
        const name = this.codexAgentName(id);
        const { metadata } = await this.fileManager.readYaml(join(sourceDir, file));
        const instructions = [
          `Resolve project paths from the project root. Read ${this.installFolder}/_config/project-config.yaml for language and output settings.`,
          `Read ${this.installFolder}/${moduleName}/agents/${id}.md and its corresponding .agent.yaml before responding.`,
          'Use that persona, principles, and critical actions. Follow the instructions for the assigned command or workflow.',
          'Follow the parent task scope. Do not show an activation menu or start an interactive workflow unless assigned.',
          'Return findings, proposed changes, or questions to the parent for the assigned step only. Leave file writes to the parent.',
          'The parent handles user interaction, decisions, workflow progression, and file writes.'
        ].join('\n');
        const content = [
          `name = ${JSON.stringify(name)}`,
          `description = ${JSON.stringify(metadata?.title || name)}`,
          `developer_instructions = ${JSON.stringify(instructions)}`,
          ''
        ].join('\n');

        try {
          await writeFile(join(targetDir, `${name}.toml`), content, { flag: 'wx' });
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
      }
    }
  }

  codexAgentName(id) {
    const prefix = `${this.product}-`;
    return id.startsWith(prefix) ? id : `${prefix}${id}`;
  }

  /**
   * Check if GD-KS is already installed
   */
  async isInstalled() {
    return this.fileManager.exists(this.installDir);
  }

  /**
   * Get installed version from manifest
   */
  async getInstalledVersion() {
    const manifestPath = join(this.installDir, '_config', 'manifest.yaml');
    if (await this.fileManager.exists(manifestPath)) {
      const manifest = await this.fileManager.readYaml(manifestPath);
      return this.product === 'gems' ? manifest.gems_version : manifest.version;
    }
    return null;
  }
}
