import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { createApp, safeMongoFailureDetails, validateStartupEnvironment } from '../server.js';
import { RssFeedError } from '../rss.js';
import { MemoryDatabase } from './memory-mongo.js';

const startupLogs = [];
assert.throws(() => validateStartupEnvironment({ NODE_ENV: 'production', SESSION_SECRET: 'test-only-secret-0123456789012345' }, line => startupLogs.push(line)), error => error.code === 'MISSING_MONGODB_URI');
const missingUriLog = JSON.parse(startupLogs.at(-1));
assert.equal(missingUriLog.mongodbUriConfigured, false);
assert.equal(startupLogs.join('\n').includes('test-only-secret'), false, 'startup diagnostics must not include secrets');
assert.throws(() => validateStartupEnvironment({ NODE_ENV: 'production', MONGODB_URI: 'mongodb+srv://example.invalid/saharsa_news' }, line => startupLogs.push(line)), error => error.code === 'INVALID_SESSION_SECRET');
assert.equal(startupLogs.join('\n').includes('mongodb+srv://'), false, 'startup diagnostics must not include connection strings');
assert.equal(validateStartupEnvironment({ NODE_ENV: 'test', MONGODB_URI: 'mongodb://localhost/saharsa_news', PORT: '10000' }, line => startupLogs.push(line)).port, 10000);
const authFailure = safeMongoFailureDetails({ name: 'MongoServerError', code: 8000, codeName: 'AtlasError', message: 'bad auth: authentication failed; secret=not-for-logs' });
assert.equal(authFailure.failureCategory, 'authentication_failed');
assert.equal(authFailure.errorCode, 8000);
assert.equal(authFailure.errorCodeName, 'AtlasError');
assert.equal(JSON.stringify(authFailure).includes('not-for-logs'), false, 'Mongo diagnostics must not include raw server messages');
assert.equal(safeMongoFailureDetails({ name: 'MongoServerError', message: 'IP address 192.0.2.4 is not allowed to access this cluster' }).failureCategory, 'atlas_network_access_denied');
assert.equal(safeMongoFailureDetails({ name: 'MongoServerSelectionError', cause: { name: 'MongoNetworkError' } }).failureCategory, 'network_or_server_selection_failed');

