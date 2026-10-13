"""Build public draft sections from docs; never include internal handbook notes."""
from pathlib import Path
import argparse
import csv
from html import escape
import json
import re
import zlib
from saved_figure_theme import render_saved_figures

ROOT = Path(__file__).resolve().parents[1]
SECTIONS = {'summaryDownloads': 'home-downloads.html', 'resultExtent': 'target-summary.html', 'atlasScale': 'pan-viral.html',
            'scienceRecord': 'methods.html', 'hepacamWorkedExample': 'use-results.html',
            'releaseSources': 'release.html', 'dataSources': 'sources.html'}


def method_saved_examples():
    """Project saved export rows into teaching figures; never compare sequences."""
    base = ROOT / 'frontend/examples/hepacam/20260908/viruses5'
    pair_rows, candidates = [], {54: [], 329: [], 376: []}
    def display_row(row):
        return {'targetStart': int(row['Antigen Target Core Start']),
                'parentStart': int(row['Mimicry Parent Core Start']),
                'targetCore': row['Antigen Target 9-mer Core'],
                'parentCore': row['Mimicry Parent 9-mer Core'],
                'parentLabel': row['Mimicry Parent'],
                'parentAccession': row['Mimicry Parent'].rsplit(' | ', 1)[-1],
                'organism': row['Mimicry Parent Organism'],
                'identity': int(row['Core Identity'].split('|')[0])}
    with (base / 'matches.csv').open(encoding='utf-8-sig', newline='') as source:
        for row in csv.DictReader(source):
            is_ebna1 = row['Mimicry Parent'].endswith(' | P03211')
            start = int(row['Antigen Target Core Start'])
            if is_ebna1:
                pair_rows.append(dict(display_row(row), targetContext=row['Antigen Target Context Sequence'], parentContext=row['Mimicry Parent Context Sequence']))
            if start in candidates and not is_ebna1 and row['Core Identity'] == '5|9':
                chosen = candidates[start]
                if len(chosen) < (3 if start == 376 else 2) and all(r['parentLabel'] != row['Mimicry Parent'] for r in chosen):
                    chosen.append(display_row(row))
    selected = next(r for r in pair_rows if r['targetStart'] == 376 and r['parentStart'] == 392)
    examples = [next(r for r in pair_rows if r['targetStart'] == start) for start in [54, 329]] + [selected]
    # These are coordinate-ordered illustrations, not a score-based top list.
    field = candidates[54] + candidates[329] + candidates[376][:1] + [selected]
    with (base / 'parents.csv').open(encoding='utf-8-sig', newline='') as source:
        summary = next(r for r in csv.DictReader(source) if r['Mimicry Parent'].endswith(' | P03211'))
    return {'source': 'examples/hepacam/20260908/viruses5/matches.csv',
            'fieldRows': field,
            'mappingRows': [selected] + candidates[376],
            'fullPair': {'targetLength': int(summary['Antigen Target Eligible Residues']),
                         'parentLength': int(summary['Mimicry Parent Eligible Residues']),
                         'targetCovered': int(summary['Antigen Target Covered Residues']),
                         'parentCovered': int(summary['Mimicry Parent Covered Residues']),
                         'pairs': [[r['targetStart'], r['parentStart'], r['identity']] for r in pair_rows],
                         'examples': examples, 'logoRows': pair_rows}}


def section_span(text, section_id):
    matches = list(re.finditer(r'<section\b[^>]*\bid="' + re.escape(section_id) + r'"[^>]*>', text))
    if len(matches) != 1:
        raise ValueError(f'Expected exactly one section: {section_id}')
    start = matches[0].start()
    depth = 0
    for tag in re.finditer(r'</?section\b[^>]*>', text[start:]):
        depth += -1 if tag.group().startswith('</') else 1
        if depth == 0:
            return start, start + tag.end()
    raise ValueError(f'Unclosed section: {section_id}')


def render_walkthrough(template, assets=None):
    assets = assets or ROOT / 'frontend/examples/hepacam/20260908'
    provenance = json.loads((assets / 'provenance.json').read_text(encoding='utf-8'))
    labels = {'full-highlighted': 'Whole-protein annotated view', 'structure-highlighted': 'Predicted structure',
              'full-window-highlighted': 'Annotated context 367–393', 'current-window': 'Core window matches at 376–384',
              'mimicry-parents': 'Overall Mimicry Parents'}
    def figure(match):
        key, name = match.groups()
        if key not in provenance or name not in labels:
            raise ValueError('Unknown walkthrough figure')
        svg = (assets / key / (name + '.svg')).read_bytes()
        dimensions = re.search(rb'<svg[^>]*width="([\d.]+)" height="([\d.]+)"', svg)
        if dimensions is None:
            raise ValueError('Missing SVG dimensions')
        width, height = (part.decode() for part in dimensions.groups())
        revision = format(zlib.crc32(svg), '08x')
        settings = provenance[key]['settings']
        label = labels[name]
        url = f'/examples/hepacam/20260908/{key}/{name}.svg?v={revision}'
        return f'<div class="walkthrough-image-scroll" tabindex="0" role="region" aria-label="{label}; scroll to inspect on small screens"><img src="{url}" width="{width}" height="{height}" loading="lazy" alt="{label}; {settings["scope"]}; minimum core identity {settings["floor"]}/9." /></div>'
    rendered = re.sub(r'<!-- figure:([a-z0-9]+)/([a-z-]+) -->', figure, template)
    if '<!-- figure:' in rendered:
        raise ValueError('Malformed or unresolved walkthrough figure marker')
    return rendered



