// ケージバン: 購読(リアルタイム更新)・参加ボード・既読・アイコン
// index.html から順番に読み込みます(前のファイルで決めた名前を使います)。

// ---------- subscriptions ----------
let boardUnsubs = [], postsUnsub = null;
function stopSubs(){ S.unsubs.forEach(u => { try{u();}catch{} }); S.unsubs = []; boardUnsubs = []; postsUnsub = null; }
function onSubError(e){
  if (e && e.code === "revoked") return fail("このページへのアクセスが変わりました。再読み込みしてください。");
  fail("データを読み込めませんでした。通信を確認して再読み込みしてください。");
}
function openGroup(gid, quiet){
  if (gid && !quiet){ ls.set("last", gid); bumpGroup(gid); }
  stopSubs();
  if (quiet) S.deniedFor = null;
  else {
    closeSheets(true);
    Object.assign(S, { gid, deniedFor:null, me:null, linkMid:null, linkVerified:false, linkLoaded:false, group:null, groupLoaded:false,
      members:{}, membersLoaded:false, buttons:[], latest:{}, reads:{}, readsReady:false, posts:[], postsReady:false, postsLive:false, limit:PAGE, hasMore:false,
      filter:null, filterPosts:null, prevRead:null });
    render();
  }
  if (!gid) return;
  const g = S.db.doc("groups/" + gid);
  const settle = key => setTimeout(() => { if (S.gid === gid && !S[key]){ S[key] = true; render(); } }, 4000);

  S.unsubs.push(g.onSnapshot(snap => {
    if (S.gid !== gid) return;
    const d = snap.exists ? snap.data() : null;
    S.group = d ? { name:str(d.name, 24) || "ボード", createdBy:str(d.createdBy, 200) } : null;
    if (!snap.metadata.fromCache || d) S.groupLoaded = true; else settle("groupLoaded");
    render();
  }, onSubError));

  S.unsubs.push(g.collection("members").onSnapshot(snap => {
    if (S.gid !== gid) return;
    const m = {};
    snap.docs.forEach(doc => { const d = doc.data(); if (d && str(d.name, 16)) m[doc.id] = { name:str(d.name, 16), joinedAt:num(d.joinedAt) || 0, color:clamp(d.color, 0, 15, null), hasPin:d.hasPin === true }; });
    S.members = m;
    if (!snap.metadata.fromCache || m[S.uid] || (S.linkMid && m[S.linkMid])) S.membersLoaded = true; else settle("membersLoaded");
    render();
  }, onSubError));

  // which member this browser acts as, when it isn't the browser that joined
  S.unsubs.push(g.collection("links").doc(S.uid).onSnapshot(snap => {
    if (S.gid !== gid) return;
    if (snap.metadata.hasPendingWrites) return;   // wait for the server's verdict
    const d = snap.exists ? snap.data() : null;
    S.linkMid = d && typeof d.mid === "string" ? d.mid : null;
    S.linkVerified = !!(d && d.verified === true);
    if (!snap.metadata.fromCache || d) S.linkLoaded = true; else settle("linkLoaded");
    render();
  }, onSubError));
}

// these reads need membership; losing it (removed by the creator) just stops them
function boardSubError(e){
  if (e && e.code === "invalid_argument"){ S.deniedFor = S.me; stopBoardSubs(); render(); return; }
  onSubError(e);
}
function stopBoardSubs(){
  boardUnsubs.forEach(u => { try{u();}catch{} });
  S.unsubs = S.unsubs.filter(u => !boardUnsubs.includes(u)); boardUnsubs = []; postsUnsub = null;
}
function subscribeBoard(){
  if (!S.me || boardUnsubs.length) return;
  const gid = S.gid, col = sub => S.db.collection(`groups/${gid}/${sub}`);
  const watch = (q, fn) => {
    const u = q.onSnapshot(snap => { if (S.gid !== gid) return; fn(snap); render(); }, boardSubError);
    boardUnsubs.push(u); S.unsubs.push(u);
    return u;
  };
  watch(col("buttons"), snap => {
    S.buttons = snap.docs.map(d => cleanButton(d.id, d.data())).filter(Boolean).sort((a, b) => a.order - b.order || a.at - b.at);
  });
  watch(col("latest"), snap => {
    const o = {};
    snap.docs.forEach(d => { const x = d.data(); if (x && num(x.at)) o[d.id] = { at:x.at, by:str(x.by, 128), pid:str(x.pid, 40) }; });
    S.latest = o;
  });
  watch(col("reads"), snap => {
    const o = {};
    snap.docs.forEach(d => { const x = d.data(); if (x && num(x.at)) o[d.id] = x.at; });
    S.reads = o;
    if (!snap.metadata.fromCache) S.readsReady = true;
    markRead();
  });
  watchPosts();
}
function watchPosts(){
  const gid = S.gid, limit = S.limit;
  if (postsUnsub){ try{ postsUnsub(); }catch{} boardUnsubs = boardUnsubs.filter(u => u !== postsUnsub); S.unsubs = S.unsubs.filter(u => u !== postsUnsub); }
  postsUnsub = S.db.collection(`groups/${gid}/posts`).orderBy("at", "desc").limit(limit).onSnapshot(snap => {
    if (S.gid !== gid || S.limit !== limit) return;
    S.posts = snap.docs.map(d => cleanPost(d.id, d.data())).filter(Boolean);
    S.hasMore = snap.size >= limit;
    S.postsReady = true;
    if (!snap.metadata.fromCache) S.postsLive = true;
    render(); markRead();
  }, boardSubError);
  boardUnsubs.push(postsUnsub); S.unsubs.push(postsUnsub);
}
function loadMore(){ S.limit += PAGE; watchPosts(); }

