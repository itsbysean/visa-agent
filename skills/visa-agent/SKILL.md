---
name: visa-agent
description: Manage visa preparation cases for study, work, visits, family, residence, transit and other immigration purposes. Interview applicants, research current official requirements, maintain JSON and Markdown records, and generate a local HTML dashboard. Use when asked for visa preparation, application checklists, deadlines, or updates to an existing case. Includes school and departure preparation for study cases.
---

# Visa case agent

Use this skill for individuals or agency staff. Support multiple nationalities and destination countries; New Zealand study is the initial worked example, not a country or visa-type restriction. Answer in the user's language unless they specify an output language.

## 1. Locate or create the case

- Resolve paths against the user's project, not this skill directory. Default output root: `students/` (retained for compatibility with the original workflow). Accept any user-specified root, such as `visas/`.
- For an existing case, read `student.json` and `plan.json` first. Despite its legacy filename, `student.json` stores any applicant and visa case. Never infer identity from a similar name: use the supplied case ID/path or clarify ambiguity.
- A person may have multiple cases. Use an opaque case ID such as `case-001`, not passport numbers, birth dates, or other sensitive identifiers. Do not collect passport scans, bank details, or exact birth dates merely to make a checklist.
- For a new case, establish destination, citizenship(s), current country and immigration status, purpose, age or age band, intended dates, relevant accompanying applicants, current progress, preferred language, and output root. Ask only missing, material questions in small batches.
- Adapt further questions to purpose: study → school, course, level, start date, offer status; work → employer, role, offer/sponsorship; visit → reason, duration, host; family → relationship and sponsor status; residence → intended route; transit → itinerary and airside/entry needs. Ask about prior refusals or complications only if needed for the route, without requiring sensitive documents.
- If the route is unclear, research official options and ask the user to select the applicable route before presenting route-specific requirements as settled. Do not silently select a visa based only on destination and nationality.

## 2. Research current official requirements

Read `references/research.md`, `references/data-contract.md`, and the relevant country reference. Use available web/search tools to visit the destination immigration authority and relevant official school, employer/sponsor regulator, or consular sources. Never treat this skill's static references as current eligibility advice.

Record the precise official URL, title, date actually checked (YYYY-MM-DD), and what it supports. Check citizenship/current location, purpose, age, duration, dependants, chosen route, current status and any applicable application location restrictions. Verify application channels, evidence, fees, timing and travel prerequisites where relevant; do not invent them.

If browsing is unavailable or an official page cannot be read, mark affected work as `needs_review`, add an open question, and explain the research limitation in the result. An unvisited URL must have `checked_on: null`; do not substitute model memory for verification. Officially published processing estimates are not guaranteed deadlines. Distinguish official requirements from recommended planning tasks and unresolved conditions. If official sources conflict, retain both sources and ask for clarification/authority confirmation rather than choosing silently.

## 3. Build and save the plan

Use `references/data-contract.md` for the minimal JSON contract. Write draft input JSON outside the output case folder. Use stable, semantic task IDs and dependency links. Task titles, explanations, questions, phase names and notes must use the selected output language. Use only relevant phases: study can include admissions, visa and departure; other cases may include eligibility, sponsor, evidence, application and travel. A task is not complete merely because its source was checked.

- Assign a date only when known. Use `due_kind: official` for an explicitly published deadline; use `recommended` for a reasoned planning date and explain the assumption. Otherwise leave `due_on: null`.
- Put unresolved facts in `open_questions`, not in assumed eligibility. Unverified required tasks must be `needs_review`.
- Use `kind: official_requirement`, `recommendation`, or `to_verify` to separate evidence-backed requirements from advice and uncertainty.
- No submissions, payments, bookings, or agency/authority messages are performed by this skill. It prepares and tracks work. Do not promise visa approval.

Commands (replace `<skill>` with this package's absolute directory; use absolute output paths):

```sh
python <skill>/scripts/visa_case.py create --root /project/students --case-id case-001 --applicant /tmp/applicant.json --plan /tmp/plan.json
python <skill>/scripts/visa_case.py render --case /project/students/case-001
```

The tool creates `student.json` (applicant/case metadata), `plan.json` (authoritative task state and research), `README.md` (readable summary), and `index.html` (local dashboard). It refuses to overwrite an existing case. The bundled HTML template is reused, with escaped data and no external resources. Finish with links to the output dashboard and summary, and briefly identify unresolved requirements.

## 4. Update an existing case

For a simple status or note change, read the case and resolve the referenced task ID. If ambiguous, ask which task. Update through the command, without repeating research merely to record progress:

```sh
python <skill>/scripts/visa_case.py update --case /project/students/case-001 --task passport --status done --note 'Applicant confirmed passport is ready.'
```

`--note` appends a note; it does not erase prior notes. Use `--status todo` to reopen. The HTML is a view: the user reports completion in conversation, and the agent changes JSON and regenerates the view. No browser storage, server, or editable checkboxes are required.

For changed circumstances or refreshed requirements, re-interview only affected facts, check official sources again, and create replacement plan/applicant draft files:

```sh
python <skill>/scripts/visa_case.py replan --case /project/students/case-001 --plan /tmp/new-plan.json --applicant /tmp/new-applicant.json
```

Keep task IDs stable for the same work. The merge preserves notes and completion for unchanged tasks, marks materially changed tasks for review, and retains removed tasks in an archive for review. Review does not certify eligibility. Report changes and pending review items. The CLI makes local backups before updates. The backup contains the same personal data; do not commit case folders to source control or upload them without the user's direction.

## Installation and checks

In the source repository, this skill is in `skills/visa-agent/`. Copy that entire directory to `.agents/skills/visa-agent/` for Codex or `.claude/skills/visa-agent/` for Claude Code, in a project or the user's corresponding skill directory. Keep the scripts, references, and template alongside `SKILL.md`. Alternatively, from a cloned repository run `npx skills add . --skill visa-agent -a codex claude-code`. After public GitHub publication, use `npx skills add OWNER/REPO --skill visa-agent` with the actual repository name. Python 3.10+ is required. The executing agent needs web access for official research; the renderer itself is offline.

From the source repository run `python -m unittest discover -s tests -v`. Tests are repository tooling and are not required in the installed skill. The bundled example is synthetic and deliberately unverified. It tests rendering and uncertainty handling; it must not be presented as current New Zealand requirements.
