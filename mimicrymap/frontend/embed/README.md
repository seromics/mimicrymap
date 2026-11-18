# MimicryMap Embeddable Viewer

Created by Tyler Hulett, PhD · [GitHub](https://github.com/seromics) · [X](https://x.com/seromics) · [LinkedIn](https://www.linkedin.com/in/tyler-hulett-2a716618/).

Citation: Tyler W. Hulett. *MimicryMap*. https://github.com/seromics/mimicrymap.
Original software: MIT. Copyright (c) 2026 Tyler Hulett.

Serve this directory with any static HTTP server. Open `examples/index.html`
for a FASTA comparison, or `examples/annotations.html` for optional pLDDT and
structure. No database, installed reference library or backend API is needed.
Opening the HTML through `file://` is not supported: workers and modules require HTTP.

The small IL10 comparison is immediately usable. The optional standard reference
preset is Human Canonical + 120 Viral Proteomes (15.23 MB of FASTAs). Its Zenodo
downloads come from the [published Zenodo dataset](https://doi.org/10.5281/zenodo.24046306); local copies also work through the file selectors. Large mapping and structure collections stay separate. See
[Reference options and sizes](examples/REFERENCE-LIBRARIES.md).

```js
import {createViewer} from './mimicrymap.mjs';
const viewer = createViewer(document.querySelector('#viewer'));
await viewer.compare({targetFasta, parentFasta, minimumIdentity: 7});
```

Give the container an explicit height, for example `height: 820px`. The native
viewer scrolls inside it. Each instance uses an isolated iframe, preserving its
styles, worker lifetime and native layout. `viewerUrl` can override the default
`viewer/index.html` location. The frame can be served on a separate origin when
the host's frame policy permits it. No wildcard message origin is used.

## API

| Method | Meaning |
| --- | --- |
| `ready` | Promise resolved when the native viewer is initialized |
| `compare({targetFasta,parentFasta,minimumIdentity,targetIndex,assets,parentLabel})` | Complete local scan of the selected target against every supplied parent; returns a portable result |
| `getResult()` | Current complete result, suitable for saving as JSON |
| `loadResult(result)` | Reopen a result produced by this viewer, without scanning again |
| `setTracks(keys)` | Show supported supplied lanes: `plddt`, `rsasa`, `surface`, `topology`, `variants`, `cleavage_epitope` |
| `setView('explorer' or 'residues')` | Native Compact or Full sequence view |
| `selectWindow(start)` | Select a 1-based target core start |
| `setTheme('light' or 'dark')` | Change viewer appearance |
| `export(kind)` | Return `{filename,blob}` from the shared exporter: `matches`, `site`, `parents`, `summary`, `code` or `figures` |
| `cancel()` | Cancel unfinished matching; retain the completed view |
| `destroy()` | Remove the instance and its workers; reject pending operations |

All methods except `destroy()` and event subscriptions return promises. Subscribe
to `progress` with `addEventListener`; its detail contains a status `message`.
The native export buttons download directly. The API returns the same files so
the host can choose where to save them. Figure bundles include PNG/SVG panels,
fonts and captured appearance; Code exports retain the input population and
the existing runnable pipeline. No export calculation is reimplemented here.

`minimumIdentity` is an integer 5–9, default 7. `targetIndex` is a zero-based
record index, default 0. A multi-target FASTA is selectable one target at a time;
this viewer does not silently run a whole-library build. Duplicate sequence
records remain separate. Supplied parent records shorter than nine residues
are retained in the input population but have no searchable windows.

The browser scanner enumerates window pairs in workers. Use modest populations
interactively; the indexed CPU/GPU research builder serves larger computations.
Summary-only SQLite files are not complete positional viewer results. This API
does not imply that every bulk-builder output can be loaded as a viewer JSON.

## Optional Assets

Pass `assets` with the exact normalized target `sequence`, optional `annotations`,
optional PDB text in `pdb`, and source attribution in `provenance`. Missing assets
produce no tracks or structure requests. Tracks are never borrowed by accession.

Numeric arrays contain one entry per target residue, with `null` for unavailable
values: `plddt` uses 0–100; `rsasa` and `cleavage_epitope` use 0–1. Binary masks
(`surface`, `extracellular`, `transmembrane`, `intracellular`) use strings of
`0`, `1` or `?`. Variants use `{pos,ref,alt,cat}` with 1-based `pos` and category
`LP/P`, `LB/B` or `US`; optional disease/source identifiers are retained.

The first structure interface accepts one PDB chain, using target residue numbers
directly, without insertion codes. Partial models are allowed when their residue
identities and numbers match. Remap an offset or differently numbered model before
supplying it. Confidence is optional and is not inferred from arbitrary PDB B-factors.

Assets are checked before replacing the displayed result and travel with saved
viewer JSON. The example model has its own CC BY 4.0 terms; see
`examples/PROVENANCE.md`. MIT applies to the original software, not to source data,
models or bundled third-party fonts.
