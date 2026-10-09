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
