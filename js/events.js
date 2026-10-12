// ケージバン: 画面遷移・シート・ボタンなどの操作
// index.html から順番に読み込みます(前のファイルで決めた名前を使います)。

// ---------- navigation ----------
function go(gid){
  try { history.replaceState(null, "", gid ? "#" + gid : location.pathname + location.search); } catch {}
  openGroup(gid);
}
function hashGid(){ const g = location.hash.slice(1); return /^g[a-z0-9]{6,20}$/.test(g) ? g : null; }
window.addEventListener("hashchange", () => { const g = hashGid(); if (g !== S.gid && S.db) openGroup(g); });

// ---------- sheets ----------
let lastFocus = null;
const isOpen = id => !$(id).hidden;
function openSheet(id){
  closeSheets(true);
  lastFocus = document.activeElement;
  $(id).hidden = false; document.body.classList.add("sheet-open");
  const f = $(id).querySelector(".x"); f && f.focus({preventScroll:true});
  renderSheets(); updateCounters();
}
function closeSheets(silent){
  document.querySelectorAll(".sheet").forEach(s => s.hidden = true);
  document.body.classList.remove("sheet-open");
  if (!silent && lastFocus && lastFocus.focus) lastFocus.focus({preventScroll:true});
}
document.querySelectorAll(".sheet").forEach(s => {
  s.addEventListener("click", e => { if (e.target === s || e.target.closest("[data-close]")) closeSheets(); });
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheets(); });

