/* Load off-screen illustrations near the viewport without changing SVG geometry. */
(function () {
  'use strict';
  const images = Array.from(document.querySelectorAll('image[data-deferred-href]'));
  function load(image) {
    const source = image.getAttribute('data-deferred-href');
    if (!source) return;
    image.setAttribute('href', source);
    image.removeAttribute('data-deferred-href');
  }
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        load(entry.target);
        observer.unobserve(entry.target);
      }
    }, {rootMargin: '600px 0px'});
    images.forEach(image => observer.observe(image));
  } else images.forEach(load);
  window.addEventListener('beforeprint', () => images.forEach(load));
})();
