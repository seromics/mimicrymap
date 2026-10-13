"""Build small public download link blocks from the verified staging manifest."""
from pathlib import Path
from html import escape
import json,re
from public_downloads import public_url
ROOT=Path(__file__).resolve().parents[1]
LIBRARY_LABELS={'human_swissprot':'Canonical Human Proteins','atlas_120_viruses':'Curated Viral Proteomes (120)',
 'canonical_exposure':'Canonical Exposures','canonical_exposure_no_vertebrates':'Non-Vertebrate Exposures',
 'huprot4':'HuProt 4.0','human_current':'HuScan','virscan_exposome_current':'VirScan / Exposome'}
def sync_guide(check=False):
 """Keep the public guide synchronized without restaging any data payloads."""
 source=ROOT/'docs/public/summary-download-guide.md'
 destinations=[ROOT/'frontend/source-downloads/mimicry-summaries/summary-guide.md',
   ROOT/'frontend/reproduce/docs/SUMMARY-DOWNLOADS.md']
 content=source.read_bytes()
 current=all(destination.exists() and destination.read_bytes()==content for destination in destinations)
 if check and not current:
  raise ValueError('Summary download guide is stale; run python frontend/public_sections.py')
 if not check and not current:
  import os,tempfile
  for destination in destinations:
   if destination.exists() and destination.read_bytes()==content:continue
   destination.parent.mkdir(parents=True,exist_ok=True)
   with tempfile.NamedTemporaryFile(dir=destination.parent,prefix='.summary-guide-',delete=False) as handle:
    temporary=Path(handle.name)
    handle.write(content)
   try:os.replace(temporary,destination)
   finally:temporary.unlink(missing_ok=True)
 return current

def size(n):return f'{n/1e9:.1f} GB' if n>=1e9 else f'{n/1e6:.1f} MB' if n>=1e6 else f'{n/1e3:.0f} KB'
def stage_archives(publication):
 """Bind archive receipts to rows without copying or recompressing data."""
 import os
 publication=Path(publication).resolve()
 catalog=json.loads((publication/'downloads.json').read_text(encoding='utf-8'))
 files={item['id']:item for group in catalog['groups'] for item in group['files']}
 manifest=ROOT/'frontend/summary-downloads.json'
 data=json.loads(manifest.read_text(encoding='utf-8'))
 # Archive identities come from the publication catalogue; each directional
 # CSV links to the same bundle when both directions ship together.
 aliases={'huprot4':'huprot4','human_current':'huscan','virscan_exposome_current':'virscan-exposome',
   'atlas_120_viruses':'atlas-120-viruses','canonical_exposure':'canonical-exposure',
   'canonical_exposure_no_vertebrates':'canonical-exposure-no-vertebrates','human_swissprot':'human-swissprot'}
 assay_ids={'huprot4':'huprot','human_current':'huscan','virscan_exposome_current':'virscan'}
 for row in data['summaries']+data.get('assay_summaries',[]):
  target,parent=row['target'],row['comparison']
  pair={target,parent};a,b=aliases[target],aliases[parent]
  summary=next((key for key in ('source-'+a+'-'+b,'source-'+b+'-'+a,'source-'+a if a==b else '') if key in files),None)
  index=None;thresholds='7/9'
  for assay,stem in assay_ids.items():
   if assay not in pair:continue
   if 'atlas_120_viruses' in pair:index='indexes-'+stem+'-viral120';thresholds='7/9–9/9'
   elif 'canonical_exposure' in pair:index='indexes-'+stem+'-exposure'
   elif 'human_swissprot' in pair:index='indexes-'+stem+'-human-swissprot';summary='source-'+stem+'-human-swissprot';thresholds='7/9–9/9'
  if pair=={'huprot4','virscan_exposome_current'}:index='indexes-peptide-huprot4'
  if pair=={'human_current','virscan_exposome_current'}:index='indexes-peptide-huscan'
  products={}
  for kind,key in [('summary',summary),('index',index)]:
   if not key:continue
   item=files[key]
   source=(publication/item['file']).resolve()
   if not source.is_relative_to(publication) or source.stat().st_size!=item['bytes']:
    raise ValueError('Archive does not match publication receipt: '+item['id'])
   url='/source-downloads/mimicry-summaries/archives/'+source.name
   destination=ROOT/'frontend'/url.lstrip('/')
   destination.parent.mkdir(parents=True,exist_ok=True)
   if not destination.exists():os.link(source,destination)
   elif not destination.samefile(source):raise ValueError('Archive alias belongs to a different release: '+str(destination))
   products[kind]={key:item[key] for key in ('bytes','sha256')}
   products[kind].update(url=url,module=item['id'],identity=thresholds if kind=='index' else '7/9–9/9')
  data['comprehensive_summaries']['rows'][row['key']]['archives']=products
 manifest.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')

