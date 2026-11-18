'use strict';
const locales = window.VISA_AGENT_LOCALES;
let language = 'en';
let selectedPrompt = 'study';
const text = key => locales[language].text[key];
function demoUrl(lang) {
  return './demos/nz-study/' + (lang === 'en' ? '' : lang + '/') + 'index.html';
}
function setLanguage(next) {
  if (!Object.hasOwn(locales, next)) return;
  language = next;
  document.documentElement.lang = next;
  document.getElementById('language').value = next;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = text(el.dataset.i18n);
    el.style.whiteSpace = el.textContent.includes('\n') ? 'pre-line' : '';
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => el.setAttribute('aria-label', text(el.dataset.i18nAria)));
  document.title = text('pageTitle');
  document.querySelector('meta[name="description"]').content = text('metaDescription');
  const frame = document.querySelector('iframe');
  frame.title = text('iframeTitle');
  frame.setAttribute('src', demoUrl(next));
  document.querySelector('[data-i18n="openDemo"]').setAttribute('href', demoUrl(next));
  showPrompt(selectedPrompt);
  updateRepository();
}
document.getElementById('language').addEventListener('change', event => setLanguage(event.target.value));
function showPrompt(key, focus=false) {
  selectedPrompt = key;
  document.querySelectorAll('[data-prompt]').forEach(el => {
    const active = el.dataset.prompt === key;
    el.setAttribute('aria-selected', String(active)); el.tabIndex = active ? 0 : -1;
    if (active && focus) el.focus();
  });
  document.getElementById('prompt-content').setAttribute('aria-labelledby', 'tab-' + key);
  document.getElementById('prompt-text').textContent = locales[language].prompts[key];
  document.getElementById('prompt-feedback').textContent = '';
}
document.querySelectorAll('[data-prompt]').forEach(el => {
  el.addEventListener('click', () => showPrompt(el.dataset.prompt));
  el.addEventListener('keydown', event => {
    const tabs = [...document.querySelectorAll('[data-prompt]')];
    let index = tabs.indexOf(el);
    if (event.key === 'ArrowRight') index = (index+1)%tabs.length;
    else if (event.key === 'ArrowLeft') index = (index-1+tabs.length)%tabs.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = tabs.length-1;
    else return;
    event.preventDefault(); showPrompt(tabs[index].dataset.prompt, true);
  });
});
function updateRepository() {
  const input = document.getElementById('repository');
  const repo = input.value.trim();
  const valid = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})\/[a-zA-Z0-9_.-]+$/.test(repo) && !repo.endsWith('/.') && !repo.endsWith('/..');
  input.setAttribute('aria-invalid', String(Boolean(repo) && !valid));
  document.getElementById('install-command').textContent = valid ? `npx skills add ${repo} --skill visa-agent` : 'npx skills add . --skill visa-agent';
  document.getElementById('install-feedback').textContent = repo && !valid ? text('invalidRepo') : '';
}
document.getElementById('repository').addEventListener('input', updateRepository);
document.querySelectorAll('[data-copy]').forEach(el => el.addEventListener('click', async () => {
  const target = document.getElementById(el.dataset.copy);
  const feedback = document.getElementById(el.dataset.copy === 'prompt-text' ? 'prompt-feedback' : 'install-feedback');
  try {
    if (!navigator.clipboard) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(target.textContent);
    feedback.textContent = text('copied');
  } catch {
    const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(target);
    selection.removeAllRanges(); selection.addRange(range);
    feedback.textContent = text('manualCopy');
  }
}));
const configured = window.VISA_AGENT_CONFIG?.repository || '';
if (configured) { document.getElementById('repository').value = configured; updateRepository(); }

setLanguage('en');
