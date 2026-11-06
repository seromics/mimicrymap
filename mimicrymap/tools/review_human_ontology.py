"""Add an actual GO hierarchy to the local human sequence-assembly review.

Reads saved review inputs only. GO annotations propagate through is_a/part_of;
multiple parents and overlapping assay memberships remain explicit.
"""
import argparse
import base64
from collections import Counter, defaultdict
from functools import lru_cache
import gzip
import json
from pathlib import Path
import shutil

import numpy as np
from scipy.sparse import csr_matrix
from review_human_assembly import evidence, union_matrix, write_csv, log


ASPECTS = {
    'molecular_function': ('Molecular Function', 'GO:0003674'),
    'biological_process': ('Biological Process', 'GO:0008150'),
    'cellular_component': ('Cellular Location', 'GO:0005575'),
}


def stage_serome_style(out):
    """Use the production figure palette, font and label geometry offline."""
    viewer = Path(__file__).resolve().parents[2]/'atlas'/'viewer'
    shutil.copyfile(viewer/'shared'/'plotPalette.cjs', out/'serome-palette.js')
    flow = (viewer/'src'/'lib'/'mimicryAntigenFlow.js').read_text(encoding='utf-8').replace('export ', '')
    arcs = (viewer/'src'/'lib'/'mimicryFingerprint.js').read_text(encoding='utf-8').replace('export ', '')
    font = base64.b64encode((viewer/'public'/'fonts'/'inter-latin.woff2').read_bytes()).decode('ascii')
    css = '@font-face{font-family:Inter;font-style:normal;font-weight:300 700;src:url(data:font/woff2;base64,'+font+') format("woff2");}'
    script = 'const SEROME_FONT_CSS='+json.dumps(css)+';\n'
    script += 'const SeromeStyle={...(()=>{\n'+flow+'\nreturn {antigenFlowLabels,antigenFlowInnerLabels,antigenFlowLabelLeader,antigenFlowTextFacing,antigenFlowLabelSize,antigenFlowInnerLineHeight};})(),\n'
    script += '...(()=>{\n'+arcs+'\nreturn {fingerprintArc,fingerprintBand};})()};\n'
    script += 'const seromeFontStyle=document.createElement("style");seromeFontStyle.textContent=SEROME_FONT_CSS;document.head.append(seromeFontStyle);\n'
    (out/'serome-style.js').write_text(script, encoding='utf-8')
    shutil.copyfile(Path(__file__).with_name('human_ontology_figure.js'), out/'ontology-figure.js')
    shutil.copyfile(viewer/'public'/'fonts'/'LICENSE-Inter.txt', out/'LICENSE-Inter.txt')


def decorate_overview(nodes, aspects):
    """Keep broad GO branches above the slim without choosing one parent."""
    roots = {a['root'] for a in aspects.values()}
    selected = {i for i, n in enumerate(nodes) if n['slim'] or any(p in roots for p, _ in n['parents'])}
    @lru_cache(None)
    def ancestors(i):
        return frozenset({i}.union(*(ancestors(p) for p, _ in nodes[i]['parents'])))
    for i, n in enumerate(nodes):
        n['overview'] = i in selected
        candidates = (ancestors(i) - {i}) & selected if i in selected else set()
        n['overviewParents'] = sorted(p for p in candidates if not any(p in ancestors(q) for q in candidates if q != p))


