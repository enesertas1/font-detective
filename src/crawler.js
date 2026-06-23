const axios = require('axios');
const cheerio = require('cheerio');

const MAX_PAGES = 50;
const CONCURRENCY = 5;
const REQUEST_TIMEOUT = 10000;

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    return u.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function extractLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const links = new Set();
  const base = new URL(baseUrl);

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const abs = new URL(href, baseUrl);
      if ((abs.protocol === 'http:' || abs.protocol === 'https:') && abs.hostname === base.hostname) {
        const normalized = normalizeUrl(abs.href);
        if (normalized) links.add(normalized);
      }
    } catch {}
  });

  return [...links];
}

async function fetchPage(url) {
  const res = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; FontDetective/1.0)',
      'Accept': 'text/html',
    },
    timeout: REQUEST_TIMEOUT,
    maxRedirects: 5,
  });
  const ct = res.headers['content-type'] || '';
  if (!ct.includes('text/html')) return null;
  return res.data;
}

async function crawlSite(startUrl, { maxPages = MAX_PAGES, onProgress } = {}) {
  if (!/^https?:\/\//i.test(startUrl)) startUrl = 'https://' + startUrl;

  const visited = new Set();
  const queue = [normalizeUrl(startUrl)];
  const pages = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const remaining = maxPages - pages.length;
    const batch = queue.splice(0, Math.min(CONCURRENCY, remaining)).filter(u => u && !visited.has(u));
    if (batch.length === 0) continue;
    batch.forEach(u => visited.add(u));

    const results = await Promise.allSettled(
      batch.map(async url => {
        try {
          const html = await fetchPage(url);
          if (!html) return null;
          return { url, html };
        } catch {
          return null;
        }
      })
    );

    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      const { url, html } = result.value;
      pages.push({ url, html });

      if (onProgress) onProgress({ visited: pages.length, queued: queue.length, current: url });

      if (pages.length < maxPages) {
        const links = extractLinks(html, url);
        for (const link of links) {
          if (!visited.has(link) && !queue.includes(link)) {
            queue.push(link);
          }
        }
      }
    }
  }

  return pages;
}

module.exports = { crawlSite };
