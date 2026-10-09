/* Keep outbound navigation in a new tab while preserving page anchors and downloads.
   Prepare dynamic links at interaction time; no observer scans the animated player. */
(function pageLinks() {
  "use strict";
  const selector = "a[href],area[href]";
  const prepared = new WeakMap();

  function leavesPage(link) {
    const href = link.getAttribute("href");
    if (link.hasAttribute("data-site-nav")) return false;
    if (!href || href.startsWith("#") || link.hasAttribute("download")) return false;
    try {
      const url = new URL(href, document.baseURI);
      return (url.protocol === "http:" || url.protocol === "https:") &&
        (url.origin !== location.origin || url.pathname !== location.pathname ||
         url.search !== location.search);
    } catch (_) {
      return false;
    }
  }

  function prepare(link) {
    if (link.hasAttribute("download")) {
      const supplied = link.getAttribute("download");
      const name = supplied || (link.getAttribute("href") || "").split(/[?#]/)[0].split("/").pop();
      if (name) link.setAttribute("download", name.replace(/virscan_exposome_current/g, "virscan_exposome").replace(/human_current/g, "huscan").replace(/[-_]v\d+(?:\.\d+)*(?=[._-]|$)/gi, "").replace(/_+/g, "_"));
    }
    if (leavesPage(link)) {
      if (!prepared.has(link)) prepared.set(link, {
        target: link.getAttribute("target"), rel: link.getAttribute("rel")
      });
      link.setAttribute("target", "_blank");
      const rel = new Set((link.getAttribute("rel") || "").split(/\s+/).filter(Boolean));
      rel.add("noopener");
      rel.add("noreferrer");
      link.setAttribute("rel", Array.from(rel).join(" "));
    } else if (prepared.has(link)) {
      // A picker may reuse a link for an in-page action or a download.
      const previous = prepared.get(link);
      for (const name of ["target", "rel"]) {
        if (previous[name] === null) link.removeAttribute(name);
        else link.setAttribute(name, previous[name]);
      }
      prepared.delete(link);
    }
  }

  document.querySelectorAll(selector).forEach(prepare);
  for (const type of ["click", "auxclick", "focusin", "contextmenu"]) {
    document.addEventListener(type, function prepareActivatedLink(event) {
      const link = event.target.closest?.(selector);
      if (link) prepare(link);
    }, true);
  }
}());
