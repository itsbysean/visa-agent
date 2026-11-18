#!/usr/bin/env python3
"""Build the static GitHub Pages website, synthetic demo and downloadable bundles."""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / 'skills/visa-agent'


def zip_tree(source, output, prefix=''):
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source.rglob('*')):
            rel = path.relative_to(source)
            if not path.is_file() or any(p in {'.git', '.history', '__pycache__', 'node_modules', 'dist', 'evidence', 'test-results', 'playwright-report'} for p in rel.parts):
                continue
            if 'preview' in rel.parts or path.suffix in {'.zip', '.pyc'}:
                continue
            archive.write(path, str(Path(prefix) / rel))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', default='', help='Actual public GitHub owner/repository (optional)')
    args = parser.parse_args()
    if args.repository and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]+', args.repository):
        parser.error('Use owner/repository format')
    if args.repository.endswith(('/.', '/..')):
        parser.error('Invalid repository name')
    output = ROOT / 'dist'
    output.mkdir(exist_ok=True)
    for source in (ROOT / 'website').iterdir():
        if source.is_file():
            shutil.copy2(source, output / source.name)
    (output / '.nojekyll').touch()
    (output / 'site-config.js').write_text('window.VISA_AGENT_CONFIG = ' + json.dumps({'repository': args.repository}) + ';\n', encoding='utf-8')
    module = importlib.util.spec_from_file_location('visa_case', SKILL / 'scripts/visa_case.py')
    visa = importlib.util.module_from_spec(module)
    module.loader.exec_module(visa)
    applicant = visa.read(SKILL / 'examples/applicant.json')
    applicant['case_id'] = 'nz-study-demo'
    plan = visa.read(SKILL / 'examples/plan.json')
    plan['tasks'][0]['status'] = 'done'
    plan['tasks'][0]['notes'] = ['Synthetic demo: the applicant reported that the school and course are confirmed.']
    plan['tasks'][1].update(verification='needs_review', evidence=[{
        'source_id': 'inz-discovery',
        'supports': 'Starting point for official research. Visa requirements have not been checked in this sample.',
    }])
    # Show how a suggested date looks without presenting it as an official deadline.
    plan['tasks'][2].update(due_on='2027-02-15', due_kind='recommended', depends_on=['confirm-course'])
    plan['tasks'][2]['details'] = 'List accommodation and transport options. Wait for confirmed dates and conditions before booking.'
    plan['tasks'][2]['due_basis'] = {'evidence': 'Fictional planning target for comparing arrival options.'}
    translations = (ROOT / 'website/translations.js').read_text(encoding='utf-8')
    locales = json.loads(translations.removeprefix('window.VISA_AGENT_LOCALES = ').removesuffix(';\n'))
    for language, locale in locales.items():
        localized_applicant = json.loads(json.dumps(applicant))
        localized_plan = json.loads(json.dumps(plan))
        if language != 'en':
            demo_text = locale['demo']
            localized_applicant.update(language=language, display_name=demo_text['name'], destination=demo_text['destination'], purpose=demo_text['purpose'], age_band=demo_text['age'])
            localized_plan['ui'] = demo_text['ui']
            localized_plan['sources'][0]['title'] = demo_text['source']
            localized_plan['tasks'][1]['evidence'][0]['supports'] = demo_text['visa_evidence']
            localized_plan['open_questions'] = [demo_text[f'question{i}'] for i in range(1, 4)]
            for i, task in enumerate(localized_plan['tasks'], 1):
                task.update(phase=demo_text[f'phase{i}'], title=demo_text[f'title{i}'], details=demo_text[f'details{i}'])
            localized_plan['tasks'][2]['due_basis'] = {'evidence': demo_text['arrival_due_basis']}
            localized_plan['tasks'][0]['notes'] = [demo_text['note']]
        demo = output / 'demos/nz-study'
        if language != 'en':
            demo = demo / language
        demo.mkdir(parents=True, exist_ok=True)
        visa.save(demo, localized_applicant, localized_plan)
    downloads = output / 'downloads'
    downloads.mkdir(exist_ok=True)
    zip_tree(SKILL, downloads / 'visa-agent-skill.zip', 'visa-agent')
    zip_tree(ROOT, downloads / 'visa-agent.zip', 'visa-agent')
    print(output / 'index.html')


if __name__ == '__main__':
    main()
