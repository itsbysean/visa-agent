#!/usr/bin/env python3
"""Offline, dependency-free visa case storage and rendering."""
import argparse
import copy
from datetime import date, datetime, timezone
import html
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile
import uuid
from urllib.parse import urlparse

STATUSES = {'todo', 'in_progress', 'done', 'needs_review'}
KINDS = {'official_requirement', 'recommendation', 'to_verify'}
LABELS = {
    'en': dict(title='Visa preparation', progress='Progress', tasks='tasks completed', phases='Preparation stages', questions='Open questions', sources='Official sources', checked='Checked', unverified='Not verified', notes='Notes', due='Due', official='Official deadline', recommended='Recommended date', dependencies='Depends on', archived='Archived tasks — review required', view='To update progress, tell your agent which task is complete.', todo='To do', in_progress='In progress', done='Done', needs_review='Needs review', official_requirement='Official requirement', recommendation='Recommendation', to_verify='To verify', no_date='No date set', updated='Updated', purpose='Purpose', destination='Destination', source='Source', review='Review reason'),
}
OPTIONAL_LABELS = {'next_due', 'checklist'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def valid_date(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        return False
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def validate(applicant, plan):
    require(isinstance(applicant, dict) and isinstance(plan, dict), 'Inputs must be objects')
    require(applicant.get('schema_version') == 1 and plan.get('schema_version') == 1, 'schema_version must be 1')
    for key in ('display_name', 'destination', 'purpose', 'language'):
        require(nonempty(applicant.get(key)), f'Applicant needs {key}')
    require(isinstance(applicant.get('citizenships'), list) and applicant['citizenships'] and all(nonempty(x) for x in applicant['citizenships']), 'citizenships must be a nonempty string list')
    labels = LABELS.get(applicant['language'])
    ui = plan.get('ui', {})
    require(isinstance(ui, dict) and all((k in LABELS['en'] or k in OPTIONAL_LABELS) and nonempty(v) for k, v in ui.items()), 'ui must contain valid label overrides')
    if labels is None:
        require(set(LABELS['en']) <= set(ui), 'Other languages require all ui labels translated; see data contract')
    for key in ('tasks', 'sources', 'open_questions'):
        require(isinstance(plan.get(key), list), f'{key} must be a list')
    require(all(nonempty(q) for q in plan['open_questions']), 'open_questions must contain strings')
    source_ids = set()
    checked = set()
    for source in plan['sources']:
        require(isinstance(source, dict), 'Each source must be an object')
        sid = source.get('id')
        require(nonempty(sid) and sid not in source_ids, 'Source IDs must be unique')
        source_ids.add(sid)
        require(nonempty(source.get('title')), 'Source title required')
        url = urlparse(source.get('url', ''))
        require(url.scheme == 'https' and bool(url.hostname) and not url.username and not url.password, 'Source URL must be https without credentials')
        day = source.get('checked_on')
        require(day is None or (valid_date(day) and day <= date.today().isoformat()), 'Source date must be null or an actual non-future date')
        if day:
            checked.add(sid)
    ids = set()
    tasks = plan['tasks'] + plan.get('archived_tasks', [])
    require(isinstance(plan.get('archived_tasks', []), list), 'archived_tasks must be a list')
    for task in tasks:
        require(isinstance(task, dict), 'Each task must be an object')
        tid = task.get('id')
        require(isinstance(tid, str) and re.fullmatch(r'[a-z0-9][a-z0-9_-]*', tid) and tid not in ids, 'Task IDs must be unique safe identifiers')
        ids.add(tid)
        for key in ('title', 'phase', 'details'):
            require(nonempty(task.get(key)), f'Task {tid} needs {key}')
        require(task.get('status') in STATUSES, f'Invalid status: {tid}')
        require(task.get('kind') in KINDS, f'Invalid kind: {tid}')
        require(isinstance(task.get('source_ids'), list) and all(s in source_ids for s in task['source_ids']), f'Unknown source: {tid}')
        require(isinstance(task.get('depends_on'), list) and all(isinstance(d, str) for d in task['depends_on']), f'Invalid dependencies: {tid}')
        require(isinstance(task.get('notes'), list) and all(isinstance(n, str) for n in task['notes']), f'Invalid notes: {tid}')
        require(task.get('due_on') is None or valid_date(task['due_on']), f'Invalid due date: {tid}')
        require((task.get('due_on') is None and task.get('due_kind') is None) or (task.get('due_on') is not None and task.get('due_kind') in {'official', 'recommended'}), f'Invalid due_kind: {tid}')
        if task['kind'] == 'official_requirement':
            require(bool(set(task['source_ids']) & checked), f'Official requirement needs checked evidence: {tid}')
        if task['kind'] == 'to_verify':
            require(task['status'] == 'needs_review', f'Unverified requirement must need review: {tid}')
    active = {t['id']: t for t in plan['tasks']}
    for task in tasks:
        require(all(d in ids and d != task['id'] for d in task['depends_on']), f'Invalid dependency: {task["id"]}')
    def visit(tid, stack, seen):
        require(tid not in stack, 'Task dependencies contain a cycle')
        if tid in seen:
            return
        for dep in active[tid]['depends_on']:
            require(dep in active, f'Active task {tid} depends on archived task {dep}')
            visit(dep, stack | {tid}, seen)
        seen.add(tid)
    seen = set()
    for tid in active:
        visit(tid, set(), seen)


def merge(old, new):
    """Preserve user state, never silently discard removed or changed work."""
    result = copy.deepcopy(new)
    previous = {t['id']: t for t in old['tasks'] + old.get('archived_tasks', [])}
    current = {t['id'] for t in result['tasks']}
    old_sources = {s['id']: s for s in old['sources']}
    new_sources = {s['id']: s for s in new['sources']}
    def evidence_changed(task):
        return any(
            {k: v for k, v in old_sources.get(sid, {}).items() if k != 'checked_on'} !=
            {k: v for k, v in new_sources.get(sid, {}).items() if k != 'checked_on'}
            for sid in task['source_ids']
        )
    material = ('title', 'phase', 'details', 'kind', 'due_on', 'due_kind', 'depends_on', 'source_ids')
    for task in result['tasks']:
        prior = previous.get(task['id'])
        if prior:
            task['notes'] = list(dict.fromkeys(prior['notes'] + task.get('notes', [])))
            task['status'] = prior['status']
            if evidence_changed(task) or any(prior.get(k) != task.get(k) for k in material) or task['id'] not in {t['id'] for t in old['tasks']}:
                task['previous_status'] = prior['status']
                task['status'] = 'needs_review'
                task['review_reason'] = 'requirements_changed'
            elif task['kind'] == 'to_verify':
                task['status'] = 'needs_review'
            elif prior.get('review_reason'):
                task['review_reason'] = prior['review_reason']
                if 'previous_status' in prior:
                    task['previous_status'] = prior['previous_status']
    result['archived_tasks'] = []
    for tid, task in previous.items():
        if tid not in current:
            archived = copy.deepcopy(task)
            archived.setdefault('previous_status', archived['status'])
            archived['status'] = 'needs_review'
            archived['review_reason'] = 'removed_from_current_plan'
            result['archived_tasks'].append(archived)
    # Retain old citations used by archived work, without dropping historical evidence.
    existing = {s['id'] for s in result['sources']}
    needed = {s for t in result['archived_tasks'] for s in t['source_ids']}
    for source in old['sources']:
        if source['id'] in needed and source['id'] not in existing:
            result['sources'].append(copy.deepcopy(source))
    return result


def render(applicant, plan):
    validate(applicant, plan)
    labels = {**LABELS.get(applicant['language'], LABELS['en']), **plan.get('ui', {})}
    esc = lambda s: html.escape(str(s), quote=True)
    active = plan['tasks']
    done = sum(t['status'] == 'done' for t in active)
    percent = round(done / len(active) * 100) if active else 0
    next_due = min(
        (t for t in active if t['status'] != 'done' and t['due_on']),
        key=lambda t: t['due_on'],
        default=None,
    )
    archived_tasks = plan.get('archived_tasks', [])
    task_titles = {t['id']: t['title'] for t in active + archived_tasks}
    sources = {s['id']: s for s in plan['sources']}
    def link(sid):
        s = sources[sid]
        return f'<a href="{esc(s["url"])}" target="_blank" rel="noopener noreferrer">{esc(s["title"])}</a>'
    def task_html(t):
        due = date_html(t)
        due_kind = f'<p>{esc(labels[t["due_kind"]])}</p>' if t['due_on'] else ''
        dependencies = ', '.join(task_titles[tid] for tid in t['depends_on'])
        deps = f'<p>{esc(labels["dependencies"])}: {esc(dependencies)}</p>' if dependencies else ''
        notes = '<ul>' + ''.join(f'<li>{esc(n)}</li>' for n in t['notes']) + '</ul>' if t['notes'] else ''
        citations = ' · '.join(link(s) for s in t['source_ids'])
        reasons = {'en': {'requirements_changed': 'Requirements or evidence changed.', 'applicant_facts_changed': 'Applicant circumstances changed.', 'removed_from_current_plan': 'Removed from the current plan.'}}
        reason = reasons.get(applicant['language'], {}).get(t.get('review_reason'), labels['needs_review'])
        review = f'<p>{esc(labels["review"])}: {esc(reason)}</p>' if t.get('review_reason') else ''
        source_links = f'<p class="citations">{citations}</p>' if citations else ''
        return (
            f'<article class="task {t["status"]}"><details class="task-details">'
            f'<summary class="task-row"><span class="task-title">{esc(t["title"])}</span>'
            f'<span class="task-date">{due}</span><span class="badge">{esc(labels[t["status"]])}</span></summary>'
            f'<div class="task-body"><p class="task-kind">{esc(labels[t["kind"]])}</p>'
            f'<p class="task-description">{esc(t["details"])}</p>'
            f'{due_kind}{deps}{review}{notes}{source_links}</div></details></article>'
        )

    def date_html(task):
        if task is None or not task['due_on']:
            return esc(labels['no_date'])
        day = esc(task['due_on'])
        return f'<time datetime="{day}">{day}</time>'

    phases = list(dict.fromkeys(t['phase'] for t in active))
    sections = ''.join(
        f'<section class="phase"><h3>{esc(phase)}</h3>'
        + ''.join(task_html(t) for t in active if t['phase'] == phase) + '</section>'
        for phase in phases
    )
    questions = (
        '<aside class="questions" aria-labelledby="questions-title">'
        f'<h2 id="questions-title">{esc(labels["questions"])}</h2><ul>'
        + ''.join(f'<li>{esc(q)}</li>' for q in plan['open_questions']) + '</ul></aside>'
        if plan['open_questions'] else ''
    )
    archived = (
        f'<section class="phase archived"><h2>{esc(labels["archived"])}</h2>'
        + ''.join(task_html(t) for t in archived_tasks) + '</section>'
        if archived_tasks else ''
    )
    source_html = ''.join(f'<li>{link(s["id"])}<br><small>{esc(labels["checked"])}: {esc(s.get("checked_on") or labels["unverified"])}</small></li>' for s in plan['sources'])
    english = applicant['language'] == 'en'
    values = dict(
        lang=esc(applicant['language']), title=esc(labels['title']), name=esc(applicant['display_name']),
        destination=esc(applicant['destination']), purpose=esc(applicant['purpose']),
        progress=esc(labels['progress']), count=f'{done}/{len(active)} {esc(labels["tasks"])}',
        percent=str(percent), hint=esc(labels['view']),
        deadline_label=esc(labels.get('next_due', 'Next deadline' if english else labels['due'])),
        deadline=date_html(next_due),
        deadline_kind=esc(labels[next_due['due_kind']]) if next_due else '',
        checklist=esc(labels.get('checklist', 'Checklist' if english else labels['phases'])),
        sections=sections, questions=questions, archived=archived,
        source_title=esc(labels['sources']), sources=source_html,
        updated=esc(labels['updated']) + ': ' + esc(plan.get('updated_at', '')),
    )
    template = (Path(__file__).resolve().parent.parent / 'templates/dashboard.html').read_text(encoding='utf-8')
    page = re.sub(r'\{\{([a-z_]+)\}\}', lambda m: values[m[1]], template)
    # Escape generated Markdown metacharacters and embedded HTML in user data.
    def md(value):
        value = str(value).replace('\n', ' ').replace('\r', ' ')
        return re.sub(r'([\\`*_{}\[\]()#+.!|>~-])', r'\\\1', html.escape(value))
    summary = [f'# {md(applicant["display_name"])} — {md(labels["title"])}', '', f'{md(applicant["destination"])} · {md(applicant["purpose"])}', '', f'{md(labels["progress"])}: {done}/{len(active)} ({percent}%)', '', md(labels['view']), '']
    for phase in phases:
        summary += ['## ' + md(phase), '']
        for t in active:
            if t['phase'] == phase:
                summary += [f'- [{"x" if t["status"] == "done" else " "}] {md(t["title"])} ({md(t["id"])}; {md(labels[t["status"]])}; {md(labels[t["kind"]])})', f'  {md(t["details"])}', f'  {md(labels["due"])}: {md(t["due_on"] or labels["no_date"])}' + (f' ({md(labels[t["due_kind"]])})' if t['due_on'] else '')]
                summary += [f'  {md(labels["dependencies"])}: {md(", ".join(t["depends_on"]))}'] if t['depends_on'] else []
                summary += [f'  {md(labels["review"])}: {md(t["review_reason"])}'] if t.get('review_reason') else []
                summary += ['  ' + md(labels['notes']) + ': ' + md(n) for n in t['notes']]
                summary += ['  ' + md(labels['source']) + ': <' + sources[s]['url'].replace('>', '%3E').replace('<', '%3C') + '>' for s in t['source_ids']]
        summary.append('')
    summary += ['## ' + md(labels['questions']), ''] + ['- ' + md(q) for q in plan['open_questions']]
    if plan.get('archived_tasks'):
        summary += ['', '## ' + md(labels['archived']), '']
        for t in plan['archived_tasks']:
            summary += [f'- {md(t["title"])} ({md(t["id"])}) — {md(t.get("review_reason", ""))}'] + ['  ' + md(n) for n in t['notes']]
    summary += ['', '## ' + md(labels['sources']), '']
    summary += [f'- {md(s["title"])}: <{s["url"].replace(">", "%3E").replace("<", "%3C")}> — {md(labels["checked"])}: {md(s.get("checked_on") or labels["unverified"])}' for s in plan['sources']]
    return page, '\n'.join(summary) + '\n'


def save(folder, applicant, plan, backup=False):
    plan = copy.deepcopy(plan)
    plan['updated_at'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
    page, summary = render(applicant, plan)  # Validate/render before touching existing records.
    files = {'student.json': json.dumps(applicant, ensure_ascii=False, indent=2) + '\n', 'plan.json': json.dumps(plan, ensure_ascii=False, indent=2) + '\n', 'index.html': page, 'README.md': summary}
    if backup:
        target = folder / '.history' / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + uuid.uuid4().hex[:8])
        target.mkdir(parents=True)
        for name in files:
            if (folder / name).exists():
                shutil.copy2(folder / name, target / name)
    for name, content in files.items():
        require(not (folder / name).is_symlink(), f'Refusing symlink output: {name}')
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=folder, delete=False) as tmp:
            tmp.write(content)
            tmp_path = Path(tmp.name)
        tmp_path.replace(folder / name)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    create = sub.add_parser('create')
    create.add_argument('--root', type=Path, default=Path('students'))
    create.add_argument('--case-id', required=True)
    create.add_argument('--applicant', type=Path, required=True)
    create.add_argument('--plan', type=Path, required=True)
    for cmd in ('render', 'update', 'replan', 'validate'):
        p = sub.add_parser(cmd)
        p.add_argument('--case', type=Path, required=True)
        if cmd == 'update':
            p.add_argument('--task', required=True)
            p.add_argument('--status', choices=sorted(STATUSES))
            p.add_argument('--note')
        if cmd == 'replan':
            p.add_argument('--plan', type=Path, required=True)
            p.add_argument('--applicant', type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == 'create':
            require(bool(re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,79}', args.case_id)), 'Use a safe, opaque case ID')
            applicant, plan = read(args.applicant), read(args.plan)
            applicant['case_id'] = args.case_id
            validate(applicant, plan)
            folder = args.root.resolve() / args.case_id
            folder.mkdir(parents=True, exist_ok=False)
            save(folder, applicant, plan)
        else:
            folder = args.case.resolve()
            applicant, plan = read(folder / 'student.json'), read(folder / 'plan.json')
            validate(applicant, plan)
            if args.command == 'validate':
                print('Valid:', folder)
                return 0
            if args.command == 'update':
                require(args.status is not None or args.note is not None, 'Supply --status or --note')
                matches = [t for t in plan['tasks'] if t['id'] == args.task]
                require(len(matches) == 1, 'Task not found in active plan')
                task = matches[0]
                if args.status:
                    require(task['kind'] != 'to_verify' or args.status == 'needs_review', 'Verify official evidence with replan before completing this task')
                    if args.status == 'done':
                        by_id = {t['id']: t for t in plan['tasks']}
                        require(all(by_id[d]['status'] == 'done' for d in task['depends_on']), 'Complete dependencies first or replan incorrect dependencies')
                    if args.status != 'done':
                        affected = {task['id']}
                        while True:
                            added = {t['id'] for t in plan['tasks'] if set(t['depends_on']) & affected} - affected
                            if not added:
                                break
                            affected |= added
                        for dependent in plan['tasks']:
                            if dependent['id'] in affected - {task['id']} and dependent['status'] in {'done', 'in_progress'}:
                                dependent['previous_status'] = dependent['status']
                                dependent['status'] = 'needs_review'
                                dependent['review_reason'] = 'requirements_changed'
                    task['status'] = args.status
                    task.pop('review_reason', None)
                    task.pop('previous_status', None)
                if args.note is not None:
                    require(nonempty(args.note), 'Note must not be blank')
                    task['notes'].append(args.note)
            if args.command == 'replan':
                new_applicant = read(args.applicant) if args.applicant else applicant
                require(new_applicant.get('case_id', applicant.get('case_id')) == applicant.get('case_id'), 'Cannot change case identity')
                new_applicant['case_id'] = applicant['case_id']
                new_plan = read(args.plan)
                validate(new_applicant, new_plan)
                plan = merge(plan, new_plan)
                # A changed applicant fact can change applicability even if task text did not change.
                material = {k for k in set(applicant) | set(new_applicant) if k not in {'display_name', 'language', 'case_id'}}
                if any(applicant.get(k) != new_applicant.get(k) for k in material):
                    for task in plan['tasks']:
                        task.setdefault('previous_status', task['status'])
                        task['status'] = 'needs_review'
                        task['review_reason'] = 'applicant_facts_changed'
                applicant = new_applicant
            save(folder, applicant, plan, backup=True)
        print(folder / 'index.html')
        return 0
    except (ValueError, OSError, KeyError, TypeError, RecursionError) as exc:
        print(f'Error: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
