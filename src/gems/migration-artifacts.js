import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { FileManager } from '../../tools/installer/lib/file-manager.js';
import { getValidator } from '../../tools/validator/validator.js';

const inside = (root, path) => {
  const difference = relative(root, path);
  return difference !== '..' && !difference.startsWith(`..${sep}`) && !isAbsolute(difference);
};

async function fileDigest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export class MigrationArtifacts {
  constructor(projectRoot, outputRoot, config) {
    this.projectRoot = projectRoot;
    this.outputRoot = outputRoot;
    this.config = config;
  }

  static async load(projectRoot) {
    const files = new FileManager();
    const configPath = join(projectRoot, '_gems', '_config', 'project-config.yaml');
    if (!(await files.exists(configPath))) throw new Error('Run gems install in the destination project first.');
    const config = await files.readYaml(configPath);
    const root = await realpath(projectRoot);
    const outputRoot = await realpath(resolve(root, config.settings.output_folder));
    if (root === outputRoot || !inside(root, outputRoot)) {
      throw new Error('The configured output folder must resolve inside the destination project.');
    }
    return new MigrationArtifacts(root, outputRoot, config);
  }

  async outputFile(name) {
    if (isAbsolute(name)) throw new Error(`Use a path relative to the output folder: ${name}.`);
    const path = resolve(this.outputRoot, name);
    if (!inside(this.outputRoot, path)) throw new Error(`Path leaves the output folder: ${name}.`);
    let actual;
    try {
      actual = await realpath(path);
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`Missing output artifact: ${name}.`);
      throw error;
    }
    if (!inside(this.outputRoot, actual) || !(await stat(actual)).isFile()) {
      throw new Error(`Expected a file inside the output folder: ${name}.`);
    }
    return actual;
  }

  async read(kind, name = `migration-${kind}.json`) {
    const content = await readFile(await this.outputFile(name));
    let data;
    try {
      data = JSON.parse(content.toString('utf8'));
    } catch {
      throw new Error(`Invalid JSON in ${name}.`);
    }
    if (data?.kind !== kind) throw new Error(`${name} must have kind "${kind}".`);
    const { valid, errors } = (await getValidator()).validate('migration-artifact', data);
    if (!valid) throw new Error(`Invalid ${name}: ${errors.join('; ')}.`);
    return { name, data, digest: createHash('sha256').update(content).digest('hex') };
  }

  async verifySource(setup) {
    if (setup.target_engine !== this.config.target_engine) {
      throw new Error('Setup target engine must match the installed destination engine.');
    }
    let source;
    try {
      source = await realpath(resolve(this.projectRoot, setup.source_path));
      if (!(await stat(source)).isDirectory()) throw new Error();
    } catch {
      throw new Error('The source path must be a readable project directory.');
    }
    if (inside(this.projectRoot, source) || inside(source, this.projectRoot)) {
      throw new Error('Source and destination project directories must not overlap.');
    }
  }

  destinationPath(name) {
    const path = resolve(this.projectRoot, name);
    const first = relative(this.projectRoot, path).split(sep)[0].toLowerCase();
    if (isAbsolute(name) || !first || !inside(this.projectRoot, path) || inside(this.outputRoot, path) ||
        ['_gems', '.git'].includes(first)) {
      throw new Error(`Use a destination project file outside GEMS metadata and output: ${name}.`);
    }
    return path;
  }

  async fingerprints(names) {
    const entries = [];
    for (const name of names) {
      const path = this.destinationPath(name);
      let parent = path;
      let actual;
      for (;;) {
        try {
          actual = await realpath(parent);
          break;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          parent = dirname(parent);
        }
      }
      const resolved = resolve(actual, relative(parent, path));
      this.destinationPath(relative(this.projectRoot, resolved));
      if (parent !== path) {
        if (!(await stat(actual)).isDirectory()) throw new Error(`Destination file has a non-directory parent: ${name}.`);
        entries.push([name, null]);
      } else {
        if (!(await stat(actual)).isFile()) throw new Error(`Expected a destination file: ${name}.`);
        entries.push([name, await fileDigest(actual)]);
      }
    }
    return Object.fromEntries(entries);
  }

  async evidence(names, report) {
    const evidence = [];
    const reportPath = report && await this.outputFile(report);
    for (const name of names) {
      const path = await this.outputFile(name);
      if (path === reportPath) throw new Error('Provide evidence separately from the verification report.');
      if (!(await stat(path)).size) throw new Error(`Evidence file is empty: ${name}.`);
      evidence.push({ path: name, digest: await fileDigest(path) });
    }
    return evidence;
  }
}
