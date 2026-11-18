const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function setup(config = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'website/index.html'), 'utf8'), {runScripts:'outside-only',url:'https://example.org/visa-agent/'});
  dom.window.VISA_AGENT_CONFIG = config;
  dom.window.eval(fs.readFileSync(path.join(root,'website/translations.js'),'utf8'));
  dom.window.eval(fs.readFileSync(path.join(root,'website/site.js'),'utf8'));
  return dom;
}
test('all five purpose tabs select the correct English prompt and keyboard focus', () => {
  const dom = setup(), doc = dom.window.document;
  for (const id of ['work','visit','family','update','study']) {
    doc.querySelector('#tab-'+id).click();
    assert.equal(doc.querySelector('#prompt-content').getAttribute('aria-labelledby'),'tab-'+id);
    assert.equal(doc.querySelectorAll('[aria-selected="true"]').length,1);
    assert.ok(doc.querySelector('#prompt-text').textContent.length > 80);
  }
  doc.querySelector('#tab-study').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  assert.equal(doc.activeElement.id,'tab-work');
  assert.match(doc.querySelector('#prompt-text').textContent,/job offer/);
  dom.window.close();
});
test('all four languages update content, prompts, metadata and demo links', async () => {
  const dom = setup(), doc = dom.window.document;
  const locales = dom.window.VISA_AGENT_LOCALES;
  const englishKeys = Object.keys(locales.en.text).sort();
  doc.querySelector('#tab-family').click();
  for (const language of ['ko','ja','zh-CN','en']) {
    const locale = locales[language];
    assert.deepEqual(Object.keys(locale.text).sort(),englishKeys);
    doc.querySelector('#language').value=language;
    doc.querySelector('#language').dispatchEvent(new dom.window.Event('change'));
    assert.equal(doc.documentElement.lang,language);
    assert.equal(doc.title,locale.text.pageTitle);
    assert.equal(doc.querySelector('meta[name="description"]').content,locale.text.metaDescription);
    for (const el of doc.querySelectorAll('[data-i18n]')) assert.equal(el.textContent,locale.text[el.dataset.i18n]);
    for (const el of doc.querySelectorAll('[data-i18n-aria]')) assert.equal(el.getAttribute('aria-label'),locale.text[el.dataset.i18nAria]);
    assert.equal(doc.querySelector('#prompt-text').textContent,locale.prompts.family);
    assert.equal(doc.querySelector('#tab-family').getAttribute('aria-selected'),'true');
    const demoPath='./demos/nz-study/'+(language==='en'?'':language+'/')+'index.html';
    assert.equal(doc.querySelector('iframe').getAttribute('src'),demoPath);
    assert.equal(doc.querySelector('iframe').title,locale.text.iframeTitle);
    assert.equal(doc.querySelector('[data-i18n="openDemo"]').getAttribute('href'),demoPath);
    for (const key of Object.keys(locale.prompts)) {
      doc.querySelector('#tab-'+key).click();
      assert.equal(doc.querySelector('#prompt-text').textContent,locale.prompts[key]);
    }
    doc.querySelector('#copy-prompt').click();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(doc.querySelector('#prompt-feedback').textContent,locale.text.manualCopy);
    let copied;
    Object.defineProperty(dom.window.navigator,'clipboard',{configurable:true,value:{writeText:async value=>{copied=value;}}});
    doc.querySelector('#copy-prompt').click();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(copied,locale.prompts.update);
    assert.equal(doc.querySelector('#prompt-feedback').textContent,locale.text.copied);
    delete dom.window.navigator.clipboard;
    doc.querySelector('#repository').value='bad; command';
    doc.querySelector('#repository').dispatchEvent(new dom.window.Event('input'));
    assert.equal(doc.querySelector('#install-feedback').textContent,locale.text.invalidRepo);
    doc.querySelector('#tab-family').click();
  }
  dom.window.close();
});
test('repository configuration generates safe actual or local commands', () => {
  const dom = setup({repository:'example/visa-agent'}), doc = dom.window.document;
  const input=doc.querySelector('#repository'), command=doc.querySelector('#install-command');
  assert.equal(command.textContent,'npx skills add example/visa-agent --skill visa-agent');
  for (const bad of ['owner/repo; echo injected','https://github.com/owner/repo','--flag/repo','owner/..']) {
    input.value=bad;input.dispatchEvent(new dom.window.Event('input'));
    assert.equal(input.getAttribute('aria-invalid'),'true');
    assert.equal(command.textContent,'npx skills add . --skill visa-agent');
  }
  input.value='';input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(input.getAttribute('aria-invalid'),'false');
  dom.window.close();
});
test('copy success copies the current prompt', async () => {
  const dom = setup(), doc = dom.window.document;
  let copied;
  Object.defineProperty(dom.window.navigator,'clipboard',{value:{writeText: async text => {copied=text;}}});
  doc.querySelector('#tab-work').click();doc.querySelector('#copy-prompt').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(copied,/work visa/);
  assert.equal(doc.querySelector('#prompt-feedback').textContent,'Copied.');
  dom.window.close();
});
test('unavailable clipboard selects the text and gives honest manual-copy guidance', async () => {
  const dom = setup(), doc = dom.window.document;
  doc.querySelector('#copy-prompt').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(doc.querySelector('#prompt-feedback').textContent,/Ctrl\+C/);
  assert.equal(dom.window.getSelection().toString(),doc.querySelector('#prompt-text').textContent);
  dom.window.close();
});
test('built homepage links, demo and downloadable skill resources exist', () => {
  const dom = new JSDOM(fs.readFileSync(path.join(root,'dist/index.html'),'utf8'));
  for (const el of dom.window.document.querySelectorAll('[href],[src]')) {
    const url=el.getAttribute('href') || el.getAttribute('src');
    if (url.startsWith('./')) assert.ok(fs.existsSync(path.join(root,'dist',url)),url);
  }
  const demo=fs.readFileSync(path.join(root,'dist/demos/nz-study/index.html'),'utf8');
  assert.match(demo,/value="33"/);assert.match(demo,/Not verified/);
  assert.ok(!demo.includes('<script'));
  for (const language of ['ko','ja','zh-CN']) {
    const page=fs.readFileSync(path.join(root,'dist/demos/nz-study',language,'index.html'),'utf8');
    const localized=new JSDOM(page);
    assert.equal(localized.window.document.documentElement.lang,language);
    assert.equal(localized.window.document.querySelectorAll('article.task').length,3);
    assert.equal(localized.window.document.querySelector('progress').value,33);
    localized.window.close();
  }
  dom.window.close();
});
