export const nextPhase = {
  diagnosis: 'planning',
  planning: 'implementation',
  implementation: 'verification',
  verification: 'complete'
};

export function passedAttempts(units, attempts) {
  const byUnit = new Map(units.map(unit => [unit.id, unit]));
  const latest = new Map(attempts.map(attempt => [attempt.unit_id, attempt]));
  const checked = new Map();
  function current(id) {
    if (checked.has(id)) return checked.get(id);
    const attempt = latest.get(id);
    const passed = attempt?.status === 'passed' && byUnit.get(id).depends_on.every(dependency => {
      const accepted = current(dependency);
      return accepted && accepted.id === attempt.dependencies?.[dependency];
    });
    checked.set(id, passed ? attempt : null);
    return checked.get(id);
  }
  for (const unit of units) current(unit.id);
  return checked;
}

export function changedPaths(before, after) {
  return Object.keys(before).filter(path => before[path] !== after[path]);
}

function indexBy(items, field, label) {
  const index = new Map(items.map(item => [item[field], item]));
  if (index.size !== items.length) throw new Error(`Duplicate ${label} IDs.`);
  return index;
}

function validateUnits(units, artifacts) {
  const indexed = indexBy(units, 'id', 'unit');
  const active = new Set();
  const visited = new Set();
  function visit(id) {
    if (!indexed.has(id)) throw new Error(`Unknown unit dependency: ${id}.`);
    if (active.has(id)) throw new Error(`Cyclic unit dependency: ${id}.`);
    if (visited.has(id)) return;
    active.add(id);
    for (const dependency of indexed.get(id).depends_on) visit(dependency);
    active.delete(id);
    visited.add(id);
  }
  for (const unit of units) {
    visit(unit.id);
    indexBy(unit.technical_checks, 'id', `technical check in unit ${unit.id}`);
    const paths = unit.paths.map(path => artifacts.destinationPath(path));
    if (new Set(paths).size !== paths.length) throw new Error(`Duplicate destination paths in unit ${unit.id}.`);
  }
}

export class MigrationContracts {
  constructor(artifacts) {
    this.artifacts = artifacts;
  }

  async diagnosis(state) {
    const setup = await this.artifacts.read('setup');
    await this.artifacts.verifySource(setup.data);
    const diagnosis = await this.artifacts.read('diagnosis');
    if (diagnosis.data.blockers.length) throw new Error(diagnosis.data.blockers.join('\n'));
    const input = { setup: setup.digest, diagnosis: diagnosis.digest, source_revision: diagnosis.data.source_revision };
    if (state.diagnosis && (input.setup !== state.diagnosis.setup || input.diagnosis !== state.diagnosis.diagnosis)) {
      throw new Error('Setup or diagnosis changed. Run gems replan to review the new inputs.');
    }
    return input;
  }

  async plan(state, approved = true) {
    if (!state.diagnosis) throw new Error('Complete the diagnosis phase first.');
    await this.diagnosis(state);
    const plan = await this.artifacts.read('plan');
    validateUnits(plan.data.units, this.artifacts);
    indexBy(plan.data.criteria, 'id', 'criterion');
    if (!plan.data.criteria.some(criterion => criterion.required)) {
      throw new Error('The plan must include at least one mandatory equivalence criterion.');
    }
    if (approved && (state.approval?.revision !== plan.data.revision || state.approval?.digest !== plan.digest)) {
      throw new Error('The current plan revision and content require approval.');
    }
    return plan;
  }

  async implementation(state) {
    const plan = await this.plan(state);
    if (state.attempts.some(attempt => attempt.status === 'started')) throw new Error('An implementation attempt is still open.');
    const passed = passedAttempts(plan.data.units, state.attempts);
    const pending = plan.data.units.filter(unit => !passed.get(unit.id));
    if (pending.length) throw new Error(`Units without a passed current attempt: ${pending.map(unit => unit.id).join(', ')}.`);
    const accepted = new Set([...passed.values()].map(attempt => attempt.id));
    const attempts = state.attempts.filter(attempt => accepted.has(attempt.id));
    const expected = Object.create(null);
    for (const attempt of attempts) {
      const report = await this.artifacts.read('implementation', attempt.result.path);
      if (report.digest !== attempt.result.digest || attempt.plan_digest !== plan.digest) {
        throw new Error(`Attempt ${attempt.id} is stale. Review the implementation before proceeding.`);
      }
      for (const stored of attempt.evidence ?? []) {
        const [current] = await this.artifacts.evidence([stored.path]);
        if (current.digest !== stored.digest) throw new Error(`Technical evidence changed: ${stored.path}.`);
      }
      Object.assign(expected, attempt.files);
    }
    const changed = changedPaths(expected, await this.artifacts.fingerprints(Object.keys(expected)));
    if (changed.length) throw new Error(`Candidate files changed after implementation: ${changed.join(', ')}.`);
    const last = attempts.at(-1);
    return { plan, candidate: { attempt_id: last.id, revision: last.candidate_revision } };
  }

  async verification(state) {
    const { plan, candidate } = await this.implementation(state);
    const report = await this.artifacts.read('verification');
    const data = report.data;
    if (data.plan_revision !== plan.data.revision || data.attempt_id !== candidate.attempt_id ||
        data.candidate_revision !== candidate.revision) {
      throw new Error('Verification does not match the approved plan and current candidate attempt.');
    }
    const criteria = indexBy(plan.data.criteria, 'id', 'criterion');
    const results = indexBy(data.results, 'criterion_id', 'criterion result');
    const blockers = [];
    const evidence = [];
    for (const id of results.keys()) {
      if (!criteria.has(id)) blockers.push(`Unknown criterion result: ${id}.`);
    }
    for (const [id, criterion] of criteria) {
      const result = results.get(id);
      if (!result) {
        blockers.push(`Missing result for criterion ${id}.`);
        continue;
      }
      if (criterion.required && result.outcome !== 'passed') {
        blockers.push(`Mandatory criterion ${id}: ${result.outcome}.`);
      }
      if (result.outcome === 'passed' && !result.evidence.length) {
        blockers.push(`Missing evidence for passed criterion ${id}.`);
      }
      try {
        const files = await this.artifacts.evidence(result.evidence, report.name);
        evidence.push({ criterion_id: id, files });
      } catch (error) {
        blockers.push(`Criterion ${id}: ${error.message}`);
      }
    }
    if (blockers.length) throw new Error(blockers.join('\n'));
    return { verification: { path: report.name, digest: report.digest }, candidate, evidence };
  }

  async check(state) {
    const { phase } = state;
    try {
      if (phase === 'complete') {
        const current = await this.verification(state);
        if (current.verification.digest !== state.verification.digest ||
            JSON.stringify(current.evidence) !== JSON.stringify(state.evidence)) {
          throw new Error('The recorded delivery report or evidence changed after completion.');
        }
        return { phase, passed: true, blockers: [] };
      }

      let details;
      if (phase === 'diagnosis') details = { diagnosis: await this.diagnosis(state) };
      if (phase === 'planning') await this.plan(state);
      if (phase === 'implementation') details = { candidate: (await this.implementation(state)).candidate };
      if (phase === 'verification') details = await this.verification(state);
      if (!nextPhase[phase]) throw new Error(`Unknown migration phase: ${phase}.`);
      return { phase, next: nextPhase[phase], passed: true, blockers: [], details };
    } catch (error) {
      return { phase, next: nextPhase[phase], passed: false, blockers: error.message.split('\n') };
    }
  }
}
