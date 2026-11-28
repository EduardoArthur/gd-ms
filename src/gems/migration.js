import { randomUUID } from 'node:crypto';
import { MigrationArtifacts } from './migration-artifacts.js';
import { MigrationContracts, changedPaths, passedAttempts } from './migration-contracts.js';
import { MigrationState } from './migration-state.js';

export class Migration {
  static async load(projectRoot = process.cwd()) {
    const artifacts = await MigrationArtifacts.load(projectRoot);
    return new Migration(artifacts);
  }

  constructor(artifacts) {
    this.artifacts = artifacts;
    this.state = new MigrationState(artifacts.projectRoot);
    this.contracts = new MigrationContracts(artifacts);
  }

  async status() {
    const { state, sequence } = await this.state.current();
    return { ...state, sequence, contract: await this.contracts.check(state) };
  }

  async history(phase) {
    const events = await this.state.history();
    return phase ? events.filter(event => event.phase === phase) : events;
  }

  async validate() {
    return this.contracts.check((await this.state.current()).state);
  }

  async advance(actor, expectedPhase) {
    const current = await this.state.current();
    if (expectedPhase && current.state.phase !== expectedPhase) {
      throw new Error(`Expected the ${expectedPhase} phase, but the current phase is ${current.state.phase}. Run gems status.`);
    }
    const report = await this.contracts.check(current.state);
    if (!report.next && report.passed) return report;
    if (!report.passed) {
      await this.state.commit(current, current.state, { type: 'advance-blocked', actor, blockers: report.blockers });
      return report;
    }
    const state = { ...current.state, ...report.details, phase: report.next };
    await this.state.commit(current, state, { type: 'phase-advanced', actor, next: report.next, ...report.details });
    return report;
  }

  async approve(revision, actor) {
    const current = await this.state.current();
    if (current.state.phase !== 'planning') throw new Error('Plan approval is only available in the planning phase.');
    const plan = await this.contracts.plan(current.state, false);
    if (revision !== plan.data.revision) throw new Error(`The current plan revision is ${plan.data.revision}.`);
    const approval = { revision, digest: plan.digest, actor };
    await this.state.commit(current, { ...current.state, approval }, { type: 'plan-approved', actor, approval });
    return approval;
  }

  async replan(reason, actor) {
    const current = await this.state.current();
    const { state } = current;
    if (state.phase === 'diagnosis') throw new Error('Diagnosis is already the current phase.');
    if (state.attempts.some(attempt => attempt.status === 'started')) {
      throw new Error('Resolve the open attempt before replanning. Run gems resume.');
    }
    let diagnosis;
    try {
      diagnosis = await this.contracts.diagnosis(state);
    } catch {
      // Changed or missing inputs require a new diagnosis before a new plan can be approved.
    }
    const next = diagnosis ? 'planning' : 'diagnosis';
    await this.state.commit(current, { phase: next, attempts: [], approval: null, diagnosis }, {
      type: 'replanned', actor, reason, next
    });
    return { phase: next };
  }

  async start(unitId, actor) {
    const current = await this.state.current();
    const { state } = current;
    if (state.phase !== 'implementation') throw new Error('Advance to implementation before starting an attempt.');
    if (state.attempts.some(attempt => attempt.status === 'started')) throw new Error('An attempt is open. Run gems resume.');
    const plan = await this.contracts.plan(state);
    const unit = plan.data.units.find(item => item.id === unitId);
    if (!unit) throw new Error(`Unknown plan unit: ${unitId}.`);
    const passed = passedAttempts(plan.data.units, state.attempts);
    const pending = unit.depends_on.filter(id => !passed.get(id));
    if (pending.length) throw new Error(`Unit ${unitId} is waiting for: ${pending.join(', ')}.`);
    const attempt = {
      id: randomUUID(), status: 'started', unit_id: unitId, actor,
      plan_revision: plan.data.revision, plan_digest: plan.digest,
      dependencies: Object.fromEntries(unit.depends_on.map(id => [id, passed.get(id).id])),
      before: await this.artifacts.fingerprints(unit.paths)
    };
    await this.state.commit(current, { ...state, attempts: [...state.attempts, attempt] }, {
      type: 'attempt-started', actor, attempt
    });
    return attempt;
  }

