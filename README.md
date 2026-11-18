# Visa Agent

An AI agent skill that asks for missing applicant information, checks official sources, and creates a visa preparation plan with a local HTML dashboard. It manages preparation for study, work, visits, family, residence and transit. Use it with Codex and Claude Code.

## Homepage and examples

- Homepage source: [`website/`](website/)
- Built homepage: `dist/index.html` (generate it with the command below)
- Homepage languages: English, Korean, Japanese and Simplified Chinese
- Prompts cover study, work, visits and transit, family and residence, and case updates.
- Open a synthetic case dashboard built with the actual renderer from the homepage.
- Copy prompts and generate installation commands for your repository.

```sh
python3 tools/build_site.py
```

Once you have a public GitHub repository, supply its address to include it in the homepage installation command.

```sh
python3 tools/build_site.py --repository OWNER/REPO
```

`OWNER/REPO` is a placeholder. It does not indicate that this project is published or listed on skills.sh.

## Installation

Requires Node.js 22.20+ and Python 3.10+. Extract the full project ZIP or download this repository, then run this command from the project root:

```sh
npx skills add . --skill visa-agent -a codex claude-code
```

After publishing to GitHub, install from the actual repository:

```sh
npx skills add OWNER/REPO --skill visa-agent
```

To install without the CLI, copy the **entire `skills/visa-agent/` directory** into your project's `.agents/skills/visa-agent/` or `.claude/skills/visa-agent/`. The `visa-agent-skill.zip` download contains the skill only. The `visa-agent.zip` download contains the full project, including the homepage and tests.

## Example prompts

```text
Use visa-agent to help a Vietnamese applicant prepare to study in New Zealand.
The school is [school] and the course is [course].
Ask for missing information first and check official sources.
Create an admissions, visa and departure checklist with an HTML dashboard.
Save the output in English to students/case-001.
```

```text
Use visa-agent to prepare a work visa case for a [nationality] applicant
who will go to [destination country]. Ask about the job offer,
sponsorship and other missing facts first. Check the applicable route
against official sources and save the case to visas/work-001.
```

```text
Use visa-agent to read students/case-001 and mark school confirmation complete.
Add a note and update the HTML while preserving existing completion records.
```

## Storage

The default root is `students/`. You can use another root, such as `visas/`. Each case contains `student.json` (applicant information for all visa purposes), `plan.json` (the source of truth), `README.md` and `index.html`. HTML is a read-only view. Tell the agent which tasks are complete to update progress. Replanning preserves notes and progress and flags changed requirements for review.

Exclude real cases and `.history` backups from version control because they can contain personal information. Public demos use synthetic data only. The first country research guide covers New Zealand. Other destinations and routes require official research at runtime. Requirements for all countries have not been verified in advance. The skill does not submit applications, pay fees or contact authorities.

## Structure and verification

```text
skills/visa-agent/
  SKILL.md                 # Skill entry point discovered by the CLI
  scripts/visa_case.py      # Create, update, replan, validate and render cases
  templates/dashboard.html
  references/              # Research guidance and data contract
  examples/                # Synthetic input data
website/                   # Homepage source and translations
tools/build_site.py       # Static site, demos and ZIP builder
tests/                     # Case data and homepage tests
.github/workflows/         # Verification, screenshots and GitHub Pages
```

```sh
python3 -m unittest discover -s tests -v
npm ci
python3 tools/build_site.py
npm run test:site
npx playwright install chromium
npm run test:browser
```

[Publishing procedure](docs/PUBLISHING.md) · [Verification record and screenshot limits](docs/verification.md) · [Data contract](skills/visa-agent/references/data-contract.md)
