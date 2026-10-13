"""Generate independent public pages from the authored section fragments."""
from pathlib import Path
from html import escape
import re,json
from public_downloads import public_url
ROOT=Path(__file__).resolve().parents[1]
PAGES=[('calculations','scienceRecord','How Mimicry Results Are Calculated',['reproduce/residue-coverage.js','method-figure.js']),
       ('use-results','hepacamWorkedExample','How to Use Mimicry Results',['deferred-illustrations.js']),
       ('pan-viral','atlasScale','Pan-Viral Atlas of Molecular Mimicry',['reproduce/ranking.js','reproduce/context-score.js','reproduce/residue-coverage.js','mimicryone-identity.js','reproduce/export-core.js','atlas-figures.js','figure-export.js','atlas-pairs.js']),
       ('sources','dataSources','Data Sources, Methods, and Licenses',['release-provenance.js','source-licenses.js'])]
DOC_SCRIPTS=['method-figure.js','atlas-figures.js','deferred-illustrations.js','source-licenses.js']

def paginate(rendered,section_span,check=False):
    nav=(ROOT/'docs/public/navigation.html').read_text(encoding='utf-8').strip()
    sections={sid:rendered[slice(*section_span(rendered,sid))] for _,sid,_,_ in PAGES}
    routes={key:'/'+slug+'.html' for slug,sid,_,_ in PAGES for key in re.findall(r'\bid="([^"]+)"',sections[sid])}
    # Retain old bookmarks while moving only the requested chapter into memory.
    routes['releaseSources']='/sources.html'
    routes['proteomeReactivity']='/calculations.html'
    def navigation(slug):
        return re.sub(r'data-page="'+re.escape(slug)+'"',lambda m:m[0]+' aria-current="page"',nav)
    def links(text,slug):
        def link(m):
            attrs,anchor,tail=m.groups();destination=routes.get(anchor,'/')
            if destination==('/' if slug=='home' else '/'+slug+'.html'):return m[0]
            attrs=re.sub(r'\s+target="[^"]*"','',attrs);tail=re.sub(r'\s+target="[^"]*"','',tail)
            return '<a'+attrs+' href="'+destination+'#'+anchor+'" data-site-nav'+tail+'>'
        return re.sub(r'<a([^>]*?)\s+href="#([^"]+)"([^>]*)>',link,text)
    copy=re.search(r'<!-- public-diagram-copy:start -->.*?<!-- public-diagram-copy:end -->',rendered,re.S)
    if not copy:raise ValueError('Missing method diagram data marker')
    inline_style=re.search(r'<style>(.*?)</style>',rendered,re.S).group(1)
    outputs={'site-base.css':'/* Generated from the native player base styles. */\n'+inline_style,
             'site-routes.js':'/* Generated chapter bookmark routes. */\nwindow.MimicrySiteRoutes='+json.dumps(routes,ensure_ascii=False)+';\n'}
    for slug,sid,title,scripts in PAGES:
        section=sections[sid]
        # Each document has one primary heading; preserve its existing figure layout.
        if slug!='sources':section=re.sub(r'<h2([^>]*id="(?:scienceTitle|useResultsTitle|atlasHeroTitle)"[^>]*)>(.*?)</h2>',r'<h1\1>\2</h1>',section,count=1,flags=re.S)
        page='''<!doctype html>
<html lang="en" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>'''+escape(title)+''' | MimicryMap</title>
<script src="/site-theme.js"></script><script src="/page-links.js" defer></script>
<link rel="stylesheet" href="/mimicryone-fonts.css"><link rel="stylesheet" href="/site-base.css">
<link rel="stylesheet" href="/mimicryone.css"><link rel="stylesheet" href="/atlas-figures.css">
<link rel="stylesheet" href="/mimicryone-mobile.css"><link rel="stylesheet" href="/mimicryone-theme.css">
<link rel="stylesheet" href="/site-pages.css"></head>
<body data-site-page="'''+slug+'"><div class="site-ambient" aria-hidden="true"></div>'+navigation(slug)+'\n<main class="site-document" id="main-content">'+links(section,slug)+'</main>\n'
        page+='<script src="/mimicryone-tooltip.js"></script>\n'
        if slug=='calculations':page+=copy[0]+'\n'
        if slug=='pan-viral':
            catalog=json.loads((ROOT/'frontend/summary-downloads.json').read_text(encoding='utf-8'))
            sequences={r['key']:r for r in catalog['sequences']}
            pair_summary=catalog['comprehensive_summaries']['rows']['human_swissprot_vs_atlas_120_viruses']['csv']
            pair_manifest_path=ROOT/'frontend/atlas-pairs-manifest.json'
            pair_manifest=json.loads(pair_manifest_path.read_text(encoding='utf-8')) if pair_manifest_path.exists() else {}
            pair_config={'url':pair_manifest.get('url'),'source_sha256':pair_summary['sha256'],'summary_url':public_url(pair_summary['url']),'source_summary_url':pair_manifest['summary_url']}
            page+='<script>window.MimicryPanViralPairs='+json.dumps(pair_config).replace('<','\\u003c')+';</script>\n'
            page+='<script>window.MimicryPublicSequences='+json.dumps(sequences).replace('<','\\u003c')+';</script>\n'
            for pair_key in ('human_swissprot_vs_atlas_120_viruses','atlas_120_viruses_vs_human_swissprot'):
                page=page.replace('/source-downloads/mimicry-summaries/'+pair_key+'.csv',public_url(catalog['comprehensive_summaries']['rows'][pair_key]['csv']['url']))
            selected=catalog.get('selected_viruses')
            if selected:
                compact={'release_fingerprint':selected['release_fingerprint'],'proteomes':{v['slug']:{k:public_url(v[k]['url']) for k in ('human_to_virus','virus_to_human')} for v in selected['proteomes']}}
                page+='<script>window.MimicrySelectedVirusSummaries='+json.dumps(compact,separators=(',',':')).replace('<','\\u003c')+';</script>\n'
        page+='\n'.join('<script src="/'+script+'"></script>' for script in scripts)+'\n</body></html>\n'
        outputs[slug+'.html']=page
    home=rendered
    for sid in [*(sid for _,sid,_,_ in PAGES),'releaseSources']:
        a,b=section_span(home,sid)
        home=home[:a]+'<section id="'+sid+'" hidden data-page-placeholder></section>'+home[b:]
    home=re.sub(r'<!-- public-diagram-copy:start -->.*?<!-- public-diagram-copy:end -->','<!-- public-diagram-copy:start --><!-- public-diagram-copy:end -->',home,flags=re.S)
    for script in DOC_SCRIPTS:home=re.sub(r'<script[^>]*src="/'+re.escape(script)+r'"[^>]*>\s*</script>','',home)
    home=re.sub(r'<!-- site-navigation:start -->.*?<!-- site-navigation:end -->',lambda m:'<!-- site-navigation:start -->'+navigation('home')+'<!-- site-navigation:end -->',home,flags=re.S)
    outputs['index.html']=links(home,'home')
    for name,content in outputs.items():
        p=ROOT/'frontend'/name
        if check:
            if not p.exists() or p.read_text(encoding='utf-8')!=content:raise ValueError('Public page is stale: '+name)
        elif not p.exists() or p.read_text(encoding='utf-8')!=content:p.write_text(content,encoding='utf-8',newline='\n')
    return outputs['index.html']
