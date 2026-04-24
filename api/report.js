// api/report.js — GET returns last report, POST saves new report
export default async function handler(req, res) {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO = process.env.GITHUB_REPO; // e.g. "ni-1519/linkchecker"
  const FILE_PATH = 'last-report.json';
  const API_BASE = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`;

  const headers = {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'LinkChecker/1.0'
  };

  if (req.method === 'GET') {
    try {
      const r = await fetch(API_BASE, { headers });
      if (r.status === 404) return res.status(200).json({ report: null });
      const data = await r.json();
      const content = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
      return res.status(200).json({ report: content });
    } catch(e) {
      return res.status(200).json({ report: null });
    }
  }

  if (req.method === 'POST') {
    try {
      const report = req.body;

      // Get current file SHA (needed for update)
      let sha = null;
      try {
        const existing = await fetch(API_BASE, { headers });
        if (existing.ok) {
          const data = await existing.json();
          sha = data.sha;
        }
      } catch(e) {}

      const content = Buffer.from(JSON.stringify(report, null, 2)).toString('base64');
      const body = { message: 'Update last scan report', content, ...(sha ? { sha } : {}) };

      const r = await fetch(API_BASE, { method: 'PUT', headers, body: JSON.stringify(body) });
      if (!r.ok) {
        const err = await r.json();
        return res.status(500).json({ error: err.message });
      }
      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
