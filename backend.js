// 고양이별 백엔드 연결 (Supabase)
// 페이지 코드는 원래 claude.ai 아티팩트용으로 만들어져 window.claude.use("db" | "room" | "user" | "assets" | "sample")를 부릅니다.
// 이 파일은 같은 모양의 기능을 Supabase로 만들어 끼워 넣습니다.
//   - 로그인: 익명 로그인 (링크만 있으면 누구나 입장)
//   - db: public.docs 테이블 + Realtime 변경 알림
//   - room: Realtime 채널의 presence(위치, 말풍선)와 broadcast(선물)
//   - assets: Storage 'photos' 버킷
//   - 편지: Edge Function 'cat-letter' (선택)
(function () {
  "use strict";
  window.GOBYEOL_STANDALONE = true;
  const cfg = window.GOBYEOL_CONFIG || {};
  if (!window.supabase || !cfg.supabaseUrl || /YOUR-/.test(cfg.supabaseUrl + cfg.supabaseAnonKey)) {
    console.warn("[고양이별] config.js에 Supabase 주소와 키가 없어서 체험 모드로 열었어요. 기록은 이 브라우저에만 저장돼요.");
    demoMode();
    return;
  }
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
    realtime: { params: { eventsPerSecond: 20 } }
  });

  // ---------- sign-in ----------
  let uid = null;
  const ready = (async () => {
    let { data } = await sb.auth.getSession();
    let session = data && data.session;
    if (!session) {
      const r = await sb.auth.signInAnonymously();
      if (r.error) throw r.error;
      session = r.data.session;
    }
    uid = session.user.id;
    return uid;
  })();
  let adminCache = null;
  async function isAdmin() {
    if (adminCache !== null) return adminCache;
    await ready;
    const { data } = await sb.from("admins").select("user_id").eq("user_id", uid).maybeSingle();
    adminCache = !!data;
    return adminCache;
  }

  // ---------- db ----------
  const freeze = (o) => Object.freeze(o);
  const mkDoc = (id, data, pending) =>
    freeze({ id, exists: data !== undefined && data !== null, data: () => (data == null ? undefined : data), metadata: { fromCache: false, hasPendingWrites: !!pending } });
  const dbErr = (e) => {
    const m = (e && e.message) || "";
    if (/row-level security|permission|not allowed|violates/i.test(m) || (e && e.code === "42501")) return { code: "invalid_argument", message: m };
    if (/quota|limit/i.test(m)) return { code: "quota_exceeded", message: m };
    return { code: "unavailable", message: m };
  };
  // one realtime subscription for the docs table; listeners refetch what they watch
  const watchers = new Set();
  let docsChannel = null;
  function ensureDocsChannel() {
    if (docsChannel) return;
    docsChannel = sb
      .channel("docs-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "docs" }, (payload) => {
        const col = (payload.new && payload.new.col) || (payload.old && payload.old.col);
        const id = (payload.new && payload.new.id) || (payload.old && payload.old.id);
        watchers.forEach((w) => w(col, id));
      })
      .subscribe();
  }
  function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

  function docRef(col, id) {
    return {
      id, path: col + "/" + id,
      async get() {
        await ready;
        const { data, error } = await sb.from("docs").select("data").eq("col", col).eq("id", id).maybeSingle();
        if (error) throw dbErr(error);
        return mkDoc(id, data ? data.data : undefined);
      },
      async set(body) {
        await ready;
        const { error } = await sb.from("docs").upsert({ col, id, data: body, owner: uid, updated_at: new Date().toISOString() });
        if (error) throw dbErr(error);
      },
      async update(body) {
        const cur = await this.get();
        if (!cur.exists) throw { code: "invalid_argument", message: "document does not exist" };
        const merge = (a, b) => { const o = Object.assign({}, a); for (const k in b) o[k] = b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a && typeof a[k] === "object" ? merge(a[k], b[k]) : b[k]; return o; };
        await this.set(merge(cur.data(), body));
      },
      async delete() {
        await ready;
        const { error } = await sb.from("docs").delete().eq("col", col).eq("id", id);
        if (error) throw dbErr(error);
      },
      onSnapshot(next, onErr) {
        let live = true;
        const load = async () => { try { const d = await this.get(); if (live) next(d); } catch (e) { if (live && onErr) onErr(e); } };
        const reload = debounce(load, 150);
        const w = (c, i) => { if (c === col && i === id) reload(); };
        ensureDocsChannel(); watchers.add(w); load();
        return () => { live = false; watchers.delete(w); };
      }
    };
  }
  function colRef(col) {
    return {
      path: col,
      doc: (id) => docRef(col, id || crypto.randomUUID()),
      async get() {
        await ready;
        const { data, error } = await sb.from("docs").select("id,data").eq("col", col).limit(1000);
        if (error) throw dbErr(error);
        const docs = (data || []).map((r) => mkDoc(r.id, r.data));
        return freeze({ docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } });
      },
      onSnapshot(next, onErr) {
        let live = true;
        const load = async () => { try { const q = await this.get(); if (live) next(q); } catch (e) { if (live && onErr) onErr(e); } };
        const reload = debounce(load, 200);
        const w = (c) => { if (c === col) reload(); };
        ensureDocsChannel(); watchers.add(w); load();
        return () => { live = false; watchers.delete(w); };
      }
    };
  }
  const db = { doc: (path) => { const [c, i] = path.split("/"); return docRef(c, i); }, collection: (path) => colRef(path) };

  // ---------- user ----------
  const user = {
    id: async () => { await ready; return uid; },
    me: async () => { await ready; const a = await isAdmin(); return { id: uid, name: "", avatarUrl: "", color: "#b8692a", email: null, isOwner: a, canEdit: a }; },
    isOwner: isAdmin,
    canEdit: isAdmin,
    can: async (name) => (name === "data.write" ? true : name === "assets.write" ? await isAdmin() : false),
    profiles: async (ids) => { await ready; const out = {}; [].concat(ids).forEach((i) => { out[i] = { id: i, name: "", avatarUrl: "", color: "#8a8f86", email: null, isMe: i === uid, guest: false }; }); return out; },
    name: async () => "", email: async () => null, avatarUrl: async () => null, search: async () => []
  };

  // ---------- room ----------
  // Supabase free plan allows only ~20 presence updates a second for the whole project (and few keys per presence),
  // so presence only says "who is here" (rarely changes), while positions and moods travel as broadcasts
  // (~100 a second on the free plan). Each tab sends its state at most about twice a second, only when it changed; the page smooths movement in between.
  const peerId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random())).replace(/[^a-z0-9]/gi, "").slice(0, 16);
  let channel = null, connected = false, myState = {}, peerList = Object.freeze([]);
  const peerCbs = new Set(), connCbs = new Set(), topicCbs = {}, liveState = new Map();
  const SLOW = ["in", "nick", "zone", "park", "ps"];
  let lastSlow = "", slowTimer = null, stTimer = null, lastSt = 0, lastStJson = "";
  function rebuildPeers() {
    const st = channel ? channel.presenceState() : {};
    const list = [];
    for (const key in st) {
      const arr = st[key]; const p = arr && arr[arr.length - 1]; if (!p) continue;
      let slow = {}; try { slow = JSON.parse(p.s || "{}"); } catch (_) {}
      const fast = key === peerId ? myState : liveState.get(key) || {};
      list.push(freeze({ peer: key, by: p.b || null, isMe: key === peerId, sameTab: key === peerId, kind: "viewer", guest: false, presence: freeze(Object.assign({}, fast, slow)), updatedAt: Date.now() }));
    }
    for (const k of liveState.keys()) if (!st[k]) liveState.delete(k);
    peerList = Object.freeze(list);
    const change = { peers: peerList, joined: [], left: [], updated: [] };
    peerCbs.forEach((fn) => { try { fn(change); } catch (e) { console.error(e); } });
  }
  const rebuildSoon = (() => { let t = null; return () => { if (!t) t = setTimeout(() => { t = null; rebuildPeers(); }, 60); }; })();
  function pushSlow() {
    const slow = {}; SLOW.forEach((k) => { if (myState[k] !== undefined) slow[k] = myState[k]; });
    const js = JSON.stringify(slow); if (js === lastSlow) return;
    clearTimeout(slowTimer);
    slowTimer = setTimeout(() => { if (channel && connected) { lastSlow = js; channel.track({ s: js, b: uid }); } }, 600);
  }
  function pushState(force) {
    clearTimeout(stTimer);
    const wait = force ? 0 : Math.max(0, 450 - (Date.now() - lastSt));
    stTimer = setTimeout(() => {
      if (!channel || !connected) return;
      const js = JSON.stringify(myState); if (!force && js === lastStJson) return;
      lastSt = Date.now(); lastStJson = js;
      channel.send({ type: "broadcast", event: "_st", payload: { peer: peerId, s: myState } });
    }, wait);
  }
  async function openRoom() {
    await ready;
    channel = sb.channel("gobyeol-room", { config: { presence: { key: peerId }, broadcast: { self: false } } });
    channel.on("presence", { event: "sync" }, rebuildSoon);
    // someone new arrived: tell them where everyone is
    channel.on("presence", { event: "join" }, ({ key }) => { if (key !== peerId) setTimeout(() => pushState(true), 200 + Math.random() * 600); });
    channel.on("broadcast", { event: "_st" }, (msg) => { const pl = msg.payload || {}; if (!pl.peer || pl.peer === peerId || typeof pl.s !== "object") return; liveState.set(pl.peer, pl.s); rebuildSoon(); });
    channel.on("broadcast", { event: "*" }, (msg) => {
      if (msg.event === "_st") return;
      const pl = msg.payload || {}; const cbs = topicCbs[msg.event]; if (!cbs) return;
      const m = freeze({ topic: msg.event, data: pl.data, peer: pl.peer, by: pl.by || null, isMe: pl.peer === peerId, sameTab: pl.peer === peerId, kind: "viewer", guest: false });
      cbs.forEach((fn) => { try { fn(m); } catch (e) { console.error(e); } });
    });
    channel.subscribe((status) => {
      const was = connected; connected = status === "SUBSCRIBED";
      if (connected) { lastSlow = ""; pushSlow(); pushState(true); }
      if (was !== connected) connCbs.forEach((fn) => fn(connected));
    });
  }
  const room = {
    presence: async (patch) => { for (const k in patch) { if (patch[k] === null) delete myState[k]; else myState[k] = patch[k]; } pushSlow(); pushState(false); rebuildSoon(); },
    peers: () => peerList,
    onPeers: (fn) => { peerCbs.add(fn); setTimeout(() => fn({ peers: peerList, joined: peerList, left: [], updated: [] })); return () => peerCbs.delete(fn); },
    // events come back to the sender too, as the page expects
    emit: async (topic, data) => {
      if (!channel || !connected) return;
      const payload = { data, peer: peerId, by: uid };
      await channel.send({ type: "broadcast", event: topic, payload });
      const cbs = topicCbs[topic]; if (cbs) { const m = freeze({ topic, data, peer: peerId, by: uid, isMe: true, sameTab: true, kind: "viewer", guest: false }); cbs.forEach((fn) => { try { fn(m); } catch (e) { console.error(e); } }); }
    },
    on: (topic, fn) => { (topicCbs[topic] = topicCbs[topic] || new Set()).add(fn); return () => topicCbs[topic].delete(fn); },
    connected: () => connected,
    onConnection: (fn) => { connCbs.add(fn); setTimeout(() => fn(connected)); return () => connCbs.delete(fn); },
    join: async () => { throw { code: "not_permitted", message: "named rooms are not used here" }; },
    canSendToClaudeSession: async () => "off"
  };

  // ---------- assets (photos) ----------
  const publicUrl = (id) => sb.storage.from("photos").getPublicUrl(id).data.publicUrl;
  window.blobUrlFor = publicUrl;
  const assets = {
    async upload(blob, opts) {
      await ready;
      if (blob.size > 10 * 1024 * 1024) throw { code: "too_large", message: "10MB 이하만 올릴 수 있어요" };
      const id = crypto.randomUUID().replace(/-/g, "");
      const type = (opts && opts.type) || blob.type || "image/jpeg";
      if (!/^image\/(png|jpeg|gif|webp)$/.test(type)) throw { code: "unsupported_type", message: type };
      const { error } = await sb.storage.from("photos").upload(id, blob, { contentType: type, upsert: false, cacheControl: "31536000" });
      if (error) throw { code: /size|large/i.test(error.message) ? "too_large" : /row-level|policy/i.test(error.message) ? "not_granted" : "upstream_error", message: error.message };
      return { id, url: publicUrl(id), sizeBytes: blob.size, contentType: type };
    },
    async delete(ref) { await ready; await sb.storage.from("photos").remove([String(ref).split("/").pop()]); return { deleted: true }; },
    async list() { return { assets: [], usage: { files: 0, bytes: 0, maxFiles: 0, maxBytes: 0 } }; }
  };

  // ---------- cat letters (optional Edge Function) ----------
  if (cfg.letterFunction) {
    window.catLetterFn = async (fields) => {
      await ready;
      const { data, error } = await sb.functions.invoke("cat-letter", { body: fields });
      if (error) throw error;
      return data && typeof data.text === "string" ? data.text : null;
    };
  }

  const roomReady = openRoom().catch((e) => { console.error("[고양이별] 실시간 연결 실패", e); return null; });
  window.claude = {
    use: async (name) => {
      try {
        await ready;
        if (name === "db") return db;
        if (name === "user") return user;
        if (name === "room") { await roomReady; return channel ? room : null; }
        if (name === "assets") return assets;
        return null; // sample: letters go through catLetterFn instead
      } catch (e) {
        console.error("[고양이별] 로그인 실패 — Supabase에서 익명 로그인을 켰는지 확인해 주세요.", e);
        return null;
      }
    }
  };

  // ---------- 체험 모드: Supabase를 연결하기 전에도 혼자 모든 기능을 써 볼 수 있게, 기록을 이 브라우저에 저장 ----------
  function demoMode() {
    const SEED = {"pets": {"hotteok": {"born": "2012-09-02", "breed": "", "coat": "삼색", "createdAt": 3, "kind": "고양이", "left": "2026-07-11", "letters": [{"d": "2026-08-29", "t": "호떡아, 오늘 장 보고 왔는데 봉지 소리에 자꾸 뒤를 돌아보게 돼."}], "name": "호떡", "story": "시장 골목에서 데려온 삼색이. 비닐봉지 소리만 나면 어디서든 달려왔어요.", "photo": null, "photos": []}, "kkami": {"born": "2010-05-05", "breed": "", "coat": "검은 고양이", "createdAt": 5, "kind": "고양이", "left": "2026-06-18", "letters": [{"d": "2026-08-06", "t": "까미야, 49일 동안 매일 불 켜 두었어. 이제 편히 쉬어."}], "name": "까미", "photo": null, "photos": [], "story": "밤이면 눈만 반짝이던 까만 고양이. 16년 동안 이불 발치를 지켜 줬어요."}, "moka": {"born": "2016-03-21", "breed": "러시안블루", "coat": "러시안블루", "createdAt": 2, "kind": "고양이", "left": "2026-10-27", "letters": [], "name": "모카", "story": "낯가림이 심했지만 한 번 마음을 열면 밤새 옆에서 골골거리던 아이.", "photo": null, "photos": []}, "nabi": {"born": "2014-06-10", "breed": "코리안숏헤어", "coat": "치즈", "createdAt": 1, "kind": "고양이", "left": "2026-10-05", "letters": [{"d": "2026-10-20", "t": "창가에 아직 네 털이 있어. 햇볕이 들면 반짝여."}], "name": "나비", "story": "창가 햇볕 자리를 지키던 치즈 고양이. 키보드 위에 누워 일을 못 하게 하는 게 특기였어요.", "photo": null, "photos": []}, "yangmal": {"born": "2018-01-15", "breed": "", "coat": "턱시도", "createdAt": 4, "kind": "고양이", "left": "2026-09-30", "letters": [], "name": "양말", "story": "네 발만 하얀 턱시도. 현관 신발장 위가 자기 자리라고 믿었어요.", "photo": null, "photos": []}}, "trib": {"ex~hotteok": {"flowers": {"국화": 5, "들꽃": 3, "해바라기": 2}, "fly": 26, "seeds": [], "water": 10}, "ex~kkami": {"flowers": {"국화": 6, "들꽃": 5, "해바라기": 3}, "fly": 40, "seeds": [], "water": 13}, "ex~moka": {"flowers": {"국화": 1, "들꽃": 0, "해바라기": 0}, "fly": 4, "seeds": [], "water": 1}, "ex~nabi": {"flowers": {"국화": 3, "들꽃": 4, "해바라기": 1}, "fly": 18, "seeds": [], "water": 7}, "ex~yangmal": {"flowers": {"국화": 2, "들꽃": 1, "해바라기": 1}, "fly": 11, "seeds": [], "water": 4}}};
    const LS = "gobyeol-demo:";
    const lsGet = (k) => { try { const v = localStorage.getItem(LS + k); return v ? JSON.parse(v) : null; } catch (_) { return null; } };
    const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(LS + k) : localStorage.setItem(LS + k, JSON.stringify(v)); return true; } catch (_) { return false; } };
    let uid = lsGet("uid"); if (!uid) { uid = "demo_" + Math.random().toString(36).slice(2, 12); lsSet("uid", uid); }
    const store = lsGet("docs") || { examples: { hall: SEED } };
    const save = () => { if (!lsSet("docs", store)) console.warn("[고양이별] 브라우저 저장 공간이 부족해요"); };
    const subs = new Set();
    const notify = () => setTimeout(() => subs.forEach((f) => { try { f(); } catch (e) { console.error(e); } }), 0);
    const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
    const mkD = (id, data) => Object.freeze({ id, exists: data != null, data: () => clone(data == null ? undefined : data), metadata: { fromCache: false, hasPendingWrites: false } });
    function docRef(col, id) {
      return {
        id, path: col + "/" + id,
        async get() { return mkD(id, store[col] && store[col][id]); },
        async set(body) { (store[col] = store[col] || {})[id] = clone(body); save(); notify(); },
        async update(body) { const cur = (store[col] || {})[id]; if (!cur) throw { code: "invalid_argument", message: "document does not exist" }; Object.assign(cur, clone(body)); save(); notify(); },
        async delete() { if (store[col]) delete store[col][id]; save(); notify(); },
        onSnapshot(next) { const f = () => next(mkD(id, store[col] && store[col][id])); subs.add(f); f(); return () => subs.delete(f); }
      };
    }
    function colRef(col) {
      const snap = () => { const docs = Object.entries(store[col] || {}).map(([i, d]) => mkD(i, d)); return Object.freeze({ docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } }); };
      return { path: col, doc: (id) => docRef(col, id || Math.random().toString(36).slice(2)), async get() { return snap(); }, onSnapshot(next) { const f = () => next(snap()); subs.add(f); f(); return () => subs.delete(f); } };
    }
    const db = { doc: (path) => { const [c, i] = path.split("/"); return docRef(c, i); }, collection: (path) => colRef(path) };
    // in 체험 모드 the visitor runs the place, so every keeper tool can be tried
    const user = {
      id: async () => uid, me: async () => ({ id: uid, name: "", avatarUrl: "", color: "#b8692a", email: null, isOwner: true, canEdit: true }),
      isOwner: async () => true, canEdit: async () => true, can: async (n) => n === "data.write" || n === "assets.write",
      profiles: async (ids) => { const o = {}; [].concat(ids).forEach((i) => { o[i] = { id: i, name: "", avatarUrl: "", color: "#8a8f86", email: null, isMe: i === uid, guest: false }; }); return o; },
      name: async () => "", email: async () => null, avatarUrl: async () => null, search: async () => []
    };
    // photos are kept as small data URLs in this browser
    const urls = {};
    window.blobUrlFor = (id) => urls[id] || lsGet("photo:" + id) || "";
    const assets = {
      async upload(blob, opts) {
        if (blob.size > 6 * 1024 * 1024) throw { code: "too_large", message: "체험 모드에서는 6MB 이하만 올릴 수 있어요" };
        const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
        urls[id] = url; if (!lsSet("photo:" + id, url)) console.warn("[고양이별] 사진이 커서 새로고침하면 사라져요");
        return { id, url, sizeBytes: blob.size, contentType: (opts && opts.type) || blob.type };
      },
      async delete(ref) { const id = String(ref).split("/").pop(); delete urls[id]; lsSet("photo:" + id, null); return { deleted: true }; },
      async list() { return { assets: [], usage: { files: 0, bytes: 0, maxFiles: 0, maxBytes: 0 } }; }
    };
    window.GOBYEOL_DEMO = true;
    window.claude = { use: async (name) => (name === "db" ? db : name === "user" ? user : name === "assets" ? assets : null) };
    // a small note so nobody mistakes this for the shared site
    const show = () => { const b = document.createElement("div"); b.textContent = "체험 모드 · 기록이 이 브라우저에만 저장돼요 (Supabase 연결 전)";
      b.style.cssText = "position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 66px);transform:translateX(-50%);z-index:50;font:12px system-ui,sans-serif;background:#2b2b2b;color:#fff;padding:4px 10px;border-radius:999px;opacity:.8;pointer-events:none;transition:opacity 1s;max-width:calc(100vw - 32px);text-align:center";
      document.body.appendChild(b); setTimeout(() => { b.style.opacity = "0"; }, 9000); };
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", show) : show();
  }
})();
