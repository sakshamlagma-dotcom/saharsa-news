import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { onRequest } from '../functions/article/[slug].js';

const article = {
  slug: 'saharsa-school',
  title: 'सहरसा के विद्यालय की खबर',
  body: 'विद्यालय से जुड़ी सत्यापित जानकारी।',
  summary: 'सहरसा में शिक्षा से जुड़ी खबर।',
  seoDescription: '',
  featuredImage: 'https://images.example.test/school.jpg',
  category: 'शिक्षा',
  location: 'Saharsa City',
  publishedAt: '2026-11-27T10:00:00.000Z',
  updatedAt: '2026-11-27T10:00:00.000Z'
};

async function renderArticle(featuredImage) {
  const response = await onRequest({
    params: { slug: article.slug },
    env: { API: { fetch: async () => Response.json({ ...article, featuredImage }) } },
    request: new Request(`https://saharsanews.online/article/${article.slug}`)
  });
  return response.text();
}

const rendered = await renderArticle(article.featuredImage);
assert.match(rendered, /<img class="article-image" data-src="https:\/\/images\.example\.test\/school\.jpg"/);
assert.match(rendered, /alt="सहरसा के विद्यालय की खबर"/);
assert.match(rendered, /property="og:image"/);
assert.match(rendered, /"image":\["https:\/\/images\.example\.test\/school\.jpg"\]/);
assert.match(rendered, /class="image-fallback" hidden/);
assert.match(rendered, /href="\/image\.css"/);
assert.match(rendered, /src="\/article\.js"/);

const noImage = await renderArticle('');
assert.doesNotMatch(noImage, /class="article-image"/);
assert.doesNotMatch(noImage, /property="og:image"/);
const unsafeImage = await renderArticle('http://127.0.0.1/private.jpg');
assert.doesNotMatch(unsafeImage, /class="article-image"/);

const portal = await readFile(new URL('../public/portal.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/image.css', import.meta.url), 'utf8');
const admin = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
assert.match(portal, /loading="lazy" decoding="async"/);
assert.match(portal, /alt="\$\{esc\(article\.title\)\}"/);
assert.match(portal, /showImageFallback/);
assert.match(css, /object-fit:\s*cover/);
assert.match(admin, /api\/media\/sign/);
assert.match(admin, /api\.cloudinary\.com\/v1_1/);
assert.match(admin, /form\.elements\.featuredImage/);

const originalDocument = globalThis.document;
const originalImage = globalThis.HTMLImageElement;
const listeners = [];
const deferredImage = { dataset: { src: 'https://images.example.test/deferred.jpg' } };
globalThis.HTMLImageElement = class {};
globalThis.document = {
  createElement: () => ({}),
  head: { append: () => {} },
  querySelectorAll: () => [deferredImage],
  addEventListener: (...args) => listeners.push(args)
};
try {
  await import('../public/article.js?image-fallback-test');
  assert.equal(deferredImage.src, deferredImage.dataset.src, 'article image loads only after fallback handling is installed');
  const imageError = listeners.find(([type]) => type === 'error')?.[1];
  assert.equal(typeof imageError, 'function');
  const fallback = { hidden: true };
  const image = new HTMLImageElement();
  image.parentElement = { querySelector: () => fallback };
  image.remove = () => { image.removed = true; };
  imageError({ target: image });
  assert.equal(image.removed, true);
  assert.equal(fallback.hidden, false);
} finally {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  if (originalImage === undefined) delete globalThis.HTMLImageElement;
  else globalThis.HTMLImageElement = originalImage;
}

console.log('Image tests passed: SSR rendering, fallback behavior, responsive card assets, validation, and Cloudinary editor wiring.');
