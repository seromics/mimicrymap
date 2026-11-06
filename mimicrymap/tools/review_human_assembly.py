"""Build a local, read-only review of human sequence communities and study calls.

Reference families are supplied by cluster_sequence_mappings.py. Study-active
and sample-active MCL partitions are exploratory and receive no enrichment p values.
The same retained antigen IDs and observed-call masks feed every view.
"""
import argparse
from collections import Counter, defaultdict
import csv
import gzip
import json
import math
from pathlib import Path
import random
import re
import sqlite3
from types import SimpleNamespace

import igraph as ig
import numpy as np
from scipy.sparse import csr_matrix
from scipy.stats import hypergeom, rankdata

from cluster_sequence_mappings import read_graph, cluster_graph, write_csv


def log(**data):
    print(json.dumps(data), flush=True)


def connect(path):
    db = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    return db


def natural(value):
    return [int(x) if x.isdigit() else x.lower() for x in re.split(r'(\d+)', value or '')]


def unpack(value, indices):
    return np.unpackbits(np.frombuffer(value, dtype=np.uint8), bitorder='little')[indices].astype(bool)


def load_study(path, platform):
    db = connect(path)
    manifests = {r['sample']: r for r in (json.loads(row['data']) for row in
                 db.execute("SELECT data FROM sero_manifest WHERE scope='study' ORDER BY ordinal"))}
    samples = []
    for row in db.execute('''SELECT s.*,g.name group_name FROM samples s JOIN groups g USING(group_id)
            JOIN platform_samples p USING(bit_index) WHERE p.platform=? AND s.is_deleted=0''', (platform,)):
        m = manifests.get(row['original_sample']) or manifests.get(row['sample_unified'])
        if m is None:
            raise ValueError('Missing manifest sample identity')
        tech = m.get('technicalReplicates') or {}
        if m.get('sampleType') != 'study' or tech.get('set') or any((tech.get('assays') or {}).values()):
            continue
        design = m.get('design') or {}
        samples.append(dict(id=row['sample_unified'], group=row['group_name'], bit=row['bit_index'],
                            person=design.get('person') or row['study_pair'],
                            family=design.get('family') or '', member=design.get('role') or '',
                            visit=design.get('visit') or row['pair_timepoint'] or '',
                            order=design.get('order')))
    samples.sort(key=lambda s: (natural(s['family']), natural(s['person']), s['order'] or 0, natural(s['id'])))
    indices = np.array([s['bit'] for s in samples], dtype=int)
    features, hits, observed = [], [], []
    for row in db.execute('''SELECT a.antigen_id,a.source_id,a.name,a.gene,a.accession,
            h.mask hits,o.mask observed FROM antigens a JOIN hit_mask h USING(antigen_id)
            JOIN hit_observed_mask o USING(antigen_id) WHERE a.platform=? AND a.is_deleted=0
            ORDER BY a.antigen_id''', (platform,)):
        h, o = unpack(row['hits'], indices), unpack(row['observed'], indices)
        if np.any(h & ~o):
            raise ValueError('Positive call outside recorded call availability')
        if not o.any():
            continue
        features.append({k: row[k] for k in ['antigen_id', 'source_id', 'name', 'gene', 'accession']})
        hits.append(h)
        observed.append(o)
    db.close()
    return samples, features, np.array(hits, dtype=bool), np.array(observed, dtype=bool)


def assay_memberships(path, records, features, identity, coverage):
    db = connect(path)
    sides = defaultdict(dict)
    for row in db.execute('SELECT side,id,source,metadata FROM sequence_records'):
        sides[row['side']][row['id']] = (row['source'], json.loads(row['metadata']))
    human_side = next(side for side, rows in sides.items()
                      if next(iter(rows.values()))[1].get('library_id') == 'human_swissprot')
    assay_side = 1 - human_side
    ref_index = {r['source']: i for i, r in enumerate(records)}
    parent_ids = {key: ref_index[source] for key, (source, _) in sides[human_side].items()}
    feature_sources = defaultdict(list)
    for i, feature in enumerate(features):
        feature_sources[re.sub(r'\.B\d+C\d+R\d+$', '', feature['source_id'])].append(i)
    aliases = defaultdict(set)
    for row in db.execute('SELECT alias,id FROM record_aliases WHERE side=?', (assay_side,)):
        if row['alias'] in feature_sources:
            aliases[row['alias']].add(row['id'])
    target_ids = defaultdict(list)
    for alias, ids in aliases.items():
        if len(ids) == 1:
            target_ids[next(iter(ids))].extend(feature_sources[alias])
    own, other, gate = ('a', 'b', 'stats_ac') if assay_side == 0 else ('b', 'a', 'stats_bc')
    rows, columns = [], []
    for row in db.execute(f'SELECT {own} target,{other} parent FROM mapping_pairs WHERE identity=? AND {gate}>=?',
                          (identity, coverage)):
        for feature in target_ids.get(row['target'], []):
            rows.append(parent_ids[row['parent']])
            columns.append(feature)
    db.close()
    matrix = csr_matrix((np.ones(len(rows), dtype=np.int32), (rows, columns)), shape=(len(records), len(features)))
    matrix.sum_duplicates()
    matrix.data[:] = 1
    return matrix


