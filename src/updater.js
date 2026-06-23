const fs = require('fs');
const path = require('path');

const CSS_EXTENSIONS = ['.css', '.scss', '.sass', '.less'];
const HTML_EXTENSIONS = ['.html', '.htm', '.php', '.twig', '.njk'];

function findFiles(dir, extensions, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules, .git, vendor, dist, build
      if (['node_modules', '.git', 'vendor', 'dist', 'build', '.next', '.nuxt'].includes(entry.name)) continue;
      findFiles(full, extensions, results);
    } else if (extensions.includes(path.extname(entry.name).toLowerCase())) {
      results.push(full);
    }
  }
  return results;
}

function removeGoogleFontsFromHtml(content) {
  // Remove <link> tags pointing to Google Fonts
  return content
    .replace(/<link[^>]+href=["'][^"']*fonts\.googleapis\.com[^"']*["'][^>]*\/?>/gi, '')
    .replace(/<link[^>]+href=["'][^"']*fonts\.bunny\.net[^"']*["'][^>]*\/?>/gi, '')
    // Remove preconnect to Google Fonts
    .replace(/<link[^>]+rel=["']preconnect["'][^>]+href=["'][^"']*fonts\.(googleapis|gstatic)\.com[^"']*["'][^>]*\/?>/gi, '')
    // Clean up empty lines left behind
    .replace(/\n\s*\n\s*\n/g, '\n\n');
}

function removeGoogleFontsFromCss(content) {
  // Remove @import lines pointing to Google Fonts
  return content
    .replace(/@import\s+url\(['"]?https?:\/\/fonts\.googleapis\.com[^)'"]+['"]?\)\s*;?\s*/gi, '')
    .replace(/@import\s+['"]https?:\/\/fonts\.googleapis\.com[^'"]+['"]\s*;?\s*/gi, '')
    .replace(/@import\s+url\(['"]?https?:\/\/fonts\.bunny\.net[^)'"]+['"]?\)\s*;?\s*/gi, '')
    .replace(/@import\s+['"]https?:\/\/fonts\.bunny\.net[^'"]+['"]\s*;?\s*/gi, '')
    .replace(/\n\s*\n\s*\n/g, '\n\n');
}

function injectFontFaceCss(content, fontFaceCss, fontsRelativePath) {
  // Try to inject after last existing @font-face or at the top of file
  const fontFaceBlock = `/* Font Detective - local fonts */\n${fontFaceCss}\n`;

  if (content.includes('@font-face')) {
    // Insert after the last @font-face block's closing brace
    const lastIdx = content.lastIndexOf('@font-face');
    const closingBrace = content.indexOf('}', lastIdx);
    if (closingBrace !== -1) {
      return content.slice(0, closingBrace + 1) + '\n\n' + fontFaceCss + content.slice(closingBrace + 1);
    }
  }

  // Otherwise inject at the very top
  return fontFaceCss + '\n\n' + content;
}

function updateProject(projectDir, downloadedFonts, fontFaceCss, fontsSubdir = 'fonts') {
  if (!fs.existsSync(projectDir)) {
    throw new Error(`Klasör bulunamadı: ${projectDir}`);
  }

  const targetFontsDir = path.join(projectDir, fontsSubdir);
  fs.mkdirSync(targetFontsDir, { recursive: true });

  const report = {
    copiedFiles: [],
    updatedFiles: [],
    errors: [],
  };

  // 1. Copy font files into the project
  for (const font of downloadedFonts) {
    const srcDir = font.srcDir;
    for (const file of font.files) {
      const src = path.join(srcDir, file.file);
      const destDir = path.join(targetFontsDir, font.gwfhId);
      fs.mkdirSync(destDir, { recursive: true });
      const dest = path.join(destDir, file.file);
      try {
        fs.copyFileSync(src, dest);
        report.copiedFiles.push(path.relative(projectDir, dest));
      } catch (e) {
        report.errors.push(`Kopyalanamadı: ${file.file} — ${e.message}`);
      }
    }
  }

  // 2. Update CSS files
  const cssFiles = findFiles(projectDir, CSS_EXTENSIONS);
  for (const file of cssFiles) {
    try {
      let content = fs.readFileSync(file, 'utf8');
      const original = content;

      content = removeGoogleFontsFromCss(content);

      // Only inject @font-face into the first/main CSS file (or all, depending on preference)
      // We inject into all CSS files that previously had a Google Fonts import
      if (original !== content) {
        const relPath = path.relative(path.dirname(file), targetFontsDir).replace(/\\/g, '/');
        const adjustedCss = fontFaceCss.replace(/\.\/fonts\//g, relPath + '/');
        content = injectFontFaceCss(content, adjustedCss);
        fs.writeFileSync(file, content, 'utf8');
        report.updatedFiles.push(path.relative(projectDir, file));
      }
    } catch (e) {
      report.errors.push(`CSS güncellenemedi: ${file} — ${e.message}`);
    }
  }

  // 3. Update HTML files — remove Google Fonts <link> tags
  const htmlFiles = findFiles(projectDir, HTML_EXTENSIONS);
  for (const file of htmlFiles) {
    try {
      let content = fs.readFileSync(file, 'utf8');
      const updated = removeGoogleFontsFromHtml(content);
      if (updated !== content) {
        fs.writeFileSync(file, updated, 'utf8');
        report.updatedFiles.push(path.relative(projectDir, file));
      }
    } catch (e) {
      report.errors.push(`HTML güncellenemedi: ${file} — ${e.message}`);
    }
  }

  return report;
}

module.exports = { updateProject };
