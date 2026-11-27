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

export async function onRequest({ params, env, request }) {
  if (!env.API) return new Response('API binding is not configured.', { status: 503 });
  const apiUrl = new URL(`/api/public/articles/${encodeURIComponent(params.slug)}`, request.url);
  const response = await env.API.fetch(new Request(apiUrl, { headers: { accept: 'application/json' } }));
  if (!response.ok) return new Response('<!doctype html><html lang="hi"><meta charset="utf-8"><title>खबर नहीं मिली</title><link rel="stylesheet" href="/portal.css"><body><main class="article"><a href="/">सहरसा NEWS</a><h1>यह खबर उपलब्ध नहीं है।</h1><a href="/">मुख्य पृष्ठ पर लौटें</a></main></body></html>', {
    status: 404,
    headers: { 'content-type': 'text/html;charset=UTF-8' }
  });

  const article = await response.json();
  const url = new URL(`/article/${encodeURIComponent(article.slug)}`, request.url).href;
  const description = article.seoDescription || article.summary || article.body.slice(0, 155);
  const published = article.publishedAt ? new Date(article.publishedAt) : new Date();
  const featuredImage = safeImageUrl(article.featuredImage);
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description,
    image: featuredImage ? [featuredImage] : undefined,
    datePublished: published.toISOString(),
    dateModified: article.updatedAt,
    author: { '@type': 'Organization', name: 'Saharsa News' },
    publisher: { '@type': 'Organization', name: 'Saharsa News' },
    mainEntityOfPage: url
  }).replace(/</g, '\\u003c');
  const paragraphs = String(article.body).split(/\n+/).map(paragraph => `<p>${esc(paragraph)}</p>`).join('');
  const imageMeta = featuredImage
    ? `<meta property="og:image" content="${esc(featuredImage)}"><meta name="twitter:image" content="${esc(featuredImage)}">`
    : '';
  const image = featuredImage
    ? `<div class="article-image-wrap"><img class="article-image" data-src="${esc(featuredImage)}" alt="${esc(article.title)}" loading="eager"><div class="image-fallback" hidden>सहरसा <b>NEWS</b></div></div>`
    : '';
  const html = `<!doctype html><html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(article.seoTitle || article.title)} | Saharsa News</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(url)}"><meta property="og:type" content="article"><meta property="og:title" content="${esc(article.title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(url)}">${imageMeta}<meta name="twitter:card" content="${featuredImage ? 'summary_large_image' : 'summary'}"><script type="application/ld+json">${jsonLd}</script><link rel="stylesheet" href="/portal.css"><link rel="stylesheet" href="/image.css"><script src="/article.js" defer></script></head><body><header><a class="logo" href="/">सहरसा <b>NEWS</b></a><nav><a href="/">होम</a><a href="/#latest">ताज़ा खबरें</a><a href="/admin">न्यूज़रूम</a></nav></header><main class="article"><a class="back" href="/">← मुख्य पृष्ठ</a><div class="crumb">होम / ${esc(article.category)} / ${esc(article.location)}</div><span class="tag">${esc(article.category)} · ${esc(article.location)}</span><h1>${esc(article.title)}</h1><p class="summary">${esc(description)}</p>${image}<div class="byline">Saharsa News Desk · ${published.toLocaleDateString('hi-IN', { dateStyle: 'long' })}</div><div class="body">${paragraphs}</div><div class="source">मूल स्रोत: ${article.sourceUrl ? `<a href="${esc(article.sourceUrl)}" rel="nofollow noopener">${esc(article.sourceName || article.sourceUrl)}</a>` : esc(article.sourceName || 'स्थानीय डेस्क')}</div></main><footer>सहरसा की हर खबर, सबसे पहले।</footer></body></html>`;
  return new Response(html, {
    headers: { 'content-type': 'text/html;charset=UTF-8', 'cache-control': 'public, max-age=60, s-maxage=300' }
  });
}
