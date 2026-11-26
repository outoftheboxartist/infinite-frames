/* Infinite Frames: the question game.
 *
 * A window (closed curve) can carry a question. Opening that window asks for your answer
 * first. You answer blind, then see what everyone else said and judge it: agree, disagree,
 * or add a different opinion. Agreement on your answers, and on the questions you ask, is
 * your standing:
 *   - strokes you drew after an answer grow as people agree with that answer
 *   - standing 3 unlocks a bigger brush, standing 6 unlocks colours outside a window's rule
 *
 * Nothing new in the database: questions and answers are ordinary idea messages (so they
 * also show in the chat wall's IDEAS tab) and votes are the app's own agree / disagree votes.
 *   question  { idea:true, q:true, b:<window id>, loc, text }
 *   answer    { idea:true, a:true, parent:<question id>, b:<window id>, loc, text, alt?:<answer id> }
 * Every question and answer keeps the window it belongs to and where that window is (loc),
 * so they can later be laid out in space.
 *
 * Hooks (small patches in scripts/import-main-app.py):
 *   window.__ifOnSelect(app, window)   a window was opened
 *   window.__ifGate(app, windowId)     may drawing start here? (false: ask for the answer)
 *   window.__ifAns(app, windowId)      id of my answer for this window, stored on strokes
 *   window.__ifGrow(app, answerId)     stroke width multiplier from agreement
 *   window.__ifPalette(app, window, allColours), window.__ifBrushes(app)
 *   window.__ifHidden(app, message)    answers you may not see yet (you have not answered)
 */
export const BRUSH_AT = 3, COLOUR_AT = 6, BIG_BRUSH = 36;

/* ---------- reading the game out of the chat ---------- */
const chat = (app) => app.state.chat || [];
const net = (m) => (m.agree || 0) - (m.disagree || 0);
export const questionFor = (app, bid) => { const q = chat(app).filter((m) => m.q && m.b === bid); return q[q.length - 1] || null; };
export const answersFor = (app, qid) => chat(app).filter((m) => m.a && m.parent === qid);
const myAnswer = (app, q) => answersFor(app, q.id).find((m) => m.whoId === app.props.uid && !m.alt) || null;
/** Standing: agreement on everything you answered and every question you asked, never below zero. */
export const standing = (app) => Math.max(0, chat(app).filter((m) => (m.a || m.q) && m.whoId === app.props.uid).reduce((s, m) => s + net(m), 0));
const published = (app, bid) => app.state.B.find((b) => b.id === bid) || null;
const canAsk = (app, b) => !!b && (b.founderId === app.props.uid || !!app.props.owner);

function post(app, fields) {
  const b = published(app, fields.b);
  const msg = { id: app.newId("m"), who: app.state.name, whoId: app.props.uid, idea: true, agree: 0, disagree: 0,
    loc: b ? { ...app.focus(b.d), label: b.name } : undefined, ...fields };
  app.setState((s) => (s.chat.some((m) => m.id === msg.id) ? null : { chat: [...s.chat, { ...msg, mine: true }] }));
  app.props.backend.sendMessage(msg).catch((e) => { console.error(e); app.flashToast("Not saved: " + (e.message || e)); });
  return msg;
}

/* ---------- hooks ---------- */
window.__ifGate = (app, bid) => {
  const q = questionFor(app, bid);
  if (!q || q.whoId === app.props.uid || myAnswer(app, q)) return true;
  open(app, bid);
  return false;
};
window.__ifAns = (app, bid) => { const q = questionFor(app, bid); const a = q && myAnswer(app, q); return a ? a.id : null; };
window.__ifGrow = (app, ansId) => { const m = chat(app).find((x) => x.id === ansId); return m ? 1 + Math.min(8, Math.max(0, net(m))) * 0.075 : 1; };
window.__ifPalette = (app, b, all) => (standing(app) >= COLOUR_AT ? [...b.palette, ...all.filter((c) => !b.palette.includes(c))] : b.palette);
window.__ifBrushes = (app) => (standing(app) >= BRUSH_AT ? [6, 12, 22, BIG_BRUSH] : [6, 12, 22]);
window.__ifHidden = (app, m) => {
  if (!m.a || m.whoId === app.props.uid) return false;
  const q = chat(app).find((x) => x.id === m.parent);
  return !!q && q.whoId !== app.props.uid && !myAnswer(app, q);
};
let selectTimer = 0;
window.__ifOnSelect = (app, b) => {
  clearTimeout(selectTimer);
  // let the fly-in finish, so the person sees the window before the question
  selectTimer = setTimeout(() => { if (app.state.selected === b.id && app.state.mode === "2d" && !dialog) window.__ifGate(app, b.id); }, 750);
};

