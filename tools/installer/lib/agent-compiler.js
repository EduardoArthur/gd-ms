/**
 * GD-KS Agent Compiler
 * Compiles agent YAML definitions to Markdown format for IDE consumption
 */

import { join } from 'path';
import { FileManager } from './file-manager.js';

export class AgentCompiler {
  constructor() {
    this.fileManager = new FileManager();
  }

  /**
   * Compile all agents in a directory
   */
  async compileAll(agentsDir, config = {}) {
    if (!await this.fileManager.exists(agentsDir)) {
      return [];
    }

    const yamlFiles = await this.fileManager.listFiles(agentsDir, '.agent.yaml');
    const compiled = [];

    for (const file of yamlFiles) {
      const sourcePath = join(agentsDir, file);
      const targetPath = join(agentsDir, file.replace('.agent.yaml', '.md'));
      
      await this.compile(sourcePath, targetPath, config);
      compiled.push(targetPath);
    }

    return compiled;
  }

  /**
   * Compile a single agent YAML to Markdown
   */
  async compile(sourcePath, targetPath, config = {}) {
    const agentYaml = await this.fileManager.readYaml(sourcePath);
    const markdown = this.generateMarkdown(agentYaml, config);
    await this.fileManager.writeFile(targetPath, markdown);
  }

  /**
   * Generate Markdown from agent YAML
   */
  generateMarkdown(agent, _config = {}) {
    const meta = agent.metadata || {};
    const persona = agent.persona || {};
    const menu = agent.menu || [];
    const criticalActions = agent.critical_actions || [];
    const memories = agent.memories || [];
    const gems = meta.id?.startsWith('_gems/');

    let md = '';

    // Header with XML-like structure for IDE parsing
    md += `# ${meta.name || 'Agent'}\n\n`;
    md += `> ${meta.title || 'AI Agent'} ${meta.icon || '🤖'}\n\n`;

    // Project State Context placeholder (v0.4 Sprint 3).
    // IDEs / tooling can swap this placeholder for the live state
    // returned by `gd-ks state context`. Agents are instructed to treat
    // it as the source of truth for project progress when present.
    if (gems) {
      md += '> Read `_gems/_config/project-config.yaml` for the installed destination.\n\n';
    } else {
      md += '<!-- GDKS_STATE_CONTEXT_PLACEHOLDER -->\n';
      md += '> ℹ️  Current project state will be injected here by `gd-ks state context` or the IDE hook.\n\n';
    }

    // Agent Identity Block
    md += '<agent_identity>\n';
    md += `name: ${meta.name || 'Agent'}\n`;
    md += `title: ${meta.title || 'AI Agent'}\n`;
    md += `module: ${meta.module || 'core'}\n`;
    md += '</agent_identity>\n\n';

    // Persona Section
    md += '## Persona\n\n';
    md += '<persona>\n';
    md += `<role>${persona.role || 'AI Assistant'}</role>\n`;
    md += `<identity>\n${persona.identity || 'A helpful AI assistant.'}\n</identity>\n`;
    md += `<communication_style>\n${persona.communication_style || 'Professional and helpful.'}\n</communication_style>\n`;
    
    if (persona.principles && persona.principles.length > 0) {
      md += '<principles>\n';
      for (const principle of persona.principles) {
        md += `- ${principle}\n`;
      }
      md += '</principles>\n';
    }
    md += '</persona>\n\n';

    // Critical Actions
    if (criticalActions.length > 0) {
      md += '## Critical Actions\n\n';
      md += '<critical_actions>\n';
      md += 'Execute these actions before responding:\n\n';
      for (const action of criticalActions) {
        md += `- ${action}\n`;
      }
      md += '</critical_actions>\n\n';
    }

    // Memories
    if (memories.length > 0) {
      md += '## Memories\n\n';
      md += '<memories>\n';
      md += 'Context to remember:\n\n';
      for (const memory of memories) {
        md += `- ${memory}\n`;
      }
      md += '</memories>\n\n';
    }

    // Menu Section
    md += '## Commands\n\n';
    md += '<menu>\n';
    md += 'Available commands (type the trigger to execute):\n\n';
    md += '| Command | Description |\n';
    md += '|---------|-------------|\n';
    
    for (const item of menu) {
      const trigger = `*${item.trigger}`;
      md += `| \`${trigger}\` | ${item.description || 'No description'} |\n`;
    }
    
    // Add default commands
    md += '| `*help` | Show this menu |\n';
    md += '| `*chat` | Free conversation mode |\n';
    md += '</menu>\n\n';

    // Workflow References
    md += '## Workflow References\n\n';
    md += '<workflows>\n';
    for (const item of menu) {
      if (item.workflow) {
        md += `- \`*${item.trigger}\` → \`${item.workflow}\`\n`;
      }
    }
    md += '</workflows>\n\n';

    const specialistRoutes = menu.filter(item => item.delegate_to);
    if (specialistRoutes.length > 0) {
      md += '## Specialist Routes\n\n';
      for (const { trigger, delegate_to: specialist } of specialistRoutes) {
        md += `- \`*${trigger}\` → \`${specialist}\`\n`;
      }
      md += '\n';
    }

    const inlineActions = menu.filter(item => item.action?.startsWith('#') && agent.actions?.[item.action.slice(1)]);
    if (inlineActions.length > 0) {
      md += '## Command Instructions\n\n';
      for (const { trigger, action } of inlineActions) {
        md += `### \`*${trigger}\`\n\n${agent.actions[action.slice(1)].trim()}\n\n`;
      }
    }

    if (gems) {
      md += '## Asking for User Input\n\n';
      md += '- When you need a decision or confirmation from the user and there are clear options, prefer the selectable question tool exposed by the session. In Codex use `request_user_input` or `request_user_input_async` when available. In Claude Code use `AskUserQuestion` when available.\n';
      md += '- Offer two or three distinct options with short labels and explain their consequences when needed. Use a numbered list in chat when the tool is unavailable. Ask for free text when the answer is open-ended, such as a project path or exact version.\n';
      md += '- If the next step depends on the choice, wait for the actual reply. Approval requires an explicit answer. A suggested or preselected option and a dismissed or unanswered question leave approval pending.\n';
      md += '- If you are a delegated specialist, send the question and available options to the Orchestrator so it can ask in the main session.\n\n';
    }

    // Instructions for IDE
    md += '---\n\n';
    md += '## How to Use\n\n';
    md += '1. Load this agent in your IDE\n';
    md += '2. Type a command from the menu above (e.g., `*help`)\n';
    md += '3. Follow the command or workflow instructions\n';
    md += '4. Use `*chat` for free conversation\n\n';

    // Footer
    md += '---\n';
    md += `*Generated by ${gems ? 'GEMS' : 'GD-KS'} Agent Compiler*\n`;

    return md;
  }

  /**
   * Validate agent YAML structure
   */
  validate(agent) {
    const errors = [];

    if (!agent.metadata) {
      errors.push('Missing metadata section');
    } else {
      if (!agent.metadata.name) errors.push('Missing metadata.name');
      if (!agent.metadata.title) errors.push('Missing metadata.title');
    }

    if (!agent.persona) {
      errors.push('Missing persona section');
    } else {
      if (!agent.persona.role) errors.push('Missing persona.role');
    }

    if (!agent.menu || agent.menu.length === 0) {
      errors.push('Menu must have at least one item');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