def render_saved_result_tables(source):
    """Render previously exported rows without scoring or sorting them."""
    if '<!-- saved-' not in source:
        return source
    payload = {}
    for snapshot in ('20260909', '20260916', '20260921'):
        saved = json.loads((ROOT / 'frontend/examples/use-results' / snapshot / 'tables.json').read_text(encoding='utf-8'))
        if payload.keys() & saved.keys():
            raise ValueError('Duplicate saved example keys')
        payload.update(saved)

    def label(row):
        name, accession, organism = [escape(str(row.get(key, ''))) for key in ['name', 'accession', 'organism']]
        assay_id = escape(str(row.get('assayId', '')))
        visible_id = assay_id or accession
        annotation = f'{accession} · {organism}' if assay_id else organism
        return (f'<span class="use-parent-name" data-tooltip="{escape(str(row.get("fullLabel", row["name"])))}"><span class="use-parent-name-text">{name}</span>'
                f'<span class="use-accession"> | {visible_id}</span></span>'
                f'<span class="use-parent-organism">{annotation}</span>')

    def stacked(top, bottom, show_roles=False):
        lines = []
        for role, label_text, accessible, value in [('target', 'Target', 'Antigen Target', top),
                                                     ('parent', 'Parent', 'Mimicry Parent', bottom)]:
            role_label = f'<span class="use-row-label">{label_text}</span>' if show_roles else ''
            lines.append(f'<span class="use-aligned-line" data-role="{role}" aria-label="{accessible}">'
                         f'{role_label}<span class="use-position">{escape(str(value))}</span></span>')
        return ''.join(lines)

    def peptide(sequence, mask=None):
        parts = []
        for i, aa in enumerate(sequence):
            state = 'absent' if aa == '.' or mask and mask[i] == '-' else 'unresolved' if mask and mask[i] == '?' else 'different' if mask and mask[i] == 'X' else 'match' if mask else 'target'
            core = ' use-core-residue' if 9 <= i < 18 else ''
            parts.append(f'<span class="use-residue-{state}{core}">{escape(aa)}</span>')
        groups = [
            f'<span class="use-peptide-segment use-peptide-{region}">{"".join(parts[start:start + 9])}</span>'
            for start, region in [(0, 'flank'), (9, 'core'), (18, 'flank')]
        ]
        return '<span class="use-peptide-gap" aria-hidden="true"></span>'.join(groups)

    def marker(match):
        kind, key = match.groups()
        data = payload[key]
        if kind.startswith('rank-'):
            rank = data['ranks'][kind.removeprefix('rank-')]
            return f'<td>{rank["higher"]:,}</td><td>{rank["first"]:,} / {rank["total"]:,}</td>'
        if kind == 'parent-count':
            return f'{data["parentCount"]:,} {escape(data.get("countLabel", "Matching Records"))}'
        if kind == 'pair-count':
            return f'{data["pairCount"]:,}'
        if kind == 'parent-rows':
            return '\n'.join(
                f'<tr><th scope="row">{label(row)}</th>'
                f'<td>{row["targetPercent"]:.1f}</td><td>{row["parentPercent"]:.1f}</td>'
                f'<td>{row["bestContext"]}/27</td></tr>' for row in data['parents'])
        if kind == 'match-rows':
            rows = []
            for row in data['matches']:
                q, p = row['targetContext'], row['parentContext']
                rows.append(f'<tr><th scope="row">{label(row)}</th>'
                            f'<td class="use-coordinate use-start-coordinate">{stacked(row["targetStart"], row["parentStart"], show_roles=True)}</td>'
                            f'<td class="use-peptide"><span class="use-aligned-line" data-role="target" aria-label="Antigen Target">{peptide(q)}</span>'
                            f'<span class="use-aligned-line" data-role="parent" aria-label="Mimicry Parent">{peptide(p, row["contextMask"])}</span></td>'
                            f'<td class="use-coordinate">{stacked(row["targetEnd"], row["parentEnd"])}</td>'
                            f'<td class="use-match-metric"><span class="use-metric-label" aria-hidden="true">Core </span>{row["coreIdentity"]}/9</td>'
                            f'<td class="use-match-metric"><span class="use-metric-label" aria-hidden="true">Context </span>{row["contextIdentity"]}/27</td>'
                            f'<td class="use-match-metric use-blosum-score"><span class="use-metric-label" aria-hidden="true">Context BLOSUM62 </span>{row["contextBlosum62"]}</td></tr>')
            return '\n'.join(rows)
        raise ValueError(f'Unknown saved table marker: {kind}')
    source = re.sub(r'<!-- saved-(parent-count|pair-count|parent-rows|match-rows|rank-all|rank-site|rank-ebv):([a-z0-9-]+) -->', marker, source)
    if '<!-- saved-' in source:
        raise ValueError('Unresolved saved table marker')
    return source


