const axios = require('axios');
const cheerio = require('cheerio');

// Known font CDN sources and their classification
const FONT_SOURCES = {
  'fonts.googleapis.com': { type: 'free', provider: 'Google Fonts' },
  'fonts.bunny.net': { type: 'free', provider: 'Bunny Fonts' },
  'use.typekit.net': { type: 'paid', provider: 'Adobe Fonts' },
  'p.typekit.net': { type: 'paid', provider: 'Adobe Fonts' },
  'fast.fonts.net': { type: 'paid', provider: 'Fonts.com' },
  'f.fontdeck.com': { type: 'paid', provider: 'Fontdeck' },
  'cloud.typography.com': { type: 'paid', provider: 'H&Co Typography' },
  'use.fonts.com': { type: 'paid', provider: 'Fonts.com' },
};

// System fonts and CSS keywords to skip
// CSS keywords — completely ignore these, not fonts at all
const CSS_KEYWORDS = new Set([
  'inherit', 'initial', 'unset', 'revert', 'none', 'normal',
  'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
]);

// Known system fonts — show as "Sistem Fontu" in UI, not downloadable
const SYSTEM_FONTS = new Set([
  // Windows
  'arial', 'arial black', 'arial narrow', 'calibri', 'cambria', 'candara',
  'comic sans ms', 'consolas', 'constantia', 'corbel', 'courier new',
  'franklin gothic medium', 'garamond', 'georgia', 'helvetica',
  'impact', 'lucida console', 'lucida sans unicode', 'microsoft sans serif',
  'palatino linotype', 'segoe ui', 'tahoma', 'times new roman',
  'trebuchet ms', 'verdana', 'webdings', 'wingdings',
  // macOS
  'american typewriter', 'andale mono', 'apple chancery', 'apple garamond',
  'baskerville', 'big caslon', 'brush script mt', 'chalkboard',
  'copperplate', 'didact gothic', 'futura', 'gill sans', 'helvetica neue',
  'herculanum', 'hoefler text', 'lucida grande', 'marker felt', 'menlo',
  'monaco', 'optima', 'papyrus', 'skia', 'times',
  // Emoji & symbol
  'apple color emoji', 'segoe ui emoji', 'segoe ui symbol', 'noto color emoji',
  'android emoji', 'twemoji mozilla',
  // Mono (common system monospace)
  'sfmono-regular', 'sf mono', 'cascadia code', 'cascadia mono', 'jetbrains mono',
  // Linux / cross-platform
  '-apple-system', 'blinkmacsystemfont', 'cantarell', 'dejavu sans',
  'dejavu serif', 'droid sans', 'droid serif', 'fira sans', 'freemono',
  'freesans', 'freeserif', 'liberation mono', 'liberation sans',
  'liberation serif', 'nimbus mono', 'nimbus roman', 'nimbus sans',
  'noto sans', 'noto serif', 'oxygen', 'roboto', 'ubuntu',
  'ubuntu mono', 'urw bookman', 'urw chancery',
]);

// Icon fonts — not text fonts, skip entirely
const ICON_FONT_PATTERNS = [
  /font\s*awesome/i,
  /fontawesome/i,
  /material\s*(design\s*)?icons?/i,
  /glyphicons?/i,
  /ionicons?/i,
  /feather/i,
  /swiper[\s-]icons?/i,
  /unicons?/i,
  /themify/i,
  /bootstrap[\s-]icons?/i,
  /remixicon/i,
  /boxicons?/i,
  /phosphor/i,
  /tabler[\s-]icons?/i,
  /icomoon/i,
  /linearicons?/i,
  /budicon/i,
  /dripicons?/i,
  /elegant\s*icons?/i,
  /typicons?/i,
  /flaticon/i,
];

function isIconFont(name) {
  return ICON_FONT_PATTERNS.some(p => p.test(name));
}

function detectSourceFromUrl(url) {
  for (const [domain, info] of Object.entries(FONT_SOURCES)) {
    if (url.includes(domain)) return { ...info, url };
  }
  return null;
}

function extractFontNamesFromGoogleUrl(url) {
  const fonts = [];
  try {
    const urlObj = new URL(url.startsWith('//') ? 'https:' + url : url);
    // Old API: ?family=Roboto:400,700|Open+Sans
    const family = urlObj.searchParams.get('family');
    if (family) {
      family.split('|').forEach(f => {
        const name = f.split(':')[0].replace(/\+/g, ' ');
        if (name) fonts.push(name);
      });
    }
    // New API (CSS2): multiple family= params
    const allFamilies = urlObj.searchParams.getAll('family');
    allFamilies.forEach(f => {
      const name = f.split(':')[0].replace(/\+/g, ' ');
      if (name && !fonts.includes(name)) fonts.push(name);
    });
  } catch {}
  return fonts;
}

