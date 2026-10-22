"""Theme the displayed copies of saved figures without changing their results."""
import re
import xml.etree.ElementTree as ET
from pathlib import Path

SVG = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG)
ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")
ASSETS = Path(__file__).resolve().parent / "examples/use-results/20260909"
ASSAY_ASSETS = ASSETS.parent / "20260916"
# Roles emitted by render_saved_coverage.cjs in its standalone light export.
COVERAGE_COLORS = {
    "rgb(0, 0, 0)": "var(--mm-ink)",
    "rgb(28, 25, 23)": "var(--mm-ink)",
    "rgb(68, 64, 60)": "var(--mm-body)",
    "rgb(166, 175, 185)": "var(--mm-border)",
    "rgb(119, 119, 119)": "var(--mm-muted)",
    "rgb(4, 120, 87)": "var(--hl-sel)",
    "#059669": "var(--hl-sel)",
    "#111111": "var(--mm-ink)",
    "#444444": "var(--mm-body)",
    "#666666": "var(--mm-muted)",
    "#888888": "var(--mm-border)",
}


def _tag(name):
    return f"{{{SVG}}}{name}"


def _native_track(root, prefix):
    """Preserve captured data pixels; recolor only the neutral gutter and frames."""
    track = root.find(_tag("svg"))
    if track is None or track.get("viewBox") != "0 0 1528 194":
        raise ValueError("Review the IGHG2 display adapter for the refreshed track layout")
    capture = track.find(_tag("image"))
    if capture is None or (capture.get("width"), capture.get("height")) != ("1528", "194"):
        raise ValueError("Unexpected IGHG2 saved track image")
    # This frozen export has five display bands of 90/90/90/90/35 cells,
    # 16px cells, an 80px coordinate gutter and one transparent 10px variant lane.
    # These are capture coordinates, not recomputed sequence or density values.
    track.remove(capture)
    capture.set("id", prefix + "-capture")
    defs = ET.SubElement(track, _tag("defs"))
    defs.append(capture)
    mask = ET.SubElement(defs, _tag("mask"), {
        "id": prefix + "-gutter", "maskUnits": "userSpaceOnUse",
        "x": "0", "y": "0", "width": "80", "height": "194",
        "style": "mask-type:alpha",
    })
    ET.SubElement(mask, _tag("use"), {"href": "#" + capture.get("id")})
    ET.SubElement(track, _tag("rect"), {
        "x": "0", "y": "0", "width": "80", "height": "194",
        "fill": "var(--mm-ink)", "mask": f"url(#{prefix}-gutter)",
    })
    clip = ET.SubElement(defs, _tag("clipPath"), {
        "id": prefix + "-data", "clipPathUnits": "userSpaceOnUse",
    })
    for band, cells in enumerate((90, 90, 90, 90, 35)):
        y = 8 + band * 36
        ET.SubElement(clip, _tag("rect"), {
            "x": "81", "y": str(y + 1), "width": str(cells * 16 - 2), "height": "24",
        })
    ET.SubElement(track, _tag("use"), {
        "href": "#" + capture.get("id"), "clip-path": f"url(#{prefix}-data)",
    })
    for band, cells in enumerate((90, 90, 90, 90, 35)):
        ET.SubElement(track, _tag("rect"), {
            "x": "80.5", "y": str(8.5 + band * 36),
            "width": str(cells * 16 - 1), "height": "25",
            "fill": "none", "stroke": "var(--mm-border)", "stroke-width": "1",
        })


def themed_svg(name, label):
    """Inline a display copy so the app's manual theme toggle updates it instantly."""
    if not re.fullmatch(r"(?:hepacam|il10|ighg2)-coverage-[578]|hepacam-huprot-coverage-[57]|hepacam-huprot-viral-coverage-[57]|ighg2-full-unhighlighted|reactivity-enrichment-(?:platforms|huprot-ebv)", name):
        raise ValueError(f"Unknown saved figure: {name}")
    assets = ASSETS.parent / "20260921" if name.startswith("hepacam-huprot-viral-") else ASSAY_ASSETS if name.startswith("hepacam-huprot-") else ASSETS
    if name.startswith("reactivity-enrichment-"):
        assets = ASSETS.parent / "20261018"
    root = ET.parse(assets / f"{name}.svg").getroot()
    prefix = "use-" + name
    root.set("class", "use-native-figure " + ("use-coverage" if "-coverage-" in name else "use-enrichment-plot" if name.startswith("reactivity-enrichment-") else "use-full-sequence"))
    root.set("role", "img")
    root.set("aria-label", label)
    root.set("data-saved-figure", name)
    title = root.find(_tag("title"))
    if title is None:
        title = ET.SubElement(root, _tag("title"))
    title.set("id", "title")
    title.text = label
    root.attrib.pop("style", None)
    if "-coverage-" in name:
        for element in root.iter():
            element.attrib.pop("tabindex", None)
            for attribute in ("fill", "stroke"):
                value = element.get(attribute)
                if value in COVERAGE_COLORS:
                    element.set(attribute, COVERAGE_COLORS[value])
                elif value and value not in ("none", "transparent") and not value.startswith("var("):
                    raise ValueError(f"Unmapped coverage color: {value}")
    elif name.startswith("reactivity-enrichment-"):
        # Keep saved coordinates and statistics; inherit only the page's fonts and neutral ink.
        for style in list(root.findall(_tag("style"))):
            root.remove(style)
        for element in root.iter():
            if element.tag == _tag("text"):
                element.set("fill", "var(--mm-ink)")
                if name == "reactivity-enrichment-platforms" and element.text:
                    element.text = element.text.replace("VirScan (IgG)", "VirScan")
            if element.get("stroke") == "#1A2230":
                element.set("stroke", "var(--mm-ink)")
            if element.get("style") == "cursor: pointer;":
                element.attrib.pop("style")
    else:
        # Site fonts are already loaded; avoid installing the export's embedded fonts.
        for style in list(root.findall(_tag("style"))):
            root.remove(style)
        for element in root.iter():
            if element.tag == _tag("text"):
                element.set("fill", "var(--mm-ink)")
        _native_track(root, prefix)
    # Saved SVGs may reuse legend IDs; keep inline references local to this figure.
    ids = {e.get("id"): prefix + "-" + e.get("id") for e in root.iter() if e.get("id")}
    for element in root.iter():
        for attribute, value in list(element.attrib.items()):
            if attribute == "id":
                element.set(attribute, ids[value])
            elif value.startswith("#") and value[1:] in ids:
                element.set(attribute, "#" + ids[value[1:]])
            elif value.startswith("url(#") and value[5:-1] in ids:
                element.set(attribute, "url(#" + ids[value[5:-1]] + ")")
    return ET.tostring(root, encoding="unicode")


def render_saved_figures(source):
    def inline(match):
        # Only the explicitly marked, local saved figures enter this adapter.
        image = ET.fromstring(match.group())
        name = Path(image.get("src")).stem
        return themed_svg(name, image.get("alt", name))
    return re.sub(r'<img\b[^>]*\bdata-native-theme="true"[^>]*/>', inline, source)
