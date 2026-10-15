"""Build a small atlas table payload from the published summary, without matching sequences."""
from pathlib import Path
import argparse,csv,hashlib,json,re,os,gzip
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[1]
KEY='human_swissprot_vs_atlas_120_viruses'
COLLECTIONS={
 'viruses':('human_swissprot_vs_atlas_120_viruses','atlas_120_viruses_vs_human_swissprot'),
 'canonical':('human_swissprot_vs_canonical_exposure','canonical_exposure_vs_human_swissprot'),
 'nonvertebrate':('human_swissprot_vs_canonical_exposure_no_vertebrates','canonical_exposure_no_vertebrates_vs_human_swissprot'),
}

def split_escaped(value,delimiter):
 out=[];part=[];escaped=False
 for c in value:
  if escaped:part.extend(('\\',c));escaped=False
  elif c=='\\':escaped=True
  elif c==delimiter:out.append(''.join(part));part=[]
  else:part.append(c)
 if escaped:raise ValueError('Trailing escape')
 return out+[''.join(part)]

def unescape(value):
 return re.sub(r'\\([\\;@|])',r'\1',value)

def entries(value):
 if not value:return
 for entry in split_escaped(value,';'):
  sides=split_escaped(entry,'@')
  if len(sides)!=2:raise ValueError('Malformed paired entry')
  labels=[unescape(c) for c in split_escaped(sides[0],'|')]
  values=[float(v) for v in sides[1].split('|')]
  if len(values)!=2 or any(not 0<=v<=100 for v in values):raise ValueError('Invalid pair percentages')
  yield labels,values

def read_bound(item):
 path=ROOT/'frontend'/item['url'].lstrip('/')
 with path.open('rb') as f:assert hashlib.file_digest(f,'sha256').hexdigest()==item['sha256']
 with path.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))

