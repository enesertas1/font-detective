const express = require('express');
const path = require('path');
const fs = require('fs');
const { scanUrl, scanSite } = require('./scanner');
const { findFontInGwfh, getFontDetails, downloadFont, generateFontFaceCss, getGwfhFontList, downloadFromSrcUrls } = require('./gwfh');
const { updateProject } = require('./updater');
const { researchFont } = require('./fontResearcher');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Serve downloaded fonts
const FONTS_DIR = path.join(__dirname, '..', 'downloads');
app.use('/downloads', express.static(FONTS_DIR));

async function enrichFonts(scanResult) {
  const enriched = (await Promise.all(
    scanResult.allFonts.map(async font => {
      if (font.type === 'paid' || font.type === 'system') return font;

      // Layer 1: GWFH (Google Fonts)
      const gwfhFont = await findFontInGwfh(font.name);
      if (gwfhFont) {
        return { ...font, gwfhId: gwfhFont.id, gwfhFamily: gwfhFont.family, downloadable: true, type: 'free' };
      }

      // Layer 2: Ask Groq AI
      if (process.env.GROQ_API_KEY) {
        const research = await researchFont(font.name);
        if (research.iconFont === true) return null; // ikon fontu, listeden çıkar
        if (research.free === true) {
          return { ...font, downloadable: false, type: 'free', license: research.license, researchSource: research.source, researchUrl: research.url || null };
        } else if (research.free === false) {
          return { ...font, downloadable: false, type: 'paid', license: research.license, researchSource: research.source, researchUrl: research.url || null };
        }
      }

      return { ...font, downloadable: false, type: font.type === 'free' ? 'unknown' : font.type };
    })
  )).filter(Boolean);
  return { ...scanResult, allFonts: enriched };
}

// POST /api/scan — scan a URL for fonts
// mode: 'page' (default) = sadece bu sayfa, 'site' = tüm site (max 50 sayfa)
app.post('/api/scan', async (req, res) => {
  const { url, mode = 'page', maxPages = 50 } = req.body;
  if (!url) return res.status(400).json({ error: 'URL gerekli' });

  try {
    const scanResult = mode === 'site' ? await scanSite(url, { maxPages }) : await scanUrl(url);
    const result = await enrichFonts(scanResult);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/font/:id — get font details (variants, subsets)
app.get('/api/font/:id', async (req, res) => {
  try {
    const details = await getFontDetails(req.params.id);
    res.json(details);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Layered font download:
// 1. GWFH (Google Fonts) — if gwfhId exists
// 2. Direct src URL — if srcUrls exist
// 3. Not found
async function downloadFontLayered(font, fontsPath) {
  const fontKey = font.gwfhId || font.family.toLowerCase().replace(/\s+/g, '-');
  const outputDir = path.join(FONTS_DIR, fontKey);

  // Layer 1
  if (font.gwfhId) {
    const downloaded = await downloadFont(font.gwfhId, font.variants || ['regular'], outputDir, font.subsets || ['latin', 'latin-ext']);
    const css = generateFontFaceCss(font.family, downloaded.files, `${fontsPath}/${fontKey}`);
    return { family: font.family, fontKey, css, files: downloaded.files, source: 'gwfh' };
  }

  // Layer 2
  if (font.srcUrls && font.srcUrls.length > 0) {
    const files = await downloadFromSrcUrls(font.family, font.srcUrls, outputDir);
    if (files.length > 0) {
      const css = generateFontFaceCss(font.family, files, `${fontsPath}/${fontKey}`);
      return { family: font.family, fontKey, css, files, source: 'direct' };
    }
  }

  return null;
}

// POST /api/download — download selected fonts and return CSS
app.post('/api/download', async (req, res) => {
  const { fonts, fontsPath = './fonts' } = req.body;
  if (!fonts || !fonts.length) return res.status(400).json({ error: 'Font listesi gerekli' });

  try {
    const results = [];
    const failed = [];

    for (const font of fonts) {
      const result = await downloadFontLayered(font, fontsPath);
      if (result) results.push(result);
      else failed.push(font.family);
    }

    const combinedCss = results.map(r => r.css).join('\n\n');
    res.json({ results, combinedCss, failed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/apply — download fonts + copy to project + update HTML/CSS
app.post('/api/apply', async (req, res) => {
  const { fonts, projectDir, fontsSubdir = 'fonts' } = req.body;
  if (!fonts || !fonts.length) return res.status(400).json({ error: 'Font listesi gerekli' });
  if (!projectDir) return res.status(400).json({ error: 'Proje klasörü gerekli' });

  try {
    const results = [];
    const fontsPath = `./${fontsSubdir}`;

    const failed = [];
    for (const font of fonts) {
      const result = await downloadFontLayered(font, fontsPath);
      if (result) {
        results.push({
          ...result,
          gwfhId: result.fontKey,
          srcDir: path.join(FONTS_DIR, result.fontKey),
        });
      } else {
        failed.push(font.family);
      }
    }

    const combinedCss = results.map(r => r.css).join('\n\n');
    const report = updateProject(projectDir, results, combinedCss, fontsSubdir);

    res.json({ combinedCss, report, failed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/gwfh-list — full font list from GWFH (for autocomplete)
app.get('/api/gwfh-list', async (req, res) => {
  try {
    const list = await getGwfhFontList();
    res.json(list.map(f => ({ id: f.id, family: f.family, category: f.category })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`Font Detective running → http://localhost:${PORT}`);
});
