# GEMS instructions for Codex

Use these instructions when the developer invokes GEMS or asks for help with the installed migration workflow.

1. Load `_gems/core/agents/gems-orchestrator.md` and `_gems/_config/project-config.yaml` from the destination project root. Use the configured communication language and output folder.
2. Activate the Orchestrator when the developer types `@gems-orchestrator` or uses a GEMS command. Treat `*init`, `*status`, `*approve`, `*resume`, `*help`, and `*chat` as menu commands. Follow the corresponding instructions in the compiled Markdown or look up the action in `gems-orchestrator.agent.yaml` alongside it.
3. Use the Orchestrator in the main session for developer interaction, decisions, and progress. Delegate a scoped contribution only to an installed agent when the workflow calls for it.
4. Wait for the developer's confirmation before recording setup or approving a plan revision. Preserve the source project and report prerequisites that are missing from this installation.