/* ---------- the dialog ---------- */
const el = (tag, css, text) => { const n = document.createElement(tag); if (css) n.style.cssText = css; if (text != null) n.textContent = text; return n; };
const MONO = "font:600 11px 'JetBrains Mono',monospace;letter-spacing:.08em;color:#a6abb4";
const GHOST = "height:40px;padding:0 16px;border-radius:20px;border:1px solid rgba(255,255,255,.18);background:transparent;color:#e9eaee;font:700 13px Manrope,system-ui,sans-serif;cursor:pointer";
const MAIN = "height:40px;padding:0 18px;border-radius:20px;border:0;background:linear-gradient(90deg,#a8ecff,#f5e3b0);color:#000;font:700 13px Manrope,system-ui,sans-serif;cursor:pointer";
const SMALL = "height:32px;padding:0 12px;border-radius:16px;border:1px solid rgba(255,255,255,.18);background:transparent;color:#e9eaee;font:600 12px Manrope,system-ui,sans-serif;cursor:pointer";
const FIELD = "border-radius:12px;border:1px solid rgba(255,255,255,.18);background:#050507;color:#e9eaee;padding:10px 12px;font:500 14px Manrope,system-ui,sans-serif;resize:vertical;width:100%";

let dialog = null; // { wrap, app, bid, order, different }
function close() { if (dialog) { dialog.wrap.remove(); dialog.back && dialog.back.focus && dialog.back.focus(); dialog = null; } }
function open(app, bid) {
  close();
  const wrap = el("div", "position:fixed;inset:0;z-index:10000;display:grid;place-items:center;background:rgba(5,5,7,.6);padding:16px");
  wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-modal", "true"); wrap.setAttribute("aria-labelledby", "ifq-title");
  wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  wrap.addEventListener("pointerdown", (e) => { if (e.target === wrap) close(); });
  dialog = { wrap, app, bid, order: null, different: null, back: document.activeElement };
  document.body.appendChild(wrap);
  render(true);
}

function field(id, label, placeholder, rows) {
  const l = el("label", MONO, label); l.htmlFor = id;
  const t = el("textarea", FIELD); t.id = id; t.rows = rows || 3; t.maxLength = 280; t.placeholder = placeholder || "";
  return [l, t];
}
function row(...kids) { const r = el("div", "display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"); r.append(...kids); return r; }
function button(text, css, fn) { const b = el("button", css, text); b.type = "button"; b.onclick = fn; return b; }

