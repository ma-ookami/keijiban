// ケージバン: 画面の描画
// index.html から順番に読み込みます(前のファイルで決めた名前を使います)。

// ---------- render ----------
function show(id){ ["sLoading","sError","sHome","sJoin","sMain"].forEach(s => $(s).hidden = s !== id); }
function fail(msg){ S.fatal = msg; closeSheets(true); render(); }

// "3/16" counters; counted in characters as people see them
const COUNTED = ["cName", "cMe", "jName", "rName", "gNameInput", "beText"];
function updateCounters(){
  COUNTED.forEach(id => {
    const el = $(id), c = $(id + "Count"); if (!el || !c) return;
    const n = chars(el.value), max = Number(el.getAttribute("maxlength"));
    c.textContent = `${n}/${max}`; c.classList.toggle("full", n >= max);
  });
}
COUNTED.forEach(id => {
  const el = $(id); if (!el) return;
  const c = h("span", { class:"count", id:id + "Count", "aria-live":"polite" });
  const wrap = h("span", { class:"in-wrap" });
  el.before(wrap); wrap.append(el, c);
  el.addEventListener("input", updateCounters);
});

function render(){
  queueMicrotask(updateCounters);
  const inGroup = s => { ["grpBtn","setBtn","shareBtn"].forEach(id => $(id).hidden = !s); };
  $("setBtn").classList.toggle("attn", !!(S.group && S.me && S.group.createdBy === S.me && S.members[S.me] && !S.members[S.me].hasPin));
  if (S.fatal){ $("errMsg").textContent = S.fatal; $("errHome").hidden = !S.db; inGroup(false); return show("sError"); }
  if (!S.db) return show("sLoading");
  if (!S.gid){ inGroup(false); renderHome(); return show("sHome"); }
  if (!S.groupLoaded) return show("sLoading");
  if (!S.group){
    $("errMsg").textContent = "このボードは見つかりませんでした。削除されたか、リンクが間違っている可能性があります。";
    if (ls.get("last", null) === S.gid) ls.set("last", null);
    forgetGroup(S.gid);
    $("errHome").hidden = false; inGroup(false); return show("sError");
  }
  $("grpName").textContent = S.group.name;
  if (!S.membersLoaded || !S.linkLoaded) return show("sLoading");
  S.me = S.members[S.uid] ? S.uid : (S.linkMid && S.members[S.linkMid] ? S.linkMid : null);
  if (!S.me){ if (boardUnsubs.length) stopBoardSubs(); inGroup(false); renderJoin(); return show("sJoin"); }
  if (!boardUnsubs.length && S.deniedFor !== S.me) subscribeBoard();
  inGroup(true);
  rememberGroup(S.gid, S.group.name);
  renderMain(); renderSheets();
  show("sMain");
}

let homeOpen;          // undefined until the first render decides; then null | "create" | "paste"
function setHomeOpen(which){
  homeOpen = which;
  $("createForm").hidden = which !== "create";
  $("pasteForm").hidden = which !== "paste";
  [["openCreate","create"],["openPaste","paste"]].forEach(([id, w]) => {
    $(id).classList.toggle("on", which === w); $(id).setAttribute("aria-expanded", String(which === w));
  });
}
function renderHome(){
  const first = !S.myGroups.length;
  $("homeSteps").hidden = !first;
  if (homeOpen === undefined) setHomeOpen(first ? "create" : null);
  $("myGroups").replaceChildren(...S.myGroups.map(g => h("li", null,
    h("button", { onclick: () => go(g.id) }, h("span", {text:g.name || "ボード"}), h("span", {class:"muted", text:"開く ›"})))));
  $("myGroupsCard").hidden = !S.myGroups.length;
  if (!$("cMe").value) $("cMe").value = ls.get("name", "");
  renderCreateButtons();
  $("cSubmit").disabled = S.canWrite === false;
}
let claimSel = null;
function renderJoin(){
  $("joinGroupName").textContent = S.group.name;
  const cid = S.group.createdBy, creator = cid && S.members[cid];
  $("joinBy").hidden = !creator;
  if (creator) $("joinBy").replaceChildren(h("span", { class:"lbl", text:"作った人" }), avatar(cid, creator.name), h("span", { text:creator.name }));
  const ids = Object.keys(S.members).sort((a, b) => S.members[a].joinedAt - S.members[b].joinedAt), n = ids.length;
  if (claimSel && !S.members[claimSel]) claimSel = null;
  $("claimCard").hidden = !n;
  $("claimChips").replaceChildren(...ids.map(id => h("button", { type:"button", class:"chip with-av" + (claimSel === id ? " on" : ""), "aria-pressed":String(claimSel === id),
    onclick:() => { claimSel = claimSel === id ? null : id; $("claimPin").value = ""; renderJoin(); } }, avatar(id, S.members[id].name), S.members[id].name, S.members[id].hasPin ? " 🔒" : "")));
  $("claimPinRow").hidden = !(claimSel && S.members[claimSel].hasPin);
  $("claimBtn").hidden = !claimSel;
  if (claimSel) $("claimBtn").textContent = `${S.members[claimSel].name}として入る`;
  $("jLabel").textContent = n ? "はじめての人は名前を入れて参加" : "あなたの名前(みんなに表示されます)";
  $("joinCount").textContent = n ? `${n}人が参加中` : "";
  if (document.activeElement !== $("jName") && !$("jName").value) $("jName").value = ls.get("name", "");
  $("jSubmit").disabled = S.canWrite === false;
}

