# MimicryMap development

Read README.md and docs/DEVELOPMENT.md for inputs, methods and build commands.
Keep the repository private until publication is authorized; license and
citation terms are recorded separately.

Shared sources in mimicrymap/ are promoted from SeroMap Electron through
tools/sync-upstream.cjs. source-manifest.json records their origin and hashes.
code/ is generated from those sources. Change shared behavior in its owning
module, then promote it; do not edit generated copies independently.

Interface text explains data, actions and results. Comments and contributor
instructions describe behavior and constraints, without development conversations
or tool attribution. Preserve authored methods, examples, figures and source terms.

Keep FASTAs, private studies, databases, caches, CUDA environments and large
archives outside Git. Use disposable test directories, remove generated QA
output after use, and retain test source and small fixtures. Never test writes
in an active user workspace or modify installed reference packs during promotion.

## Cleanup Review

When approval review blocks file cleanup, report the affected paths and the
stated reason for human review. Do not retry the blocked deletion through another
tool or shell. After human review approves the cleanup scope, prefer a reversible
move into `to delete/<date>-<purpose>/` within the relevant project or staging
root. Existing explicit approval covering those files remains applicable; do not
ask for the same approval again.

Before moving, verify resolved source and destination paths, check for active
process owners and live dependencies, and exclude running builds, partial outputs,
studies and required source data. Preserve filenames and relative paths, avoid
overwriting, and add a short note recording original locations and why the files
were staged so they can be restored. Moving must itself be permitted: if blocked,
leave the files in place and report the restriction. Staging is not a permissions
bypass. Permanent deletion requires a separate later human decision; do not
automatically purge `to delete`.
