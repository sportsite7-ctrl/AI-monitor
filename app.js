/**
 * AI Monitor - Core Client Logic
 * Handles feed fetching (instant news.json & real-time RSS via proxy),
 * client-side search, multi-source filtering, and responsive UI updates.
 */

// State Management
let allArticles = [];
let currentFilter = {
  source: 'all',
  searchQuery: '',
  onlyImportant: false
};
let isRefreshing = false;

// Important keywords for tagging high-impact AI news
const IMPORTANT_REGEX = /\b(gpt|claude|gemini|release|open-source|opensource|model|models|breakthrough|deepseek|o1|o3|reasoning|agent|agents|llama|mistral|weights|benchmark)\b/i;

// RSS Feeds configuration for browser-side real-time refreshing
const RSS_SOURCES = [
  {
    name: 'OpenAI',
    url: 'https://openai.com/news/rss.xml',
    type: 'rss2json'
  },
  {
    name: 'TechCrunch',
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    type: 'rss2json'
  },
  {
    name: 'The Verge',
    url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
    type: 'rss2json'
  },
  {
    name: 'Hugging Face',
    url: 'https://huggingface.co/blog/feed.xml',
    type: 'rss2json'
  },
  {
    name: 'Hacker News',
    url: 'https://hn.algolia.com/api/v1/search_by_date?query=AI+OR+LLM+OR+GPT+OR+Claude+OR+Gemini&tags=story&hitsPerPage=20',
    type: 'hn_direct'
  },
  {
    name: 'MIT Tech Review',
    url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed/',
    type: 'rss2json'
  }
];

// DOM Elements
const newsGrid = document.getElementById('newsGrid');
const emptyState = document.getElementById('emptyState');
const refreshBtn = document.getElementById('refreshBtn');
const refreshIcon = document.getElementById('refreshIcon');
const refreshBtnText = document.getElementById('refreshBtnText');
const lastUpdatedEl = document.getElementById('lastUpdated');
const newsCountEl = document.getElementById('newsCount');
const filteredCountText = document.getElementById('filteredCountText');
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const importantToggle = document.getElementById('importantToggle');
const sourcePillsContainer = document.getElementById('sourceFilters');
const resetFiltersBtn = document.getElementById('resetFiltersBtn');
const emptyResetBtn = document.getElementById('emptyResetBtn');
const toastContainer = document.getElementById('toastContainer');

// ==========================================================================
// Initialization
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadInitialNews();
});

function setupEventListeners() {
  // Refresh button
  refreshBtn.addEventListener('click', () => {
    if (!isRefreshing) refreshLiveRSS();
  });

  // Search input
  searchInput.addEventListener('input', (e) => {
    currentFilter.searchQuery = e.target.value.trim().toLowerCase();
    clearSearchBtn.style.display = currentFilter.searchQuery ? 'block' : 'none';
    applyFilters();
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    currentFilter.searchQuery = '';
    clearSearchBtn.style.display = 'none';
    searchInput.focus();
    applyFilters();
  });

  // Important toggle
  importantToggle.addEventListener('click', () => {
    currentFilter.onlyImportant = !currentFilter.onlyImportant;
    importantToggle.classList.toggle('active', currentFilter.onlyImportant);
    applyFilters();
  });

  // Source pills
  sourcePillsContainer.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill) return;

    sourcePillsContainer.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');

    currentFilter.source = pill.dataset.source;
    applyFilters();
  });

  // Reset filter buttons
  resetFiltersBtn.addEventListener('click', resetAllFilters);
  emptyResetBtn.addEventListener('click', resetAllFilters);
}

function resetAllFilters() {
  currentFilter.source = 'all';
  currentFilter.searchQuery = '';
  currentFilter.onlyImportant = false;

  searchInput.value = '';
  clearSearchBtn.style.display = 'none';
  importantToggle.classList.remove('active');

  sourcePillsContainer.querySelectorAll('.pill').forEach(p => {
    p.classList.toggle('active', p.dataset.source === 'all');
  });

  applyFilters();
}

