import copy
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from datetime import date

ROOT = Path(__file__).resolve().parents[1] / 'skills' / 'visa-agent'
spec = importlib.util.spec_from_file_location('visa_case', ROOT / 'scripts/visa_case.py')
visa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(visa)


class CaseTests(unittest.TestCase):
    def setUp(self):
        self.app = visa.read(ROOT / 'examples/applicant.json')
        self.plan = visa.read(ROOT / 'examples/plan.json')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def draft(self, name, value):
        p = self.root / name
        p.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
        return str(p)

    def create(self, root=None, case_id='case-001', app=None, plan=None):
        dest = root or self.root / 'custom-output'
        rc = visa.main(['create', '--root', str(dest), '--case-id', case_id, '--applicant', self.draft('app.json', app or self.app), '--plan', self.draft('input.json', plan or self.plan)])
        self.assertEqual(rc, 0)
        return dest / case_id

    def test_create_custom_root_offline_view_and_duplicate_refusal(self):
        folder = self.create()
        for name in ('student.json', 'plan.json', 'README.md', 'index.html'):
            self.assertTrue((folder / name).is_file())
        page = (folder / 'index.html').read_text()
        self.assertIn('Not verified', page)
        self.assertIn('No date set', page)
        self.assertNotIn('<script', page)
        self.assertNotIn('{{', page)
        before = (folder / 'plan.json').read_bytes()
        rc = visa.main(['create', '--root', str(folder.parent), '--case-id', folder.name, '--applicant', str(self.root / 'app.json'), '--plan', str(self.root / 'input.json')])
        self.assertEqual(rc, 1)
        self.assertEqual(before, (folder / 'plan.json').read_bytes())

    def test_update_preserves_research_dates_and_creates_backup(self):
        folder = self.create()
        rc = visa.main(['update', '--case', str(folder), '--task', 'confirm-course', '--status', 'done', '--note', 'School confirmed'])
        self.assertEqual(rc, 0)
        plan = visa.read(folder / 'plan.json')
        self.assertEqual(plan['tasks'][0]['status'], 'done')
        self.assertIn('School confirmed', plan['tasks'][0]['notes'])
        self.assertIsNone(plan['sources'][0]['checked_on'])
        self.assertEqual(len(list((folder / '.history').glob('*/plan.json'))), 1)
        self.assertIn('33%', (folder / 'index.html').read_text())

    def test_unverified_and_blocked_tasks_cannot_complete(self):
        folder = self.create()
        for task in ('verify-visa-route', 'plan-arrival'):
            self.assertEqual(visa.main(['update', '--case', str(folder), '--task', task, '--status', 'done']), 1)
        self.assertFalse((folder / '.history').exists())

    def test_replan_retains_completion_notes_and_archives_removed_work(self):
        old = copy.deepcopy(self.plan)
        old['tasks'][0]['status'] = 'done'
        old['tasks'][0]['notes'] = ['retain me']
        new = copy.deepcopy(self.plan)
        new['tasks'] = new['tasks'][:1]
        result = visa.merge(old, new)
        visa.validate(self.app, result)
        self.assertEqual(result['tasks'][0]['status'], 'done')
        self.assertEqual(result['tasks'][0]['notes'], ['retain me'])
        self.assertEqual(len(result['archived_tasks']), 2)
        self.assertTrue(all(t['status'] == 'needs_review' for t in result['archived_tasks']))
        page, summary = visa.render(self.app, result)
        self.assertIn('Archived tasks', page)
        self.assertIn('Archived tasks', summary)

    def test_changed_requirement_needs_review_retains_prior_completion(self):
        self.plan['tasks'][0]['status'] = 'done'
        new = copy.deepcopy(self.plan)
        new['tasks'][0]['details'] = 'New conditions'
        result = visa.merge(self.plan, new)
        self.assertEqual(result['tasks'][0]['status'], 'needs_review')
        self.assertEqual(result['tasks'][0]['previous_status'], 'done')

    def test_context_change_marks_even_unchanged_tasks_for_review(self):
        folder = self.create()
        self.app['destination'] = 'Canada'
        rc = visa.main(['replan', '--case', str(folder), '--applicant', self.draft('new-app.json', self.app), '--plan', self.draft('new-plan.json', self.plan)])
        self.assertEqual(rc, 0)
        self.assertTrue(all(t['status'] == 'needs_review' for t in visa.read(folder / 'plan.json')['tasks']))

    def test_official_evidence_and_dependency_validation(self):
        self.plan['tasks'][0]['kind'] = 'official_requirement'
        with self.assertRaises(ValueError):
            visa.validate(self.app, self.plan)
        self.plan['tasks'][0]['source_ids'] = ['inz-discovery']
        self.plan['sources'][0]['checked_on'] = date.today().isoformat()
        visa.validate(self.app, self.plan)
        self.plan['tasks'][0]['depends_on'] = ['plan-arrival']
        with self.assertRaises(ValueError):
            visa.validate(self.app, self.plan)

    def test_html_and_markdown_escape_user_text(self):
        self.app['display_name'] = '<script>alert(1)</script> [click](javascript:bad)'
        self.plan['tasks'][0]['notes'] = ['<img src=x onerror=alert(1)>']
        page, summary = visa.render(self.app, self.plan)
        self.assertNotIn('<script>', page)
        self.assertNotIn('<img', page)
        self.assertIn('&lt;script&gt;', page)
        self.assertNotIn('[click](javascript:', summary)
        self.plan['sources'][0]['url'] = 'javascript:alert(1)'
        with self.assertRaises(ValueError):
            visa.render(self.app, self.plan)

    def test_nonstudy_english_and_case_isolation(self):
        self.app.update(purpose='Work', language='en', employer='Example employer')
        self.plan['tasks'] = [dict(self.plan['tasks'][0], id='confirm-employer', title='Confirm employer and role', phase='Work preparation', details='Record the job offer and research the official work route.', depends_on=[])]
        first = self.create(case_id='work-001')
        second = self.create(case_id='work-002')
        visa.main(['update', '--case', str(first), '--task', 'confirm-employer', '--status', 'done'])
        self.assertEqual(visa.read(second / 'plan.json')['tasks'][0]['status'], 'todo')
        self.assertIn('Visa preparation', (first / 'index.html').read_text())
        self.assertEqual(visa.read(first / 'student.json')['purpose'], 'Work')

    def test_other_languages_require_translated_labels(self):
        self.app['language'] = 'vi'
        with self.assertRaises(ValueError):
            visa.validate(self.app, self.plan)
        self.plan['ui'] = {k: 'localized ' + k for k in visa.LABELS['en']}
        visa.validate(self.app, self.plan)
        self.assertIn('lang="vi"', visa.render(self.app, self.plan)[0])

    def test_dashboard_summarizes_earliest_outstanding_deadline(self):
        first, second, third = self.plan['tasks']
        first.update(status='done', due_on='2030-01-01', due_kind='recommended')
        second.update(due_on='2030-03-01', due_kind='recommended')
        third.update(due_on='2030-02-01', due_kind='official')
        page, _ = visa.render(self.app, self.plan)
        overview = page.split('<div class="overview">', 1)[1].split('<section', 1)[0]
        self.assertIn('<time datetime="2030-02-01">2030-02-01</time>', overview)
        self.assertIn('Official deadline', overview)
        self.assertNotIn('2030-01-01', overview)
        self.assertNotIn('2030-03-01', overview)

    def test_relative_deadline_is_a_candidate_until_assigned(self):
        task = self.plan['tasks'][0]
        task['due_basis'] = {
            'evidence': 'Sample notice anchored to January 31',
            'anchor_on': '2028-01-31', 'offset': 1, 'unit': 'months',
        }
        page, summary = visa.render(self.app, self.plan)
        self.assertIn('Possible deadline — verify before relying on it: 2028-02-29', page)
        self.assertIn('Sample notice anchored to January 31', summary)
        self.assertNotIn('<time datetime="2028-02-29">', page)
        task.update(due_on='2028-03-01', due_kind='official')
        with self.assertRaisesRegex(ValueError, 'differs from deadline calculation'):
            visa.validate(self.app, self.plan)
        task['due_on'] = '2028-02-29'
        page, _ = visa.render(self.app, self.plan)
        self.assertIn('<time datetime="2028-02-29">', page)
        self.assertNotIn('Possible deadline', page)

    def test_next_actions_exclude_waiting_and_show_three_in_date_order(self):
        completed, review, dependent = self.plan['tasks']
        completed['status'] = 'done'
        example = dict(completed, status='todo', depends_on=[completed['id']])
        self.plan['tasks'].extend([
            dict(example, id='later', due_on='2030-02-01', due_kind='recommended'),
            dict(example, id='undated'),
            dict(example, id='waiting', waiting_on='Applicant must confirm a date'),
            dict(example, id='earliest', due_on='2030-01-01', due_kind='official'),
            dict(example, id='fourth'),
        ])
        page, _ = visa.render(self.app, self.plan)
        actions = page.split('<section class="next-actions">')[1].split('</section>')[0]
        self.assertLess(actions.index('#task-earliest'), actions.index('#task-later'))
        self.assertLess(actions.index('#task-later'), actions.index('#task-undated'))
        self.assertEqual(actions.count('<li>'), 3)
        for task in (review['id'], dependent['id'], 'waiting', 'fourth', completed['id']):
            self.assertNotIn(f'#task-{task}"', actions)
        self.assertIn('Waiting on: Applicant must confirm a date', page)

    def test_cross_checked_evidence_requires_distinct_checked_pages_and_renders_claims(self):
        task = self.plan['tasks'][1]
        task.update(kind='official_requirement', status='todo', verification='cross_checked')
        checked_on = date.today().isoformat()
        source = self.plan['sources'][0]
        source['checked_on'] = checked_on
        second = dict(source, id='second-guide', url=source['url'] + '?view=print#health')
        self.plan['sources'].append(second)
        task['source_ids'].append(second['id'])
        task['evidence'] = [
            {'source_id': source['id'], 'supports': 'Synthetic route condition'},
            {'source_id': second['id'], 'supports': 'Synthetic applicability condition <example>'},
        ]
        with self.assertRaisesRegex(ValueError, '2 distinct checked evidence'):
            visa.validate(self.app, self.plan)
        second.update(url=source['url'] + 'health', checked_on=None)
        with self.assertRaisesRegex(ValueError, '2 distinct checked evidence'):
            visa.validate(self.app, self.plan)
        second['checked_on'] = checked_on
        page, summary = visa.render(self.app, self.plan)
        self.assertIn('Cross-checked', page)
        self.assertIn(f'Checked: {checked_on}', page)
        self.assertIn('Synthetic applicability condition &lt;example&gt;', page)
        self.assertIn('Synthetic route condition', summary)
        task['verification'] = 'single_source'
        with self.assertRaisesRegex(ValueError, 'must cite one checked evidence'):
            visa.validate(self.app, self.plan)
        task['evidence'].pop()
        self.assertIn('Single official source', visa.render(self.app, self.plan)[0])

    def test_replan_reports_material_changes_and_ignores_check_date_refresh(self):
        folder = self.create()
        new = copy.deepcopy(self.plan)
        new['sources'][0]['checked_on'] = date.today().isoformat()
        new['tasks'][0].update(due_on='2030-01-02', due_kind='recommended')
        new['tasks'].pop()
        new['open_questions'].append('Confirm the new date')
        stdout = io.StringIO()
        with redirect_stdout(stdout):
            rc = visa.main(['replan', '--case', str(folder), '--plan', self.draft('new.json', new), '--show-changes'])
        self.assertEqual(rc, 0)
        report = json.loads(stdout.getvalue())
        self.assertEqual(report['dashboard'], str((folder / 'index.html').resolve()))
        self.assertEqual(report['sources'], [])
        self.assertEqual(report['questions_added'], ['Confirm the new date'])
        self.assertEqual([t['change'] for t in report['tasks']], ['review', 'archived'])
        self.assertEqual(report['tasks'][0]['fields']['due_on'], {'before': None, 'after': '2030-01-02'})
        saved = visa.read(folder / 'plan.json')
        self.assertEqual(saved['tasks'][0]['status'], 'needs_review')
        self.assertEqual(saved['archived_tasks'][0]['id'], 'plan-arrival')

    def test_invalid_replan_does_not_touch_records(self):
        folder = self.create()
        before = (folder / 'plan.json').read_bytes()
        self.plan['tasks'][0]['depends_on'] = ['missing']
        rc = visa.main(['replan', '--case', str(folder), '--plan', self.draft('invalid.json', self.plan)])
        self.assertEqual(rc, 1)
        self.assertEqual(before, (folder / 'plan.json').read_bytes())

    def test_evidence_change_requires_review_even_when_source_id_stays(self):
        self.plan['tasks'][0]['source_ids'] = ['inz-discovery']
        self.plan['tasks'][0]['status'] = 'done'
        new = copy.deepcopy(self.plan)
        new['sources'][0]['url'] = 'https://www.immigration.govt.nz/new-route'
        result = visa.merge(self.plan, new)
        self.assertEqual(result['tasks'][0]['status'], 'needs_review')
        self.assertEqual(result['tasks'][0]['previous_status'], 'done')

    def test_reopened_prerequisite_invalidates_completed_dependants(self):
        self.plan['tasks'] = [self.plan['tasks'][0], dict(self.plan['tasks'][2], depends_on=['confirm-course'])]
        for task in self.plan['tasks']:
            task['status'] = 'done'
        folder = self.create()
        self.assertEqual(visa.main(['update', '--case', str(folder), '--task', 'confirm-course', '--status', 'todo']), 0)
        updated = visa.read(folder / 'plan.json')['tasks'][1]
        self.assertEqual(updated['status'], 'needs_review')
        self.assertEqual(updated['previous_status'], 'done')

    def test_safe_case_identifier(self):
        rc = visa.main(['create', '--root', str(self.root), '--case-id', '../escape', '--applicant', self.draft('a.json', self.app), '--plan', self.draft('p.json', self.plan)])
        self.assertEqual(rc, 1)


if __name__ == '__main__':
    unittest.main()
