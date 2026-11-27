const $ = selector => document.querySelector(selector);
let stories = [];
let storyFilter = 'all';
let isSetup = false;
let isSuperAdmin = false;
let currentUser = null;
let inboxCounts = { all: 0, review: 0, draft: 0, approved: 0 };
let readyToPublishCount = 0;
let storyPage = 1;
let storyTotal = 0;
const storyPageSize = 100;

const toUiStatus = status => ({
  PENDING_REVIEW: 'review', NEEDS_VERIFICATION: 'review', NEW: 'draft', VERIFIED: 'verified',
  APPROVED: 'approved', PUBLISHED: 'published', REJECTED: 'rejected'
}[status] || 'draft');

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 2800);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : '';
  } catch { return ''; }
}

function formatDate(value) {
  if (!value) return 'अभी तक नहीं';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('hi-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'अज्ञात';
}

function renderStories() {
  const counts = {
    all: Number(inboxCounts.all ?? stories.length),
    review: Number(inboxCounts.review ?? stories.filter(story => story.status === 'review').length),
    draft: Number(inboxCounts.draft ?? stories.filter(story => ['draft', 'verified'].includes(story.status)).length),
    approved: Number(inboxCounts.approved ?? stories.filter(story => ['approved', 'published'].includes(story.status)).length)
  };
  $('#total').textContent = counts.all;
  $('#pending').textContent = counts.review;
  $('#ready').textContent = readyToPublishCount;
  $('#nav-count').textContent = counts.all;
  $('#all-count').textContent = counts.all;
  $('#review-count').textContent = counts.review;
  $('#draft-count').textContent = counts.draft;
  $('#approved-count').textContent = counts.approved;
  const moreStories = $('#load-more-stories');
  moreStories.hidden = stories.length >= storyTotal;
  moreStories.textContent = `${Math.max(0, storyTotal - stories.length)} और खबरें लोड करें`;

  const shown = storyFilter === 'all' ? stories : stories.filter(story => {
    if (storyFilter === 'draft') return ['draft', 'verified'].includes(story.status);
    if (storyFilter === 'approved') return ['approved', 'published'].includes(story.status);
    return story.status === storyFilter;
  });
  $('#story-list').innerHTML = shown.length ? shown.map(story => {
    const sourceLink = safeExternalUrl(story.sourceUrl);
    const statusLabel = { review: 'समीक्षा बाकी', draft: 'ड्राफ्ट', verified: 'सत्यापित', approved: 'स्वीकृत', published: 'प्रकाशित', rejected: 'अस्वीकृत' }[story.status] || 'समीक्षा बाकी';
    const controls = [];
    if (['draft', 'review', 'verified'].includes(story.status)) controls.push(`<button class="mini-btn" data-action="ai" data-id="${escapeHtml(story.id)}">✳ AI मसौदा</button>`);
    if (['draft', 'review'].includes(story.status)) controls.push(`<button class="mini-btn ok" data-action="VERIFIED" data-id="${escapeHtml(story.id)}">✓ सत्यापित</button>`);
    if (['draft', 'review', 'verified'].includes(story.status)) controls.push(`<button class="mini-btn ok" data-action="APPROVED" data-id="${escapeHtml(story.id)}">स्वीकृत करें</button>`);
    if (['review', 'draft', 'verified'].includes(story.status)) controls.push(`<button class="mini-btn" data-action="REJECTED" data-id="${escapeHtml(story.id)}">अस्वीकार</button>`);
    if (story.status !== 'published' && story.status !== 'rejected') controls.push(`<button class="mini-btn" data-action="edit-story" data-id="${escapeHtml(story.id)}">संपादित करें</button>`);
    if (story.status === 'approved') controls.push(`<button class="mini-btn ok" data-action="PUBLISHED" data-id="${escapeHtml(story.id)}">प्रकाशित करें ↗</button>`);
    controls.push(`<button class="mini-btn" data-action="delete" data-id="${escapeHtml(story.id)}">हटाएं</button>`);
    return `<article class="story"><div class="story-top"><div><h3>${escapeHtml(story.title)}</h3><p>${escapeHtml(story.summary || story.body || '')}</p></div><span class="badge ${story.status === 'verified' ? 'draft' : story.status === 'published' || story.status === 'approved' ? 'approved' : story.status === 'rejected' ? 'off' : 'review'}">${statusLabel}</span></div><div class="story-meta"><span>${escapeHtml(story.sourceName || 'न्यूज़रूम')}</span><span class="sep">•</span><span>${escapeHtml(story.region || story.location || 'क्षेत्र नहीं दिया')}</span><span class="sep">•</span><span>${formatDate(story.discoveredAt || story.createdAt)}</span>${story.sourcePublishedAt ? `<span class="sep">•</span><span>स्रोत तारीख ${formatDate(story.sourcePublishedAt)}</span>` : ''}</div><div class="story-actions">${sourceLink ? `<a class="mini-btn" href="${escapeHtml(sourceLink)}" target="_blank" rel="noopener noreferrer">मूल खबर खोलें ↗</a>` : ''}${controls.join('')}</div></article>`;
  }).join('') : '<div class="empty"><div class="empty-icon">▤</div>अभी यहाँ कोई खबर नहीं है।<br>सुपर एडमिन RSS source जोड़ सकता है।</div>';
}

function populateSelect(select, values, selected = '') {
  if (!select) return;
  select.innerHTML = values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  if (values.includes(selected)) select.value = selected;
}

function renderSources(sources, config) {
  const enabled = sources.filter(source => source.enabled).length;
  $('#source-count').innerHTML = `${[enabled > 0, config.integrations.ai, config.integrations.facebook, config.integrations.instagram, config.integrations.cloudinary].filter(Boolean).length}<span class="unit"> / 5</span>`;
  $('#rss-status').textContent = enabled ? `${enabled} सक्रिय / ${sources.length}` : 'कोई सक्रिय feed नहीं';
  $('#rss-status').classList.toggle('off', !enabled);
  $('#ai-status').textContent = config.integrations.ai ? 'जुड़ा हुआ' : 'सेटअप बाकी';
  $('#ai-status').classList.toggle('off', !config.integrations.ai);
  $('#cloud-status').textContent = config.integrations.cloudinary ? 'जुड़ा हुआ' : 'सेटअप बाकी';
  $('#cloud-status').classList.toggle('off', !config.integrations.cloudinary);
  $('#meta-status').textContent = config.integrations.facebook || config.integrations.instagram ? 'जुड़ा हुआ' : 'सेटअप बाकी';
  $('#meta-status').classList.toggle('off', !config.integrations.facebook && !config.integrations.instagram);
  $('#locations').innerHTML = config.locations.map(location => `<span>${escapeHtml(location)}</span>`).join('');
  $('#source-list').innerHTML = sources.length ? sources.map(source => `<div class="source-list-row source-managed"><div class="source-managed-main"><span class="source-title">${escapeHtml(source.name)}</span><small>${escapeHtml(source.category)} · ${escapeHtml(source.region)}</small><small>अंतिम सफल fetch: ${formatDate(source.lastSuccess)} · मिले: ${Number(source.discoveredCount) || 0}</small>${source.lastError ? `<small class="source-error">त्रुटि: ${escapeHtml(source.lastError)}</small>` : ''}</div><span class="status-pill ${source.enabled ? '' : 'off'}">${source.enabled ? 'सक्रिय' : 'बंद'}</span><div class="source-buttons"><button class="mini-btn" data-source-action="test" data-source-id="${escapeHtml(source.id)}">टेस्ट</button><button class="mini-btn" data-source-action="edit" data-source-id="${escapeHtml(source.id)}">एडिट</button><button class="mini-btn" data-source-action="toggle" data-enabled="${source.enabled}" data-source-id="${escapeHtml(source.id)}">${source.enabled ? 'बंद करें' : 'चालू करें'}</button><button class="mini-btn" data-source-action="delete" data-source-id="${escapeHtml(source.id)}">हटाएं</button></div></div>`).join('') : '<div class="empty source-empty">अभी कोई RSS feed जोड़ा नहीं गया है। पहले किसी वास्तविक और उपलब्ध RSS/Atom URL को जाँचकर जोड़ें।</div>';
}

function renderAutomation(automation) {
  const ready = automation.schedulerReady;
  const enabled = automation.enabled;
  const state = $('#automation-state');
  state.textContent = !ready ? 'Token सेटअप बाकी' : enabled ? 'सक्रिय' : 'रुका हुआ';
  state.classList.toggle('off', !ready || !enabled);
  $('#automation-info').textContent = `${automation.interval} · पिछला रन ${formatDate(automation.lastRunAt)} · ${automation.jobs.length} हाल के jobs`;
  const button = $('#automation-toggle');
  button.disabled = !ready;
  button.textContent = enabled ? 'Automation रोकें' : 'Automation चालू करें';
  $('#automation-jobs').innerHTML = automation.jobs.length ? automation.jobs.slice(0, 4).map(job => `<div class="automation-job"><span>${formatDate(job.startedAt || job.createdAt)}</span><b>${escapeHtml(job.state)} · ${Number(job.added) || 0} नई</b></div>`).join('') : '<div class="automation-job"><span>अभी कोई run नहीं</span><b>—</b></div>';
}

async function showAuth() {
  const response = await fetch('/api/auth/me');
  const data = await response.json();
  if (data.user) {
    currentUser = data.user;
    isSuperAdmin = data.user.role === 'SUPER_ADMIN';
    $('#auth-screen').hidden = true;
    return data.user;
  }
  currentUser = null;
  isSuperAdmin = false;
  isSetup = data.setupRequired;
  $('#auth-title').textContent = isSetup ? 'पहला Admin बनाएं' : 'संपादक लॉगिन';
  $('#auth-copy').textContent = isSetup ? 'यह account newsroom का SUPER_ADMIN होगा।' : 'डैशबोर्ड खोलने के लिए साइन इन करें।';
  $('#auth-submit').textContent = isSetup ? 'Admin account बनाएं' : 'लॉगिन';
  $('#auth-form [name=password]').autocomplete = isSetup ? 'new-password' : 'current-password';
  $('#auth-screen').hidden = false;
  return null;
}

async function load() {
  const user = currentUser || await showAuth();
  if (!user) return;
  const requests = [fetch(`/api/articles?page=1&limit=${storyPageSize}`), fetch('/api/config'), fetch('/api/dashboard')];
  if (isSuperAdmin) requests.push(fetch('/api/sources'), fetch('/api/automation/status'));
  const responses = await Promise.all(requests);
  if (responses.some(response => response.status === 401)) { currentUser = null; await showAuth(); return; }
  const [articlesResponse, configResponse, dashboardResponse, sourcesResponse, automationResponse] = responses;
  if (!articlesResponse.ok || !configResponse.ok || !dashboardResponse.ok) throw new Error('Dashboard data unavailable');
  const [articleResult, config, dashboard] = await Promise.all([articlesResponse.json(), configResponse.json(), dashboardResponse.json()]);
  stories = articleResult.items.map(article => ({ ...article, status: toUiStatus(article.status) }));
  storyPage = articleResult.page || 1;
  storyTotal = Number(articleResult.total) || 0;
  inboxCounts = dashboard.inbox || { all: articleResult.total, review: dashboard.pending, draft: dashboard.drafts, approved: dashboard.approved + dashboard.published };
  readyToPublishCount = Number(dashboard.approved) || 0;
  if (isSuperAdmin) {
    const sources = sourcesResponse.ok ? await sourcesResponse.json() : [];
    renderSources(sources, config);
    $('#source-editor').hidden = false;
    $('#ingest').hidden = false;
    $('#automation').hidden = false;
    populateSelect($('#source-category'), config.categories, 'सहरसा');
    populateSelect($('#source-region'), config.rssRegions || config.locations, 'Saharsa City');
    populateSelect($('#edit-story-category'), config.categories, 'सहरसा');
    if (automationResponse.ok) renderAutomation(await automationResponse.json());
    else renderAutomation({ enabled: false, schedulerReady: false, interval: 'Hourly GitHub Actions schedule', lastRunAt: null, jobs: [] });
  } else {
    $('#source-editor').hidden = true;
    $('#ingest').hidden = true;
    $('#automation').hidden = true;
    $('#source-count').innerHTML = '<span class="unit">केवल SUPER_ADMIN</span>';
    $('#rss-status').textContent = 'केवल SUPER_ADMIN';
  }
  renderStories();
}

function beginSourceEdit(source) {
  const form = $('#source-form');
  form.elements.id.value = source.id;
  form.elements.name.value = source.name;
  form.elements.url.value = source.url;
  form.elements.category.value = source.category;
  form.elements.region.value = source.region;
  form.elements.enabled.checked = source.enabled;
  $('#source-editor-title').textContent = 'RSS source संपादित करें';
  $('#source-editor').open = true;
  $('#source-editor').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

$('#today').textContent = new Date().toLocaleDateString('hi-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
  document.querySelector('.filter.active')?.classList.remove('active');
  button.classList.add('active');
  storyFilter = button.dataset.filter;
  renderStories();
}));

