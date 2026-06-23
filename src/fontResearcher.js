require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const Groq = require('groq-sdk');

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

// In-memory cache to avoid re-querying same font
const cache = new Map();

async function researchFont(fontName) {
  const key = fontName.toLowerCase().trim();
  if (cache.has(key)) return cache.get(key);

  const prompt = `Analyze the font named "${fontName}".

Answer in JSON only, no explanation:
{
  "iconFont": true if this is an icon/symbol font (like Font Awesome, Material Icons, etc.), false if it's a text/display font,
  "free": true if free/open-source, false if paid/commercial, null if unknown,
  "license": "short license name, e.g. OFL, MIT, Apache 2.0, Commercial, Unknown",
  "source": "where to get it, e.g. Google Fonts, Font Squirrel, GitHub, Adobe Fonts, Unknown",
  "url": "direct URL to the font's download or info page, or null if unknown"
}`;

  try {
    const completion = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 150,
    });

    const text = completion.choices[0].message.content.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const result = JSON.parse(jsonMatch[0]);
    cache.set(key, result);
    return result;
  } catch {
    const fallback = { free: null, license: 'Unknown', source: 'Unknown' };
    cache.set(key, fallback);
    return fallback;
  }
}

module.exports = { researchFont };
