"""Complete covering seed families for nine-residue identity searches.

Adapted from analysis_ready/mimicry_edges.py (M7_SEEDS and
first_eligible_seed_table), used by native_human_gpu_positions.py. Every pair
with at most two mismatches has an exact seed. The first eligible seed owns
each coordinate pair; duplicate sequence occurrences remain distinct.
The 5/9 and 6/9 families use deterministic greedy covers of all minimum-size
match masks. Every candidate is still checked at all nine positions.
"""

from functools import lru_cache
from itertools import combinations

M7_SEEDS = (
    (0, 1, 2, 3, 4, 5), (0, 1, 2, 3, 6, 7),
    (0, 1, 2, 4, 6, 8), (0, 1, 2, 5, 7, 8),
    (0, 1, 3, 4, 7, 8), (0, 1, 3, 5, 6, 8),
    (0, 1, 4, 5, 6, 7), (2, 3, 4, 5, 6, 7),
    (0, 2, 3, 4, 5, 8), (0, 2, 3, 6, 7, 8),
    (0, 4, 5, 6, 7, 8), (1, 2, 3, 4, 5, 8),
    (1, 2, 3, 6, 7, 8), (1, 4, 5, 6, 7, 8),
)


@lru_cache(maxsize=5)
def seeds_for_floor(floor):
    if floor not in (5, 6, 7, 8, 9):
        raise ValueError("Identity must be 5/9–9/9.")
    if floor >= 7:
        return M7_SEEDS
    # A weight-(floor-1) seed is more selective than short contiguous blocks.
    # Cover every floor-position match mask; all higher identities contain one.
    patterns = {sum(1 << col for col in cols)
                for cols in combinations(range(9), floor)}
    candidates = tuple(combinations(range(9), floor - 1))
    coverage = {seed: {mask for mask in patterns
                       if all(mask & (1 << col) for col in seed)}
                for seed in candidates}
    selected = []
    while patterns:
        seed = max(candidates, key=lambda item: len(coverage[item] & patterns))
        if not coverage[seed] & patterns:
            raise AssertionError("Incomplete covering seed candidates")
        selected.append(seed)
        patterns -= coverage[seed]
    return tuple(selected)


def first_eligible_seed_table(floor=7):
    seeds = seeds_for_floor(floor)
    table = []
    for mask in range(512):
        owner = next((i for i, seed in enumerate(seeds)
                      if all(not (mask & (1 << col)) for col in seed)), 255)
        if mask.bit_count() <= 9 - floor and owner == 255:
            raise AssertionError(f"Incomplete {floor}/9 covering seed family")
        table.append(owner)
    return table
