import { db } from "./firebase.js";
import { ref, get, set, remove } from "firebase/database";

/* ── engine URLs ──────────────────────────────────────────────────── */
export const CHESS_URL = "https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js";
// Fairy-Stockfish WASM (公開フォルダにホスト: public/shogi/)
export const SHOGI_URL = "/shogi/stockfish.js";

/* ── UCI/USI conversion ───────────────────────────────────────────── */
export function chessHistToUCI(history) {
  return history.map(h => {
    const ff = String.fromCharCode(97 + h.from[1]), fr = 8 - h.from[0];
    const tf = String.fromCharCode(97 + h.to[1]),   tr = 8 - h.to[0];
    let promo = "";
    if (h.notation && h.notation.includes("=")) promo = h.notation.split("=")[1][0].toLowerCase();
    return `${ff}${fr}${tf}${tr}${promo}`;
  });
}
export function shogiHistToUSI(history) {
  return history.map(h => {
    if (h.drop) return `${h.drop}*${9 - h.to[1]}${String.fromCharCode(97 + h.to[0])}`;
    const ff = 9 - h.from[1], fr = String.fromCharCode(97 + h.from[0]);
    const tf = 9 - h.to[1],   tr = String.fromCharCode(97 + h.to[0]);
    return `${ff}${fr}${tf}${tr}${h.promote ? "+" : ""}`;
  });
}

/* ── eval helpers ─────────────────────────────────────────────────── */
export function normalizeEval(rawScore, posIdx) {
  return posIdx % 2 === 0 ? rawScore : -rawScore;
}
export function getCPL(evalBefore, evalAfter, moveIdx) {
  return moveIdx % 2 === 0
    ? Math.max(0, evalBefore - evalAfter)
    : Math.max(0, evalAfter  - evalBefore);
}
export function winPct(evalCp) { return 100 / (1 + Math.exp(-0.004 * evalCp)); }
export function calcAccuracy(evalsList, playerIsFirst) {
  const losses = [];
  for (let i = 0; i < evalsList.length - 1; i++) {
    if ((i % 2 === 0) !== playerIsFirst) continue;
    const sign = playerIsFirst ? 1 : -1;
    losses.push(Math.max(0, winPct(sign * evalsList[i]) - winPct(sign * evalsList[i + 1])));
  }
  if (!losses.length) return 100;
  const avg = losses.reduce((a, b) => a + b, 0) / losses.length;
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * avg) - 3.1669));
}

/* ── classification ───────────────────────────────────────────────── */
export const CLASSIFY = [
  { max: 10,       ja: "最善手", en: "Best",       color: "#2ed", icon: "★★" },
  { max: 30,       ja: "好手",   en: "Excellent",  color: "#7e7", icon: "★"  },
  { max: 60,       ja: "良手",   en: "Good",       color: "#9b9", icon: "✔"  },
  { max: 100,      ja: "不正確", en: "Inaccuracy", color: "#cc0", icon: "?!" },
  { max: 200,      ja: "疑問手", en: "Mistake",    color: "#f90", icon: "?"  },
  { max: Infinity, ja: "悪手",   en: "Blunder",    color: "#f44", icon: "??" },
];
export const classify = (cpl) => CLASSIFY.find(c => cpl <= c.max) || CLASSIFY[CLASSIFY.length - 1];

/* ── EngineWorker ─────────────────────────────────────────────────── */
export class EngineWorker {
  constructor(url, proto) { this.url = url; this.proto = proto; this.w = null; }

