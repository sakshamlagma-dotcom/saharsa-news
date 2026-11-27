const imageStyles = document.createElement('link');
imageStyles.rel = 'stylesheet';
imageStyles.href = '/image.css';
document.head.append(imageStyles);

document.addEventListener('error', event => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  const fallback = image.parentElement?.querySelector('.image-fallback');
  if (!fallback) return;
  image.remove();
  fallback.hidden = false;
}, true);

for (const image of document.querySelectorAll('.article-image-wrap img[data-src]')) {
  image.src = image.dataset.src;
}
