// contact sheet of helix.json, plus deep-zoom crops: node helix_preview.js <outdir>
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const out = process.argv[2] || '.'; const H = JSON.parse(fs.readFileSync(path.join(__dirname, 'helix.json')));
const svg = (k, vb, px) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${px}" height="${px}" style="background:#000">` +
  H.frames[k].map(s => `<path d="${s.d}" fill="${s.color}" fill-rule="evenodd"/>`).join('') + '</svg>';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1800, height: 1220 } });
  let html = '<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(6,300px);gap:0">';
  for (let k = 1; k <= 24; k++) html += `<div style="position:relative">${svg(k, '0 0 1000 1000', 300)}<span style="position:absolute;left:6px;top:4px;color:#888;font:11px monospace">${k}</span></div>`;
  await p.setContent(html); await p.screenshot({ path: path.join(out, 'helix-sheet.png') });
  const P = H.places; const pg = await b.newPage({ viewport: { width: 1600, height: 400 } });
  for (const t of ['I', 'II', 'III']) {
    let h = '<body style="margin:0;background:#111;display:flex">';
    for (const s of P.filter(q => q.trail === t)) { const w = 1000 / s.view.z; h += svg(s.frame, `${s.view.x - w / 2} ${s.view.y - w / 2} ${w} ${w}`, 400); }
    await pg.setContent(h); await pg.screenshot({ path: path.join(out, `helix-trail-${t}.png`) });
  }
  await b.close();
})();
