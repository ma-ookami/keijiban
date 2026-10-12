// ケージバン: 定数・状態・日付・小さな道具・書き込み
// index.html から順番に読み込みます(前のファイルで決めた名前を使います)。

// Invite links are this page's own URL + "#<board id>".
const SHARE_BASE = location.origin + location.pathname;

const $ = id => document.getElementById(id);
const MAX_OWNED = 3;          // boards one browser may create (the rules cap it too)
const MAX_BUTTONS = 12;
const PAGE = 50;              // posts per "もっと前を見る"
const POST_MAX = 200, BTN_TEXT_MAX = 16;
const DEFAULT_BUTTONS = [["📦","荷物届いた"],["🏠","帰ったよ"],["🚃","いまから帰る"],["🍚","ごはん食べた"],["💊","薬のんだ"],["😴","おやすみ"]];
const EXTRA_BUTTONS = [["👍","了解"],["🛒","買い物した"],["🗑️","ゴミ出した"],["🐶","散歩した"],["💰","払っておいた"],["📮","郵便きてた"]];
const EMOJIS = ["📦","🏠","🚃","🍚","💊","😴","👍","✅","🛒","🗑️","💰","📮","🐶","🐱","🌱","💡","🧺","🛁","🚗","🏥","📞","☔","⏰","🎂"];
const REACTIONS = ["👍","❤️","🙏","😂","😮","🎉"];   // keep in step with reactions() in firestore.rules
const DOW = ["日","月","火","水","木","金","土"];

const S = {
  db:null, uid:null, canWrite:null,
  gid:null, group:null, groupLoaded:false,
  members:{}, membersLoaded:false,
  linkMid:null, linkVerified:false, linkLoaded:false, me:null, deniedFor:null,
  buttons:[], latest:{}, reads:{}, readsReady:false,
  posts:[], postsReady:false, limit:PAGE, hasMore:false,
  filter:null, filterPosts:null, prevRead:null,
  myGroups:[], owned:[], fatal:null, unsubs:[],
};

const ls = {
  get(k, d){ try{ const v = localStorage.getItem("keijiban." + k); return v == null ? d : JSON.parse(v); }catch{ return d; } },
  set(k, v){ try{ localStorage.setItem("keijiban." + k, JSON.stringify(v)); }catch{} },
};

