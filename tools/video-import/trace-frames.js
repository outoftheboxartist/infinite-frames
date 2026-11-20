// Trace 10 video frames with the app's own tracer (shared palette), crop into nested curves.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const DIST = '/home/user/infinite-frames/web/dist';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const K = +(process.env.K || 12), RES = +(process.env.RES || 480);
const SQ = { x: 310, y: 20, w: 380, h: 380 };

(async () => {
  const frames = fs.readdirSync(path.join(__dirname, 'spread')).filter((f) => f.endsWith('.png')).sort()
    .map((f) => 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'spread', f)).toString('base64'));
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page.route('http://web.local/**', (route) => {
    let f = new URL(route.request().url()).pathname; if (f === '/') f = '/index.html';
    const p = path.join(DIST, f);
    if (!fs.existsSync(p)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, body: fs.readFileSync(p), contentType: TYPES[path.extname(p)] || 'application/octet-stream' });
  });
  await page.goto('http://web.local/');
  await page.waitForFunction(() => window.__ifApp && window.__ifNested, null, { timeout: 30000 });
  const out = await page.evaluate(async ({ frames, K, RES, SQ }) => {
    const app = window.__ifApp;
    const d = `M${SQ.x},${SQ.y} L${SQ.x + SQ.w},${SQ.y} L${SQ.x + SQ.w},${SQ.y + SQ.h} L${SQ.x},${SQ.y + SQ.h} Z`;
    const parent = { id: 'PARENT', d };
    // one palette for every frame: k-means over bright pixels from all frames
    const samples = [];
    for (const src of frames) {
      const im = await app.loadImg(src), c = document.createElement('canvas'); c.width = 156; c.height = 156;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0, 156, 156);
      const px = g.getImageData(0, 0, 156, 156).data;
      for (let i = 0; i < px.length; i += 4) if (Math.max(px[i], px[i + 1], px[i + 2]) > 50) samples.push([px[i], px[i + 1], px[i + 2]]);
    }
    const pal = [...app.kmeans(samples, K).map((c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')), '#000000'];
    const res = [];
    for (let k = 0; k < frames.length; k++) {
      const img = { type: 'image', src: frames[k], x: SQ.x, y: SQ.y, w: SQ.w, h: SQ.h };
      const v = await app.vectorize([img], parent, { palette: pal, res: RES, dropBg: true, mf: 1 });
      const regions = window.__ifNested(v, parent);
      res.push({ paths: v.paths, cx: v.cx, cy: v.cy, regions, bytes: JSON.stringify(v.paths).length });
    }
    return { pal, d, res };
  }, { frames, K, RES, SQ });
  fs.writeFileSync(path.join(__dirname, 'traced.json'), JSON.stringify(out));
  console.log('palette', out.pal.join(' '));
  out.res.forEach((r, i) => console.log('frame', i + 1, 'layers', r.paths.length, 'curves', r.regions.length, 'art bytes', r.bytes, 'curve bytes', JSON.stringify(r.regions).length));
  await browser.close();
})();
