/**
 * AI Monitor - Core Client Logic (Українська локалізація)
 * Керує завантаженням стрічок (миттєвий news.json та оновлення RSS через проксі),
 * клієнтським пошуком, фільтрацією за джерелами та оновленням інтерфейсу.
 */

// Керування станом
let allArticles = [];
let currentFilter = {
  source: 'all',
  searchQuery: '',
  onlyImportant: false
};
let isRefreshing = false;

// Ключові слова для виявлення важливих подій та релізів у сфері ШІ
const IMPORTANT_REGEX = /\b(gpt|claude|gemini|release|open-source|opensource|model|models|breakthrough|deepseek|o1|o3|reasoning|agent|agents|llama|mistral|weights|benchmark)\b/i;

// Конфігурація RSS-джерел для оновлення у браузері
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

// Елементи DOM
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
// Ініціалізація
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadInitialNews();
});

function setupEventListeners() {
  // Кнопка оновлення
  refreshBtn.addEventListener('click', () => {
    if (!isRefreshing) refreshLiveRSS();
  });

  // Поле пошуку
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

  // Перемикач "Важливе"
  importantToggle.addEventListener('click', () => {
    currentFilter.onlyImportant = !currentFilter.onlyImportant;
    importantToggle.classList.toggle('active', currentFilter.onlyImportant);
    applyFilters();
  });

  // Фільтри за джерелами
  sourcePillsContainer.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill) return;

    sourcePillsContainer.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');

    currentFilter.source = pill.dataset.source;
    applyFilters();
  });

  // Скидання фільтрів
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
// Завантаження новин
// ==========================================================================

/**
 * Миттєво завантажує локальний news.json для відсутності затримок
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
      refreshLiveRSS();
    }
  } catch (err) {
    console.warn('Локальний news.json недоступний, перехід до RSS:', err);
    refreshLiveRSS();
  }
}

/**
 * Повністю скидає список і робить свіжий запит до відкритих RSS-стрічок
 */
async function refreshLiveRSS() {
  if (isRefreshing) return;
  setRefreshingState(true);

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
    const seen = new Set();
    const deduplicated = [];
    for (const art of newArticles) {
      const key = (art.link || '').replace(/\/$/, '').toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(art);
      }
    }

    deduplicated.sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime());

    allArticles = deduplicated;
    updateHeaderStats(new Date().toISOString());
    applyFilters();

    showToast(`Завантажено ${deduplicated.length} свіжих новин із ${successfulSourcesCount} джерел`, 'success');
  } else {
    applyFilters();
    showToast('Не вдалося завантажити новини з RSS. Показано збережені дані.', 'warning');
  }

  if (failedSources.length > 0 && newArticles.length > 0) {
    showToast(`Джерело ${failedSources.join(', ')} тимчасово недоступне`, 'info');
  }

  setRefreshingState(false);
}

/**
 * Завантажує одне джерело через прямий CORS або публічний проксі
 */
async function fetchSourceNews(source) {
  if (source.type === 'hn_direct') {
    const res = await fetch(source.url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('HN API ' + res.status);
    const data = await res.json();
    return (data.hits || []).map(hit => {
      const title = stripHtml(hit.title || '');
      const link = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
      const summary = `Обговорення на Hacker News (${hit.points || 0} балів, автор: ${hit.author || 'hn'})`;
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
    console.warn(`Помилка rss2json для ${source.name}, спроба allorigins:`, err);
  }

  try {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(source.url)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error('AllOrigins HTTP ' + res.status);
    const xmlText = await res.text();
    return parseXmlFeed(xmlText, source.name);
  } catch (err) {
    console.error(`Усі стратегії завершилися помилкою для ${source.name}:`, err);
    throw err;
  }
}

/**
 * Резервний XML-парсер у браузері для RSS 2.0 та Atom
 */
function parseXmlFeed(xmlString, sourceName) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');
  const items = [];

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
// Фільтрація та рендеринг
// ==========================================================================

function applyFilters() {
  const { source, searchQuery, onlyImportant } = currentFilter;

  const filtered = allArticles.filter(art => {
    if (source !== 'all' && art.source !== source) return false;
    if (onlyImportant && !art.is_important) return false;

    if (searchQuery) {
      const titleMatch = (art.title || '').toLowerCase().includes(searchQuery);
      const summaryMatch = (art.summary || '').toLowerCase().includes(searchQuery);
      if (!titleMatch && !summaryMatch) return false;
    }

    return true;
  });

  filteredCountText.textContent = `Показано новин: ${filtered.length} із ${allArticles.length}`;
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
    const fullDate = article.published ? new Date(article.published).toLocaleString('uk-UA') : '';

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
                Важливе
              </span>
            ` : ''}
          </div>

          <h2 class="card-title">
            <a href="${escapeHtml(article.link)}" target="_blank" rel="noopener noreferrer">
              ${escapeHtml(article.title)}
            </a>
          </h2>

          <p class="card-summary">
            ${escapeHtml(article.summary || 'Опис відсутній')}
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
            Читати
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
// Допоміжні функції та форматування
// ==========================================================================

function setRefreshingState(loading) {
  isRefreshing = loading;
  refreshBtn.disabled = loading;
  refreshIcon.classList.toggle('spinning', loading);
  refreshBtnText.textContent = loading ? 'Завантаження RSS...' : 'Оновити зараз';
}

function updateHeaderStats(dateString) {
  newsCountEl.textContent = allArticles.length;
  if (!dateString) return;

  const date = new Date(dateString);
  const now = new Date();
  const diffMinutes = Math.floor((now - date) / (1000 * 60));

  if (diffMinutes < 1) {
    lastUpdatedEl.textContent = 'Щойно';
  } else if (diffMinutes < 60) {
    lastUpdatedEl.textContent = `${diffMinutes} хв. тому`;
  } else {
    lastUpdatedEl.textContent = date.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  }
}

function formatRelativeTime(dateString) {
  if (!dateString) return 'Нещодавно';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;

  if (isNaN(date.getTime()) || diffMs < 0) return 'Щойно';

  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMin < 1) return 'Щойно';
  if (diffMin < 60) return `${diffMin} хв. тому`;
  if (diffHours < 24) return `${diffHours} год. тому`;
  if (diffDays === 1) return `Вчора`;
  if (diffDays < 7) return `${diffDays} дн. тому`;

  return date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
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