function extractFontNamesFromCss(css) {
  const fonts = new Set();
  // @import url('https://fonts.googleapis.com/...')
  const importRegex = /@import\s+(?:url\()?['"]?([^'")\s]+)['"]?\)?/gi;
  let match;
  while ((match = importRegex.exec(css)) !== null) {
    const url = match[1];
    const source = detectSourceFromUrl(url);
    if (source && source.provider === 'Google Fonts') {
      extractFontNamesFromGoogleUrl(url).forEach(f => fonts.add(f));
    }
  }
  // font-family: 'Font Name', fallback — keyed by lowercase for deduplication
  const familyMap = new Map();
  // Seed with Google Fonts names found via @import
  [...fonts].forEach(f => familyMap.set(f.toLowerCase(), { name: f, system: false }));

  const familyRegex = /font-family\s*:\s*([^;{}]+)/gi;
  while ((match = familyRegex.exec(css)) !== null) {
    match[1].split(',').forEach(part => {
      const name = part.trim().replace(/['"()]/g, '').trim();
      const key = name.toLowerCase();
      if (
        name &&
        name.length > 2 &&
        !CSS_KEYWORDS.has(key) &&
        !key.startsWith('var(') && !key.startsWith('var--') && !key.startsWith('--') &&
        !key.includes('!important') &&
        !isIconFont(name) &&
        !familyMap.has(key)
      ) {
        familyMap.set(key, { name, system: SYSTEM_FONTS.has(key) });
      }
    });
  }
  return [...familyMap.values()];
}

function extractFontFaceBlocks(css, baseUrl) {
  const blocks = [];
  const blockRegex = /@font-face\s*\{([^}]+)\}/gi;
  let match;
  while ((match = blockRegex.exec(css)) !== null) {
    const block = match[1];

    // Extract font-family name
    const familyMatch = /font-family\s*:\s*['"]?([^;'"]+)['"]?\s*;/i.exec(block);
    if (!familyMatch) continue;
    const family = familyMatch[1].replace(/['"()]/g, '').trim();
    if (!family || isIconFont(family) || SYSTEM_FONTS.has(family.toLowerCase())) continue;

    // Extract all src URLs
    const srcUrls = [];
    const urlRegex = /url\(['"]?([^'")\s]+)['"]?\)/gi;
    let urlMatch;
    while ((urlMatch = urlRegex.exec(block)) !== null) {
      let url = urlMatch[1];
      // Resolve relative URLs
      if (baseUrl && !url.startsWith('http') && !url.startsWith('//') && !url.startsWith('data:')) {
        try { url = new URL(url, baseUrl).href; } catch {}
      }
      if (url.startsWith('//')) url = 'https:' + url;
      srcUrls.push(url);
    }

    if (srcUrls.length === 0) continue;

    // Classify based on URL domain
    let type = 'unknown';
    let provider = 'Self-hosted';
    for (const url of srcUrls) {
      const src = detectSourceFromUrl(url);
      if (src) { type = src.type; provider = src.provider; break; }
      if (url.includes('fonts.gstatic.com')) { type = 'free'; provider = 'Google Fonts'; break; }
    }

    blocks.push({ family, srcUrls, type, provider });
  }
  return blocks;
}

// Core scanner: takes already-fetched HTML + page URL, fills result via addFont/seenFonts
async function scanHtml(html, pageUrl, result, seenFonts, addFont) {
  const $ = cheerio.load(html);
  const baseUrl = new URL(pageUrl);

  // 1. <link> tags
  $('link[rel="stylesheet"], link[rel="preconnect"], link[rel="preload"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const source = detectSourceFromUrl(href);
    if (source) {
      if (!result.externalCdns.find(c => c.href === href)) result.externalCdns.push({ href, ...source });
      if (source.provider === 'Google Fonts') {
        if (!result.googleFontLinks.includes(href)) result.googleFontLinks.push(href);
        extractFontNamesFromGoogleUrl(href).forEach(name => {
          addFont({ name, source: 'Google Fonts CDN link', type: 'free', downloadable: true });
        });
      }
    }
  });

  // 2. Inline <style>
  $('style').each((_, el) => {
    const css = $(el).html() || '';
    extractFontNamesFromCss(css).forEach(entry => {
      if (!result.fontFamilies.find(f => f.name === entry.name)) result.fontFamilies.push(entry);
    });
    extractFontFaceBlocks(css, pageUrl).forEach(block => {
      addFont({ name: block.family, source: '@font-face src', type: block.type, provider: block.provider, srcUrls: block.srcUrls, downloadable: block.type === 'free' });
    });
    const importRegex = /@import\s+(?:url\()?['"]?([^'")\s]+)['"]?\)?/gi;
    let match;
    while ((match = importRegex.exec(css)) !== null) {
      const url = match[1];
      const source = detectSourceFromUrl(url);
      if (source) {
        if (!result.cssImports.find(c => c.url === url)) result.cssImports.push({ url, ...source });
        if (source.provider === 'Google Fonts') {
          extractFontNamesFromGoogleUrl(url).forEach(name => {
            addFont({ name, source: 'inline @import', type: 'free', downloadable: true });
          });
        }
      }
    }
  });

  // 3. Linked CSS files
  const cssLinks = [];
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!detectSourceFromUrl(href) && href) {
      try { cssLinks.push(new URL(href, baseUrl).href); } catch {}
    }
  });

  await Promise.allSettled(
    cssLinks.slice(0, 10).map(async cssUrl => {
      try {
        const res = await axios.get(cssUrl, { timeout: 8000 });
        extractFontNamesFromCss(res.data).forEach(name => {
          if (!result.fontFamilies.includes(name)) result.fontFamilies.push(name);
        });
        extractFontFaceBlocks(res.data, cssUrl).forEach(block => {
          addFont({ name: block.family, source: '@font-face src', type: block.type, provider: block.provider, srcUrls: block.srcUrls, downloadable: block.type === 'free' });
        });
        const importRegex = /@import\s+(?:url\()?['"]?([^'")\s]+)['"]?\)?/gi;
        let match;
        while ((match = importRegex.exec(res.data)) !== null) {
          const url = match[1];
          const source = detectSourceFromUrl(url);
          if (source) {
            if (!result.cssImports.find(c => c.url === url)) result.cssImports.push({ url, ...source });
            if (source.provider === 'Google Fonts') {
              extractFontNamesFromGoogleUrl(url).forEach(name => {
                addFont({ name, source: 'CSS file @import', type: 'free', downloadable: true });
              });
            }
          }
        }
      } catch {}
    })
  );
}