def render(source):
 if '<!-- summary-' not in source and '<!-- public-downloads -->' not in source:return source
 source=source.replace('<!-- public-downloads -->',(ROOT/'docs/public/downloads.html').read_text(encoding='utf-8'))
 m=json.loads((ROOT/'frontend/summary-downloads.json').read_text(encoding='utf-8'));rows={r['key']:r for r in m['summaries']+m.get('assay_summaries',[])}
 labels=LIBRARY_LABELS
 def row_label(row):return labels[row['target']]+' → '+labels[row['comparison']]
 # Newly staged assay-to-human products use the existing table and file controls.
 human_rows=[]
 for row in m.get('assay_summaries',[]):
  if row.get('comparison')!='human_swissprot' and 'canonical_exposure' not in (row['target'],row['comparison']):continue
  key=row['key']
  description='Canonical human Swiss-Prot 2026_01; shared and own-protein matches are retained.' if row.get('comparison')=='human_swissprot' else 'Full canonical exposure collection; original assay identifiers retained.'
  human_rows.append(f'<tr><th scope="row"><span class="download-row-title"><!-- summary-label:{key} --></span><span class="download-row-description">{description} Summaries describe sequence coverage at 7/9–9/9.</span></th><td><span class="download-mobile-label" aria-hidden="true">Target rows: </span><!-- summary-count:{key} --></td><td class="summary-file-cell"><span class="download-mobile-label" aria-hidden="true">Downloads</span><div class="download-actions"><!-- summary-links:{key} --></div></td><td class="summary-file-cell"><span class="download-mobile-label" aria-hidden="true">Target FASTA</span><!-- summary-target-fasta:{key} --></td><td class="summary-file-cell"><span class="download-mobile-label" aria-hidden="true">Comparison FASTA</span><!-- summary-comparison-fasta:{key} --></td></tr>')
 source=source.replace('<!-- assay-human-downloads -->','\n'.join(human_rows))
 def link(item,label,title):
  if item.get('ready') is False:return f'<span class="download-link" aria-disabled="true" title="Preparing download" aria-label="{escape(title)} — preparing">{label}<span>Preparing</span></span>'
  url=public_url(item["url"])
  return f'<a class="download-link" href="{escape(url)}" download="{escape(Path(url).name)}" aria-label="{escape(title)}">{label}<span>{size(item["bytes"])}</span></a>'
 def links(row):
  item=m.get('comprehensive_summaries',{}).get('rows',{}).get(row['key'])
  if not item or item['source_sha256']!=row['csv']['sha256']:raise ValueError('Current comprehensive summary missing or stale: '+row['key'])
  result=link(item['csv'],'CSV',row_label(row)+' comprehensive summary: target sequence, identifiers, paired parent coverage and per-pair ranges at 7/9, 8/9 and 9/9')
  for kind,label in [('summary','Summary ZIP'),('index','Membership index ZIP')]:
   archive=item.get('archives',{}).get(kind)
   if archive:
    if kind=='index' and archive.get('module','').startswith('sequence-matches-'):label='Protein-page index ZIP'
    label+=(' · '+archive['identity']) if kind=='index' else ''
    result+=' '+link(archive,label,row_label(row)+' '+label+(' (measured assay → reference; cross-assay bundles include both directions)' if kind=='index' else '')).replace('<a ',f'<a data-reference-archive="{kind}" data-reference-module="{escape(archive["module"])}" ',1)
  return result
 groups={}
 for row in rows.values():groups.setdefault('--'.join(sorted([row['target'],row['comparison']])),[]).append(row)
 ready={p['key']:p for p in m.get('pairs',[])}
 counts={r['target']:r['rows'] for r in rows.values()}
 sections=[
  ('canonical','Canonical ↔ Canonical Maps',[
   ('human_swissprot','atlas_120_viruses'),('human_swissprot','canonical_exposure'),
   ('human_swissprot','canonical_exposure_no_vertebrates'),('human_swissprot','human_swissprot')]),
  ('human','Assays ↔ Canonical Human Proteins',[(a,'human_swissprot') for a in ('huprot4','human_current','virscan_exposome_current')]),
  ('viral','Assays ↔ Curated Viral Proteomes (120)',[(a,'atlas_120_viruses') for a in ('huprot4','human_current','virscan_exposome_current')]),
  ('exposure','Assays ↔ Canonical Exposures',[(a,'canonical_exposure') for a in ('huprot4','human_current','virscan_exposome_current')]),
  ('cross','Direct Cross-Assay Summaries',[
   ('huprot4','human_current'),('huprot4','virscan_exposome_current'),
   ('human_current','virscan_exposome_current'),('huprot4','huprot4')])]
 paired=[];seen=set()
 def product_cell(item,kind,title,description):
  name={'summary':'Coverage summaries','matches':'Protein-page index','candidate':'Statistical membership index'}[kind]
  if not item:return f'<td class="summary-file-cell" data-product="{kind}"><span class="download-mobile-label">{name}</span><span class="download-unavailable" aria-label="Not available">—</span></td>'
  label='CSV ZIP' if kind=='summary' else 'Index ZIP'
  action=link(item,label,title+' · '+name+' · '+description)
  if item.get('module'):
   action=action.replace('<a ',f'<a data-reference-archive="{kind}" data-reference-module="{escape(item["module"])}" ',1)
  amount=item.get('expandedBytes') if kind=='summary' else item.get('installedBytes')
  storage=(size(amount)+(' extracted' if kind=='summary' else ' installed')) if amount else ''
  note=escape(item.get('identity','7/9–9/9'))
  if storage:note+=' · '+storage
  return f'<td class="summary-file-cell" data-product="{kind}"><span class="download-mobile-label">{name}</span><div class="download-actions">{action}</div><span class="download-product-note">{note}</span></td>'
 for section_id,heading,pairs in sections:
  body=[]
  for a,b in pairs:
   key='--'.join(sorted([a,b]));directions=groups.get(key,[]);built=ready.get(key)
   if not directions:raise ValueError('Missing comparison in download section: '+key)
   seen.add(key)
   title=labels[a]+(' ↔ '+labels[b] if a!=b else ' · within library')
   count=' · '.join(f"{counts[k]:,}" for k in dict.fromkeys([a,b]))
   products=built['archives'] if built else m.get('comprehensive_summaries',{}).get('rows',{}).get(directions[0]['key'],{}).get('archives',{})
   index=products.get('index')
   matches=index if built and built.get('featureOnly') else None
   candidate=products.get('candidate') or (index if not matches and index and not index.get('positions') else None)
   description=('One summary' if a==b else 'Summaries in both directions' if len(directions)>1 else 'Summary: '+row_label(directions[0]))
   summary_description=description+('; pair-specific residue ranges included' if products.get('summary',{}).get('pairRegions') else '')
   cells=product_cell(products.get('summary'),'summary',title,summary_description)
   if section_id!='cross':
    cells+=product_cell(matches,'matches',title,'Both directions; ≥10% coverage of either sequence'+('; merged residue ranges for each pair' if (built or {}).get('retainsPairRegions') else ''))
    cells+=product_cell(candidate,'candidate',title,'Statistical memberships; '+(candidate or {}).get('identity',''))
   body.append(f'<tr data-library-pair="{key}"><th scope="row"><span class="download-row-title">{escape(title)}</span><span class="download-row-description">{escape(description)}</span></th><td>{count}</td>{cells}</tr>')
  index_headers='' if section_id=='cross' else '<th scope="col" data-product="matches">Protein-page index</th><th scope="col" data-product="candidate">Statistical membership index</th>'
  table='<div class="download-table-scroll" tabindex="0" role="region" aria-label="'+escape(heading)+' downloads"><table class="download-table summary-download-table"><thead><tr><th scope="col">Libraries</th><th scope="col">Records</th><th scope="col" data-product="summary">Coverage summaries</th>'+index_headers+'</tr></thead><tbody>'+''.join(body)+'</tbody></table></div>'
  paired.append('<div class="download-comparison-group"><h3>'+escape(heading)+'</h3>'+table+'</div>')
 if seen!=set(groups):raise ValueError('Unclassified download comparisons: '+str(set(groups)-seen))
 source=source.replace('<!-- paired-downloads -->','\n'.join(paired))
 def example_archive(match):
  key=match[1]
  if key not in rows:raise ValueError('Unpublished summary requested: '+key)
  row=rows[key];a,b=row['target'],row['comparison']
  item=m.get('comprehensive_summaries',{}).get('rows',{}).get(key)
  if not item or item['source_sha256']!=row['csv']['sha256']:raise ValueError('Current comprehensive summary missing or stale: '+key)
  archive=item.get('archives',{}).get('summary')
  if not archive or (a!=b and not archive.get('bidirectional')):raise ValueError('Complete summary archive missing: '+key)
  title=labels[a]+(' ↔ '+labels[b] if a!=b else ' · within library')
  description='Summaries in both directions' if a!=b else 'One summary'
  count=' · '.join(f"{counts[k]:,}" for k in dict.fromkeys([a,b]))
  cell=product_cell(archive,'summary',title,description)
  return '<div class="download-table-scroll" tabindex="0" role="region" aria-label="'+escape(title)+' coverage summaries"><table class="download-table"><thead><tr><th scope="col">Libraries</th><th scope="col">Records</th><th scope="col">Coverage summaries</th></tr></thead><tbody><tr><th scope="row"><span class="download-row-title">'+escape(title)+'</span><span class="download-row-description">'+description+'</span></th><td>'+count+'</td>'+cell+'</tr></tbody></table></div>'
 source=re.sub(r'<!-- summary-example-archive:([a-z0-9_]+) -->',example_archive,source)
 def inline(match):
  key=match[1]
  if key not in rows:raise ValueError('Unpublished summary requested: '+key)
  return links(rows[key])
 source=re.sub(r'<!-- summary-links:([a-z0-9_]+) -->',inline,source)
 def summary_value(match):
  kind,key=match.groups()
  if key not in rows:raise ValueError('Unpublished summary requested: '+key)
  return escape(row_label(rows[key])) if kind=='label' else f"{rows[key]['rows']:,}"
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