  openAttempt(state, id) {
    const attempt = state.attempts.find(item => item.id === id && item.status === 'started');
    if (!attempt) throw new Error(`No open attempt with ID ${id}. Run gems resume.`);
    return attempt;
  }

  async finish(id, actor) {
    const current = await this.state.current();
    const { state } = current;
    const attempt = this.openAttempt(state, id);
    const plan = await this.contracts.plan(state);
    if (plan.digest !== attempt.plan_digest) throw new Error('Attempt was started under a different plan. Run gems resume.');
    const report = await this.artifacts.read('implementation', `attempts/${id}.json`);
    const { data } = report;
    if (data.attempt_id !== id || data.plan_revision !== attempt.plan_revision || data.unit_id !== attempt.unit_id) {
      throw new Error('The implementation report does not match the open attempt, plan revision, and unit.');
    }
    const unit = plan.data.units.find(item => item.id === attempt.unit_id);
    const plannedChecks = new Set(unit.technical_checks.map(check => check.id));
    const results = new Map(data.technical_checks.map(check => [check.id, check]));
    if (results.size !== data.technical_checks.length || [...results.keys()].some(id => !plannedChecks.has(id))) {
      throw new Error('The implementation report contains duplicate or unplanned technical checks.');
    }
    if (data.outcome === 'passed') {
      if (!data.candidate_revision) throw new Error('A passed attempt requires a candidate revision.');
      const pending = [...plannedChecks].filter(id => results.get(id)?.outcome !== 'passed');
      if (pending.length) throw new Error(`The planned technical checks must pass: ${pending.join(', ')}.`);
    }
    const evidence = await this.artifacts.evidence(data.technical_checks.flatMap(check => check.evidence ?? []));
    const finished = {
      ...attempt, status: data.outcome, candidate_revision: data.candidate_revision,
      files: await this.artifacts.fingerprints(Object.keys(attempt.before)),
      result: { path: report.name, digest: report.digest }, evidence
    };
    await this.state.commit(current, { ...state, attempts: state.attempts.map(item => item.id === id ? finished : item) }, {
      type: 'attempt-finished', actor, attempt: finished
    });
    return finished;
  }

  async resume() {
    const { state } = await this.state.current();
    const attempt = state.attempts.find(item => item.status === 'started');
    let changed = [];
    let fileReviewError;
    if (attempt) {
      try {
        changed = changedPaths(attempt.before, await this.artifacts.fingerprints(Object.keys(attempt.before)));
      } catch (error) {
        fileReviewError = error.message;
      }
    }
    return {
      phase: state.phase,
      approval: state.approval,
      attempt: attempt ?? null,
      changed_paths: changed,
      file_review_error: fileReviewError,
      contract: await this.contracts.check(state)
    };
  }

  async abandon(id, reason, reconciled, actor) {
    const current = await this.state.current();
    const { state } = current;
    const attempt = this.openAttempt(state, id);
    const files = await this.artifacts.fingerprints(Object.keys(attempt.before));
    const changed = changedPaths(attempt.before, files);
    if (changed.length && !reconciled) {
      throw new Error(`Review partial files before abandoning: ${changed.join(', ')}. Confirm with --reconciled.`);
    }
    const abandoned = { ...attempt, status: 'abandoned', files, reason };
    await this.state.commit(current, { ...state, attempts: state.attempts.map(item => item.id === id ? abandoned : item) }, {
      type: 'attempt-abandoned', actor, attempt: abandoned, changed_paths: changed
    });
    return abandoned;
  }
}
