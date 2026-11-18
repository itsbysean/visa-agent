#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual, parseArgs } = require('node:util');

const STATUSES = ['todo', 'in_progress', 'done', 'needs_review'];
const KINDS = ['official_requirement', 'recommendation', 'to_verify'];
const LABELS = {
  title: 'Visa preparation', progress: 'Progress', tasks: 'tasks completed',
  phases: 'Preparation stages', questions: 'Open questions', sources: 'Official sources',
  checked: 'Checked', unverified: 'Not verified', notes: 'Notes', due: 'Due',
  official: 'Official deadline', recommended: 'Recommended date', dependencies: 'Depends on',
  archived: 'Archived tasks — review required', view: 'To update progress, tell your agent which task is complete.',
  todo: 'To do', in_progress: 'In progress', done: 'Done', needs_review: 'Needs review',
  official_requirement: 'Official requirement', recommendation: 'Recommendation', to_verify: 'To verify',
  no_date: 'No date set', updated: 'Updated', purpose: 'Purpose', destination: 'Destination',
  source: 'Source', review: 'Review reason',
};
const OPTIONAL_LABELS = {
  next_due: ['Next deadline', 'due'],
  checklist: ['Checklist', 'phases'],
  next_actions: ['Next actions', 'todo'],
  due_basis: ['Deadline basis', 'source'],
  due_candidate: ['Possible deadline — verify before relying on it', 'needs_review'],
  waiting_on: ['Waiting on', 'dependencies'],
  blocked: ['Blocked', 'needs_review'],
  evidence: ['Evidence for this task', 'sources'],
  cross_checked: ['Cross-checked', 'checked'],
  single_source: ['Single official source', 'checked'],
};
const REVIEW_REASONS = {
  requirements_changed: 'Requirements or evidence changed.',
  applicant_facts_changed: 'Applicant circumstances changed.',
  removed_from_current_plan: 'Removed from the current plan.',
};
const MATERIAL_TASK_FIELDS = [
  'title', 'phase', 'details', 'kind', 'due_on', 'due_kind', 'due_basis',
  'waiting_on', 'depends_on', 'source_ids', 'verification', 'evidence',
];
const CASE_FILES = ['student.json', 'plan.json', 'index.html', 'README.md'];

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const json = value => JSON.stringify(value, null, 2) + '\n';
const byId = items => new Map(items.map(item => [item.id, item]));
const different = (first, second) => !isDeepStrictEqual(first ?? null, second ?? null);

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function localToday() {
  const now = new Date();
  return [String(now.getFullYear()).padStart(4, '0'), String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')].join('-');
}

function deadlineCandidate(basis) {
  const fields = ['anchor_on', 'offset', 'unit'];
  if (!fields.some(field => Object.hasOwn(basis, field))) return null;
  requireThat(fields.every(field => Object.hasOwn(basis, field)), 'Deadline calculation needs anchor_on, offset and unit');
  requireThat(validDate(basis.anchor_on), 'Invalid deadline anchor date');
  const { offset, unit } = basis;
  requireThat(Number.isSafeInteger(offset) && offset >= 0, 'Deadline offset must be a nonnegative integer');
  requireThat(['days', 'months'].includes(unit), 'Deadline unit must be days or months');
  const date = new Date(basis.anchor_on + 'T00:00:00Z');
  if (unit === 'days') {
    date.setUTCDate(date.getUTCDate() + offset);
  } else {
    const day = date.getUTCDate();
    date.setUTCMonth(date.getUTCMonth() + offset + 1, 0);
    date.setUTCDate(Math.min(day, date.getUTCDate()));
  }
  requireThat(Number.isFinite(date.valueOf()) && date.getUTCFullYear() <= 9999, 'Calculated deadline is out of range');
  return date.toISOString().slice(0, 10);
}

function checkedSources(sources) {
  const checked = new Map();
  const ids = new Set();
  const today = localToday();
  for (const source of sources) {
    requireThat(isObject(source), 'Each source must be an object');
    requireThat(nonempty(source.id) && !ids.has(source.id), 'Source IDs must be unique');
    ids.add(source.id);
    requireThat(nonempty(source.title), 'Source title required');
    const url = typeof source.url === 'string' ? URL.parse(source.url) : null;
    requireThat(url?.protocol === 'https:' && url.hostname && !url.username && !url.password &&
      /^https:\/\//i.test(source.url) && !/[\u0000-\u0020\u007f<>\\]/.test(source.url),
    'Source URL must be https without credentials');
    const day = source.checked_on;
    requireThat(day == null || (validDate(day) && day <= today), 'Source date must be null or an actual non-future date');
    if (day) checked.set(source.id, url.hostname + url.pathname.replace(/\/+$/, ''));
  }
  return { ids, checked };
}

function validateTask(task, ids, checked) {
  const id = task.id;
  for (const key of ['title', 'phase', 'details']) {
    requireThat(nonempty(task[key]), `Task ${id} needs ${key}`);
  }
  requireThat(STATUSES.includes(task.status), `Invalid status: ${id}`);
  requireThat(KINDS.includes(task.kind), `Invalid kind: ${id}`);
  requireThat(Array.isArray(task.source_ids) && task.source_ids.every(sid => ids.has(sid)),
    `Unknown source: ${id}`);
  requireThat(Array.isArray(task.depends_on) && task.depends_on.every(dep => typeof dep === 'string'),
    `Invalid dependencies: ${id}`);
  requireThat(Array.isArray(task.notes) && task.notes.every(note => typeof note === 'string'),
    `Invalid notes: ${id}`);
  requireThat(task.due_on == null || validDate(task.due_on), `Invalid due date: ${id}`);
  requireThat(task.due_on == null ? task.due_kind == null : ['official', 'recommended'].includes(task.due_kind),
    `Invalid due_kind: ${id}`);
  requireThat(task.waiting_on == null || nonempty(task.waiting_on), `Invalid waiting_on: ${id}`);
  if (task.due_basis != null) {
    requireThat(isObject(task.due_basis) && nonempty(task.due_basis.evidence), `Deadline basis needs evidence: ${id}`);
    const candidate = deadlineCandidate(task.due_basis);
    requireThat(!candidate || !task.due_on || candidate === task.due_on, `Due date differs from deadline calculation: ${id}`);
  }

  const evidence = Object.hasOwn(task, 'evidence') ? task.evidence : [];
  requireThat(Array.isArray(evidence), `Task evidence must be a list: ${id}`);
  const cited = new Set();
  for (const citation of evidence) {
    requireThat(isObject(citation), `Invalid evidence entry: ${id}`);
    const sid = citation.source_id;
    requireThat(task.source_ids.includes(sid) && !cited.has(sid), `Evidence must reference a unique task source: ${id}`);
    requireThat(nonempty(citation.supports), `Evidence must explain what the source supports: ${id}`);
    cited.add(sid);
  }
  const verification = task.verification;
  requireThat(verification == null || ['cross_checked', 'single_source', 'needs_review'].includes(verification),
    `Invalid verification state: ${id}`);
  if (verification === 'cross_checked' || verification === 'single_source') {
    const pages = new Set([...cited].filter(sid => checked.has(sid)).map(sid => checked.get(sid)));
    const count = verification === 'cross_checked' ? 2 : 1;
    requireThat(pages.size >= count, `${verification} needs ${count} distinct checked evidence page(s): ${id}`);
    requireThat(verification !== 'single_source' || pages.size === 1, `Single-source verification must cite one checked evidence page: ${id}`);
    requireThat(task.kind !== 'to_verify', `Unverified task cannot claim verification: ${id}`);
  }
  if (verification === 'needs_review') {
    requireThat(task.kind === 'to_verify', `Unresolved evidence must use to_verify: ${id}`);
  }
  if (task.kind === 'official_requirement') {
    requireThat(task.source_ids.some(sid => checked.has(sid)), `Official requirement needs checked evidence: ${id}`);
  }
  if (task.kind === 'to_verify') {
    requireThat(task.status === 'needs_review', `Unverified requirement must need review: ${id}`);
  }
}

function validate(applicant, plan) {
  requireThat(isObject(applicant) && isObject(plan), 'Inputs must be objects');
  requireThat(applicant.schema_version === 1 && plan.schema_version === 1, 'schema_version must be 1');
  for (const key of ['display_name', 'destination', 'purpose', 'language']) {
    requireThat(nonempty(applicant[key]), `Applicant needs ${key}`);
  }
  requireThat(Array.isArray(applicant.citizenships) && applicant.citizenships.length && applicant.citizenships.every(nonempty),
    'citizenships must be a nonempty string list');
  const ui = Object.hasOwn(plan, 'ui') ? plan.ui : {};
  requireThat(isObject(ui) && Object.entries(ui).every(([key, value]) =>
    (Object.hasOwn(LABELS, key) || Object.hasOwn(OPTIONAL_LABELS, key)) && nonempty(value)),
  'ui must contain valid label overrides');
  if (applicant.language !== 'en') {
    requireThat(Object.keys(LABELS).every(key => Object.hasOwn(ui, key)),
      'Other languages require all ui labels translated; see data contract');
  }
  for (const key of ['tasks', 'sources', 'open_questions']) {
    requireThat(Array.isArray(plan[key]), `${key} must be a list`);
  }
  requireThat(plan.open_questions.every(nonempty), 'open_questions must contain strings');
  const archived = Object.hasOwn(plan, 'archived_tasks') ? plan.archived_tasks : [];
  requireThat(Array.isArray(archived), 'archived_tasks must be a list');
  const { ids: sourceIds, checked } = checkedSources(plan.sources);
  const tasks = [...plan.tasks, ...archived];
  const ids = new Set();
  for (const task of tasks) {
    requireThat(isObject(task), 'Each task must be an object');
    requireThat(typeof task.id === 'string' && /^[a-z0-9][a-z0-9_-]*$/.test(task.id) && !ids.has(task.id),
      'Task IDs must be unique safe identifiers');
    ids.add(task.id);
    validateTask(task, sourceIds, checked);
  }

  const active = byId(plan.tasks);
  for (const task of tasks) {
    requireThat(task.depends_on.every(dep => ids.has(dep) && dep !== task.id), `Invalid dependency: ${task.id}`);
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(task) {
    requireThat(!visiting.has(task.id), 'Task dependencies contain a cycle');
    if (visited.has(task.id)) return;
    visiting.add(task.id);
    for (const dependency of task.depends_on) {
      requireThat(active.has(dependency), `Active task ${task.id} depends on archived task ${dependency}`);
      visit(active.get(dependency));
    }
    visiting.delete(task.id);
    visited.add(task.id);
  }
  for (const task of plan.tasks) visit(task);
}

function sourceContent(plan) {
  return new Map(plan.sources.map(({ checked_on, ...source }) => [source.id, source]));
}

function changeReport(oldPlan, newPlan, applicantChanged = false) {
  const before = byId(oldPlan.tasks);
  const after = byId(newPlan.tasks);
  const archived = byId(oldPlan.archived_tasks ?? []);
  const oldSources = sourceContent(oldPlan);
  const newSources = sourceContent(newPlan);
  const changedSources = new Set([...new Set([...oldSources.keys(), ...newSources.keys()])]
    .filter(id => different(oldSources.get(id), newSources.get(id))));
  const tasks = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const prior = before.get(id);
    const current = after.get(id);
    if (!prior) {
      tasks.push({ id, title: current.title, change: archived.has(id) ? 'restored' : 'added' });
      continue;
    }
    if (!current) {
      tasks.push({ id, title: prior.title, change: 'archived' });
      continue;
    }
    const fields = MATERIAL_TASK_FIELDS.filter(field => different(prior[field], current[field]));
    const evidence = current.source_ids.filter(sid => changedSources.has(sid));
    if (fields.length || evidence.length || applicantChanged) {
      tasks.push({
        id, title: current.title, change: 'review',
        fields: Object.fromEntries(fields.map(field => [field, { before: prior[field] ?? null, after: current[field] ?? null }])),
        changed_source_ids: evidence,
      });
    }
  }
  return {
    applicant_facts_changed: applicantChanged,
    tasks,
    sources: [...changedSources].map(id => ({ id, before: oldSources.get(id) ?? null, after: newSources.get(id) ?? null })),
    questions_added: newPlan.open_questions.filter(question => !oldPlan.open_questions.includes(question)),
    questions_removed: oldPlan.open_questions.filter(question => !newPlan.open_questions.includes(question)),
  };
}

function markForReview(task, reason) {
  task.previous_status ??= task.status;
  task.status = 'needs_review';
  task.review_reason = reason;
}

function merge(oldPlan, newPlan) {
  const result = structuredClone(newPlan);
  const previous = byId([...oldPlan.tasks, ...(oldPlan.archived_tasks ?? [])]);
  const activeBefore = byId(oldPlan.tasks);
  const activeAfter = byId(result.tasks);
  const oldSources = sourceContent(oldPlan);
  const newSources = sourceContent(newPlan);
  for (const task of result.tasks) {
    const prior = previous.get(task.id);
    if (!prior) continue;
    task.notes = [...new Set([...prior.notes, ...task.notes])];
    task.status = prior.status;
    const changed = MATERIAL_TASK_FIELDS.some(field => different(prior[field], task[field])) ||
      task.source_ids.some(sid => different(oldSources.get(sid), newSources.get(sid)));
    if (changed || !activeBefore.has(task.id)) {
      task.previous_status = prior.status;
      markForReview(task, 'requirements_changed');
    } else if (task.kind === 'to_verify') {
      task.status = 'needs_review';
    } else if (prior.review_reason) {
      task.review_reason = prior.review_reason;
      if (Object.hasOwn(prior, 'previous_status')) task.previous_status = prior.previous_status;
    }
  }
  result.archived_tasks = [];
  for (const [id, prior] of previous) {
    if (activeAfter.has(id)) continue;
    const task = structuredClone(prior);
    markForReview(task, 'removed_from_current_plan');
    result.archived_tasks.push(task);
  }
  const needed = new Set(result.archived_tasks.flatMap(task => task.source_ids));
  for (const source of oldPlan.sources) {
    if (needed.has(source.id) && !newSources.has(source.id)) result.sources.push(structuredClone(source));
  }
  return result;
}

const escaped = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
const esc = value => String(value).replace(/[&<>"']/g, character => escaped[character]);
const md = value => esc(String(value).replace(/[\r\n]/g, ' ')).replace(/[\\`*_{}\[\]()#+.!|>~-]/g, '\\$&');
const paragraph = text => `<p>${esc(text)}</p>`;
const list = (items, tag = 'ul') => items.length
  ? `<${tag}>${items.map(item => `<li>${item}</li>`).join('')}</${tag}>`
  : '';

function render(applicant, plan) {
  validate(applicant, plan);
  const labels = { ...LABELS, ...plan.ui };
  for (const [key, [english, fallback]] of Object.entries(OPTIONAL_LABELS)) {
    labels[key] ??= applicant.language === 'en' ? english : labels[fallback];
  }
  const active = plan.tasks;
  const archived = plan.archived_tasks ?? [];
  const tasks = byId([...active, ...archived]);
  const sources = byId(plan.sources);
  const completed = new Set(active.filter(task => task.status === 'done').map(task => task.id));
  const ratio = active.length ? completed.size * 100 / active.length : 0;
  const whole = Math.floor(ratio);
  // Preserve the dashboard's existing rounding at exactly half a point.
  const percent = ratio - whole === 0.5 && whole % 2 === 0 ? whole : Math.round(ratio);
  const ordered = active.filter(task => !completed.has(task.id)).sort((first, second) =>
    (first.due_on ?? '9999-12-32').localeCompare(second.due_on ?? '9999-12-32'));
  const nextDue = ordered.find(task => task.due_on);
  const nextActions = ordered.filter(task => ['todo', 'in_progress'].includes(task.status) &&
    !task.waiting_on && task.depends_on.every(id => completed.has(id))).slice(0, 3);
  const phases = new Map();
  for (const task of active) {
    if (!phases.has(task.phase)) phases.set(task.phase, []);
    phases.get(task.phase).push(task);
  }

  const dateHtml = task => task?.due_on
    ? `<time datetime="${task.due_on}">${task.due_on}</time>`
    : esc(labels.no_date);

  function deadlineLines(task) {
    if (!task.due_basis) return [];
    const lines = [`${labels.due_basis}: ${task.due_basis.evidence}`];
    const candidate = deadlineCandidate(task.due_basis);
    if (candidate && !task.due_on) lines.push(`${labels.due_candidate}: ${candidate}`);
    return lines;
  }

  function sourceLink(source) {
    return `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)}</a>`;
  }

  function checkedLine(source) {
    return `${labels.checked}: ${source.checked_on || labels.unverified}`;
  }

  function taskSources(task) {
    const claims = new Map((task.evidence ?? []).map(item => [item.source_id, item.supports]));
    return [...new Set(task.source_ids)].map(id => {
      const source = sources.get(id);
      return { source, supports: claims.get(id) ?? source.supports };
    });
  }

  function taskHtml(task) {
    const dependencies = task.depends_on.map(id => tasks.get(id).title);
    const waiting = task.depends_on.filter(id => !completed.has(id)).map(id => tasks.get(id).title);
    if (task.waiting_on) waiting.unshift(task.waiting_on);
    const blocked = waiting.length && ['todo', 'in_progress'].includes(task.status)
      ? `<span class="blocked">${esc(labels.blocked)}</span>`
      : '';
    const details = [`<p class="task-kind">${esc(labels[task.kind])}</p>`,
      `<p class="task-description">${esc(task.details)}</p>`];
    if (task.due_on) details.push(paragraph(labels[task.due_kind]));
    details.push(...deadlineLines(task).map(paragraph));
    if (dependencies.length) details.push(paragraph(`${labels.dependencies}: ${dependencies.join(', ')}`));
    if (waiting.length && task.status !== 'done') details.push(paragraph(`${labels.waiting_on}: ${waiting.join(', ')}`));
    if (task.review_reason) {
      const reason = applicant.language === 'en' && Object.hasOwn(REVIEW_REASONS, task.review_reason)
        ? REVIEW_REASONS[task.review_reason] : labels.needs_review;
      details.push(paragraph(`${labels.review}: ${reason}`));
    }
    details.push(list(task.notes.map(esc)));
    if (task.verification) details.push(paragraph(labels[task.verification]));
    const citations = taskSources(task).map(({ source, supports }) =>
      `${sourceLink(source)}<br><small>${esc(checkedLine(source))}</small>${supports ? `<div>${esc(supports)}</div>` : ''}`);
    if (citations.length) {
      details.push(`<div class="task-evidence"><h4>${esc(labels.evidence)}</h4>${list(citations)}</div>`);
    }
    return `<article class="task ${task.status}"><details class="task-details">` +
      `<summary class="task-row" id="task-${task.id}"><span class="task-title">${esc(task.title)}${blocked}</span>` +
      `<span class="task-date">${dateHtml(task)}</span><span class="badge">${esc(labels[task.status])}</span></summary>` +
      `<div class="task-body">${details.join('')}</div></details></article>`;
  }

  const values = {
    lang: esc(applicant.language), title: esc(labels.title), name: esc(applicant.display_name),
    destination: esc(applicant.destination), purpose: esc(applicant.purpose),
    progress: esc(labels.progress), count: `${completed.size}/${active.length} ${esc(labels.tasks)}`,
    percent: String(percent), hint: esc(labels.view),
    deadline_label: esc(labels.next_due), deadline: dateHtml(nextDue),
    deadline_kind: nextDue ? esc(labels[nextDue.due_kind]) : '',
    checklist: esc(labels.checklist), source_title: esc(labels.sources),
    next_actions: nextActions.length ? `<section class="next-actions"><h2>${esc(labels.next_actions)}</h2>` +
      list(nextActions.map(task => `<a href="#task-${task.id}">${esc(task.title)}</a>` +
        `<span class="task-date">${dateHtml(task)}</span>`), 'ol') + '</section>' : '',
    sections: [...phases].map(([phase, items]) =>
      `<section class="phase"><h3>${esc(phase)}</h3>${items.map(taskHtml).join('')}</section>`).join(''),
    questions: plan.open_questions.length
      ? `<aside class="questions" aria-labelledby="questions-title"><h2 id="questions-title">${esc(labels.questions)}</h2>` +
        list(plan.open_questions.map(esc)) + '</aside>' : '',
    archived: archived.length
      ? `<section class="phase archived"><h2>${esc(labels.archived)}</h2>${archived.map(taskHtml).join('')}</section>` : '',
    sources: plan.sources.map(source =>
      `<li>${sourceLink(source)}<br><small>${esc(checkedLine(source))}</small></li>`).join(''),
    updated: `${esc(labels.updated)}: ${esc(plan.updated_at ?? '')}`,
  };
  const template = fs.readFileSync(path.join(__dirname, '..', 'templates', 'dashboard.html'), 'utf8');
  const page = template.replace(/\{\{([a-z_]+)\}\}/g, (_, key) => {
    requireThat(Object.hasOwn(values, key), `Unknown dashboard template field: ${key}`);
    return values[key];
  });

  const summary = [
    `# ${md(applicant.display_name)} — ${md(labels.title)}`, '',
    `${md(applicant.destination)} · ${md(applicant.purpose)}`, '',
    `${md(labels.progress)}: ${completed.size}/${active.length} (${percent}%)`, '', md(labels.view), '',
  ];
  if (nextActions.length) {
    summary.push(`## ${md(labels.next_actions)}`, '',
      ...nextActions.map((task, i) => `${i + 1}. ${md(task.title)} · ${md(task.due_on || labels.no_date)}`), '');
  }

  const sourceMarkdown = (source, separator = ' ') =>
    `${md(source.title)}${separator}<${source.url}> — ${md(checkedLine(source))}`;
  for (const [phase, items] of phases) {
    summary.push(`## ${md(phase)}`, '');
    for (const task of items) {
      const dueKind = task.due_on ? ` (${md(labels[task.due_kind])})` : '';
      summary.push(
        `- [${task.status === 'done' ? 'x' : ' '}] ${md(task.title)} (${md(task.id)}; ${md(labels[task.status])}; ${md(labels[task.kind])})`,
        `  ${md(task.details)}`, `  ${md(labels.due)}: ${md(task.due_on || labels.no_date)}${dueKind}`,
      );
      if (task.depends_on.length) summary.push(`  ${md(labels.dependencies)}: ${md(task.depends_on.join(', '))}`);
      summary.push(...deadlineLines(task).map(line => `  ${md(line)}`));
      if (task.waiting_on && task.status !== 'done') summary.push(`  ${md(labels.waiting_on)}: ${md(task.waiting_on)}`);
      if (task.review_reason) summary.push(`  ${md(labels.review)}: ${md(task.review_reason)}`);
      summary.push(...task.notes.map(note => `  ${md(labels.notes)}: ${md(note)}`));
      if (task.verification) summary.push(`  ${md(labels[task.verification])}`);
      for (const { source, supports } of taskSources(task)) {
        summary.push(`  ${md(labels.source)}: ${sourceMarkdown(source)}`);
        if (supports) summary.push(`  ${md(supports)}`);
      }
    }
    summary.push('');
  }
  summary.push(`## ${md(labels.questions)}`, '', ...plan.open_questions.map(question => `- ${md(question)}`));
  if (archived.length) {
    summary.push('', `## ${md(labels.archived)}`, '');
    for (const task of archived) {
      summary.push(`- ${md(task.title)} (${md(task.id)}) — ${md(task.review_reason ?? '')}`,
        ...task.notes.map(note => `  ${md(note)}`));
    }
  }
  summary.push('', `## ${md(labels.sources)}`, '', ...plan.sources.map(source => `- ${sourceMarkdown(source, ': ')}`));
  return [page, summary.join('\n') + '\n'];
}

function caseFile(folder, name) {
  const file = path.join(folder, name);
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  requireThat(!stat || stat.isFile(), `Refusing non-regular case file: ${name}`);
  return file;
}

function save(folder, applicant, plan, backup = false) {
  const now = new Date();
  const savedPlan = { ...plan, updated_at: now.toISOString().replace(/\.\d{3}Z$/, '+00:00') };
  const [page, summary] = render(applicant, savedPlan);
  const files = [json(applicant), json(savedPlan), page, summary];
  for (const name of CASE_FILES) caseFile(folder, name);
  const staging = fs.mkdtempSync(path.join(folder, '.write-'));
  try {
    for (const [index, name] of CASE_FILES.entries()) {
      fs.writeFileSync(path.join(staging, name), files[index], { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    }
    if (backup) {
      const history = path.join(folder, '.history');
      const stat = fs.lstatSync(history, { throwIfNoEntry: false });
      requireThat(!stat || stat.isDirectory(), 'Refusing non-directory case history');
      if (!stat) fs.mkdirSync(history, { mode: 0o700 });
      const stamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      const target = path.join(history, `${stamp}-${randomUUID().slice(0, 8)}`);
      fs.mkdirSync(target, { mode: 0o700 });
      for (const name of CASE_FILES) {
        const file = caseFile(folder, name);
        if (fs.existsSync(file)) fs.copyFileSync(file, path.join(target, name));
      }
    }
    for (const name of CASE_FILES) fs.renameSync(path.join(staging, name), caseFile(folder, name));
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function update(plan, args) {
  requireThat(args.status !== undefined || args.note !== undefined, 'Supply --status or --note');
  const tasks = byId(plan.tasks);
  const task = tasks.get(args.task);
  requireThat(task, 'Task not found in active plan');
  if (args.status !== undefined) {
    requireThat(STATUSES.includes(args.status), 'Invalid status');
    requireThat(task.kind !== 'to_verify' || args.status === 'needs_review',
      'Verify official evidence with replan before completing this task');
    if (args.status === 'done') {
      requireThat(!task.waiting_on, 'Resolve the waiting item in the plan before completing this task');
      requireThat(task.depends_on.every(id => tasks.get(id).status === 'done'),
        'Complete dependencies first or replan incorrect dependencies');
    } else {
      const downstream = new Set([task.id]);
      for (let size = 0; size !== downstream.size;) {
        size = downstream.size;
        for (const dependent of plan.tasks) {
          if (dependent.depends_on.some(id => downstream.has(id))) downstream.add(dependent.id);
        }
      }
      for (const id of downstream) {
        const dependent = tasks.get(id);
        if (id !== task.id && ['done', 'in_progress'].includes(dependent.status)) {
          dependent.previous_status = dependent.status;
          markForReview(dependent, 'requirements_changed');
        }
      }
    }
    task.status = args.status;
    delete task.review_reason;
    delete task.previous_status;
  }
  if (args.note !== undefined) {
    requireThat(nonempty(args.note), 'Note must not be blank');
    task.notes.push(args.note);
  }
}

const COMMANDS = {
  create: { required: ['case-id', 'applicant', 'plan'], optional: ['root'] },
  render: { required: ['case'] },
  update: { required: ['case', 'task'], optional: ['status', 'note'] },
  replan: { required: ['case', 'plan'], optional: ['applicant', 'show-changes'] },
  validate: { required: ['case'] },
};

function main(argv = process.argv.slice(2)) {
  try {
    const [command, ...rest] = argv;
    if (!command || ['--help', '-h'].includes(command) || rest.includes('--help')) {
      console.log('Usage: node visa_case.cjs <create|render|update|replan|validate> [options]');
      for (const [name, { required, optional = [] }] of Object.entries(COMMANDS)) {
        console.log(`  ${name} ${required.map(key => `--${key} <value>`).join(' ')} ${optional.map(key =>
          key === 'show-changes' ? '[--show-changes]' : `[--${key} <value>]`).join(' ')}`.trimEnd());
      }
      return 0;
    }
    requireThat(Object.hasOwn(COMMANDS, command), `Unknown command: ${command}`);
    const { required, optional = [] } = COMMANDS[command];
    const options = Object.fromEntries([...required, ...optional].map(key =>
      [key, { type: key === 'show-changes' ? 'boolean' : 'string' }]));
    const { values: args } = parseArgs({ args: rest, options });
    for (const key of required) requireThat(nonempty(args[key]), `Missing --${key}`);

    if (command === 'create') {
      requireThat(/^[a-z0-9][a-z0-9_-]{0,79}$/.test(args['case-id']), 'Use a safe, opaque case ID');
      const applicant = read(args.applicant);
      const plan = read(args.plan);
      validate(applicant, plan);
      applicant.case_id = args['case-id'];
      const root = path.resolve(args.root ?? 'students');
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      const folder = path.join(fs.realpathSync(root), applicant.case_id);
      fs.mkdirSync(folder, { mode: 0o700 });
      save(folder, applicant, plan);
      console.log(path.join(folder, 'index.html'));
      return 0;
    }

    const folder = fs.realpathSync(args.case);
    let applicant = read(caseFile(folder, 'student.json'));
    let plan = read(caseFile(folder, 'plan.json'));
    validate(applicant, plan);
    if (command === 'validate') {
      console.log('Valid:', folder);
      return 0;
    }
    if (command === 'update') update(plan, args);
    const dashboard = path.join(folder, 'index.html');
    let report;
    if (command === 'replan') {
      const newApplicant = args.applicant ? read(args.applicant) : applicant;
      const newPlan = read(args.plan);
      validate(newApplicant, newPlan);
      requireThat(!Object.hasOwn(newApplicant, 'case_id') || newApplicant.case_id === applicant.case_id,
        'Cannot change case identity');
      newApplicant.case_id = applicant.case_id;
      const metadata = ['display_name', 'language', 'case_id'];
      const factsChanged = [...new Set([...Object.keys(applicant), ...Object.keys(newApplicant)])]
        .some(key => !metadata.includes(key) && different(applicant[key], newApplicant[key]));
      if (args['show-changes']) report = { ...changeReport(plan, newPlan, factsChanged), dashboard };
      plan = merge(plan, newPlan);
      if (factsChanged) {
        for (const task of plan.tasks) markForReview(task, 'applicant_facts_changed');
      }
      applicant = newApplicant;
    }
    save(folder, applicant, plan, true);
    console.log(report ? JSON.stringify(report) : dashboard);
    return 0;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 1;
  }
}

module.exports = { LABELS, read, validate, merge, render, save, main };
if (require.main === module) process.exitCode = main();
