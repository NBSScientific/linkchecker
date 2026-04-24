// api/report.js
const FILE_PATH = 'last-report.json';

function getHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'LinkChecker/1.0'
  };
}

export default async function handler(req, res) {
  const TOKEN = process.env.GITHUB_TOKEN;
  const REPO = (process.env.GITHUB_REPO || '').trim();

  if (!TOKEN || !REPO) {
    if (req.method === 'GET') return res.status(200).json({ report: null, error: 'Missing env vars' });
    return res.status(500).json({ error: 'Missing GITHUB_TOKEN or GITHUB_REPO env vars' });
  }

  const API_URL = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;
  const headers = getHeaders(TOKEN);

  if (req.method === 'GET') {
    try {
      const r = await fetch(API_URL, { headers });
      if (r.status === 404) return res.status(200).json({ report: null });
      if (!r.ok) return res.status(200).json({ report: null });
      const data = await r.json();
      const decoded = JSON.parse(Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8'));
      return res.status(200).json({ report: decoded });
    } catch(e) {
      return res.status(200).json({ report: null, error: e.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const report = req.body;
      const encoded = Buffer.from(JSON.stringify(report, null, 2)).toString('base64');

      // Get current SHA if file exists (required for update)
      let sha = undefined;
      try {
        const existing = await fetch(API_URL, { headers });
        if (existing.ok) {
          const data = await existing.json();
          sha = data.sha;
        }
      } catch(e) {}

      const body = {
        message: `Update scan report ${new Date().toISOString()}`,
        content: encoded,
        ...(sha ? { sha } : {})
      };

      const r = await fetch(API_URL, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body)
      });

      if (!r.ok) {
        const err = await r.json();
        console.error('GitHub API error:', err);
        return res.status(500).json({ error: err.message || 'GitHub API error', details: err });
      }

      return res.status(200).json({ ok: true });
    } catch(e) {
      console.error('Report save error:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
