export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, query } = req.body;
  if (!url || !query) return res.status(400).json({ error: 'URL and query required' });

  const SKIP = [/\/feed\//,/\/feed$/,/\?/,/\/wp-json\//,/\/wp-admin\//,/\/wp-content\//,/\/xmlrpc\.php/,/\/wp-login\.php/];
  function shouldSkip(u) { return SKIP.some(p => p.test(u)); }

  function extractText(html) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getMatches(text, term, contextLen = 120) {
    const lower = text.toLowerCase();
    const termLower = term.toLowerCase();
    const matches = [];
    let idx = 0;
    while ((idx = lower.indexOf(termLower, idx)) !== -1) {
      const start = Math.max(0, idx - contextLen);
      const end = Math.min(text.length, idx + term.length + contextLen);
      const snippet = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
      matches.push(snippet);
      idx += term.length;
      if (matches.length >= 3) break;
    }
    return matches;
  }

  function extractLinks(html, base, baseHost) {
    const links = new Set();
    for (const m of [...html.matchAll(/href=["']([^"']+)["']/gi)]) {
      try {
        const href = m[1].trim();
        if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
        const abs = new URL(href, base).href;
        if (abs.startsWith('http') && !shouldSkip(abs) && new URL(abs).hostname === baseHost) links.add(abs);
      } catch(e) {}
    }
    return [...links];
  }

  try {
    const baseHost = new URL(url).hostname;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LinkChecker/1.0)', 'Accept': 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000)
    });
    const html = await response.text();
    const text = extractText(html);
    const matches = getMatches(text, query);
    const internalLinks = extractLinks(html, url, baseHost);

    res.status(200).json({ matches, internalLinks });
  } catch(e) {
    res.status(500).json({ error: e.message, matches: [], internalLinks: [] });
  }
}

