import copy
import importlib.util
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