const db = new MemoryDatabase();
const testFeedItems = [
  { title: 'सहरसा में विद्यालय कार्यक्रम की शुरुआत', body: 'स्रोत के RSS सारांश में जिले के विद्यालयों के कार्यक्रम का विवरण दिया गया है।', link: 'https://news.example.test/saharsa-school', publishedAt: '2026-11-26T09:00:00.000Z' },
  { title: 'सहरसा शहर में सड़क दुर्घटना की नई पुष्टि', body: 'स्रोत ने सड़क दुर्घटना और स्थानीय प्रशासन की प्रतिक्रिया का संक्षिप्त विवरण दिया है।', link: 'https://news.example.test/saharsa-accident', publishedAt: '2026-11-26T10:00:00.000Z' }
];
const rssFetcher = async url => {
  if (url.includes('invalid-feed.example.test')) throw new RssFeedError('INVALID_FEED', 'Response is not an RSS or Atom feed.');
  return { title: 'Test feed', items: testFeedItems, finalUrl: url };
};
const app = createApp({ db, rssFetcher, env: { ...process.env, NODE_ENV: 'test', SESSION_SECRET: 'integration-test-session-secret-0123456789', AUTOMATION_TOKEN: 'integration-test-automation-token' } });
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
  assert.equal((await request('/api/sources')).status, 401, 'RSS management requires an authenticated SUPER_ADMIN');

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
  const edit = await request(`/api/articles/${article.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ summary: 'संपादित सारांश' }) });
  assert.equal((await edit.json()).summary, 'संपादित सारांश');
  const sources = await request('/api/sources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Test RSS', url: 'https://feeds.example.test/feed.xml', category: 'शिक्षा', region: 'Saharsa City', enabled: true }) });
  assert.equal(sources.status, 201);
  const source = await sources.json();
  assert.equal(source.category, 'शिक्षा');
  assert.equal(source.region, 'Saharsa City');
  assert.ok(source.lastSuccess, 'an active feed is fetched successfully before it is saved');
  const invalidSource = await request('/api/sources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Invalid Feed', url: 'https://invalid-feed.example.test/rss.xml', category: 'शिक्षा', region: 'Saharsa City', enabled: true }) });
  assert.equal(invalidSource.status, 422, 'an invalid feed cannot be saved as active');
  const sourceListAfterInvalid = await request('/api/sources').then(response => response.json());
  assert.equal(sourceListAfterInvalid.some(item => item.name === 'Invalid Feed'), false);
  assert.equal((await request('/api/sources')).status, 200);
  const sourceUpdate = await request(`/api/sources/${source.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
  assert.equal((await sourceUpdate.json()).enabled, false);
  const sourceReenabled = await request(`/api/sources/${source.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
  assert.equal((await sourceReenabled.json()).enabled, true, 'a feed is revalidated before it is re-enabled');
  const feedTest = await request(`/api/sources/${source.id}/test`, { method: 'POST' });
  assert.equal(feedTest.status, 200);
  assert.equal((await feedTest.json()).itemCount, 2);
  const discovery = await request('/api/ingest', { method: 'POST' });
  const discovered = await discovery.json();
  assert.equal(discovery.status, 200);
  assert.equal(discovered.added, 2);
  const inboxResponse = await request('/api/articles');
  const inbox = await inboxResponse.json();
  const rssStories = inbox.items.filter(item => item.status === 'PENDING_REVIEW');
  assert.equal(rssStories.length, 2);
  assert.ok(rssStories[0].sourceUrl);
  assert.equal(rssStories[0].sourceName, 'Test RSS');
  assert.ok(rssStories[0].discoveredAt);
  assert.ok(rssStories[0].sourcePublishedAt);
  const publicAfterDiscovery = await request('/api/public/articles');
  assert.equal(publicAfterDiscovery.status, 200);
  assert.equal((await publicAfterDiscovery.json()).some(item => rssStories.some(story => story.id === item.id)), false, 'discovery does not publish articles');
  const repeatedDiscovery = await request('/api/ingest', { method: 'POST' });
  assert.equal((await repeatedDiscovery.json()).added, 0, 'canonical/title duplicates are skipped');
  const accidentStory = rssStories.find(item => item.title.includes('दुर्घटना'));
  assert.ok(accidentStory);
  const unverifiedApproval = await request(`/api/articles/${accidentStory.id}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'APPROVED' }) });
  assert.equal(unverifiedApproval.status, 422, 'sensitive RSS articles require a human verification step');
  assert.equal((await request(`/api/articles/${accidentStory.id}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'VERIFIED' }) })).status, 200);
  assert.equal((await request(`/api/articles/${accidentStory.id}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'APPROVED' }) })).status, 200);
  const automationStatus = await request('/api/automation/status');
  assert.equal(automationStatus.status, 200);
  assert.equal((await automationStatus.json()).schedulerReady, true);
  const badAutomationAuth = await fetch(`${base}/api/automation/discover`, { method: 'POST', headers: { authorization: 'Bearer wrong-token', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(badAutomationAuth.status, 401);
  const automationRun = await fetch(`${base}/api/automation/discover`, { method: 'POST', headers: { authorization: 'Bearer integration-test-automation-token', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(automationRun.status, 200);
  const paused = await request('/api/automation/control', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
  assert.equal((await paused.json()).enabled, false);
  const pausedRun = await fetch(`${base}/api/automation/discover`, { method: 'POST', headers: { authorization: 'Bearer integration-test-automation-token', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(pausedRun.status, 409);
  await request('/api/automation/control', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
  const sourceEdit = await request(`/api/sources/${source.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Updated Test RSS', category: 'बिहार' }) });
  assert.equal((await sourceEdit.json()).name, 'Updated Test RSS');
  assert.equal((await request(`/api/sources/${source.id}`, { method: 'DELETE' })).status, 204);
  const articlesAfterDelete = await request('/api/articles');
  assert.equal((await articlesAfterDelete.json()).items.some(item => item.sourceName === 'Test RSS'), true, 'deleting a feed preserves discovered articles and their attribution');
  const audit = await request('/api/audit');
  assert.equal(audit.status, 200);
  assert.ok((await audit.json()).length > 0);

  const logout = await request('/api/auth/logout', { method: 'POST' });
  assert.equal(logout.status, 204);
  const denied = await request('/api/articles');
  assert.equal(denied.status, 401);
  const login = await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.test', password: 'strong-test-password-123' }) });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).user.role, 'SUPER_ADMIN');
  assert.equal((await request('/api/auth/logout', { method: 'POST' })).status, 204);
  await db.collection('render_users').insertOne({ id: 'editor-user', email: 'editor@example.test', role: 'EDITOR', password_hash: await bcrypt.hash('editor-test-password-123', 4), created_at: new Date().toISOString() });
  const editorLogin = await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'editor@example.test', password: 'editor-test-password-123' }) });
  assert.equal(editorLogin.status, 200);
  assert.equal((await request('/api/sources')).status, 403, 'non-SUPER_ADMIN users cannot manage RSS sources');
  assert.equal((await request('/api/sources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Forbidden', url: 'https://feeds.example.test/nope', category: 'शिक्षा', region: 'Saharsa City' }) })).status, 403);
  assert.equal((await request('/api/sources/nonexistent', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) })).status, 403);
  assert.equal((await request('/api/sources/nonexistent', { method: 'DELETE' })).status, 403);
  assert.equal((await request('/api/sources/nonexistent/test', { method: 'POST' })).status, 403);
  assert.equal((await request('/api/ingest', { method: 'POST' })).status, 403, 'manual RSS ingestion requires SUPER_ADMIN');
  assert.equal((await request('/api/automation/status')).status, 403, 'automation controls require SUPER_ADMIN');
  assert.equal((await request('/api/articles')).status, 200, 'existing newsroom article access remains available to editors');
  console.log('Integration flow passed: API auth/roles, RSS source CRUD and validation, hourly automation control, Mongo-backed newsroom, approval safety, publishing, public news and sitemap.');
} finally {
  await new Promise(resolve => server.close(resolve));
  await delay(20);
}
