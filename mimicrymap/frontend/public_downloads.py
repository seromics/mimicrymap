"""Version-free public download aliases; original files and provenance stay intact."""
from pathlib import Path
import json,os,re,tempfile

PREFIX='/source-downloads/mimicry-summaries/'

def published_url(root,url,cors=False):
    """Use the released file when this local download has a Zenodo counterpart."""
    catalog_path=Path(root)/'docs/public/zenodo-downloads.json'
    if not url.startswith(PREFIX) or not catalog_path.exists():return public_url(url)
    catalog=json.loads(catalog_path.read_text(encoding='utf-8'))
    item=catalog.get('files',{}).get(url.rsplit('/',1)[-1]) if catalog.get('published') else None
    if not item:return public_url(url)
    if cors:return item['url'].split('?')[0].replace('zenodo.org/records/','zenodo.org/api/records/')+'/content'
    return item['url']

def public_url(url):
    if not url.startswith(PREFIX):return url
    return re.sub(r'[-_]v\d+(?:\.\d+)*(?=[./_-]|$)','',url,flags=re.I)

def sync_aliases(root,check=False):
    frontend=Path(root)/'frontend'
    manifest_path=frontend/'summary-downloads.json'
    if not manifest_path.exists():return {}
    manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
    items=[row['csv'] for row in manifest.get('comprehensive_summaries',{}).get('rows',{}).values()]
    items.extend(v[d] for v in manifest.get('selected_viruses',{}).get('proteomes',[]) for d in ('human_to_virus','virus_to_human'))
    receipt_path=frontend/'public-download-aliases.json'
    prior=json.loads(receipt_path.read_text(encoding='utf-8')) if receipt_path.exists() else {}
    aliases={}
    def local(url):
        if not url.startswith(PREFIX):raise ValueError('Alias outside public summary directory')
        path=frontend/url.lstrip('/')
        if not path.resolve().is_relative_to((frontend/PREFIX.lstrip('/')).resolve()):raise ValueError('Unsafe alias path')
        return path
    for item in items:
        if item.get('ready') is False:continue
        url=item['url'];alias=public_url(url)
        if alias==url:continue
        if alias in aliases and aliases[alias]!=url:raise ValueError('Conflicting public download alias: '+alias)
        aliases[alias]=url
        source=local(url);destination=local(alias)
        if source.stat().st_size!=item['bytes']:raise ValueError('Download source size differs: '+url)
        if destination.exists() and os.path.samefile(source,destination):continue
        if check:raise ValueError('Public download alias missing or stale: '+alias)
        if destination.exists():
            previous=prior.get(alias)
            if not previous or not local(previous).exists() or not os.path.samefile(destination,local(previous)):
                raise ValueError('Refusing to replace an unowned download path: '+alias)
        destination.parent.mkdir(parents=True,exist_ok=True)
        handle,temporary=tempfile.mkstemp(prefix='.download-alias-',dir=destination.parent)
        os.close(handle);os.unlink(temporary)
        try:
            os.link(source,temporary)
            os.replace(temporary,destination)
        finally:
            if os.path.exists(temporary):os.unlink(temporary)
    if check:
        if prior!=aliases:raise ValueError('Public download alias receipt is stale')
    elif prior!=aliases:
        receipt_path.write_text(json.dumps(aliases,indent=2,sort_keys=True)+'\n',encoding='utf-8')
    return aliases