$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const url = isSetup ? '/api/auth/setup' : '/api/auth/login';
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) });
  const data = await response.json();
  if (!response.ok) { $('#auth-error').textContent = data.error || 'प्रवेश नहीं हो पाया।'; return; }
  $('#auth-screen').hidden = true;
  $('#auth-error').textContent = '';
  currentUser = data.user;
  isSuperAdmin = data.user.role === 'SUPER_ADMIN';
  await load();
});

$('#new-story').onclick = () => $('#story-dialog').showModal();
$('#refresh').onclick = () => load().catch(() => toast('डैशबोर्ड अपडेट नहीं हो पाया।'));

$('#load-more-stories').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const nextPage = storyPage + 1;
    const response = await fetch(`/api/articles?page=${nextPage}&limit=${storyPageSize}`);
    if (response.status === 401) { currentUser = null; await showAuth(); return; }
    if (!response.ok) throw new Error('Story page unavailable');
    const result = await response.json();
    const existingIds = new Set(stories.map(story => story.id));
    stories.push(...result.items.filter(article => !existingIds.has(article.id)).map(article => ({ ...article, status: toUiStatus(article.status) })));
    storyPage = result.page || nextPage;
    storyTotal = Number(result.total) || storyTotal;
    renderStories();
  } catch { toast('बाकी खबरें लोड नहीं हो पाईं।'); }
  finally { button.disabled = false; }
});

