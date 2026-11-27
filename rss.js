import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';

const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = 50;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const TRACKING_PARAMS = /^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i;
const SECRET_PARAM = /^(?:k|key|api[_-]?key|access[_-]?key|token|access[_-]?token|refresh[_-]?token|secret|client[_-]?secret|password|passwd|auth|authorization|signature|sig|credential|session(?:id)?|sid|jwt|bearer)$/i;

export class RssFeedError extends Error {
  constructor(code, safeMessage) {
    super(safeMessage);
    this.name = 'RssFeedError';
    this.code = code;
    this.safeMessage = safeMessage;
  }
}

export function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('hi-IN')
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function canonicalizeArticleUrl(value, baseUrl) {
  let url;
  try { url = new URL(String(value || ''), baseUrl); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  for (const key of url.searchParams.keys()) if (SECRET_PARAM.test(key)) return null;
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}

export function safeImageUrl(value, baseUrl) {
  let url;
  try { url = new URL(String(value || '').trim(), baseUrl); } catch { return ''; }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  const family = isIP(hostname);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !hostname) return '';
  if (family && !isPublicIp(hostname)) return '';
  if (!family && (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal'))) return '';
  url.hash = '';
  return url.toString();
}

export function isPublicIp(address) {
  const family = isIP(String(address || ''));
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (family !== 6) return false;
  const ip = address.toLowerCase();
  if (ip.startsWith('::ffff:') || ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || /^fe[89ab]/.test(ip) || ip.startsWith('ff') || ip.startsWith('2001:db8:')) return false;
  // Global unicast addresses are in 2000::/3. Other IPv6 ranges are rejected.
  return /^[23][0-9a-f]{0,3}:/i.test(ip);
}

export async function validateFeedUrl(value, { lookup = dnsLookup } = {}) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new RssFeedError('INVALID_URL', 'Enter a valid feed URL.'); }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || !hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new RssFeedError('UNSAFE_URL', 'Feed URLs must use a public HTTP or HTTPS host without credentials or fragments.');
  }
  if (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80')) {
    throw new RssFeedError('UNSAFE_URL', 'Feed URLs may use only the standard HTTP or HTTPS port.');
  }
  for (const key of url.searchParams.keys()) {
    if (SECRET_PARAM.test(key)) throw new RssFeedError('UNSAFE_URL', 'Feed URLs cannot contain credential-like query parameters.');
  }
  const family = isIP(hostname);
  let addresses;
  try {
    addresses = family
      ? [{ address: hostname, family }]
      : await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new RssFeedError('DNS_TIMEOUT', 'Feed hostname lookup timed out.')), 5000);
        lookup(hostname, { all: true, verbatim: true }).then(
          records => { clearTimeout(timer); resolve(records); },
          error => { clearTimeout(timer); reject(error); }
        );
      });
  } catch (error) {
    if (error instanceof RssFeedError) throw error;
    throw new RssFeedError('DNS_FAILED', 'Feed hostname did not resolve.');
  }
  if (!addresses?.length || addresses.some(record => !isPublicIp(record.address))) {
    throw new RssFeedError('UNSAFE_URL', 'Feed hostname resolves to a private or non-public network address.');
  }
  return { url, addresses };
}

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_match, code) => {
      const hex = code[0].toLowerCase() === 'x';
      const number = Number.parseInt(hex ? code.slice(1) : code, hex ? 16 : 10);
      try { return Number.isFinite(number) && number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : ''; } catch { return ''; }
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'");
}

