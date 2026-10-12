// ケージバン: Firebase との接続・新しい版の確認・テーマ・起動
// index.html から順番に読み込みます(前のファイルで決めた名前を使います)。

// ---------- Firebase adapter: exposes the small doc/collection API the page uses ----------
const ERR = { "permission-denied":"invalid_argument", "invalid-argument":"invalid_argument", "failed-precondition":"invalid_argument",
  "not-found":"invalid_argument", "resource-exhausted":"quota_exceeded", "unavailable":"unavailable", "deadline-exceeded":"unavailable", "unauthenticated":"revoked" };
const wrapErr = e => ({ code: ERR[e && e.code] || "unavailable", message: String((e && e.message) || e) });
const rethrow = p => p.catch(e => { throw wrapErr(e); });
const wrapDoc = d => ({ id:d.id, exists:d.exists, data:() => d.exists ? d.data() : undefined, metadata:d.metadata });
const wrapQuery = q => ({ docs:q.docs.map(wrapDoc), size:q.size, empty:q.empty, metadata:q.metadata });
function makeDb(fsdb){
  const docRef = r => ({ id:r.id, path:r.path,
    get: () => rethrow(r.get().then(wrapDoc)),
    set: d => rethrow(r.set(d)),
    update: d => rethrow(r.update(d)),
    delete: () => rethrow(r.delete()),
    onSnapshot: (next, err) => r.onSnapshot(x => next(wrapDoc(x)), e => err && err(wrapErr(e))),
    collection: p => colRef(r.collection(p)) });
  const query = q => ({
    where: (f, op, v) => query(q.where(f, op, v)),
    orderBy: (f, dir) => query(q.orderBy(f, dir)),
    limit: n => query(q.limit(n)),
    get: () => rethrow(q.get().then(wrapQuery)),
    onSnapshot: (next, err) => q.onSnapshot(x => next(wrapQuery(x)), e => err && err(wrapErr(e))) });
  const colRef = c => Object.assign(query(c), { path:c.path, doc: id => docRef(id ? c.doc(id) : c.doc()) });
  // delete many documents in batches (in the given order: members last, so the rules still see membership)
  const deleteMany = async paths => {
    for (let i = 0; i < paths.length; i += 400){
      const batch = fsdb.batch();
      paths.slice(i, i + 400).forEach(p => batch.delete(fsdb.doc(p)));
      await rethrow(batch.commit());
    }
  };
  // several writes that succeed or fail together: [path, data] sets, [path, null] deletes
  const commit = async ops => {
    if (!ops.length) return;
    const batch = fsdb.batch();
    ops.forEach(([p, d]) => d === null ? batch.delete(fsdb.doc(p)) : batch.set(fsdb.doc(p), d));
    await rethrow(batch.commit());
  };
  // in update(): removes that field
  const deleteField = () => firebase.firestore.FieldValue.delete();
  return { doc: p => docRef(fsdb.doc(p)), collection: p => colRef(fsdb.collection(p)), deleteMany, commit, deleteField };
}

// ---------- new-version check (GitHub Pages) ----------
let pageSig = null;
const sigOf = t => { let x = 0; for (let i = 0; i < t.length; i++) x = (x * 31 + t.charCodeAt(i)) | 0; return t.length + ":" + x; };
// the page plus its own scripts and styles, so a change in any of them counts as a new version
const pageFiles = () => [location.pathname, ...[...document.querySelectorAll('script[src^="js/"], link[href^="css/"]')].map(e => e.getAttribute("src") || e.getAttribute("href"))];
async function fetchSig(){
  const texts = await Promise.all(pageFiles().map(async f => { const r = await fetch(f, { cache:"no-store" }); if (!r.ok) throw new Error(f); return r.text(); }));
  return sigOf(texts.join("\n"));
}
async function pageChanged(){
  try { const now = await fetchSig(); return !!(pageSig && now && now !== pageSig); } catch { return false; }
}

// ---------- theme ----------
function applyTheme(){
  const t = ls.get("theme", "auto");
  if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  document.querySelectorAll("#themePick button").forEach(b => { const on = b.dataset.t === t; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); });
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#17181c";
}
$("themePick").addEventListener("click", e => { const b = e.target.closest("button[data-t]"); if (!b) return; ls.set("theme", b.dataset.t); applyTheme(); toast("保存しました"); });
matchMedia("(prefers-color-scheme: light)").addEventListener("change", applyTheme);
applyTheme();

// ---------- connection banner ----------
function updateOnline(){ $("offline").hidden = navigator.onLine !== false; }
window.addEventListener("online", updateOnline);
window.addEventListener("offline", updateOnline);
updateOnline();

// ---------- boot ----------
async function boot(){
  fetchSig().then(x => { pageSig = x; }).catch(() => {});
  render();
  const slow = setTimeout(() => { $("slowNote").hidden = false; }, 8000);
  const cfg = window.FIREBASE_CONFIG;
  if (!window.firebase || !cfg || !cfg.apiKey){
    clearTimeout(slow);
    return fail("Firebaseの設定が読み込めませんでした。firebase-config.js に設定を貼り付けたか確認してください。");
  }
  try {
    firebase.initializeApp(cfg);
    // App Check proves requests come from this page; must start before any other Firebase call
    const siteKey = window.APPCHECK_SITE_KEY;
    if (siteKey && firebase.appCheck){
      if (/^(localhost|127.0.0.1)$/.test(location.hostname)) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      firebase.appCheck().activate(new firebase.appCheck.ReCaptchaEnterpriseProvider(siteKey), true);
    }
    const auth = firebase.auth();
    // Each browser gets a hidden anonymous account, kept between visits.
    const u = await new Promise((resolve, reject) => {
      const stop = auth.onAuthStateChanged(x => {
        if (x){ stop(); resolve(x); }
        else auth.signInAnonymously().catch(reject);
      }, reject);
    });
    S.uid = u.uid;
    S.db = makeDb(firebase.firestore());
  } catch (e){
    clearTimeout(slow);
    return fail("サーバーにつながりませんでした。通信を確認して再読み込みしてください。");
  }
  clearTimeout(slow);
  await loadMyGroups();
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  let start = hashGid();
  if (!start && standalone){
    start = ls.get("last", null);
    if (start) try { history.replaceState(null, "", "#" + start); } catch {}
  }
  openGroup(start);
}
boot();
