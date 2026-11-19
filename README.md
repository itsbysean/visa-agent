# Visa Agent

Visa Agent is a skill for Codex and Claude Code. Tell your agent your destination and purpose. It asks for missing details, checks current official sources, and creates a local dashboard with required documents, deadlines, next actions, and evidence. Use it for study, work, visits, family, residence, or transit.

[Homepage](https://itsbysean.github.io/visa-agent/) · [Sample dashboard](https://itsbysean.github.io/visa-agent/demos/nz-study/index.html) · [skills.sh listing](https://skills.sh/itsbysean/visa-agent/visa-agent)

## Install and use

Run this command once from the folder where you want to keep your cases. Select Codex, Claude Code, or both when prompted.

```sh
npx skills add itsbysean/visa-agent --skill visa-agent
```

Open the same folder in your agent and paste one of the example prompts below. When the agent finishes, open the `index.html` link in its preview or in a browser. Expand a task to see why it applies, its official source, and when the source was checked. Tell the agent when a task is complete to update the dashboard.

Install and generate cases with **Node.js 22.20 or later**. The agent runs the bundled script without Python or extra packages. It needs web access to check official sources. A browser is enough to open the generated dashboard.

For manual installation, extract the [skill ZIP](https://itsbysean.github.io/visa-agent/downloads/visa-agent-skill.zip) and copy the entire `visa-agent` folder into your project's `.agents/skills/` (Codex) or `.claude/skills/` (Claude Code). The agent still needs Node.js to generate cases.

## Example prompts

```text
Use visa-agent to help a Vietnamese applicant prepare to study in New Zealand.
The school is [school] and the course is [course].
Ask for missing information first and check current official sources.
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

The default case folder is `students/`. You can choose another folder, such as `visas/`. Each case contains `student.json` for applicant details, `plan.json` for the task records, `README.md` for the summary, and `index.html` for the dashboard. Cases created with the earlier Python version use the same format. When you ask the agent to check the plan again, it opens current official sources, preserves progress on unchanged tasks, and flags changes for review.

Keep real cases and `.history` backups out of version control because they can contain personal information. The public demo uses fictional data. The bundled country guide covers New Zealand. For each case, the agent researches the relevant requirements for the destination and visa route. The skill does not submit applications, pay fees, or contact authorities.

## Structure and verification

The homepage is available in English, Korean, Japanese, and Simplified Chinese. The repository build uses Python 3.10+ to package website downloads.

```text
skills/visa-agent/
  SKILL.md                 # Skill entry point discovered by the CLI
  scripts/visa_case.cjs    # Create, update, replan, validate and render cases
  templates/dashboard.html
  references/              # Research guidance and data contract
  examples/                # Synthetic input data
website/                   # Homepage source and translations
tools/build_site.py        # Static site, demos and ZIP builder
tests/                     # Case data and homepage tests
.github/workflows/         # Verification, screenshots and GitHub Pages
```

```sh
npm ci
npm test
npm run build -- --repository itsbysean/visa-agent
npm run test:site
npx playwright install chromium
npm run test:browser
```

[Publishing procedure](docs/PUBLISHING.md) · [Verification record and screenshot limits](docs/verification.md) · [Data contract](skills/visa-agent/references/data-contract.md)