def render(original, assets=None):
    result = original
    for section_id, filename in SECTIONS.items():
        source = (ROOT / 'docs/public' / filename).read_text(encoding='utf-8').strip()
        if section_id == 'hepacamWorkedExample' and '<!-- figure:' in source:
            source = render_walkthrough(source, assets)
        if section_id == 'hepacamWorkedExample':
            source = render_saved_result_tables(source)
            source = render_saved_figures(source)
            # Refreshed saved figures get new URLs so browsers cannot retain stale labels.
            def versioned_figure(match):
                attribute, url = match.groups()
                asset = ROOT / 'frontend' / url.lstrip('/')
                revision = format(zlib.crc32(asset.read_bytes()), '08x')
                return f'{attribute}="{url}?v={revision}"'
            source = re.sub(r'(src|href)="(/examples/use-results/[0-9]+/[a-z0-9-]+[.]svg)(?:[?][^"]*)?"',
                            versioned_figure, source)
        import summary_downloads
        summary_downloads.ROOT = ROOT
        source = summary_downloads.render(source)
        if section_span(source, section_id) != (0, len(source)):
            raise ValueError(f'Unexpected content outside public section: {filename}')
        start, end = section_span(result, section_id)
        result = result[:start] + source + result[end:]
    copy_path = ROOT / 'docs/public/method-copy.json'
    if copy_path.exists() or 'hepacamWorkedExample' in SECTIONS:
        copy = json.loads(copy_path.read_text(encoding='utf-8'))
        if not isinstance(copy, dict) or not all(isinstance(v, str) for v in copy.values()):
            raise ValueError('Diagram copy must contain string values')
        payload = json.dumps(copy, ensure_ascii=False).replace('<', '\\u003c').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
        saved = json.dumps(method_saved_examples(), ensure_ascii=False).replace('<', '\\u003c').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
        block = '<!-- public-diagram-copy:start --><script>window.MimicryPublicCopy=' + payload + ';window.MimicryMethodSavedExamples=' + saved + ';</script><!-- public-diagram-copy:end -->'
        pattern = r'<!-- public-diagram-copy:start -->.*?<!-- public-diagram-copy:end -->'
        if re.search(pattern, result, re.S):
            result = re.sub(pattern, lambda _: block, result, flags=re.S)
        else:
            anchor = '<script src="/method-figure.js"></script>'
            if result.count(anchor) != 1: raise ValueError('Missing diagram script anchor')
            result = result.replace(anchor, block + '\n' + anchor)
    return result


def build(check=False, content_only=False):
    import summary_downloads
    summary_downloads.ROOT = ROOT
    summary_downloads.sync_guide(check=check)
    import public_downloads
    public_downloads.sync_aliases(ROOT, check=check)
    if (ROOT / 'docs/public/interface-copy.json').exists():
        import public_copy
        public_copy.ROOT = ROOT
        catalogue = public_copy.compile_files(check=check)
        public_copy.write_review(catalogue, check=check)
    page = ROOT / 'frontend/index.html'
    original = page.read_text(encoding='utf-8')
    result = render(original)
    import site_pages
    site_pages.ROOT = ROOT
    result = site_pages.paginate(result, section_span, check=check)
    if check and result != original:
        raise ValueError('Public sections are stale; run python frontend/public_sections.py')
    if not check and result != original:
        page.write_text(result, encoding='utf-8', newline='\n')
    if content_only:
        return result == original
    if (ROOT / 'docs/public/interface-copy.json').exists():
        public_copy.sync_source_bundle(check=check)
    import importlib.util
    spec=importlib.util.spec_from_file_location('embedded_viewer_builder',ROOT/'tools/build_embedded_viewer.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    module.build(check=check)
    return result == original


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--content-only', action='store_true', help='Build authored pages only; the host builds its portable package and embedded player separately')
    args = parser.parse_args()
    unchanged = build(check=args.check, content_only=args.content_only)
    print('Public sections current' if unchanged else 'Built public sections from docs/public')
