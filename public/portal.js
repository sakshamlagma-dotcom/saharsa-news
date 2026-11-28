const $ = selector => document.querySelector(selector);
const date = new Date();
const categories = [
  { id: 'saharsa', label: 'सहरसा समाचार', value: 'सहरसा' },
  { id: 'bihar', label: 'बिहार समाचार', value: 'बिहार' },
  { id: 'politics', label: 'राजनीति', value: 'राजनीति' },
  { id: 'crime', label: 'अपराध', value: 'अपराध' },
  { id: 'education', label: 'शिक्षा', value: 'शिक्षा' },
  { id: 'employment', label: 'रोजगार', value: 'रोजगार' },
  { id: 'health', label: 'स्वास्थ्य', value: 'स्वास्थ्य' },
  { id: 'schemes', label: 'सरकारी योजनाएं', value: 'सरकारी योजनाएं' },
  { id: 'sports', label: 'खेल', value: 'खेल' },
  { id: 'villages', label: 'गांव की खबरें', value: 'गांव की खबरें' }
];
let allStories = [];

$('#date').textContent = date.toLocaleDateString('hi-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
if ($('#day')) $('#day').textContent = date.toLocaleDateString('hi-IN', { day: '2-digit' });
if ($('#month')) $('#month').textContent = date.toLocaleDateString('hi-IN', { month: 'long', year: 'numeric' });
if ($('#year')) $('#year').textContent = date.getFullYear();

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

function articlePath(article) {
  return `/article/${encodeURIComponent(article.slug)}`;
}

function articleDate(article) {
  const value = article.publishedAt || article.createdAt;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString('hi-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'प्रकाशित खबर';
}

function summary(article) {
  return article.summary || article.seoDescription || String(article.body || '').slice(0, 150);
}

function photo(article, extraClass = '', loading = 'lazy') {
  const image = safeImageUrl(article.featuredImage);
  const label = article.category || 'सहरसा';
  return `<div class="news-image ${extraClass}">${image
    ? `<img src="${esc(image)}" alt="${esc(article.imageAlt || article.title)}" width="640" height="360" loading="${loading}" decoding="async"${loading === 'eager' ? ' fetchpriority="high"' : ''}>`
    : ''}<span class="image-fallback" ${image ? 'hidden' : ''}><b>${esc(label)}</b><small>फोटो उपलब्ध नहीं</small></span></div>`;
}

function card(article, options = {}) {
  const flags = [
    article.isFeatured ? '<span class="story-flag">प्रमुख</span>' : '',
    article.isBreaking ? '<span class="story-flag breaking-flag">ब्रेकिंग</span>' : ''
  ].filter(Boolean).join('');
  const readMore = options.readMore ? '<a class="read-more" href="' + articlePath(article) + '">पूरी खबर पढ़ें <span aria-hidden="true">→</span></a>' : '';
  return `<article class="card">${photo(article)}<div class="card-text"><div class="card-meta"><span class="tag">${esc(article.category || 'सहरसा')}</span>${flags}</div><h3><a href="${articlePath(article)}">${esc(article.title)}</a></h3><p>${esc(summary(article))}</p><div class="card-footer"><small>${articleDate(article)}</small>${readMore}</div></div></article>`;
}

function sideCard(article) {
  return `<article class="side-card"><a class="side-photo" href="${articlePath(article)}" aria-label="${esc(article.title)}">${photo(article)}</a><div><span class="tag">${esc(article.category || 'सहरसा')}</span><h3><a href="${articlePath(article)}">${esc(article.title)}</a></h3><small>${articleDate(article)}</small></div></article>`;
}

function heroCard(article) {
  return `<article class="hero-card">${photo(article, 'hero-photo', 'eager')}<div class="hero-copy"><div class="card-meta"><span class="tag">${esc(article.category || 'सहरसा')}</span>${article.isFeatured ? '<span class="story-flag">प्रमुख खबर</span>' : ''}</div><h2><a href="${articlePath(article)}">${esc(article.title)}</a></h2><p>${esc(summary(article))}</p><div class="hero-byline">${articleDate(article)} <span>·</span> ${esc(article.location || 'सहरसा')}</div><a class="read-more" href="${articlePath(article)}">पूरी खबर पढ़ें <span aria-hidden="true">→</span></a></div></article>`;
}

function renderTicker(stories) {
  const breaking = stories.filter(article => article.isBreaking).slice(0, 5);
  const section = $('#breaking');
  if (!breaking.length) {
    section.hidden = true;
    return;
  }
  const links = breaking.map(article => `<a href="${articlePath(article)}">${esc(article.title)}</a>`).join('<span class="ticker-separator" aria-hidden="true">◆</span>');
  $('#ticker').innerHTML = `<span class="ticker-segment">${links}</span><span class="ticker-segment" aria-hidden="true">${links}</span>`;
  section.hidden = false;
}

function renderCategories(stories) {
  $('#category-sections').innerHTML = categories.map(category => {
    const matching = stories.filter(article => article.category === category.value);
    if (!matching.length) return '';
    return `<section class="section category-section" id="category-${category.id}"><div class="section-heading"><div><span class="overline">CATEGORY</span><h2>${esc(category.label)}</h2></div><a class="section-link" href="/?category=${encodeURIComponent(category.value)}#latest">सभी खबरें देखें <span aria-hidden="true">→</span></a></div><div class="stories category-grid">${matching.slice(0, 3).map(article => card(article, { readMore: true })).join('')}</div></section>`;
  }).join('');
}

function render() {
  const params = new URLSearchParams(location.search);
  const query = (params.get('q') || '').trim().toLocaleLowerCase('hi');
  const category = params.get('category') || '';
  const stories = allStories.filter(article => {
    if (category && article.category !== category) return false;
    if (!query) return true;
    return `${article.title} ${summary(article)} ${article.body || ''} ${article.category || ''}`.toLocaleLowerCase('hi').includes(query);
  });
  const count = $('#story-count');
  const countLabel = stories.length === 1 ? '1 खबर' : `${stories.length} खबरें`;
  count.textContent = `${countLabel}${query ? ` · “${query}” के परिणाम` : category ? ` · ${category}` : ''}`;
  renderTicker(stories);

  if (!stories.length) {
    $('#hero-section').hidden = true;
    $('#stories').innerHTML = `<div class="empty">${allStories.length ? 'इस खोज में कोई खबर नहीं मिली।' : 'अभी कोई प्रकाशित खबर उपलब्ध नहीं है।'}</div>`;
    $('#trending-section').hidden = true;
    $('#category-sections').replaceChildren();
    return;
  }

  const lead = stories.find(article => article.isFeatured) || stories[0];
  $('#hero-main').innerHTML = heroCard(lead);
  $('#hero-side-stories').innerHTML = stories.filter(article => article.id !== lead.id).slice(0, 4).map(sideCard).join('');
  $('#hero-section').hidden = false;

  const latest = stories.filter(article => article.id !== lead.id);
  $('#stories').innerHTML = latest.length
    ? latest.slice(0, 12).map(article => card(article, { readMore: true })).join('')
    : '<div class="empty">इस सूची में कोई अन्य खबर उपलब्ध नहीं है।</div>';

  const trending = stories.filter(article => article.isTrending).slice(0, 4);
  $('#trending-section').hidden = !trending.length;
  $('#trending-stories').innerHTML = trending.map(article => card(article)).join('');
  renderCategories(stories);
}

async function load() {
  try {
    const response = await fetch('/api/public/articles?limit=50', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`Published stories request failed (${response.status}).`);
    const payload = await response.json();
    const items = Array.isArray(payload) ? payload : payload.items;
    if (!Array.isArray(items)) throw new Error('Published stories response has an invalid shape.');
    const unique = new Map();
    for (const article of items) {
      if (article?.status && article.status !== 'PUBLISHED') continue;
      const key = article?.id || article?.slug;
      if (!key || !article.title || !article.slug || unique.has(key)) continue;
      unique.set(key, article);
    }
    allStories = [...unique.values()].sort((a, b) => new Date(b.publishedAt || b.createdAt || 0) - new Date(a.publishedAt || a.createdAt || 0));
    render();
  } catch (error) {
    console.error('Unable to load published stories:', error);
    $('#story-count').textContent = 'खबरें उपलब्ध नहीं';
    $('#stories').innerHTML = '<div class="empty">खबरें अभी लोड नहीं हो पाईं। कृपया थोड़ी देर बाद पुनः प्रयास करें।</div>';
  }
}

document.addEventListener('error', event => {
  if (!(event.target instanceof HTMLImageElement) || !event.target.closest('.news-image')) return;
  const image = event.target;
  const fallback = image.parentElement.querySelector('.image-fallback');
  image.remove();
  if (fallback) fallback.hidden = false;
}, true);

$('#search-toggle').addEventListener('click', () => {
  $('#search').hidden = false;
  $('#search-input').focus();
});
$('#search-close').addEventListener('click', () => { $('#search').hidden = true; });
$('#search-form').addEventListener('submit', event => {
  event.preventDefault();
  const query = $('#search-input').value.trim();
  const url = new URL(location.href);
  url.searchParams.delete('category');
  if (query) url.searchParams.set('q', query);
  else url.searchParams.delete('q');
  url.hash = 'latest';
  location.href = `${url.pathname}${url.search}${url.hash}`;
});
$('#menu-toggle').addEventListener('click', event => {
  const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true';
  event.currentTarget.setAttribute('aria-expanded', String(!expanded));
  event.currentTarget.setAttribute('aria-label', expanded ? 'मेन्यू खोलें' : 'मेन्यू बंद करें');
  $('#main-nav').classList.toggle('open', !expanded);
});
$('#main-nav').addEventListener('click', event => {
  if (event.target.closest('a')) {
    $('#main-nav').classList.remove('open');
    $('#menu-toggle').setAttribute('aria-expanded', 'false');
    $('#menu-toggle').setAttribute('aria-label', 'मेन्यू खोलें');
  }
});

load();
