/* Presentation-only row motion. Ranking and membership come from the caller. */
(function (root) {
  "use strict";
  function create(duration, exitDuration) {
    var states = new Map(), order = [], limit = 0;
    duration = duration || 240;
    exitDuration = exitDuration || duration;
    function sample(state, now) {
      var t = Math.max(0, Math.min(1, (now - state.started) / (state.exiting ? exitDuration : duration)));
      // Departing rows accelerate downward, staying visible until late in the fall.
      var eased = state.exiting ? t * t : 1 - Math.pow(1 - t, 3);
      var fade = state.exiting ? t * t * t : eased;
      state.y = state.fromY + (state.toY - state.fromY) * eased;
      state.alpha = state.fromAlpha + (state.toAlpha - state.fromAlpha) * fade;
      if (t === 1) { state.y = state.toY; state.alpha = state.toAlpha; }
      return state;
    }
    function move(state, y, alpha, now) {
      if (state.toY === y && state.toAlpha === alpha) return;
      state.fromY = state.y; state.fromAlpha = state.alpha;
      state.toY = y; state.toAlpha = alpha; state.started = now;
    }
    function reset() { states.clear(); order = []; limit = 0; }
    function set(items, now, snap, capacity) {
      limit = capacity;
      states.forEach(function (state) { sample(state, now); });
      var keys = new Set(items.map(function (item) { return item.key; }));
      if (snap) states.clear();
      items.forEach(function (item, rank) {
        var state = states.get(item.key);
        if (!state) {
          state = { key: item.key, y: snap ? rank : rank - .25,
            alpha: snap ? 1 : 0, toY: rank, toAlpha: 1, started: now };
          state.fromY = state.y; state.fromAlpha = state.alpha;
          states.set(item.key, state);
        } else move(state, rank, 1, now);
        state.item = item.value; state.rank = rank; state.exiting = false;
      });
      var outgoing = [];
      states.forEach(function (state, key) {
        if (keys.has(key)) return;
        if (state.alpha < .01 || snap) { states.delete(key); return; }
        state.exiting = true; move(state, limit + .25, 0, now);
        outgoing.push(state);
      });
      // Fast playback may replace several sets before one transition finishes.
      // Keep only the most visible outgoing set, bounded by the existing row capacity.
      outgoing.sort(function (a, b) { return b.alpha - a.alpha; });
      outgoing.slice(limit).forEach(function (state) { states.delete(state.key); });
      order = items.map(function (item) { return item.key; });
      return frame(now);
    }
    function frame(now) {
      var outgoing = [];
      states.forEach(function (state, key) {
        sample(state, now);
        if (state.exiting && state.alpha <= 0) states.delete(key);
        else if (state.exiting) outgoing.push(state);
      });
      return outgoing.concat(order.map(function (key) { return states.get(key); }).filter(Boolean));
    }
    return { set: set, frame: frame, reset: reset };
  }
  var api = { create: create };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MimicryPreviewMotion = api;
})(typeof window !== "undefined" ? window : globalThis);