// ---------- main ----------
function renderMain(){
  const ro = S.canWrite === false;
  $("roNotice").hidden = !ro;

  // buttons, each with when it was last pressed and by whom
  // tiles are kept and updated in place, so a tap's bounce isn't cut off by the redraw right after it
  const grid = $("btnGrid");
  grid.classList.toggle("ro", ro);
  const old = {};
  grid.querySelectorAll(".kb").forEach(el => { old[el.dataset.bid] = el; });
  // a repeating button shows this period's state: "✓ 今月OK・10/3 ママ" (green) or "今月まだ" (dashed)
  const tiles = S.buttons.map(b => {
    const last = S.latest[b.id];
    const done = doneThisPeriod(b), due = !!b.every && !done;
    const el = old[b.id] || h("button", { type:"button", class:"kb", "data-bid":b.id },
      h("span", { class:"kb-e", "aria-hidden":"true" }), h("span", { class:"kb-t" }), h("span", { class:"kb-l" }), h("span", { class:"kb-every" }));
    // plain buttons just show emoji + text (who pressed when is on the board);
    // repeating ones also show this period's state: ✓ 今月OK (green) / 今月まだ (dashed)
    el.classList.toggle("today", done);
    el.classList.toggle("due", due);
    el.disabled = ro;
    const lastText = last ? `${whenText(last.at)}・${nameOf(last.by)}` : "まだなし";
    const state = !b.every ? "" : `${EVERY[b.every].now}${done ? "OK" : "まだ"}`;
    el.setAttribute("aria-label", `${b.text}と書く` + (b.every ? `(${EVERY[b.every].label}・${state})` : ""));
    el.title = last ? `前回:${lastText}` : "";
    const [e, t, l, ev] = el.children;
    e.textContent = b.emoji || "・"; t.textContent = b.text; l.textContent = state; l.hidden = !state;
    ev.textContent = b.every ? EVERY[b.every].label : ""; ev.hidden = !b.every;
    return el;
  });
  // the repeating ones, summed up: what hasn't come yet this period
  const reps = S.buttons.filter(b => b.every), pending = reps.filter(b => !doneThisPeriod(b));
  $("dueLine").hidden = !reps.length;
  $("dueLine").classList.toggle("ok", !pending.length);
  $("dueLine").replaceChildren(...(pending.length
    ? [h("span", { class:"dl-h", text:"まだの連絡" }), ...pending.map(b => h("span", { class:"dl-i" }, `${EVERY[b.every].now} ${b.emoji} ${b.text}`))]
    : [h("span", { class:"dl-h", text:"✓ 定期の連絡はぜんぶOK" }), h("span", { class:"dl-i muted", text:reps.map(b => b.emoji || b.text).join(" ") })]));
  if (!tiles.length) tiles.push(h("p", { class:"hint empty-kb", text:"ボタンがありません。「✎ ボタンを編集」から追加できます" }));
  const cur = [...grid.children];
  if (cur.length !== tiles.length || cur.some((n, i) => n !== tiles[i])) grid.replaceChildren(...tiles);

  $("postInput").disabled = ro;
  updateComposer();

  // members in the board header
  const ids = Object.keys(S.members).sort((a, b) => S.members[a].joinedAt - S.members[b].joinedAt);
  $("boardInfo").replaceChildren(h("span", { class:"avs", title:ids.map(nameOf).join("・") }, ids.slice(0, 6).map(id => avatar(id, nameOf(id), "xs"))), `${ids.length}人`);

  renderFilter();
  renderPosts();
}

