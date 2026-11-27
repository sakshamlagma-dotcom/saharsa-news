import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { MemoryDatabase } from './memory-mongo.js';

const db = new MemoryDatabase();
const app = createApp({ db, env: { ...process.env, NODE_ENV: 'test', SESSION_SECRET: 'integration-test-session-secret-0123456789' } });
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const base = `http://127.0.0.1:${server.address().port}`;
let cookie = '';
async function request(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(base + url, { ...options, headers });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return response;
}

try {
  const health = await request('/api/health');
  assert.equal(health.status, 200, 'health requires a successful MongoDB ping');
  assert.equal((await health.json()).database, 'mongodb');

  const first = await request('/api/auth/me');
  assert.equal((await first.json()).setupRequired, true);
  const setup = await request('/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.test', password: 'strong-test-password-123' }) });
  assert.equal(setup.status, 201);

  const created = await request('/api/articles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'सहरसा में स्कूलों की नई पहल', body: 'सहरसा जिले के स्कूलों में आज एक नई शैक्षणिक पहल शुरू की गई है। अधिकारियों ने कार्यक्रम की जानकारी साझा की।', category: 'शिक्षा', location: 'Saharsa City' }) });
  assert.equal(created.status, 201);
  const article = await created.json();
  assert.equal(article.status, 'NEW');

  const sensitive = await request('/api/articles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'सहरसा में दुर्घटना की खबर', body: 'स्थानीय रिपोर्ट में दुर्घटना में लोगों के घायल होने की बात कही गई है। पुष्टि जारी है।', category: 'अपराध', location: 'Saharsa City' }) });
  assert.equal(sensitive.status, 201);
  const sensitiveArticle = await sensitive.json();
  assert.equal(sensitiveArticle.status, 'NEEDS_VERIFICATION');
  const blocked = await request(`/api/articles/${sensitiveArticle.id}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'APPROVED' }) });
  assert.equal(blocked.status, 422);

  const verified = await request(`/api/articles/${article.id}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'VERIFIED' }) });
  assert.equal(verified.status, 200);
  const approved = await request(`/api/articles/${article.id}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'APPROVED' }) });
  assert.equal(approved.status, 200);
  const published = await request(`/api/articles/${article.id}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'PUBLISHED' }) });
  assert.equal(published.status, 200);

  const publicList = await fetch(base + '/api/public/articles');
  assert.equal((await publicList.json()).length, 1);
  const feed = await fetch(base + '/feed.xml');
  assert.equal(feed.status, 200);
  assert.match(await feed.text(), /<rss/);
  const sitemap = await fetch(base + '/sitemap.xml');
  assert.equal(sitemap.status, 200);
  assert.match(await sitemap.text(), /<urlset/);
  const articlePage = await fetch(base + `/article/${article.slug}`);
  assert.equal(articlePage.status, 200);
  assert.match(await articlePage.text(), /NewsArticle/);

  const list = await request('/api/articles');
  assert.equal((await list.json()).total, 2);
  const sources = await request('/api/sources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Test RSS', url: 'https://example.test/feed.xml' }) });
  assert.equal(sources.status, 201);
  assert.equal((await request('/api/sources')).status, 200);
  const audit = await request('/api/audit');
  assert.equal(audit.status, 200);
  assert.ok((await audit.json()).length > 0);

  const logout = await request('/api/auth/logout', { method: 'POST' });
  assert.equal(logout.status, 204);
  const denied = await request('/api/articles');
  assert.equal(denied.status, 401);
  console.log('Integration flow passed: Mongo-backed health ping, session auth, article creation/review/publishing, source and audit routes, public article, RSS and sitemap.');
} finally {
  await new Promise(resolve => server.close(resolve));
  await delay(20);
}
