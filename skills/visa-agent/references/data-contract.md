# Case data contract (version 1)

UTF-8 JSON. Use strings for user-facing text in the selected language. `student.json` is the legacy-compatible applicant/case filename for ALL visa purposes. CLI storage is authoritative; HTML and Markdown are generated views. JSON is not embedded as executable code in the HTML.

## Applicant (`student.json`)

Required: `schema_version: 1`, `display_name`, `citizenships` (nonempty string array), `destination`, `purpose`, `language` (e.g. `en`, `vi`). CLI sets `case_id` from the folder identifier on creation. These purpose/destination values are descriptive, not hardcoded enums.

Additional contextual facts may use these keys: `current_country`, `current_status`, `age_band`, `route`, `travel_on`, `school`, `course`, `start_on`, `employer`, `sponsor`, `dependants`. Keep unknowns null or omit them and add relevant questions to the plan. Avoid collecting more personal data than needed. Changes to contextual facts cause all active tasks to be reviewed on replanning.

## Plan (`plan.json`)

Required: `schema_version: 1`, `tasks` array, `sources` array, `open_questions` string array. `archived_tasks`, `ui` and `updated_at` are optional. CLI sets the UTC update timestamp, which is separate from source verification dates.

Each task requires:

| Field | Meaning |
|---|---|
| `id` | Stable lowercase letters/digits/underscore/hyphen ID; unique across active and archived tasks |
| `title`, `phase`, `details` | Nonempty localized strings; details explain applicability and any assumptions |
| `status` | `todo`, `in_progress`, `done`, `needs_review` |
| `kind` | `official_requirement`, `recommendation`, `to_verify` |
| `due_on`, `due_kind` | Both null when unknown; otherwise ISO date and `official` or `recommended` |
| `source_ids` | Array of source IDs, possibly empty for recommendations or unresolved research |
| `depends_on` | Task IDs; active tasks must depend on active tasks; no cycles |
| `notes` | String array, preserved and deduplicated on replanning |

Optional task fields:

- `evidence`: list of objects with `source_id` (a unique entry from the task's `source_ids`) and localized `supports` text explaining the rule, condition, or applicability this page supports. Keep the official URL and the actual check date in the source record. The dashboard and Markdown show the link, check date, and task-level explanation. Older records that only use `source_ids` remain valid.
- `verification`: `cross_checked` requires task-level evidence from at least two distinct checked official pages. `single_source` requires exactly one distinct checked evidence page. Different anchors or query strings for the same page count once. `needs_review` requires `kind: to_verify` and `status: needs_review`. The executing agent determines authority, current applicability, and whether the cited pages agree. The CLI validates the evidence structure and counts checked pages.
- `due_basis`: object with localized, nonempty `evidence` identifying the notice, checked source, or planning assumption. A relative date may also include `anchor_on` (ISO date), `offset` (nonnegative integer), and `unit` (`days` or `months`). Supply these three fields together. Months clamp to the last day of a shorter month. The CLI shows the calculated date as a candidate when `due_on` and `due_kind` are null. If a date is assigned with this calculation, it must match the result. Check the applicable counting convention before assignment.
- `waiting_on`: localized text explaining a missing answer or confirmation. Omit or set it to null once resolved. A task with this field, incomplete prerequisites, or a review status is excluded from next actions. Resolve the item through replanning before marking the task complete.

Official requirements must cite at least one checked source. `to_verify` tasks must be `needs_review` and cannot be marked complete until replanning provides verified requirements or resolves them into recommendations. Completing an active task requires completed prerequisites. Reopening a prerequisite marks completed or in-progress downstream tasks for review and preserves their prior status.

Each source: `id` (unique string), `title`, `url` (HTTPS, no credentials), `checked_on` (YYYY-MM-DD or null). Optionally include `supports` to record the supported rule/claim. Renderer validation checks structure and dates, not whether a website is an authority or whether its content supports a claim: the executing agent must verify those facts. Never fabricate a check date. Reuse source IDs for the same page; assign new IDs when a different evidence record is needed.

Replanning preserves unchanged tasks' status and all notes. A change to title, phase, details, kind, deadline or its basis, waiting item, dependencies or citation content (excluding a check-date refresh alone) sets `needs_review` and retains `previous_status`. Removed tasks are archived with their notes and evidence. Restored tasks need review. Review reasons are internal codes: `requirements_changed`, `applicant_facts_changed`, `removed_from_current_plan`. Clearing an active review requires an explicit status update or a new evidence-backed plan. Old source IDs still used by archived tasks remain resolvable; use distinct IDs for revised historical evidence when necessary.

`replan --show-changes` prints a JSON report after saving. It includes the dashboard path, affected task IDs and titles, before and after values for changed task fields and source content, and added or removed questions. It excludes check-date-only changes and reports whether applicant facts changed without printing their values.

## Language

Built-in UI labels support `en`. `plan.ui` can override labels. For any other output language the agent must supply translations for every key below; validation rejects incomplete translations. Task titles, details, questions and phase names are always authored by the agent in that language.

```text
title progress tasks phases questions sources checked unverified notes due
official recommended dependencies archived view todo in_progress done
needs_review official_requirement recommendation to_verify no_date updated
purpose destination source review
```

Optional dashboard labels are `next_due`, `checklist`, `next_actions`, `due_basis`, `due_candidate`, `waiting_on`, `blocked`, `evidence`, `cross_checked`, and `single_source`. Existing translations can omit them. The dashboard then uses the closest existing translated labels for non-English cases.

## File lifecycle

- `create` validates first and refuses an existing case directory.
- `update`, `render`, and `replan` validate and render before replacing files, taking a `.history/<timestamp>-<random>/` backup of the prior four files.
- Individual files are replaced atomically, but a multi-file write is not transactional. Use one agent per case at a time. Following an interrupted write, inspect `.history` and restore the last consistent JSON pair before rendering again.
- Updates are local only. Data has no automatic remote synchronization or encryption. Keep output roots and backups private. Add `students/` and any custom output roots to your project ignore file; the ignore file inside this skill package cannot exclude sibling output folders.