// ---------- read marks ----------
// reads/<member> = when that member last opened the board. A post counts as seen by everyone whose mark is later.
let markedFor = "";
function markRead(){
  if (!S.me || !S.readsReady || !S.postsLive) return;
  if (S.prevRead == null){
    S.prevRead = S.reads[S.me] || 0;
    const n = S.posts.filter(p => p.by !== S.me && p.at > S.prevRead).length;
    if (S.prevRead && n) setTimeout(() => toast(`前回から${n}件の新しい書き込み`), 500);
    render();
  }
  if (document.visibilityState !== "visible" || S.canWrite === false) return;
  const newest = S.posts.reduce((m, p) => p.by !== S.me && p.at > m ? p.at : m, 0);
  const mine = S.reads[S.me] || 0, key = S.gid + ":" + S.me + ":" + newest;
  // once per newest post: a phone clock that runs behind could otherwise keep writing
  if ((newest > mine || !mine) && markedFor !== key){
    markedFor = key;
    const now = Date.now(), at = Math.min(Math.max(now, newest), now + 240000);   // the rules allow up to 5 minutes ahead
    S.reads = { ...S.reads, [S.me]: at };
    writeDoc(S.db.doc(`groups/${S.gid}/reads/${S.me}`), { at });
  }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.me) markRead(); });
// members other than the writer who have opened the board since the post
function seenBy(p){
  return Object.keys(S.members).filter(id => id !== p.by && (S.reads[id] || 0) >= p.at)
    .sort((a, b) => S.members[a].joinedAt - S.members[b].joinedAt);
}
const isNew = p => S.prevRead != null && S.prevRead > 0 && p.by !== S.me && p.at > S.prevRead;

// ---------- my boards ----------
const userDoc = () => ({ groups:S.myGroups.slice(0, 30), owned:S.owned.slice(0, MAX_OWNED) });
async function loadMyGroups(){
  S.myGroups = ls.get("groups", []);
  if (!S.uid || !S.db) return;
  try {
    const snap = await S.db.doc(`users/${S.uid}`).get();
    const remote = snap.exists && Array.isArray(snap.data().groups) ? snap.data().groups : [];
    S.owned = snap.exists && Array.isArray(snap.data().owned) ? snap.data().owned.filter(x => typeof x === "string").slice(0, MAX_OWNED) : [];
    const merged = [...S.myGroups];
    remote.forEach(g => { if (g && typeof g.id === "string" && !merged.some(x => x.id === g.id)) merged.push({id:str(g.id, 40), name:str(g.name, 24)}); });
    S.myGroups = merged; ls.set("groups", merged);
  } catch {}
}
function saveUserDoc(){ if (S.uid && S.canWrite !== false) writeDoc(S.db.doc(`users/${S.uid}`), userDoc()); }
// most recently opened board goes to the top of the home list
function bumpGroup(id){
  const i = S.myGroups.findIndex(g => g.id === id);
  if (i <= 0) return;
  S.myGroups = [S.myGroups[i], ...S.myGroups.slice(0, i), ...S.myGroups.slice(i + 1)];
  ls.set("groups", S.myGroups); saveUserDoc();
}
function forgetGroup(id){
  if (!S.myGroups.some(g => g.id === id)) return;
  S.myGroups = S.myGroups.filter(g => g.id !== id);
  ls.set("groups", S.myGroups); saveUserDoc();
}
function rememberGroup(id, name){
  const i = S.myGroups.findIndex(g => g.id === id);
  if (i >= 0 && S.myGroups[i].name === name) return;
  if (i >= 0) S.myGroups[i] = {id, name}; else S.myGroups.unshift({id, name});
  ls.set("groups", S.myGroups); saveUserDoc();
}

// ---------- icons ----------
// 12 well-spaced hues; the member id picks one unless the member chose a color
function colorIndex(id){
  const m = S.members[id];
  if (m && m.color != null) return m.color;
  let x = 0; for (const ch of String(id)) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return x % 12;
}
// stored color numbers: 0–11 soft hues, 12 black, 13–15 vivid red / blue / yellow
const AV_ORDER = [0,1,2,3,4,5,6,7,8,9,10,11,13,14,15,12];
const AV_VIVID = { 13:"#e60012", 14:"#0068d9", 15:"#ffd400" };
const AV_NAMES = { 12:"黒", 13:"赤", 14:"青", 15:"黄" };
const avBg = i => i === 12 ? "#141318" : AV_VIVID[i] || `hsl(${i * 30} 55% 44%)`;
const avStyle = i => `--avbg:${avBg(i)};--avfg:${i === 15 ? "#2b1d00" : "#fff"}`;
function avatar(id, name, cls){
  return h("span", { class:"av" + (cls ? " " + cls : ""), style:avStyle(colorIndex(id)), "aria-hidden":"true", text:[...(name || "?")][0] });
}
const nameOf = id => S.members[id] ? S.members[id].name : "抜けた人";
