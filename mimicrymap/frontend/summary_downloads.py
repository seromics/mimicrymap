"""Build small public download link blocks from the verified staging manifest."""
from pathlib import Path
from html import escape
import json,re
from public_downloads import public_url
ROOT=Path(__file__).resolve().parents[1]
def sync_guide(check=False):
 """Keep the public guide synchronized without restaging any data payloads."""
 source=ROOT/'docs/public/summary-download-guide.md'
 destination=ROOT/'frontend/source-downloads/mimicry-summaries/summary-guide.md'
 content=source.read_bytes()
 current=destination.exists() and destination.read_bytes()==content
 if check and not current:
  raise ValueError('Summary download guide is stale; run python frontend/public_sections.py')
 if not check and not current:
  import os,tempfile
  destination.parent.mkdir(parents=True,exist_ok=True)
  with tempfile.NamedTemporaryFile(dir=destination.parent,prefix='.summary-guide-',delete=False) as handle:
   temporary=Path(handle.name)
   handle.write(content)
  try:os.replace(temporary,destination)
  finally:temporary.unlink(missing_ok=True)
 return current

def size(n):return f'{n/1e9:.1f} GB' if n>=1e9 else f'{n/1e6:.1f} MB' if n>=1e6 else f'{n/1e3:.0f} KB'
def render(source):
 if '<!-- summary-' not in source and '<!-- public-downloads -->' not in source:return source
 source=source.replace('<!-- public-downloads -->',(ROOT/'docs/public/downloads.html').read_text(encoding='utf-8'))
 m=json.loads((ROOT/'frontend/summary-downloads.json').read_text(encoding='utf-8'));rows={r['key']:r for r in m['summaries']+m.get('assay_summaries',[])}
 def link(item,label,title):
  if item.get('ready') is False:return f'<span class="download-link" aria-disabled="true" title="Preparing download" aria-label="{escape(title)} — preparing">{label}<span>Preparing</span></span>'
  url=public_url(item["url"])
  return f'<a class="download-link" href="{escape(url)}" download="{escape(Path(url).name)}" aria-label="{escape(title)}">{label}<span>{size(item["bytes"])}</span></a>'
 def links(row):
  item=m.get('comprehensive_summaries',{}).get('rows',{}).get(row['key'])
  if not item or item['source_sha256']!=row['csv']['sha256']:raise ValueError('Current comprehensive summary missing or stale: '+row['key'])
  return link(item['csv'],'CSV',row['label']+' comprehensive summary: target sequence, regions, counts and paired parent coverage at 7/9, 8/9 and 9/9')
 def inline(match):
  key=match[1]
  if key not in rows:raise ValueError('Unpublished summary requested: '+key)
  return links(rows[key])
 source=re.sub(r'<!-- summary-links:([a-z0-9_]+) -->',inline,source)
 def summary_value(match):
  kind,key=match.groups()
  if key not in rows:raise ValueError('Unpublished summary requested: '+key)
  return escape(rows[key]['label']) if kind=='label' else f"{rows[key]['rows']:,}"
 source=re.sub(r'<!-- summary-(label|count):([a-z0-9_]+) -->',summary_value,source)
 sequences={item['key']:item for item in m['sequences']}
 def fasta(match):
  direction,key=match.groups()
  if key not in rows:raise ValueError('Unpublished summary requested: '+key)
  population=rows[key][direction]
  if population not in sequences:raise ValueError('Missing sequence population: '+population)
  item=sequences[population]
  return link(item,'FASTA',direction.title()+' FASTA: '+item['label'])
 source=re.sub(r'<!-- summary-(target|comparison)-fasta:([a-z0-9_]+) -->',fasta,source)
 source=source.replace('<!-- summary-updated -->',m['updated_utc'][:10])
 if '<!-- summary-' in source:raise ValueError('Unresolved download marker')
 return source
