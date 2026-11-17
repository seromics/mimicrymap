"""Export the authored compact five-step method overview.

Reads the public methods and their worked-example icon; performs no sequence search.
Run with Python and Pillow. SVGs have no external image, font or script dependencies.
"""
from pathlib import Path
import html
import re
import xml.etree.ElementTree as E
from PIL import ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'frontend/reproduce/docs/calculation'
INK, MUTED, BLUE, GREEN, RED, LINE = '#172434', '#536171', '#246099', '#247a4b', '#b33b31', '#d5dce3'
FONT = 'Arial, Helvetica, sans-serif'
MONO = 'Courier New, monospace'

def elem(tag, **attrs):
    return E.Element(tag, {k.replace('_', '-'): str(v) for k, v in attrs.items()})

def text(root, x, y, value, size=13, weight=400, fill=INK, anchor='start', mono=False):
    node = elem('text', x=x, y=y, font_size=size, font_weight=weight, fill=fill,
                text_anchor=anchor, font_family=MONO if mono else FONT)
    node.text = value
    root.append(node)
    return node

def font(size, bold=False):
    for name in [f'C:/Windows/Fonts/arial{"bd" if bold else ""}.ttf', 'DejaVuSans.ttf']:
        try:
            return ImageFont.truetype(name, round(size * 10))
        except OSError:
            pass
    return ImageFont.load_default(size=round(size * 10))

def wrap(value, width, size, bold=False):
    face = font(size, bold)
    lines, current = [], ''
    for word in value.split():
        trial = (current + ' ' + word).strip()
        if current and face.getlength(trial) / 10 > width:
            lines.append(current)
            current = word
        else:
            current = trial
    return lines + [current] if current else lines

def paragraph(root, x, y, value, width, size=13, leading=17, weight=400, fill=INK, anchor='start'):
    for i, line in enumerate(wrap(value, width, size, weight >= 600)):
        text(root, x, y + i * leading, line, size, weight, fill, anchor)

def line(root, x1, y1, x2, y2, color=LINE, width=1):
    root.append(elem('line', x1=x1, y1=y1, x2=x2, y2=y2, stroke=color, stroke_width=width))

def rect(root, x, y, w, h, fill='none', stroke=BLUE, width=1):
    root.append(elem('rect', x=x, y=y, width=w, height=h, fill=fill, stroke=stroke, stroke_width=width))

def canvas(w, h, title, physical=False):
    root = elem('svg', xmlns='http://www.w3.org/2000/svg', width='8.5in' if physical else w,
                height='11in' if physical else h, viewBox=f'0 0 {w} {h}', font_family=FONT)
    caption = elem('title'); caption.text = title; root.append(caption)
    rect(root, 0, 0, w, h, 'white', 'none')
    return root

def save(root, filename):
    OUT.mkdir(parents=True, exist_ok=True)
    E.ElementTree(root).write(OUT / filename, encoding='utf-8', xml_declaration=True)
    print(OUT / filename)

source = (ROOT / 'docs/public/methods.html').read_text(encoding='utf-8')
overview = source.split('<div class="method-overview"', 1)[1].split('</ol>', 1)[0]
items = re.findall(r'<li><h4>(.*?)</h4>(<svg\b.*?</svg>)<p>(.*?)</p></li>', overview, re.S)
if len(items) != 5:
    raise ValueError('The overview must contain five authored steps.')

def printable_icon(markup):
    icon = E.fromstring(markup)
    for node in icon.iter():
        cls = set(node.get('class', '').split())
        for name, color in [('summary-outline', BLUE), ('summary-context', BLUE),
                            ('summary-core', BLUE), ('summary-difference', RED)]:
            if name in cls:
                node.set('fill', 'none'); node.set('stroke', color)
                node.set('stroke-width', '1' if name == 'summary-core' else '2')
        if 'summary-fill' in cls:
            node.set('fill', BLUE); node.set('fill-opacity', '.35')
        if cls & {'summary-arrows', 'summary-arrowhead'}:
            node.set('fill', 'none'); node.set('stroke', INK); node.set('stroke-width', '1.4')
        if cls & {'summary-context-box', 'summary-core-box'}:
            node.set('fill', BLUE); node.set('fill-opacity', '.15'); node.set('stroke', BLUE)
        if 'summary-required-dot' in cls:
            node.set('fill', GREEN)
        if 'summary-wildcard-symbol' in cls:
            node.set('fill', 'none'); node.set('stroke', MUTED); node.set('stroke-width', '1.2')
        if node.tag == 'text':
            node.set('font-family', MONO); node.set('font-size', '14'); node.set('fill', INK)
        if 'summary-residues' in cls:
            node.set('font-size', '10'); node.set('font-weight', '600'); node.set('text-anchor', 'middle')
        if 'method-aa-match' in cls: node.set('fill', GREEN)
        if 'method-aa-mismatch' in cls: node.set('fill', RED)
    return icon

# Preserve the five icons, headings and descriptions of the authored summary.
wide = canvas(1800, 239, 'MimicryMap in five steps')
for i, (title, markup, description) in enumerate(items):
    center = 180 + i * 360
    text(wide, center, 30, f'{i + 1}  {html.unescape(title)}', 20, 700, anchor='middle')
    icon = printable_icon(markup)
    icon.set('x', str(center - 80)); icon.set('y', '54'); icon.set('width', '160'); icon.set('height', '76')
    wide.append(icon)
    paragraph(wide, center, 166, html.unescape(description), 340, 19, 25, anchor='middle')
    if i < 4:
        text(wide, center + 180, 101, '→', 29, 700, BLUE, 'middle')
save(wide, 'method-overview-wide.svg')