let setTab = "me";
function showSetTab(t){
  setTab = t; $("shSet").dataset.cur = t;
  $("setTabs").querySelectorAll("button").forEach(b => { const on = b.dataset.t === t; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
}
$("setTabs").addEventListener("click", e => { const b = e.target.closest("button[data-t]"); if (b) showSetTab(b.dataset.t); });
showSetTab("me");
function openSettings(tab){
  delete $("rName").dataset.dirty; delete $("gNameInput").dataset.dirty;
  resetBtnForm();
  if (tab) showSetTab(tab);
  openSheet("shSet");
}

// ---------- header / misc ----------
document.querySelectorAll("[data-reload]").forEach(b => b.addEventListener("click", () => location.reload()));
let refreshing = false;
$("reloadBtn").addEventListener("click", async () => {
  if (refreshing || !S.gid) return;
  refreshing = true;
  const b = $("reloadBtn"); b.classList.add("spin"); closeSheets(true);
  const started = Date.now();
  try {
    if (await pageChanged()){ $("updating").hidden = false; setTimeout(() => location.reload(), 220); return; }
    openGroup(S.gid, true);
  } catch {}
  await new Promise(r => setTimeout(r, Math.max(0, 700 - (Date.now() - started))));
  b.classList.remove("spin"); refreshing = false;
  toast("最新の状態にしました");
});
$("errHome").addEventListener("click", () => { S.fatal = null; go(null); });
$("grpBtn").addEventListener("click", () => go(null));
$("setBtn").addEventListener("click", () => openSettings());
$("editBtns").addEventListener("click", () => openSettings("group"));
$("shareBtn").addEventListener("click", () => copy(linkFor(S.gid), "招待リンクをコピーしました。LINEなどで送ってね"));
$("switchBtn").addEventListener("click", () => go(null));

// ---------- home ----------
$("openCreate").addEventListener("click", () => { setHomeOpen(homeOpen === "create" ? null : "create"); if (homeOpen) $("cName").focus(); });
$("openPaste").addEventListener("click", () => { setHomeOpen(homeOpen === "paste" ? null : "paste"); if (homeOpen) $("pasteInput").focus(); });
$("pasteForm").addEventListener("submit", e => {
  e.preventDefault();
  const m = $("pasteInput").value.match(/#(g[a-z0-9]{6,20})/);
  if (!m) return toast("招待リンクが読み取れませんでした。リンクをまるごと貼り付けてください", true);
  $("pasteInput").value = "";
  go(m[1]);
});
// the first buttons of a new board: the usual six are on; tap to swap
const C_ALL = [...DEFAULT_BUTTONS, ...EXTRA_BUTTONS];
let cSel = new Set(DEFAULT_BUTTONS.map(b => b[1]));
function renderCreateButtons(){
  $("cButtons").replaceChildren(...C_ALL.map(([e, t]) => h("button", { type:"button", class:"chip sm" + (cSel.has(t) ? " on" : ""), "aria-pressed":String(cSel.has(t)),
    onclick:() => { if (cSel.has(t)) cSel.delete(t); else cSel.add(t); renderCreateButtons(); } }, `${e} ${t}`)));
}
$("createForm").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("cName").value.trim(), me = $("cMe").value.trim(), pin = $("cPin").value.trim();
  if (!name || !me) return;
  if (!/^[0-9]{4}$/.test(pin)) return toast("合言葉は数字4桁で入れてください", true);
  if (S.owned.length >= MAX_OWNED) return toast(`作れるボードは${MAX_OWNED}つまでです。使わなくなったボードを削除すると、また作れます`, true);
  const gid = newId("g");
  $("cSubmit").disabled = true;
  try {
    // board, me, my passcode and the first buttons in one go, so they never end up half-saved
    const now = Date.now(), hash = await pinHash(gid, S.uid, pin);
    const buttons = C_ALL.filter(b => cSel.has(b[1])).map(([emoji, text], i) => [`groups/${gid}/buttons/${newId("b")}`, { emoji, text, order:i, at:now }]);
    await withRetry(() => S.db.commit([
      ["groups/" + gid, { name, createdBy:S.uid, createdAt:now }],
      [`groups/${gid}/members/${S.uid}`, { name:me, joinedAt:now, hasPin:true }],
      [`groups/${gid}/pins/${S.uid}`, { hash }],
      [`users/${S.uid}`, { groups:[{ id:gid, name }, ...S.myGroups].slice(0, 30), owned:[...S.owned, gid] }],
      ...buttons,
    ]));
    S.owned = [...S.owned, gid];
    ls.set("name", me); $("cName").value = ""; $("cPin").value = "";
    go(gid);
    toast("できました!右上の 🔗 で招待リンクをコピーして送ってね");
  } catch (err){ onWriteError(err); }
  finally { $("cSubmit").disabled = S.canWrite === false; }
});

// ---------- join ----------
$("claimBtn").addEventListener("click", async () => {
  const mid = claimSel; if (!mid || !S.members[mid]) return;
  const needPin = S.members[mid].hasPin, pin = $("claimPin").value.trim();
  if (needPin && !/^[0-9]{4}$/.test(pin)) return toast("合言葉(数字4桁)を入れてください", true);
  const b = $("claimBtn"); b.disabled = true;
  const ref = S.db.doc(`groups/${S.gid}/links/${S.uid}`), at = Date.now();
  try {
    try { await withRetry(() => ref.set(needPin ? { mid, at, pin, verified:true } : { mid, at })); }
    catch (err){
      if (needPin && err && err.code === "invalid_argument"){ toast("合言葉が違います", true); return; }
      throw err;
    }
    // don't leave the passcode sitting in the link
    if (needPin) await withRetry(() => ref.set({ mid, at, verified:true }));
    $("claimPin").value = "";
    S.linkMid = mid; claimSel = null;
    ls.set("name", S.members[mid].name);
    render();
    toast(`${S.members[mid].name}として入りました`);
  } catch (err){ onWriteError(err); }
  finally { b.disabled = false; }
});
$("joinForm").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("jName").value.trim(); if (!name) return;
  $("jSubmit").disabled = true;
  try { await saveName(name); $("jName").value = ""; render(); }
  catch (err){ onWriteError(err); }
  finally { $("jSubmit").disabled = S.canWrite === false; }
});

