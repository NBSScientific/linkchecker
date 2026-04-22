export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, fullSite } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    if (fullSite) {
      const baseHost = new URL(url).hostname;
      const visited = new Set();
      const toVisit = [url];
      const allLinks = new Map(); // url -> source page (Map to avoid duplicates)

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
          const matches = [...html.matchAll(/href=["']([^"']+)["']/gi)];

          for (const m of matches) {
            try {
              const href = m[1].trim();
              if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
              const abs = new URL(href, current).href;
              if (!abs.startsWith('http')) continue;

              // Only store first occurrence of each link
              if (!allLinks.has(abs)) allLinks.set(abs, current);

              // If internal and not yet visited or queued, add to crawl queue
              const linkHost = new URL(abs).hostname;
              if (linkHost === baseHost && !visited.has(abs) && !toVisit.includes(abs)) {
                toVisit.push(abs);
              }
            } catch(e) {}
          }
        } catch(e) {}
      }

      const links = [...allLinks.entries()].map(([url, source]) => ({ url, source }));
      return res.status(200).json({ links, pagesVisited: visited.size });
    }

    // Single page mode
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
        if (abs.startsWith('http')) links.add(abs);
      } catch(e) {}
    }

    res.status(200).json({ links: [...links].map(l => ({ url: l, source: url })) });
  } catch(e) {
    res.status(500).json({ error: e.message, links: [] });
  }
}

