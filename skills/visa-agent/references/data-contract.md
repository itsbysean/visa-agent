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

Official requirements must cite at least one checked source. `to_verify` tasks must be `needs_review` and cannot be marked complete until replanning provides verified requirements or resolves them into recommendations. Completing an active task requires completed prerequisites. Reopening a prerequisite marks completed or in-progress downstream tasks for review and preserves their prior status.

Each source: `id` (unique string), `title`, `url` (HTTPS, no credentials), `checked_on` (YYYY-MM-DD or null). Optionally include `supports` to record the supported rule/claim. Renderer validation checks structure and dates, not whether a website is an authority or whether its content supports a claim: the executing agent must verify those facts. Never fabricate a check date. Reuse source IDs for the same page; assign new IDs when a different evidence record is needed.

Replanning preserves unchanged tasks' status and all notes. A change to title, phase, details, kind, deadline, dependencies or citation content (excluding a check-date refresh alone) sets `needs_review` and retains `previous_status`. Removed tasks are archived with their notes and evidence. Restored tasks need review. Review reasons are internal codes: `requirements_changed`, `applicant_facts_changed`, `removed_from_current_plan`. Clearing an active review requires an explicit status update or a new evidence-backed plan. Old source IDs still used by archived tasks remain resolvable; use distinct IDs for revised historical evidence when necessary.

## Language

Built-in UI labels support `en`. `plan.ui` can override labels. For any other output language the agent must supply translations for every key below; validation rejects incomplete translations. Task titles, details, questions and phase names are always authored by the agent in that language.

```text
title progress tasks phases questions sources checked unverified notes due
official recommended dependencies archived view todo in_progress done
needs_review official_requirement recommendation to_verify no_date updated
purpose destination source review
```

Optional dashboard labels are `next_due` and `checklist`. Existing translations can omit them. The dashboard then uses the translated `due` and `phases` labels for non-English cases.

## File lifecycle

- `create` validates first and refuses an existing case directory.
- `update`, `render`, and `replan` validate and render before replacing files, taking a `.history/<timestamp>-<random>/` backup of the prior four files.
- Individual files are replaced atomically, but a multi-file write is not transactional. Use one agent per case at a time. Following an interrupted write, inspect `.history` and restore the last consistent JSON pair before rendering again.
- Updates are local only. Data has no automatic remote synchronization or encryption. Keep output roots and backups private. Add `students/` and any custom output roots to your project ignore file; the ignore file inside this skill package cannot exclude sibling output folders.