// ---------- posting ----------
const postPath = pid => `groups/${S.gid}/posts/${pid}`;
const lastPress = {};
function pressButton(b, el){
  if (S.canWrite === false) return;
  // a repeating button that's already OK this period: a second press takes my press(es) back
  if (doneThisPeriod(b)) return unpressButton(b, el);
  // a quick second tap is almost always a mistake
  if (lastPress[b.id] && Date.now() - lastPress[b.id] < 4000) return toast("さっき書いたばかりです");
  lastPress[b.id] = Date.now();
  const pid = newId("p"), at = Date.now();
  const post = { by:S.me, text:b.text, emoji:b.emoji, bid:b.id, at };
  bounce(el);
  jumpTop = true;
  S.db.commit([[postPath(pid), post], [`groups/${S.gid}/latest/${b.id}`, { at, by:S.me, pid }]]).catch(onWriteError);
  toast(`${b.emoji} ${b.text} と書きました`, false, { label:"取り消す", fn:() => { lastPress[b.id] = 0; deletePost({ id:pid, ...post }, true); } });
}
// remove my presses of a repeating button in this period, so it goes back to "今月まだ".
// Someone else's press can only be removed by them (the rules), so then it just says so.
let unpressing = false;
async function unpressButton(b, el){
  if (unpressing) return;
  const now = EVERY[b.every].now, from = periodStart(b.every), lt = S.latest[b.id];
  if (lt && lt.by !== S.me) return toast(`${now}は${nameOf(lt.by)}が押しました。取り消せるのは${nameOf(lt.by)}だけです`);
  unpressing = true;
  try {
    const snap = await withRetry(() => S.db.collection(`groups/${S.gid}/posts`).where("bid", "==", b.id).get());
    const all = snap.docs.map(d => cleanPost(d.id, d.data())).filter(Boolean);
    const mine = all.filter(p => p.by === S.me && p.at >= from);
    if (!mine.length) return;
    const gone = new Set(mine.map(p => p.id));
    const rest = all.filter(p => !gone.has(p.id)).sort((x, y) => y.at - x.at);
    bounce(el);
    await withRetry(() => S.db.commit([...mine.map(p => [postPath(p.id), null]),
      [`groups/${S.gid}/latest/${b.id}`, rest[0] ? { at:rest[0].at, by:rest[0].by, pid:rest[0].id } : null]]));
    if (S.filterPosts) S.filterPosts = S.filterPosts.filter(p => !gone.has(p.id));
    lastPress[b.id] = 0;
    const still = rest[0] && rest[0].at >= from;
    toast(still ? `取り消しました(${nameOf(rest[0].by)}の分で${now}OKのままです)` : `${b.emoji} ${now}OKを取り消しました`, false,
      { label:"元に戻す", fn:() => { if (!doneThisPeriod(b)) pressButton(b, el); } });
  } catch (err){ onWriteError(err); }
  finally { unpressing = false; render(); }
}
$("btnGrid").addEventListener("click", e => {
  const el = e.target.closest(".kb"); if (!el) return;
  const b = S.buttons.find(x => x.id === el.dataset.bid); if (b) pressButton(b, el);
});
function bounce(el){
  try { navigator.vibrate && navigator.vibrate(12); } catch {}
  if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  el.classList.remove("boing"); void el.offsetWidth; el.classList.add("boing");
}
function updateComposer(){
  const box = $("postInput"), v = box.value, n = chars(v);
  box.style.height = "auto"; box.style.height = Math.min(box.scrollHeight + 2, 140) + "px";
  $("postSubmit").disabled = S.canWrite === false || !v.trim();
  $("postCount").textContent = n ? `${n}/${POST_MAX}` : "";
  $("postCount").classList.toggle("full", n >= POST_MAX);
}
$("postInput").addEventListener("input", updateComposer);
$("postInput").addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)){ e.preventDefault(); $("postForm").requestSubmit(); } });
$("postForm").addEventListener("submit", e => {
  e.preventDefault();
  const text = [...$("postInput").value.trim()].slice(0, POST_MAX).join("");
  if (!text || S.canWrite === false) return;
  const pid = newId("p"), post = { by:S.me, text, emoji:"", bid:"", at:Date.now() };
  $("postInput").value = ""; updateComposer();
  jumpTop = true;
  S.db.commit([[postPath(pid), post]]).catch(err => { onWriteError(err); if (!$("postInput").value) $("postInput").value = text; updateComposer(); });
  toast("書きました", false, { label:"取り消す", fn:() => deletePost({ id:pid, ...post }, true) });
});
// the newest remaining press of each button, leaving out some posts (one deleted, or a member's)
async function latestOps(bids, skip){
  const ops = [];
  for (const bid of bids){
    const snap = await withRetry(() => S.db.collection(`groups/${S.gid}/posts`).where("bid", "==", bid).get());
    const rest = snap.docs.map(d => cleanPost(d.id, d.data())).filter(p => p && !skip(p)).sort((a, b) => b.at - a.at);
    ops.push([`groups/${S.gid}/latest/${bid}`, rest[0] ? { at:rest[0].at, by:rest[0].by, pid:rest[0].id } : null]);
  }
  return ops;
}
// two taps: the first arms 取り消す, the second (within 4 s) deletes. The toast's 取り消す deletes at once.
async function deletePost(p, now){
  if (!now && delArmed !== p.id){
    delArmed = p.id; clearTimeout(delTimer);
    delTimer = setTimeout(() => { delArmed = null; renderPosts(); }, 4000);
    renderPosts(); return;
  }
  clearTimeout(delTimer); delArmed = null;
  try {
    const lt = p.bid && S.latest[p.bid];
    const ops = [[postPath(p.id), null], ...(lt && lt.pid === p.id ? await latestOps([p.bid], x => x.id === p.id) : [])];
    if (S.filterPosts) S.filterPosts = S.filterPosts.filter(x => x.id !== p.id);
    await withRetry(() => S.db.commit(ops));
    toast("取り消しました");
  } catch (err){ onWriteError(err); }
  render();
}
// ---------- reactions ----------
// a small row of emoji above the tapped button; one reaction per person, tap the same one again to take it back
let reactFor = null;
function openReactPicker(p, anchor){
  if (S.canWrite === false || p.by === S.me) return;
  const pop = $("reactPop"), cur = (p.re || {})[S.me];
  reactFor = p.id;
  pop.replaceChildren(...REACTIONS.map(e => h("button", { type:"button", class:"rp" + (cur === e ? " on" : ""), "aria-pressed":String(cur === e),
    onclick:() => { closeReactPicker(); react(p, e); } }, e)));
  pop.hidden = false;
  const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, hh = pop.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w));
  const top = r.top - hh - 8 > 8 ? r.top - hh - 8 : r.bottom + 8;
  pop.style.left = left + "px"; pop.style.top = top + "px";
  pop.querySelector(".rp").focus({ preventScroll:true });
}
function closeReactPicker(){ $("reactPop").hidden = true; reactFor = null; }
document.addEventListener("pointerdown", e => { if (reactFor && !e.target.closest("#reactPop, .react-btn, .react-badge")) closeReactPicker(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && reactFor) closeReactPicker(); });
$("postScroll").addEventListener("scroll", () => { if (reactFor) closeReactPicker(); }, { passive:true });
window.addEventListener("resize", () => { if (reactFor) closeReactPicker(); });
async function react(p, e){
  if (S.canWrite === false || p.by === S.me) return;
  const off = (p.re || {})[S.me] === e;
  try {
    // only my own key changes, so two people reacting at once don't overwrite each other
    await withRetry(() => S.db.doc(postPath(p.id)).update({ ["re." + S.me]: off ? S.db.deleteField() : e }));
    // the filtered list is fetched once, so keep it in step by hand
    if (S.filterPosts) S.filterPosts = S.filterPosts.map(x => {
      if (x.id !== p.id) return x;
      const re = { ...x.re }; if (off) delete re[S.me]; else re[S.me] = e;
      return { ...x, re };
    });
    render();
  } catch (err){
    // a refused reaction shouldn't lock the whole page (e.g. the new rules aren't published yet)
    if (err && err.code === "invalid_argument")
      return toast(S.posts.some(x => x.id === p.id) ? "反応を保存できませんでした。ページを再読み込みしてください" : "この書き込みは消されています", true);
    onWriteError(err);
  }
}

