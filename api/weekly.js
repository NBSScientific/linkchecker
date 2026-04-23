export const config = { maxDuration: 300 };

const SKIP = [/\/feed\//,/\/feed$/,/\?/,/\/wp-json\//,/\/wp-admin\//,/\/wp-content\//,/\/xmlrpc\.php/,/\/wp-login\.php/];
function shouldSkip(url) { return SKIP.some(p => p.test(url)); }

async function scrapePage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LinkChecker/1.0)', 'Accept': 'text/html' },
      redirect: 'follow', signal: AbortSignal.timeout(10000)
    });
    const html = await res.text();
    const base = new URL(url);
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
  } catch(e) { return []; }
}

async function checkLink(url) {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LinkChecker/1.0)' },
      redirect: 'manual', signal: AbortSignal.timeout(8000)
    });
    const code = String(res.status);
    if (code.startsWith('2')) return { type: 'ok', status: code };
    if (code.startsWith('3')) return { type: 'redirect', status: code, redirectsTo: res.headers.get('location') };
    return { type: 'broken', status: code };
  } catch(e) {
    return { type: 'broken', status: e.name === 'TimeoutError' ? 'TIMEOUT' : 'ERR' };
  }
}

async function scanSite(siteUrl) {
  const baseHost = new URL(siteUrl).hostname;
  const visited = new Set();
  const toVisit = [siteUrl];
  const allLinks = new Map();

  while (toVisit.length > 0) {
    const current = toVisit.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    const pageLinks = await scrapePage(current);
    for (const l of pageLinks) {
      if (!allLinks.has(l)) allLinks.set(l, current);
      try {
        if (new URL(l).hostname === baseHost && !visited.has(l) && !toVisit.includes(l)) toVisit.push(l);
      } catch(e) {}
    }
  }

  const results = [];
  for (const [url, source] of allLinks.entries()) {
    const result = await checkLink(url);
    results.push({ url, source, ...result });
  }

  return { pagesVisited: visited.size, results };
}

function buildEmailHtml(siteResults) {
  const date = new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });

  const siteSections = siteResults.map(({ site, pagesVisited, results }) => {
    const broken = results.filter(r => r.type === 'broken');
    const redirects = results.filter(r => r.type === 'redirect');
    const insecure = results.filter(r => r.url.startsWith('http://'));
    const statusColor = broken.length > 0 ? '#c0392b' : '#1a7a4a';
    const statusText = broken.length > 0 ? `${broken.length} broken link${broken.length !== 1 ? 's' : ''} found` : 'All links OK';

    const brokenRows = broken.map(r => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#1a1a1a;word-break:break-all">${r.url}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#c0392b;white-space:nowrap">${r.status}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#888;word-break:break-all">${r.source}</td>
      </tr>`).join('');

    const redirectRows = redirects.slice(0, 10).map(r => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#1a1a1a;word-break:break-all">${r.url}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#1a5fa8;white-space:nowrap">${r.status}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#888;word-break:break-all">${r.redirectsTo || ''}</td>
      </tr>`).join('');

    return `
    <div style="background:#fff;border-radius:10px;border:1px solid #e5e5e5;margin-bottom:24px;overflow:hidden">
      <div style="padding:16px 20px;border-bottom:1px solid #e5e5e5;display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:16px;font-weight:600;color:#1a1a1a">${site}</div>
          <div style="font-size:13px;color:#888;margin-top:2px">${pagesVisited} pages crawled · ${results.length} links checked</div>
        </div>
        <div style="font-size:13px;font-weight:600;color:${statusColor}">${statusText}</div>
      </div>
      <div style="padding:12px 20px;background:#f9f9f7;display:flex;gap:24px">
        <div><span style="font-size:22px;font-weight:700;color:#1a1a1a">${results.length}</span><div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em">Total</div></div>
        <div><span style="font-size:22px;font-weight:700;color:#1a7a4a">${results.filter(r=>r.type==='ok').length}</span><div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em">Working</div></div>
        <div><span style="font-size:22px;font-weight:700;color:#c0392b">${broken.length}</span><div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em">Broken</div></div>
        <div><span style="font-size:22px;font-weight:700;color:#1a5fa8">${redirects.length}</span><div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em">Redirects</div></div>
        <div><span style="font-size:22px;font-weight:700;color:#b45309">${insecure.length}</span><div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em">HTTP</div></div>
      </div>
      ${broken.length > 0 ? `
      <div style="padding:12px 20px 4px">
        <div style="font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Broken links</div>
        <table style="width:100%;border-collapse:collapse">
          <tr style="background:#f9f9f7">
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">URL</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">Status</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">Found on</th>
          </tr>
          ${brokenRows}
        </table>
      </div>` : ''}
      ${redirects.length > 0 ? `
      <div style="padding:12px 20px 4px">
        <div style="font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Redirects${redirects.length > 10 ? ` (showing 10 of ${redirects.length})` : ''}</div>
        <table style="width:100%;border-collapse:collapse">
          <tr style="background:#f9f9f7">
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">URL</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">Status</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">Redirects to</th>
          </tr>
          ${redirectRows}
        </table>
      </div>` : ''}
    </div>`;
  }).join('');

  const totalBroken = siteResults.reduce((s, r) => s + r.results.filter(l => l.type === 'broken').length, 0);

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:700px;margin:0 auto;padding:32px 16px">
    <div style="margin-bottom:24px">
      <h1 style="font-size:24px;font-weight:700;color:#1a1a1a;margin:0 0 4px">Weekly Link Report</h1>
      <p style="font-size:14px;color:#888;margin:0">${date} · ${siteResults.length} websites scanned · ${totalBroken} broken links found</p>
    </div>
    ${siteSections}
    <div style="text-align:center;font-size:12px;color:#aaa;margin-top:24px">
      Sent by your Link Checker tool · <a href="${process.env.TOOL_URL || 'https://linkchecker-one.vercel.app'}" style="color:#aaa">Open tool</a>
    </div>
  </div>
</body></html>`;
}

export default async function handler(req, res) {
  // Allow manual trigger via POST with secret, or automatic cron
  const authHeader = req.headers.authorization;
  if (req.method === 'POST' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sitesEnv = process.env.SITES || '';
  const sites = sitesEnv.split(',').map(s => s.trim()).filter(Boolean);

  if (!sites.length) return res.status(400).json({ error: 'No sites configured in SITES env variable' });

  const siteResults = [];
  for (const site of sites) {
    console.log('Scanning:', site);
    const { pagesVisited, results } = await scanSite(site);
    siteResults.push({ site, pagesVisited, results });
  }

  const html = buildEmailHtml(siteResults);
  const totalBroken = siteResults.reduce((s, r) => s + r.results.filter(l => l.type === 'broken').length, 0);
  const subject = `Weekly Link Report — ${totalBroken} broken link${totalBroken !== 1 ? 's' : ''} found`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Link Checker <onboarding@resend.dev>',
      to: ['ni@nbsscientific.com', 'dn@nbsscientific.com'],
      subject,
      html
    })
  });

  res.status(200).json({ ok: true, sites: sites.length, totalBroken });
}