// ==========================================================================
// Feed Loading (Instant static -> Interactive live RSS)
// ==========================================================================

/**
 * Loads cached news.json immediately for instant rendering without white screen
 */
async function loadInitialNews() {
  try {
    const res = await fetch('news.json?t=' + Date.now());
    if (!res.ok) throw new Error('news.json HTTP ' + res.status);
    const data = await res.json();

    if (Array.isArray(data.items) && data.items.length > 0) {
      allArticles = data.items;
      updateHeaderStats(data.last_updated || new Date().toISOString());
      applyFilters();
    } else {
      // If news.json is empty for some reason, trigger live fetch
      refreshLiveRSS();
    }
  } catch (err) {
    console.warn('Initial static feed load failed, falling back to live RSS:', err);
    refreshLiveRSS();
  }
}

/**
 * Fully resets list and fetches real-time updates directly from RSS sources
 */
async function refreshLiveRSS() {
  if (isRefreshing) return;
  setRefreshingState(true);

  // Render skeleton loading cards
  renderSkeletons(6);

  const fetchPromises = RSS_SOURCES.map(source => fetchSourceNews(source));
  const results = await Promise.allSettled(fetchPromises);

  const newArticles = [];
  const failedSources = [];
  let successfulSourcesCount = 0;

  results.forEach((res, index) => {
    const sourceName = RSS_SOURCES[index].name;
    if (res.status === 'fulfilled' && Array.isArray(res.value) && res.value.length > 0) {
      newArticles.push(...res.value);
      successfulSourcesCount++;
    } else {
      failedSources.push(sourceName);
    }
  });

  if (newArticles.length > 0) {
    // Deduplicate by link
    const seen = new Set();
    const deduplicated = [];
    for (const art of newArticles) {
      const key = (art.link || '').replace(/\/$/, '').toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(art);
      }
    }

    // Sort descending by date
    deduplicated.sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime());

    allArticles = deduplicated;
    updateHeaderStats(new Date().toISOString());
    applyFilters();

    showToast(`Загружено ${deduplicated.length} свежих новостей из ${successfulSourcesCount} источников`, 'success');
  } else {
    // Total failure: keep existing articles or notify
    applyFilters();
    showToast('Не удалось загрузить новости из RSS. Показаны сохранённые данные.', 'warning');
  }

  if (failedSources.length > 0 && newArticles.length > 0) {
    showToast(`Источник ${failedSources.join(', ')} временно недоступен`, 'info');
  }

  setRefreshingState(false);
}

/**
 * Fetch a single source using appropriate CORS/proxy strategy
 */
