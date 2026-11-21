const { chromium } = require('playwright'); const fs = require('fs');
const F = JSON.parse(fs.readFileSync('vector.json'));
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1000, height: 800 } });
  const cell = (k) => `<div><svg viewBox="0 0 1000 1000" width="200" height="200" style="background:#0b0d12"><circle cx="500" cy="500" r="470" fill="none" stroke="#333"/>${F[k].map(s => `<path d="${s.d}" fill="${s.color}" fill-rule="evenodd"/>`).join('')}</svg><span style="color:#aaa;font:12px sans-serif">${k}</span></div>`;
  let html = '<body style="margin:0;background:#000;display:flex;flex-wrap:wrap">'; for (let k = 1; k <= 20; k++) html += cell(k);
  await p.setContent(html + '</body>'); await p.waitForTimeout(1500); await p.screenshot({ path: 'vec-sheet.png', fullPage: true });
  for (const k of [8, 13, 20]) { await p.setContent(`<body style="margin:0;background:#000">${cell(k).replace(/width="200" height="200"/, 'width="800" height="800"')}</body>`); await p.waitForTimeout(800); await p.screenshot({ path: `vec-${k}.png` }); }
  await b.close();
})();
