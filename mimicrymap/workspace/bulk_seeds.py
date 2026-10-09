"""Retained MimicryOne bulk builder's exact >=7/9 covering seed family.

Adapted from analysis_ready/mimicry_edges.py (M7_SEEDS and
first_eligible_seed_table), used by native_human_gpu_positions.py. Every pair
with at most two mismatches has an exact seed. The first eligible seed owns
each coordinate pair; duplicate sequence occurrences remain distinct.
"""

M7_SEEDS = (
    (0, 1, 2, 3, 4, 5), (0, 1, 2, 3, 6, 7),
    (0, 1, 2, 4, 6, 8), (0, 1, 2, 5, 7, 8),
    (0, 1, 3, 4, 7, 8), (0, 1, 3, 5, 6, 8),
    (0, 1, 4, 5, 6, 7), (2, 3, 4, 5, 6, 7),
    (0, 2, 3, 4, 5, 8), (0, 2, 3, 6, 7, 8),
    (0, 4, 5, 6, 7, 8), (1, 2, 3, 4, 5, 8),
    (1, 2, 3, 6, 7, 8), (1, 4, 5, 6, 7, 8),
)


def first_eligible_seed_table():
    table = []
    for mask in range(512):
        owner = next((i for i, seed in enumerate(M7_SEEDS)
                      if all(not (mask & (1 << col)) for col in seed)), 255)
        if mask.bit_count() <= 2 and owner == 255:
            raise AssertionError("Incomplete 7/9 covering seed family")
        table.append(owner)
    return table