async function scanUrl(targetUrl) {
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

  const result = {
    url: targetUrl,
    googleFontLinks: [],
    cssImports: [],
    fontFamilies: [],
    externalCdns: [],
    allFonts: [],
  };
  // Helper: deduplicated add — keyed by lowercase name
  // If font already exists, merge new srcUrls and upgrade type if better info available
  const seenFonts = new Map();
  const addFont = (font) => {
    const key = font.name.toLowerCase();
    if (!seenFonts.has(key)) {
      seenFonts.set(key, font);
      result.allFonts.push(font);
    } else {
      const existing = seenFonts.get(key);
      // Merge srcUrls
      if (font.srcUrls && font.srcUrls.length > 0) {
        existing.srcUrls = [...new Set([...(existing.srcUrls || []), ...font.srcUrls])];
      }
      // Upgrade type: free > unknown, and add provider info
      if (font.type === 'free' && existing.type !== 'free') {
        existing.type = 'free';
        existing.downloadable = true;
      }
      if (font.provider && !existing.provider) existing.provider = font.provider;
    }
  };

  const response = await axios.get(targetUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FontDetective/1.0)' },
    timeout: 15000,
  });

  await scanHtml(response.data, targetUrl, result, seenFonts, addFont);
  return finalizeResult(result, addFont);
}

function finalizeResult(result, addFont) {
  // Mark paid CDN fonts
  result.externalCdns.forEach(cdn => {
    if (cdn.type === 'paid' && !result.allFonts.find(f => f.provider === cdn.provider)) {
      addFont({
        name: `(${cdn.provider} — font adı tespit edilemedi)`,
        source: cdn.href,
        type: 'paid',
        provider: cdn.provider,
        downloadable: false,
      });
    }
  });

  // Add remaining font-family names (unknown source)
  result.fontFamilies.forEach(entry => {
    const type = entry.system ? 'system' : 'unknown';
    addFont({ name: entry.name, source: 'CSS font-family', type, downloadable: false });
  });

  return result;
}

async function scanSite(targetUrl, { onProgress, maxPages = 50 } = {}) {
  const { crawlSite } = require('./crawler');
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

  const result = {
    url: targetUrl,
    googleFontLinks: [],
    cssImports: [],
    fontFamilies: [],
    externalCdns: [],
    allFonts: [],
    pagesScanned: 0,
  };

  const seenFonts = new Map();
  const addFont = (font) => {
    const key = font.name.toLowerCase();
    if (!seenFonts.has(key)) {
      seenFonts.set(key, font);
      result.allFonts.push(font);
    } else {
      const existing = seenFonts.get(key);
      if (font.srcUrls && font.srcUrls.length > 0) {
        existing.srcUrls = [...new Set([...(existing.srcUrls || []), ...font.srcUrls])];
      }
      if (font.type === 'free' && existing.type !== 'free') {
        existing.type = 'free';
        existing.downloadable = true;
      }
      if (font.provider && !existing.provider) existing.provider = font.provider;
    }
  };

  const pages = await crawlSite(targetUrl, {
    maxPages,
    onProgress: (p) => {
      result.pagesScanned = p.visited;
      if (onProgress) onProgress(p);
    },
  });

  // Process each crawled page
  await Promise.allSettled(
    pages.map(({ url, html }) => scanHtml(html, url, result, seenFonts, addFont))
  );

  result.pagesScanned = pages.length;
  result.scannedPages = pages.map(p => p.url);
  return finalizeResult(result, addFont);
}

module.exports = { scanUrl, scanSite };
