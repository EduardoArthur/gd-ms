/**
 * GD-KS Manifest Generator
 * Generates installation manifest for tracking
 */

export class ManifestGenerator {
  /**
   * Generate installation manifest
   */
  generate(options = {}) {
    const product = options.product || 'gdks';
    const gems = product === 'gems';
    const installedModules = options.modules || ['core'];
    const manifest = {
      [`${product}_version`]: options.version || '0.1.0-alpha.1',
      installed_at: options.installedAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      
      installation: {
        method: 'npx',
        node_version: process.version,
        platform: process.platform,
        arch: process.arch
      },
      
      modules: {
        installed: installedModules,
        available: gems ? installedModules : ['core', 'ideation', 'design', 'planning', 'engine']
      },
      
      project: {
        name: options.config?.projectName || 'My Game Project',
        language: options.config?.language || 'en',
        output_folder: options.config?.outputFolder || `_${product}-output`
      },
      
      agents: {
        compiled: true,
        format: 'markdown'
      }
    };

    if (gems) {
      manifest.project.target_engine = options.config?.targetEngine;
      manifest.project.ide = options.config?.ide || 'codex';
    } else {
      manifest.tracking = {
        workflow_status_file: '_gdks-output/gdks-workflow-status.yaml',
        sprint_status_file: '_gdks-output/03-planning/sprint-status.yaml'
      };
    }

    return manifest;
  }

  /**
   * Update manifest with new information
   */
  update(existingManifest, updates = {}) {
    return {
      ...existingManifest,
      ...updates,
      updated_at: new Date().toISOString()
    };
  }
}
