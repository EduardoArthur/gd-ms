import { randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const eventName = sequence => `${String(sequence).padStart(12, '0')}.json`;

export class MigrationState {
  constructor(projectRoot) {
    this.directory = join(projectRoot, '_gems', '_state', 'history');
  }

  async files() {
    try {
      const files = await readdir(this.directory);
      return files.filter(file => /^\d{12}\.json$/.test(file)).sort();
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async read(file) {
    const entry = JSON.parse(await readFile(join(this.directory, file), 'utf8'));
    if (entry.schema_version !== 1 || !entry.state || eventName(entry.sequence) !== file) {
      throw new Error(`Invalid migration history entry ${file}.`);
    }
    return entry;
  }

  async current() {
    const latest = (await this.files()).at(-1);
    if (!latest) throw new Error('Migration state is missing. Run gems install in the destination project.');
    return this.read(latest);
  }

  async history() {
    const entries = await Promise.all((await this.files()).map(file => this.read(file)));
    return entries.map(({ state: _state, ...event }) => event);
  }

  async initialize() {
    if ((await this.files()).length) return;
    try {
      await this.commit(null, { phase: 'diagnosis', attempts: [], approval: null }, {
        type: 'initialized', actor: 'installer'
      });
    } catch (error) {
      if (error.cause?.code !== 'EEXIST') throw error;
    }
  }

  async commit(current, state, details) {
    const sequence = (current?.sequence ?? 0) + 1;
    const event = {
      schema_version: 1,
      sequence,
      timestamp: new Date().toISOString(),
      phase: current?.state.phase ?? state.phase,
      ...details,
      state
    };
    const staged = join(this.directory, `.${randomUUID()}.tmp`);
    await mkdir(this.directory, { recursive: true });
    const file = await open(staged, 'wx');
    try {
      try {
        await file.writeFile(`${JSON.stringify(event, null, 2)}\n`, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      // Publish without replacing another process's event for this sequence.
      await link(staged, join(this.directory, eventName(sequence)));
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw new Error('Migration state changed. Run gems status before retrying.', { cause: error });
      }
      throw error;
    } finally {
      await unlink(staged).catch(() => {});
    }
    return event;
  }
}
