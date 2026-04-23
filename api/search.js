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

  function getContext(text, term, contextLen = 120) {
    const lower = text.toLowerCase();
    const termLower = term.toLowerCase();
    const matches = [];
    let idx = 0;
    while ((idx = lower.indexOf(termLower, idx)) !== -1) {
      const start = Math.max(0, idx - contextLen);
      const end = Math.min(text.length, idx + term.length + contextLen);
      const snippet = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
      matches.push({ snippet, position: idx });
      idx += term.length;
      if (matches.length >= 5) break; // max 5 matches per page
    }
    return matches;
  }

  function extractLinks(html, base) {
    const links = new Set();
    for (const m of [...html.matchAll(/href=["']([^"']+)["']/gi)]) {
      try {
        const href = m[1].trim();
        if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
        const abs = new URL(href, base).href;
        if (abs.startsWith('http') && !shouldSkip(abs)) links.add(abs);
      } catch(e) {}
    }
    return [...links];
  }

  try {
    const baseHost = new URL(url).hostname;
    const visited = new Set();
    const toVisit = [url];
    const results = [];

    while (toVisit.length > 0) {
      const current = toVisit.shift();
      if (visited.has(current)) continue;
      visited.add(current);

      try {
        const response = await fetch(current, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LinkChecker/1.0)', 'Accept': 'text/html' },
          redirect: 'follow',
          signal: AbortSignal.timeout(10000)
        });
        const html = await response.text();

        // Find internal links to crawl
        const pageLinks = extractLinks(html, current);
        for (const l of pageLinks) {
          try {
            if (new URL(l).hostname === baseHost && !visited.has(l) && !toVisit.includes(l)) {
              toVisit.push(l);
            }
          } catch(e) {}
        }

        // Search in page text
        const text = extractText(html);
        const matches = getContext(text, query);
        if (matches.length > 0) {
          results.push({ page: current, matches });
        }

        // Also search in raw HTML for URLs/links
        const queryLower = query.toLowerCase();
        const htmlLower = html.toLowerCase();
        if (htmlLower.includes(queryLower) && matches.length === 0) {
          // Found in HTML but not visible text — could be in a link or attribute
          const linkMatches = getContext(html.replace(/<[^>]+>/g, ' '), query);
          if (linkMatches.length > 0) {
            results.push({ page: current, matches: linkMatches, inHtml: true });
          }
        }
      } catch(e) {}
    }

    res.status(200).json({ results, pagesSearched: visited.size });
  } catch(e) {
    res.status(500).json({ error: e.message, results: [] });
  }
}
