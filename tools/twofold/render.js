// Render TWOFOLD frames to film/out/fNN.webp (transparent), plus meta.json.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const only = process.argv[2] ? process.argv[2].split(',').map(Number) : null;
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext()).newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 300)));
  await page.setContent('<!doctype html><body></body>');
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, 'twofold.js'), 'utf8') });
  const fish = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'src/fish.png')).toString('base64');
  const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'src/iflogo.png')).toString('base64');
  await page.evaluate(async ({ fish, logo }) => {
    const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = s; });
    window.__A = { fish: await load(fish), logo: await load(logo) };
  }, { fish, logo });
  const meta = await page.evaluate(() => window.TWOFOLD.meta);
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
  for (let k = 1; k <= meta.length; k++) {
    if (only && !only.includes(k)) continue;
    const t0 = Date.now();
    const url = await page.evaluate((k) => window.renderFrame(k, window.__A), k);
    const buf = Buffer.from(url.split(',')[1], 'base64');
    fs.writeFileSync(path.join(OUT, 'f' + String(k).padStart(2, '0') + '.webp'), buf);
    console.log('frame', k, meta[k - 1].title, Math.round(buf.length / 1024) + ' KB', (Date.now() - t0) + ' ms');
  }
  await b.close();
})();