function plainText(value) {
  return decodeXml(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function elementContent(block, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z_][\\w.-]*):)?${escaped}\\s*>`, 'i');
    const match = block.match(expression);
    if (match) return match[1];
  }
  return '';
}

function itemLink(block) {
  const textLink = plainText(elementContent(block, ['link']));
  if (textLink) return textLink;
  const atomLink = block.match(/<(?:[A-Za-z_][\w.-]*:)?link\b([^>]*?)\/?\s*>/i);
  const href = atomLink?.[1]?.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
  return decodeXml(href || '');
}

function tagAttribute(attributes, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return attributes.match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2] || '';
}

function imageFromHtml(value, baseUrl) {
  const html = decodeXml(value);
  for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
    const url = tagAttribute(match[1], 'src');
    const safeUrl = safeImageUrl(url, baseUrl);
    if (safeUrl) return safeUrl;
  }
  return '';
}

function extractFeedImage(block, baseUrl) {
  const candidates = [];
  for (const match of block.matchAll(/<([A-Za-z_][\w.-]*:)?(content|thumbnail)\b([^>]*)\/?\s*>/gi)) {
    const type = tagAttribute(match[3], 'type');
    const medium = tagAttribute(match[3], 'medium').toLowerCase();
    if (match[2].toLowerCase() === 'content' && ((type && !/^image\//i.test(type)) || (medium && medium !== 'image'))) continue;
    const url = tagAttribute(match[3], 'url') || tagAttribute(match[3], 'href');
    if (url) candidates.push(url);
  }
  for (const match of block.matchAll(/<enclosure\b([^>]*)\/?\s*>/gi)) {
    if (/^image\//i.test(tagAttribute(match[1], 'type'))) {
      const url = tagAttribute(match[1], 'url');
      if (url) candidates.push(url);
    }
  }
  for (const match of block.matchAll(/<link\b([^>]*)\/?\s*>/gi)) {
    const type = tagAttribute(match[1], 'type');
    const rel = tagAttribute(match[1], 'rel').toLowerCase();
    if (/^image\//i.test(type) || rel === 'image' || (rel === 'enclosure' && /^image\//i.test(type))) {
      const url = tagAttribute(match[1], 'href');
      if (url) candidates.push(url);
    }
  }
  for (const candidate of candidates) {
    const url = safeImageUrl(decodeXml(candidate), baseUrl);
    if (url) return url;
  }

  for (const name of ['description', 'encoded', 'summary', 'content']) {
    const expression = new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z_][\\w.-]*):)?${name}\\s*>`, 'gi');
    for (const match of block.matchAll(expression)) {
      const url = imageFromHtml(match[1], baseUrl);
      if (url) return url;
    }
  }
  return '';
}

export function parseRssFeed(xml) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml, 'utf8') > MAX_FEED_BYTES) throw new RssFeedError('INVALID_FEED', 'Feed document is empty or too large.');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new RssFeedError('INVALID_FEED', 'Feed document contains unsupported XML declarations.');
  if (!/<(?:[A-Za-z_][\w.-]*:)?(?:rss|feed|RDF)\b/i.test(xml)) throw new RssFeedError('INVALID_FEED', 'Response is not an RSS or Atom feed.');
  const itemExpression = /<(?:[A-Za-z_][\w.-]*:)?(item|entry)\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?\1\s*>/gi;
  const items = [];
  for (const match of xml.matchAll(itemExpression)) {
    const block = match[2];
    const title = plainText(elementContent(block, ['title'])).slice(0, 300);
    const body = plainText(elementContent(block, ['description', 'summary', 'encoded', 'content'])).slice(0, 4000);
    const link = itemLink(block);
    const featuredImage = extractFeedImage(block, link);
    const publishedText = plainText(elementContent(block, ['pubdate', 'published', 'updated', 'date']));
    const publishedDate = publishedText ? new Date(publishedText) : null;
    if (!title) continue;
    items.push({ title, body, link, featuredImage, publishedAt: publishedDate && Number.isFinite(publishedDate.getTime()) ? publishedDate.toISOString() : null });
    if (items.length >= MAX_ITEMS) break;
  }
  const title = plainText(elementContent(xml, ['title'])).slice(0, 300);
  return { title, items };
}

