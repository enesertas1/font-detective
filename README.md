# Font Detective

A web tool that detects all fonts used on any website, classifies them as free, paid, system, or unknown, and downloads free fonts locally with proper `@font-face` CSS — ready to drop into your project.


## Features

- **Font detection** — Scans `<link>` tags, inline `<style>` blocks, external CSS files, and `@font-face` declarations
- **Full site crawl** — Optionally crawl an entire website (configurable page limit) instead of just the homepage
- **Classification** — Fonts are classified as:
  - ✅ **Free** — Found on Google Fonts (via GWFH) or identified as open-source by AI
  - 💳 **Paid** — Known commercial CDNs (Adobe Fonts, H&Co, Fonts.com) or identified as commercial by AI
  - 🖥 **System Font** — Built-in OS fonts (Arial, Helvetica, Segoe UI, etc.)
  - ❓ **Unknown** — Could not be determined
- **AI-powered research** — Uses Groq AI (llama-3.3-70b) to identify license and source for fonts not found in Google Fonts
- **Download free fonts** — Downloads font files from [Google Fonts Helper](https://gwfh.mranftl.com) with variant and subset selection
- **Subset support** — Select character subsets (latin, latin-ext, cyrillic, etc.) — defaults to latin + latin-ext
- **Apply to project** — Copies downloaded fonts into your project folder and automatically updates CSS/HTML files (removes CDN links, adds `@font-face` declarations)
- **Scanned pages list** — See exactly which pages were crawled

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) v18 or higher
- A free [Groq API key](https://console.groq.com) (for AI-powered font research)

### Installation

```bash
git clone https://github.com/yourusername/font-detective.git
cd font-detective
npm install
```

### Configuration

Copy the example environment file and add your Groq API key:

```bash
cp .env.example .env
```

Then open `.env` and replace `your_groq_api_key_here` with your actual key:

```
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxx
```

You can get a free API key at [console.groq.com](https://console.groq.com) → API Keys → Create API Key.

> The app works without a Groq key, but fonts not found in Google Fonts will show as "Unknown" instead of being researched.

### Run

```bash
npm start
```

Then open [http://localhost:3333](http://localhost:3333) in your browser.

For development with auto-restart on file changes:

```bash
npm run dev
```

## How It Works

1. **Scan** — Enter a URL and choose between scanning just the homepage or crawling the full site
2. **Review** — Browse detected fonts with their classification, license info, and AI research notes
3. **Select** — Check the fonts you want to download; choose variants (regular, bold, italic…) and subsets
4. **Download** — Click "Download & Apply to Project" to:
   - Download font files locally
   - Generate `@font-face` CSS
   - Optionally apply directly to your project (removes CDN links, injects local font declarations)

## Font Classification Logic

| Source | Classification |
|--------|---------------|
| `fonts.googleapis.com` / `fonts.bunny.net` | Free |
| `use.typekit.net` / `cloud.typography.com` / `fast.fonts.net` | Paid |
| Found in [GWFH](https://gwfh.mranftl.com) database | Free + Downloadable |
| Known OS font name | System Font |
| Known icon font pattern (Font Awesome, Material Icons, etc.) | Filtered out |
| Identified by Groq AI | Free or Paid (with license info) |
| None of the above | Unknown |

## Tech Stack

- **Backend** — Node.js, Express
- **Scraping** — Axios, Cheerio
- **AI Research** — Groq SDK (llama-3.3-70b)
- **Font source** — [Google Fonts Helper (GWFH)](https://gwfh.mranftl.com)
- **Frontend** — Vanilla HTML/CSS/JS (no framework)

## License

MIT