def build(out=None,collection='viruses',atlas_index=None):
 csv.field_size_limit(2147483647)
 m=json.loads((ROOT/'frontend/summary-downloads.json').read_text(encoding='utf-8'));catalog=m['comprehensive_summaries'];assert catalog['schema'] in ('mimicryone/native-summary/6','mimicryone/native-summary/7')
 summary_key,reverse_key=COLLECTIONS[collection]
 human=catalog['rows'][summary_key]['csv'];viral=catalog['rows'][reverse_key]['csv']
 atlas_path=Path(atlas_index) if atlas_index else ROOT/'bake/out_v2_complete/collection-coverage/index.json';atlas=json.loads(atlas_path.read_text(encoding='utf-8'));taxa={}
 for v in atlas['proteomes']:taxa.setdefault(str(v['taxon_id']),[]).append(v)
 parents=[];by_accession={}
 for row in read_bound(viral):
  accession=row['Antigen Target Accession'];assert accession,'Missing parent accession'
  if collection=='viruses':assert accession not in by_accession,'Ambiguous viral accession'
  organism=row['Antigen Target Organism (TaxID)'];tax=re.search(r'\[TaxID: (\d+)\]',organism);matches=taxa.get(tax[1] if tax else '',[])
  if collection=='viruses' and len(matches)!=1:raise ValueError('Ambiguous atlas species binding: '+accession)
  v=matches[0] if collection=='viruses' else {'label':re.sub(r'\s*\[TaxID: [^\]]+\]','',organism),'organism':organism,'slug':''}
  by_accession.setdefault(accession,[]).append(len(parents))
  parents.append([row['Antigen Target Gene'],accession,v['label'],v['organism'],v['slug'],int(row['Antigen Target Length (AA)'])])
 parent_records=len(parents);metadata=parents;parent_labels={}
 if collection!='viruses':parents=[]
 targets=[];pairs={};counts={str(f):0 for f in (7,8,9)}
 for ti,row in enumerate(read_bound(human)):
  targets.append([row['Antigen Target Gene'],row['Antigen Target Accession'],row['Antigen Target Protein Description'],int(row['Antigen Target Length (AA)'])])
  for floor in (7,8,9):
   column=next(c for c in catalog['columns'] if c.startswith(f'Mimicry Parents at {floor}/9 '));seen=set()
   for occurrence,(labels,values) in enumerate(entries(row[column])):
    ids={i for label in labels for i in by_accession.get(label,[])}
    if collection!='viruses':
     if not ids:raise ValueError('Parent label has no published metadata')
     label_key=tuple(labels)
     if label_key not in parent_labels:
      candidates=[metadata[i] for i in ids]
      named=[r for r in candidates if r[0] in labels or r[2] in labels]
      if named:candidates=named
      record=[candidates[0][j] if len({r[j] for r in candidates})==1 else '' for j in range(6)]
      record.append(' | '.join(labels));parent_labels[label_key]=len(parents);parents.append(record)
     pi=parent_labels[label_key];pair=[ti,pi,None,None,None,None,None,None];offset=2+(floor-7)*2;pair[offset:offset+2]=values
     pairs[(ti,floor,occurrence)]=pair;counts[str(floor)]+=1
     continue
    if len(ids)!=1:raise ValueError('Ambiguous parent label: '+str(labels))
    pi=ids.pop();assert pi not in seen,'Duplicate literal pair at one threshold';seen.add(pi)
    key=(ti,pi);pair=pairs.setdefault(key,[ti,pi,None,None,None,None,None,None]);offset=2+(floor-7)*2;pair[offset:offset+2]=values;counts[str(floor)]+=1
 payload={'schema':'mimicryone/atlas-pair-view/1','source_schema':catalog['rows'][summary_key].get('summary_schema',catalog['schema']),'source_sha256':human['sha256'],'summary_url':human['url'],'proteomes':len(atlas['proteomes']),'target_records':len(targets),'identity_min':[7,8,9],'pair_counts':counts,'target_columns':['gene','accession','description','length'],'parent_columns':['gene','accession','species','organism','proteome_slug','length'],'pair_columns':['target','parent','parent7','target7','parent8','target8','parent9','target9'],'targets':targets,'parents':parents,'pairs':list(pairs.values()),'listing_floor':'10% either endpoint before rounding; imported from current summary','ranking_precision':'One decimal, exactly as published; ties use the other coverage then accessions'}
 assert counts==catalog['rows'][summary_key]['listed_pairs'],'Published pair counts differ'
 assert len(targets)==catalog['rows'][summary_key]['rows'],'Published target count differs'
 if collection!='viruses':
  payload.update(collection=collection,proteomes=None,parent_records=parent_records)
  payload['parent_columns'].append('published_label')
 data=(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n').encode();digest=hashlib.sha256(data).hexdigest();name=('pan_viral' if collection=='viruses' else collection)+'_pairs_'+digest[:12]+'.json.gz';payload_bytes=len(data);data=gzip.compress(data,mtime=0);file_digest=hashlib.sha256(data).hexdigest();stage=ROOT/'frontend/document-data';stage.mkdir(parents=True,exist_ok=True)
 dest=stage/name
 if not dest.exists():temp=dest.with_suffix('.json.pending');temp.write_bytes(data);os.replace(temp,dest)
 receipt={'schema':'mimicryone/atlas-pair-view-receipt/1','created_utc':datetime.now(timezone.utc).isoformat(),'url':'/document-data/'+name,'bytes':len(data),'sha256':file_digest,'payload_sha256':digest,'payload_bytes':payload_bytes,'source_sha256':human['sha256'],'viral_metadata_sha256':viral['sha256'],'atlas_index_sha256':hashlib.sha256(atlas_path.read_bytes()).hexdigest(),'summary_url':human['url'],'pair_counts':counts,'literal_pairs':len(pairs),'target_records':len(targets),'parent_records':parent_records,'sequence_comparisons_run':False,'producer_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
 manifest_path=ROOT/'frontend/atlas-pairs-manifest.json'
 manifest=json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {}
 collections=manifest.get('collections',{})
 collections[collection]=receipt
 if collection=='viruses':manifest=dict(receipt)
 manifest['collections']=collections
 temp=manifest_path.with_suffix('.pending');temp.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8');os.replace(temp,manifest_path)
 if out:
  out.mkdir(parents=True,exist_ok=True);(out/name).write_bytes(data);(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({k:receipt[k] for k in ('bytes','pair_counts','literal_pairs','target_records','parent_records','url')}));return receipt
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,default=ROOT);p.add_argument('--atlas-index',type=Path);p.add_argument('--out',type=Path);p.add_argument('--collection',choices=['all',*COLLECTIONS],default='viruses');a=p.parse_args();ROOT=a.root.resolve()
 for collection in COLLECTIONS if a.collection=='all' else [a.collection]:build(a.out/collection if a.out and a.collection=='all' else a.out,collection,a.atlas_index)