async function fetchSourceNews(source) {
  // Strategy 1: Hacker News Algolia direct API (native CORS support)
  if (source.type === 'hn_direct') {
    const res = await fetch(source.url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('HN API ' + res.status);
    const data = await res.json();
    return (data.hits || []).map(hit => {
      const title = stripHtml(hit.title || '');
      const link = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
      const summary = `Обсуждение на Hacker News (${hit.points || 0} баллов, автор: ${hit.author || 'hn'})`;
      return {
        title,
        link,
        source: source.name,
        published: hit.created_at || new Date().toISOString(),
        summary,
        is_important: checkIsImportant(title, summary)
      };
    }).filter(item => item.title && item.link);
  }

  // Strategy 2: RSS-to-JSON public proxy
  const rss2jsonUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(source.url)}`;
  try {
    const res = await fetch(rss2jsonUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'ok' && Array.isArray(data.items) && data.items.length > 0) {
        return data.items.map(item => {
          const title = stripHtml(item.title || '');
          const link = (item.link || '').trim();
          const summary = stripHtml(item.description || item.content || '');
          return {
            title,
            link,
            source: source.name,
            published: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
            summary: truncateText(summary, 220),
            is_important: checkIsImportant(title, summary)
          };
        }).filter(item => item.title && item.link);
      }
    }
  } catch (err) {
    console.warn(`rss2json failed for ${source.name}, trying allorigins fallback:`, err);
  }

  // Strategy 3: Fallback via AllOrigins raw proxy + in-browser DOMParser
  try {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(source.url)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error('AllOrigins HTTP ' + res.status);
    const xmlText = await res.text();
    return parseXmlFeed(xmlText, source.name);
  } catch (err) {
    console.error(`All strategies failed for source ${source.name}:`, err);
    throw err;
  }
}

/**
 * Fallback browser XML parser for RSS 2.0 and Atom feeds
 */
function parseXmlFeed(xmlString, sourceName) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');
  const items = [];

  // Parse RSS 2.0 <item>
  const rssItems = doc.querySelectorAll('item');
  if (rssItems.length > 0) {
    rssItems.forEach(item => {
      const title = stripHtml(item.querySelector('title')?.textContent || '');
      const link = (item.querySelector('link')?.textContent || '').trim();
      const desc = item.querySelector('description')?.textContent || item.querySelector('encoded')?.textContent || '';
      const summary = stripHtml(desc);
      const pubDate = item.querySelector('pubDate')?.textContent || item.querySelector('date')?.textContent || '';
      if (title && link) {
        items.push({
          title,
          link,
          source: sourceName,
          published: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
          summary: truncateText(summary, 220),
          is_important: checkIsImportant(title, summary)
        });
      }
    });
    return items;
  }

  // Parse Atom <entry>
  const atomEntries = doc.querySelectorAll('entry');
  atomEntries.forEach(entry => {
    const title = stripHtml(entry.querySelector('title')?.textContent || '');
    const linkEl = entry.querySelector('link');
    const link = (linkEl?.getAttribute('href') || linkEl?.textContent || '').trim();
    const summaryText = entry.querySelector('summary')?.textContent || entry.querySelector('content')?.textContent || '';
    const summary = stripHtml(summaryText);
    const dateText = entry.querySelector('published')?.textContent || entry.querySelector('updated')?.textContent || '';
    if (title && link) {
      items.push({
        title,
        link,
        source: sourceName,
        published: dateText ? new Date(dateText).toISOString() : new Date().toISOString(),
        summary: truncateText(summary, 220),
        is_important: checkIsImportant(title, summary)
      });
    }
  });

  return items;
}

// ==========================================================================
// Filtering & Rendering
// ==========================================================================

function applyFilters() {
  const { source, searchQuery, onlyImportant } = currentFilter;

  const filtered = allArticles.filter(art => {
    // 1. Source filter
    if (source !== 'all' && art.source !== source) return false;

    // 2. Important filter
    if (onlyImportant && !art.is_important) return false;

    // 3. Search query filter
    if (searchQuery) {
      const titleMatch = (art.title || '').toLowerCase().includes(searchQuery);
      const summaryMatch = (art.summary || '').toLowerCase().includes(searchQuery);
      if (!titleMatch && !summaryMatch) return false;
    }

    return true;
  });

  // Update counts
  filteredCountText.textContent = `Показано новостей: ${filtered.length} из ${allArticles.length}`;
  const isFiltered = source !== 'all' || onlyImportant || Boolean(searchQuery);
  resetFiltersBtn.style.display = isFiltered ? 'inline-block' : 'none';

  renderCards(filtered);
}

function renderCards(articles) {
  if (articles.length === 0) {
    newsGrid.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  newsGrid.innerHTML = articles.map(article => {
    const cleanSourceClass = (article.source || '').replace(/[^a-zA-Z0-9]/g, '');
    const timeFormatted = formatRelativeTime(article.published);
    const fullDate = article.published ? new Date(article.published).toLocaleString('ru-RU') : '';

    return `
      <article class="news-card">
        <div>
          <div class="card-header">
            <span class="source-badge badge-${cleanSourceClass}">
              <span class="source-dot"></span>
              ${escapeHtml(article.source)}
            </span>
            ${article.is_important ? `
              <span class="important-badge">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                </svg>
                Важное
              </span>
            ` : ''}
          </div>

          <h2 class="card-title">
            <a href="${escapeHtml(article.link)}" target="_blank" rel="noopener noreferrer">
              ${escapeHtml(article.title)}
            </a>
          </h2>

          <p class="card-summary">
            ${escapeHtml(article.summary || 'Нет описания')}
          </p>
        </div>

        <div class="card-footer">
          <time class="published-time" datetime="${escapeHtml(article.published)}" title="${escapeHtml(fullDate)}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            ${timeFormatted}
          </time>

          <a href="${escapeHtml(article.link)}" target="_blank" rel="noopener noreferrer" class="card-link">
            Читать
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </a>
        </div>
      </article>
    `;
  }).join('');
}

function renderSkeletons(count = 6) {
  emptyState.style.display = 'none';
  newsGrid.innerHTML = Array.from({ length: count }).map(() => `
    <div class="news-card skeleton-card">
      <div>
        <div class="card-header">
          <div class="skeleton-box" style="width: 80px; height: 22px;"></div>
          <div class="skeleton-box" style="width: 60px; height: 22px;"></div>
        </div>
        <div class="skeleton-box" style="width: 90%; height: 24px; margin-bottom: 8px;"></div>
        <div class="skeleton-box" style="width: 65%; height: 24px; margin-bottom: 16px;"></div>
        <div class="skeleton-box" style="width: 100%; height: 14px; margin-bottom: 6px;"></div>
        <div class="skeleton-box" style="width: 85%; height: 14px; margin-bottom: 24px;"></div>
      </div>
      <div class="card-footer">
        <div class="skeleton-box" style="width: 70px; height: 16px;"></div>
        <div class="skeleton-box" style="width: 50px; height: 16px;"></div>
      </div>
    </div>
  `).join('');
}

// ==========================================================================
// UI Helpers & Formatters
// ==========================================================================

function setRefreshingState(loading) {
  isRefreshing = loading;
  refreshBtn.disabled = loading;
  refreshIcon.classList.toggle('spinning', loading);
  refreshBtnText.textContent = loading ? 'Загрузка RSS...' : 'Обновить сейчас';
}

function updateHeaderStats(dateString) {
  newsCountEl.textContent = allArticles.length;
  if (!dateString) return;

  const date = new Date(dateString);
  const now = new Date();
  const diffMinutes = Math.floor((now - date) / (1000 * 60));

  if (diffMinutes < 1) {
    lastUpdatedEl.textContent = 'Только что';
  } else if (diffMinutes < 60) {
    lastUpdatedEl.textContent = `${diffMinutes} мин. назад`;
  } else {
    lastUpdatedEl.textContent = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
}

function formatRelativeTime(dateString) {
  if (!dateString) return 'Недавно';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;

  if (isNaN(date.getTime()) || diffMs < 0) return 'Только что';

  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMin < 1) return 'Только что';
  if (diffMin < 60) return `${diffMin} мин. назад`;
  if (diffHours < 24) return `${diffHours} ч. назад`;
  if (diffDays === 1) return `Вчера`;
  if (diffDays < 7) return `${diffDays} дн. назад`;

  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function checkIsImportant(title, summary) {
  return IMPORTANT_REGEX.test(`${title} ${summary}`);
}

function stripHtml(htmlStr) {
  if (!htmlStr) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = htmlStr;
  return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
}

function truncateText(text, maxLen = 220) {
  if (!text || text.length <= maxLen) return text;
  return text.substr(0, maxLen).trim().replace(/[.,;!?]\s*$/, '') + '...';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = type === 'success' ? '✅' : type === 'warning' ? '⚠️' : 'ℹ️';
  toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