def category_memberships(hpa, records):
    gene_to_proteins = defaultdict(list)
    for i, record in enumerate(records):
        gene_to_proteins[record['gene']].append(i)
    raw = json.load(gzip.open(hpa, 'rt', encoding='utf-8'))
    selected = {'HPA_Molecular_function': 'Molecular Function', 'HPA_Protein_class': 'Protein Class',
                'HPA_Subcellular_main_location': 'Cellular Location'}
    result = {}
    for key, label in selected.items():
        categories = []
        for t in raw['terms']:
            if t['s'] != key:
                continue
            indices = np.cumsum(t['m'])
            proteins = sorted({p for i in indices for p in gene_to_proteins[raw['genes'][i]]})
            if proteins:
                categories.append(dict(id=key+':'+t['i'], label=t['n'], proteins=proteins))
        result[key] = dict(label=label, categories=sorted(categories, key=lambda t: natural(t['label'])))
    return result


def union_matrix(groups, mapping):
    rows, columns = [], []
    for i, group in enumerate(groups):
        columns_i = np.unique(np.concatenate([mapping.indices[mapping.indptr[p]:mapping.indptr[p+1]] for p in group]))
        columns.extend(columns_i.tolist())
        rows.extend([i]*len(columns_i))
    return csr_matrix((np.ones(len(rows), dtype=np.int32), (rows, columns)), shape=(len(groups), mapping.shape[1]))


def evidence(matrix, hits, observed, test=True):
    h = np.asarray(matrix @ hits.astype(np.int32))
    n = np.asarray(matrix @ observed.astype(np.int32))
    result = dict(h=h.tolist(), n=n.tolist())
    if test:
        total, positive = observed.sum(axis=0), hits.sum(axis=0)
        p = hypergeom.sf(h-1, total[np.newaxis, :], positive[np.newaxis, :], n)
        p[n == 0] = np.nan
        q = np.full(p.shape, np.nan)
        for j in range(p.shape[1]):
            valid = np.flatnonzero(n[:, j] > 0)
            order = valid[np.argsort(p[valid, j], kind='stable')]
            q[order, j] = np.minimum(1, np.minimum.accumulate(
                (p[order, j]*len(valid)/np.arange(1, len(valid)+1))[::-1])[::-1])
        result.update(p=[[None if not np.isfinite(v) else float(v) for v in row] for row in p],
                      q=[[None if not np.isfinite(v) else float(v) for v in row] for row in q])
    return result


def group_links(graph, groups):
    assigned = {}
    for i, group in enumerate(groups):
        for p in group:
            assigned[p] = i
    links = defaultdict(lambda: [0, 0., 0.])
    for edge in graph.es:
        a, b = edge.tuple
        if a not in assigned or b not in assigned:
            continue
        a, b = assigned[a], assigned[b]
        if a == b:
            continue
        value = links[tuple(sorted((a, b)))]
        value[0] += 1
        value[1] += edge['weight']
        value[2] = max(value[2], edge['weight'])
    return [[a, b, n, round(total, 6), round(maximum, 6)] for (a, b), (n, total, maximum) in sorted(links.items())]


def layout(groups, links):
    random.seed(17)
    ig.set_random_number_generator(random.Random(17))
    g = ig.Graph(n=len(groups), edges=[(e[0], e[1]) for e in links])
    g.es['weight'] = [math.log1p(e[3]) for e in links]
    if g.vcount() < 2:
        return [[.5, .5]]*g.vcount()
    xy = np.array(g.layout_fruchterman_reingold(weights='weight', niter=300, grid='auto').coords)
    # Disconnected outliers otherwise compress thousands of connected families
    # into a tiny central knot. Rank spacing preserves coordinate order while
    # spreading the display; geometric distances are not similarity estimates.
    xy = np.column_stack([rankdata(xy[:, axis], method='average') for axis in range(2)])
    xy = (xy-.5)/len(groups)
    return np.round(xy, 5).tolist()


