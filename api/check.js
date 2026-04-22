export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    // First: check without following redirects to detect them
    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LinkChecker/1.0)'
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(8000)
    });

    const code = String(response.status);

    // Detect HTTP version from headers
    // Node 18+ exposes this via non-standard properties on the response
    let httpVersion = 'HTTP/1.1';
    try {
      // Check for HTTP/2 or HTTP/3 signals in headers
      const via = response.headers.get('via') || '';
      const altSvc = response.headers.get('alt-svc') || '';
      if (response.url && response.url.startsWith('https://')) {
        // Most modern HTTPS sites use HTTP/2; check alt-svc for h3
        if (altSvc.includes('h3')) httpVersion = 'HTTP/3';
        else httpVersion = 'HTTP/2';
      }
      // If via header mentions 1.1 explicitly, it's HTTP/1.1
      if (via.includes('1.1') || via.includes('1.0')) httpVersion = 'HTTP/1.1';
    } catch(e) {}

    if (code.startsWith('3')) {
      const redirectsTo = response.headers.get('location') || null;
      let finalDest = redirectsTo;
      if (redirectsTo && !redirectsTo.startsWith('http')) {
        try { finalDest = new URL(redirectsTo, url).href; } catch(e) {}
      }
      return res.status(200).json({ status: code, type: 'redirect', redirectsTo: finalDest, httpVersion });
    }

    let type = 'broken';
    if (code.startsWith('2')) type = 'ok';

    res.status(200).json({ status: code, type, redirectsTo: null, httpVersion });
  } catch(e) {
    const isTimeout = e.name === 'TimeoutError' || e.message.includes('timeout');
    res.status(200).json({ status: isTimeout ? 'TIMEOUT' : 'ERR', type: 'broken', redirectsTo: null, httpVersion: 'unknown' });
  }
}
