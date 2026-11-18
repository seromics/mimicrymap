# Sequence Mappings for Downstream Analysis

MimicryMap produces sequence comparisons, coverage and reusable antigen sets. A separate analysis could combine those sets with antibody measurements to test whether a sample's hits concentrate among antigens matching a chosen protein or proteome. The sequence comparison itself does not calculate antibody reactivity or statistical significance.

## Define Sets Before Testing Reactivity

Choose the reference population, core-identity floor and coverage rule before inspecting sample hits. Join memberships to measurements using the original assay record IDs. Count each antigen once within a set, even when it matches several proteins from the same proteome. Memberships may overlap across sets. Distinct assay records must not be collapsed by gene name or a shared sequence label.

For each sample and assay, retain measured antigens with no hit and distinguish them from unmeasured antigens. Let N be the number measured, H the total recorded hits, M the measured members of a set, and h the hits in that set. Expected set hits are H × M / N; fold enrichment is h / (H × M / N). If the expected count is zero, that ratio is undefined.

## Optional Statistical Analysis

A one-sided Fisher test could compare hits and measured non-hits inside and outside the set. Its two rows are [h, M − h] and [H − h, N − M − H + h]. Benjamini–Hochberg correction could then be applied across a declared family of eligible reference sets within each sample and assay. A recorded hit and significant set enrichment are different outcomes.

Cohort, paired-sample and longitudinal comparisons require separate tests appropriate to their observation units and study design. Their correction families and eligibility rules must be stated independently of the per-sample tests. Display filtering must not redefine a tested family after correction.

## Reuse the Saved Evidence

Use exact record identities, coverage rules and measured populations when joining these outputs to another analysis. Rounded summary lists cannot supply pairs below the saved reporting floor; a lower cutoff requires a suitable comparison. See [Summary Downloads](SUMMARY-DOWNLOADS.md) and [Build Libraries](BUILD.md).

This describes a potential use of MimicryMap outputs, not an included cohort-analysis workflow or a patient-data result. Sequence membership alone does not establish shared antibody binding or a unique exposure source.
