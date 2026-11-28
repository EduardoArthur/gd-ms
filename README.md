# GEMS (Game Engine Migration System)

GEMS installs migration agents and workflows in an existing destination game project. The Orchestrator coordinates diagnosis, planning, implementation, and verification. The CLI records decisions and attempts and checks the conditions for advancing each phase.

## Install in a destination project

You need Node.js 20 or newer, npm, a project created in the destination engine, and access to the source project. GEMS includes profiles for Godot 4, Unity 6, and Unreal Engine 5. The diagnosis evaluates coverage for the selected versions, platform, resources, and behaviors.

1. Obtain the GEMS npm archive or run `npm install` and `npm pack` from the GEMS repository to build it.
2. Open a terminal at the **destination project root** and run the installer with the absolute path to that archive.

   ~~~shell
   npm exec --package="<absolute path to gems-0.4.1-beta.2.tgz>" -- gems install
   ~~~

3. Open the same destination directory in a new Codex session and type `*init`.

Use `--engine godot-4`, `--engine unity-6`, or `--engine unreal-5` to select an engine explicitly. `--yes` uses the saved or detected engine and defaults to Codex on a new installation. With `--ide none`, load `_gems/core/agents/gems-orchestrator.md` manually in your assistant, including in Claude Code. The agents prefer selectable choices when the session offers them and use numbered choices in chat otherwise.

To update an installed project, run the installer again with the new archive. Reinstallation updates the distributed workflows and installed assets, preserves migration history and output artifacts, and keeps project instructions outside the managed GEMS block in `AGENTS.md`.

## Run a migration with the agents

| Command | Role | What happens |
| --- | --- | --- |
| `*init` | Orchestrator | Confirm the source path, engine versions, and target platform. |
| `*diagnose` | Source Analyst | Record the source revision, inventory, scenarios, and gaps in route coverage. |
| `*plan` | Migration Planner | Propose a versioned strategy, units, technical checks, and equivalence criteria. |
| `*approve` | Orchestrator | Record the developer's explicit approval of the current plan revision. |
| `*implement` | Engine Specialist | Register an attempt before editing. Apply the approved scope, run the planned checks, and record the candidate. |
| `*verify` | Equivalence Verifier | Evaluate the current candidate against the agreed criteria and record evidence. |
| `*status` and `*resume` | Orchestrator | Read the recorded phase, blockers, and any open attempt. |

The agents read the workflow instructions from `_gems/migration/workflows/` and use templates from `_gems/migration/templates/`. The source project is a read-only reference. Operations that would write to the source use a separate working copy. An upgrade from an older Markdown setup starts with `*init` to confirm its details for the structured record.

## Inspect and recover from the terminal

| Command | Purpose |
| --- | --- |
| `gems status` | Show the current phase, approval, attempts, and contract blockers. |
| `gems history [--phase <phase>]` | Read recorded events, optionally by phase. |
| `gems validate` | Check the current contract. Exit status 1 means the transition has blockers. |
| `gems advance --actor <name> [--phase <phase>]` | Apply the current contract and record the result. |
| `gems approve --revision <id> --actor <developer>` | Record approval for the exact plan content. An edit to the plan requires approval of the revised content. |
| `gems attempt start --unit <id> --actor <name>` | Open an attempt and record the planned files before editing. |
| `gems attempt finish <id> --actor <name>` | Register the outcome from `attempts/<id>.json` in the output folder. |
| `gems resume` | Find any open attempt and inspect changes to its planned files. |
| `gems attempt abandon <id> --reason <text> --actor <name>` | Close an incomplete attempt and preserve the files. If partial files changed, review them and then pass `--reconciled`. |
| `gems replan --reason <text> --actor <name>` | Return to planning, or diagnosis if its inputs changed. |

Run commands from the destination root. If `gems` is off PATH after installation through `npm exec`, use `node "<runtime.entry>" <command>` with the entry in `_gems/_config/project-config.yaml`. If that package location moved, rerun the installer with the archive to refresh it.

The delivery contract checks the plan and candidate identities, planned technical checks, and evidence files. Every agreed criterion gets a result. Mandatory criteria must pass, and each passing result must reference evidence in the output folder. The verifier evaluates what the gameplay observations show.

## Installed files

| Path | Contents |
| --- | --- |
| `_gems/_config/project-config.yaml` | Destination configuration and the CLI entry path. |
| `_gems/_config/manifest.yaml` | Installed GEMS version, modules, and distributed artifact paths. |
| `_gems/core/` and `_gems/migration/` | Agent definitions, compiled menus, workflows, templates, and engine profiles. |
| `_gems/_state/history/` | Recorded phase, approval, attempts, and history. |
| `_gems-output/` | Migration records, attempt reports, and evidence. |
| `AGENTS.md` and `.codex/agents/` | Managed instructions and five agent registrations when Codex integration is enabled. |

See the [packaging guide](docs/NPM-PUBLISH-GUIDE.md) for the release checks and the [changelog](CHANGELOG.md) for release history.
