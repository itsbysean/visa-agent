const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const evidence = path.join(root, 'evidence');
const base = process.env.VISA_SITE_BASE_URL;
const home = base ? new URL('./', base.endsWith('/') ? base : base+'/').href : pathToFileURL(path.join(root, 'dist/index.html')).href;
const demo = base ? new URL('demos/nz-study/index.html', home).href : pathToFileURL(path.join(root, 'dist/demos/nz-study/index.html')).href;
fs.mkdirSync(evidence, {recursive: true});

for (const [name, viewport] of [['desktop', {width:1440, height:1000}], ['mobile', {width:390, height:844}]]) {
  test(`homepage ${name}: English prompts, install command, demo and screenshot`, async ({page}) => {
    await page.setViewportSize(viewport);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(home);
    await expect(page.locator('h1')).toContainText('Your next chapter');
    await expect(page.locator('#prompt-text')).toContainText('Vietnamese');
    await page.getByRole('tab', {name:'Work',exact:true}).click();
    await expect(page.locator('#prompt-text')).toContainText('job offer');
    await page.getByRole('tab', {name:'Work',exact:true}).press('ArrowRight');
    await expect(page.locator('#tab-visit')).toBeFocused();
    await expect(page.locator('#prompt-text')).toContainText('transit');
    await page.locator('#repository').fill('example/visa-agent');
    await expect(page.locator('#install-command')).toHaveText('npx skills add example/visa-agent --skill visa-agent');
    await page.locator('#repository').fill('bad; echo unsafe');
    await expect(page.locator('#repository')).toHaveAttribute('aria-invalid','true');
    await expect(page.locator('#install-command')).toHaveText('npx skills add . --skill visa-agent');
    await page.locator('#repository').fill('');
    // Exercise clipboard success and failure independently of host permissions.
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText: async text => {window.__copied = text;}}}));
    await page.locator('#copy-prompt').click();
    await expect(page.locator('#prompt-feedback')).toHaveText('Copied.');
    expect(await page.evaluate(() => window.__copied)).toContain('transit');
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText: async () => {throw Error('denied');}}}));
    await page.locator('#copy-prompt').click();
    await expect(page.locator('#prompt-feedback')).toContainText('Ctrl+C');
    await expect(page.locator('html')).toHaveAttribute('lang','en');
    await expect(page.locator('#prompt-text')).toContainText('transit');
    for (const [language, heading] of [['ko','다음 여정'],['ja','次の一歩'],['zh-CN','开启下一段旅程'],['en','Your next chapter']]) {
      await page.locator('#language').selectOption(language);
      await expect(page.locator('html')).toHaveAttribute('lang',language);
      await expect(page.locator('h1')).toContainText(heading);
      await expect(page.locator('#tab-visit')).toHaveAttribute('aria-selected','true');
      await expect(page.frameLocator('iframe').locator('html')).toHaveAttribute('lang',language);
      await expect(page.frameLocator('iframe').locator('article.task')).toHaveCount(3);
      const sample = page.frameLocator('iframe');
      await expect(sample.locator('.overview time')).toHaveText('2027-02-15');
      const task = sample.locator('.needs_review details');
      await expect(task.locator('.task-body')).toBeHidden();
      await task.locator('summary').press('Enter');
      await expect(task.locator('.task-body a')).toBeVisible();
      await task.locator('summary').press('Enter');
      await expect(task.locator('.task-body')).toBeHidden();
      const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => ({tag:el.tagName, id:el.id, class:el.className, right:el.getBoundingClientRect().right})));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), JSON.stringify({language,overflow})).toBe(true);
      await page.locator('iframe').scrollIntoViewIfNeeded();
      await expect(page.frameLocator('iframe').locator('article.task').first()).toBeVisible();
      await page.screenshot({path:path.join(evidence,`homepage-${language}-${name}.png`),fullPage:true,animations:'disabled'});
    }
    await page.getByRole('tab', {name:'Study',exact:true}).click();
    await expect(page.frameLocator('iframe').locator('article.task')).toHaveCount(3);
    await expect(page.frameLocator('iframe').locator('progress')).toHaveAttribute('value','33');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await page.locator('h1').scrollIntoViewIfNeeded();
    await page.evaluate(() => {document.documentElement.style.scrollBehavior='auto'; window.scrollTo(0,0);});
    await page.screenshot({path:path.join(evidence,`homepage-${name}.png`),fullPage:true,animations:'disabled'});
  });
  test(`case dashboard ${name}: completion, unknown requirements and screenshot`, async ({page}) => {
    await page.setViewportSize(viewport);
    await page.goto(demo);
    await expect(page.locator('progress')).toHaveAttribute('value','33');
    await expect(page.locator('article.done')).toHaveCount(1);
    await expect(page.locator('article.needs_review')).toHaveCount(1);
    await expect(page.locator('body')).toContainText('This demo has not checked official requirements');
    await expect(page.locator('body')).toContainText('Not verified');
    await page.locator('.needs_review summary').click();
    await expect(page.locator('.needs_review .task-body')).toBeVisible();
    await expect(page.locator('.needs_review .task-body')).toContainText('Depends on: Confirm school and course');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:path.join(evidence,`dashboard-${name}.png`),fullPage:true});
  });
}
test.afterAll(() => {
  // Test result status remains in Playwright's report; this is only artifact metadata.
  fs.writeFileSync(path.join(evidence,'capture-metadata.json'), JSON.stringify({attempted_at:new Date().toISOString(),screenshots:fs.readdirSync(evidence).filter(name => name.endsWith('.png')),runner:'Playwright Chromium',viewports:['1440x1000','390x844'],source:'Synthetic demo; official visa requirements not verified.'},null,2));
});