function render(focus) {
  if (!dialog) return;
  const { wrap, app, bid } = dialog;
  const b = published(app, bid), q = questionFor(app, bid);
  const card = el("form", "width:min(400px,100%);max-height:calc(100dvh - 32px);overflow:auto;display:grid;gap:12px;padding:18px;border-radius:18px;background:#0e1014;border:1px solid rgba(255,255,255,.14);color:#e9eaee;font:500 14px Manrope,system-ui,sans-serif");
  card.onsubmit = (e) => e.preventDefault();
  const title = el("div", "font:800 20px/1.2 Syne,Manrope,sans-serif;overflow-wrap:anywhere"); title.id = "ifq-title";
  const note = el("div", "font-size:12px;color:#a6abb4;line-height:1.45");
  card.append(el("div", MONO, (b ? b.name : "Window").toUpperCase()), title, note);
  let first = null;

  if (!q) {
    // ask: the window's founder gives it a question
    title.textContent = "Ask this window a question";
    note.textContent = "Everyone who opens this window answers it before they draw. Their answers are saved here and judged by everyone else.";
    const [l, t] = field("ifq-text", "QUESTION", "For example: what is love?", 2);
    const ask = () => { const v = t.value.trim(); if (!v) { t.focus(); return; } post(app, { q: true, b: bid, text: v }); app.flashToast("Question set. It now opens this window."); close(); };
    card.onsubmit = (e) => { e.preventDefault(); ask(); };
    const go = el("button", MAIN, "Ask it"); go.type = "submit";
    card.append(l, t, row(button("Not now", GHOST, close), go));
    first = t;
  } else if (q.whoId !== app.props.uid && !myAnswer(app, q)) {
    // answer blind
    const n = answersFor(app, q.id).length;
    title.textContent = q.text;
    note.textContent = "Asked by " + q.who + ". Answer to open this window. " + (n ? n + (n === 1 ? " answer is" : " answers are") + " hidden until you add yours." : "You are the first to answer.");
    const [l, t] = field("ifq-text", "YOUR ANSWER", "", 3);
    const answer = () => { const v = t.value.trim(); if (!v) { t.focus(); return; } post(app, { a: true, parent: q.id, b: bid, text: v }); dialog.order = null; render(true); };
    card.onsubmit = (e) => { e.preventDefault(); answer(); };
    const go = el("button", MAIN, "Answer"); go.type = "submit";
    card.append(l, t, row(button("Not now", GHOST, close), go));
    first = t;
  } else {
    // the reveal: everyone's answers, in a shuffled order that stays put while you judge
    const all = answersFor(app, q.id);
    if (!dialog.order) dialog.order = all.map((m) => m.id).sort(() => Math.random() - 0.5);
    all.forEach((m) => { if (!dialog.order.includes(m.id)) dialog.order.push(m.id); });
    const mine = all.filter((m) => m.whoId === app.props.uid), others = dialog.order.map((id) => all.find((m) => m.id === id)).filter((m) => m && m.whoId !== app.props.uid);
    title.textContent = q.text;
    note.textContent = q.whoId === app.props.uid && !mine.length ? "Your question. Judge the answers as they come in." : "The window is open. Now judge what the others said: agreement grows their strokes, and theirs grows yours.";
    // the question is judged too: a good question rewards the person who asked it
    if (q.whoId !== app.props.uid && !app.state.voted[q.id]) {
      const judge = (kind) => () => { app.castVote(q, kind); setTimeout(() => render(false), 0); };
      const r = row(el("span", MONO + ";align-self:center;margin-right:auto", "THE QUESTION"), button("Good question", SMALL, judge("agree")), button("Not for me", SMALL, judge("disagree")));
      card.append(r);
    }
    const list = el("div", "display:grid;gap:8px");
    const item = (m) => {
      const yours = m.whoId === app.props.uid, voted = !!app.state.voted[m.id];
      const box = el("div", "display:grid;gap:8px;padding:10px 12px;border-radius:12px;border:1px solid " + (yours ? "rgba(168,236,255,.45)" : "rgba(255,255,255,.12)") + ";background:rgba(255,255,255,.03)");
      box.append(el("div", MONO, (yours ? "YOU" : m.who.toUpperCase()) + (yours || voted ? " · " + (m.agree || 0) + " AGREE · " + (m.disagree || 0) + " DISAGREE" : "")));
      box.append(el("div", "line-height:1.45;overflow-wrap:anywhere", m.text));
      if (!yours && !voted) {
        const vote = (kind) => () => { app.castVote(m, kind); setTimeout(() => render(false), 0); };
        box.append(row(button("Agree", SMALL, vote("agree")), button("Disagree", SMALL, vote("disagree")), button("Different opinion", SMALL, () => { dialog.different = m.id; render(true); })));
        box.lastChild.style.justifyContent = "flex-start";
      }
      if (dialog.different === m.id) {
        const [l, t] = field("ifq-diff", "YOUR DIFFERENT OPINION", "", 2);
        const add = () => { const v = t.value.trim(); if (!v) { t.focus(); return; } post(app, { a: true, parent: q.id, alt: m.id, b: bid, text: v }); dialog.different = null; render(false); };
        box.append(l, t, row(button("Cancel", SMALL, () => { dialog.different = null; render(false); }), button("Add it", SMALL, add)));
        first = t;
      }
      return box;
    };
    mine.forEach((m) => list.append(item(m)));
    others.forEach((m) => list.append(item(m)));
    if (!others.length) list.append(el("div", "font-size:12px;color:#a6abb4", "No other answers yet. Pass this window on."));
    const s = standing(app);
    const next = s < BRUSH_AT ? "Bigger brush at " + BRUSH_AT + "." : s < COLOUR_AT ? "Bigger brush unlocked. Colours outside the rule at " + COLOUR_AT + "." : "Bigger brush and every colour unlocked.";
    const stand = el("div", "font-size:12px;color:#a6abb4;line-height:1.45", "Your standing: " + s + ". " + next);
    stand.setAttribute("role", "status");
    const done = button(q.whoId === app.props.uid && !mine.length ? "Done" : "Start drawing", MAIN, close);
    card.append(list, stand, row(done));
    if (!first) first = done;
  }
  const keep = wrap.firstChild && wrap.firstChild.scrollTop;
  wrap.replaceChildren(card);
  if (keep) card.scrollTop = keep;
  if (focus && first) setTimeout(() => first.focus(), 30);
}