  async init() {
    // SharedArrayBuffer が必要なエンジン（将棋）はCOOP/COEPヘッダーが必要
    if (this.proto === "usi" && typeof SharedArrayBuffer === "undefined") {
      throw new Error("SharedArrayBuffer unavailable — COOP/COEP headers required for shogi engine");
    }

    // 将棋エンジン（Fairy-Stockfish Emscripten + pthreads）
    // blob Worker 内で importScripts(絶対URL) する方式:
    //   → Emscripten の _scriptDir が "/shogi/" に正しく設定され、
    //     pthread サブワーカーも実URLで stockfish.js を読み込めるようになる
    if (this.proto === "usi") {
      const engineAbsUrl = new URL(this.url, location.href).href;
      const wasmBase = engineAbsUrl.replace(/[^/]+$/, "");
      const wrapper = `importScripts(${JSON.stringify(engineAbsUrl)});
;(function(){
  var __sfInit = Stockfish;
  __sfInit({
    locateFile: function(f){ return ${JSON.stringify(wasmBase)}+f; },
    mainScriptUrlOrBlob: ${JSON.stringify(engineAbsUrl)}
  }).then(function(sf){
    sf.addMessageListener(function(msg){ if(typeof msg==="string") self.postMessage(msg); });
    self.onmessage = function(e){ if(typeof e.data==="string") sf.postMessage(e.data); };
    sf.postMessage("usi");
  }).catch(function(e){ self.postMessage("error:"+e.message); });
})();`;
      try {
        const blob = new Blob([wrapper], { type: "application/javascript" });
        const blobUrl = URL.createObjectURL(blob);
        this.w = new Worker(blobUrl);
        URL.revokeObjectURL(blobUrl);
      } catch (e) { throw e; }
    } else {
      // チェス：単体ファイル Worker（fetch-then-blob）
      let code;
      try {
        const resp = await fetch(this.url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        code = await resp.text();
      } catch (fetchErr) {
        throw new Error(`Engine load failed: ${fetchErr.message}`);
      }
      try {
        const blob = new Blob([code], { type: "application/javascript" });
        const blobUrl = URL.createObjectURL(blob);
        this.w = new Worker(blobUrl);
        URL.revokeObjectURL(blobUrl);
      } catch (e) { throw e; }
    }

    return new Promise((resolve, reject) => {
      // 将棋WASMロードは大きいので余裕を持たせる
      const timeoutMs = this.proto === "usi" ? 60000 : 20000;
      const t = setTimeout(() => reject(new Error("init timeout")), timeoutMs);
      this.w.onerror = (e) => { clearTimeout(t); e.preventDefault?.(); reject(e); };
      const onOk = (e) => {
        if (typeof e.data !== "string") return;
        if (e.data.startsWith("error:")) {
          clearTimeout(t);
          this.w.removeEventListener("message", onOk);
          reject(new Error(e.data));
          return;
        }
        if (!e.data.includes(this.proto + "ok")) return;
        this.w.removeEventListener("message", onOk);
        if (this.proto === "usi") this.w.postMessage("setoption name UCI_Variant value shogi");
        this.w.postMessage("isready");
        const onReady = (e2) => {
          if (typeof e2.data === "string" && e2.data.includes("readyok")) {
            this.w.removeEventListener("message", onReady);
            clearTimeout(t);
            resolve();
          }
        };
        this.w.addEventListener("message", onReady);
      };
      this.w.addEventListener("message", onOk);
      // 将棋は wrapper 内で usi を先に送るのでここでは chess のみ送信
      if (this.proto !== "usi") this.w.postMessage(this.proto);
    });
  }

  analyze(moves, depth) {
    return new Promise((resolve) => {
      if (!this.w) { resolve({ score: 0, bestMove: null }); return; }
      let score = 0, bestMove = null;
      const t = setTimeout(() => {
        this.w.removeEventListener("message", h);
        resolve({ score, bestMove });
      }, 25000);
      const h = (e) => {
        if (typeof e.data !== "string") return;
        const m = e.data.match(/score (cp|mate) (-?\d+)/);
        if (m) score = m[1] === "cp" ? parseInt(m[2]) : (parseInt(m[2]) > 0 ? 10000 : -10000);
        if (e.data.startsWith("bestmove")) {
          clearTimeout(t);
          this.w.removeEventListener("message", h);
          const p = e.data.split(" ");
          bestMove = (p[1] && p[1] !== "none") ? p[1] : null;
          resolve({ score, bestMove });
        }
      };
      this.w.addEventListener("message", h);
      const pos = moves.length ? `position startpos moves ${moves.join(" ")}` : "position startpos";
      this.w.postMessage(pos);
      this.w.postMessage(`go depth ${depth}`);
    });
  }

  terminate() {
    if (this.w) { try { this.w.postMessage("quit"); } catch {} try { this.w.terminate(); } catch {} this.w = null; }
  }
}

/* ── Firebase helpers ─────────────────────────────────────────────── */
export const MAX_ANALYSES_PER_USER = 10;
export const FB_PATH = (userName, fbKey) => `analyses/${userName}/${fbKey}`;
export const FB_DELETED_PATH = (userName, fbKey) => `deletedAnalyses/${userName}/${fbKey}`;

/**
 * ゲームセッションごとに一意な Firebase キーを生成する。
 * 形式: "g1_2026-05-24T11-33-39-462Z"（スロットID + sanitize済みstartedAt）
 *
 * game.fbKey が設定済みの場合はそれを優先（AnalysisListから開いた既存解析）。
 * startedAt がない場合はスロットID単体にフォールバック（レガシー互換）。
 */
export const FB_GAME_KEY = (game) => {
  if (!game) return '';
  if (game.fbKey) return game.fbKey;                      // 既存解析を開いた場合
  const ts = (game.startedAt || '').replace(/[:.]/g, '-'); // ':' と '.' を '-' に置換
  return ts ? `${game.id}_${ts}` : game.id;               // e.g. "g1_2026-05-24T11-33-39-462Z"
};

// Mark a game analysis as deleted in Firebase (persists across devices).
export async function fbMarkDeleted(playerName, fbKey) {
  try {
    await set(ref(db, FB_DELETED_PATH(playerName, fbKey)), true);
  } catch (e) { console.warn("fbMarkDeleted failed:", e); }
}

// Check if a game analysis is marked deleted in Firebase.
export async function fbIsDeleted(playerName, fbKey) {
  try {
    const snap = await get(ref(db, FB_DELETED_PATH(playerName, fbKey)));
    return snap.exists() && snap.val() === true;
  } catch { return false; }
}

// Enforce per-user cap: if at limit and fbKey is new, remove oldest unlocked entry.
// Returns true if there's room to save, false if all are locked (can't make room).
async function enforceUserCap(playerName, existingEntries, fbKey) {
  if (existingEntries.length < MAX_ANALYSES_PER_USER) return true;
  // fbKey already exists → overwrite, no cap issue
  if (existingEntries.some(([id]) => id === fbKey)) return true;
  const unlocked = existingEntries
    .filter(([, v]) => !v.locked)
    .sort((a, b) => (a[1].createdAt || "") < (b[1].createdAt || "") ? -1 : 1);
  if (unlocked.length === 0) {
    console.warn("enforceUserCap: all entries locked, cannot auto-delete");
    return false;
  }
  await remove(ref(db, `analyses/${playerName}/${unlocked[0][0]}`));
  return true;
}

/**
 * Firebase から解析データをロードする（自ユーザー優先、他ユーザーにフォールバック）。
 * game オブジェクトを受け取り、FB_GAME_KEY で一意キーを導出する。
 * 旧形式（スロットIDのみ）のキーにも対応（後方互換）。
 * Returns { data, path, fbKey } or null.
 */
export async function fbLoad(playerName, game, historyLength) {
  try {
    const uniqueKey = FB_GAME_KEY(game);
    const slotKey   = game.id; // レガシーキー（旧形式: "g1"）

    // ① 自ユーザーの一意キーを試みる
    const ownSnap = await get(ref(db, FB_PATH(playerName, uniqueKey)));
    if (ownSnap.exists()) {
      const d = ownSnap.val();
      if (d.evaluations && d.evaluations.length === historyLength + 1) {
        return { data: d, path: FB_PATH(playerName, uniqueKey), fbKey: uniqueKey };
      }
    }

    // ② 旧形式キー（後方互換: uniqueKey と slotKey が異なる場合のみ）
    // startedAt が両方揃っている場合はセッション一致も確認（新ゲームが同手数の場合の誤ヒット防止）
    if (uniqueKey !== slotKey) {
      const legacySnap = await get(ref(db, FB_PATH(playerName, slotKey)));
      if (legacySnap.exists()) {
        const d = legacySnap.val();
        const sessionMatch = !game.startedAt || !d.startedAt || d.startedAt === game.startedAt;
        if (sessionMatch && d.evaluations && d.evaluations.length === historyLength + 1) {
          return { data: d, path: FB_PATH(playerName, slotKey), fbKey: slotKey };
        }
      }
    }

    // ③ 他ユーザーから検索（gameId + startedAt + historyLength でマッチング）
    const allSnap = await get(ref(db, "analyses"));
    if (!allSnap.exists()) return null;
    const all = allSnap.val();
    for (const [uname, userObj] of Object.entries(all)) {
      if (uname === playerName || !userObj) continue;
      // 一意キーを先に試す
      const d1 = userObj[uniqueKey];
      if (d1 && d1.evaluations && d1.evaluations.length === historyLength + 1) {
        return { data: d1, path: FB_PATH(uname, uniqueKey), fbKey: uniqueKey };
      }
      // 旧形式キーもチェック（gameId + startedAt + historyLength で照合）
      for (const [k, d] of Object.entries(userObj)) {
        const sessionMatch = !game.startedAt || !d.startedAt || d.startedAt === game.startedAt;
        if (d && d.gameId === slotKey && sessionMatch && d.evaluations && d.evaluations.length === historyLength + 1) {
          return { data: d, path: FB_PATH(uname, k), fbKey: k };
        }
      }
    }
    return null;
  } catch { return null; }
}

// Copy another user's analysis to own path (respecting per-user cap).
export async function fbCopyToUser(playerName, fbKey, sourceData) {
  try {
    const snap = await get(ref(db, `analyses/${playerName}`));
    const existing = snap.val() || {};
    const entries = Object.entries(existing);
    const hasRoom = await enforceUserCap(playerName, entries, fbKey);
    if (!hasRoom) return null;
    const data = { ...sourceData, fbKey, locked: existing[fbKey]?.locked || false };
    await set(ref(db, FB_PATH(playerName, fbKey)), data);
    return data;
  } catch(e) { console.warn("fbCopyToUser failed:", e); return null; }
}

/**
 * 解析データを Firebase に保存する。
 * game オブジェクトから一意キーを導出し、スロット再利用による上書きを防ぐ。
 * 保存データに fbKey フィールドを含め、AnalysisList から参照できるようにする。
 */
export async function fbSave(playerName, game, gameType, uciMoves, evR, bmR) {
  try {
    const firebaseKey = FB_GAME_KEY(game); // 一意キー: "g1_2026-05-24T11-33-39-462Z"
    const snap = await get(ref(db, `analyses/${playerName}`));
    const existing = snap.val() || {};
    const entries = Object.entries(existing);

    const hasRoom = await enforceUserCap(playerName, entries, firebaseKey);
    if (!hasRoom) return null;

    const history = game.history || [];
    const classifications = history.map((_, i) => {
      if (evR[i] === undefined || evR[i + 1] === undefined) return null;
      return classify(getCPL(evR[i], evR[i + 1], i)).en;
    });
    // ゲームの勝者を status から導出
    const statusStr = game.status || "";
    let winner = null;
    if (statusStr.endsWith("_w") || statusStr === "cm_w" || statusStr === "resign_w") {
      winner = game.players?.white || null;
    } else if (statusStr.endsWith("_b") || statusStr === "cm_b" || statusStr === "resign_b") {
      winner = game.players?.black || null;
    }
    const data = {
      fbKey:          firebaseKey,       // Firebase キー（AnalysisListで参照用）
      gameId:         game.id,           // スロットID（ゲーム紐付け用）
      gameType,
      players:        game.players || {},
      aiLevel:        game.aiLevel || null,
      moves:          uciMoves,
      history:        history,
      evaluations:    evR,
      bestMoves:      bmR,
      classifications,
      accuracy: {
        first:  calcAccuracy(evR, true),
        second: calcAccuracy(evR, false),
      },
      historyLength:  history.length,
      startedAt:      game.startedAt || history[0]?.ts || null,
      endedAt:        history[history.length - 1]?.ts || null,
      createdAt:      new Date().toISOString(),
      analyzedBy:     playerName,
      winner,
      locked:         existing[firebaseKey]?.locked || false,
    };
    await set(ref(db, FB_PATH(playerName, firebaseKey)), data);
    return { ...data, fbKey: firebaseKey };
  } catch (e) {
    console.warn("fbSave failed:", e);
    return null;
  }
}