// ---------- dates (the phone's own clock and time zone) ----------
const pad2 = n => String(n).padStart(2, "0");
function dayKey(t){ const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function clock(t){ const d = new Date(t); return `${d.getHours()}:${pad2(d.getMinutes())}`; }
function dateLabel(t){ const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`; }
function dayHead(t){
  const k = dayKey(t), now = Date.now();
  if (k === dayKey(now)) return "今日 " + dateLabel(t);
  if (k === dayKey(now - 86400e3)) return "昨日 " + dateLabel(t);
  const d = new Date(t);
  return (d.getFullYear() !== new Date(now).getFullYear() ? d.getFullYear() + "年 " : "") + dateLabel(t);
}
// how long ago, in the coarsest unit that fits
function agoText(t){
  if (!t) return "";
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "たった今";
  if (m < 60) return `${m}分前`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return `${hr}時間前`;
  const d = Math.floor(hr / 24);
  if (d < 45) return `${d}日前`;
  return `${Math.floor(d / 30)}か月前`;
}
// buttons that should be pressed once a day / week / month (keep in step with validButton in firestore.rules)
const EVERY = { day:{ label:"毎日", now:"今日" }, week:{ label:"毎週", now:"今週" }, month:{ label:"毎月", now:"今月" } };
// when the current day / week (from Monday) / month began, by the phone's clock
function periodStart(every, now = Date.now()){
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  if (every === "week") d.setDate(d.getDate() - (d.getDay() + 6) % 7);
  if (every === "month") d.setDate(1);
  return d.getTime();
}
// a repeating button: pressed in this period already?
const doneThisPeriod = b => !!b.every && !!S.latest[b.id] && S.latest[b.id].at >= periodStart(b.every);

// "14:03" today, "昨日 14:03", otherwise "3日前"
function whenText(t){
  if (dayKey(t) === dayKey(Date.now())) return "今日 " + clock(t);
  if (dayKey(t) === dayKey(Date.now() - 86400e3)) return "昨日 " + clock(t);
  return agoText(t);
}

// ---------- helpers ----------
function h(tag, attrs, ...kids){
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs){
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()){ if (c == null || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return el;
}
const str = (v, n) => typeof v === "string" ? v.slice(0, n) : "";
const num = v => typeof v === "number" && isFinite(v) ? v : null;
const clamp = (v, lo, hi, d) => { const n = num(v); return n == null ? d : Math.max(lo, Math.min(hi, Math.round(n))); };
const chars = s => [...(s || "")].length;
// the first character as people see it (an emoji with skin tone or a flag is one)
function firstGlyph(s){
  s = (s || "").trim(); if (!s) return "";
  try { if (window.Intl && Intl.Segmenter) return new Intl.Segmenter("ja", { granularity:"grapheme" }).segment(s)[Symbol.iterator]().next().value.segment; } catch {}
  return [...s][0];
}
function linkFor(gid){ return SHARE_BASE + "#" + gid; }
function newId(prefix){ const a = new Uint8Array(8); crypto.getRandomValues(a); return prefix + Array.from(a, b => (b % 36).toString(36)).join(""); }

function cleanPost(id, d){
  if (!d || typeof d.by !== "string" || !num(d.at)) return null;
  const text = str(d.text, POST_MAX);
  if (!text) return null;
  // reactions: { member: emoji }, one each
  const re = {};
  if (d.re && typeof d.re === "object") for (const k in d.re) if (REACTIONS.includes(d.re[k])) re[k] = d.re[k];
  return { id, by:str(d.by, 128), text, emoji:str(d.emoji, 16), bid:str(d.bid, 40), at:d.at, re };
}
function cleanButton(id, d){
  const text = d && str(d.text, BTN_TEXT_MAX).trim();
  if (!text) return null;
  return { id, emoji:str(d.emoji, 16), text, order:clamp(d.order, 0, 999, 0), at:num(d.at) || 0, every:EVERY[d.every] ? d.every : "" };
}

// ---------- toast (with an optional action, e.g. 取り消す) ----------
let toastT;
function toast(msg, err, action){
  const t = $("toast");
  t.replaceChildren(h("span", { text:msg }));
  if (action) t.append(h("button", { type:"button", class:"toast-act", onclick:() => { t.classList.remove("show"); clearTimeout(toastT); action.fn(); } }, action.label));
  t.classList.toggle("err", !!err); t.classList.toggle("act", !!action); t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), action ? 5000 : 2200);
}
async function copy(text, okMsg){
  try { await navigator.clipboard.writeText(text); toast(okMsg || "コピーしました"); }
  catch {
    const ta = h("textarea", {style:"position:fixed;top:0;left:0;opacity:0"}); ta.value = text; document.body.append(ta);
    ta.select(); let ok = false; try{ ok = document.execCommand("copy"); }catch{}
    ta.remove();
    toast(ok ? (okMsg || "コピーしました") : "コピーできませんでした。もう一度押してください", !ok);
  }
}

// ---------- writes: one at a time per document, retry once on transient errors ----------
const writers = new Map();
function writeDoc(ref, data){
  let w = writers.get(ref.path);
  if (!w){ w = {busy:false, next:null, p:Promise.resolve()}; writers.set(ref.path, w); }
  w.next = {ref, data};
  if (!w.busy) w.p = drain(w);
  return w.p;
}
async function drain(w){
  w.busy = true;
  while (w.next){
    const {ref, data} = w.next; w.next = null;
    try { await withRetry(() => data === null ? ref.delete() : ref.set(data)); }
    catch (e){ onWriteError(e); }
  }
  w.busy = false;
}
async function withRetry(fn){
  try { return await fn(); }
  catch (e){
    if (e && e.code === "unavailable"){ await new Promise(r => setTimeout(r, 400 + Math.random() * 600)); return await fn(); }
    throw e;
  }
}
function onWriteError(e){
  const code = e && e.code;
  if (code === "invalid_argument" || code === "not_granted"){ S.canWrite = false; render(); toast("保存できませんでした。ページを再読み込みしてから、もう一度押してください", true); }
  else if (code === "quota_exceeded") toast("今日はこれ以上保存できません(無料枠の上限)。明日また試してください", true);
  else if (code === "revoked") fail("このページへのアクセスが変わりました。再読み込みしてください。");
  else toast("保存に失敗しました。通信を確認して、もう一度押してください", true);
}