function requestPinned(url, addresses, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = transport(url, {
      method: 'GET',
      headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5', 'accept-encoding': 'identity', 'user-agent': 'SaharsaNews-RSS/1.0' },
      timeout: timeoutMs,
      maxHeaderSize: 16 * 1024,
      lookup: (_host, options, callback) => {
        if (options?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      }
    }, response => {
      const status = response.statusCode || 0;
      const location = response.headers.location;
      if (REDIRECT_STATUSES.has(status)) {
        response.resume();
        resolve({ status, location, body: '' });
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        resolve({ status, body: '' });
        return;
      }
      const chunks = [];
      let size = 0;
      let settled = false;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_FEED_BYTES && !settled) {
          settled = true;
          response.destroy();
          reject(new RssFeedError('FEED_TOO_LARGE', 'Feed response exceeded the size limit.'));
        } else if (!settled) chunks.push(chunk);
      });
      response.on('end', () => {
        if (settled) return;
        settled = true;
        resolve({ status, body: Buffer.concat(chunks).toString('utf8') });
      });
      response.on('error', error => {
        if (!settled) { settled = true; reject(error); }
      });
    });
    request.on('timeout', () => request.destroy(new RssFeedError('TIMEOUT', 'Feed request timed out.')));
    const totalTimer = setTimeout(() => request.destroy(new RssFeedError('TIMEOUT', 'Feed request timed out.')), timeoutMs);
    request.on('close', () => clearTimeout(totalTimer));
    request.on('error', error => { clearTimeout(totalTimer); reject(error); });
    request.end();
  });
}

async function fetchWithRedirects(value, options) {
  let current = value;
  for (let redirect = 0; redirect <= 3; redirect++) {
    const { url, addresses } = await validateFeedUrl(current, options);
    const response = await (options.requestImpl || requestPinned)(url, addresses, options);
    if (!REDIRECT_STATUSES.has(response.status)) return { response, finalUrl: url.toString() };
    if (!response.location || redirect === 3) throw new RssFeedError('REDIRECT_LIMIT', 'Feed redirect limit exceeded.');
    current = new URL(response.location, url).toString();
  }
  throw new RssFeedError('REDIRECT_LIMIT', 'Feed redirect limit exceeded.');
}

function safeFetchError(error) {
  if (error instanceof RssFeedError) return error;
  if (error?.code === 'ETIMEDOUT' || error?.code === 'ECONNABORTED') return new RssFeedError('TIMEOUT', 'Feed request timed out.');
  if (typeof error?.code === 'string' && /^HTTP_[45]\d\d$/.test(error.code)) return new RssFeedError(error.code, `Feed server returned HTTP ${error.code.slice(5)}.`);
  return new RssFeedError('FETCH_FAILED', 'Feed could not be fetched.');
}

export async function fetchRssFeed(value, options = {}) {
  const retryLimit = Math.max(0, Math.min(2, Number(options.retryLimit ?? 2)));
  let lastError;
  for (let attempt = 0; attempt <= retryLimit; attempt++) {
    try {
      const { response, finalUrl } = await fetchWithRedirects(value, options);
      if (response.status < 200 || response.status >= 300) throw new RssFeedError(`HTTP_${response.status}`, `Feed server returned HTTP ${response.status}.`);
      return { ...parseRssFeed(response.body), finalUrl };
    } catch (error) {
      lastError = safeFetchError(error);
      const retryable = !['UNSAFE_URL', 'INVALID_URL', 'INVALID_FEED', 'FEED_TOO_LARGE', 'REDIRECT_LIMIT'].includes(lastError.code) && !/^HTTP_4\d\d$/.test(lastError.code);
      if (attempt >= retryLimit || !retryable) throw lastError;
      await delay(200 * (attempt + 1));
    }
  }
  throw lastError || new RssFeedError('FETCH_FAILED', 'Feed could not be fetched.');
}

export function feedErrorMessage(error) {
  return safeFetchError(error).safeMessage;
}
