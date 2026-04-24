// scanner.js — runs in GitHub Actions, scans all sites and sends email report

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SITES = (process.env.SITES || '').split(',').map(s => s.trim()).filter(Boolean);
const TO_EMAILS = ['ni@nbsscientific.com', 'dn@nbsscientific.com'];
const TOOL_URL = process.env.TOOL_URL || 'https://linkchecker-2a6f.vercel.app';
const VERCEL_API = process.env.VERCEL_TOOL_URL || TOOL_URL;

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
  const totalRedirects = siteResults.reduce((s, r) => s + r.results.filter(l => l.type === 'redirect').length, 0);
  const totalInsecure = siteResults.reduce((s, r) => s + r.results.filter(l => l.url.startsWith('http://')).length, 0);
  const totalOk = siteResults.reduce((s, r) => s + r.results.filter(l => l.type === 'ok').length, 0);
  const toolUrl = 'https://linkchecker-2a6f.vercel.app';

  function makeTable(rows, headers) {
    if (!rows.length) return '';
    const headerCells = headers.map(h => `<th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:500;background:#f9f9f7">${h}</th>`).join('');
    return `<table style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:8px;overflow:hidden;margin-bottom:8px">
      <tr>${headerCells}</tr>${rows.join('')}
    </table>`;
  }

  const siteSections = siteResults.map(({ site, pagesVisited, results }, idx) => {
    const broken = results.filter(r => r.type === 'broken');
    const redirects = results.filter(r => r.type === 'redirect');
    const insecure = results.filter(r => r.url.startsWith('http://'));
    const ok = results.filter(r => r.type === 'ok');
    const statusColor = broken.length > 0 ? '#c0392b' : '#1a7a4a';
    const statusText = broken.length > 0 ? `⚠️ ${broken.length} broken` : '✓ Alles OK';
    const siteId = `site-${idx}`;

    // Navigation buttons — link to tool
    const navLinks = [
      broken.length > 0 ? `<a href="${TOOL_URL}#broken" style="display:inline-block;padding:5px 12px;background:#fde8e8;color:#c0392b;border-radius:20px;font-size:12px;font-weight:500;text-decoration:none;margin:2px">🔴 ${broken.length} Broken</a>` : '',
      redirects.length > 0 ? `<a href="${TOOL_URL}#redirects" style="display:inline-block;padding:5px 12px;background:#d1ecf1;color:#1a5fa8;border-radius:20px;font-size:12px;font-weight:500;text-decoration:none;margin:2px">🔵 ${redirects.length} Redirects</a>` : '',
      insecure.length > 0 ? `<a href="${TOOL_URL}#http" style="display:inline-block;padding:5px 12px;background:#fff3cd;color:#856404;border-radius:20px;font-size:12px;font-weight:500;text-decoration:none;margin:2px">🟡 ${insecure.length} HTTP</a>` : '',
      ok.length > 0 ? `<a href="${TOOL_URL}#ok" style="display:inline-block;padding:5px 12px;background:#d4edda;color:#1a7a4a;border-radius:20px;font-size:12px;font-weight:500;text-decoration:none;margin:2px">🟢 ${ok.length} Werkend</a>` : '',
    ].filter(Boolean).join('');

    const brokenRows = broken.map(r => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;word-break:break-all"><a href="${r.url}" style="color:#1a1a1a">${r.url}</a></td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#c0392b;white-space:nowrap">${r.status}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#888;word-break:break-all">${r.source}</td>
    </tr>`);

    const redirectRows = redirects.slice(0, 20).map(r => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;word-break:break-all"><a href="${r.url}" style="color:#1a1a1a">${r.url}</a></td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#1a5fa8;white-space:nowrap">${r.status}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#888;word-break:break-all">${r.redirectsTo || ''}</td>
    </tr>`);

    const insecureRows = insecure.slice(0, 20).map(r => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;word-break:break-all"><a href="${r.url}" style="color:#1a1a1a">${r.url}</a></td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#888;word-break:break-all">${r.source}</td>
    </tr>`);

    const okRows = ok.slice(0, 10).map(r => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;word-break:break-all"><a href="${r.url}" style="color:#1a7a4a">${r.url}</a></td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#888;word-break:break-all">${r.source}</td>
    </tr>`);

    return `
    <div id="${siteId}" style="background:#fff;border-radius:10px;border:1px solid #e5e5e5;margin-bottom:32px;overflow:hidden">

      <!-- Header -->
      <div style="padding:16px 20px;border-bottom:1px solid #e5e5e5;background:#fafafa">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-size:16px;font-weight:600;color:#1a1a1a">${site}</div>
            <div style="font-size:12px;color:#888;margin-top:2px">${pagesVisited} pagina's gecrawld · ${results.length} links gecheckt</div>
          </div>
          <div style="font-size:13px;font-weight:600;color:${statusColor}">${statusText}</div>
        </div>
      </div>

      <!-- Stats -->
      <div style="padding:12px 20px;background:#f9f9f7;display:flex;gap:20px;flex-wrap:wrap;border-bottom:1px solid #eee">
        <div><div style="font-size:20px;font-weight:700;color:#1a1a1a">${results.length}</div><div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em">Totaal</div></div>
        <div><div style="font-size:20px;font-weight:700;color:#1a7a4a">${ok.length}</div><div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em">Werkend</div></div>
        <div><div style="font-size:20px;font-weight:700;color:#c0392b">${broken.length}</div><div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em">Broken</div></div>
        <div><div style="font-size:20px;font-weight:700;color:#1a5fa8">${redirects.length}</div><div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em">Redirects</div></div>
        <div><div style="font-size:20px;font-weight:700;color:#b45309">${insecure.length}</div><div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em">HTTP</div></div>
      </div>

      <!-- Category navigation -->
      ${navLinks ? `<div style="padding:12px 20px;border-bottom:1px solid #eee;background:#fff">${navLinks}</div>` : ''}

      <!-- Broken links -->
      ${broken.length > 0 ? `
      <div id="${siteId}-broken" style="padding:16px 20px 12px">
        <div style="font-size:13px;font-weight:600;color:#c0392b;margin-bottom:10px">🔴 Broken links (${broken.length})</div>
        ${makeTable(brokenRows, ['URL', 'Status', 'Gevonden op'])}
      </div>` : ''}

      <!-- Redirects -->
      ${redirects.length > 0 ? `
      <div id="${siteId}-redirects" style="padding:16px 20px 12px;border-top:1px solid #f0f0f0">
        <div style="font-size:13px;font-weight:600;color:#1a5fa8;margin-bottom:10px">🔵 Redirects (${redirects.length}${redirects.length > 20 ? ', top 20 getoond' : ''})</div>
        ${makeTable(redirectRows, ['URL', 'Status', 'Redirect naar'])}
      </div>` : ''}

      <!-- HTTP insecure -->
      ${insecure.length > 0 ? `
      <div id="${siteId}-http" style="padding:16px 20px 12px;border-top:1px solid #f0f0f0">
        <div style="font-size:13px;font-weight:600;color:#856404;margin-bottom:10px">🟡 HTTP (onveilig) (${insecure.length}${insecure.length > 20 ? ', top 20 getoond' : ''})</div>
        ${makeTable(insecureRows, ['URL', 'Gevonden op'])}
      </div>` : ''}

      <!-- Working links (collapsed, top 10 only) -->
      ${ok.length > 0 ? `
      <div id="${siteId}-ok" style="padding:16px 20px 12px;border-top:1px solid #f0f0f0">
        <div style="font-size:13px;font-weight:600;color:#1a7a4a;margin-bottom:10px">🟢 Werkende links (${ok.length}${ok.length > 10 ? ', top 10 getoond' : ''})</div>
        ${makeTable(okRows, ['URL', 'Gevonden op'])}
        ${ok.length > 10 ? `<p style="font-size:12px;color:#888;margin:4px 0 0">+ ${ok.length - 10} meer werkende links — <a href="${toolUrl}" style="color:#1a5fa8">bekijk alle resultaten in de tool</a></p>` : ''}
      </div>` : ''}

    </div>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:720px;margin:0 auto;padding:32px 16px">

    <!-- Header -->
    <div style="margin-bottom:24px">
      <h1 style="font-size:24px;font-weight:700;color:#1a1a1a;margin:0 0 4px">Wekelijks Link Rapport</h1>
      <p style="font-size:14px;color:#888;margin:0 0 16px">${date} · ${siteResults.length} websites gescand</p>

      <!-- Overall summary badges -->
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
        <span style="display:inline-block;padding:6px 14px;background:#fde8e8;color:#c0392b;border-radius:20px;font-size:13px;font-weight:600">🔴 ${totalBroken} Broken</span>
        <span style="display:inline-block;padding:6px 14px;background:#d1ecf1;color:#1a5fa8;border-radius:20px;font-size:13px;font-weight:600">🔵 ${totalRedirects} Redirects</span>
        <span style="display:inline-block;padding:6px 14px;background:#fff3cd;color:#856404;border-radius:20px;font-size:13px;font-weight:600">🟡 ${totalInsecure} HTTP</span>
        <span style="display:inline-block;padding:6px 14px;background:#d4edda;color:#1a7a4a;border-radius:20px;font-size:13px;font-weight:600">🟢 ${totalOk} Werkend</span>
      </div>

      <!-- Button to tool -->
      <a href="${toolUrl}" style="display:inline-block;padding:10px 20px;background:#1a1a1a;color:#fff;border-radius:8px;font-size:14px;font-weight:500;text-decoration:none">Bekijk volledige resultaten in de tool →</a>
    </div>

    ${siteSections}

    <div style="text-align:center;font-size:12px;color:#aaa;margin-top:24px;padding-top:16px;border-top:1px solid #e5e5e5">
      Automatisch verzonden door uw <a href="${toolUrl}" style="color:#aaa">Link Checker tool</a>
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

  console.log('\nAll sites scanned. Saving report...');

  // Save report to tool via API
  try {
    const reportPayload = {
      date: new Date().toISOString(),
      siteResults: siteResults.map(({ site, pagesVisited, results }) => ({
        site, pagesVisited,
        results: results.map(r => ({ url: r.url, source: r.source, type: r.type, status: r.status, redirectsTo: r.redirectsTo || null }))
      }))
    };
    const saveRes = await fetch(`${TOOL_URL}/api/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reportPayload)
    });
    if (saveRes.ok) console.log('Report saved successfully.');
    else console.log('Could not save report:', await saveRes.text());
  } catch(e) {
    console.log('Could not save report:', e.message);
  }

  console.log('Sending email...');

  const totalBroken = siteResults.reduce((s, r) => s + r.results.filter(l => l.type === 'broken').length, 0);
  const subject = `Wekelijks Link Rapport — ${totalBroken} broken link${totalBroken !== 1 ? 's' : ''} gevonden`;
  const html = buildEmailHtml(siteResults);

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Link Checker <noreply@nbsscientific.com>',
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
