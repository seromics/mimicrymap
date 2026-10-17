"""Compile authored UI text into existing renderers; no runtime lookup dependency."""
import json
import re
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = 'docs/public/interface-copy.json'
CONTRACT = 'docs/contracts/export-fields.json'
TERMS = 'docs/public/terminology.json'
LEGENDS = 'docs/public/figure-legends.json'
MARKER = re.compile(r'/\*@copy ([\w.-]+)\*/.*?/\*@endcopy\*/', re.S)
HTML_MARKER = re.compile(r'<!--@copy ([\w.-]+)-->(.*?)<!--@endcopy-->', re.S)


def load():
    catalogue=json.loads((ROOT / CATALOG).read_text(encoding='utf-8'))
    for entry in json.loads((ROOT / LEGENDS).read_text(encoding='utf-8'))['entries']:
        entry['editorial_source']=LEGENDS
        catalogue['entries'].append(entry)
    glossary=json.loads((ROOT / TERMS).read_text(encoding='utf-8'))
    terms={term['id']:term for term in glossary['terms']}
    if len(terms)!=len(glossary['terms']):raise ValueError('Duplicate glossary term')
    for entry in catalogue['entries']:
        if 'term' in entry:
            if 'text' in entry:raise ValueError('Term-linked text must not have a second authored label: '+entry['key'])
            entry['text']=terms[entry['term']]['label']+entry.get('suffix','')
    protected=json.loads((ROOT / CONTRACT).read_text(encoding='utf-8'))
    for entry in protected['entries']:
        actual=hashlib.sha256(json.dumps({'text':entry['text'],'placeholders':entry.get('placeholders',{})},sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        if actual!=entry['contract_sha256']:raise ValueError('Export contract changed without a reviewed schema update: '+entry['key'])
        entry['export_contract']=True
    catalogue['entries']+=protected['entries']
    return catalogue


def js_expression(entry):
    text = entry['text']
    values = entry.get('placeholders', {})
    referenced = set(re.findall(r'\{\{(\w+)\}\}', text))
    if referenced != set(values):
        raise ValueError('Placeholder set changed: ' + entry['key'])
    parts = re.split(r'(\{\{\w+\}\})', text)
    # Template interpolation matches existing display conversion; expressions stay code-owned.
    out = '`'
    for part in parts:
        if re.fullmatch(r'\{\{\w+\}\}', part):
            out += '${' + values[part[2:-2]]['expression'] + '}'
        else:
            out += part.replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')
    return out + '`'


def compile_text(text, entries):
    def js(match):
        entry = entries[match[1]]
        return '/*@copy ' + match[1] + '*/' + js_expression(entry) + '/*@endcopy*/'
    def html(match):
        entry = entries[match[1]]
        return '<!--@copy ' + match[1] + '-->' + entry['text'] + '<!--@endcopy-->'
    result = HTML_MARKER.sub(html, MARKER.sub(js, text))
    def attributes(match):
        tag = match[0]
        for attr,key in re.findall(r'data-copy-([\w-]+)="([\w.-]+)"',tag):
            value = entries[key]['text']
            import html as entities
            escaped = entities.escape(value, quote=True)
            pattern = r'(?<![\w-])' + re.escape(attr) + r'\s*=\s*([\x22\x27]).*?\1'
            if not re.search(pattern,tag,re.S): raise ValueError('Missing copied attribute: '+key)
            tag = re.sub(pattern,lambda _:attr+'="'+escaped+'"',tag,count=1,flags=re.S)
        return tag
    return re.sub(r'<[A-Za-z][^<>]*\bdata-copy-[^<>]*>',attributes,result)


def compile_files(check=False):
    catalogue = load()
    entries = {row['key']: row for row in catalogue['entries']}
    if len(entries) != len(catalogue['entries']): raise ValueError('Duplicate text key')
    outputs = {}
    for filename in sorted({row['file'] for row in entries.values()}):
        path = ROOT / filename
        original = path.read_text(encoding='utf-8')
        compiled = compile_text(original, entries)
        keys = set(MARKER.findall(original))
        keys.update(m[0] for m in HTML_MARKER.findall(original))
        keys.update(re.findall(r'data-copy-[\w-]+="([\w.-]+)"',original))
        expected = {row['key'] for row in entries.values() if row['file'] == filename}
        if not expected.issubset(keys) or not keys.issubset(entries): raise ValueError('Missing/extra text markers: ' + filename)
        if compiled != original:
            if check: raise ValueError('Stale interface text: ' + filename)
            outputs[path] = compiled
    # Validate every file before any output is written.
    for path, content in outputs.items(): path.write_text(content, encoding='utf-8', newline='\n')
    return catalogue


def write_review(catalogue, check=False):
    catalogue={'entries':[row for row in catalogue['entries'] if not row.get('export_contract')]}
    lines = ['# Interface Text Catalogue', '',
             'Generated review view. Edit **interface-copy.json**; shared term labels and definitions belong to **terminology.json**. From the checkout root, run `python mimicrymap/frontend/public_sections.py`.', '',
             'See [Glossary](GLOSSARY.md). Machine-facing export fields are separate in [the export contract](../contracts/export-fields.json) and are not editorial wording.', '',
             'Public wording is draft. Locations and placeholder expressions are internal notes and are not shipped as UI text.', '']
    lines += ['## Surface index', '']
    for filename in sorted({row['file'] for row in catalogue['entries']}):
        count=sum(row['file']==filename for row in catalogue['entries'])
        lines += ['- `' + filename + '` — ' + str(count) + ' entries']
    lines += ['', 'Figure legends captured from the live DOM use the player legend entries. Native database descriptions and identifiers are not editable copy. Frozen published SVGs/PNGs retain their original text until explicitly regenerated from their recorded settings.', '']
    for row in catalogue['entries']:
        lines += ['## ' + row['key'], '', '**Used in:** `' + row['file'] + '` · ' + row['use'], '',
                  '```text', row['text'].rstrip(), '```', '']
        if row.get('term'):lines += ['Shared glossary term: `' + row['term'] + '` (edit its label once in terminology.json).', '']
        if row.get('editorial_source'):lines += ['**Edit in:** `' + row['editorial_source'] + '`', '']
        for name, value in row.get('placeholders', {}).items():
            lines += ['- `{{' + name + '}}` ← `' + value['expression'] + '` (live renderer value; not authored content)']
        lines += ['']
    lines += ['## Methods Diagram Copy', '', 'Edit `docs/public/method-copy.json`. Numbered placeholders are supplied by the corresponding diagram call in `frontend/method-figure.js`; this section includes titles, captions, equations and diagram labels.', '']
    methods=json.loads((ROOT/'docs/public/method-copy.json').read_text(encoding='utf-8'))
    for key,value in methods.items():
        lines += ['### '+key, '', '```text', value, '```', '']
    rendered = '\n'.join(lines)
    path = ROOT / 'docs/public/INTERFACE_TEXT.md'
    if check:
        if not path.exists() or path.read_text(encoding='utf-8') != rendered:
            raise ValueError('Interface review catalogue is stale')
    elif not path.exists() or path.read_text(encoding='utf-8') != rendered:
        path.write_text(rendered, encoding='utf-8', newline='\n')
    write_glossary(check)


def write_glossary(check=False):
    glossary=json.loads((ROOT / TERMS).read_text(encoding='utf-8'))
    lines=['# Terminology and Usage Rules', '',
           'Single editorial authority: [terminology.json](terminology.json). This review page is generated; do not edit it separately.', '',
           'Definitions govern public prose, controls, tooltips and figure labels. Compact labels are contextual forms, not alternate concepts. Client CSV field names follow the reviewed export contract and shared identity formatter; they use the same record roles across surfaces.', '']
    lines += [glossary['prose_rule'], '']
    for concept in glossary['concepts']:
        lines += ['## '+concept['title'], '', concept['text'], '']
    lines += ['## Review Boundaries', '']
    lines += ['- '+rule for rule in glossary['review_boundaries']]
    rendered='\n'.join(lines)+'\n'
    path=ROOT/'docs/public/GLOSSARY.md'
    if check:
        if not path.exists() or path.read_text(encoding='utf-8')!=rendered:raise ValueError('Glossary review is stale')
    elif not path.exists() or path.read_text(encoding='utf-8')!=rendered:
        path.write_text(rendered,encoding='utf-8',newline='\n')
