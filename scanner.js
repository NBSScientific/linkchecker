// scanner.js — runs in GitHub Actions, scans all sites and sends email report

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SITES = (process.env.SITES || '').split(',').map(s => s.trim()).filter(Boolean);
const TO_EMAILS = ['ni@nbsscientific.com', 'dn@nbsscientific.com'];

const SKIP = [
  /\/feed\//,
  /\/feed$/,
  /\?/,
  /\/wp-json\//,
  /\/wp-admin\//,
  /\/wp-content\//,
  /\/xmlrpc\.php/,
  /\/wp-login\.php/,
];

function shouldSkip(url) {
  return SKIP.some(p => p.test(url));
}

async function scrapePage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LinkChecker/1.0)', 'Accept': 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000)
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
  } catch(e) {
    console.log('  Could not fetch:', url, e.message);
    return [];
  }
}

async function checkLink(url) {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LinkChecker/1.0)' },
      redirect: 'manual',
      signal: AbortSignal.timeout(8000)
    });
    const code = String(res.status);
    if (code.startsWith('2')) return { type: 'ok', status: code };
    if (code.startsWith('3')) return { type: 'redirect', status: code, redirectsTo: res.headers.get('location') || '' };
    return { type: 'broken', status: code };
  } catch(e) {
    return { type: 'broken', status: e.name === 'TimeoutError' ? 'TIMEOUT' : 'ERR' };
  }
}

async function scanSite(siteUrl) {
  console.log('\nScanning:', siteUrl);
  const baseHost = new URL(siteUrl).hostname;
  const visited = new Set();
  const toVisit = [siteUrl];
  const allLinks = new Map();

  while (toVisit.length > 0) {
    const current = toVisit.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    console.log('  Crawling page', visited.size, ':', current);
    const pageLinks = await scrapePage(current);
    for (const l of pageLinks) {
      if (!allLinks.has(l)) allLinks.set(l, current);
      try {
        if (new URL(l).hostname === baseHost && !visited.has(l) && !toVisit.includes(l)) {
          toVisit.push(l);
        }
      } catch(e) {}
    }
  }

  console.log('  Crawled', visited.size, 'pages,', allLinks.size, 'unique links found');
  console.log('  Checking links...');

  const results = [];
  let i = 0;
  for (const [url, source] of allLinks.entries()) {
    i++;
    if (i % 20 === 0) console.log('  Checked', i, 'of', allLinks.size, '...');
    const result = await checkLink(url);
    results.push({ url, source, ...result });
  }

  const broken = results.filter(r => r.type === 'broken').length;
  console.log('  Done!', broken, 'broken links found.');
  return { pagesVisited: visited.size, results };
}

