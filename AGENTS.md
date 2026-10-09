# MimicryMap release staging

This is the private research release repository, continuing the existing
illustrated MimicryMap pipeline. Read README.md and docs/DEVELOPMENT.md.
Preserve the author's methods, examples and figures. No public license or
publication is implied by staging code here.

The shared engine and applet in mimicrymap/ are promoted from the SeroMap
desktop checkout through tools/sync-upstream.cjs. source-manifest.json records
exact files and their origin. code/ is the generated portable CPU package view
of the same sources, not an independently maintained implementation. Change
shared science in its owning source and promote deliberately. Never overwrite
the website checkout or installed reference packs during a promotion.

Keep FASTAs, private studies, library databases, caches, CUDA environments and
large atlas archives outside Git. Preserve input licenses and attribution.
Use temporary directories for checks and remove generated QA output when done;
retain test source and small synthetic fixtures. Never test writes in an active
user workspace. A source snapshot does not certify an entire historical atlas.
