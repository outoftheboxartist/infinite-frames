// TWOFOLD: a 20-frame film for Infinite Frames, rendered in the browser (Canvas 2D).
// Each frame: 2048x2048, transparent background, additive light, prism-split edges,
// dithered sparkle fringe, and tiny hidden details that only show when zoomed in.
// Runs inside a page: window.renderFrame(k, assets) -> data URL (webp with alpha).
(() => {
  const S = 2048, C = S / 2;
  const TAU = Math.PI * 2;

  // ---------- randomness ----------
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // ---------- colour ----------
  function hsl(h, s, l, a = 1) { return `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`; }
  const SILVER = (a) => `rgba(210,216,228,${a})`;
  const prism = (t, a = 1, l = 62) => hsl(t * 360, 95, l, a); // t in 0..1 around the spectrum

  // ---------- primitives (ctx passed in) ----------
  function glow(g, x, y, r, col0, col1 = "rgba(0,0,0,0)") {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, col0); gr.addColorStop(1, col1);
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  function dot(g, x, y, r, col) { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }

  // the dark sphere (yin): graphite body, white rim light, silver halo
  function yinSphere(g, x, y, r) {
    g.save(); g.globalCompositeOperation = "lighter";
    glow(g, x, y, r * 4.5, SILVER(0.12));
    g.restore();
    g.save(); g.globalCompositeOperation = "source-over";
    const b = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
    b.addColorStop(0, "#5b616c"); b.addColorStop(0.45, "#1d2026"); b.addColorStop(1, "#07080a");
    g.fillStyle = b; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    g.strokeStyle = "rgba(235,240,250,.75)"; g.lineWidth = Math.max(1, r * 0.06);
    g.beginPath(); g.arc(x, y, r * 0.97, -2.6, -0.9); g.stroke();
    g.restore();
    g.save(); g.globalCompositeOperation = "lighter";
    dot(g, x - r * 0.38, y - r * 0.42, r * 0.12, "rgba(255,255,255,.85)");
    g.restore();
  }
  // the bright sphere (yang): white core, spectral halo rings
  function yangSphere(g, x, y, r, phase = 0) {
    g.save(); g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 7; i++) glow(g, x + Math.cos(phase + i) * r * 0.08, y + Math.sin(phase + i) * r * 0.08, r * (2.2 + i * 0.5), prism(i / 7 + phase / TAU, 0.07));
    glow(g, x, y, r * 1.6, "rgba(255,255,255,.95)", "rgba(255,255,255,0)");
    dot(g, x, y, r * 0.8, "rgba(255,255,255,.95)");
    g.restore();
  }
  // prism-split stroke: same path in red, green, blue, slightly offset
  function prismPath(g, pts, w, a, spread, closed = false) {
    g.save(); g.globalCompositeOperation = "lighter"; g.lineCap = "round"; g.lineJoin = "round";
    const cols = [`rgba(255,40,80,${a})`, `rgba(40,255,140,${a})`, `rgba(60,120,255,${a})`];
    cols.forEach((c, i) => {
      const o = (i - 1) * spread;
      g.strokeStyle = c; g.lineWidth = w; g.beginPath();
      pts.forEach(([x, y], k) => (k ? g.lineTo(x + o, y - o * 0.5) : g.moveTo(x + o, y - o * 0.5)));
      if (closed) g.closePath();
      g.stroke();
    });
    g.restore();
  }
  // tapered trail: width shrinks along the path, colour by position
  function trail(g, pts, w0, w1, colFn, alpha = 1) {
    g.save(); g.globalCompositeOperation = "lighter"; g.lineCap = "round";
    for (let i = 1; i < pts.length; i++) {
      const t = i / (pts.length - 1);
      g.strokeStyle = colFn(t, alpha * (1 - t * 0.85));
      g.lineWidth = w0 + (w1 - w0) * t;
      g.beginPath(); g.moveTo(pts[i - 1][0], pts[i - 1][1]); g.lineTo(pts[i][0], pts[i][1]); g.stroke();
    }
    g.restore();
  }
  // hidden detail: a tiny two-armed galaxy, only visible when zoomed in
  function microGalaxy(g, x, y, r, R, a = 0.8) {
    g.save(); g.globalCompositeOperation = "lighter";
    const turn = R() * TAU, n = 90 + (R() * 120) | 0;
    for (let i = 0; i < n; i++) {
      const arm = i % 2, t = R(), ang = turn + arm * Math.PI + t * 4.2, rr = t * r;
      const jx = (R() - 0.5) * r * 0.12, jy = (R() - 0.5) * r * 0.12;
      dot(g, x + Math.cos(ang) * rr + jx, y + Math.sin(ang) * rr + jy, 0.45 + R() * 0.6, arm ? prism(t * 0.8 + 0.1, a) : SILVER(a));
    }
    dot(g, x, y, Math.max(0.8, r * 0.08), "rgba(255,255,255,.9)");
    g.restore();
  }
  // hidden detail: a tiny orbiting pair (the whole story in miniature)
  function microPair(g, x, y, r, ang, a = 0.9) {
    g.save(); g.globalCompositeOperation = "lighter";
    const dx = Math.cos(ang) * r, dy = Math.sin(ang) * r;
    dot(g, x + dx, y + dy, Math.max(0.6, r * 0.28), SILVER(a));
    dot(g, x - dx, y - dy, Math.max(0.6, r * 0.28), "rgba(255,255,255," + a + ")");
    g.strokeStyle = prism((ang / TAU) % 1, a * 0.4); g.lineWidth = Math.max(0.3, r * 0.08);
    g.beginPath(); g.arc(x, y, r, ang + 0.4, ang + 2.4); g.stroke();
    g.beginPath(); g.arc(x, y, r, ang + 0.4 + Math.PI, ang + 2.4 + Math.PI); g.stroke();
    g.restore();
  }
  function hiddenLife(g, R, n, rad, kind = "both") {
    for (let i = 0; i < n; i++) {
      const a = R() * TAU, d = Math.sqrt(R()) * rad;
      const x = C + Math.cos(a) * d, y = C + Math.sin(a) * d;
      if (kind !== "pairs" && R() < 0.5) microGalaxy(g, x, y, 4 + R() * 10, R, 0.55);
      else microPair(g, x, y, 2 + R() * 5, R() * TAU, 0.7);
    }
  }
  // star dust
  function dust(g, R, n, rad, colFn, rMax = 1.4, center = [C, C]) {
    g.save(); g.globalCompositeOperation = "lighter";
    for (let i = 0; i < n; i++) {
      const a = R() * TAU, d = Math.pow(R(), 0.6) * rad;
      dot(g, center[0] + Math.cos(a) * d, center[1] + Math.sin(a) * d, 0.3 + R() * rMax, colFn(R(), d / rad));
    }
    g.restore();
  }
  // a logarithmic spiral arm as points
  function spiralPts(cx, cy, a0, r0, r1, turns, n = 220) {
    const pts = [];
    for (let i = 0; i <= n; i++) { const t = i / n, r = r0 * Math.pow(r1 / r0, t); pts.push([cx + Math.cos(a0 + t * turns * TAU) * r, cy + Math.sin(a0 + t * turns * TAU) * r]); }
    return pts;
  }
  // an orbit arc behind a sphere
  function arcPts(cx, cy, rx, ry, a0, a1, n = 160) {
    const pts = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); } return pts;
  }
  // flow field streaks (curl-like swirl) inside a circle
  function swirlField(g, R, n, rad, strength, colFn, len = 40, w = 1.2, center = [C, C]) {
    g.save(); g.globalCompositeOperation = "lighter"; g.lineCap = "round";
    for (let i = 0; i < n; i++) {
      let a = R() * TAU, d = Math.sqrt(R()) * rad;
      let x = center[0] + Math.cos(a) * d, y = center[1] + Math.sin(a) * d;
      g.strokeStyle = colFn(R(), d / rad); g.lineWidth = w * (0.4 + R());
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < len; s++) {
        const dx = x - center[0], dy = y - center[1], rr = Math.hypot(dx, dy) + 1e-3;
        const sw = strength * (1 - Math.min(1, rr / rad)) + 0.15;
        x += (-dy / rr) * 4 * sw + (dx / rr) * -0.6 * sw + Math.sin(y * 0.01 + s * 0.1) * 0.8;
        y += (dx / rr) * 4 * sw + (dy / rr) * -0.6 * sw + Math.cos(x * 0.01) * 0.8;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    g.restore();
  }
  // glitch rainbow bars (from the fish image's world)
  function glitchBars(g, R, n, cx, cy, rad, ang0, ang1) {
    g.save(); g.globalCompositeOperation = "lighter";
    for (let i = 0; i < n; i++) {
      const a = ang0 + (ang1 - ang0) * R(), d = rad * (0.75 + R() * 0.4);
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      g.fillStyle = prism(R(), 0.35 + R() * 0.5, 55 + R() * 15);
      g.fillRect(x, y, 6 + R() * 70, 1.5 + R() * 4);
    }
    g.restore();
  }
  // a filled yin-yang teardrop (comma) as points: half of a taijitu, rotated
  function commaPts(cx, cy, R0, rot, n = 140) {
    const pts = [];
    // outer half circle, then two small half circles (classic taijitu half)
    for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + Math.PI * (i / n); pts.push([Math.cos(a) * R0, Math.sin(a) * R0]); }
    for (let i = 0; i <= n / 2; i++) { const a = Math.PI / 2 + Math.PI * (i / (n / 2)); pts.push([Math.cos(a) * R0 / 2, -R0 / 2 * 0 + R0 / 2 + Math.sin(a) * R0 / 2]); }
    for (let i = 0; i <= n / 2; i++) { const a = Math.PI / 2 - Math.PI * (i / (n / 2)); pts.push([Math.cos(a) * R0 / 2, -R0 / 2 + Math.sin(a) * R0 / 2]); }
    const c = Math.cos(rot), s = Math.sin(rot);
    return pts.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
  }
  function fillPts(g, pts, style) { g.fillStyle = style; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); }
  // DNA strand pair along a closed circle (ring helix)
  function ringHelix(g, R, cx, cy, rad, amp, twists, rot, w, rungs = true, alpha = 1) {
    const n = 900, A = [], B = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = rot + t * TAU, ph = t * twists * TAU;
      const o1 = Math.sin(ph) * amp, o2 = Math.sin(ph + Math.PI) * amp;
      A.push([cx + Math.cos(a) * (rad + o1), cy + Math.sin(a) * (rad + o1), Math.cos(ph)]);
      B.push([cx + Math.cos(a) * (rad + o2), cy + Math.sin(a) * (rad + o2), -Math.cos(ph)]);
    }
    g.save(); g.globalCompositeOperation = "lighter"; g.lineCap = "round";
    if (rungs) for (let i = 0; i < n; i += 9) {
      const t = i / n; g.strokeStyle = prism(t * 2 % 1, 0.35 * alpha); g.lineWidth = w * 0.45;
      g.beginPath(); g.moveTo(A[i][0], A[i][1]); g.lineTo(B[i][0], B[i][1]); g.stroke();
      dot(g, (A[i][0] + B[i][0]) / 2, (A[i][1] + B[i][1]) / 2, w * 0.35, prism(t * 3 % 1, 0.6 * alpha));
    }
    for (const [S2, colFn] of [[A, (z) => SILVER(0.35 + 0.5 * (z + 1) / 2)], [B, (z, t) => prism(t, 0.35 + 0.5 * (z + 1) / 2)]]) {
      for (let i = 1; i < S2.length; i++) {
        g.strokeStyle = colFn(S2[i][2], i / S2.length); g.lineWidth = w * (0.6 + 0.4 * (S2[i][2] + 1) / 2) * alpha;
        g.beginPath(); g.moveTo(S2[i - 1][0], S2[i - 1][1]); g.lineTo(S2[i][0], S2[i][1]); g.stroke();
      }
    }
    g.restore();
  }

  // ---------- the dithered prism fringe (the effect from the Foveated prototype) ----------
  const BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
  function ditherFringe(g, strength = 1) {
    const im = g.getImageData(0, 0, S, S), d = im.data;
    const A0 = new Uint8Array(S * S); for (let i = 0; i < S * S; i++) A0[i] = d[i * 4 + 3];
    for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
      const j = y * S + x, i = j * 4, a = d[i + 3];
      if (a < 6 || a > 150) continue;
      // only real edges: where transparency changes fast; soft fills stay smooth
      const grad = Math.abs(A0[j + 1] - A0[j - 1]) + Math.abs(A0[j + S] - A0[j - S]);
      if (grad < 18) continue;
      const th = (BAYER[(y & 7) * 8 + (x & 7)] / 64) * 150;
      if (a < th * strength) { d[i + 3] = 0; continue; }
      // edge pixels that survive turn into saturated spectral sparkle
      const h = ((Math.atan2(y - C, x - C) / TAU + 0.5) + (x + y) * 0.0007) % 1;
      const [r, gg, b] = hsv(h, 0.85, 1);
      d[i] = (d[i] + r * 2) / 3; d[i + 1] = (d[i + 1] + gg * 2) / 3; d[i + 2] = (d[i + 2] + b * 2) / 3;
      d[i + 3] = Math.min(255, a * 1.4);
    }
    g.putImageData(im, 0, 0);
  }
  function hsv(h, s, v) { const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s); const m = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6]; return m.map((c) => c * 255); }

  // draw a keyed image (fish / logo), centred, with rotation and scale
  function drawImg(g, img, cx, cy, size, rot = 0, alpha = 1, comp = "source-over") {
    g.save(); g.globalAlpha = alpha; g.globalCompositeOperation = comp; g.translate(cx, cy); g.rotate(rot);
    g.drawImage(img, -size / 2, -size / 2, size, size); g.restore();
  }

  // ---------- the story ----------
  // orbit of the two lights: angle per frame, so stacked frames show the motion in 3D
  const orb = (k) => -0.55 + k * 0.62;

  const FRAMES = [
    { title: "Two", line: "Two small lights in the dark, far apart, unaware of each other.", draw(g, R) {
      const a = orb(1), d = 420;
      dust(g, R, 1400, 980, (r) => SILVER(0.05 + r * 0.25), 0.9);
      prismPath(g, arcPts(C, C, d, d * 0.42, 0, TAU, 360), 1.2, 0.18, 2, true);
      yinSphere(g, C + Math.cos(a) * d, C + Math.sin(a) * d * 0.42, 26);
      yangSphere(g, C - Math.cos(a) * d, C - Math.sin(a) * d * 0.42, 22, a);
      hiddenLife(g, R, 26, 900);
    } },
    { title: "Pull", line: "Something between them begins to pull.", draw(g, R) {
      const a = orb(2), d = 360;
      dust(g, R, 1800, 960, (r) => SILVER(0.05 + r * 0.25), 1);
      const P = (s) => [C + Math.cos(a - s) * d * s0(s), C + Math.sin(a - s) * d * 0.55 * s0(s)];
      function s0() { return 1; }
      trail(g, arcPts(C, C, d, d * 0.55, a, a - 1.2), 7, 0.5, (t, al) => SILVER(al * 0.7));
      trail(g, arcPts(C, C, d, d * 0.55, a + Math.PI, a + Math.PI - 1.2), 7, 0.5, (t, al) => prism(t * 0.9, al));
      yinSphere(g, C + Math.cos(a) * d, C + Math.sin(a) * d * 0.55, 30);
      yangSphere(g, C - Math.cos(a) * d, C - Math.sin(a) * d * 0.55, 26, a);
      hiddenLife(g, R, 30, 900);
    } },
    { title: "Orbit", line: "They fall around each other, and neither lets go.", draw(g, R) {
      const a = orb(3), d = 300;
      dust(g, R, 2600, 900, (r, f) => (r < 0.5 ? SILVER(0.08 + 0.3 * (1 - f)) : prism(r, 0.1 + 0.25 * (1 - f))), 1.1);
      for (let k = 0; k < 4; k++) {
        trail(g, spiralPts(C, C, a + k * 0.04, d, d * 1.9, -0.45), 9 - k * 2, 0.4, (t, al) => SILVER(al * 0.55));
        trail(g, spiralPts(C, C, a + Math.PI + k * 0.04, d, d * 1.9, -0.45), 9 - k * 2, 0.4, (t, al) => prism(t, al * 0.8));
      }
      yinSphere(g, C + Math.cos(a) * d, C + Math.sin(a) * d, 36);
      yangSphere(g, C - Math.cos(a) * d, C - Math.sin(a) * d, 32, a);
      hiddenLife(g, R, 34, 880);
    } },
    { title: "Spiral", line: "Their paths curl into two commas: the first shape of balance.", draw(g, R) {
      const a = orb(4), d = 250;
      swirlField(g, R, 2200, 820, 1.2, (r, f) => (r < 0.5 ? SILVER(0.05 + 0.12 * (1 - f)) : prism(r, 0.05 + 0.12 * (1 - f))), 22, 1);
      for (let k = 0; k < 7; k++) {
        trail(g, spiralPts(C, C, a + k * 0.05, d * 0.25, d * 3.3, 0.85), 14 - k * 1.7, 0.6, (t, al) => SILVER(al * 0.5));
        trail(g, spiralPts(C, C, a + Math.PI + k * 0.05, d * 0.25, d * 3.3, 0.85), 14 - k * 1.7, 0.6, (t, al) => prism(1 - t, al * 0.7));
      }
      yinSphere(g, C + Math.cos(a) * d, C + Math.sin(a) * d, 40);
      yangSphere(g, C - Math.cos(a) * d, C - Math.sin(a) * d, 36, a);
      hiddenLife(g, R, 40, 860);
    } },
    { title: "Helix", line: "Read from the side, their dance is a double helix. Every life is written this way.", draw(g, R) {
      const a = orb(5);
      dust(g, R, 2000, 940, (r) => prism(r, 0.08), 0.8);
      ringHelix(g, R, C, C, 560, 120, 7, a, 9);
      ringHelix(g, R, C, C, 300, 60, 5, -a, 5, true, 0.6);
      yinSphere(g, C + Math.cos(a) * 560, C + Math.sin(a) * 560, 44);
      yangSphere(g, C - Math.cos(a) * 560, C - Math.sin(a) * 560, 40, a);
      hiddenLife(g, R, 46, 880);
    } },
    { title: "Tide", line: "Their trails thicken into tides, and the tides take on bodies.", draw(g, R) {
      const rot = orb(6);
      const yin = commaPts(C, C, 640, rot), yang = commaPts(C, C, 640, rot + Math.PI);
      g.save(); g.globalCompositeOperation = "lighter";
      const gy = g.createRadialGradient(C, C, 0, C, C, 700); gy.addColorStop(0, "rgba(210,216,228,.10)"); gy.addColorStop(1, "rgba(210,216,228,.38)");
      fillPts(g, yin, gy);
      g.restore();
      swirlField(g, R, 1800, 640, 0.9, (r, f) => SILVER(0.07 + 0.1 * f), 26, 1.1);
      swirlField(g, R, 1800, 640, -0.9, (r, f) => prism(r, 0.06 + 0.1 * f), 26, 1.1);
      prismPath(g, yin, 5, 0.45, 5, true); prismPath(g, yang, 3, 0.3, 6, true);
      yinSphere(g, C + Math.cos(rot + Math.PI / 2) * 320, C + Math.sin(rot + Math.PI / 2) * 320, 46);
      yangSphere(g, C + Math.cos(rot - Math.PI / 2) * 320, C + Math.sin(rot - Math.PI / 2) * 320, 42, rot);
      hiddenLife(g, R, 50, 860);
    } },
    { title: "Becoming", line: "Fins unfold. One keeps the dark, one keeps every colour. Neither is whole alone.", draw(g, R, A) {
      const rot = orb(7);
      drawImg(g, A.fish, C, C, 1700, rot * 0.3 - 0.6, 0.22, "lighter");
      for (let k = 0; k < 9; k++) {
        trail(g, spiralPts(C, C, rot + k * 0.11, 120, 760, 0.62), 22 - k * 2, 1, (t, al) => SILVER(al * 0.35));
        trail(g, spiralPts(C, C, rot + Math.PI + k * 0.11, 120, 760, 0.62), 22 - k * 2, 1, (t, al) => prism(t * 1.2 % 1, al * 0.5));
      }
      glitchBars(g, R, 260, C, C, 700, rot + Math.PI - 0.3, rot + Math.PI + 1.6);
      yinSphere(g, C + Math.cos(rot) * 160, C + Math.sin(rot) * 160, 34);
      yangSphere(g, C - Math.cos(rot) * 160, C - Math.sin(rot) * 160, 30, rot);
      hiddenLife(g, R, 54, 860);
    } },
    { title: "Yin n Yang", line: "Two fish, circling. The founding image of Infinite Frames.", draw(g, R, A) {
      dust(g, R, 1600, 980, (r) => prism(r, 0.06), 0.8);
      drawImg(g, A.fish, C, C, 1900, 0, 1);
      hiddenLife(g, R, 60, 900);
    } },
    { title: "Current", line: "Where they swim, the water remembers: a current of every colour.", draw(g, R, A) {
      const rot = 0.72;
      for (let k = 0; k < 3; k++) glitchBars(g, R, 520, C, C, 760 + k * 40, -Math.PI + k, Math.PI + k);
      swirlField(g, R, 2400, 900, 1.1, (r, f) => prism(r, 0.05 + 0.09 * f), 30, 1.2);
      drawImg(g, A.fish, C, C, 1750, rot, 1);
      hiddenLife(g, R, 60, 900);
    } },
    { title: "Liminal", line: "A threshold: the space between what was and what's next.", draw(g, R, A) {
      const rot = 1.44;
      drawImg(g, A.fish, C, C, 1600, rot, 0.55);
      g.save(); g.globalCompositeOperation = "lighter";
      const w = 420, h = 1500, x0 = C - w / 2, y0 = C - h / 2;
      for (let i = 0; i < 26000; i++) {
        const x = x0 + R() * w, y = y0 + Math.pow(R(), 1.1) * h, edge = Math.min(x - x0, x0 + w - x) / (w / 2);
        dot(g, x + (R() - 0.5) * 14 * (1 - edge), y, 0.4 + R() * 2.2 * (1 - edge * 0.6), R() < 0.7 ? `rgba(235,245,255,${0.08 + 0.3 * R()})` : prism(R(), 0.35));
      }
      glow(g, C, C + 180, 520, "rgba(255,240,225,.22)");
      g.restore();
      prismPath(g, [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]], 2, 0.3, 5, true);
      // a tiny figure walking into the light
      g.save(); g.fillStyle = "#0b0c10"; g.fillRect(C - 5, C + 260, 10, 34); g.beginPath(); g.arc(C, C + 252, 6, 0, TAU); g.fill(); g.restore();
      hiddenLife(g, R, 64, 900);
    } },
    { title: "Discipline · Surrender", line: "Two rings: holding on, and letting go.", draw(g, R) {
      const r = 560, dx = 300;
      prismPath(g, arcPts(C - dx, C, r, r, 0, TAU, 400), 3.5, 0.55, 3, true);
      prismPath(g, arcPts(C + dx, C, r, r, 0, TAU, 400), 3.5, 0.55, 3, true);
      g.save(); g.beginPath(); g.arc(C - dx, C, r, 0, TAU); g.clip(); g.beginPath(); g.arc(C + dx, C, r, 0, TAU); g.clip();
      swirlField(g, R, 5200, 520, 1.6, (q, f) => (q < 0.6 ? `rgba(220,235,255,${0.1 + 0.3 * (1 - f)})` : prism(q, 0.25)), 34, 1);
      g.restore();
      yinSphere(g, C - dx - r * 0.55, C, 30);
      yangSphere(g, C + dx + r * 0.55, C, 26, 0);
      hiddenLife(g, R, 64, 900);
    } },
    { title: "Flow", line: "Between them, flow: the place where effort and ease become one motion.", draw(g, R) {
      swirlField(g, R, 9000, 940, 1.9, (q, f) => (q < 0.55 ? `rgba(215,230,255,${0.05 + 0.22 * (1 - f)})` : prism((q + f) % 1, 0.06 + 0.2 * (1 - f))), 46, 1.2);
      glow(g, C, C, 260, "rgba(255,255,255,.35)");
      const a = orb(12);
      yinSphere(g, C + Math.cos(a) * 90, C + Math.sin(a) * 90, 20);
      yangSphere(g, C - Math.cos(a) * 90, C - Math.sin(a) * 90, 18, a);
      hiddenLife(g, R, 70, 920);
    } },
    { title: "Galaxy", line: "Zoom out far enough and the two lights are the heart of a galaxy.", draw(g, R) {
      const a = orb(13);
      g.save(); g.globalCompositeOperation = "lighter";
      glow(g, C, C, 760, "rgba(200,190,255,.10)");
      for (let i = 0; i < 150000; i++) {
        const arm = i % 2, t = Math.pow(R(), 0.7), ang = a + arm * Math.PI + t * 3.6 + (R() - 0.5) * (1.1 - t * 0.5);
        const rr = 40 + t * 900, x = C + Math.cos(ang) * rr, y = C + Math.sin(ang) * rr * 0.78;
        dot(g, x, y, 0.35 + R() * 1.5 * (1 - t * 0.5), arm ? prism((t * 1.3 + R() * 0.1) % 1, 0.08 + 0.4 * (1 - t)) : SILVER(0.08 + 0.4 * (1 - t)));
      }
      glow(g, C, C, 330, "rgba(255,248,235,.45)");
      g.restore();
      for (let i = 0; i < 140; i++) { const t = R(), ang = a + (i % 2) * Math.PI + t * 3.6; microGalaxy(g, C + Math.cos(ang) * (60 + t * 880), C + Math.sin(ang) * (60 + t * 880) * 0.78, 5 + R() * 12, R, 0.6); }
      yinSphere(g, C + Math.cos(a) * 46, C + Math.sin(a) * 36, 16);
      yangSphere(g, C - Math.cos(a) * 46, C - Math.sin(a) * 36, 14, a);
    } },
    { title: "Chaos", line: "Up close, the galaxy is a tangle. What we call chaos is patterns we haven't recognised yet.", draw(g, R) {
      const pts = []; for (let i = 0; i < 260; i++) { const a = R() * TAU, d = Math.sqrt(R()) * 820; pts.push([C + Math.cos(a) * d, C + Math.sin(a) * d]); }
      g.save(); g.globalCompositeOperation = "lighter"; g.lineCap = "round";
      for (let i = 0; i < pts.length; i++) {
        const near = pts.map((p, j) => [Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), j]).sort((p, q) => p[0] - q[0]).slice(1, 4);
        for (const [dd, j] of near) {
          const [x1, y1] = pts[i], [x2, y2] = pts[j], mx = (x1 + x2) / 2 + (R() - 0.5) * dd * 0.5, my = (y1 + y2) / 2 + (R() - 0.5) * dd * 0.5;
          for (const [w, al] of [[5, 0.05], [1.6, 0.5]]) { g.strokeStyle = `rgba(235,240,250,${al})`; g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.quadraticCurveTo(mx, my, x2, y2); g.stroke(); }
        }
      }
      for (const [x, y] of pts) { glow(g, x, y, 14, prism(R(), 0.5)); dot(g, x, y, 2.2, "rgba(255,255,255,.9)"); }
      g.restore();
      hiddenLife(g, R, 90, 880);
    } },
    { title: "Pattern", line: "The tangle resolves. It was always the helix, closed into a ring.", draw(g, R) {
      const a = orb(15);
      ringHelix(g, R, C, C, 640, 150, 11, a, 12);
      ringHelix(g, R, C, C, 420, 90, 8, -a * 1.3, 8, true, 0.7);
      ringHelix(g, R, C, C, 230, 50, 5, a * 1.7, 5, true, 0.5);
      dust(g, R, 2500, 900, (q) => prism(q, 0.1), 0.9);
      hiddenLife(g, R, 70, 900);
    } },
    { title: "Bloom", line: "Every rung of the ring opens into a flower of light.", draw(g, R) {
      const a = orb(16);
      ringHelix(g, R, C, C, 640, 150, 11, a, 6, false, 0.45);
      g.save(); g.globalCompositeOperation = "lighter";
      for (let i = 0; i < 44; i++) {
        const t = i / 44, ang = a + t * TAU, rr = 640 + Math.sin(t * 11 * TAU) * 150 * 0.5;
        const x = C + Math.cos(ang) * rr, y = C + Math.sin(ang) * rr, s = 26 + R() * 30, h = R();
        for (let p = 0; p < 9; p++) { const pa = p / 9 * TAU + R() * 0.2; glow(g, x + Math.cos(pa) * s * 0.7, y + Math.sin(pa) * s * 0.7, s * 0.55, `rgba(245,238,255,${0.28 + R() * 0.2})`); }
        glow(g, x, y, s * 0.55, prism(h, 0.8, 55)); glow(g, x, y, s * 2.4, prism(h, 0.08));
      }
      // a wave of light particles rising through the middle
      for (let i = 0; i < 30000; i++) {
        const x = C - 700 + R() * 1400, base = C + 120 * Math.sin((x - C) / 260) - 80 * Math.cos((x - C) / 140);
        dot(g, x, base + (R() - 0.5) * 70 * R(), 0.35 + R() * 1.2, R() < 0.75 ? `rgba(230,240,255,${0.06 + 0.25 * R()})` : prism(R(), 0.4));
      }
      g.restore();
      hiddenLife(g, R, 70, 900);
    } },
    { title: "IF", line: "The light gathers into a name: Infinite Frames.", draw(g, R, A) {
      swirlField(g, R, 5000, 980, 1.3, (q, f) => prism(q, 0.04 + 0.12 * f), 36, 1);
      drawImg(g, A.logo, C, C, 1500, 0, 1);
      for (let i = 0; i < 700; i++) { const a = R() * TAU, d = 560 + R() * 380; microPair(g, C + Math.cos(a) * d, C + Math.sin(a) * d, 3 + R() * 7, R() * TAU, 0.8); }
      hiddenLife(g, R, 50, 900, "pairs");
    } },
    { title: "Every Pair", line: "Look closer: the name is made of countless pairs, each in its own orbit.", draw(g, R, A) {
      drawImg(g, A.logo, C, C, 1500, 0, 0.28);
      // sample the logo: every bright spot becomes an orbiting pair
      const c = document.createElement("canvas"); c.width = c.height = 256; const q = c.getContext("2d"); q.drawImage(A.logo, 0, 0, 256, 256);
      const px = q.getImageData(0, 0, 256, 256).data;
      for (let y = 0; y < 256; y += 2) for (let x = 0; x < 256; x += 2) {
        const i = (y * 256 + x) * 4; if (px[i + 3] < 90) continue;
        const X = C + (x / 256 - 0.5) * 1500 + (R() - 0.5) * 6, Y = C + (y / 256 - 0.5) * 1500 + (R() - 0.5) * 6;
        microPair(g, X, Y, 3 + R() * 5, R() * TAU + x * 0.05, 0.85);
      }
      hiddenLife(g, R, 40, 900, "pairs");
    } },
    { title: "Infinite", line: "Pairs within pairs within pairs. Balance all the way down.", draw(g, R) {
      const levels = (cx, cy, r, depth, rot) => {
        const yin = commaPts(cx, cy, r, rot, 80), yang = commaPts(cx, cy, r, rot + Math.PI, 80);
        g.save(); g.globalCompositeOperation = "lighter";
        fillPts(g, yin, `rgba(210,216,228,${0.16 + 0.05 * depth})`);
        g.restore();
        prismPath(g, arcPts(cx, cy, r, r, 0, TAU, 120), Math.max(0.6, r * 0.012), 0.35, Math.max(0.5, r * 0.006), true);
        prismPath(g, yin, Math.max(0.6, r * 0.01), 0.5, Math.max(0.4, r * 0.005), true);
        if (depth >= 3 || r < 10) { microPair(g, cx, cy, r * 0.45, rot, 0.9); return; }
        // seven smaller wholes around and in each eye
        levels(cx + Math.cos(rot + Math.PI / 2) * r / 2, cy + Math.sin(rot + Math.PI / 2) * r / 2, r * 0.22, depth + 1, rot * 1.6 + 1);
        levels(cx - Math.cos(rot + Math.PI / 2) * r / 2, cy - Math.sin(rot + Math.PI / 2) * r / 2, r * 0.22, depth + 1, -rot * 1.6 - 1);
        for (let k = 0; k < 6; k++) { const a = rot + k / 6 * TAU; levels(cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78, r * 0.16, depth + 1, a); }
      };
      levels(C, C, 900, 0, orb(19));
      hiddenLife(g, R, 40, 900, "pairs");
    } },
    { title: "No Final Frame", line: "And again: two small lights. But each one now holds the whole story. Your turn.", draw(g, R, A) {
      const a = orb(20), d = 380;
      dust(g, R, 1600, 980, (q) => prism(q, 0.08), 0.8);
      prismPath(g, arcPts(C, C, d, d * 0.5, 0, TAU, 360), 1.2, 0.2, 2, true);
      const p1 = [C + Math.cos(a) * d, C + Math.sin(a) * d * 0.5], p2 = [C - Math.cos(a) * d, C - Math.sin(a) * d * 0.5];
      yinSphere(g, p1[0], p1[1], 70);
      yangSphere(g, p2[0], p2[1], 64, a);
      // inside each light, if you zoom in: the fish, and a galaxy
      drawImg(g, A.fish, p1[0], p1[1], 96, a, 0.95, "lighter");
      microGalaxy(g, p2[0], p2[1], 40, R, 0.9);
      hiddenLife(g, R, 30, 900);
    } },
  ];

  window.TWOFOLD = { count: FRAMES.length, meta: FRAMES.map((f) => ({ title: f.title, line: f.line })) };
  window.renderFrame = (k, A) => {
    const c = document.createElement("canvas"); c.width = c.height = S;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.clearRect(0, 0, S, S);
    const R = rng(9301 + k * 7919);
    FRAMES[k - 1].draw(g, R, A);
    ditherFringe(g, 1);
    return c.toDataURL("image/webp", 0.9);
  };
})();