$("moreBtn").addEventListener("click", () => { $("moreBtn").disabled = true; loadMore(); setTimeout(() => { $("moreBtn").disabled = false; }, 600); });
async function setFilter(v){
  if (S.filter === v) v = null;
  S.filter = v; S.filterPosts = null; jumpTop = true; render();
  if (v == null) return;
  try {
    const snap = await withRetry(() => S.db.collection(`groups/${S.gid}/posts`).where("bid", "==", v).limit(500).get());
    if (S.filter !== v) return;
    S.filterPosts = snap.docs.map(d => cleanPost(d.id, d.data())).filter(Boolean);
    jumpTop = true;
  } catch {
    if (S.filter !== v) return;
    S.filterPosts = []; toast("読み込めませんでした。通信を確認してください", true);
  }
  render();
}

// ---------- buttons (editor in settings) ----------
// what a button document holds ("every" only when it repeats)
function btnBody(b){
  const d = { emoji:b.emoji, text:b.text, order:b.order, at:b.at };
  if (EVERY[b.every]) d.every = b.every;
  return d;
}
// 定期 on/off, then 毎日・毎週・毎月 (turning it on starts from the last interval picked, 毎月 at first)
let lastEvery = "month";
$("beRepeatSw").addEventListener("change", e => { beEvery = e.target.checked ? lastEvery : ""; renderBtnEditor(); });
$("beEvery").addEventListener("click", e => {
  const x = e.target.closest("button[data-v]"); if (!x || !beEvery) return;
  beEvery = lastEvery = x.dataset.v; renderBtnEditor();
});
function resetBtnForm(){
  beEdit = null; beEvery = ""; $("beText").value = ""; $("beEmoji").value = EMOJIS.find(e => !S.buttons.some(b => b.emoji === e)) || "✅";
}
function startBtnEdit(b){
  beEdit = b.id; beEvery = b.every; $("beEmoji").value = b.emoji; $("beText").value = b.text;
  renderBtnEditor(); updateCounters();
  // on a phone the form sits below the list: bring it into view (no keyboard; tap the text to change it)
  $("beForm").scrollIntoView({ block:"center", behavior:"smooth" });
}
$("beCancel").addEventListener("click", () => { resetBtnForm(); renderBtnEditor(); updateCounters(); });
$("beEmoji").addEventListener("input", () => renderBtnEditor());
$("beForm").addEventListener("submit", async e => {
  e.preventDefault();
  const text = [...$("beText").value.trim()].slice(0, BTN_TEXT_MAX).join(""), emoji = firstGlyph($("beEmoji").value);
  if (!text) return;
  const cur = beEdit && S.buttons.find(b => b.id === beEdit);
  if (!cur && S.buttons.length >= MAX_BUTTONS) return toast(`ボタンは${MAX_BUTTONS}個までです`, true);
  const id = cur ? cur.id : newId("b");
  const data = btnBody({ emoji, text, every:beEvery, ...(cur ? { order:cur.order, at:cur.at } : { order:S.buttons.reduce((m, b) => Math.max(m, b.order + 1), 0), at:Date.now() }) });
  $("beSave").disabled = true;
  try {
    await withRetry(() => S.db.doc(`groups/${S.gid}/buttons/${id}`).set(data));
    toast(cur ? "ボタンを変えました" : `${emoji} ${text} を追加しました`);
    resetBtnForm();
  } catch (err){
    // a refused button shouldn't lock the whole page (e.g. the Firebase rules are older than this page)
    if (err && err.code === "invalid_argument") toast("ボタンを保存できませんでした。Firebaseのルールが最新か確認してください", true);
    else onWriteError(err);
  }
  renderBtnEditor(); updateCounters();
});
async function moveBtn(i){
  const list = [...S.buttons];
  [list[i - 1], list[i]] = [list[i], list[i - 1]];
  const ops = list.map((b, k) => b.order === k ? null : [`groups/${S.gid}/buttons/${b.id}`, btnBody({ ...b, order:k })]).filter(Boolean);
  S.buttons = list.map((b, k) => ({ ...b, order:k })); render();
  try { await withRetry(() => S.db.commit(ops)); } catch (err){ onWriteError(err); }
}
async function removeBtn(b){
  if (beRmArmed !== b.id){
    beRmArmed = b.id; clearTimeout(beRmTimer);
    beRmTimer = setTimeout(() => { beRmArmed = null; if (isOpen("shSet")) renderBtnEditor(); }, 4000);
    return renderBtnEditor();
  }
  clearTimeout(beRmTimer); beRmArmed = null;
  if (beEdit === b.id) resetBtnForm();
  if (S.filter === b.id){ S.filter = null; S.filterPosts = null; }
  try {
    await withRetry(() => S.db.commit([[`groups/${S.gid}/buttons/${b.id}`, null], [`groups/${S.gid}/latest/${b.id}`, null]]));
    toast(`${b.emoji} ${b.text} を消しました`);
  } catch (err){ onWriteError(err); }
  render();
}

