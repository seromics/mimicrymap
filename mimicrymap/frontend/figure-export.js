/* Shared presentation export for the current-result figures. No data reduction. */
(function () {
  "use strict";
  const ns = "http://www.w3.org/2000/svg";
  function node(tag, attrs, value) {
    const n = document.createElementNS(ns, tag);
    Object.entries(attrs || {}).forEach(([key, val]) => n.setAttribute(key, val));
    if (value != null) n.textContent = value;
    return n;
  }
  async function exportFigure({title, subtitle, panels, footer, metadata, filename, kind}) {
    if (!["svg", "png"].includes(kind)) throw new Error("Unsupported figure format.");
    await document.fonts.ready;
    const paper=window.MimicryPlotPalette.variables();
    const width = 720, margin = 20, contentWidth = width - 2 * margin;
    const out = node("svg", {xmlns:ns, width, "font-family":"Inter, Arial, sans-serif", role:"img"});
    out.append(node("title", {}, title));
    const background = node("rect", {width, fill:paper["--mm-surface"]});
    out.append(background);
    const context = document.createElement("canvas").getContext("2d");
    let y = 24;
    function paragraph(value, size, weight, color) {
      if (!value) return;
      context.font = `${weight} ${size}px Inter, Arial, sans-serif`;
      const lines = []; let line = "";
      for (const word of String(value).split(/\s+/)) {
        const candidate = line ? line + " " + word : word;
        if (context.measureText(candidate).width <= contentWidth) { line = candidate; continue; }
        if (line) lines.push(line);
        line = "";
        for (const char of word) {
          if (context.measureText(line + char).width > contentWidth) { lines.push(line); line = ""; }
          line += char;
        }
      }
      if (line) lines.push(line);
      for (const value of lines) {
        out.append(node("text", {x:margin, y, fill:color, "font-size":size, "font-weight":weight}, value));
        y += size * 1.5;
      }
      y += 6;
    }
    paragraph(title, 13, 600, paper["--mm-ink"]);
    paragraph(subtitle, 10.5, 400, paper["--mm-body"]);
    const theme = getComputedStyle(document.documentElement);
    for (const panel of panels) {
      paragraph(panel.title, 12, 600, paper["--mm-ink"]);
      paragraph(panel.legend, 11.5, 400, paper["--mm-body"]);
      const copy = panel.svg.cloneNode(true), box = panel.svg.viewBox.baseVal;
      const plotWidth = Math.min(contentWidth, box.width), plotHeight = plotWidth * box.height / box.width;
      copy.setAttribute("x", (width - plotWidth) / 2); copy.setAttribute("y", y);
      copy.setAttribute("width", plotWidth); copy.setAttribute("height", plotHeight);
      copy.removeAttribute("class"); copy.removeAttribute("style");
      window.MimicryPlotPalette.freezeSVG(copy);
      out.append(copy); y += plotHeight + 18;
    }
    paragraph(footer, 10.5, 400, paper["--mm-body"]);
    out.append(node("metadata", {}, JSON.stringify({...metadata,plotPalette:window.MimicryPlotPalette.snapshot()})));
    out.setAttribute("height", y + 12); out.setAttribute("viewBox", `0 0 ${width} ${y + 12}`);
    background.setAttribute("height", y + 12);
    const svgBlob = new Blob([new XMLSerializer().serializeToString(out)], {type:"image/svg+xml;charset=utf-8"});
    let blob = svgBlob;
    if (kind === "png") {
      const imageURL = URL.createObjectURL(svgBlob);
      try {
        const image = new Image(); image.src = imageURL; await image.decode();
        const canvas = document.createElement("canvas"), scale = 3;
        canvas.width = width * scale; canvas.height = Math.ceil(y + 12) * scale;
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("The figure image could not be created.");
      } finally { URL.revokeObjectURL(imageURL); }
    }
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `${filename}.${kind}`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  window.MimicryFigureExport = exportFigure;
})();