def build_view(key, title, groups, ids, records, graph, mapping, hits, observed, active, test, out):
    matrix = union_matrix(groups, mapping)
    ev = evidence(matrix, hits, observed, test)
    # BH includes every measured reference set, even sets without a hit. Display
    # selection happens only after correction, never before it.
    shown = [i for i, group in enumerate(groups) if any(active[p] for p in group)]
    selected = [groups[i] for i in shown]
    links = group_links(graph, selected)
    xy = layout(selected, links)
    nodes = []
    for local, i in enumerate(shown):
        group = groups[i]
        ranked = sorted(group, key=lambda p: (-sum(hits[mapping[p].indices].any(axis=0)) if mapping[p].nnz else 0,
                                             records[p]['source']))
        label = ' / '.join(records[p]['gene'] or records[p]['source'] for p in ranked[:3])
        nodes.append(dict(id=ids[i], label=label, proteins=group, activeProteins=sum(bool(active[p]) for p in group),
                          x=xy[local][0], y=xy[local][1], **{k: v[i] for k, v in ev.items()}))
    stats = dict(id=key, title=title, nodes=len(nodes), active_proteins=sum(len(set(g).intersection(np.flatnonzero(active))) for g in selected),
                 singleton_nodes=sum(len(g)==1 for g in selected), links=len(links), tested_sets=len(groups) if test else 0)
    log(stage='view', **stats)
    write_csv(out/(key+'-nodes.csv'), (dict(id=n['id'], label=n['label'], proteins=len(n['proteins']), active_proteins=n['activeProteins'],
              accessions=';'.join(records[p]['source'] for p in n['proteins'])) for n in nodes),
              ['id','label','proteins','active_proteins','accessions'])
    write_csv(out/(key+'-links.csv.gz'), (dict(a=nodes[a]['id'], b=nodes[b]['id'], protein_links=n, weight_sum=w, weight_max=m)
              for a,b,n,w,m in links), ['a','b','protein_links','weight_sum','weight_max'])
    return dict(id=key, title=title, test=test, nodes=nodes, links=links, stats=stats)


