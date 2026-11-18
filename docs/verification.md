# Verification record — 2026-11-17 UTC

## Initial verification

- 14 Python case and rendering tests passed: state and note retention, review after applicant or evidence changes, archived tasks, dependencies, separate paths and cases, source and date validation, and HTML escaping.
- Six homepage DOM tests passed: purpose tabs and keyboard navigation, the original Korean/English switch, safe repository installation commands, clipboard success and failure messages, and generated links and demo files.
- Homepage JavaScript and browser test syntax checks passed.
- Skills CLI **1.9.0** discovered **one skill** in the local project.
- Copy installation into both Codex and Claude Code directories in a temporary project succeeded. The installed script and HTML template generated a demo case.
- The static homepage, synthetic renderer-based demo, skill ZIP and full project ZIP were generated.

DOM tests do not verify browser pixel layout or actual clipboard permissions. Clipboard tests mock successful and rejected API calls to check both flows.

## Initial screenshots — incomplete

Four Chromium browser tests (homepage and dashboard, desktop and mobile) were attempted. All were blocked during page navigation:

```text
page.goto: net::ERR_BLOCKED_BY_ADMINISTRATOR
file:///workspace/visa-agent/dist/index.html
```

The environment's official preview tool also failed to start:

```text
sites-preview: preview exited during startup:
Error: listen EPERM: operation not permitted 127.0.0.1:4173
```

That initial run produced no screenshots of the actual homepage. Design mockups or composite images are not test evidence. Browser layout, mobile overflow and screenshots were not verified in that run.

## Reproducible evidence collection

`.github/workflows/verify.yml` runs Chromium checks, captures four screenshots and uploads the Playwright report. `.github/workflows/pages.yml` requires the same checks before deployment. The initial environment did not run these GitHub workflows, so this record does not claim CI passed.

Upload to a public GitHub repository, skills.sh listing checks and remote homepage deployment were not performed. No repository URL was specified. This is a locally prepared distribution. The demo visa requirements have not been checked against actual official sources.

## Homepage language update — 2026-11-17

- Homepage text, prompts, metadata, accessible labels, clipboard messages and synthetic dashboards now support English, Korean, Japanese and Simplified Chinese. English is the default.
- Skill source, examples and project documentation use English. Other case languages remain available through complete `plan.ui` translations.
- All 14 Python tests and six DOM tests passed. The DOM tests check all four translation dictionaries, all five prompts per language, selected-tab retention, localized feedback and demo links.
- All four Playwright tests passed at desktop (1440×1000) and mobile (390×844) sizes. Homepage tests switch through all four languages, check embedded dashboard language and task count, and check for horizontal page overflow. Japanese text wrapping was corrected after the mobile test found overflow.
- Browser execution initially failed inside the macOS sandbox. The same tests passed when run with approved execution outside the sandbox.
- Screenshots are available in `evidence/homepage-{en,ko,ja,zh-CN}-{desktop,mobile}.png`, `homepage-{desktop,mobile}.png`, and `dashboard-{desktop,mobile}.png`.
- GitHub CI, publishing and live visa requirements were not checked during this update.