function renderFilter(){
  const box = $("filterChips");
  const opts = [[null, "すべて"], ...S.buttons.map(b => [b.id, b.emoji || b.text, b.text]), ["", "💬", "ひとこと"]];
  box.hidden = !S.buttons.length;
  box.replaceChildren(...opts.map(([v, label, title]) => h("button", { type:"button", role:"tab", class:"fchip" + (S.filter === v ? " on" : ""),
    "aria-selected":String(S.filter === v), title: title || null, "aria-label": title || null, onclick:() => setFilter(v) }, label)));
}
// the posts on screen: the latest page, or everything for one button
function shownPosts(){
  if (S.filter == null) return S.posts;
  const byId = {};
  (S.filterPosts || []).forEach(p => { byId[p.id] = p; });
  S.posts.forEach(p => { if (p.bid === S.filter) byId[p.id] = p; });
  return Object.values(byId).sort((a, b) => b.at - a.at);
}
let delArmed = null, delTimer = null;
// the board scrolls inside its card, newest on top. Reading further down stays put when new posts arrive;
// "▲ 新しい書き込み 2件" then appears and takes you back up.
let jumpTop = false, topAt = 0;
const scrolledDown = () => $("postScroll").scrollTop > 40;
// from far down, jump most of the way first so the glide stays short
function scrollToNewest(smooth){
  const box = $("postScroll");
  if (smooth && box.scrollTop > 400) box.scrollTop = 400;
  box.scrollTo({ top:0, behavior: smooth ? "smooth" : "auto" });
}
function renderPosts(){
  const box = $("postScroll"), list = $("postList"), posts = shownPosts();
  const loading = S.filter == null ? !S.postsReady : S.filterPosts == null;
  const label = S.filter == null ? "" : S.filter === "" ? "ひとこと" : ((S.buttons.find(b => b.id === S.filter) || {}).text || "");
  $("boardTitle").textContent = label ? `「${label}」の記録` : "ボード";
  const done = msg => { list.replaceChildren(h("li", { class:"empty muted", text:msg })); ["moreBtn","endCap","newestCap","toNewest"].forEach(id => $(id).hidden = true); };
  if (loading) return done("読み込み中…");
  if (!posts.length) return done(S.filter == null ? "まだ書き込みはありません。ボタンを押すか、ひとこと書いてみよう" : "まだありません");

  // remember which post is at the top of the view, to keep it there after the redraw
  let anchor = null;
  if (!jumpTop && scrolledDown()){
    for (const el of list.querySelectorAll(".post[data-id]")){
      if (el.offsetTop + el.offsetHeight > box.scrollTop){ anchor = { id:el.dataset.id, off:el.offsetTop - box.scrollTop }; break; }
    }
  }
  const items = [];
  let lastDay = "";
  posts.forEach(p => {
    const d = dayKey(p.at);
    if (d !== lastDay){ items.push(h("li", { class:"day-sep" }, h("span", { text:dayHead(p.at) }))); lastDay = d; }
    items.push(postItem(p));
  });
  list.replaceChildren(...items);
  const more = S.filter == null && S.hasMore;
  $("moreBtn").hidden = !more;
  $("endCap").hidden = more || posts.length < 4;
  $("newestCap").hidden = false;
  // at once, not gliding: another redraw right after (the button's "last pressed") would keep the half-way position
  if (jumpTop){ jumpTop = false; scrollToNewest(false); }
  else if (anchor){
    const el = list.querySelector(`.post[data-id="${anchor.id}"]`);
    if (el) box.scrollTop = el.offsetTop - anchor.off;
  }
  updateToNewest();
}
function updateToNewest(){
  const posts = shownPosts(), newest = posts.length ? posts[0].at : 0;
  if (!scrolledDown()){ topAt = newest; $("toNewest").hidden = true; return; }
  const n = posts.filter(p => p.at > topAt && p.by !== S.me).length;
  $("toNewest").hidden = false;
  $("toNewest").classList.toggle("fresh", n > 0);
  $("toNewest").textContent = n ? `▲ 新しい書き込み ${n}件` : "▲ 最新へ";
}
$("postScroll").addEventListener("scroll", () => { if (S.me) updateToNewest(); }, { passive:true });
$("toNewest").addEventListener("click", () => scrollToNewest(true));
function postItem(p){
  const mine = p.by === S.me, stamp = !!p.bid || !!p.emoji, fresh = isNew(p);
  const armed = delArmed === p.id;
  // reactions: only on other people's posts, shown as a small badge on the bottom-right corner
  const canReact = !mine && S.canWrite !== false;
  const reactBtn = canReact ? h("button", { type:"button", class:"react-btn", "aria-label":"反応する", title:"反応する",
    onclick:e => openReactPicker(p, e.currentTarget) }, h("span", { "aria-hidden":"true", text:"😊" }), "+") : null;
  const badge = reactBadge(p, canReact);
  return h("li", { class:"post" + (stamp ? " stamp" : "") + (mine ? " mine" : "") + (fresh ? " new" : "") + (badge ? " reacted" : ""), "data-id":p.id },
    avatar(p.by, nameOf(p.by)),
    h("div", { class:"p-body" },
      h("div", { class:"p-head" },
        h("b", { text:nameOf(p.by) }),
        h("time", { datetime:new Date(p.at).toISOString(), title:new Date(p.at).toLocaleString("ja-JP"), text:clock(p.at) }),
        fresh ? h("span", { class:"new-tag", text:"NEW" }) : null,
        mine && S.canWrite !== false ? h("button", { type:"button", class:"p-del" + (armed ? " armed" : ""), "aria-label": armed ? "もう一度押すと取り消します" : "この書き込みを取り消す", onclick:() => deletePost(p) }, armed ? "取り消す?" : "取り消す") : null,
        reactBtn),
      stamp ? h("div", { class:"p-stamp" }, p.emoji ? h("span", { class:"e", "aria-hidden":"true", text:p.emoji }) : null, h("span", { text:p.text }))
            : h("p", { class:"p-text" }, linkify(p.text))),
    badge);
}
// "👍2 ❤️" — grouped by emoji, mine highlighted; who reacted is in the title (and in a toast on tap)
function reactBadge(p, canReact){
  const ids = Object.keys(p.re || {}).filter(id => S.members[id]);
  if (!ids.length) return null;
  const by = {};
  ids.forEach(id => (by[p.re[id]] = by[p.re[id]] || []).push(id));
  const who = REACTIONS.filter(e => by[e]).map(e => `${e} ${by[e].map(nameOf).join("・")}`).join("  ");
  return h("button", { type:"button", class:"react-badge", title:who, "aria-label":"反応:" + who,
      onclick:e => canReact ? openReactPicker(p, e.currentTarget) : toast(who) },
    REACTIONS.filter(e => by[e]).map(e => h("span", { class:"rb" + (by[e].includes(S.me) ? " mine" : "") },
      h("span", { class:"rb-e", text:e }), by[e].length > 1 ? h("b", { text:by[e].length }) : null)));
}
// web addresses become links; everything else stays plain text
function linkify(text){
  const out = [], re = /https?:\/\/[^\s<>"'「」()()]+/g;
  let i = 0, m;
  while ((m = re.exec(text))){
    if (m.index > i) out.push(text.slice(i, m.index));
    out.push(h("a", { href:m[0], target:"_blank", rel:"noopener noreferrer", text:m[0] }));
    i = m.index + m[0].length;
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
}

// ---------- sheets ----------
function renderSheets(){
  if (!S.group || !S.membersLoaded || !isOpen("shSet")) return;
  const me = S.members[S.me];
  if (!me) return;
  const iCreated = !!S.group.createdBy && S.group.createdBy === S.me, creator = isCreatorHere();

  $("profileHead").replaceChildren(
    avatar(S.me, me.name),
    h("div", { class:"pf-text" },
      h("div", { class:"pf-name", text:me.name }),
      h("div", { class:"pf-sub" },
        h("span", { text:`「${S.group.name}」でのあなた` }),
        h("span", { class:"lock", text: me.hasPin ? "🔒 合言葉あり" : "合言葉なし" }))));
  if (document.activeElement !== $("rName") && !$("rName").dataset.dirty) $("rName").value = me.name;
  renderColorPick();
  $("pinClear").hidden = !me.hasPin || iCreated;
  $("pinHint").classList.toggle("warn", iCreated && !me.hasPin);
  $("pinHint").textContent = iCreated
    ? (me.hasPin ? "ボードを作った人は合言葉が必要です。機種変更やブラウザが変わったときに、作った本人だと確かめるために使います。"
                 : "ボードを作った人は、合言葉を設定してください。機種変更やブラウザが変わったときに、作った本人だと確かめるために使います。")
    : me.hasPin ? "合言葉を設定済みです。別のスマホやブラウザから自分として入るときに必要です。"
    : "設定すると、別のスマホやブラウザから自分として入るときに合言葉が必要になります。ほかの人があなたになりすますのを防げます。";

  renderBtnEditor();
  if (document.activeElement !== $("gNameInput") && !$("gNameInput").dataset.dirty) $("gNameInput").value = S.group.name;
  const linkedCreator = !creator && iCreated;
  $("creatorNote").hidden = !linkedCreator;
  if (linkedCreator){
    $("creatorNoteText").textContent = me.hasPin
      ? "この端末でメンバーを外したりボードを削除したりするには、合言葉を入れてください。"
      : "メンバーを外す・ボードを削除する操作は、ボードを作った端末からだけできます。作った端末で合言葉を設定すると、別の端末でも合言葉で管理できるようになります。";
    $("creatorVerifyForm").hidden = !me.hasPin;
  }

  $("leaveBtn").hidden = iCreated;
  $("leaveHint").textContent = iCreated
    ? "ボードを作った人は抜けられません。使わなくなったら、「管理」タブからボードを削除してください。"
    : "あなたの名前と書き込みがこのボードから消えます。招待リンクから、また参加できます。";

  $("manageTab").hidden = !creator;
  $("dangerSec").hidden = !creator;
  if (!creator && setTab === "manage") showSetTab("me");
  if (creator) renderMemManage();
}
function renderColorPick(){
  const mid = S.me, m = S.members[mid]; if (!m) return;
  const cur = colorIndex(mid), ch = [...(m.name || "?")][0];
  $("colorPick").replaceChildren(...AV_ORDER.map(i => h("button", { type:"button", class:"swatch" + (i === cur ? " on" : ""),
    style:avStyle(i), role:"radio", "aria-checked":String(i === cur), "aria-label": AV_NAMES[i] || `色${i + 1}`,
    onclick:() => saveColor(i) }, ch)));
}

// button editor: tap a row to change it, ↑ to move it up, 消す (twice) to remove it
let beEdit = null, beEvery = "", beRmArmed = null, beRmTimer = null;
function renderBtnEditor(){
  const ro = S.canWrite === false;
  if (beEdit && !S.buttons.some(b => b.id === beEdit)) beEdit = null;
  $("beList").replaceChildren(...S.buttons.map((b, i) => h("li", { class: beEdit === b.id ? "on" : "" },
    h("button", { type:"button", class:"be-main", onclick:() => startBtnEdit(b) },
      h("span", { class:"e", "aria-hidden":"true", text:b.emoji || "・" }), h("span", { class:"t", text:b.text }),
      b.every ? h("span", { class:"be-every", text:EVERY[b.every].label }) : null, h("span", { class:"pen", text:"✎" })),
    h("button", { type:"button", class:"be-up", "aria-label":`${b.text}を上へ`, disabled: i === 0 || ro, onclick:() => moveBtn(i) }, "↑"),
    h("button", { type:"button", class:"be-rm" + (beRmArmed === b.id ? " armed" : ""), disabled:ro, onclick:() => removeBtn(b) }, beRmArmed === b.id ? "本当に消す" : "消す"))));
  const cur = $("beEmoji").value.trim();
  $("beEmojis").replaceChildren(...EMOJIS.map(e => h("button", { type:"button", role:"radio", class:"em" + (cur === e ? " on" : ""), "aria-checked":String(cur === e),
    onclick:() => { $("beEmoji").value = e; renderBtnEditor(); } }, e)));
  // one switch; 毎日・毎週・毎月 shows only when it's on
  $("beRepeatSw").checked = !!beEvery;
  $("beEvery").hidden = $("beEveryHint").hidden = !beEvery;
  $("beEvery").querySelectorAll("button").forEach(x => { const on = x.dataset.v === beEvery; x.classList.toggle("on", on); x.setAttribute("aria-checked", String(on)); });
  if (beEvery) $("beEveryHint").textContent = `ボタンに「✓ ${EVERY[beEvery].now}OK」「${EVERY[beEvery].now}まだ」が出ます` + (beEvery === "week" ? "(月曜はじまり)" : "");
  const editing = beEdit && S.buttons.find(b => b.id === beEdit);
  $("beFormTitle").textContent = editing ? `「${editing.emoji} ${editing.text}」を変える` : "ボタンを追加";
  $("beSave").textContent = beEdit ? "保存" : "追加";
  $("beCancel").hidden = !beEdit;
  const full = !beEdit && S.buttons.length >= MAX_BUTTONS;
  $("beSave").disabled = full || ro;
  $("beHint").textContent = full ? `ボタンは${MAX_BUTTONS}個までです。使わないボタンを消すと追加できます。` : "ボタンを消したり変えたりしても、これまでの書き込みはそのまま残ります。";
}