def mcl_active(graph, active):
    vertices = np.flatnonzero(active).tolist()
    g = graph.induced_subgraph(vertices)
    # Induced-subgraph order is the sorted original vertex order.
    partition, method = cluster_graph(g, SimpleNamespace(algorithm='mcl', inflation=2))
    return sorted(([vertices[v] for v in group] for group in partition), key=lambda g: (-len(g), min(g))), method


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--study', type=Path, required=True)
    parser.add_argument('--graph', type=Path, required=True)
    parser.add_argument('--mapping', type=Path, required=True)
    parser.add_argument('--reference-clusters', type=Path, required=True)
    parser.add_argument('--hpa', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--identity', type=int, default=7)
    parser.add_argument('--coverage', type=float, default=10)
    parser.add_argument('--platforms', nargs='+', default=['HuProt_635nm','HuProt_532nm'])
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    records, graph, _, _ = read_graph(args.graph, args.identity, args.coverage)
    reference_settings = json.loads((args.reference_clusters/'summary.json').read_text(encoding='utf-8'))
    if reference_settings['identity'] != args.identity or reference_settings['coverage_min'] != args.coverage:
        raise ValueError('Reference clustering and review graph must use the same thresholds')
    reference = defaultdict(list)
    by_source = {r['source']:i for i,r in enumerate(records)}
    for row in csv.DictReader((args.reference_clusters/'protein-membership.csv').open(encoding='utf-8')):
        reference[row['cluster_id']].append(by_source[row['source']])
    if sorted(p for g in reference.values() for p in g) != list(range(len(records))):
        raise ValueError('Reference families must partition this exact human reference')
    categories = category_memberships(args.hpa, records)
    data = dict(study=args.study.stem.replace('atlas_artifact_',''), identity=args.identity, coverage=args.coverage,
                records=[{k:r[k] for k in ['source','gene','description']} for r in records], assays={},
                edges=[[a,b,round(edge['weight'],6)] for edge in graph.es for a,b in [edge.tuple]],
                sources={k:str(v) for k,v in vars(args).items() if isinstance(v,Path)})
    summaries = {}
    for platform in args.platforms:
        directory = out/platform
        directory.mkdir()
        samples, features, hits, observed = load_study(args.study, platform)
        mapping = assay_memberships(args.mapping, records, features, args.identity, args.coverage)
        protein_h = np.asarray(mapping @ hits.astype(np.int32))
        protein_n = np.asarray(mapping @ observed.astype(np.int32))
        active = protein_h.any(axis=1)
        log(stage='study', platform=platform, samples=len(samples), features=len(features),
            mapped_features=len(np.unique(mapping.indices)), active_proteins=int(active.sum()))
        fixed = build_view('reference', 'Reference Sequence Families', list(reference.values()), list(reference), records, graph,
                           mapping, hits, observed, active, True, directory)
        active_groups, active_method = mcl_active(graph, active)
        adaptive = build_view('active', 'Study-Active Sequence Families', active_groups,
                              [f'ACT{i+1:05d}' for i in range(len(active_groups))], records, graph, mapping,
                              hits, observed, active, False, directory)
        adaptive['method'] = active_method
        assay = dict(samples=samples, features=features, views=[fixed,adaptive], annotations={},
                     protein_h=protein_h.tolist(), protein_n=protein_n.tolist(), sample_views={},
                     feature_hits=hits.astype(int).tolist(), feature_observed=observed.astype(int).tolist(),
                     protein_features=[mapping[p].indices.tolist() for p in range(len(records))])
        # One complete within-person visit pair from each study group, chosen
        # by natural sample order. These are examples, not selected by signal.
        first_people = {}
        for sample in samples:
            first_people.setdefault(sample['group'], sample['person'])
        for j, sample in enumerate(samples):
            if sample['person'] != first_people[sample['group']]:
                continue
            sample_active = protein_h[:, j]>0
            groups, method = mcl_active(graph, sample_active)
            v = build_view('sample-'+sample['id'], sample['id']+' · Active Families', groups,
                           [f'PAT{i+1:05d}' for i in range(len(groups))], records, graph, mapping,
                           hits, observed, sample_active, False, directory)
            v['method'] = method
            assay['sample_views'][sample['id']] = v
        for key, info in categories.items():
            groups = [c['proteins'] for c in info['categories']]
            matrix = union_matrix(groups, mapping)
            ev = evidence(matrix, hits, observed)
            nodes = [{**category, **{k: v[i] for k,v in ev.items()}} for i,category in enumerate(info['categories'])]
            assay['annotations'][key] = dict(label=info['label'], nodes=nodes)
        # Export all sample evidence with measured denominators, including quiet
        # categories; adaptive families have empty p/BH by design.
        def evidence_rows():
            views = assay['views'] + list(assay['sample_views'].values())
            views += [dict(id=k, nodes=v['nodes']) for k,v in assay['annotations'].items()]
            for view in views:
                for node in view['nodes']:
                    for j,s in enumerate(samples):
                        yield dict(view=view['id'], node=node['id'], label=node['label'], sample=s['id'], group=s['group'],
                                   visit=s['visit'], hits=node['h'][j], measured=node['n'][j],
                                   p=node.get('p',['']*len(samples))[j], bh=node.get('q',['']*len(samples))[j])
        write_csv(directory/'sample-evidence.csv.gz', evidence_rows(),
                  ['view','node','label','sample','group','visit','hits','measured','p','bh'])
        write_csv(directory/'samples.csv', samples, list(samples[0]))
        write_csv(directory/'assay-to-reference.csv.gz',
                  (dict(antigen_id=features[f]['antigen_id'], source_id=features[f]['source_id'], reference=records[p]['source'])
                   for p in range(len(records)) for f in mapping[p].indices), ['antigen_id','source_id','reference'])
        # Whole-cohort counts are unions, not sums over overlapping proteins.
        summaries[platform] = dict(samples=len(samples), retained_features=len(features),
              mapped_features=len(np.unique(mapping.indices)), hit_features=int(hits.any(axis=1).sum()),
              active_reference_proteins=int(active.sum()), reference=fixed['stats'], active=adaptive['stats'],
              active_mcl=active_method, sample_local={k:v['stats'] for k,v in assay['sample_views'].items()},
              annotations={k:len(v['nodes']) for k,v in assay['annotations'].items()})
        data['assays'][platform] = assay
    payload = json.dumps(data, separators=(',', ':'), ensure_ascii=False)
    (out/'review-data.json').write_text(payload, encoding='utf-8')
    (out/'review-data.js').write_text('const REVIEW_DATA='+payload+';\n', encoding='utf-8')
    (out/'summary.json').write_text(json.dumps(summaries, indent=2), encoding='utf-8')
    template = Path(__file__).with_name('human_assembly_review.html').read_text(encoding='utf-8')
    (out/'index.html').write_text(template, encoding='utf-8')
    (out/'README.txt').write_text(readme(data, summaries), encoding='utf-8')
    log(stage='complete', output=str(out), summaries=summaries)


def readme(data, summaries):
    return f'''Human Sequence Assembly · Local Review
Study: {data['study']}

Reference Sequence Families: fixed MCL families derived without assay calls from
the full human–human graph. Study-Active Sequence Families: the graph induced by
human reference proteins with at least one qualifying mapped antigen hit in the
selected study, reclustered with the same MCL settings. Sample-active examples
repeat this within one naturally selected participant per study group at each
visit. No community count is prescribed. Reference IDs are from the supplied
reference run; ACT/PAT IDs are local to each assay/view and are not shared labels.

Human–human links: ≥{data['identity']}/9 and ≥{data['coverage']}% statistical coverage
on either protein. Weight is the harmonic mean of the two exact residue-coverage
fractions. MCL: expansion 2, inflation 2, self-loop weight 1, pruning 0.001 including
initial pruning; convergence required. Cross-family links retain original sequence
evidence. Network layout uses weighted Fruchterman–Reingold, seed 17, followed
by rank spacing of each coordinate to avoid compression by disconnected outliers.
Distances are not numerical similarity estimates. Positions
remain fixed across sample selections within a study view; layouts from separately
reclustered samples are not directly comparable by position.

Assay membership: existing HuProt-to-human mapping, ≥{data['identity']}/9 with
≥{data['coverage']}% coverage of the assay antigen. HuProt source IDs are matched
through unambiguous installed aliases after removal of the printed position suffix,
as in Reactivity Enrichment. IgG and IgA are separate. Deleted features, unavailable
calls, platform-absent samples, technical replicates and assay controls are excluded.
Lean is a biological comparison group and is retained. No calls are recalculated.

A protein is 'active' when at least one mapped retained assay antigen has a recorded
hit. This is sequence-supported evidence, not proof that each mapped protein is an
independently recognized antigen. Each family/category uses the UNION of its assay
antigen IDs: one antigen is counted once within a set, even if it maps to several
proteins. The same antigen may belong to multiple sets. Sample counts and percentages
use observed calls, never missing values as negatives. Node size represents the number of
study-active reference proteins; color is mean per-sample hit/observed antigen fraction.

Reference-family and annotation enrichment: one-sided hypergeometric tail (equivalent
to one-sided Fisher enrichment), using all retained assay antigens with observed calls
in that sample as background. BH is applied separately per sample, assay and complete
measured set collection, BEFORE hiding inactive sets. Group panels show observed
fractions and the fraction of samples passing Sample BH <0.01, not a group comparison
p-value. Sample-active and study-active partitions have no p/BH: they were selected
using those same hits. Overlapping or homologous assay antigens are not independent
antibody specificities. All views in this review are evidence summaries; sequence
connections must not be read as empirically estimated cross-patient correlations.

Annotation views use the installed HPA molecular function, protein class and primary
subcellular location collections. Categories join the canonical reference's gene,
never the assay label. All recorded memberships remain; category totals cannot be
added. Proteins without an annotation are reported separately. The radial strips
contain one mark per study-active protein/category membership, ordered identically
across selected samples; they are not a fabricated ontology tree.

Files
index.html + review-data.js: offline interactive review, sample/group/visit selectors,
node drilldown, dark/light appearance, SVG/PNG and current-evidence CSV export.
review-data.json: complete review data, recorded feature calls and observed masks,
assay membership, protein memberships, sample vectors, layouts and methods.
summary.json: actual counts and clustering summaries per assay.
<assay>/sample-evidence.csv.gz: view, set ID, label, sample, group, visit, union hit
count, union observed count, one-sided p and BH (blank for active-derived sets).
<assay>/assay-to-reference.csv.gz: retained antigen_id/source_id to canonical accession.
<assay>/*-nodes.csv: set IDs, representative names, protein counts and accessions.
<assay>/*-links.csv.gz: family endpoints, number of protein links, summed and maximum
harmonic-coverage weights. Shared observations do not create sequence edges.
<assay>/samples.csv: sample identity, group, participant, family, member and visit.

Sources (read-only)
''' + '\n'.join(k+': '+v for k,v in data['sources'].items())+'\n'


if __name__ == '__main__':
    main()