$('#story-form').addEventListener('submit', async event => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  const raw = new FormData(event.currentTarget);
  const form = Object.fromEntries(raw);
  const file = raw.get('image');
  if (file?.size) {
    if (!file.type.startsWith('image/') || file.size > 8 * 1024 * 1024) { toast('8 MB तक की image चुनें।'); return; }
    const signed = await fetch('/api/media/sign', { method: 'POST' });
    const signature = await signed.json();
    if (!signed.ok) { toast(signature.error || 'Image upload setup नहीं है'); return; }
    const uploadData = new FormData();
    uploadData.set('file', file);
    uploadData.set('api_key', signature.apiKey);
    uploadData.set('timestamp', signature.timestamp);
    uploadData.set('folder', signature.folder);
    uploadData.set('signature', signature.signature);
    const upload = await fetch(`https://api.cloudinary.com/v1_1/${signature.cloudName}/image/upload`, { method: 'POST', body: uploadData });
    const asset = await upload.json();
    if (!upload.ok) { toast('Cloudinary upload विफल हुआ।'); return; }
    form.featuredImage = asset.secure_url;
  }
  delete form.image;
  form.sourceUrl = form.url;
  delete form.url;
  const config = await fetch('/api/config').then(response => response.json());
  const response = await fetch('/api/articles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...form, category: 'सहरसा', location: config.locations[0], sourceName: 'स्थानीय डेस्क' }) });
  const data = await response.json();
  if (!response.ok) { toast(data.error || 'खबर सेव नहीं हुई'); return; }
  event.currentTarget.reset();
  $('#story-dialog').close();
  toast(data.status === 'NEEDS_VERIFICATION' ? 'संवेदनशील खबर समीक्षा में भेजी गई।' : 'खबर ड्राफ्ट में सेव हुई।');
  await load();
});

