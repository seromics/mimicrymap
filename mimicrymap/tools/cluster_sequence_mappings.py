"""Explore a self-comparison as weighted sequence communities, without a set count.

Reads a unified MimicryMap comparison read-only. No ontology or study reactions
enter clustering. Output includes every reference record, including isolates.
Dependencies: igraph, leidenalg, matplotlib (with numpy); MCL also uses
markov-clustering and scipy. The output records the installed versions.
"""
import argparse
import csv
import gzip
import importlib.metadata
import json
import math
from pathlib import Path
import sqlite3
import sys
import time

import igraph as ig
import leidenalg as la
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
import numpy as np


def cluster_graph(graph, args):
    if args.algorithm == "leiden":
        partition = la.find_partition(graph, la.RBConfigurationVertexPartition, weights="weight",
                                      resolution_parameter=args.resolution, seed=args.seed, n_iterations=-1)
        return list(partition), dict(algorithm="Leiden RBConfiguration", resolution=args.resolution,
                                    seed=args.seed, iterations="until no improvement")
    import markov_clustering as mc
    from scipy.sparse import csc_matrix
    edge = np.array(graph.get_edgelist(), dtype=int)
    weight = np.array(graph.es["weight"])
    matrix = csc_matrix((np.r_[weight, weight],
                         (np.r_[edge[:, 0], edge[:, 1]], np.r_[edge[:, 1], edge[:, 0]])),
                        shape=(graph.vcount(), graph.vcount()))
    matrix = mc.normalize(mc.add_self_loops(matrix, 1))
    # Standard sparse-flow pruning, also applied before the first expansion to
    # bound memory for high-degree proteins. Original edges remain in exports.
    matrix = mc.prune(matrix, .001).tocsc()
    converged = False
    for iteration in range(1, 201):
        previous = matrix
        matrix = mc.prune(mc.iterate(matrix, 2, args.inflation), .001).tocsc()
        if iteration == 1 or iteration % 10 == 0:
            print(json.dumps(dict(stage="mcl", iteration=iteration, nonzero=matrix.nnz)), flush=True)
        if mc.converged(matrix, previous):
            converged = True
            break
    if not converged:
        raise RuntimeError("MCL did not converge in 200 iterations; do not publish a partial partition")
    groups = mc.get_clusters(matrix)
    assigned = [v for group in groups for v in group]
    if sorted(assigned) != list(range(graph.vcount())):
        raise RuntimeError("MCL attractors do not form a complete disjoint partition")
    return groups, dict(algorithm="Markov clustering", inflation=args.inflation, expansion=2,
                        self_loop_weight=1, pruning_threshold=.001, initial_pruning=True,
                        iterations=iteration, converged=converged)


