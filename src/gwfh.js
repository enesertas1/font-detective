const axios = require('axios');
const fs = require('fs');
const path = require('path');

const GWFH_API = 'https://gwfh.mranftl.com/api/fonts';
const CACHE_FILE = path.join(__dirname, '..', 'cache', 'gwfh-fonts.json');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

let fontListCache = null;

async function getGwfhFontList() {
  // Memory cache
  if (fontListCache) return fontListCache;

  // Disk cache
  if (fs.existsSync(CACHE_FILE)) {
    const stat = fs.statSync(CACHE_FILE);
    if (Date.now() - stat.mtimeMs < CACHE_TTL) {
      fontListCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      return fontListCache;
    }
  }

  // Fetch from API
  const res = await axios.get(GWFH_API, { timeout: 15000 });
  fontListCache = res.data;
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(fontListCache));
  return fontListCache;
}

async function findFontInGwfh(fontName) {
  const list = await getGwfhFontList();
  const normalized = fontName.toLowerCase().trim();
  return list.find(f => f.family.toLowerCase() === normalized) || null;
}

async function getFontDetails(fontId, subsets = []) {
  const params = subsets.length ? `?subsets=${subsets.join(',')}` : '';
  const res = await axios.get(`${GWFH_API}/${fontId}${params}`, { timeout: 10000 });
  return res.data;
}

async function downloadFont(fontId, variants, outputDir, subsets = []) {
  const details = await getFontDetails(fontId, subsets);
  const results = [];
  const subsetSuffix = subsets.length ? `-${subsets.join('_')}` : '';

  fs.mkdirSync(outputDir, { recursive: true });

  const selectedVariants = details.variants.filter(v =>
    variants.includes(v.id)
  );

  for (const variant of selectedVariants) {
    const formats = ['woff2', 'woff'];
    for (const fmt of formats) {
      const url = variant[fmt];
      if (!url) continue;
      const filename = `${fontId}-${variant.id}${subsetSuffix}.${fmt}`;
      const filepath = path.join(outputDir, filename);

      if (!fs.existsSync(filepath)) {
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 });
        fs.writeFileSync(filepath, res.data);
      }
      results.push({ variant: variant.id, format: fmt, file: filename, url });
    }
  }

  return { fontId, family: details.family, files: results, details };
}

function generateFontFaceCss(fontFamily, downloadedFiles, fontsRelativePath = './fonts') {
  // Group by variant
  const byVariant = {};
  downloadedFiles.forEach(f => {
    if (!byVariant[f.variant]) byVariant[f.variant] = [];
    byVariant[f.variant].push(f);
  });

  const blocks = Object.entries(byVariant).map(([variant, files]) => {
    const weight = variant === 'regular' ? '400'
      : variant === 'italic' ? '400'
      : variant.replace('italic', '').trim() || '400';
    const style = variant.includes('italic') ? 'italic' : 'normal';

    const srcs = files.map(f =>
      `url('${fontsRelativePath}/${f.file}') format('${f.format}')`
    ).join(',\n       ');

    return `@font-face {
  font-family: '${fontFamily}';
  font-style: ${style};
  font-weight: ${weight};
  font-display: swap;
  src: ${srcs};
}`;
  });

  return blocks.join('\n\n');
}

// Try to download font files directly from src URLs (for self-hosted / open fonts)
async function downloadFromSrcUrls(fontFamily, srcUrls, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const results = [];
  const fontId = fontFamily.toLowerCase().replace(/\s+/g, '-');

  for (const url of srcUrls) {
    // Only download woff/woff2/ttf/otf
    const ext = url.split('?')[0].split('.').pop().toLowerCase();
    if (!['woff', 'woff2', 'ttf', 'otf'].includes(ext)) continue;

    const filename = `${fontId}-direct.${ext}`;
    const filepath = path.join(outputDir, filename);

    try {
      if (!fs.existsSync(filepath)) {
        const res = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 15000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FontDetective/1.0)' },
        });
        fs.writeFileSync(filepath, res.data);
      }
      results.push({ variant: 'regular', format: ext, file: filename, url });
    } catch {
      // URL inaccessible — skip
    }
  }

  return results;
}

module.exports = { getGwfhFontList, findFontInGwfh, getFontDetails, downloadFont, generateFontFaceCss, downloadFromSrcUrls };
