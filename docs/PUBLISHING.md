# Publishing on skills.sh and GitHub Pages

## Package structure

The skill entry point is `skills/visa-agent/SKILL.md`. Its YAML frontmatter contains `name: visa-agent` and a `description` that explains when to use it. Scripts, HTML templates and reference documents are all inside the skill folder, so relative paths still work after installation. The homepage and tests are outside the installable folder.

Official [skill creation and sharing guide](https://github.com/vercel-labs/skills/blob/main/docs/creating-skills.md) and [CLI documentation](https://skills.sh/docs).

## Commands verified locally

```sh
npx skills add . --list
npx skills add /absolute/path/to/visa-agent --skill visa-agent -a codex claude-code --copy -y
```

During the initial verification, CLI 1.9.0 found one skill and installed it into `.agents/skills/visa-agent` and `.claude/skills/visa-agent` in a temporary project. HTML generation with the installed script and template was also checked.

## Public GitHub source

1. Upload this project to a public GitHub repository. Do not overwrite a repository for another project.
2. Verify installation from the actual source with `npx skills add OWNER/REPO --skill visa-agent`.
3. The skills.sh documentation describes directory rankings based on anonymous Skills CLI installation activity. No separate npm release or custom registration manifest is required. A public repository and actual installation must be available; local preparation does not guarantee search visibility or approval.

The project does not assume a repository owner or public URL. Enter the repository on the homepage or supply it as a build argument.

## GitHub Pages

1. In Settings → Pages → Build and deployment, select **GitHub Actions**.
2. Check the **Verify skill and capture browser evidence** workflow. Download browser results and screenshots from its `browser-evidence` artifact.
3. Run Actions → **Publish homepage to GitHub Pages** → Run workflow.
4. Deploy only after case, DOM and browser checks pass. The deployment URL appears in the workflow's `github-pages` environment result.

The build uses `GITHUB_REPOSITORY` to set the homepage installation command. Relative paths support project Pages subpaths. The deployed `dist/` folder contains synthetic examples only. The build does not collect real case folders.

## Reproduce screenshots

```sh
npm ci
python3 tools/build_site.py
npx playwright install chromium
npm run test:browser
```

Inspect `evidence/homepage-desktop.png`, `homepage-mobile.png`, `dashboard-desktop.png`, `dashboard-mobile.png` and the Playwright report. Tests use 1440×1000 and 390×844 viewports, switch through all four homepage languages, and save screenshots after successful checks. Language-specific captures use `homepage-{en,ko,ja,zh-CN}-{desktop,mobile}.png`. If your environment blocks `file://` access, set `VISA_SITE_BASE_URL` to an approved preview URL. Do not change or bypass administrator policy.

```sh
VISA_SITE_BASE_URL=https://YOUR-APPROVED-PREVIEW/ npm run test:browser
```
