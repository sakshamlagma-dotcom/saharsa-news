import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { MongoClient } from 'mongodb';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalizeArticleUrl, feedErrorMessage, fetchRssFeed, normalizeTitle, validateFeedUrl } from './rss.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const locations = ['Saharsa City', 'Simri Bakhtiyarpur', 'Sonbarsa Raj', 'Saur Bazar', 'Mahishi', 'Nauhatta', 'Patarghat', 'Salkhua', 'Banma Itahri', 'Kahara'];
const categories = ['सहरसा', 'राजनीति', 'अपराध', 'शिक्षा', 'रोजगार', 'स्वास्थ्य', 'खेल', 'व्यापार', 'गांव की खबरें', 'सरकारी योजनाएं', 'बिहार', 'देश', 'मौसम', 'अन्य'];
const sensitive = /अपराध|हत्या|दुर्घटना|आरोप|बलात्कार|चोरी|पुलिस|राजनीति|घायल|मौत|मृत्यु|crime|death|accident|allegation/i;
const collectionNames = { users: 'render_users', sessions: 'render_sessions', articles: 'render_articles', sources: 'render_news_sources', audit: 'render_audit_logs' };
let activeDiscoveryPromise = null;
const rssRegions = [...locations, 'Kosi Region', 'Bihar', 'National'];

