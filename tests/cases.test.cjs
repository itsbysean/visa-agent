'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const skill = path.join(__dirname, '../skills/visa-agent');
const script = path.join(skill, 'scripts/visa_case.cjs');
const { LABELS, read, validate, merge, render } = require(script);
const text = file => fs.readFileSync(file, 'utf8');

function fixtures() {
  return {
    applicant: read(path.join(skill, 'examples/applicant.json')),
    plan: read(path.join(skill, 'examples/plan.json')),
  };
}

function run(command, ...args) {
  const result = spawnSync(process.execPath, [script, command, ...args], { encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

function workspace(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'visa-case-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { applicant, plan } = fixtures();
  function draft(name, value) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  }
  function createArgs(id) {
    return ['--root', path.join(dir, 'custom output'), '--case-id', id,
      '--applicant', draft('applicant.json', applicant), '--plan', draft('draft.json', plan)];
  }
  function create(id = 'case-001') {
    const result = run('create', ...createArgs(id));
    assert.equal(result.status, 0, result.stderr);
    return path.dirname(result.stdout.trim());
  }
  return { applicant, plan, dir, draft, create, createArgs };
}

test('creates offline views and refuses to overwrite a case', t => {
  const { create, createArgs } = workspace(t);
  const folder = create();
  assert.deepEqual(fs.readdirSync(folder).sort(), ['README.md', 'index.html', 'plan.json', 'student.json']);
  const dashboard = text(path.join(folder, 'index.html'));
  assert.match(dashboard, /Not verified/);
  assert.match(dashboard, /No date set/);
  assert.doesNotMatch(dashboard, /<script|\{\{/);
  const plan = path.join(folder, 'plan.json');
  const before = text(plan);
  assert.equal(run('create', ...createArgs('case-001')).status, 1);
  assert.equal(text(plan), before);
  assert.equal(run('validate', '--case', folder).status, 0);
});

test('updates a case and backs up its previous files without refreshing source dates', t => {
  const { create } = workspace(t);
  const folder = create();
  const planFile = path.join(folder, 'plan.json');
  const previousPlan = text(planFile);
  const result = run('update', '--case', folder, '--task', 'confirm-course', '--status', 'done', '--note', 'School confirmed');
  assert.equal(result.status, 0, result.stderr);
  const plan = read(planFile);
  assert.equal(plan.tasks[0].status, 'done');
  assert.deepEqual(plan.tasks[0].notes, ['School confirmed']);
  assert.equal(plan.sources[0].checked_on, null);
  const history = path.join(folder, '.history');
  const backups = fs.readdirSync(history);
  assert.equal(backups.length, 1);
  assert.equal(text(path.join(history, backups[0], 'plan.json')), previousPlan);
  assert.match(text(path.join(folder, 'index.html')), /33%/);
});

test('reads existing version 1 JSON and regenerates the dashboard', t => {
  const { dir, applicant, plan } = workspace(t);
  applicant.case_id = 'existing-case';
  plan.updated_at = '2025-02-01T12:30:00+00:00';
  Object.assign(plan.tasks[0], { status: 'done', notes: ['Prior progress · 證拠'] });
  fs.writeFileSync(path.join(dir, 'student.json'), JSON.stringify(applicant, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
  const result = run('render', '--case', dir);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(read(path.join(dir, 'student.json')), applicant);
  assert.deepEqual(read(path.join(dir, 'plan.json')).tasks, plan.tasks);
  assert.match(text(path.join(dir, 'index.html')), /Prior progress · 證拠/);
});

test('unverified, waiting, and dependent tasks cannot be completed', t => {
  const { create, plan } = workspace(t);
  plan.tasks[0].waiting_on = 'Confirm the school';
  const folder = create();
  for (const task of plan.tasks) {
    assert.equal(run('update', '--case', folder, '--task', task.id, '--status', 'done').status, 1);
  }
  assert.equal(fs.existsSync(path.join(folder, '.history')), false);
});

test('merge keeps notes and completion while archiving removed tasks', () => {
  const { applicant, plan } = fixtures();
  const next = structuredClone(plan);
  next.tasks = [next.tasks[0]];
  Object.assign(plan.tasks[0], { status: 'done', notes: ['retain me'] });
  const result = merge(plan, next);
  assert.equal(result.tasks[0].status, 'done');
  assert.deepEqual(result.tasks[0].notes, ['retain me']);
  assert.equal(result.archived_tasks.length, 2);
  assert.ok(result.archived_tasks.every(task => task.status === 'needs_review'));
  for (const output of render(applicant, result)) assert.match(output, /Archived tasks/);
});

test('changed instructions or source content preserve prior completion for review', () => {
  const { plan } = fixtures();
  Object.assign(plan.tasks[0], { status: 'done', source_ids: ['inz-discovery'] });
  for (const change of [
    next => { next.tasks[0].details = 'New conditions'; },
    next => { next.sources[0].url = 'https://www.immigration.govt.nz/new-route'; },
  ]) {
    const next = structuredClone(plan);
    change(next);
    assert.equal(merge(plan, next).tasks[0].status, 'needs_review');
    assert.equal(merge(plan, next).tasks[0].previous_status, 'done');
  }
});

test('changed applicant facts mark existing tasks for review', t => {
  const { create, applicant, plan, draft } = workspace(t);
  const folder = create();
  const result = run('replan', '--case', folder, '--applicant',
    draft('new-app.json', { ...applicant, destination: 'Canada' }), '--plan', draft('new-plan.json', plan));
  assert.equal(result.status, 0, result.stderr);
  const saved = read(path.join(folder, 'plan.json'));
  assert.ok(saved.tasks.every(task => task.status === 'needs_review'));
});

test('official requirements need checked evidence and dependencies cannot form a cycle', () => {
  const { applicant, plan } = fixtures();
  const first = plan.tasks[0];
  first.kind = 'official_requirement';
  assert.throws(() => validate(applicant, plan), /needs checked evidence/);
  first.source_ids = ['inz-discovery'];
  plan.sources[0].checked_on = '2025-01-30';
  validate(applicant, plan);
  first.depends_on = ['plan-arrival'];
  assert.throws(() => validate(applicant, plan), /cycle/);
});

test('rejects unsafe source links and escapes user text in HTML and Markdown', () => {
  const { applicant, plan } = fixtures();
  applicant.display_name = '<script>alert(1)</script> [click](javascript:bad)';
  plan.tasks[0].notes = ['<img src=x onerror=alert(1)>'];
  const [page, summary] = render(applicant, plan);
  assert.doesNotMatch(page, /<script>|<img/);
  assert.match(page, /&lt;script&gt;/);
  assert.doesNotMatch(summary, /\[click\]\(javascript:/);
  for (const url of ['javascript:alert(1)', 'https://user:pass@example.org/', 'https://example.org/>']) {
    plan.sources[0].url = url;
    assert.throws(() => render(applicant, plan), /Source URL/);
  }
});

test('separates multiple cases, including non-study cases', t => {
  const { create, applicant, plan } = workspace(t);
  applicant.purpose = 'Work';
  plan.tasks = [{ ...plan.tasks[0], id: 'confirm-employer', phase: 'Work preparation' }];
  const first = create('work-001');
  const second = create('work-002');
  assert.equal(run('update', '--case', first, '--task', 'confirm-employer', '--status', 'done').status, 0);
  assert.equal(read(path.join(second, 'plan.json')).tasks[0].status, 'todo');
  assert.match(text(path.join(first, 'index.html')), /Visa preparation/);
  assert.equal(read(path.join(first, 'student.json')).purpose, 'Work');
});

test('non-English cases require translated labels', () => {
  const { applicant, plan } = fixtures();
  applicant.language = 'vi';
  assert.throws(() => validate(applicant, plan), /require all ui labels/);
  plan.ui = Object.fromEntries(Object.keys(LABELS).map(key => [key, 'localized ' + key]));
  assert.match(render(applicant, plan)[0], /lang="vi"/);
});

test('deadline summary uses the earliest outstanding dated task', () => {
  const { applicant, plan } = fixtures();
  Object.assign(plan.tasks[0], { status: 'done', due_on: '2030-01-01', due_kind: 'recommended' });
  Object.assign(plan.tasks[1], { due_on: '2030-03-01', due_kind: 'recommended' });
  Object.assign(plan.tasks[2], { due_on: '2030-02-01', due_kind: 'official' });
  const [page] = render(applicant, plan);
  const overview = page.split('<div class="overview">')[1].split('<section')[0];
  assert.match(overview, /<time datetime="2030-02-01">2030-02-01<\/time>/);
  assert.match(overview, /Official deadline/);
  assert.doesNotMatch(overview, /2030-01-01|2030-03-01/);
});

test('relative date remains a candidate until assigned and clamps a leap-year month end', () => {
  const { applicant, plan } = fixtures();
  const task = plan.tasks[0];
  task.due_basis = { evidence: 'Sample notice', anchor_on: '2028-01-31', offset: 1, unit: 'months' };
  const [page, summary] = render(applicant, plan);
  assert.match(page, /Possible deadline — verify before relying on it: 2028-02-29/);
  assert.match(summary, /Sample notice/);
  assert.doesNotMatch(page, /<time datetime="2028-02-29">/);
  Object.assign(task, { due_on: '2028-03-01', due_kind: 'official' });
  assert.throws(() => validate(applicant, plan), /differs from deadline calculation/);
  task.due_on = '2028-02-29';
  assert.match(render(applicant, plan)[0], /<time datetime="2028-02-29">/);
  assert.doesNotMatch(render(applicant, plan)[0], /Possible deadline/);
});

test('shows at most three ready tasks in deadline order', () => {
  const { applicant, plan } = fixtures();
  const [completed] = plan.tasks;
  completed.status = 'done';
  const example = { ...completed, status: 'todo', depends_on: [completed.id] };
  plan.tasks.push(
    { ...example, id: 'later', due_on: '2030-02-01', due_kind: 'recommended' },
    { ...example, id: 'undated' },
    { ...example, id: 'waiting', waiting_on: 'Applicant must confirm a date' },
    { ...example, id: 'earliest', due_on: '2030-01-01', due_kind: 'official' },
    { ...example, id: 'fourth' },
  );
  const [page] = render(applicant, plan);
  const actions = page.split('<section class="next-actions">')[1].split('</section>')[0];
  assert.deepEqual([...actions.matchAll(/href="#task-([^"]+)"/g)].map(match => match[1]), ['earliest', 'later', 'undated']);
  assert.match(page, /Waiting on: Applicant must confirm a date/);
});

test('cross-check requires distinct checked pages and renders descriptions and dates', () => {
  const { applicant, plan } = fixtures();
  const task = plan.tasks[1];
  Object.assign(task, { kind: 'official_requirement', status: 'todo', verification: 'cross_checked' });
  const [source] = plan.sources;
  source.checked_on = '2025-01-30';
  const second = { ...source, id: 'second-guide', url: source.url + '?view=print#health' };
  plan.sources.push(second);
  task.source_ids.push(second.id);
  task.evidence = [
    { source_id: source.id, supports: 'Synthetic route condition' },
    { source_id: second.id, supports: 'Synthetic applicability condition <example>' },
  ];
  assert.throws(() => validate(applicant, plan), /2 distinct checked evidence/);
  Object.assign(second, { url: source.url + 'health', checked_on: null });
  assert.throws(() => validate(applicant, plan), /2 distinct checked evidence/);
  second.checked_on = source.checked_on;
  const [page, summary] = render(applicant, plan);
  assert.match(page, /Cross-checked/);
  assert.match(page, /Checked: 2025-01-30/);
  assert.match(page, /&lt;example&gt;/);
  assert.match(summary, /Synthetic route condition/);
  task.verification = 'single_source';
  assert.throws(() => validate(applicant, plan), /must cite one checked evidence/);
  task.evidence.pop();
  assert.match(render(applicant, plan)[0], /Single official source/);
});

test('replan emits material changes, omits check date refresh and saves prior state', t => {
  const { create, plan, draft } = workspace(t);
  const folder = create();
  plan.sources[0].checked_on = '2025-01-30';
  Object.assign(plan.tasks[0], { due_on: '2030-01-02', due_kind: 'recommended' });
  plan.tasks.pop();
  plan.open_questions.push('Confirm the new date');
  const result = run('replan', '--case', folder, '--plan', draft('new.json', plan), '--show-changes');
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.dashboard, path.join(folder, 'index.html'));
  assert.deepEqual(report.sources, []);
  assert.deepEqual(report.questions_added, ['Confirm the new date']);
  assert.deepEqual(report.tasks.map(task => task.change), ['review', 'archived']);
  assert.deepEqual(report.tasks[0].fields.due_on, { before: null, after: '2030-01-02' });
  const saved = read(path.join(folder, 'plan.json'));
  assert.equal(saved.tasks[0].status, 'needs_review');
  assert.equal(saved.archived_tasks[0].id, 'plan-arrival');
});

test('invalid replan leaves case files untouched', t => {
  const { create, plan, draft } = workspace(t);
  const folder = create();
  const file = path.join(folder, 'plan.json');
  const before = text(file);
  plan.tasks[0].depends_on = ['missing'];
  assert.equal(run('replan', '--case', folder, '--plan', draft('bad.json', plan)).status, 1);
  assert.equal(text(file), before);
  assert.equal(fs.existsSync(path.join(folder, '.history')), false);
});

test('reopening a prerequisite moves completed dependent work to review', t => {
  const { create, plan } = workspace(t);
  plan.tasks = [plan.tasks[0], { ...plan.tasks[2], depends_on: ['confirm-course'] }];
  for (const task of plan.tasks) task.status = 'done';
  const folder = create();
  const result = run('update', '--case', folder, '--task', 'confirm-course', '--status', 'todo');
  assert.equal(result.status, 0, result.stderr);
  const updated = read(path.join(folder, 'plan.json')).tasks[1];
  assert.equal(updated.status, 'needs_review');
  assert.equal(updated.previous_status, 'done');
});

test('refuses traversal in case IDs and symbolic links used as case files', t => {
  const { create, createArgs, dir } = workspace(t);
  assert.equal(run('create', ...createArgs('../escape')).status, 1);
  const folder = create();
  const original = path.join(folder, 'plan.json');
  const other = path.join(dir, 'other-plan.json');
  fs.renameSync(original, other);
  fs.symlinkSync(other, original);
  const before = text(other);
  const result = run('render', '--case', folder);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing non-regular case file/);
  assert.equal(text(other), before);
});