$('#story-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  if (button.dataset.action === 'edit-story') {
    const story = stories.find(item => item.id === button.dataset.id);
    if (!story) return;
    const form = $('#edit-story-form');
    form.dataset.id = story.id;
    form.elements.title.value = story.title;
    form.elements.summary.value = story.summary || '';
    $('#edit-story-category').value = story.category;
    $('#edit-story-dialog').showModal();
    return;
  }
  if (button.dataset.action === 'ai') {
    button.disabled = true;
    button.textContent = 'AI मसौदा बना रहा है…';
    const response = await fetch(`/api/ai/draft/${button.dataset.id}`, { method: 'POST' });
    const data = await response.json();
    button.disabled = false;
    button.textContent = '✳ AI मसौदा';
    if (!response.ok) { toast(data.error || 'AI मसौदा नहीं बना'); return; }
    $('#ai-title').value = data.draft.headline;
    $('#ai-summary').value = data.draft.summary;
    $('#ai-body').value = data.draft.body;
    $('#ai-facts').textContent = data.draft.needsVerification.length ? `सत्यापन जरूरी: ${data.draft.needsVerification.join(' · ')}` : 'सभी तथ्य संपादक द्वारा स्रोत से सत्यापित करें। AI draft प्रकाशित नहीं हुआ।';
    $('#ai-dialog').showModal();
    return;
  }
  let response;
  if (button.dataset.action === 'delete') {
    if (!confirm('क्या इस खबर को न्यूज़रूम से हटाएं?')) return;
    response = await fetch(`/api/articles/${button.dataset.id}`, { method: 'DELETE' });
  } else {
    response = await fetch(`/api/articles/${button.dataset.id}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: button.dataset.action }) });
  }
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok) { toast(data.error || 'कार्रवाई पूरी नहीं हुई'); return; }
  const labels = { VERIFIED: 'सत्यापित', APPROVED: 'स्वीकृत', PUBLISHED: 'प्रकाशित', REJECTED: 'अस्वीकृत' };
  toast(button.dataset.action === 'delete' ? 'खबर हटाई गई।' : `खबर ${labels[button.dataset.action] || 'अपडेट'} हुई।`);
  await load();
});

$('#edit-story-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const response = await fetch(`/api/articles/${form.dataset.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: form.elements.title.value, summary: form.elements.summary.value, category: form.elements.category.value }) });
  const data = await response.json();
  if (!response.ok) { toast(data.error || 'खबर संपादित नहीं हुई'); return; }
  $('#edit-story-dialog').close();
  toast('खबर अपडेट हुई।');
  await load();
});
$('#edit-story-cancel').onclick = () => $('#edit-story-dialog').close();
$('#edit-story-cancel-footer').onclick = () => $('#edit-story-dialog').close();

