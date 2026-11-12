/* Host isolation for the generated static viewer document only. */
(function() {
  'use strict';
  const base = new URL('.', document.currentScript.src);
  const asset = value => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? new URL(value.slice(1), base).href : value;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, options) => nativeFetch(asset(input), options);
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker { constructor(url, options) { super(asset(url), options); } };
  window.MimicryStartup = {pending:true,hold:()=>()=>{}};
  window.addEventListener('DOMContentLoaded', () => {
    const stage = document.querySelector('.stage');
    stage.setAttribute('aria-label','Sequence Comparison');
  });
})();