def build_downloads(check=False):
 """Refresh the download section without rebuilding unrelated public figures."""
 sync_guide(check=check)
 source=(ROOT/'docs/public/downloads.html').read_text(encoding='utf-8')
 rendered=render(source)
 page=ROOT/'frontend/sources.html'
 original=page.read_text(encoding='utf-8')
 # The catalogue owns two sibling sections; replace both, including duplicates
 # left by builds that previously replaced only the first section.
 pattern=r'<section\b[^>]*\bid="(?:summaryLibrary|assaySummaryLibrary)"[^>]*>[\s\S]*?</section>'
 matches=list(re.finditer(pattern,original))
 if not matches:raise ValueError('Summary catalogue missing from Sources page')
 if any(original[a.end():b.start()].strip() for a,b in zip(matches,matches[1:])):
  raise ValueError('Unexpected content between download catalogue sections')
 result=original[:matches[0].start()]+rendered.strip()+original[matches[-1].end():]
 header_pattern=r'<header class="site-page-hero">[\s\S]*?</header>'
 header=re.search(header_pattern,(ROOT/'docs/public/sources.html').read_text(encoding='utf-8'))
 if header:result=re.sub(header_pattern,lambda _:header.group(),result,count=1)
 if check and result!=original:raise ValueError('Summary downloads are stale')
 if not check and result!=original:page.write_text(result,encoding='utf-8',newline='\n')
 return result==original

if __name__=='__main__':
 import argparse
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--root',type=Path,default=ROOT)
 parser.add_argument('--check',action='store_true')
 parser.add_argument('--archives',type=Path,help='Publication directory containing verified archive receipts')
 args=parser.parse_args();ROOT=args.root.resolve()
 if args.archives:
  if args.check:parser.error('--archives cannot be combined with --check')
  stage_archives(args.archives)
 print('Summary downloads current' if build_downloads(args.check) else 'Built summary downloads')