// ---------- me ----------
function memberBody(m){
  const b = { name:m.name, joinedAt:m.joinedAt };
  if (m.color != null) b.color = m.color;
  if (m.hasPin) b.hasPin = true;
  return b;
}
async function saveMember(patch){
  const mid = S.me || S.uid, prev = S.members[mid];
  const next = { ...(prev || { joinedAt:Date.now(), color:null, hasPin:false }), ...patch };
  await withRetry(() => S.db.doc(`groups/${S.gid}/members/${mid}`).set(memberBody(next)));
  S.members = { ...S.members, [mid]: next };
}
async function saveName(name){
  await saveMember({ name });
  ls.set("name", name);
}
async function saveColor(i){
  const mid = S.me, prev = S.members[mid]; if (!prev) return;
  S.members = { ...S.members, [mid]: { ...prev, color:i } }; render();
  try { await saveMember({ color:i }); toast("保存しました"); }
  catch (err){ onWriteError(err); }
}
$("rName").addEventListener("input", () => { $("rName").dataset.dirty = "1"; });
$("renameForm").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("rName").value.trim(); if (!name) return;
  try { await saveName(name); delete $("rName").dataset.dirty; render(); toast("保存しました"); }
  catch (err){ onWriteError(err); }
});
async function pinHash(gid, mid, pin){
  const data = new TextEncoder().encode(`${gid}:${mid}:${pin}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
}
async function setPin(pin){
  const mid = S.me;
  if (pin == null){
    await withRetry(() => S.db.doc(`groups/${S.gid}/pins/${mid}`).delete());
    await saveMember({ hasPin:false });
  } else {
    const hash = await pinHash(S.gid, mid, pin);
    await withRetry(() => S.db.doc(`groups/${S.gid}/pins/${mid}`).set({ hash }));
    await saveMember({ hasPin:true });
  }
}
$("pinForm").addEventListener("submit", async e => {
  e.preventDefault();
  const pin = $("pinInput").value.trim();
  if (!/^[0-9]{4}$/.test(pin)) return toast("合言葉は数字4桁で入れてください", true);
  try { await setPin(pin); $("pinInput").value = ""; render(); toast("保存しました。合言葉は忘れないようにしてください"); }
  catch (err){ onWriteError(err); }
});
$("pinClear").addEventListener("click", async () => {
  try { await setPin(null); render(); toast("合言葉を解除しました"); }
  catch (err){ onWriteError(err); }
});

// ---------- board ----------
$("gNameInput").addEventListener("input", () => { $("gNameInput").dataset.dirty = "1"; });
$("gNameForm").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("gNameInput").value.trim().slice(0, 24); if (!name) return;
  if (name === S.group.name){ delete $("gNameInput").dataset.dirty; return; }
  try {
    await withRetry(() => S.db.doc("groups/" + S.gid).update({ name }));
    S.group = { ...S.group, name }; delete $("gNameInput").dataset.dirty;
    render(); toast("保存しました");
  } catch (err){ onWriteError(err); }
});
// creator powers: the creating browser, or a passcode-verified link to the creator who still has a passcode
function isCreatorHere(){
  const c = S.group && S.group.createdBy;
  if (!c) return false;
  if (c === S.uid) return true;
  return S.linkMid === c && S.linkVerified && !!(S.members[c] && S.members[c].hasPin);
}
$("creatorVerifyForm").addEventListener("submit", async e => {
  e.preventDefault();
  const pin = $("creatorPin").value.trim(), mid = S.linkMid;
  if (!/^[0-9]{4}$/.test(pin)) return toast("合言葉(数字4桁)を入れてください", true);
  if (!mid) return;
  const ref = S.db.doc(`groups/${S.gid}/links/${S.uid}`), at = Date.now();
  try {
    try { await withRetry(() => ref.set({ mid, at, pin, verified:true })); }
    catch (err){ if (err && err.code === "invalid_argument"){ toast("合言葉が違います", true); return; } throw err; }
    await withRetry(() => ref.set({ mid, at, verified:true }));
    S.linkVerified = true; $("creatorPin").value = "";
    render(); toast("確認できました。「管理」タブから操作できます");
  } catch (err){ onWriteError(err); }
});

// everything a member leaves behind: posts, read mark, passcode, links, and the buttons' "last pressed" that point at them
async function memberPaths(gid, mid){
  const paths = [];
  const posts = await withRetry(() => S.db.collection(`groups/${gid}/posts`).where("by", "==", mid).get());
  posts.docs.forEach(d => paths.push(`groups/${gid}/posts/${d.id}`));
  paths.push(`groups/${gid}/reads/${mid}`);
  return paths;
}
async function fixLatestWithout(mid){
  const bids = Object.keys(S.latest).filter(bid => S.latest[bid].by === mid);
  if (bids.length) await withRetry(async () => S.db.commit(await latestOps(bids, p => p.by === mid)));
}

// two taps, like deleting the board
let leaveArmed = null;
$("leaveBtn").addEventListener("click", async () => {
  const b = $("leaveBtn");
  if (!leaveArmed){
    b.classList.add("armed"); b.textContent = "本当に抜ける(書き込みも消えます)";
    leaveArmed = setTimeout(() => { leaveArmed = null; b.classList.remove("armed"); b.textContent = "このボードを抜ける"; }, 5000);
    return;
  }
  clearTimeout(leaveArmed); leaveArmed = null;
  b.disabled = true; b.textContent = "抜けています…";
  const gid = S.gid, mid = S.me, name = S.group.name;
  try {
    if (!mid || S.group.createdBy === mid) throw new Error("creator");
    await fixLatestWithout(mid);
    const paths = await memberPaths(gid, mid);
    stopSubs();
    await S.db.deleteMany(paths);
    // my link proves who I am on a re-entered browser, so it goes last, together with my record
    await S.db.deleteMany([`groups/${gid}/pins/${mid}`, `groups/${gid}/members/${mid}`, `groups/${gid}/links/${S.uid}`]);
    forgetGroup(gid);
    go(null);
    toast(`「${name}」を抜けました`);
  } catch {
    toast("抜ける途中で止まりました。通信を確認して、もう一度押してください", true);
    openGroup(gid);
  } finally {
    b.disabled = false; b.classList.remove("armed"); b.textContent = "このボードを抜ける";
  }
});

let rmArmed = null, rmTimer = null;
function renderMemManage(){
  const ids = Object.keys(S.members).sort((a, b) => S.members[a].joinedAt - S.members[b].joinedAt);
  $("memManage").replaceChildren(...ids.map(id => h("li", null,
    h("span", { class:"who" }, avatar(id, S.members[id].name), h("span", { text: S.members[id].name + (id === S.me ? "(あなた)" : "") })),
    id === S.me ? null : h("button", { type:"button", class:"rm" + (rmArmed === id ? " armed" : ""), onclick:() => removeMember(id) }, rmArmed === id ? "本当に外す" : "外す"))));
}
async function removeMember(mid){
  if (rmArmed !== mid){
    rmArmed = mid; clearTimeout(rmTimer);
    rmTimer = setTimeout(() => { rmArmed = null; if (isOpen("shSet")) renderMemManage(); }, 5000);
    renderMemManage(); return;
  }
  clearTimeout(rmTimer); rmArmed = null;
  const gid = S.gid, name = nameOf(mid);
  try {
    await fixLatestWithout(mid);
    const paths = await memberPaths(gid, mid);
    const links = await withRetry(() => S.db.collection(`groups/${gid}/links`).where("mid", "==", mid).get());
    links.docs.forEach(d => paths.push(`groups/${gid}/links/${d.id}`));
    paths.push(`groups/${gid}/pins/${mid}`, `groups/${gid}/members/${mid}`);
    await S.db.deleteMany(paths);
    toast(`${name}をボードから外しました`);
  } catch (err){ onWriteError(err); }
  if (isOpen("shSet")) renderMemManage();
}

// two taps: the first arms the button, the second (within 5 s) deletes
let delGroupArmed = null;
$("delBtn").addEventListener("click", async () => {
  const b = $("delBtn");
  if (!delGroupArmed){
    b.classList.add("armed"); b.textContent = "本当に削除する(元に戻せません)";
    delGroupArmed = setTimeout(() => { delGroupArmed = null; b.classList.remove("armed"); b.textContent = "このボードを削除する"; }, 5000);
    return;
  }
  clearTimeout(delGroupArmed); delGroupArmed = null;
  b.disabled = true; b.textContent = "削除しています…";
  const gid = S.gid, name = S.group.name;
  try {
    await deleteGroup(gid);
    S.owned = S.owned.filter(x => x !== gid);
    forgetGroup(gid);
    go(null);
    toast(`「${name}」を削除しました`);
  } catch {
    toast("削除が途中で止まりました。通信を確認して、もう一度「このボードを削除する」を押してください", true);
    openGroup(gid);
  } finally {
    b.disabled = false; b.classList.remove("armed"); b.textContent = "このボードを削除する";
  }
});
async function deleteGroup(gid){
  const members = Object.keys(S.members), creator = S.group && S.group.createdBy;
  stopSubs();
  const paths = [];
  for (const sub of ["posts", "latest", "buttons", "reads", "links", "members"]){
    const snap = await withRetry(() => S.db.collection(`groups/${gid}/${sub}`).get());
    snap.docs.forEach(d => paths.push(`groups/${gid}/${sub}/${d.id}`));
    // passcodes can't be listed; remove one per member (members come last, so this runs before them)
    if (sub === "links") members.forEach(mid => paths.push(`groups/${gid}/pins/${mid}`));
  }
  // my link and the creator's passcode prove I'm the creator on another device; the rules check them
  // before each write, so they go in the final batch together with the board itself
  const keep = [`groups/${gid}/links/${S.uid}`, creator ? `groups/${gid}/pins/${creator}` : null].filter(Boolean);
  await S.db.deleteMany(paths.filter(x => !keep.includes(x)));
  await S.db.deleteMany([...keep, "groups/" + gid]);
}

// keep the "3日前" labels fresh while the page stays open
setInterval(() => { if (S.me && document.visibilityState === "visible" && !document.activeElement.matches("input,textarea")) render(); }, 60000);
