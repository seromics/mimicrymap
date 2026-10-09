/* One initial presentation commit. Later selections keep the existing Player transition. */
(function () {
  "use strict";
  var root = document.documentElement;
  var pending = true, frame = null, readyResolve, retryTimer;
  var owners = new Set(["document", "runtime", "analysis"]), claimed = new Set(), work = new Set();
  var ready = new Promise(function (resolve) { readyResolve = resolve; });
  root.dataset.startup = "loading";

  function nextFrame(callback) {
    return document.hidden ? window.setTimeout(callback, 20) : requestAnimationFrame(callback);
  }
  function geometry() {
    return [".atlas-select", ".controls", ".stage", "#resultExtent"].map(function (selector) {
      var node = document.querySelector(selector), rect = node && node.getBoundingClientRect();
      return rect ? [rect.x, rect.y, rect.width, rect.height].join(",") : "";
    }).join("|");
  }
  function reveal() {
    if (!pending || owners.size || work.size) return;
    pending = false;
    window.clearTimeout(retryTimer);
    var hero = document.querySelector(".hero");
    if (hero) { hero.inert = false; hero.removeAttribute("aria-busy"); }
    root.dataset.startup = "ready";
    var shell = document.getElementById("startupShell");
    if (shell) shell.hidden = true;
    readyResolve();
    // Resume only through the native visibility, pause and reduced-motion guards.
    if (typeof window.start === "function") window.start();
    if (typeof window.ambientStart === "function") window.ambientStart();
    document.dispatchEvent(new CustomEvent("mimicry:startup-ready"));
  }
  function settle() {
    frame = null;
    if (!pending || owners.size || work.size) return;
    if (typeof window.paintStatic === "function") window.paintStatic();
    var previous = geometry(), stable = 0;
    function inspect() {
      frame = null;
      if (!pending || owners.size || work.size) return;
      var current = geometry();
      stable = current === previous ? stable + 1 : 0;
      previous = current;
      if (stable >= 2) reveal();
      else frame = nextFrame(inspect);
    }
    frame = nextFrame(inspect);
  }
  function schedule() {
    if (pending && !owners.size && !work.size && frame === null) frame = nextFrame(settle);
  }
  function hold(owner) {
    if (!pending) return function () {};
    owners.delete(owner); claimed.add(owner);
    var token = {}; work.add(token);
    // Optional startup assets settle into their existing unavailable state on timeout.
    // Abort the request itself, so a late response cannot change geometry after reveal.
    var controller = owner === "assets" || owner === "sources" ? new AbortController() : null;
    var timeout = controller ? window.setTimeout(function () { controller.abort(); }, 10000) : null;
    function release() {
      if (!work.delete(token)) return;
      if (timeout !== null) window.clearTimeout(timeout);
      schedule();
    }
    release.signal = controller ? controller.signal : undefined;
    return release;
  }
  // Share startup JSON only for this document; failures remain retryable.
  var jsonLoads = new Map();
  function loadJson(path) {
    if (jsonLoads.has(path)) return jsonLoads.get(path);
    var controller = new AbortController();
    var timer = window.setTimeout(function () { controller.abort(); }, 10000);
    var promise = fetch(path, {cache:"no-cache", signal:controller.signal}).then(function (response) {
      if (!response.ok) throw new Error("Startup request failed (HTTP " + response.status + "): " + path);
      return response.json();
    }).catch(function (error) { jsonLoads.delete(path); throw error; }).finally(function () { window.clearTimeout(timer); });
    jsonLoads.set(path, promise);
    return promise;
  }
  window.MimicryStartup = Object.freeze({
    get pending() { return pending; },
    hold: hold,
    loadJson: loadJson,
    ready: ready
  });
  document.addEventListener("DOMContentLoaded", function () {
    var hero = document.querySelector(".hero");
    if (hero) { hero.inert = true; hero.setAttribute("aria-busy", "true"); }
    var retry = document.getElementById("startupRetry");
    if (retry) retry.addEventListener("click", function () { location.reload(); });
    retryTimer = window.setTimeout(function () { if (pending && retry) retry.hidden = false; }, 15000);
    var releaseDocument = hold("document");
    Promise.resolve(document.fonts && document.fonts.ready).then(releaseDocument, releaseDocument);
    // A missing optional script must not permanently conceal the authored fallback.
    // Run after all DOMContentLoaded listeners have had a chance to claim their owner.
    window.setTimeout(function () {
      ["runtime", "analysis"].forEach(function (owner) { if (!claimed.has(owner)) owners.delete(owner); });
      schedule();
    }, 0);
  }, { once: true });
})();