function buildEmailHtml(siteResults) {
  const date = new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
  const totalBroken = siteResults.reduce((s, r) => s + r.results.filter(l => l.type === 'broken').length, 0);

  const siteSections = siteResults.map(({ site, pagesVisited, results }) => {
    const broken = results.filter(r => r.type === 'broken');
    const redirects = results.filter(r => r.type === 'redirect');
    const insecure = results.filter(r => r.url.startsWith('http://'));
    const statusColor = broken.length > 0 ? '#c0392b' : '#1a7a4a';
    const statusText = broken.length > 0 ? `${broken.length} broken link${broken.length !== 1 ? 's' : ''} gevonden` : 'Alle links OK ✓';

    const brokenRows = broken.map(r => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;word-break:break-all">${r.url}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#c0392b;white-space:nowrap">${r.status}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#888;word-break:break-all">${r.source}</td>
      </tr>`).join('');

    const redirectRows = redirects.slice(0, 10).map(r => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;word-break:break-all">${r.url}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#1a5fa8;white-space:nowrap">${r.status}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#888;word-break:break-all">${r.redirectsTo}</td>
      </tr>`).join('');

    return `
    <div style="background:#fff;border-radius:10px;border:1px solid #e5e5e5;margin-bottom:24px;overflow:hidden">
      <div style="padding:16px 20px;border-bottom:1px solid #e5e5e5;background:#fafafa">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:16px;font-weight:600;color:#1a1a1a">${site}</div>
            <div style="font-size:13px;color:#888;margin-top:2px">${pagesVisited} pagina's gecrawld · ${results.length} links gecheckt</div>
          </div>
          <div style="font-size:13px;font-weight:600;color:${statusColor}">${statusText}</div>
        </div>
      </div>
      <div style="padding:12px 20px;background:#f9f9f7;display:flex;gap:24px;flex-wrap:wrap">
        <div><div style="font-size:22px;font-weight:700;color:#1a1a1a">${results.length}</div><div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em">Totaal</div></div>
        <div><div style="font-size:22px;font-weight:700;color:#1a7a4a">${results.filter(r=>r.type==='ok').length}</div><div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em">Werkend</div></div>
        <div><div style="font-size:22px;font-weight:700;color:#c0392b">${broken.length}</div><div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em">Broken</div></div>
        <div><div style="font-size:22px;font-weight:700;color:#1a5fa8">${redirects.length}</div><div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em">Redirects</div></div>
        <div><div style="font-size:22px;font-weight:700;color:#b45309">${insecure.length}</div><div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em">HTTP</div></div>
      </div>
      ${broken.length > 0 ? `
      <div style="padding:16px 20px 8px">
        <div style="font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Broken links</div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:8px;overflow:hidden">
          <tr style="background:#f9f9f7">
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">URL</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">Status</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">Gevonden op</th>
          </tr>
          ${brokenRows}
        </table>
      </div>` : ''}
      ${redirects.length > 0 ? `
      <div style="padding:16px 20px 8px">
        <div style="font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Redirects${redirects.length > 10 ? ` (top 10 van ${redirects.length})` : ''}</div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:8px;overflow:hidden">
          <tr style="background:#f9f9f7">
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">URL</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">Status</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500">Redirect naar</th>
          </tr>
          ${redirectRows}
        </table>
      </div>` : ''}
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:720px;margin:0 auto;padding:32px 16px">
    <div style="margin-bottom:24px">
      <h1 style="font-size:24px;font-weight:700;color:#1a1a1a;margin:0 0 4px">Wekelijks Link Rapport</h1>
      <p style="font-size:14px;color:#888;margin:0">${date} · ${siteResults.length} websites gescand · ${totalBroken} broken links gevonden</p>
    </div>
    ${siteSections}
    <div style="text-align:center;font-size:12px;color:#aaa;margin-top:24px;padding-top:16px;border-top:1px solid #e5e5e5">
      Automatisch verzonden door uw Link Checker tool
    </div>
  </div>
</body></html>`;
}

async function main() {
  if (!RESEND_API_KEY) { console.error('Missing RESEND_API_KEY'); process.exit(1); }
  if (!SITES.length) { console.error('Missing SITES'); process.exit(1); }

  console.log('Starting weekly scan for', SITES.length, 'sites...');
  console.log('Sites:', SITES.join(', '));

  const siteResults = [];
  for (const site of SITES) {
    const { pagesVisited, results } = await scanSite(site);
    siteResults.push({ site, pagesVisited, results });
  }

  console.log('\nAll sites scanned. Sending email...');

  const totalBroken = siteResults.reduce((s, r) => s + r.results.filter(l => l.type === 'broken').length, 0);
  const subject = `Wekelijks Link Rapport — ${totalBroken} broken link${totalBroken !== 1 ? 's' : ''} gevonden`;
  const html = buildEmailHtml(siteResults);

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Link Checker <onboarding@resend.dev>',
      to: TO_EMAILS,
      subject,
      html
    })
  });

  const emailData = await emailRes.json();
  if (emailRes.ok) {
    console.log('Email sent successfully!', emailData.id);
  } else {
    console.error('Email failed:', emailData);
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
