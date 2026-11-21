// Trace the founder's fish and IF logo once, at high detail, with the app's own tracer.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const DIST = '/home/user/infinite-frames/web/dist';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.route('http://web.local/**', (route) => {
    let f = new URL(route.request().url()).pathname; if (f === '/') f = '/index.html';
    const p = path.join(DIST, f);
    if (!fs.existsSync(p)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, body: fs.readFileSync(p), contentType: TYPES[path.extname(p)] || 'application/octet-stream' });
  });
  await page.goto('http://web.local/');
  await page.waitForFunction(() => window.__ifApp, null, { timeout: 30000 });
  const out = {};
  for (const [name, k] of [['fish', 12], ['iflogo', 12]]) {
    const src = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'src', name + '.png')).toString('base64');
    out[name] = await page.evaluate(async ({ src, k }) => {
      const app = window.__ifApp, parent = { id: 'P', d: 'M0,0 L1000,0 L1000,1000 L0,1000 Z' };
      const im = await app.loadImg(src), c = document.createElement('canvas'); c.width = c.height = 320;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0, 320, 320);
      const px = g.getImageData(0, 0, 320, 320).data, samples = [];
      for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 110) samples.push([px[i], px[i + 1], px[i + 2]]);
      const pal = app.kmeans(samples, k).map((q) => '#' + q.map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''));
      const v = await app.vectorize([{ type: 'image', src, x: 0, y: 0, w: 1000, h: 1000 }], parent, { palette: pal, res: 720, sp: 6, ch: 2, mf: 1 });
      return { pal, paths: v.paths };
    }, { src, k });
    console.log(name, 'layers', out[name].paths.length, 'KB', Math.round(JSON.stringify(out[name].paths).length / 1024));
  }
  fs.writeFileSync(path.join(__dirname, 'sources.json'), JSON.stringify(out));
  await browser.close();
})();