$('#ingest').onclick = async () => {
  const button = $('#ingest');
  button.disabled = true;
  button.textContent = 'RSS जांच रहे हैं…';
  try {
    const response = await fetch('/api/ingest', { method: 'POST' });
    const data = await response.json();
    toast(response.ok ? `${data.added} नई खबरें मिलीं · ${data.duplicates} duplicate छोड़ीं।` : data.error || 'RSS जांच नहीं हुई।');
    await load();
  } catch { toast('RSS जांच पूरी नहीं हुई।'); }
  finally { button.disabled = false; button.innerHTML = 'अभी RSS जांचें <span>→</span>'; }
};

$('#source-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = { name: form.elements.name.value, url: form.elements.url.value, category: form.elements.category.value, region: form.elements.region.value, enabled: form.elements.enabled.checked };
  const id = form.elements.id.value;
  const response = await fetch(id ? `/api/sources/${id}` : '/api/sources', { method: id ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) });
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok) { toast(data.error || 'RSS feed सेव नहीं हुई'); return; }
  form.reset();
  form.elements.id.value = '';
  form.elements.enabled.checked = true;
  $('#source-editor-title').textContent = '＋ RSS source जोड़ें';
  $('#source-editor').open = false;
  toast(id ? 'RSS source अपडेट हुई।' : `Feed सत्यापित और सेव हुई · ${data.testedItems ?? 'validated'}`);
  await load();
});

$('#source-cancel').onclick = () => {
  const form = $('#source-form');
  form.reset();
  form.elements.id.value = '';
  form.elements.enabled.checked = true;
  $('#source-editor-title').textContent = '＋ RSS source जोड़ें';
  $('#source-editor').open = false;
};

$('#source-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-source-action]');
  if (!button) return;
  const source = await fetch('/api/sources').then(response => response.ok ? response.json() : []);
  const current = source.find(item => item.id === button.dataset.sourceId);
  if (!current) { toast('RSS source नहीं मिली।'); return; }
  const action = button.dataset.sourceAction;
  if (action === 'edit') { beginSourceEdit(current); return; }
  if (action === 'delete') {
    if (!confirm('RSS source हटाएं? पहले से मिली खबरें सुरक्षित रहेंगी।')) return;
    const response = await fetch(`/api/sources/${current.id}`, { method: 'DELETE' });
    if (!response.ok) { toast('RSS source हट नहीं सकी।'); return; }
    toast('RSS source हटाई गई।');
    await load();
    return;
  }
  if (action === 'toggle') {
    const response = await fetch(`/api/sources/${current.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: !current.enabled }) });
    const data = response.status === 204 ? {} : await response.json();
    if (!response.ok) { toast(data.error || 'RSS status नहीं बदला'); return; }
    toast(current.enabled ? 'RSS source बंद हुई।' : 'Feed जाँचकर सक्रिय हुई।');
    await load();
    return;
  }
  if (action === 'test') {
    button.disabled = true;
    const response = await fetch(`/api/sources/${current.id}/test`, { method: 'POST' });
    const data = await response.json();
    toast(response.ok ? `Feed ठीक है · ${data.itemCount} items` : data.error || 'Feed जाँच असफल');
    await load();
  }
});

$('#automation-toggle').onclick = async () => {
  const enabled = $('#automation-state').textContent !== 'सक्रिय';
  const response = await fetch('/api/automation/control', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }) });
  const data = await response.json();
  if (!response.ok) { toast(data.error || 'Automation setting नहीं बदली'); return; }
  toast(enabled ? 'Automation चालू है।' : 'Automation रोक दिया।');
  await load();
};

showAuth().then(user => user && load()).catch(() => toast('सर्वर से संपर्क नहीं हो पाया।'));
