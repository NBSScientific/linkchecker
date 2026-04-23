export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  // Patterns to skip — WordPress noise and non-page URLs
  const skipPatterns = [
    /\/feed\//,
    /\/feed$/,
    /\?/,              // skip ALL urls with query parameters (?p=, ?page_id=, ?s=, etc.)
    /\/wp-json\//,
    /\/wp-admin\//,
    /\/wp-content\//,
    /\/xmlrpc\.php/,
    /\/wp-login\.php/,
  ];

  function shouldSkip(url) {
    return skipPatterns.some(p => p.test(url));
  }

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LinkChecker/1.0)', 'Accept': 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000)
    });

    const html = await response.text();
    const base = new URL(url);
    const links = new Set();

    const matches = [...html.matchAll(/href=["']([^"']+)["']/gi)];
    for (const m of matches) {
      try {
        const href = m[1].trim();
        if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
        const abs = new URL(href, base).href;
        if (!abs.startsWith('http')) continue;
        if (shouldSkip(abs)) continue;
        links.add(abs);
      } catch(e) {}
    }

    res.status(200).json({ links: [...links] });
  } catch(e) {
    res.status(500).json({ error: e.message, links: [] });
  }
}