function now() { return new Date().toISOString(); }
function articleRow(row) {
  return row ? {
    id: row.id, title: row.title, slug: row.slug, body: row.body, summary: row.summary || '',
    seoTitle: row.seo_title || '', seoDescription: row.seo_description || '', sourceUrl: row.source_url || '',
    sourceName: row.source_name || '', category: row.category, location: row.location, status: row.status,
    region: row.rss_region || row.location, sourcePublishedAt: row.source_published_at || null, discoveredAt: row.discovered_at || null,
    verified: Boolean(row.verified), authorId: row.author_id || null, createdAt: row.created_at,
    updatedAt: row.updated_at, publishedAt: row.published_at || null
  } : null;
}
function plainDocument(value) {
  if (!value) return null;
  const { _id, ...document } = value;
  return document;
}
function text(value = '') {
  return String(value).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function slugifyHindi(value) {
  return `${value.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 90) || 'news'}-${randomUUID().slice(0, 8)}`;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeXml(value) {
  return String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}
function startupError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.safeMessage = message;
  return error;
}
function safeDriverCode(value) {
  if (typeof value === 'number') return value;
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : undefined;
}

function safeTokenMatches(provided, configured) {
  if (typeof provided !== 'string' || typeof configured !== 'string' || !provided || !configured) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(configured);
  return left.length === right.length && timingSafeEqual(left, right);
}

function enabledFilter() { return { $in: [1, true] }; }
function isEnabled(source) { return source?.enabled === true || source?.enabled === 1; }
function sourceDto(source) {
  return {
    id: source.id, name: source.name, url: source.url, type: source.type || 'RSS',
    category: source.category || 'सहरसा', region: source.region || 'Saharsa City', enabled: isEnabled(source),
    reliability: source.reliability ?? 50, lastFetched: source.last_fetched || null,
    lastSuccess: source.last_success || null, lastError: source.last_error || null,
    discoveredCount: Number(source.discovered_count) || 0, lastTestItemCount: Number(source.last_test_item_count) || 0,
    createdAt: source.created_at || null
  };
}

function safeFeedMessage(error) {
  return feedErrorMessage(error).slice(0, 180);
}

function titlePattern(title) {
  return new RegExp(`^${String(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
}

async function ingestOneSource({ source, sources, articles, fetchFeed }) {
  const fetchedAt = now();
  if (source.id) await sources.updateOne({ id: source.id }, { $set: { last_fetched: fetchedAt } });
  try {
    const feed = await fetchFeed(source.url);
    let added = 0;
    let duplicates = 0;
    for (const item of feed.items.slice(0, 50)) {
      const title = String(item.title || '').trim().slice(0, 300);
      const titleKey = normalizeTitle(title);
      const canonicalUrl = canonicalizeArticleUrl(item.link, feed.finalUrl || source.url);
      if (!titleKey || !canonicalUrl) continue;
      if (source.region === 'National' && !/\b(bihar|saharsa|kosi|seemanchal)\b|बिहार|सहरसा|कोसी|सीमांचल/i.test(`${title} ${item.body || ''}`)) continue;
      const duplicate = await articles.findOne({ $or: [
        { canonical_url: canonicalUrl }, { source_url: canonicalUrl }, { rss_title_key: titleKey }, { title: titlePattern(title) }
      ] }, { projection: { id: 1 } });
      if (duplicate) { duplicates++; continue; }

      const timestamp = now();
      const location = locations.includes(source.region) ? source.region : 'Saharsa City';
      const row = {
        id: randomUUID(), title, slug: slugifyHindi(title), body: String(item.body || '').slice(0, 4000),
        summary: String(item.body || '').slice(0, 1200), seo_title: '', seo_description: '',
        source_url: canonicalUrl, source_name: source.name, category: source.category || 'सहरसा', location,
        rss_region: source.region || location, rss_source_id: source.id || null, canonical_url: canonicalUrl, rss_title_key: titleKey,
        source_published_at: item.publishedAt || null, discovered_at: timestamp,
        status: 'PENDING_REVIEW', verified: 0, author_id: null, created_at: timestamp, updated_at: timestamp, published_at: null
      };
      try { await articles.insertOne(row); added++; }
      catch (error) { if (error?.code === 11000) duplicates++; else throw error; }
    }
    if (source.id) await sources.updateOne({ id: source.id }, { $set: { last_success: now(), last_error: null }, $inc: { discovered_count: added } });
    return { added, duplicates, error: null };
  } catch (error) {
    const message = safeFeedMessage(error);
    if (source.id) await sources.updateOne({ id: source.id }, { $set: { last_error: message } });
    return { added: 0, duplicates: 0, error: message };
  }
}

export async function runRssDiscovery(db, { env = process.env, fetchFeed = fetchRssFeed, trigger = 'manual' } = {}) {
  if (activeDiscoveryPromise) return { skipped: true, reason: 'already_running' };
  const run = (async () => {
    const jobs = db.collection('render_automation_jobs');
    const lockId = 'rss-discovery-lock';
    const lockToken = randomUUID();
    const lockTime = new Date();
    await jobs.updateOne({ _id: lockId }, { $setOnInsert: { locked_until: new Date(0) } }, { upsert: true });
    const lock = await jobs.findOneAndUpdate(
      { _id: lockId, locked_until: { $lte: lockTime } },
      { $set: { lock_token: lockToken, locked_until: new Date(lockTime.getTime() + 20 * 60 * 1000), updated_at: lockTime.toISOString() } },
      { returnDocument: 'after' }
    );
    if (!lock) return { skipped: true, reason: 'already_running' };

    const job = { _id: randomUUID(), id: null, type: 'rss_discovery', state: 'RUNNING', trigger, added: 0, duplicates: 0, errors: [], source_count: 0, processed_sources: 0, created_at: now(), started_at: now(), finished_at: null };
    job.id = job._id;
    try {
      await jobs.insertOne(job);
      const sources = db.collection(collectionNames.sources);
      const articles = db.collection(collectionNames.articles);
      const configured = await sources.find({ enabled: enabledFilter() }).sort({ created_at: 1 }).limit(50).toArray();
      const legacyFeeds = (env.RSS_FEEDS || '').split(',').map(value => value.trim()).filter(Boolean).slice(0, Math.max(0, 50 - configured.length)).map(url => {
        try { return { name: new URL(url).hostname, url, category: 'सहरसा', region: 'Saharsa City' }; } catch { return null; }
      }).filter(Boolean);
      const feeds = [...configured, ...legacyFeeds];
      job.source_count = feeds.length;
      await jobs.updateOne({ _id: job._id }, { $set: { source_count: job.source_count } });
      let nextFeed = 0;
      const workerCount = Math.min(4, feeds.length);
      await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextFeed < feeds.length) {
          const source = feeds[nextFeed++];
          const result = await ingestOneSource({ source, sources, articles, fetchFeed });
          job.added += result.added;
          job.duplicates += result.duplicates;
          job.processed_sources++;
          if (result.error) job.errors.push({ source: String(source.name).slice(0, 100), message: result.error });
          await jobs.updateOne({ _id: job._id }, { $set: { added: job.added, duplicates: job.duplicates, errors: job.errors, processed_sources: job.processed_sources } });
        }
      }));
      job.state = job.errors.length ? (job.processed_sources > job.errors.length ? 'PARTIAL' : 'FAILED') : 'SUCCEEDED';
      job.finished_at = now();
      const { _id: _completedJobId, ...completedJob } = job;
      await jobs.updateOne({ _id: job._id }, { $set: completedJob });
      return { jobId: job.id, state: job.state, added: job.added, duplicates: job.duplicates, sourceCount: job.source_count, processedSources: job.processed_sources, errors: job.errors };
    } catch (error) {
      job.state = 'FAILED';
      job.errors = [...job.errors, { message: 'RSS discovery job failed before completion.' }];
      job.finished_at = now();
      const { _id: _failedJobId, ...failedJob } = job;
      await jobs.updateOne({ _id: job._id }, { $set: failedJob });
      throw error;
    } finally {
      await jobs.updateOne({ _id: lockId, lock_token: lockToken }, { $set: { locked_until: new Date(0), lock_token: null, updated_at: now() } });
    }
  })();
  activeDiscoveryPromise = run;
  try { return await run; }
  finally { if (activeDiscoveryPromise === run) activeDiscoveryPromise = null; }
}

export function safeMongoFailureDetails(error) {
  const rawDetails = [error?.message, error?.errmsg, error?.cause?.message]
    .filter(value => typeof value === 'string')
    .join(' ');
  let failureCategory = 'mongo_server_rejection';
  if (/bad auth|authentication failed|sasl.*(?:fail|error)/i.test(rawDetails)) {
    failureCategory = 'authentication_failed';
  } else if (/ip address.{0,80}(?:not allowed|not in|not on)|(?:not allowed|not in|not on).{0,80}ip access list/i.test(rawDetails)) {
    failureCategory = 'atlas_network_access_denied';
  } else if (/MongoServerSelectionError|MongoNetworkError/.test(`${error?.name || ''} ${error?.cause?.name || ''}`)) {
    failureCategory = 'network_or_server_selection_failed';
  }

  return {
    errorType: typeof error?.name === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(error.name) ? error.name : 'MongoError',
    errorCode: safeDriverCode(error?.code),
    errorCodeName: safeDriverCode(error?.codeName),
    failureCategory
  };
}

export function validateStartupEnvironment(env = process.env, log = message => console.info(message)) {
  const uri = typeof env.MONGODB_URI === 'string' ? env.MONGODB_URI : '';
  const uriConfigured = Boolean(uri.trim());
  const uriScheme = uri.match(/^(mongodb(?:\+srv)?):\/\//i)?.[1]?.toLowerCase() || null;
  const production = env.NODE_ENV === 'production';
  const sessionSecretValid = !production || (typeof env.SESSION_SECRET === 'string' && env.SESSION_SECRET.length >= 32);
  const port = env.PORT === undefined || env.PORT === '' ? 4310 : Number(env.PORT);
  const portValid = Number.isInteger(port) && port > 0 && port <= 65535;
  log(JSON.stringify({
    event: 'startup_config',
    nodeVersion: process.versions.node,
    nodeMajor: Number(process.versions.node.split('.')[0]),
    production,
    portConfigured: env.PORT !== undefined && env.PORT !== '',
    portValid,
    mongodbUriConfigured: uriConfigured,
    mongodbUriScheme: uriScheme,
    sessionSecretConfigured: Boolean(env.SESSION_SECRET),
    sessionSecretValid
  }));
  if (!uriConfigured) throw startupError('MISSING_MONGODB_URI', 'Required environment variable MONGODB_URI is missing.');
  if (!uriScheme) throw startupError('INVALID_MONGODB_URI_FORMAT', 'MONGODB_URI must use mongodb:// or mongodb+srv://. Its value was not logged.');
  if (production && !sessionSecretValid) throw startupError('INVALID_SESSION_SECRET', 'SESSION_SECRET must be set to at least 32 characters in production. Its value was not logged.');
  if (!portValid) throw startupError('INVALID_PORT', 'PORT must be an integer from 1 through 65535.');
  return { port };
}

export async function ensureIndexes(db) {
  await Promise.all([
    db.collection(collectionNames.users).createIndex({ email: 1 }, { unique: true }),
    db.collection(collectionNames.articles).createIndex({ slug: 1 }, { unique: true }),
    db.collection(collectionNames.articles).createIndex({ status: 1, created_at: -1 }),
    db.collection(collectionNames.articles).createIndex({ category: 1, location: 1 }),
    db.collection(collectionNames.articles).createIndex({ canonical_url: 1 }),
    db.collection(collectionNames.articles).createIndex({ rss_title_key: 1 }),
    db.collection(collectionNames.sources).createIndex({ url: 1 }, { unique: true }),
    db.collection(collectionNames.sources).createIndex({ enabled: 1 }),
    db.collection(collectionNames.audit).createIndex({ created_at: -1 }),
    db.collection(collectionNames.sessions).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('render_automation_jobs').createIndex({ type: 1, created_at: -1 })
  ]);
}

class MongoSessionStore extends session.Store {
  constructor(collection) { super(); this.collection = collection; }
  get(sid, callback) {
    this.collection.findOne({ _id: sid }).then(async row => {
      if (!row || row.expiresAt.getTime() <= Date.now()) {
        if (row) await this.destroy(sid, () => {});
        callback(null, null);
        return;
      }
      callback(null, row.session);
    }).catch(callback);
  }
  set(sid, value, callback = () => {}) {
    const expiry = value.cookie?.expires ? new Date(value.cookie.expires) : new Date(Date.now() + 86400000);
    this.collection.updateOne({ _id: sid }, { $set: { session: value, expiresAt: expiry } }, { upsert: true }).then(() => callback()).catch(callback);
  }
  destroy(sid, callback = () => {}) {
    this.collection.deleteOne({ _id: sid }).then(() => callback()).catch(callback);
  }
  touch(sid, value, callback = () => {}) {
    const expiry = value.cookie?.expires ? new Date(value.cookie.expires) : new Date(Date.now() + 86400000);
    this.collection.updateOne({ _id: sid }, { $set: { expiresAt: expiry } }).then(() => callback()).catch(callback);
  }
}

export function createApp({ db, env = process.env, rssFetcher = fetchRssFeed } = {}) {
  if (!db) throw new Error('A connected MongoDB database is required.');
  if (env.NODE_ENV === 'production' && (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)) {
    throw new Error('Set a SESSION_SECRET of at least 32 characters in production.');
  }
  const app = express();
  const users = db.collection(collectionNames.users);
  const sessions = db.collection(collectionNames.sessions);
  const articles = db.collection(collectionNames.articles);
  const sources = db.collection(collectionNames.sources);
  const auditLogs = db.collection(collectionNames.audit);
  const automationJobs = db.collection('render_automation_jobs');
  const settings = db.collection('render_settings');
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
  const rssTestLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
  const automationLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
  const countEnabledSources = () => sources.countDocuments({ enabled: enabledFilter() });
  const addAudit = async (req, action, entity, id, details = {}) => {
    await auditLogs.insertOne({ id: randomUUID(), user_id: req.session.user?.id || null, action, entity, entity_id: id, details: JSON.stringify(details), created_at: now() });
  };
  const requireAuth = (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'लॉगिन आवश्यक है।' });
    next();
  };
  const requireRole = (...roles) => (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'लॉगिन आवश्यक है।' });
    if (!roles.includes(req.session.user.role)) return res.status(403).json({ error: 'इस कार्रवाई की अनुमति नहीं है।' });
    next();
  };
  const createArticle = async (req, fields) => {
    const id = randomUUID();
    const timestamp = now();
    const row = {
      id, title: fields.title, slug: slugifyHindi(fields.title), body: fields.body, summary: '', seo_title: '', seo_description: '',
      source_url: fields.sourceUrl || '', source_name: fields.sourceName || '', category: fields.category, location: fields.location,
      status: fields.status, verified: 0, author_id: req.session.user?.id || null, created_at: timestamp, updated_at: timestamp, published_at: null
    };
    await articles.insertOne(row);
    return articleRow(row);
  };

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'], imgSrc: ["'self'", 'https:', 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"] } }, crossOriginEmbedderPolicy: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use(session({ store: new MongoSessionStore(sessions), secret: env.SESSION_SECRET || 'dev-only-change-this-secret-before-deploy', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 12 } }));
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false }));
  app.use(express.static(path.join(root, 'public')));

  app.get('/api/health', async (_req, res) => {
    try {
      await db.command({ ping: 1 });
      res.json({ status: 'ok', database: 'mongodb', time: now() });
    } catch {
      res.status(503).json({ status: 'error', database: 'mongodb', time: now() });
    }
  });
  app.get('/api/config', async (_req, res) => res.json({ siteName: env.SITE_NAME || 'Saharsa News', tagline: 'सहरसा की हर खबर, सबसे पहले।', locations, categories, rssRegions, integrations: { rss: Boolean(await countEnabledSources() || env.RSS_FEEDS?.trim()), ai: Boolean(env.GEMINI_API_KEY || env.OPENAI_API_KEY), cloudinary: Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET), facebook: Boolean(env.META_PAGE_ACCESS_TOKEN && env.META_PAGE_ID), instagram: Boolean(env.INSTAGRAM_ACCOUNT_ID && env.META_PAGE_ACCESS_TOKEN) } }));
  app.get('/api/auth/me', async (req, res) => res.json({ user: req.session.user || null, setupRequired: !(await users.findOne({}, { projection: { _id: 1 } })) }));
  app.post('/api/auth/setup', loginLimiter, async (req, res) => {
    if (await users.findOne({}, { projection: { _id: 1 } })) return res.status(409).json({ error: 'प्रारंभिक admin पहले से बनाया जा चुका है।' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 12) return res.status(400).json({ error: 'सही email और कम से कम 12 अक्षरों का password दें।' });
    const user = { id: randomUUID(), email, role: 'SUPER_ADMIN' };
    try {
      await users.insertOne({ ...user, password_hash: await bcrypt.hash(password, 12), created_at: now() });
    } catch (error) {
      if (error?.code === 11000) return res.status(409).json({ error: 'प्रारंभिक admin पहले से बनाया जा चुका है।' });
      throw error;
    }
    req.session.user = user;
    await addAudit(req, 'initial_admin_created', 'user', user.id);
    res.status(201).json({ user });
  });
  app.post('/api/auth/login', loginLimiter, async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const user = await users.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Email या password सही नहीं है।' });
    req.session.regenerate(async err => {
      if (err) return res.status(500).json({ error: 'लॉगिन नहीं हो पाया।' });
      req.session.user = { id: user.id, email: user.email, role: user.role };
      try {
        await addAudit(req, 'login', 'user', user.id);
        res.json({ user: req.session.user });
      } catch {
        res.status(500).json({ error: 'लॉगिन नहीं हो पाया।' });
      }
    });
  });
  app.post('/api/auth/logout', requireAuth, (req, res) => {
    addAudit(req, 'logout', 'user', req.session.user.id).then(() => req.session.destroy(() => res.status(204).end())).catch(() => res.status(500).json({ error: 'लॉगआउट नहीं हो पाया।' }));
  });

  app.get('/api/dashboard', requireAuth, async (_req, res) => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const dayStart = today.toISOString();
    today.setUTCDate(today.getUTCDate() + 1);
    const dayEnd = today.toISOString();
    const pendingStatuses = ['PENDING_REVIEW', 'NEEDS_VERIFICATION'];
    const draftStatuses = ['NEW', 'VERIFIED'];
    const [total, todayCount, pending, drafts, approved, published, rejected, enabledSources, failedJobs, lastJob] = await Promise.all([
      articles.countDocuments(), articles.countDocuments({ created_at: { $gte: dayStart, $lt: dayEnd } }),
      articles.countDocuments({ status: { $in: pendingStatuses } }),
      articles.countDocuments({ status: { $in: draftStatuses } }),
      articles.countDocuments({ status: 'APPROVED' }), articles.countDocuments({ status: 'PUBLISHED' }),
      articles.countDocuments({ status: 'REJECTED' }), countEnabledSources(),
      automationJobs.countDocuments({ type: 'rss_discovery', state: { $in: ['FAILED', 'PARTIAL'] } }),
      automationJobs.find({ type: 'rss_discovery' }).sort({ created_at: -1 }).limit(1).toArray()
    ]);
    const setting = await settings.findOne({ _id: 'rss_discovery' });
    res.json({
      total, today: todayCount, pending, pendingReview: pending, drafts, approved, published, rejected,
      inbox: { all: total, review: pending, draft: drafts, approved: approved + published, rejected },
      sources: enabledSources, failedJobs, automation: setting?.enabled === false ? 'paused' : (env.AUTOMATION_TOKEN ? 'hourly' : 'setup_required'),
      lastDiscoveryAt: lastJob[0]?.finished_at || lastJob[0]?.started_at || null
    });
  });
  app.get('/api/articles', requireAuth, async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const filter = {};
    for (const key of ['status', 'category', 'location']) if (req.query[key]) filter[key] = String(req.query[key]);
    const [total, rows] = await Promise.all([articles.countDocuments(filter), articles.find(filter).sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit).toArray()]);
    res.json({ items: rows.map(articleRow), page, limit, total });
  });
  app.post('/api/articles', requireAuth, async (req, res) => {
    const title = text(req.body?.title);
    const body = text(req.body?.body);
    const category = String(req.body?.category || 'सहरसा');
    const location = String(req.body?.location || 'Saharsa City');
    if (title.length < 5 || !body || body.length < 20) return res.status(400).json({ error: 'शीर्षक (कम से कम 5 अक्षर) और विवरण (कम से कम 20 अक्षर) आवश्यक हैं।' });
    if (!categories.includes(category) || !locations.includes(location)) return res.status(400).json({ error: 'अमान्य category या location।' });
    const status = sensitive.test(`${title} ${body}`) ? 'NEEDS_VERIFICATION' : 'NEW';
    const article = await createArticle(req, { title, body, sourceUrl: String(req.body?.sourceUrl || ''), sourceName: String(req.body?.sourceName || 'स्थानीय डेस्क'), category, location, status });
    await addAudit(req, 'article_created', 'article', article.id, { status });
    res.status(201).json(article);
  });
  app.patch('/api/articles/:id', requireRole('SUPER_ADMIN', 'ADMIN', 'EDITOR'), async (req, res) => {
    const row = await articles.findOne({ id: req.params.id });
    if (!row) return res.sendStatus(404);
    const allowed = ['title', 'body', 'summary', 'seoTitle', 'seoDescription', 'category', 'location'];
    const fields = { title: 'title', body: 'body', summary: 'summary', seoTitle: 'seo_title', seoDescription: 'seo_description', category: 'category', location: 'location' };
    const updates = {};
    for (const key of allowed) if (req.body?.[key] !== undefined) updates[fields[key]] = key === 'title' || key === 'body' ? text(req.body[key]) : String(req.body[key]);
    if ((updates.category && !categories.includes(updates.category)) || (updates.location && !locations.includes(updates.location))) return res.status(400).json({ error: 'अमान्य category या location।' });
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'अपडेट करने के लिए कोई मान्य field नहीं मिला।' });
    updates.updated_at = now();
    await articles.updateOne({ id: row.id }, { $set: updates });
    await addAudit(req, 'article_updated', 'article', row.id, Object.keys(updates).filter(key => key !== 'updated_at'));
    res.json(articleRow(await articles.findOne({ id: row.id })));
  });
  app.post('/api/articles/:id/status', requireRole('SUPER_ADMIN', 'ADMIN', 'EDITOR'), async (req, res) => {
    const row = await articles.findOne({ id: req.params.id });
    if (!row) return res.sendStatus(404);
    const action = String(req.body?.status || '');
    const allowed = ['VERIFIED', 'APPROVED', 'REJECTED', 'PUBLISHED'];
    if (!allowed.includes(action)) return res.status(400).json({ error: 'अमान्य status।' });
    if (action === 'PUBLISHED' && row.status !== 'APPROVED') return res.status(422).json({ error: 'पहले खबर को APPROVED करना जरूरी है।' });
    if (action === 'APPROVED' && sensitive.test(`${row.title} ${row.body}`) && row.status !== 'VERIFIED') return res.status(422).json({ error: 'संवेदनशील खबर के लिए पहले संपादक द्वारा सत्यापन जरूरी है।' });
    const changes = { status: action, verified: ['VERIFIED', 'APPROVED', 'PUBLISHED'].includes(action) ? 1 : row.verified, updated_at: now() };
    if (action === 'PUBLISHED') changes.published_at = now();
    await articles.updateOne({ id: row.id }, { $set: changes });
    await addAudit(req, `article_${action.toLowerCase()}`, 'article', row.id);
    res.json(articleRow(await articles.findOne({ id: row.id })));
  });
  app.delete('/api/articles/:id', requireRole('SUPER_ADMIN', 'ADMIN', 'EDITOR'), async (req, res) => {
    const row = await articles.findOne({ id: req.params.id }, { projection: { id: 1 } });
    if (!row) return res.sendStatus(404);
    await articles.deleteOne({ id: row.id });
    await addAudit(req, 'article_deleted', 'article', row.id);
    res.sendStatus(204);
  });

  app.get('/api/sources', requireRole('SUPER_ADMIN'), async (_req, res) => {
    const rows = await sources.find({}).sort({ created_at: -1 }).toArray();
    res.json(rows.map(sourceDto));
  });
  app.post('/api/sources', requireRole('SUPER_ADMIN'), rssTestLimiter, async (req, res) => {
    const name = text(req.body?.name).slice(0, 100);
    const url = String(req.body?.url || '').trim().slice(0, 2048);
    const category = String(req.body?.category || 'सहरसा');
    const region = String(req.body?.region || 'Saharsa City');
    const enabled = req.body?.enabled !== false;
    if (name.length < 2 || !url || !categories.includes(category) || !rssRegions.includes(region)) return res.status(400).json({ error: 'सोर्स नाम, RSS URL, category और क्षेत्र सही चुनें।' });
    let validationFeed = null;
    try {
      if (enabled) validationFeed = await rssFetcher(url);
      else await validateFeedUrl(url);
    } catch (error) { return res.status(422).json({ error: safeFeedMessage(error) }); }
    const validatedAt = enabled ? now() : null;
    const id = randomUUID();
    const row = {
      id, name, url, type: 'RSS', category, region, enabled: enabled ? 1 : 0, reliability: 50,
      last_fetched: validatedAt, last_success: validatedAt, last_error: null, discovered_count: 0,
      last_test_item_count: validationFeed?.items.length || 0, created_at: now()
    };
    try { await sources.insertOne(row); } catch (error) {
      if (error?.code === 11000) return res.status(409).json({ error: 'यह RSS URL पहले से जोड़ा गया है।' });
      throw error;
    }
    await addAudit(req, 'rss_source_created', 'news_source', id, { category, region, enabled });
    res.status(201).json(sourceDto(row));
  });
  app.patch('/api/sources/:id', requireRole('SUPER_ADMIN'), rssTestLimiter, async (req, res) => {
    const row = await sources.findOne({ id: req.params.id });
    if (!row) return res.sendStatus(404);
    const updates = {};
    if (req.body?.name !== undefined) {
      const name = text(req.body.name).slice(0, 100);
      if (name.length < 2) return res.status(400).json({ error: 'सोर्स का नाम कम से कम 2 अक्षर का होना चाहिए।' });
      updates.name = name;
    }
    if (req.body?.category !== undefined) {
      if (!categories.includes(req.body.category)) return res.status(400).json({ error: 'अमान्य category।' });
      updates.category = req.body.category;
    }
    if (req.body?.region !== undefined) {
      if (!rssRegions.includes(req.body.region)) return res.status(400).json({ error: 'अमान्य जिला या क्षेत्र।' });
      updates.region = req.body.region;
    }
    if (req.body?.enabled !== undefined && typeof req.body.enabled !== 'boolean') return res.status(400).json({ error: 'enabled का मान true या false होना चाहिए।' });
    const nextEnabled = req.body?.enabled === undefined ? isEnabled(row) : req.body.enabled;
    const nextUrl = req.body?.url === undefined ? row.url : String(req.body.url).trim().slice(0, 2048);
    if (!nextUrl) return res.status(400).json({ error: 'RSS URL आवश्यक है।' });
    let validationFeed = null;
    try {
      if (nextEnabled && (req.body?.url !== undefined || !isEnabled(row))) validationFeed = await rssFetcher(nextUrl);
      else if (req.body?.url !== undefined) await validateFeedUrl(nextUrl);
    } catch (error) { return res.status(422).json({ error: safeFeedMessage(error) }); }
    updates.url = nextUrl;
    updates.enabled = nextEnabled ? 1 : 0;
    if (validationFeed) {
      updates.last_fetched = now();
      updates.last_success = updates.last_fetched;
      updates.last_error = null;
      updates.last_test_item_count = validationFeed.items.length;
    }
    updates.updated_at = now();
    await sources.updateOne({ id: row.id }, { $set: updates });
    await addAudit(req, 'rss_source_updated', 'news_source', row.id, { enabled: nextEnabled, fields: Object.keys(updates).filter(key => key !== 'updated_at') });
    res.json(sourceDto({ ...row, ...updates }));
  });
  app.delete('/api/sources/:id', requireRole('SUPER_ADMIN'), rssTestLimiter, async (req, res) => {
    const row = await sources.findOne({ id: req.params.id });
    if (!row) return res.sendStatus(404);
    await sources.deleteOne({ id: row.id });
    await addAudit(req, 'rss_source_deleted', 'news_source', row.id, { name: row.name });
    res.sendStatus(204);
  });
  app.post('/api/sources/:id/test', requireRole('SUPER_ADMIN'), rssTestLimiter, async (req, res) => {
    const row = await sources.findOne({ id: req.params.id });
    if (!row) return res.sendStatus(404);
    const testedAt = now();
    try {
      const feed = await rssFetcher(row.url);
      await sources.updateOne({ id: row.id }, { $set: { last_fetched: testedAt, last_success: now(), last_error: null, last_test_item_count: feed.items.length } });
      res.json({ ok: true, itemCount: feed.items.length, testedAt, finalHost: new URL(feed.finalUrl).hostname });
    } catch (error) {
      const message = safeFeedMessage(error);
      await sources.updateOne({ id: row.id }, { $set: { last_fetched: testedAt, last_error: message } });
      res.status(502).json({ ok: false, itemCount: 0, testedAt, error: message });
    }
  });
  app.get('/api/audit', requireRole('SUPER_ADMIN', 'ADMIN'), async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const rows = await auditLogs.find({}).sort({ created_at: -1 }).limit(limit).toArray();
    const userIds = [...new Set(rows.map(row => row.user_id).filter(Boolean))];
    const auditUsers = userIds.length ? await users.find({ id: { $in: userIds } }).toArray() : [];
    const emails = new Map(auditUsers.map(user => [user.id, user.email]));
    res.json(rows.map(row => ({ ...plainDocument(row), email: emails.get(row.user_id) || null })));
  });

  app.post('/api/ingest', requireRole('SUPER_ADMIN'), rssTestLimiter, async (req, res) => {
    try {
      const result = await runRssDiscovery(db, { env, fetchFeed: rssFetcher, trigger: 'admin' });
      if (result.skipped) return res.status(409).json({ error: 'RSS discovery पहले से चल रहा है।', reason: result.reason });
      await addAudit(req, 'rss_discovery_started', 'automation_job', result.jobId, { added: result.added, state: result.state });
      res.json(result);
    } catch (error) {
      console.error(JSON.stringify({ event: 'rss_discovery_failed', errorType: typeof error?.name === 'string' ? error.name : 'Error', errorCode: safeDriverCode(error?.code) }));
      res.status(500).json({ error: 'RSS discovery पूरा नहीं हो पाया।' });
    }
  });
  app.post('/api/automation/discover', automationLimiter, async (req, res) => {
    if (!env.AUTOMATION_TOKEN) return res.status(503).json({ error: 'Automation authentication is not configured.' });
    const authorization = String(req.get('authorization') || '');
    const provided = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!safeTokenMatches(provided, env.AUTOMATION_TOKEN)) return res.status(401).json({ error: 'unauthorized' });
    const setting = await settings.findOne({ _id: 'rss_discovery' });
    if (setting?.enabled === false) return res.status(409).json({ error: 'RSS automation is paused.' });
    try {
      const result = await runRssDiscovery(db, { env, fetchFeed: rssFetcher, trigger: 'github_actions' });
      if (result.skipped) return res.status(409).json({ error: 'RSS discovery is already running.', reason: result.reason });
      res.json(result);
    } catch (error) {
      console.error(JSON.stringify({ event: 'rss_discovery_failed', errorType: typeof error?.name === 'string' ? error.name : 'Error', errorCode: safeDriverCode(error?.code) }));
      res.status(500).json({ error: 'RSS discovery could not complete.' });
    }
  });
  app.get('/api/automation/status', requireRole('SUPER_ADMIN'), async (_req, res) => {
    const [setting, jobs] = await Promise.all([
      settings.findOne({ _id: 'rss_discovery' }),
      automationJobs.find({ type: 'rss_discovery' }).sort({ created_at: -1 }).limit(10).toArray()
    ]);
    res.json({
      enabled: setting?.enabled !== false, schedulerReady: Boolean(env.AUTOMATION_TOKEN),
      interval: 'Hourly GitHub Actions schedule', lastRunAt: jobs[0]?.finished_at || jobs[0]?.started_at || null,
      jobs: jobs.map(job => ({ id: job.id, state: job.state, added: job.added, duplicates: job.duplicates, errors: job.errors, createdAt: job.created_at, startedAt: job.started_at, finishedAt: job.finished_at }))
    });
  });
  app.patch('/api/automation/control', requireRole('SUPER_ADMIN'), async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled का मान true या false होना चाहिए।' });
    await settings.updateOne({ _id: 'rss_discovery' }, { $set: { enabled: req.body.enabled, updated_at: now(), updated_by: req.session.user.id } }, { upsert: true });
    await addAudit(req, req.body.enabled ? 'rss_automation_enabled' : 'rss_automation_paused', 'automation', 'rss_discovery');
    res.json({ enabled: req.body.enabled });
  });

  app.get('/admin', (_req, res) => res.sendFile(path.join(root, 'public', 'admin.html')));
  app.get('/api/public/articles', async (_req, res) => {
    const limit = Math.min(50, Math.max(1, Number(_req.query.limit) || 20));
    const rows = await articles.find({ status: 'PUBLISHED' }).sort({ published_at: -1 }).limit(limit).toArray();
    res.json(rows.map(articleRow));
  });
  app.get('/article/:slug', async (req, res) => {
    const row = await articles.findOne({ slug: req.params.slug, status: 'PUBLISHED' });
    if (!row) return res.status(404).sendFile(path.join(root, 'public', 'not-found.html'));
    const article = articleRow(row);
    const description = article.seoDescription || article.summary || article.body.slice(0, 155);
    const origin = env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    const url = `${origin}/article/${encodeURIComponent(article.slug)}`;
    const schemaJson = JSON.stringify({ '@context': 'https://schema.org', '@type': 'NewsArticle', headline: article.title, description, datePublished: article.publishedAt, dateModified: article.updatedAt, author: { '@type': 'Organization', name: env.SITE_NAME || 'Saharsa News' }, publisher: { '@type': 'Organization', name: env.SITE_NAME || 'Saharsa News' }, mainEntityOfPage: url }).replace(/</g, '\\u003c');
    res.type('html').send(`<!doctype html><html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(article.seoTitle || article.title)} | Saharsa News</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(url)}"><meta property="og:type" content="article"><meta property="og:title" content="${escapeHtml(article.title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(url)}"><meta name="twitter:card" content="summary"><script type="application/ld+json">${schemaJson}</script><link rel="stylesheet" href="/portal.css"></head><body><header><a class="logo" href="/">सहरसा <b>NEWS</b></a><nav><a href="/">होम</a><a href="/#latest">ताज़ा खबरें</a><a href="/admin">न्यूज़रूम</a></nav></header><main class="article"><a class="back" href="/">← मुख्य पृष्ठ</a><div class="crumb">होम / ${escapeHtml(article.category)} / ${escapeHtml(article.location)}</div><span class="tag">${escapeHtml(article.category)} · ${escapeHtml(article.location)}</span><h1>${escapeHtml(article.title)}</h1><p class="summary">${escapeHtml(description)}</p><div class="byline">Saharsa News Desk · ${new Date(article.publishedAt).toLocaleDateString('hi-IN', { dateStyle: 'long' })} · ${escapeHtml(article.sourceName || 'स्रोत विवरण')}</div><div class="body">${escapeHtml(article.body).split(/\n+/).map(paragraph => `<p>${paragraph}</p>`).join('')}</div><div class="source">मूल स्रोत: ${article.sourceUrl ? `<a href="${escapeHtml(article.sourceUrl)}" rel="nofollow noopener">${escapeHtml(article.sourceName || new URL(article.sourceUrl).hostname)}</a>` : escapeHtml(article.sourceName || 'स्थानीय डेस्क')}</div></main><footer>सहरसा की हर खबर, सबसे पहले।</footer></body></html>`);
  });
  app.get('/feed.xml', async (_req, res) => {
    const rows = await articles.find({ status: 'PUBLISHED' }).sort({ published_at: -1 }).limit(50).toArray();
    const base = env.PUBLIC_URL || `${_req.protocol}://${_req.get('host')}`;
    res.type('application/rss+xml').send(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Saharsa News</title><link>${escapeXml(base)}</link><description>सहरसा की हर खबर, सबसे पहले।</description><language>hi-IN</language>${rows.map(article => `<item><title>${escapeXml(article.title)}</title><link>${escapeXml(base)}/article/${encodeURIComponent(article.slug)}</link><guid>${escapeXml(base)}/article/${encodeURIComponent(article.slug)}</guid><description>${escapeXml(article.seo_description || article.summary || '')}</description><pubDate>${new Date(article.published_at).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`);
  });
  app.get('/sitemap.xml', async (_req, res) => {
    const rows = await articles.find({ status: 'PUBLISHED' }, { projection: { slug: 1, updated_at: 1 } }).toArray();
    const base = env.PUBLIC_URL || `${_req.protocol}://${_req.get('host')}`;
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[`<url><loc>${escapeXml(base)}/</loc></url>`, ...rows.map(article => `<url><loc>${escapeXml(base)}/article/${encodeURIComponent(article.slug)}</loc><lastmod>${new Date(article.updated_at).toISOString()}</lastmod></url>`)].join('')}</urlset>`);
  });
  app.get('/news-sitemap.xml', async (_req, res) => {
    const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const rows = await articles.find({ status: 'PUBLISHED', published_at: { $gte: cutoff } }).sort({ published_at: -1 }).toArray();
    const base = env.PUBLIC_URL || `${_req.protocol}://${_req.get('host')}`;
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${rows.map(article => `<url><loc>${escapeXml(base)}/article/${encodeURIComponent(article.slug)}</loc><news:news><news:publication><news:name>Saharsa News</news:name><news:language>hi</news:language></news:publication><news:publication_date>${new Date(article.published_at).toISOString()}</news:publication_date><news:title>${escapeXml(article.title)}</news:title></news:news></url>`).join('')}</urlset>`);
  });
  app.get('/robots.txt', (_req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${env.PUBLIC_URL || `${_req.protocol}://${_req.get('host')}`}/sitemap.xml\n`));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route नहीं मिला।' }));
  app.get('/', (_req, res) => res.sendFile(path.join(root, 'public', 'index.html')));
  return app;
}

export async function connectDatabase(env = process.env, { validated = false } = {}) {
  if (!validated) validateStartupEnvironment(env);
  let client;
  try {
    client = new MongoClient(env.MONGODB_URI, { appName: 'saharsa-news-render', serverSelectionTimeoutMS: 10000 });
    await client.connect();
    const db = client.db(env.MONGODB_DB?.trim() || 'saharsa_news');
    await db.command({ ping: 1 });
    await ensureIndexes(db);
    return { client, db };
  } catch (error) {
    await client?.close().catch(() => {});
    console.error(JSON.stringify({
      event: 'mongodb_startup_failed',
      ...safeMongoFailureDetails(error),
      causeType: typeof error?.cause?.name === 'string' ? error.cause.name : undefined,
      causeCode: safeDriverCode(error?.cause?.code)
    }));
    throw startupError('MONGODB_CONNECT_FAILED', 'MongoDB connection failed. Check Atlas network access and the Render MONGODB_URI setting; secret values were not logged.');
  }
}

export async function startServer(env = process.env) {
  const { port } = validateStartupEnvironment(env);
  const { client, db } = await connectDatabase(env, { validated: true });
  let server;
  try {
    const app = createApp({ db, env });
    server = app.listen(port, '0.0.0.0');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  } catch (error) {
    if (server) await new Promise(resolve => server.close(resolve));
    await client.close().catch(() => {});
    const code = safeDriverCode(error?.code) || 'HTTP_LISTEN_FAILED';
    console.error(JSON.stringify({ event: 'http_startup_failed', errorCode: code, errorType: error?.name || 'Error' }));
    throw startupError('HTTP_LISTEN_FAILED', 'HTTP server could not bind to the configured PORT.');
  }
  console.info(JSON.stringify({ event: 'http_listening', host: '0.0.0.0', port, nodeVersion: process.versions.node }));
  const shutdown = () => server.close(() => client.close().finally(() => process.exit(0)));
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return { app, server, client };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch(error => {
    console.error(JSON.stringify({ event: 'startup_failed', code: safeDriverCode(error?.code) || 'STARTUP_FAILED', message: error?.safeMessage || 'Server startup failed. See the sanitized startup diagnostics above.' }));
    process.exitCode = 1;
  });
}
