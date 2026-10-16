# Project Instructions

## User-owned visual verification

The user performs visual and browser testing. All agents, including delegated agents, must not use Computer Use/CUA, browser-control tools, Playwright, Selenium, Puppeteer, headless browsers or equivalent UI automation for inspection, navigation, screenshots or testing. Do not open browser tabs automatically or duplicate the user's visual review. Do not bypass this restriction through a shell, another tool, worker or renderer. Verify code with appropriate static, unit, domain, server and HTTP/API checks, and handle user findings through the project's testing inbox or chat. State unverified UI behavior honestly. This applies unless the user explicitly changes this instruction.

## Project Entry

Keep BRIEF focused on durable user requirements, product decisions and useful source remarks. Do not append routine messages such as "continue", usage-limit restoration or execution coordination. Record transient recovery status in STATE only when it affects the next action.

Read `.vibemachina/STATE.md`, then the referenced canonical project documents before continuing. The original user brief is `.vibemachina/BRIEF.md`; requirement traceability is in `.vibemachina/REQUIREMENTS.md`.

Use the explicitly requested VibeMachina skill at `C:/Users/user/.codex/skills/vibemachina/SKILL.md`. Read the phase and role references it calls for. MAIN owns project memory, Git and integration. Implementation workers must read the references assigned for their domain, including shared design guidance for UI work.

Current user direction (2026-10-16): the new MAIN has prepared the five-stage plan. The user explicitly authorized implementing **stages 01–02**, then stopping before stage 03 until further approval. Exact instruction: «такс продолжай, сделай этапы 1-2 и остановись до утверждения также пусть все агенты по дизайны смотрят рефы читают все файлы скилла по дизайну и не боятся нафиг сносить шаблонные скучные статичные блоки». This supersedes the older unrestricted continuation and the 2026-10-15 handoff stop for the previous team. The new agents assigned in STATE must execute their authorized tasks; they are not the previous workers and must not stop because of that completed handoff.

MAIN coordinates, maintains canonical memory and performs Git checkpoints; substantial source review and code integration are delegated. Assign fresh independent areas to new agents and reuse an agent for directly related continuation. Give feature agents complete user journeys with owned pages/routes/states/locales/checks. Shared paths have one exclusive integration owner. All UI/design agents must read **all files in VibeMachina references/design/** and study the provided local visual references, plus complete latest user remarks. They may replace boring template composition entirely within owned paths. Current identity remains Tirlik / «Всё для вашего бизнеса».

Newly assigned workers use GPT-5.6 Sol (medium/high/xhigh as appropriate). Historical worker names from before the current MAIN are authorship, not ownership; do not restore them. Current owners and handover state are in STATE. Product value is the useful harness work and new editable materials, not ordinary editing, a calculator, uploaded-file viewing or claims about AI. Stage 03–05 full scope is retained but not authorized to execute in this turn.

Work locally only. Do not spend time searching for hosting or performing cloud deploys/probes; the user will choose a server later. A new shared maximum of USD 10 is authorized for OpenRouter from the 2026-10-14 autonomy instruction, including economical non-top models where needed. Keep exact reservations/cost records, protect secrets, do not blindly retry uncertain charged calls, and preserve previous unresolved reservations. This is not authorization to purchase subscriptions or spend without a bound.

Every assigned agent must read the complete original BRIEF and all verbatim subsequent user remarks, plus relevant original TESTING entries and references. A short dispatch summary is supplementary, never a replacement. This is especially important for product, UI/UX and video work. Read in chunks when output is truncated. Deliver new user remarks to active workers in full, preserving context and depth.

Commit frequently at coherent, verified checkpoints, including intermediate checkpoints within substantial tasks. MAIN alone stages, commits and pushes after writers hand over their paths. Do not wait for an entire stage, create empty commits or include another writer's unfinished changes. The user now permits VibeMachina planning documents in Git, except `.vibemachina/runtime/`, `.vibemachina/BRIEF.md` and `.vibemachina/TESTING.md`. Keep these private paths and secret env files out of Git; never force-add them. This supersedes the earlier instruction to ignore all VibeMachina files.

Use the skill's built-in `C:/Users/user/.codex/skills/vibemachina/scripts/checkpoint.mjs` for commits and pushes, with real configured checks, explicit scoped `--paths` and `--push` to the verified upstream. Do not replace it with manual add/commit/push or a newly invented Git wrapper. Product check and launch scripts must still work without the skill; private checkpoint configuration remains ignored.

The user requested concept approval first, followed by the full technical and human-readable plan, followed by explicit plan approval. No product implementation or scaffold before those approvals. This restriction does not prevent read-only feasibility work, planning documents or an identity proposal.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
