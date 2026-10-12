# Project Instructions

## User-owned visual verification

The user performs visual and browser testing. All agents, including delegated agents, must not use Computer Use/CUA, browser-control tools, Playwright, Selenium, Puppeteer, headless browsers or equivalent UI automation for inspection, navigation, screenshots or testing. Do not open browser tabs automatically or duplicate the user's visual review. Do not bypass this restriction through a shell, another tool, worker or renderer. Verify code with appropriate static, unit, domain, server and HTTP/API checks, and handle user findings through the project's testing inbox or chat. State unverified UI behavior honestly. This applies unless the user explicitly changes this instruction.

## Project Entry

Read `.vibemachina/STATE.md`, then the referenced canonical project documents before continuing. The original user brief is `.vibemachina/BRIEF.md`; requirement traceability is in `.vibemachina/REQUIREMENTS.md`.

Use the explicitly requested VibeMachina skill at `C:/Users/user/.codex/skills/vibemachina/SKILL.md`. Read the phase and role references it calls for. MAIN owns project memory, Git and integration. Implementation workers must read the references assigned for their domain, including shared design guidance for UI work.

Every assigned agent must read the complete original BRIEF and all verbatim subsequent user remarks, plus relevant original TESTING entries and references. A short dispatch summary is supplementary, never a replacement. This is especially important for product, UI/UX and video work. Read in chunks when output is truncated. Deliver new user remarks to active workers in full, preserving context and depth.

Commit frequently at coherent, verified checkpoints, including intermediate checkpoints within substantial tasks. MAIN alone stages, commits and pushes after writers hand over their paths. Do not wait for an entire stage, create empty commits or include another writer's unfinished changes. The user now permits VibeMachina planning documents in Git, except `.vibemachina/runtime/`, `.vibemachina/BRIEF.md` and `.vibemachina/TESTING.md`. Keep these private paths and secret env files out of Git; never force-add them. This supersedes the earlier instruction to ignore all VibeMachina files.

Use the skill's built-in `C:/Users/user/.codex/skills/vibemachina/scripts/checkpoint.mjs` for commits and pushes, with real configured checks, explicit scoped `--paths` and `--push` to the verified upstream. Do not replace it with manual add/commit/push or a newly invented Git wrapper. Product check and launch scripts must still work without the skill; private checkpoint configuration remains ignored.

The user requested concept approval first, followed by the full technical and human-readable plan, followed by explicit plan approval. No product implementation or scaffold before those approvals. This restriction does not prevent read-only feasibility work, planning documents or an identity proposal.
