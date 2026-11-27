import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fetchRssFeed, isPublicIp, normalizeTitle, parseRssFeed, validateFeedUrl } from '../rss.js';
import { runRssDiscovery } from '../server.js';
import { MemoryDatabase } from './memory-mongo.js';

const rssXml = `<?xml version="1.0"?><rss version="2.0"><channel><title>सहरसा समाचार</title><item><title><![CDATA[सहरसा में विद्यालय की नई पहल]]></title><link>https://news.example.test/story/1?utm_source=rss</link><description><![CDATA[जिले के विद्यालयों में नई पहल के बारे में स्रोत का संक्षिप्त विवरण।]]></description><pubDate>Thu, 26 Nov 2026 09:00:00 GMT</pubDate></item></channel></rss>`;
const atomXml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>सहरसा अपडेट</title><entry><title>सहरसा के बाजार की खबर</title><link rel="alternate" href="https://news.example.test/story/2"/><summary>स्रोत से मिला छोटा सारांश।</summary><updated>2026-11-27T10:00:00Z</updated></entry></feed>`;

const parsed = parseRssFeed(rssXml);
assert.equal(parsed.title, 'सहरसा समाचार');
assert.equal(parsed.items.length, 1);
assert.equal(parsed.items[0].title, 'सहरसा में विद्यालय की नई पहल');
assert.match(parsed.items[0].body, /विद्यालयों में नई पहल/);
assert.equal(parsed.items[0].publishedAt, '2026-11-26T09:00:00.000Z');
assert.equal(parseRssFeed(atomXml).items[0].link, 'https://news.example.test/story/2');
assert.throws(() => parseRssFeed('<html><body>Not a feed</body></html>'), error => error.code === 'INVALID_FEED');
assert.throws(() => parseRssFeed('<!DOCTYPE rss [<!ENTITY x "unsafe">]><rss/>'), error => error.code === 'INVALID_FEED');
assert.equal(normalizeTitle('सहरसा में बड़ी खबर!'), normalizeTitle('सहरसा में बड़ी खबर'));

assert.equal(isPublicIp('93.184.216.34'), true);
assert.equal(isPublicIp('10.0.0.1'), false);
assert.equal(isPublicIp('169.254.169.254'), false);
assert.equal(isPublicIp('::1'), false);
await assert.rejects(validateFeedUrl('http://127.0.0.1/rss.xml'), error => error.code === 'UNSAFE_URL');
await assert.rejects(validateFeedUrl('http://feed.example.test/rss.xml', { lookup: async () => [{ address: '192.168.1.4', family: 4 }] }), error => error.code === 'UNSAFE_URL');
await assert.rejects(validateFeedUrl('https://feed.example.test/rss.xml?api_key=hidden', { lookup: async () => [{ address: '93.184.216.34', family: 4 }] }), error => error.code === 'UNSAFE_URL');
await assert.rejects(validateFeedUrl('https://feed.example.test/rss.xml?key=hidden', { lookup: async () => [{ address: '93.184.216.34', family: 4 }] }), error => error.code === 'UNSAFE_URL');
const publicUrl = await validateFeedUrl('https://feed.example.test/rss.xml', { lookup: async () => [{ address: '93.184.216.34', family: 4 }] });
assert.equal(publicUrl.url.hostname, 'feed.example.test');
let retryCalls = 0;
await assert.rejects(fetchRssFeed('https://feed.example.test/rss.xml', {
  lookup: async () => [{ address: '93.184.216.34', family: 4 }], retryLimit: 2,
  requestImpl: async () => { retryCalls++; return { status: 503, body: '' }; }
}), error => error.code === 'HTTP_503');
assert.equal(retryCalls, 3, 'transient feed failures use only the configured retry limit');

const db = new MemoryDatabase();
const source = { id: 'feed-one', name: 'Test Saharsa Feed', url: 'https://feed.example.test/rss.xml', type: 'RSS', category: 'शिक्षा', region: 'Saharsa City', enabled: 1, discovered_count: 0, created_at: new Date().toISOString() };
await db.collection('render_news_sources').insertOne(source);
let feedCalls = 0;
const workingFetcher = async () => { feedCalls++; return { ...parsed, finalUrl: source.url }; };
const firstRun = await runRssDiscovery(db, { env: {}, fetchFeed: workingFetcher });
assert.equal(firstRun.state, 'SUCCEEDED');
assert.equal(firstRun.added, 1);
assert.equal(firstRun.duplicates, 0);
const discovered = await db.collection('render_articles').find({}).toArray();
assert.equal(discovered.length, 1);
assert.equal(discovered[0].status, 'PENDING_REVIEW');
assert.equal(discovered[0].source_url, 'https://news.example.test/story/1');
assert.equal(discovered[0].source_name, source.name);
assert.equal(discovered[0].source_published_at, parsed.items[0].publishedAt);
assert.ok(discovered[0].discovered_at);
const secondRun = await runRssDiscovery(db, { env: {}, fetchFeed: workingFetcher });
assert.equal(secondRun.added, 0);
assert.equal(secondRun.duplicates, 1, 'canonical URL/title duplicates are skipped');
assert.equal(feedCalls, 2);
assert.equal((await db.collection('render_news_sources').findOne({ id: source.id })).discovered_count, 1);

const titleDuplicateDb = new MemoryDatabase();
await titleDuplicateDb.collection('render_news_sources').insertOne({ ...source, id: 'title-source-a' });
let titleFeedRequest = 0;
const titleFetcher = async url => ({ ...parsed, items: [{ ...parsed.items[0], link: `${url}/story/${++titleFeedRequest}` }], finalUrl: url });
await runRssDiscovery(titleDuplicateDb, { env: {}, fetchFeed: titleFetcher });
const titleDuplicateRun = await runRssDiscovery(titleDuplicateDb, { env: {}, fetchFeed: titleFetcher });
assert.equal(titleDuplicateRun.added, 0);
assert.equal(titleDuplicateRun.duplicates, 1, 'normalized title duplicates are detected across canonical URLs');

const failingSource = { id: 'bad-feed', name: 'Unavailable feed', url: 'https://offline.example.test/rss.xml', category: 'सहरसा', region: 'Kosi Region', enabled: 1, created_at: new Date().toISOString() };
await db.collection('render_news_sources').insertOne(failingSource);
const failureRun = await runRssDiscovery(db, { env: {}, fetchFeed: async url => {
  if (url === failingSource.url) throw new Error('private server detail and credential text');
  return { ...parsed, finalUrl: source.url };
} });
assert.equal(failureRun.state, 'PARTIAL');
assert.equal(failureRun.errors[0].message, 'Feed could not be fetched.');
const failedSourceState = await db.collection('render_news_sources').findOne({ id: failingSource.id });
assert.match(failedSourceState.last_error, /Feed could not be fetched/);
assert.equal(failedSourceState.last_fetched !== undefined, true);
assert.equal(JSON.stringify(failureRun).includes('credential text'), false);

const overlapDb = new MemoryDatabase();
await overlapDb.collection('render_news_sources').insertOne({ ...source, id: 'overlap-feed' });
let releaseFetch;
let fetchStarted = false;
const blockedFetcher = async () => {
  fetchStarted = true;
  return new Promise(resolve => { releaseFetch = () => resolve({ ...parsed, finalUrl: source.url }); });
};
const pendingRun = runRssDiscovery(overlapDb, { env: {}, fetchFeed: blockedFetcher });
while (!fetchStarted) await delay(1);
const { runRssDiscovery: independentDiscovery } = await import('../server.js?independent-worker=true');
const overlapped = await independentDiscovery(overlapDb, { env: {}, fetchFeed: blockedFetcher });
assert.deepEqual(overlapped, { skipped: true, reason: 'already_running' });
releaseFetch();
const completedRun = await pendingRun;
assert.equal(completedRun.state, 'SUCCEEDED');

console.log('RSS tests passed: RSS/Atom parsing, unsafe and invalid feeds, duplicate detection, failed feed logging, pending review, and overlap prevention.');