/* ---------- the pill: the selected window's question, always one tap away ---------- */
const pill = el("button", "position:fixed;z-index:9000;left:50%;transform:translateX(-50%);max-width:min(340px,calc(100vw - 32px));height:36px;padding:0 14px;border-radius:18px;border:1px solid rgba(255,255,255,.18);background:rgba(10,12,16,.88);color:#e9eaee;font:600 12px Manrope,system-ui,sans-serif;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis");
pill.type = "button"; pill.id = "ifq-pill"; pill.hidden = true;
pill.onclick = () => { const app = window.__ifApp; if (!app) return; if (app.state.selected) open(app, app.state.selected); else app.setState({ tool: "curve", panel: null }); };

let lastKey = "", lastLevel = null;
function tick() {
  const app = window.__ifApp;
  if (!app || !app.state) return;
  if (!pill.isConnected && document.body) document.body.appendChild(pill);
  const st = app.state, b = st.mode === "2d" && st.selected ? published(app, st.selected) : null, q = b && questionFor(app, b.id);
  // an empty universe says how to begin
  const empty = st.mode === "2d" && !st.B.length && !st.drafts.length && !st.selected && app.props.backend.mode !== "local";
  const text = q ? "Q · " + q.text + " · " + answersFor(app, q.id).length : b && canAsk(app, b) ? "+ Ask this window a question" : empty ? "Empty universe · draw a closed loop to begin" : "";
  pill.hidden = !text || !!dialog || !!st.toast;
  // top of the canvas, centred on it
  const stage = app.svgEl && app.svgEl.parentElement && app.svgEl.parentElement.parentElement && app.svgEl.parentElement.parentElement.parentElement;
  if (stage && !pill.hidden) { const r = stage.getBoundingClientRect(); pill.style.top = Math.round(r.top + 10) + "px"; pill.style.left = Math.round(r.left + r.width / 2) + "px"; pill.style.maxWidth = Math.round(Math.min(340, r.width - 24)) + "px"; }
  if (text !== pill.textContent) { pill.textContent = text; pill.title = q ? "Open the question and its answers" : text; }
  const s = standing(app), level = s >= COLOUR_AT ? 2 : s >= BRUSH_AT ? 1 : 0;
  if (lastLevel != null && level > lastLevel) app.flashToast(level === 2 ? "People agree with you. Every colour is unlocked." : "People agree with you. Bigger brush unlocked.");
  lastLevel = level;
  // keep an open reveal in step with new answers and votes
  const key = dialog ? chat(app).filter((m) => m.b === dialog.bid).map((m) => m.id + ":" + (m.agree || 0) + ":" + (m.disagree || 0)).join("|") : "";
  if (dialog && key !== lastKey && !wrapHasTyping()) render(false);
  lastKey = key;
}
function wrapHasTyping() { const t = dialog && dialog.wrap.querySelector("textarea"); return !!(t && t.value); }
setInterval(tick, 300);
