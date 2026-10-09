(function niceMimicryOneTooltips() {
  "use strict";
  if (window.MimicryOneTooltip) return;

  var ATTRIBUTE = "data-tooltip";
  var SELECTOR = "[data-tooltip],[title]";
  var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  var tooltip = document.createElement("div");
  var activeTarget = null;
  var focusTarget = null;
  var describedNode = null;
  var describedBefore = null;
  var dismissedTarget = null;
  /* pointerover fires when the element under a stationary pointer changes, which happens when
     the page rearranges beneath it and not only when the reader moves. Selecting an item from
     the History row does exactly that: the chosen entry is promoted to the front and another
     slides into the slot the pointer is still resting on, so a tooltip appeared describing a
     protein the reader had not pointed at and had not opened. Read against the page it labels,
     which now shows the protein they did open, that looks like the wrong record loaded - one
     report of it was a 416 aa protein "showing 178 aa", 178 being the length of the entry that
     had slid underneath. So a pointer that has not moved cannot open a tooltip: press suppresses
     until real motion, and motion is a change of position, not merely a pointermove event. */
  var suppressUntilMove = false;
  var lastX = null, lastY = null;

  function pointerMoved(event) {
    if (!event || typeof event.clientX !== "number") return false;
    return event.clientX !== lastX || event.clientY !== lastY;
  }

  function notePointer(event) {
    if (!event || typeof event.clientX !== "number") return;
    lastX = event.clientX;
    lastY = event.clientY;
  }

  tooltip.id = "mmNiceTooltip";
  tooltip.className = "mm-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.appendChild(tooltip);

  function isVisibleNote(node) {
    return node && (node.getAttribute("role") === "status" || node.getAttribute("aria-live"));
  }

  function normalizeNativeTitle(node) {
    if (!node || !node.hasAttribute || !node.hasAttribute("title")) return node;
    var text = node.getAttribute("title") || "";
    node.removeAttribute("title");
    if (text.trim() && !isVisibleNote(node) && !node.hasAttribute(ATTRIBUTE)) {
      node.setAttribute(ATTRIBUTE, text);
    }
    return node;
  }

  function normalizeSvgTitle(title) {
    if (!title || title.namespaceURI !== 'http://www.w3.org/2000/svg' || title.localName !== 'title') return;
    var owner=title.parentElement;
    if (!owner) return;
    var text=(title.textContent||'').trim();
    if (text && !owner.hasAttribute(ATTRIBUTE)) owner.setAttribute(ATTRIBUTE,text);
    // Preserve the accessible description and any aria-labelledby references,
    // but remove SVG title's independent native hover popup.
    if (text && !owner.hasAttribute('aria-label') && !owner.hasAttribute('aria-labelledby')) owner.setAttribute('aria-label',text);
    var description=document.createElementNS(title.namespaceURI,'desc');
    for (var attribute of title.attributes) description.setAttribute(attribute.name,attribute.value);
    description.textContent=title.textContent;
    owner.replaceChild(description,title);
  }

  function normalizeTree(node) {
    if (!node || node.nodeType!==1 || node===tooltip || tooltip.contains(node)) return;
    normalizeNativeTitle(node);
    normalizeSvgTitle(node);
    node.querySelectorAll('[title],svg title').forEach(function(child){
      normalizeNativeTitle(child);
      normalizeSvgTitle(child);
    });
  }

  function tooltipTarget(start) {
    if (!start || start.nodeType !== 1) return null;
    var node = start.closest(SELECTOR);
    if (!node) return null;
    normalizeNativeTitle(node);
    return (node.getAttribute(ATTRIBUTE) || "").trim() ? node : null;
  }

  function clearDescription() {
    if (!describedNode) return;
    if (describedBefore == null) describedNode.removeAttribute("aria-describedby");
    else describedNode.setAttribute("aria-describedby", describedBefore);
    describedNode = null;
    describedBefore = null;
  }

  function addDescription(owner, text) {
    clearDescription();
    if (!owner || !owner.setAttribute) return;
    var ariaLabel = (owner.getAttribute("aria-label") || "").trim();
    if (ariaLabel && (ariaLabel === text || ariaLabel.indexOf(text) >= 0)) return;
    describedNode = owner;
    describedBefore = owner.getAttribute("aria-describedby");
    var ids = (describedBefore || "").split(/\s+/).filter(Boolean);
    if (ids.indexOf(tooltip.id) < 0) ids.push(tooltip.id);
    owner.setAttribute("aria-describedby", ids.join(" "));
  }

  function clamp(value, low, high) {
    return Math.max(low, Math.min(value, high));
  }

  function positionAtPointer(event) {
    var pad = 12;
    var gap = 14;
    var width = tooltip.offsetWidth;
    var height = tooltip.offsetHeight;
    var left = event.clientX + gap;
    var top = event.clientY + gap;
    if (left + width + pad > window.innerWidth) left = event.clientX - width - gap;
    if (top + height + pad > window.innerHeight) top = event.clientY - height - gap;
    tooltip.style.left = clamp(left, pad, Math.max(pad, window.innerWidth - width - pad)) + "px";
    tooltip.style.top = clamp(top, pad, Math.max(pad, window.innerHeight - height - pad)) + "px";
  }

  function positionAtElement(node) {
    var pad = 12;
    var gap = 8;
    var rect = node.getBoundingClientRect();
    var width = tooltip.offsetWidth;
    var height = tooltip.offsetHeight;
    var left = rect.left + (rect.width - width) / 2;
    var top = rect.bottom + gap;
    if (top + height + pad > window.innerHeight) top = rect.top - height - gap;
    tooltip.style.left = clamp(left, pad, Math.max(pad, window.innerWidth - width - pad)) + "px";
    tooltip.style.top = clamp(top, pad, Math.max(pad, window.innerHeight - height - pad)) + "px";
  }

  function show(node, event, owner) {
    normalizeNativeTitle(node);
    var text = (node.getAttribute(ATTRIBUTE) || "").trim();
    if (window.MimicryOneIdentity) text=window.MimicryOneIdentity.publicText(text);
    if (!text || node === dismissedTarget) return;
    activeTarget = node;
    tooltip.textContent = text;
    tooltip.classList.toggle("is-mono", node.hasAttribute("data-tooltip-mono"));
    tooltip.hidden = false;
    tooltip.classList.add("is-open");
    if (owner) addDescription(owner, text);
    else clearDescription();
    if (event && typeof event.clientX === "number") positionAtPointer(event);
    else positionAtElement(node);
  }

  function hide() {
    activeTarget = null;
    clearDescription();
    tooltip.classList.remove("is-open", "is-mono");
    tooltip.hidden = true;
    tooltip.textContent = "";
  }

  normalizeTree(document.body);
  new MutationObserver(function(records){
    records.forEach(function(record){
      if(record.type==='attributes') normalizeNativeTitle(record.target);
      else record.addedNodes.forEach(normalizeTree);
    });
    if(activeTarget && !activeTarget.isConnected) hide();
  }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['title']});

  document.addEventListener("pointerover", function onPointerOver(event) {
    if (!finePointer.matches || (event.pointerType && event.pointerType !== "mouse")) return;
    // A pointerover the reader did not cause by moving: the page moved instead.
    if (suppressUntilMove && !pointerMoved(event)) return;
    var node = tooltipTarget(event.target);
    if (!node || node === dismissedTarget) {
      if (activeTarget && !focusTarget) hide();
      return;
    }
    show(node, event, null);
  });

  document.addEventListener("pointermove", function onPointerMove(event) {
    if (!finePointer.matches || (event.pointerType && event.pointerType !== "mouse")) return;
    if (suppressUntilMove) {
      if (!pointerMoved(event)) return;
      suppressUntilMove = false;
    }
    notePointer(event);
    var node = tooltipTarget(event.target);
    if (!node || node === dismissedTarget) {
      if (activeTarget && !focusTarget) hide();
      return;
    }
    show(node, event, null);
  });

  document.addEventListener("pointerout", function onPointerOut(event) {
    if (dismissedTarget && dismissedTarget.contains(event.target) &&
        !(event.relatedTarget && dismissedTarget.contains(event.relatedTarget))) dismissedTarget = null;
    if (!activeTarget) return;
    if (event.relatedTarget && activeTarget.contains(event.relatedTarget)) return;
    if (dismissedTarget === activeTarget) dismissedTarget = null;
    if (focusTarget) show(focusTarget, null, document.activeElement);
    else hide();
  });

  document.addEventListener("focusin", function onFocusIn(event) {
    var node = tooltipTarget(event.target);
    if (!node) return;
    focusTarget = node;
    dismissedTarget = null;
    show(node, null, event.target);
  });

  document.addEventListener("focusout", function onFocusOut(event) {
    if (!focusTarget) return;
    if (event.relatedTarget && focusTarget.contains(event.relatedTarget)) return;
    focusTarget = null;
    dismissedTarget = null;
    hide();
  });

  document.addEventListener("keydown", function onKeyDown(event) {
    if (event.key !== "Escape" || !activeTarget) return;
    dismissedTarget = activeTarget;
    hide();
  });

  document.addEventListener("pointerdown", function dismissOutside(event) {
    // Whatever the press does to the page, the reader is looking at what they pressed, not at
    // whatever ends up beneath the cursor afterwards. Nothing reopens until they move.
    notePointer(event);
    suppressUntilMove = true;
    if (!tooltip.contains(event.target)) hide();
  }, true);
  document.addEventListener("scroll", function dismissOnPageScroll(event) {
    if (!tooltip.contains(event.target)) hide();
  }, true);
  document.addEventListener("click", function touchLabelHelp(event) {
    // Hybrid laptops/tablets can report a fine primary pointer during a touch tap.
    var touch = event.pointerType === "touch" ||
      (event.sourceCapabilities && event.sourceCapabilities.firesTouchEvents);
    if ((!touch && finePointer.matches) || tooltip.contains(event.target)) return;
    // Do not intercept control activation. Text labels expose the same help on tap.
    if (event.target.closest("button,input,select,textarea,a,label")) return;
    var node = tooltipTarget(event.target);
    if (node) {
      dismissedTarget = null;
      show(node, null, null);
    }
  });
  window.addEventListener("resize", hide);

  window.MimicryOneTooltip = {
    hide: hide,
    set: function set(node, text, mono) {
      if (!node) return;
      node.removeAttribute('title');
      if (text) node.setAttribute(ATTRIBUTE, text);
      else node.removeAttribute(ATTRIBUTE);
      node.toggleAttribute("data-tooltip-mono", !!mono);
      if (activeTarget === node) {
        if (text) show(node, null, focusTarget ? document.activeElement : null);
        else hide();
      }
    }
  };
}());