def refresh_layout(out):
    """Update overview geometry and its source without repeating statistics."""
    path = out/'ontology-data.js'
    data = json.loads(path.read_text(encoding='utf-8').removeprefix('const ONTOLOGY_DATA=').removesuffix(';'))
    decorate_overview(data['nodes'], data['aspects'])
    path.write_text('const ONTOLOGY_DATA='+json.dumps(data, separators=(',', ':'), allow_nan=False)+';', encoding='utf-8')
    write_csv(out/'overview-edges.csv',
              (dict(child=n['id'], ancestor=data['nodes'][p]['id'], relation='is_a/part_of ancestry')
               for n in data['nodes'] if n['overview'] for p in n['overviewParents']),
              ['child','ancestor','relation'])
    summary = json.loads((out/'summary.json').read_text(encoding='utf-8'))
    for aspect, (_, root) in ASPECTS.items():
        summary['aspects'][aspect]['slim_terms'] = sum(n['aspect'] == aspect and n['slim'] and n['id'] != root for n in data['nodes'])
        summary['aspects'][aspect]['overview_terms'] = sum(n['aspect'] == aspect and n['overview'] and n['id'] != root for n in data['nodes'])
    (out/'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    readme = (out/'README.txt').read_text(encoding='utf-8')
    readme = readme.replace('The generic GO slim defines the compact overview.',
                            'The generic GO slim plus broad root-child terms defines the compact overview.')
    (out/'README.txt').write_text(readme, encoding='utf-8')
    shutil.copyfile(Path(__file__).with_name('human_ontology_review.html'), out/'index.html')
    stage_serome_style(out)
    log(stage='layout-refreshed', output=str(out))


def read_obo(path):
    terms, current, version = {}, None, ''
    for line in path.read_text(encoding='utf-8').splitlines():
        if line == '[Term]':
            current = {}
            continue
        if line.startswith('['):
            current = None
        if ': ' not in line:
            continue
        key, value = line.split(': ', 1)
        if key == 'data-version':
            version = value
        if current is not None:
            current.setdefault(key, []).append(value)
            if key == 'id':
                terms[value] = current
    aliases = {alt: key for key, term in terms.items() for alt in term.get('alt_id', [])}

    def resolve(key, seen=()):
        key = aliases.get(key, key)
        if key not in terms or key in seen:
            return None
        if terms[key].get('is_obsolete') == ['true']:
            replacement = terms[key].get('replaced_by', [])
            return resolve(replacement[0], (*seen, key)) if len(replacement) == 1 else None
        return key

    parents = {}
    for key, term in terms.items():
        if resolve(key) != key:
            continue
        links = [(x.split()[0], 'is_a') for x in term.get('is_a', [])]
        links += [(x.split()[1], 'part_of') for x in term.get('relationship', []) if x.startswith('part_of ')]
        parents[key] = sorted({(resolve(p), rel) for p, rel in links if resolve(p)})
    return terms, parents, resolve, version


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--review', type=Path, required=True)
    ap.add_argument('--go-pack', type=Path)
    ap.add_argument('--obo', type=Path)
    ap.add_argument('--refresh-layout', action='store_true')
    args = ap.parse_args()
    out = args.review / 'ontology'
    out.mkdir(exist_ok=True)
    if args.refresh_layout:
        refresh_layout(out)
        return
    if not args.go_pack or not args.obo:
        ap.error('--go-pack and --obo are required for the initial evidence build')
    base = json.loads((args.review / 'review-data.json').read_text(encoding='utf-8'))
    raw = json.load(gzip.open(args.go_pack, 'rt', encoding='utf-8'))
    terms, parents, resolve, version = read_obo(args.obo)
    gene_index = defaultdict(set)
    for i, record in enumerate(base['records']):
        if record['gene']:
            gene_index[record['gene']].add(i)

    visiting = set()
    @lru_cache(None)
    def ancestors(key):
        if key in visiting:
            raise ValueError('Cycle in safe GO relations: ' + key)
        visiting.add(key)
        result = {key}
        for p, _ in parents.get(key, []):
            result.update(ancestors(p))
        visiting.remove(key)
        return frozenset(result)

    memberships = defaultdict(set)
    unresolved, remapped = [], []
    for annotation in raw['terms']:
        key = resolve(annotation['i'])
        if key is None:
            unresolved.append(dict(id=annotation['i'], name=annotation['n'], reason='Absent or obsolete without a unique replacement'))
            continue
        if key != annotation['i']:
            remapped.append(dict(original=annotation['i'], resolved=key))
        proteins = set()
        gene = 0
        for delta in annotation['m']:
            gene += delta
            proteins.update(gene_index.get(raw['genes'][gene], ()))
        for parent in ancestors(key):
            memberships[parent].update(proteins)

    keys = sorted(key for key, proteins in memberships.items() if proteins and terms[key]['namespace'][0] in ASPECTS)
    indices = {key: i for i, key in enumerate(keys)}
    slim = {key for key in keys if 'goslim_generic' in terms[key].get('subset', [])}
    slim.update(root for _, root in ASPECTS.values())
    nodes = []
    for key in keys:
        # Nearest selected ancestors preserve every GO parent route. A compressed
        # edge is an ancestry path, not necessarily one direct GO relationship.
        candidates = (ancestors(key) - {key}) & slim
        nearest = {p for p in candidates if not any(p in ancestors(q) for q in candidates if q != p)}
        nodes.append(dict(id=key, label=terms[key]['name'][0], aspect=terms[key]['namespace'][0],
                          proteins=sorted(memberships[key]), slim=key in slim,
                          parents=[[indices[p], rel] for p, rel in parents.get(key, []) if p in indices],
                          slimParents=[indices[p] for p in sorted(nearest)] if key in slim else []))
    children = defaultdict(list)
    for i, n in enumerate(nodes):
        for p, _ in n['parents']:
            children[p].append(i)
    for i, n in enumerate(nodes):
        n['children'] = children[i]
    payload = dict(study=base['study'], identity=base['identity'], coverage=base['coverage'],
                   ontology_version=version, annotation_pack=str(args.go_pack),
                   records=base['records'], nodes=nodes,
                   aspects={a: dict(label=label, root=indices[root]) for a, (label, root) in ASPECTS.items()},
                   families=[], assays={})
    decorate_overview(nodes, payload['aspects'])
    # The complete reference partition includes quiet families omitted from the
    # exploratory network display. Preserve these for ontology drilldown.
    import csv
    family_members = defaultdict(list)
    record_indices = {r['source']: i for i, r in enumerate(base['records'])}
    family_path = Path(base['sources']['reference_clusters'])
    if family_path.is_dir():
        family_path /= 'protein-membership.csv'
    for row in csv.DictReader(family_path.open(encoding='utf-8-sig')):
        if row['source'] in record_indices:
            family_members[row['cluster_id']].append(record_indices[row['source']])
    for key, proteins in sorted(family_members.items()):
        genes = list(dict.fromkeys(base['records'][i]['gene'] or base['records'][i]['source'] for i in proteins))
        payload['families'].append(dict(id=key, label=' / '.join(genes[:3]), proteins=proteins))
    summary = dict(ontology_version=version, installed_annotation_terms=len(raw['terms']), terms=len(nodes),
                   unresolved_terms=len(unresolved), remapped_terms=len(remapped), aspects={}, assays={})
    for aspect, (label, root) in ASPECTS.items():
        summary['aspects'][aspect] = dict(terms=sum(n['aspect'] == aspect for n in nodes),
                                         slim_terms=sum(n['aspect'] == aspect and n['slim'] and n['id'] != root for n in nodes),
                                         overview_terms=sum(n['aspect'] == aspect and n['overview'] and n['id'] != root for n in nodes),
                                         annotated_proteins=len(memberships[root]))
    log(stage='ontology', **summary)
    for platform, assay in base['assays'].items():
        rows, cols = [], []
        for i, features in enumerate(assay['protein_features']):
            rows.extend([i]*len(features))
            cols.extend(features)
        mapping = csr_matrix((np.ones(len(rows), dtype=np.int32), (rows, cols)), shape=(len(base['records']), len(assay['features'])))
        hits, observed = np.array(assay['feature_hits'], dtype=bool), np.array(assay['feature_observed'], dtype=bool)
        samples = assay['samples']
        all_evidence = {k: [None]*len(nodes) for k in ('h', 'n', 'p', 'q')}
        for aspect in ASPECTS:
            selected = [i for i, n in enumerate(nodes) if n['aspect'] == aspect]
            matrix = union_matrix([nodes[i]['proteins'] for i in selected], mapping)
            ev = evidence(matrix, hits, observed, True)
            for key, values in ev.items():
                for i, value in zip(selected, values):
                    all_evidence[key][i] = value
            log(stage='evidence', assay=platform, aspect=aspect, terms=len(selected), memberships=matrix.nnz)
        payload['assays'][platform] = dict(samples=samples, evidence=all_evidence,
                                          protein_h=assay['protein_h'], protein_n=assay['protein_n'])
        summary['assays'][platform] = dict(samples=len(samples), retained_features=len(hits),
                                           measured_terms=sum(any(n) for n in all_evidence['n']))
        write_csv(out/(platform+'-term-evidence.csv.gz'),
                  (dict(term=n['id'], label=n['label'], aspect=n['aspect'], overview=n['slim'],
                        sample=s['id'], group=s['group'], visit=s['visit'],
                        **{k: all_evidence[k][i][j] for k in all_evidence})
                   for i, n in enumerate(nodes) for j, s in enumerate(samples)),
                  ['term','label','aspect','overview','sample','group','visit','h','n','p','q'])
    write_csv(out/'term-proteins.csv.gz',
              (dict(term=n['id'], accession=base['records'][p]['source'], gene=base['records'][p]['gene'])
               for n in nodes for p in n['proteins']), ['term','accession','gene'])
    write_csv(out/'ontology-edges.csv',
              (dict(child=n['id'], parent=nodes[p]['id'], relation=relation) for n in nodes for p, relation in n['parents']),
              ['child','parent','relation'])
    write_csv(out/'overview-edges.csv',
              (dict(child=n['id'], ancestor=nodes[p]['id'], relation='is_a/part_of ancestry') for n in nodes if n['overview'] for p in n['overviewParents']),
              ['child','ancestor','relation'])
    write_csv(out/'unresolved-annotations.csv', unresolved, ['id','name','reason'])
    write_csv(out/'resolved-annotation-ids.csv', remapped, ['original','resolved'])
    (out/'ontology-data.js').write_text('const ONTOLOGY_DATA='+json.dumps(payload, separators=(',', ':'), allow_nan=False)+';', encoding='utf-8')
    (out/'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    shutil.copyfile(Path(__file__).with_name('human_ontology_review.html'), out/'index.html')
    stage_serome_style(out)
    (out/'README.txt').write_text(methods_text(payload, summary, args), encoding='utf-8')
    log(stage='complete', output=str(out), **summary)


def methods_text(data, summary, args):
    return f'''HUMAN ONTOLOGY ATLAS — {data['study']}

REFERENCE AND ANNOTATION
Human Swiss-Prot records and retained HuProt IgG/IgA calls are reused from the
adjacent sequence-assembly review. GO membership is joined by the installed
canonical gene symbol. Installed pack: {args.go_pack}
GO hierarchy: {args.obo}; {data['ontology_version']}.
The annotation pack does not declare a GO release. Explicit alt IDs and unique
replaced_by IDs are resolved; {summary['unresolved_terms']} terms without a current
unambiguous identity are omitted and listed in unresolved-annotations.csv.
Membership propagates through is_a and part_of only. has_part and regulatory
relations are not used. Each node contains the union of its annotated proteins.
GO has multiple parents: repeated sectors represent the same term and evidence,
not distinct biological observations. No ontology branch is forced into one home.

OVERVIEW AND DRILLDOWN
The generic GO slim plus broad root-child terms defines the compact overview.
An edge joins the nearest
selected ancestor(s) through one or more safe GO edges. Open a term to inspect
its immediate GO children and reference sequence families. Sequence-family
membership is intersected with the selected term; a family's entire protein
membership is not assigned to the term. Families use the saved reference MCL
partition; GO does not modify that partition. Layout is fixed across samples.
Sector allocation is for readability, not a count or significance scale.

ASSAY MEMBERSHIP AND EVIDENCE
Membership uses existing >=7/9 sequence identity and >=10% assay-antigen residue
coverage. These are sequence-defined candidate memberships, not an assertion of
antibody cross-reactivity. Retained assay IDs are unioned within each GO node;
the same antigen mapped through several proteins or children counts once.
Only biological samples with that assay are included. Technical repeats and
assay controls are excluded. Missing calls are not negative calls.
Band color: mean of sample-level hit/observed-mapped-antigen fractions in the selected
scope (one fraction for an individual sample). Blue arc: at least one
selected sample has q < 0.01. Sample support is not a group-comparison test.
Protein spikes: mean hit fraction among assay antigens mapped to that protein,
with height on a fixed 0–100% scale. Color uses the selected display maximum.
Shared ontology memberships can repeat ticks; ticks must not be summed across
sectors. Quiet terms and proteins are retained in the fixed layout.

STATISTICS
For each term and sample, h is the number of recorded positive antigen calls and
n the number of measured mapped antigens, each unioned by retained antigen ID.
The one-sided hypergeometric upper tail uses all retained, observed assay
features as the sample background, and all recorded positives among them.
BH correction is separate for each assay, sample and complete GO aspect, over
every measured term (including the aspect root), before display filtering or
navigation. q does not change between overview and drilldown. P values are
over-representation summaries under this feature-level model; overlapping or
homologous assay features can be dependent. These are not infection diagnoses,
independent antibody-specificity counts, or tests between study groups.

FILES AND COLUMNS
ontology-data.js: complete display data and memberships for this local viewer.
*-term-evidence.csv.gz: one term/sample row; term and label are GO identity/name;
aspect is the BH family; overview marks generic GO slim/root membership; sample,
group and visit retain study identity; h/n are hit/observed counts; p is the
upper-tail enrichment probability; q is its within-aspect BH adjustment. Missing
p/q denotes no measured mapped antigens. Counts are integers; p/q are unrounded.
term-proteins.csv.gz: propagated term-to-reference accession/gene membership.
ontology-edges.csv: child, parent and direct safe relation from the pinned GO.
overview-edges.csv: child and nearest overview ancestor; paths may be compressed.
resolved-annotation-ids.csv / unresolved-annotations.csv: identity reconciliation.
Live CSV exports contain each visible term once per selected sample, regardless
of repeated visual sectors. SVG/PNG use the current assay, scopes, hierarchy and
color range, with the shared light export palette. Their legends describe that
state. The production Serome palette registry, bundled Inter font and radial
label-placement helpers are reused. Titles and keys sit within each circle;
unsupported names remain bold gray. Thin blue support arcs sit against label
baselines. Individual labels report sample BH; group labels report supported /
tested samples. A group-panel support mark means at least one sample passes,
not a between-group test. SVG embeds the font used for PNG and display.

GO relations: https://geneontology.org/docs/ontology-relations/
GO subsets: https://geneontology.org/docs/go-subset-guide/
'''


if __name__ == '__main__':
    main()