def write_csv(path, rows, columns):
    opener = gzip.open if str(path).endswith(".gz") else open
    with opener(path, "wt", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def read_graph(path, identity, coverage):
    db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    records = []
    sides = [{}, {}]
    source_index = {}
    for side, key, source, length, sha, metadata in db.execute(
            "SELECT side,id,source,length,sha256,metadata FROM sequence_records ORDER BY side,source"):
        metadata = json.loads(metadata)
        if side == 0:
            if source in source_index:
                raise ValueError("Duplicate record source; resolve stable record identity before clustering")
            source_index[source] = len(records)
            records.append(dict(source=source, gene=metadata.get("gene", ""),
                                description=metadata.get("protein_name", metadata.get("description", "")),
                                length=length, sha256=sha))
        elif source not in source_index or records[source_index[source]]["sha256"] != sha:
            raise ValueError("Both sides must contain the same source records and sequences")
        sides[side][key] = source_index[source]
    if len(sides[0]) != len(sides[1]):
        raise ValueError("A complete self-comparison is required")
    edges = {}
    rows = self_rows = mirrored_rows = 0
    for a, b, ac, bc in db.execute(
            "SELECT a,b,ac,bc FROM mapping_pairs WHERE identity=? AND (stats_ac>=? OR stats_bc>=?)",
            (identity, coverage, coverage)):
        rows += 1
        a, b = sides[0][a], sides[1][b]
        if a == b:
            self_rows += 1
            continue
        if b < a:
            a, b, ac, bc = b, a, bc, ac
        if not (math.isfinite(ac) and math.isfinite(bc) and 0 < ac <= 100 and 0 < bc <= 100):
            raise ValueError("Invalid mapped-residue coverage")
        weight = 2 * ac * bc / (ac + bc) / 100
        key = (a, b)
        if key in edges:
            mirrored_rows += 1
            previous = edges[key]
            if max(abs(previous[1] - ac), abs(previous[2] - bc)) > 1e-5:
                raise ValueError("Reciprocal mappings disagree in coverage; do not average conflicting evidence")
        else:
            edges[key] = (weight, ac, bc)
    db.close()
    ordered = sorted(edges)
    graph = ig.Graph(n=len(records), edges=ordered, directed=False)
    graph.es["weight"] = [edges[e][0] for e in ordered]
    return records, graph, edges, dict(selected_rows=rows, self_rows_removed=self_rows,
                                     reciprocal_rows_collapsed=mirrored_rows)


def plot_summary(out, records, edges, membership, groups, summaries, stats):
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10,
                         "svg.fonttype": "none", "axes.spines.top": False,
                         "axes.spines.right": False})
    order = [i for group in groups for i in group]
    position = np.empty(len(order), dtype=int)
    position[order] = np.arange(len(order))
    endpoints = np.array(list(edges), dtype=int)
    weights = np.array([edges[e][0] for e in edges])
    # Paint weaker matches first so narrow strong similarities remain visible.
    paint = np.argsort(weights, kind="stable")
    endpoints, weights = endpoints[paint], weights[paint]
    fig = plt.figure(figsize=(15, 10), layout="constrained", facecolor="white")
    layout = fig.add_gridspec(2, 2, width_ratios=[1.55, 1])
    ax = fig.add_subplot(layout[:, 0])
    colors = LinearSegmentedColormap.from_list("mimicry", ["#dce8ec", "#427ba6", "#087d73"])
    marks = ax.scatter(np.r_[position[endpoints[:, 0]], position[endpoints[:, 1]]],
                       np.r_[position[endpoints[:, 1]], position[endpoints[:, 0]]],
                       c=np.r_[weights, weights], cmap=colors, vmin=0, vmax=1,
                       s=.14, linewidths=0, marker="s", rasterized=True)
    ax.set(xlim=(-.5, len(records)-.5), ylim=(len(records)-.5, -.5), aspect="equal",
           xlabel="Reference proteins ordered by sequence community",
           ylabel="Same reference order", title="All Retained Human–Human Matches")
    fig.colorbar(marks, ax=ax, fraction=.035, pad=.025, shrink=.6,
                 label="Edge weight · harmonic mean of coverage fractions")
    ax = fig.add_subplot(layout[0, 1])
    largest = summaries[:15][::-1]
    labels = [f"{r['cluster_id']} · {r['representative_gene'] or r['representative_source']}" for r in largest]
    ax.barh(labels, [r["proteins"] for r in largest], color="#427ba6")
    for i, row in enumerate(largest):
        ax.text(row["proteins"], i, f"  {row['proteins']:,}", va="center", fontsize=9)
    ax.margins(x=.17)
    ax.set(xlabel="Proteins", title="Largest Communities · Representative Protein")
    ax = fig.add_subplot(layout[1, 1])
    bins = [1, 2, 3, 6, 11, 21, 51, 101, 501, float("inf")]
    labels = ["1", "2", "3–5", "6–10", "11–20", "21–50", "51–100", "101–500", ">500"]
    counts = [sum(lo <= len(g) < hi for g in groups) for lo, hi in zip(bins, bins[1:])]
    ax.bar(labels, counts, color="#087d73")
    ax.tick_params(axis="x", rotation=40)
    ax.set(xlabel="Proteins per community", ylabel="Communities", title="Complete Size Distribution")
    for i, value in enumerate(counts):
        ax.text(i, value, f"{value:,}", ha="center", va="bottom", fontsize=9)
    ax.margins(y=.17)
    fig.suptitle(f"Human MimicryMap Sequence Assembly · ≥{stats['identity']}/9 · ≥{stats['coverage_min']}% on Either Side\n"
                 f"{len(records):,} proteins · {len(edges):,} links · {stats['multi_protein_communities']:,} multi-protein communities + "
                 f"{stats['singleton_communities']:,} singletons", fontsize=15, fontweight="bold")
    fig.savefig(out / "assembly-overview.png", dpi=180)
    fig.savefig(out / "assembly-overview.svg")
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--identity", type=int, default=7, choices=[7, 8, 9])
    parser.add_argument("--coverage", type=float, default=10)
    parser.add_argument("--resolution", type=float, default=1)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--algorithm", choices=["leiden", "mcl"], default="leiden")
    parser.add_argument("--inflation", type=float, default=2)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    started = time.time()
    records, graph, edges, counts = read_graph(args.database, args.identity, args.coverage)
    print(json.dumps(dict(stage="graph", proteins=len(records), edges=len(edges), **counts)), flush=True)
    partition, algorithm = cluster_graph(graph, args)
    groups = sorted((sorted(g) for g in partition), key=lambda g: (-len(g), records[g[0]]["source"]))
    membership = [None] * len(records)
    for cluster, group in enumerate(groups):
        for i in group:
            membership[i] = cluster
    cluster_ids = [f"MMH{i+1:05d}" for i in range(len(groups))]
    degree = graph.degree()
    strength = graph.strength(weights="weight")
    internal_strength = [0.] * len(records)
    internal_degree = [0] * len(records)
    inside_edges = [0] * len(groups)
    inside_weight = [0.] * len(groups)
    links = {}
    for (a, b), (weight, ac, bc) in edges.items():
        ca, cb = membership[a], membership[b]
        if ca == cb:
            inside_edges[ca] += 1
            inside_weight[ca] += weight
            internal_strength[a] += weight
            internal_strength[b] += weight
            internal_degree[a] += 1
            internal_degree[b] += 1
        else:
            key = tuple(sorted((ca, cb)))
            entry = links.setdefault(key, [0, 0., 0.])
            entry[0] += 1
            entry[1] += weight
            entry[2] = max(entry[2], weight)
    summaries = []
    for c, group in enumerate(groups):
        group.sort(key=lambda i: (-internal_strength[i], records[i]["source"]))
        representative = records[group[0]]
        total_strength = sum(strength[i] for i in group)
        summaries.append(dict(cluster_id=cluster_ids[c], proteins=len(group),
                              representative_source=representative["source"],
                              representative_gene=representative["gene"],
                              top_genes="; ".join(records[i]["gene"] or records[i]["source"] for i in group[:8]),
                              internal_edges=inside_edges[c],
                              external_edges=sum(degree[i] for i in group)-2*inside_edges[c],
                              internal_weight=inside_weight[c],
                              internal_weight_fraction=2*inside_weight[c]/total_strength if total_strength else "",
                              density=2*inside_edges[c]/(len(group)*(len(group)-1)) if len(group)>1 else ""))
    write_csv(out / "clusters.csv", summaries, list(summaries[0]))
    rows = [dict(cluster_id=cluster_ids[membership[i]], cluster_size=len(groups[membership[i]]),
                 source=record["source"], gene=record["gene"], description=record["description"],
                 length=record["length"], degree=degree[i], internal_degree=internal_degree[i],
                 weighted_degree=strength[i], internal_weight=internal_strength[i],
                 internal_weight_fraction=internal_strength[i]/strength[i] if strength[i] else "")
            for group in groups for i in group for record in [records[i]]]
    write_csv(out / "protein-membership.csv", rows, list(rows[0]))
    write_csv(out / "sequence-edges.csv.gz",
              (dict(source_a=records[a]["source"], source_b=records[b]["source"],
                    cluster_a=cluster_ids[membership[a]], cluster_b=cluster_ids[membership[b]],
                    coverage_a=ac, coverage_b=bc, weight=weight)
               for (a, b), (weight, ac, bc) in edges.items()),
              ["source_a", "source_b", "cluster_a", "cluster_b", "coverage_a", "coverage_b", "weight"])
    write_csv(out / "between-cluster-links.csv",
              (dict(cluster_a=cluster_ids[a], cluster_b=cluster_ids[b], edges=v[0],
                    total_weight=v[1], strongest_weight=v[2]) for (a, b), v in sorted(links.items())),
              ["cluster_a", "cluster_b", "edges", "total_weight", "strongest_weight"])
    components = graph.connected_components()
    stats = dict(proteins=len(records), edges=len(edges), **counts, identity=args.identity,
                 coverage_min=args.coverage, coverage_side="either", **algorithm,
                 communities=len(groups), multi_protein_communities=sum(len(g)>1 for g in groups),
                 singleton_communities=sum(len(g)==1 for g in groups), isolates=sum(d==0 for d in degree),
                 connected_components=len(components), largest_connected_component=max(components.sizes()),
                 largest_community=len(groups[0]), median_non_singleton_size=float(np.median([len(g) for g in groups if len(g)>1])),
                 internal_edge_fraction=sum(inside_edges)/len(edges),
                 internal_weight_fraction=sum(inside_weight)/sum(v[0] for v in edges.values()),
                 weighted_modularity=graph.modularity(membership, weights="weight", resolution=args.resolution),
                 input_database=str(args.database.resolve()),
                 versions={p:importlib.metadata.version(p) for p in ["igraph", "leidenalg", "numpy", "matplotlib"] +
                           (["markov-clustering", "scipy"] if args.algorithm=="mcl" else [])})
    examples = {}
    for gene in ["EPN1", "EPN2", "EPN3", "CLINT1", "RBPJ", "RBPJL", "HSP90AA1", "HSP90AB1"]:
        examples[gene] = [dict(cluster_id=cluster_ids[membership[i]], size=len(groups[membership[i]]),
                              top_genes=summaries[membership[i]]["top_genes"])
                          for i, r in enumerate(records) if r["gene"]==gene]
    stats["examples"] = examples
    print(json.dumps(dict(stage="clustered", **{k:stats[k] for k in ["communities", "multi_protein_communities", "singleton_communities", "largest_community", "internal_weight_fraction"]})), flush=True)
    plot_summary(out, records, edges, membership, groups, summaries, stats)
    stats["seconds"] = round(time.time()-started, 2)
    (out / "summary.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")
    algorithm_method = (f"Leiden RBConfiguration, resolution {args.resolution:g}, seed {args.seed}, runs until\n"
                        "an iteration makes no improvement. Resolution is a granularity parameter, not a\nrequested count."
                        if args.algorithm == "leiden" else
                        f"Markov clustering uses inflation {args.inflation:g}, expansion 2, self-loop weight 1,\n"
                        "column normalization, and sparse pruning at 0.001 retaining each column maximum.\n"
                        "Pruning occurs before initial expansion and after each inflation. The original\n"
                        "unpruned graph remains in the exported edges and summaries. Clustering converged\n"
                        f"after {algorithm['iterations']} iterations. Inflation controls granularity, not a requested count.")
    method = f"""Human MimicryMap Sequence Assembly

{len(records):,} reference records; {len(edges):,} undirected sequence links.
{stats['multi_protein_communities']:,} multi-protein communities and {stats['singleton_communities']:,} singletons.

METHOD
The prebuilt self-comparison supplies cumulative >= {args.identity}/9 core identity matches.
Membership requires >= {args.coverage:g}% statistical coverage on either protein.
Both proteins' exact mapped-residue coverage fractions cA,cB define the symmetric
weight 2*cA*cB/(cA+cB). Asymmetric partial matches are retained with lower weight.
Each accession is retained as one record; different accessions with identical
sequences remain distinct. Self-links are removed. Reciprocal rows become one
undirected edge after checking coverage agreement. No ontology, sample values,
hit calls, protein-family annotation or preset cluster count enters clustering.
{algorithm_method}
This is an exploratory partition, not validated family truth.
All reference records remain present, including isolates. Cluster IDs are local
to this run, ordered by descending size then accession. They are not permanent IDs.
Whole-protein graph grouping does not establish that all members share the same
sequence region. The saved merged ranges are independent residue unions, not
matched-window correspondences; regional subfamilies require additional analysis.
No new sequence matching is performed. Links absent below the prebuilt 10%
either-side floor are unavailable here, not proof of no shared sequence.

FILES AND COLUMNS
protein-membership.csv: one row per original reference record. source is its
accession; gene and description are recorded annotations; length is amino acids.
degree/internal_degree count all/within-community distinct neighbors.
weighted_degree/internal_weight sum corresponding edge weights.
internal_weight_fraction = internal_weight / weighted_degree; blank for isolates.
clusters.csv: one row per community. Representative and top_genes use descending
within-community weighted degree; these are identifiers, not biological labels.
internal_edges counts each within-community pair once; external_edges counts
links to other communities. internal_weight sums each internal edge once.
internal_weight_fraction = twice internal_weight / sum of member weighted degrees.
density is internal_edges divided by all possible unordered pairs; blank for singletons.
sequence-edges.csv.gz: every retained non-self pair, both coverage percentages,
harmonic weight (0-1), and assigned communities. Cross-community links are kept.
between-cluster-links.csv: number, summed weight and strongest weight of links
between each pair of communities. These are summaries, not significance tests.
summary.json: full settings, software versions, counts and example assignments.

FIGURE LEGEND
Left: every retained pair is drawn symmetrically in the same protein ordering on
both axes. Communities are ordered by size; proteins within them by internal
weighted degree. Color encodes the harmonic coverage weight, not p or identity.
Strong edges paint last. Self-links are absent. The dense matrix layer is rasterized
in SVG; labels and summary charts remain vector. Upper right: largest 15 communities,
labeled by representative protein. Lower right: all community sizes, including singletons.

REPRODUCE
Python packages and versions are in summary.json. Command:
{sys.executable} {' '.join(sys.argv)}

Leiden: https://www.nature.com/articles/s41598-019-41695-z
MCL: https://academic.oup.com/nar/article/30/7/1575/2376029
"""
    (out / "README.txt").write_text(method, encoding="utf-8")
    print(json.dumps(dict(stage="complete", output=str(out), seconds=stats["seconds"], examples=examples)), flush=True)


if __name__ == "__main__":
    main()
