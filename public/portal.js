const $ = selector => document.querySelector(selector);
const date = new Date();
const imageStyles = document.createElement('link');
imageStyles.rel = 'stylesheet';
imageStyles.href = '/image.css';
document.head.append(imageStyles);
$('#date').textContent = date.toLocaleDateString('hi-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
$('#day').textContent = date.toLocaleDateString('hi-IN', { day: '2-digit' });
$('#month').textContent = date.toLocaleDateString('hi-IN', { month: 'long', year: 'numeric' });
$('#year').textContent = date.getFullYear();

const esc = value => String(value || '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

function safeImageUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      hostname === 'localhost' || hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') || hostname.endsWith('.internal') ||
      hostname.includes(':') || /^\d+(?:\.\d+){0,3}$/.test(hostname)) return '';
    return url.href;
  } catch {
    return '';
  }
}

function showImageFallback(image) {
  const fallback = image.parentElement?.querySelector('.image-fallback');
  image.remove();
  if (fallback) fallback.hidden = false;
}

async function load() {
  try {
    const response = await fetch('/api/public/articles');
    if (!response.ok) throw new Error('Published stories are unavailable.');
    const items = await response.json();
    $('#story-count').textContent = `${items.length} खबरें`;
    $('#ticker').textContent = items[0]?.title || 'प्रकाशित खबरें यहाँ दिखाई देंगी';
    $('#stories').innerHTML = items.length ? items.map((article, index) => {
      const image = safeImageUrl(article.featuredImage);
      return `<article class="card ${index === 0 ? 'feature' : ''}"><div class="card-image">${image
        ? `<img src="${esc(image)}" alt="${esc(article.title)}" loading="lazy" decoding="async">`
        : ''}<span class="image-fallback" ${image ? 'hidden' : ''}>सहरसा <b>NEWS</b></span></div><div class="card-text"><span class="tag">${esc(article.category)} · ${esc(article.location)}</span><h3><a href="/article/${encodeURIComponent(article.slug)}">${esc(article.title)}</a></h3><p>${esc(article.summary || article.seoDescription || article.body.slice(0, 130))}</p><small>${new Date(article.publishedAt).toLocaleDateString('hi-IN', { day: 'numeric', month: 'long', year: 'numeric' })} · Saharsa News Desk</small></div></article>`;
    }).join('') : '<div class="empty">अभी कोई प्रकाशित खबर उपलब्ध नहीं है।<br><small>संपादकीय टीम की स्वीकृत खबरें यहाँ दिखाई देंगी।</small></div>';
  } catch {
    $('#stories').innerHTML = '<div class="empty">खबरें अभी लोड नहीं हो पाईं। कृपया थोड़ी देर बाद पुनः प्रयास करें।</div>';
  }
}

$('#stories').addEventListener('error', event => {
  if (event.target instanceof HTMLImageElement && event.target.closest('.card-image')) showImageFallback(event.target);
}, true);

$('#search-toggle').onclick = () => {
  $('#search').hidden = false;
  $('#search-input').focus();
};
$('#search-close').onclick = () => { $('#search').hidden = true; };
$('#search-input').onkeydown = event => {
  if (event.key === 'Enter') {
    const query = event.target.value.trim();
    if (query) location.href = `/#latest?q=${encodeURIComponent(query)}`;
  }
};

load();
