import { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from "react";
import { Chess } from "chess.js";
import { ref, onValue, set, push, remove, get } from "firebase/database";
import { db } from "./firebase.js";
import AnalysisView from "./AnalysisView.jsx";
import AnalysisList from "./AnalysisList.jsx";
import AutoAnalyzer from "./AutoAnalyzer.jsx";
import { CHESS_OPENINGS, SHOGI_OPENINGS, CHESS_TACTICS, SHOGI_TACTICS, uciMovesToChessHistory, usiMovesToShogiHistory } from "./openingsData.js";
import { CHESS_STRATEGY, CHESS_STRATEGY_FEATURED } from "./data/strategy/chess-strategy.js";
import { SHOGI_STRATEGY, SHOGI_STRATEGY_FEATURED } from "./data/strategy/shogi-strategy.js";
import { CHESS_ENDGAME, CHESS_ENDGAME_FEATURED } from "./data/strategy/chess-endgame.js";
import { SHOGI_ENDGAME, SHOGI_ENDGAME_FEATURED } from "./data/strategy/shogi-endgame.js";
import { ChessEngine, boardToFen, uciToCoords, CHESS_AI_LEVELS } from "./chessEngine.js";
// 将棋駒画像（Vite でバンドルに含める）
import _sImg_ou     from "./assets/shogi/ou.png";
import _sImg_gyoku  from "./assets/shogi/gyoku.png";
import _sImg_hisha  from "./assets/shogi/hisha.png";
import _sImg_kaku   from "./assets/shogi/kaku.png";
import _sImg_kin    from "./assets/shogi/kin.png";
import _sImg_gin    from "./assets/shogi/gin.png";
import _sImg_keima  from "./assets/shogi/keima.png";
import _sImg_kyosha from "./assets/shogi/kyosha.png";
import _sImg_fuhyo  from "./assets/shogi/fuhyo.png";
import _sImg_ryuou  from "./assets/shogi/ryuou.png";
import _sImg_ryuma  from "./assets/shogi/ryuma.png";
import _sImg_narikin from "./assets/shogi/narikin.png";
import _sImg_tokin  from "./assets/shogi/tokin.png";
const _SHOGI_IMGS = { ou:_sImg_ou, gyoku:_sImg_gyoku, hisha:_sImg_hisha, kaku:_sImg_kaku, kin:_sImg_kin, gin:_sImg_gin, keima:_sImg_keima, kyosha:_sImg_kyosha, fuhyo:_sImg_fuhyo, ryuou:_sImg_ryuou, ryuma:_sImg_ryuma, narikin:_sImg_narikin, tokin:_sImg_tokin };
// ── SE再生: Web Audio API (ambient mode) でバックグラウンド音楽を止めない ──
// HTMLAudioElement.play() は iOS で音楽セッションを奪うため使用しない。
// AudioContext は iOS Safari でデフォルト "ambient" カテゴリで動作し、
// Spotify / Apple Music などのBGMと共存できる。
let _audioCtx = null;
const _audioBuffers = {};

function _getAudioCtx() {
  if (!_audioCtx) {
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (Ctor) _audioCtx = new Ctor();
    } catch(e) {}
  }
  return _audioCtx;
}

function _dataUriToArrayBuffer(dataUri) {
  const base64 = dataUri.split(',')[1];
  const binary = atob(base64);
  const buf = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return buf;
}

// sounds.js はユーザー操作時に遅延読み込み（初期ロードでクラッシュしないよう）
const playSound = (type) => {
  try {
    import("./sounds.js").then(async ({ SOUND_MOVE, SOUND_CAPTURE, SOUND_CHECK, SOUND_WIN }) => {
      const src = { move: SOUND_MOVE, capture: SOUND_CAPTURE, check: SOUND_CHECK, win: SOUND_WIN }[type];
      if (!src) return;

      const ctx = _getAudioCtx();
      if (!ctx) {
        // AudioContext 非対応環境のみ HTMLAudioElement にフォールバック
        const audio = new Audio(src);
        audio.volume = 0.5;
        audio.play().catch(() => {});
        return;
      }

      try {
        // iOS 等: ユーザー操作タイミングで suspended → running に復帰
        if (ctx.state === 'suspended') await ctx.resume();

        // AudioBuffer をキャッシュ（初回のみデコード、以降は再利用）
        if (!_audioBuffers[type]) {
          _audioBuffers[type] = await ctx.decodeAudioData(_dataUriToArrayBuffer(src));
        }

        const source = ctx.createBufferSource();
        const gain   = ctx.createGain();
        gain.gain.value = 0.5;
        source.buffer = _audioBuffers[type];
        source.connect(gain);
        gain.connect(ctx.destination);
        source.start(0);
      } catch(e) {
        // デコードエラー等: HTMLAudioElement にフォールバック
        try {
          const audio = new Audio(src);
          audio.volume = 0.5;
          audio.play().catch(() => {});
        } catch(e2) {}
      }
    }).catch(() => {});
  } catch(e) {}
};

// 翻訳コンテキスト（全コンポーネントで共有）
const TransContext = createContext({ trans: {}, queue: () => {} });

const APP_PASSWORD = import.meta.env.VITE_APP_PASSWORD ?? "family2025";

const DEFAULT_MEMBERS = [
  { name: "Thomas",       lang: "en" },
  { name: "Clark",        lang: "en" },
  { name: "Honami",       lang: "ja" },
  { name: "おじいちゃん",  lang: "ja" },
  { name: "キッズ",       lang: "ja", kids: true },
];

const PIECE_INFO = {
  K: { ja:"キング 👑", en:"King 👑", descJa:"一番大切な駒！縦・横・斜めに1マス動けます。取られたら負けです。", descEn:"The most important piece! Moves one square in any direction. Don't let it be captured!" },
  Q: { ja:"クイーン 👸", en:"Queen 👸", descJa:"一番強い駒！縦・横・斜めに何マスでも動けます。", descEn:"The strongest piece! Moves any number of squares in any direction." },
  R: { ja:"ルーク 🏰", en:"Rook 🏰", descJa:"縦と横に何マスでも動けます。", descEn:"Moves any number of squares horizontally or vertically." },
  B: { ja:"ビショップ ⛪", en:"Bishop ⛪", descJa:"斜めに何マスでも動けます。", descEn:"Moves any number of squares diagonally." },
  N: { ja:"ナイト 🐴", en:"Knight 🐴", descJa:"Lの字に動きます。他の駒を飛び越えられる唯一の駒！", descEn:"Moves in an L-shape. The only piece that can jump over others!" },
  P: { ja:"ポーン ♟", en:"Pawn ♟", descJa:"前に1マス進みます。最初だけ2マス進めます。斜め前の敵を取れます。", descEn:"Moves one square forward. Can move two on its first move. Captures diagonally." },
};

const PIECE_IMG = {
  wK: "/pieces/wK.webp",
  wQ: "/pieces/wQ.webp",
  wR: "/pieces/wR.webp",
  wB: "/pieces/wB.webp",
  wN: "/pieces/wN.webp",
  wP: "/pieces/wP.webp",
  bK: "/pieces/bK.webp",
  bQ: "/pieces/bQ.webp",
  bR: "/pieces/bR.webp",
  bB: "/pieces/bB.webp",
  bN: "/pieces/bN.webp",
  bP: "/pieces/bP.webp",
};
// 駒の相対高さ比率（キング298pxを100%として切り出し実寸から算出）
const PIECE_SCALE = {
  wK:100, wQ:87, wR:87, wN:93, wB:92, wP:78,
  bK: 99, bQ:88, bR:86, bN:88, bB:94, bP:83,
};


// ── キッズヒント：駒名 & メッセージ生成 ──────────────────────────────
const PIECE_NAMES = {
  P: { ja: "ポーン",     en: "Pawn"   },
  N: { ja: "ナイト",     en: "Knight" },
  B: { ja: "ビショップ", en: "Bishop" },
  R: { ja: "ルーク",     en: "Rook"   },
  Q: { ja: "クイーン",   en: "Queen"  },
  K: { ja: "キング",     en: "King"   },
};
function getKidsHintMsg(targetType, attackers, isInCheck, lang) {
  const L = lang === "en" ? "en" : "ja";
  const tgt = PIECE_NAMES[targetType]?.[L] || targetType;
  if (isInCheck && targetType === "K") {
    return L === "en"
      ? "Your King is in check! Protect the King first!"
      : "王様がチェックされてるよ！まず王様を守って！";
  }
  if (!attackers.length) return null;
  if (attackers.length > 1) {
    return L === "en"
      ? `Your ${tgt} is targeted by ${attackers.length} pieces! Danger!`
      : `${tgt}が${attackers.length}つの駒から狙われてるよ！危険！`;
  }
  const atk = attackers[0];
  const coord = `${String.fromCharCode(97 + atk.c)}${8 - atk.r}`; // e.g. "e4"
  if (L === "en") {
    const msgs = {
      P: `Your ${tgt} is targeted by the Pawn at ${coord}!`,
      N: `Your ${tgt} is targeted by the Knight at ${coord} in an L-shape!`,
      B: `Your ${tgt} is targeted by the Bishop at ${coord} diagonally!`,
      R: `Your ${tgt} is targeted by the Rook at ${coord} in a straight line!`,
      Q: `Your ${tgt} is targeted by the Queen at ${coord}! Watch out!`,
      K: `Your ${tgt} is targeted by the opponent's King!`,
    };
    return msgs[atk.type] || `Your ${tgt} is in danger!`;
  }
  const msgs = {
    P: `${tgt}が、${coord}のポーンに狙われてるよ！`,
    N: `${tgt}が、${coord}のナイトにL字で狙われてるよ！`,
    B: `${tgt}が、${coord}のビショップに斜めから狙われてるよ！`,
    R: `${tgt}が、${coord}のルークに縦横から狙われてるよ！`,
    Q: `${tgt}が、${coord}のクイーンに狙われてるよ！気をつけて！`,
    K: `${tgt}が、相手のキングに狙われてるよ！`,
  };
  return msgs[atk.type] || `${tgt}が危ないよ！`;
}

// ── リアクション定義 ──────────────────────────────────────────────
const REACTIONS = ["❤️", "😂", "👏", "🎉", "😮", "Good move!", "Nice game!"];

// アバターアイコン共通コンポーネント（円形・エラー時は👤フォールバック・タップで拡大）
function AvatarIcon({ url, size = 36, name = "", noPreview = false, border }) {
  const [err, setErr] = useState(false);
  const [preview, setPreview] = useState(false);
  // URLが変わったときにエラー状態をリセット（アバター変更後に再表示できるよう）
  useEffect(() => { setErr(false); }, [url]);
  const sz = size + "px";
  const canPreview = !!url && !err && !noPreview;
  const borderStyle = border || "1px solid #c8b090";

  const handleClick = (e) => {
    if (!canPreview) return;
    e.stopPropagation();
    setPreview(true);
  };

  return (
    <>
      {(!url || err) ? (
        <span style={{
          width:sz, height:sz, minWidth:sz, borderRadius:"50%",
          background:"#f0e8d8", display:"inline-flex",
          alignItems:"center", justifyContent:"center",
          fontSize: Math.round(size * 0.52) + "px",
          flexShrink:0, border:borderStyle,
          userSelect:"none", overflow:"hidden",
        }}>👤</span>
      ) : (
        <img
          src={url} alt={name}
          onError={() => setErr(true)}
          onClick={handleClick}
          style={{
            width:sz, height:sz, minWidth:sz, borderRadius:"50%",
            objectFit:"cover", flexShrink:0,
            border:borderStyle, display:"block",
            cursor: canPreview ? "pointer" : "inherit",
          }}
        />
      )}
      {preview && (
        <div
          onClick={() => setPreview(false)}
          style={{
            position:"fixed", inset:0, background:"rgba(0,0,0,0.72)",
            display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
            zIndex:9999, cursor:"pointer",
          }}
        >
          <img
            src={url.replace('/avatars/', '/avatars_large/')} alt={name}
            style={{
              width:"min(300px, 80vw, 80vh)", height:"min(300px, 80vw, 80vh)", borderRadius:"50%",
              objectFit:"cover",
              border:"4px solid #ffffff",
              boxShadow:"0 8px 40px rgba(0,0,0,0.6)",
            }}
          />
          {name && (
            <div style={{
              marginTop:16, color:"#ffffff", fontSize:20,
              fontWeight:"bold", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif",
              textShadow:"0 2px 8px rgba(0,0,0,0.8)",
            }}>{name}</div>
          )}
          <div style={{marginTop:10, color:"rgba(255,255,255,0.6)", fontSize:18}}>
            タップして閉じる / Tap to close
          </div>
        </div>
      )}
    </>
  );
}

// キング駒バッジ（タップで拡大表示）
function KingBadge({ col, size = 60 }) {
  const [preview, setPreview] = useState(false);
  const src = col === "w" ? "/badges/king-white.webp" : "/badges/king-black.webp";
  const sz  = size + "px";
  return (
    <>
      <img
        src={src}
        alt={col==="w" ? "White King" : "Black King"}
        onClick={(e) => { e.stopPropagation(); setPreview(true); }}
        style={{
          width:sz, height:sz, minWidth:sz,
          borderRadius:"50%",
          objectFit:"cover",
          display:"block",
          flexShrink:0,
          border:"1px solid #c8b090",
          cursor:"pointer",
          boxShadow:"0 1px 4px rgba(42,26,8,0.18)",
        }}
      />
      {preview && (
        <div
          onClick={() => setPreview(false)}
          style={{
            position:"fixed", inset:0, background:"rgba(0,0,0,0.72)",
            display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
            zIndex:9999, cursor:"pointer",
          }}
        >
          <img
            src={src}
            alt={col==="w" ? "White King" : "Black King"}
            style={{
              width:300, height:300,
              borderRadius:"50%",
              objectFit:"cover",
              border:"4px solid #ffffff",
              boxShadow:"0 8px 40px rgba(0,0,0,0.6)",
            }}
          />
          <div style={{marginTop:10, color:"rgba(255,255,255,0.6)", fontSize:18}}>
            タップして閉じる / Tap to close
          </div>
        </div>
      )}
    </>
  );
}

// 将棋キングバッジ（旅人画像、タップで拡大表示）
function ShogiKingBadge({ color, size = 60 }) {
  const [preview, setPreview] = useState(false);
  const travelerSrc = color === "b" ? "/badges/shogi-black.webp" : "/badges/shogi-white.webp";
  const sz = size + "px";
  return (
    <>
      <img
        src={travelerSrc}
        onClick={(e) => { e.stopPropagation(); setPreview(true); }}
        style={{width:sz, height:sz, minWidth:sz, borderRadius:"50%", objectFit:"cover", border:"1px solid #c8b090", display:"block", flexShrink:0, cursor:"pointer", boxShadow:"0 1px 4px rgba(42,26,8,0.18)"}}
      />
      {preview && (
        <div
          onClick={() => setPreview(false)}
          style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.72)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", zIndex:9999, cursor:"pointer"}}
        >
          <img src={travelerSrc} style={{width:300, height:300, borderRadius:"50%", objectFit:"cover", border:"4px solid #ffffff", boxShadow:"0 8px 40px rgba(0,0,0,0.6)"}}/>
          <div style={{marginTop:10, color:"rgba(255,255,255,0.6)", fontSize:18}}>
            タップして閉じる / Tap to close
          </div>
        </div>
      )}
    </>
  );
}

// NY・Japan デジタル時計
function DualClock({ playerLang, flat = false }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(id);
  }, []);
  const isEN = playerLang === "en";

  // 日本語モード：24h・日本語曜日  英語モード：12h AM/PM・英語曜日
  const fmtTime = (tz) => isEN
    ? now.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true })
    : now.toLocaleTimeString("ja-JP", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });

  const fmtDate = (tz) => isEN
    ? now.toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" })
    : now.toLocaleDateString("ja-JP", { timeZone: tz, month: "numeric", day: "numeric", weekday: "short" });

  const serif = "'Cormorant Garamond','Zen Old Mincho',Georgia,serif";
  const timeStyle = { fontFamily:serif, fontSize:"clamp(18px,4vw,21px)", fontWeight:500, color:"#3a2e22", letterSpacing:"0.06em", lineHeight:1 };
  const dateStyle = { fontFamily:serif, fontSize:"clamp(18px,4vw,21px)", fontWeight:400, color:"#3a2e22", letterSpacing:"0.04em", lineHeight:1 };
  const sep = <span style={{fontFamily:serif, fontSize:18, color:"#c8b090"}}>—</span>;

  const isDayTime = (tz) => {
    const h = parseInt(now.toLocaleTimeString("en-US", { timeZone: tz, hour: "2-digit", hour12: false }), 10);
    return h >= 6 && h < 18;
  };

  const ClockCell = ({ tz, label }) => {
    const time = fmtTime(tz);
    const date = fmtDate(tz);
    const dayIcon = isDayTime(tz) ? "☼" : "☾";
    return (
      <div style={{display:"flex", flexDirection:"column", alignItems:"center", gap:4, padding:"6px 8px"}}>
        <span style={{fontSize:18, color:"#a08060", letterSpacing:"0.12em", fontFamily:serif, textTransform:"uppercase"}}>
          <span style={{marginRight:5, fontSize:18, opacity:0.85}}>{dayIcon}</span>{label}
        </span>
        <div style={{display:"flex", alignItems:"baseline", gap:6}}>
          <span style={dateStyle}>{date}</span>
          {sep}
          <span style={timeStyle}>{time}</span>
        </div>
      </div>
    );
  };

  return (
    <div style={flat
      ? {display:"flex", flexDirection:"column", borderRadius:12, border:"1px solid #d4bc88", overflow:"hidden"}
      : {display:"flex", flexDirection:"column", background:"#faf6f0", borderRadius:16, overflow:"hidden", border:"1px solid #e8d8b4"}}>
      <ClockCell tz="America/New_York" label="New York" />
      <div style={{height:"1px", background:"#e0ceb0", margin:"0 8px"}} />
      <ClockCell tz="Asia/Tokyo" label="Japan" />
    </div>
  );
}

// ── Wooden Traveler Series デザインシステム ──────────────────────────────
const WT = {
  bg:          "#f1dab8",   // parchment background (= header image bg)
  surface:     "#faf5e8",   // ivory card surface
  surfaceHi:   "#fffcf5",   // near-white elevated surface
  borderGold:  "#c4a058",   // antique gold border
  border:      "#d4bc88",   // main border
  borderSub:   "#e8d8b4",   // subtle border
  textDark:    "#2a1a08",   // deep warm almost-black
  text:        "#5a3c18",   // warm body text
  textMid:     "#7c6040",   // medium
  textMuted:   "#a89070",   // muted/captions
  gold:        "#b08830",   // accent gold
  woodDark:    "#4c2e0c",   // mahogany / primary button
  wood:        "#7a5020",   // walnut
  woodLight:   "#a07848",   // light wood
};

// 装飾ルール（細線 + ✦ 中央）
function OrnamentalRule({ style = {} }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, ...style }}>
      <div style={{ flex:1, height:"0.5px", background:`linear-gradient(to right, transparent, ${WT.borderGold})` }} />
      <span style={{ color:WT.borderGold, fontSize:8, lineHeight:1, letterSpacing:"0.25em" }}>✦</span>
      <div style={{ flex:1, height:"0.5px", background:`linear-gradient(to left, transparent, ${WT.borderGold})` }} />
    </div>
  );
}

// ブランドロゴブロック（パスワード画面・選択画面共用）
function BrandMark({ size = "lg" }) {
  const isLg = size === "lg";
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:isLg ? 6 : 4 }}>
      <h1 style={{
        fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif",
        fontSize: isLg ? "clamp(26px,6vw,38px)" : "clamp(18px,4vw,24px)",
        fontWeight:600, color:WT.textDark, margin:0,
        letterSpacing:"0.18em", lineHeight:1.2,
      }}>Family Chess</h1>
      <OrnamentalRule style={{ width: isLg ? 260 : 180, margin:"4px 0" }} />
      <p style={{
        fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif",
        fontStyle:"italic", fontSize: 16,
        color:WT.gold, margin:0, letterSpacing:"0.28em", lineHeight:1,
      }}>Wooden Traveler Series</p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

function ChessPiece({ type, color }) {
  const key = color + type;
  return <img src={PIECE_IMG[key]} alt={key} style={{ width:"88%", height:"88%", display:"block", pointerEvents:"none" }} />;
}

function mkBoard() {
  const b = [];
  const back = ["R","N","B","Q","K","B","N","R"];
  for (let r = 0; r < 8; r++) { b[r] = []; for (let c = 0; c < 8; c++) b[r][c] = null; }
  for (let c = 0; c < 8; c++) {
    b[0][c] = {type:back[c], color:"b"}; b[1][c] = {type:"P", color:"b"};
    b[6][c] = {type:"P", color:"w"};    b[7][c] = {type:back[c], color:"w"};
  }
  return b;
}

function mkGames() { return [
  {id:"g1", name:"No.1", board:mkBoard(), turn:"w", history:[], messages:[], status:"waiting", players:{white:"", black:""}, undoRequest:null, redoHistory:[]},
  {id:"g2", name:"No.2", board:mkBoard(), turn:"w", history:[], messages:[], status:"waiting", players:{white:"", black:""}, undoRequest:null, redoHistory:[]},
  {id:"g3", name:"No.3", board:mkBoard(), turn:"w", history:[], messages:[], status:"waiting", players:{white:"", black:""}, undoRequest:null, redoHistory:[]},
]; }

const inB = (r,c) => r>=0 && r<8 && c>=0 && c<8;

// キャスリング権を履歴から算出（キング・ルークが初期位置から動いたか）
function castlingFromHistory(history) {
  const moved = new Set();
  (history||[]).forEach(h => { if (h.from) moved.add(`${h.from[0]},${h.from[1]}`); });
  return {
    wK:  !moved.has("7,4"),
    wQR: !moved.has("7,0"),
    wKR: !moved.has("7,7"),
    bK:  !moved.has("0,4"),
    bQR: !moved.has("0,0"),
    bKR: !moved.has("0,7"),
  };
}

function rawMoves(board, r, c, castling = null, epSquare = null) {
  const p = board[r][c]; if (!p) return [];
  const mv = [];
  const add = (nr,nc) => { if (inB(nr,nc) && board[nr][nc]?.color !== p.color) mv.push([nr,nc]); };
  const slide = (dr,dc) => { let nr=r+dr, nc=c+dc; while (inB(nr,nc)) { if (board[nr][nc]) { if (board[nr][nc].color !== p.color) mv.push([nr,nc]); break; } mv.push([nr,nc]); nr+=dr; nc+=dc; } };
  if (p.type==="P") {
    const d = p.color==="w" ? -1 : 1, s = p.color==="w" ? 6 : 1;
    if (inB(r+d,c) && !board[r+d][c]) { mv.push([r+d,c]); if (r===s && !board[r+2*d][c]) mv.push([r+2*d,c]); }
    [-1,1].forEach(dc => { if (inB(r+d,c+dc) && board[r+d][c+dc]?.color !== p.color && board[r+d][c+dc]) mv.push([r+d,c+dc]); });
    // アンパッサン
    if (epSquare) {
      const [epr, epc] = epSquare;
      if (epr === r+d && Math.abs(c - epc) === 1) mv.push([epr, epc]);
    }
  } else if (p.type==="N") { [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(([dr,dc]) => add(r+dr,c+dc)); }
  else if (p.type==="B") { [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(([dr,dc]) => slide(dr,dc)); }
  else if (p.type==="R") { [[-1,0],[1,0],[0,-1],[0,1]].forEach(([dr,dc]) => slide(dr,dc)); }
  else if (p.type==="Q") { [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]].forEach(([dr,dc]) => slide(dr,dc)); }
  else if (p.type==="K") {
    [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].forEach(([dr,dc]) => add(r+dr,c+dc));
    // キャスリング
    if (castling) {
      const isW = p.color==="w", br = isW ? 7 : 0;
      if (r===br && c===4) {
        // キングサイド（O-O）: キングg・ルークfへ
        if (castling[isW?"wK":"bK"] && castling[isW?"wKR":"bKR"] &&
            !board[br][5] && !board[br][6] &&
            board[br][7]?.type==="R" && board[br][7]?.color===p.color)
          mv.push([br,6]);
        // クイーンサイド（O-O-O）: キングc・ルークdへ
        if (castling[isW?"wK":"bK"] && castling[isW?"wQR":"bQR"] &&
            !board[br][3] && !board[br][2] && !board[br][1] &&
            board[br][0]?.type==="R" && board[br][0]?.color===p.color)
          mv.push([br,2]);
      }
    }
  }
  return mv;
}

function inCheck(board, color) {
  let kr=-1, kc=-1;
  for (let r=0; r<8; r++) for (let c=0; c<8; c++) if (board[r][c]?.type==="K" && board[r][c]?.color===color) { kr=r; kc=c; }
  const opp = color==="w" ? "b" : "w";
  for (let r=0; r<8; r++) for (let c=0; c<8; c++) if (board[r][c]?.color===opp) if (rawMoves(board,r,c).some(([nr,nc]) => nr===kr && nc===kc)) return true;
  return false;
}

function legal(board, r, c, castling = null, epSquare = null) {
  const p = board[r][c]; if (!p) return [];
  return rawMoves(board, r, c, castling, epSquare).filter(([nr,nc]) => {
    // キャスリング: チェック中は不可・中間マスを通過できない
    if (p.type==="K" && Math.abs(nc-c)===2) {
      if (inCheck(board, p.color)) return false;
      const midC = nc > c ? c+1 : c-1;
      const midB = board.map(row=>[...row]); midB[r][midC]=p; midB[r][c]=null;
      if (inCheck(midB, p.color)) return false;
    }
    const nb = board.map(row=>[...row]); nb[nr][nc]=p; nb[r][c]=null;
    // アンパッサン: 取られるポーンもボードから除去してチェック判定
    if (p.type==="P" && epSquare && nr===epSquare[0] && nc===epSquare[1] && c!==nc) {
      nb[r][nc] = null;
    }
    return !inCheck(nb, p.color);
  });
}

function applyMove(board, fr, fc, tr, tc, promoteType = "Q", epSquare = null) {
  const nb = board.map(row=>[...row]); const p = nb[fr][fc];
  nb[tr][tc] = (p.type==="P" && (tr===0||tr===7)) ? {type:promoteType, color:p.color} : p;
  nb[fr][fc] = null;
  // アンパッサン: 取られるポーンを除去（移動先が空マスの斜め移動）
  if (p.type==="P" && epSquare && tr===epSquare[0] && tc===epSquare[1] && fc!==tc) {
    nb[fr][tc] = null; // 取られるポーンは攻撃側と同じ行・移動先の列
  }
  // キャスリング: ルークも移動
  if (p.type==="K" && Math.abs(tc-fc)===2) {
    if (tc===6) { nb[fr][5]=nb[fr][7]; nb[fr][7]=null; } // キングサイド
    else        { nb[fr][3]=nb[fr][0]; nb[fr][0]=null; } // クイーンサイド
  }
  return nb;
}

function hasAny(board, color, castling = null, epSquare = null) {
  for (let r=0; r<8; r++) for (let c=0; c<8; c++) if (board[r][c]?.color===color && legal(board,r,c,castling,epSquare).length>0) return true;
  return false;
}


const colL = c => "abcdefgh"[c];
const nota = (fr,fc,tr,tc,p,promote="") => {
  if (p.type==="K" && fc===4 && Math.abs(tc-fc)===2) return tc===6 ? "O-O" : "O-O-O";
  return `${p.type!=="P"?p.type:""}${colL(fc)}${8-fr}-${colL(tc)}${8-tr}${promote ? "="+promote : ""}`;
};
const fmtT = (iso, tz) => !iso ? "" : new Date(iso).toLocaleString("ja-JP", {timeZone:tz==="JP"?"Asia/Tokyo":"America/New_York", month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit"});
// DMは "for 相手名"、グループ/パブリックは room.name をそのまま返す
const getRoomDisplayName = (room, currentPlayer) => {
  if (room?.type === "direct" && Array.isArray(room?.members)) {
    const other = room.members.find(m => m !== currentPlayer);
    if (other) return `for ${other}`;
  }
  return room?.name || "";
};
// 指し手履歴の日時表示：日本語モード→JP時間のみ、英語モード→NY時間のみ
const fmtDualT = (iso, playerLang) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (playerLang === "en") {
    return d.toLocaleString("en-US", {timeZone:"America/New_York", month:"short", day:"numeric", hour:"numeric", minute:"2-digit", hour12:true});
  } else {
    return d.toLocaleString("ja-JP", {timeZone:"Asia/Tokyo", month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false});
  }
};

// 翻訳：Google 非公式エンドポイント → Lingva フォールバック
const LINGVA_INSTANCES = [
  "https://lingva.ml",
  "https://translate.plausibility.cloud",
  "https://lingva.tiekoetter.com",
];
async function translate(text) {
  if (!text?.trim()) return "";
  const isJP = /[\u3000-\u9fff]/.test(text);
  const src = isJP ? "ja" : "en";
  const tgt = isJP ? "en" : "ja";
  const encoded = encodeURIComponent(text);

  // 1st: Google 非公式エンドポイント（キー不要・高信頼）
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${src}&tl=${tgt}&dt=t&q=${encoded}`;
    const r = await fetch(url);
    if (r.ok) {
      const d = await r.json();
      const tr = d?.[0]?.map(s => s?.[0]).filter(Boolean).join("").trim();
      if (tr) return tr;
    }
  } catch {}

  // 2nd: Lingva フォールバック
  for (const base of LINGVA_INSTANCES) {
    try {
      const r = await fetch(`${base}/api/v1/${src}/${tgt}/${encoded}`);
      if (!r.ok) continue;
      const d = await r.json();
      const tr = d.translation?.trim();
      if (tr) return tr;
    } catch {}
  }
  return "";
}
const translateMsg = translate;

function ChatInput({ playerName, roomId, onSent, t, isKids }) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const translation = text ? await translateMsg(text) : "";
      const isJP = text ? /[　-鿿]/.test(text) : false;
      const ts = new Date().toISOString();
      const msgData = { text: text || "", translation, isJP, sender: playerName, ts, fromChat: true };
      await push(ref(db, `chat/${roomId}`), msgData);
      set(ref(db, `chatRooms/${roomId}/lastMessageAt`), ts).catch(() => {});
      const MAX_ROOM_MSGS = 200;
      get(ref(db, `chat/${roomId}`)).then(snap => {
        const data = snap.val();
        if (!data) return;
        const entries = Object.entries(data).sort((a, b) => a[0] < b[0] ? -1 : 1);
        if (entries.length > MAX_ROOM_MSGS) {
          entries.slice(0, entries.length - MAX_ROOM_MSGS).forEach(([k, v]) => {
            remove(ref(db, `chat/${roomId}/${k}`)).catch(() => {});
          });
        }
      }).catch(() => {});
      setInput("");
      if (onSent) onSent();
    } catch(e) {
      console.error("Send error:", e);
    }
    setSending(false);
  };

  return (
    <div style={{display:"flex", flexDirection:"column", background:"#f7f0e6", borderTop:"1px solid #e0d4c0", flexShrink:0, boxSizing:"border-box"}}>
      <div style={{display:"flex", gap:6, padding:"8px 10px", paddingBottom:"max(8px, env(safe-area-inset-bottom, 8px))"}}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if(e.key==="Enter" && !sending) send(); }}
          placeholder={isKids ? "なんでもかいてね！" : "日本語 or English..."}
          disabled={sending}
          style={{flex:1, minWidth:0, background:"#fffdf8", border:"1px solid #c8b090", borderRadius:10, padding:"8px 10px", color:"#3a2e22", fontSize:"clamp(16px,3.8vw,19px)", outline:"none", fontFamily:"inherit", boxSizing:"border-box"}}
        />
        <button onClick={send} disabled={sending}
          style={{flexShrink:0, background:sending?"#d8c8a8":"linear-gradient(135deg,#D4A888,#b88a6a)", border:"none", borderRadius:10, color:sending?"#9a8876":"#3a2e22", padding:"8px 14px", cursor:sending?"not-allowed":"pointer", fontSize:"clamp(16px,3.8vw,19px)", fontWeight:"bold", whiteSpace:"nowrap"}}>
          {sending ? "..." : t("送信","Send","おくる","Send")}
        </button>
      </div>
    </div>
  );
}


function NewRoomModal({ members, playerName, t, onClose, onCreated }) {
  const [roomName, setRoomName] = useState("");
  const [roomType, setRoomType] = useState("direct");
  const [selectedMembers, setSelectedMembers] = useState([]);

  const otherMembers = members.filter(m => m.name !== playerName);

  const canCreate = () => {
    if (roomType === "public") return roomName.trim().length > 0;
    if (roomType === "direct") return selectedMembers.length === 1;
    if (roomType === "group") return roomName.trim().length > 0 && selectedMembers.length >= 2;
    return false;
  };

  const create = async () => {
    if (!canCreate()) return;
    try {
      const name = roomType === "direct"
        ? `${playerName} & ${selectedMembers[0]}`
        : roomName.trim();
      const allMembers = [playerName, ...selectedMembers];
      const newRoom = {
        name,
        type: roomType,
        isPublic: roomType === "public",
        members: allMembers,
        createdBy: playerName,
        createdAt: new Date().toISOString(),
      };
      const result = await push(ref(db, "chatRooms"), newRoom);
      onCreated(result.key);
    } catch(e) {
      console.error("Room create error:", e);
      alert("ルームの作成に失敗しました: " + e.message);
    }
  };

  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,0.5)",
      display:"flex", alignItems:"center", justifyContent:"center", zIndex:3000,
    }}>
      <div style={{
        background:"#fffdf8", borderRadius:20, padding:28,
        width:"min(420px,92vw)", display:"flex", flexDirection:"column",
        gap:16, maxHeight:"85vh", overflowY:"auto",
        border:"1px solid #e0d4c0", boxShadow:"0 8px 32px rgba(60,40,20,0.14)",
      }}>
        <h3 style={{margin:0, color:"#3a2e22", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontWeight:500, fontSize:"clamp(18px,4.5vw,23px)", letterSpacing:"0.06em", lineHeight:1.4}}>
          {t("新しいルームを作成","Create New Room","あたらしいルーム","New Room")}
        </h3>
        <div style={{display:"flex", gap:6}}>
          {[
            {key:"public", label:"🌐 " + t("全体公開","Public","みんな","Public")},
            {key:"direct", label:"👤 " + t("個別","Direct","こじん","Direct")},
            {key:"group",  label:"👥 " + t("グループ","Group","グループ","Group")},
          ].map(({key, label}) => (
            <button key={key} onClick={() => { setRoomType(key); setSelectedMembers([]); setRoomName(key === "group" ? "グループチャット" : ""); }} style={{
              flex:1, padding:"8px 4px",
              background: roomType===key ? "linear-gradient(135deg,#D4A888,#b88a6a)" : "#f5f0e8",
              border: `1px solid ${roomType===key ? "#b88a6a" : "#d8c8a8"}`,
              borderRadius:10, color: roomType===key ? "#3a2e22" : "#7a6858",
              cursor:"pointer", fontSize:18,
              fontWeight: roomType===key ? "bold" : "normal",
              fontFamily:"inherit",
            }}>{label}</button>
          ))}
        </div>
        {(roomType === "public" || roomType === "group") && (
          <input
            value={roomName}
            onChange={e => setRoomName(e.target.value)}
            placeholder={t("ルーム名","Room name","ルームのなまえ","Room name")}
            style={{
              padding:"10px 14px", borderRadius:10,
              border:"1px solid #c8b090", fontSize:18, outline:"none",
              fontFamily:"inherit", background:"#fffdf8", color:"#3a2e22",
            }}
          />
        )}
        {(roomType === "direct" || roomType === "group") && (
          <div style={{display:"flex", flexDirection:"column", gap:8}}>
            <span style={{fontSize:18, color:"#7a6858", fontWeight:"bold"}}>
              {roomType === "direct"
                ? t("相手を選択（1人）","Select 1 person","だれとはなす？","Select 1 person")
                : t("メンバーを選択（2人以上）","Select members (2+)","だれとはなす？","Select 2+")}
            </span>
            {otherMembers.map(m => (
              <label key={m.name} style={{
                display:"flex", alignItems:"center", gap:10,
                cursor:"pointer", padding:"10px 14px", borderRadius:10,
                background: selectedMembers.includes(m.name) ? "#f8f0e0" : "#faf6f0",
                border:`1px solid ${selectedMembers.includes(m.name) ? "#c8a060" : "#e0d4c0"}`,
                transition:"all 0.15s",
              }}>
                <input
                  type={roomType === "direct" ? "radio" : "checkbox"}
                  name="chatMember"
                  checked={selectedMembers.includes(m.name)}
                  onChange={() => {
                    if (roomType === "direct") {
                      setSelectedMembers([m.name]);
                    } else {
                      setSelectedMembers(prev =>
                        prev.includes(m.name)
                          ? prev.filter(n => n !== m.name)
                          : [...prev, m.name]
                      );
                    }
                  }}
                  style={{width:20, height:20, accentColor:"#D4A888"}}
                />
                <span style={{fontSize:"clamp(18px,4vw,22px)", color:"#3a2e22", fontWeight:500, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", letterSpacing:"0.04em"}}>
                  {m.name}{m.kids ? " 🐥" : ""}
                </span>
              </label>
            ))}
          </div>
        )}
        {roomType === "group" && selectedMembers.length > 0 && (
          <div style={{fontSize:18, color:"#8a5a3a", background:"#f8f0e0", borderRadius:8, padding:"8px 12px", border:"1px solid #d8c0a0"}}>
            {t("参加者","Members","さんかしゃ","Members")}: {playerName}, {selectedMembers.join(", ")}
          </div>
        )}
        <div style={{display:"flex", gap:10, marginTop:4}}>
          <button
            onClick={create}
            disabled={!canCreate()}
            style={{
              flex:1,
              background: canCreate() ? "linear-gradient(135deg,#D4A888,#b88a6a)" : "#d8c8a8",
              border:"none", borderRadius:12, color: canCreate() ? "#3a2e22" : "#9a8876",
              padding:"14px", fontSize:18, fontWeight:"bold",
              cursor: canCreate() ? "pointer" : "not-allowed",
              fontFamily:"inherit",
            }}
          >
            ✓ {t("作成","Create","つくる","Create")}
          </button>
          <button
            onClick={onClose}
            style={{
              flex:1, background:"#f5f0e8", border:"1px solid #d8c8a8",
              borderRadius:12, color:"#7a6858", padding:"14px",
              fontSize:18, cursor:"pointer", fontFamily:"inherit",
            }}
          >
            {t("キャンセル","Cancel","やめる","Cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Board({ game, onUpdate, myColor, rotateTopPieces, isKids, playerLang, flat = false }) {
  const [sel, setSel] = useState(null);
  const [lsq, setLsq] = useState([]);
  const [pieceInfo, setPieceInfo] = useState(null);
  const [promotionPending, setPromotionPending] = useState(null); // {fr,fc,tr,tc,isCapture,savedCastling}
  const [announcement, setAnnouncement] = useState(null);
  const announcementTimer = useRef(null);
  const showAnnouncement = (text) => {
    if (announcementTimer.current) clearTimeout(announcementTimer.current);
    setAnnouncement(text);
    announcementTimer.current = setTimeout(() => setAnnouncement(null), 2500);
  };
  const touchTimer = useRef(null);
  const { board, turn, history, status, flipped } = game;
  if (!board || board.length !== 8) return <div style={{color:"#111111"}}>盤面エラー</div>;

  const click = (r, c) => {
    if (status !== "playing") return;
    if (game.players) {
      const effectiveMyColor = myColor ?? (rotateTopPieces ? turn : null);
      if (effectiveMyColor === null) return;
      if (effectiveMyColor !== turn) return;
    }
    // キッズヒント: 脅かされた自駒を初回タップしたとき理由を表示
    if (showKidsHints && !sel) {
      const pc = board[r][c];
      const myCol = myColor || turn;
      const key = `${r},${c}`;
      if (pc?.color === myCol && attackersMap[key]) {
        const msg = getKidsHintMsg(pc.type, attackersMap[key], inCheck(board, myCol), playerLang);
        if (msg) showKidsHintBubble(msg);
      }
    }
    const rules = game.rules || { castling:true, promotion:true, enPassant:true };
    const castling = castlingFromHistory(history);
    const epSquare = game.epSquare || null;
    const effectiveCastling = rules.castling !== false ? castling : null;
    const effectiveEp = rules.enPassant !== false ? epSquare : null;
    const p = board[r][c];
    if (sel) {
      const [sr, sc] = sel;
      if (lsq.some(([lr,lc]) => lr===r && lc===c)) {
        // アンパッサン判定（移動先が空マスの斜め移動）
        const isEpCapture = board[sr][sc]?.type==="P" && effectiveEp && r===effectiveEp[0] && c===effectiveEp[1] && sc!==c;
        const isCapture = !!board[r][c] || isEpCapture;
        // キャスリング宣言
        const isCastling = board[sr][sc]?.type==="K" && Math.abs(c-sc)===2;
        // アンパッサン宣言
        if (isEpCapture) {
          showAnnouncement(playerLang==="en" ? "En Passant!" : "アンパッサン！");
        }
        // プロモーション: ルールONの場合は駒選択モーダル、OFFの場合はクイーンに自動昇格
        if (board[sr][sc]?.type==="P" && (r===0||r===7)) {
          if (rules.promotion !== false) {
            setPromotionPending({ fr:sr, fc:sc, tr:r, tc:c, isCapture, savedCastling:castling });
            setSel(null); setLsq([]);
            return;
          }
          // プロモーションルールOFF → クイーンに自動昇格（宣言なし）
        }
        const nb = applyMove(board, sr, sc, r, c, "Q", effectiveEp);
        // キャスリング宣言（applyMove後）
        if (isCastling) {
          showAnnouncement(playerLang==="en" ? (c===6 ? "Castling!" : "Queenside Castling!") : (c===6 ? "キャスリング！" : "クイーンサイドキャスリング！"));
        }
        const nt = turn==="w" ? "b" : "w";
        // 着手後のキャスリング権を更新（動いた駒・取られたルーク）
        const nc = {
          wK:  castling.wK  && !(sr===7&&sc===4),
          wQR: castling.wQR && !(sr===7&&sc===0) && !(r===7&&c===0),
          wKR: castling.wKR && !(sr===7&&sc===7) && !(r===7&&c===7),
          bK:  castling.bK  && !(sr===0&&sc===4),
          bQR: castling.bQR && !(sr===0&&sc===0) && !(r===0&&c===0),
          bKR: castling.bKR && !(sr===0&&sc===7) && !(r===0&&c===7),
        };
        // 着手後のアンパッサン対象マス（ポーンが2マス進んだ場合のみ有効）
        const newEp = (board[sr][sc]?.type==="P" && Math.abs(r-sr)===2)
          ? [(sr+r)/2, c] : null;
        let ns = "playing"; if (!hasAny(nb,nt,nc,newEp)) ns = inCheck(nb,nt) ? `cm_${turn}` : "draw";
        if (ns !== "playing") { playSound("win"); }
        else if (inCheck(nb, nt)) { playSound("check"); }
        else if (isCapture) { playSound("capture"); }
        else { playSound("move"); }
        const movingPlayer = game.players?.[turn==="w"?"white":"black"] || (turn==="w"?"White":"Black");
        const isCheckNow = ns === "playing" && inCheck(nb, nt);
        const checkMsgData = isCheckNow ? {
          sender: movingPlayer,
          text: playerLang === "en" ? "♚ Check!" : "♚ チェック！",
          ts: new Date().toISOString(),
          isJP: playerLang !== "en",
          auto: true,
          gameId: game.id,
          gameType: "chess",
        } : null;
        if (checkMsgData && game.chatRoomId) {
          push(ref(db, `chat/${game.chatRoomId}`), checkMsgData).catch(() => {});
        }
        onUpdate({
          ...game,
          board: ns !== "playing" ? mkBoard() : nb,
          turn: nt,
          status: ns,
          epSquare: newEp,
          history: [...(history||[]), {notation:nota(sr,sc,r,c,board[sr][sc]), color:turn, ts:new Date().toISOString(), from:[sr,sc], to:[r,c]}],
          redoHistory: [],
          messages: (checkMsgData && !game.chatRoomId) ? [...(game.messages||[]), checkMsgData] : (game.messages||[]),
        });
        setSel(null); setLsq([]);
      } else if (p?.color===turn) { setSel([r,c]); setLsq(legal(board,r,c,effectiveCastling,effectiveEp)); }
      else { setSel(null); setLsq([]); }
    } else if (p?.color===turn) { setSel([r,c]); setLsq(legal(board,r,c,effectiveCastling,effectiveEp)); }
  };

  // プロモーション駒を選んで着手を確定
  const completePromotion = (promoteType) => {
    if (!promotionPending) return;
    const { fr, fc, tr, tc, isCapture, savedCastling } = promotionPending;
    const nb = applyMove(board, fr, fc, tr, tc, promoteType);
    const nt = turn==="w" ? "b" : "w";
    const nc = {
      wK:  savedCastling.wK,
      wQR: savedCastling.wQR && !(tr===7&&tc===0),
      wKR: savedCastling.wKR && !(tr===7&&tc===7),
      bK:  savedCastling.bK,
      bQR: savedCastling.bQR && !(tr===0&&tc===0),
      bKR: savedCastling.bKR && !(tr===0&&tc===7),
    };
    let ns = "playing"; if (!hasAny(nb,nt,nc)) ns = inCheck(nb,nt) ? `cm_${turn}` : "draw";
    if (ns !== "playing") { playSound("win"); }
    else if (inCheck(nb, nt)) { playSound("check"); }
    else if (isCapture) { playSound("capture"); }
    else { playSound("move"); }
    const movingPlayer = game.players?.[turn==="w"?"white":"black"] || (turn==="w"?"White":"Black");
    const isCheckNow = ns === "playing" && inCheck(nb, nt);
    const checkMsgData = isCheckNow ? {
      sender: movingPlayer,
      text: playerLang === "en" ? "♚ Check!" : "♚ チェック！",
      ts: new Date().toISOString(),
      isJP: playerLang !== "en",
      auto: true,
      gameId: game.id,
      gameType: "chess",
    } : null;
    if (checkMsgData && game.chatRoomId) {
      push(ref(db, `chat/${game.chatRoomId}`), checkMsgData).catch(() => {});
    }
    const promoBoard = board[fr][fc]; // 元のポーン
    onUpdate({
      ...game,
      board: ns !== "playing" ? mkBoard() : nb,
      turn: nt,
      status: ns,
      epSquare: null,
      history: [...(history||[]), {notation:nota(fr,fc,tr,tc,promoBoard,promoteType), color:turn, ts:new Date().toISOString(), from:[fr,fc], to:[tr,tc]}],
      redoHistory: [],
      messages: (checkMsgData && !game.chatRoomId) ? [...(game.messages||[]), checkMsgData] : (game.messages||[]),
    });
    const jaLabels = { Q:"クイーン", R:"ルーク", B:"ビショップ", N:"ナイト" };
    showAnnouncement(playerLang==="en"
      ? `Promotion: ${["Queen","Rook","Bishop","Knight"][["Q","R","B","N"].indexOf(promoteType)]}!`
      : `プロモーション：${jaLabels[promoteType]}！`);
    setPromotionPending(null);
  };

  const showKidsHints = isKids && myColor !== null;

  const threatenedSquares = useMemo(() => {
    if (!showKidsHints) return new Set();
    const myCol = myColor || turn;
    const oppCol = myCol === "w" ? "b" : "w";
    const threatened = new Set();
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if (board[r][c]?.color === oppCol)
          rawMoves(board, r, c).forEach(([nr, nc]) => {
            if (board[nr][nc]?.color === myCol) threatened.add(`${nr},${nc}`);
          });
    return threatened;
  }, [board, showKidsHints, myColor, turn]);

  // キッズヒント: 各脅かされたマスの攻撃者リスト {key: [{r,c,type},...]}
  const attackersMap = useMemo(() => {
    if (!showKidsHints) return {};
    const myCol = myColor || turn;
    const oppCol = myCol === "w" ? "b" : "w";
    const map = {};
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if (board[r][c]?.color === oppCol)
          rawMoves(board, r, c).forEach(([nr, nc]) => {
            if (board[nr][nc]?.color === myCol) {
              const key = `${nr},${nc}`;
              if (!map[key]) map[key] = [];
              map[key].push({ r, c, type: board[r][c].type });
            }
          });
    return map;
  }, [board, showKidsHints, myColor, turn]);

  const [kidsHintBubble, setKidsHintBubble] = useState(null);
  const kidsHintTimerRef = useRef(null);
  const showKidsHintBubble = (msg) => {
    if (kidsHintTimerRef.current) clearTimeout(kidsHintTimerRef.current);
    setKidsHintBubble({ msg, key: Date.now() });
    kidsHintTimerRef.current = setTimeout(() => setKidsHintBubble(null), 3000);
  };

  const handleTouchStart = (r, c, pc) => {
    if (!isKids || !pc) return;
    touchTimer.current = setTimeout(() => setPieceInfo({...pc, r, c}), 500);
  };
  const handleTouchEnd = () => {
    if (touchTimer.current) clearTimeout(touchTimer.current);
  };

  const rows = flipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
  const cols = flipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
  const last = history?.slice(-1)[0];
  const { trans: uiTrans, queue: queueTrans } = useContext(TransContext);
  const t = (ja, en) => {
    if (playerLang === "en") { if (ja) queueTrans(ja); return uiTrans[ja] || en; }
    return ja;
  };

  return (
    <>
    <div style={{
      position:"relative",
      background: flat ? "transparent" : "#e8d9c0",
      borderRadius: flat ? 0 : 12,
      border: flat ? "none" : "1.5px solid rgba(154,120,72,0.65)",
      padding:"14px 14px 0 14px",
      boxShadow: flat ? "none" : "0 6px 24px rgba(60,40,20,0.20), inset 0 1px 2px rgba(255,230,180,0.20)",
    }}>
      {/* キッズヒントバブル */}
      {kidsHintBubble && (
        <div key={kidsHintBubble.key} style={{
          position:"absolute", left:"50%", top:6, zIndex:50, pointerEvents:"none",
          background:"#fffbe6", border:"2.5px solid #f0c040", borderRadius:18,
          padding:"9px 18px 9px 14px", maxWidth:"90%", whiteSpace:"pre-wrap",
          textAlign:"center", fontSize:"clamp(13px,3.2vw,17px)", color:"#5a3a10", lineHeight:1.5,
          fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif",
          boxShadow:"0 4px 14px rgba(60,40,20,0.18)",
          animation:"kidsPopIn 0.35s ease-out",
        }}>
          💬 {kidsHintBubble.msg}
        </div>
      )}
      {/* SVGデコレーション：内側細線＋飾り点線 */}
      {!flat && <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:0,overflow:"hidden",borderRadius:12}} viewBox="0 0 100 100" preserveAspectRatio="none">
        <rect x="4" y="4" width="92" height="92" fill="none" stroke="#c4a46a" strokeWidth="0.5" opacity="0.35" rx="1.5"/>
        <rect x="7.5" y="7.5" width="85" height="85" fill="none" stroke="#b89a60" strokeWidth="0.4" opacity="0.25" rx="1" strokeDasharray="3,5"/>
      </svg>}
      {/* 真鍮留め風コーナー装飾 */}
      {!flat && [{top:2,left:2},{top:2,right:2},{bottom:2,left:2},{bottom:2,right:2}].map((pos,i) => (
        <svg key={i} style={{position:"absolute",...pos,width:11,height:11,pointerEvents:"none",zIndex:10,overflow:"visible"}} viewBox="0 0 10 10">
          <circle cx="5" cy="5" r="5" fill="#c8a84b" opacity="0.6"/>
          <circle cx="5" cy="5" r="3" fill="none" stroke="#a88830" strokeWidth="0.8" opacity="0.7"/>
          <circle cx="5" cy="5" r="1.2" fill="#a88830" opacity="0.6"/>
        </svg>
      ))}
    <div style={{display:"grid", gridTemplateColumns:"16px repeat(8, 1fr)", gridTemplateRows:"repeat(8, 1fr) 16px", width:"100%", aspectRatio:"1"}}>
      {rows.map((r,ri) => [
        <div key={`n${r}`} style={{display:"flex", alignItems:"center", justifyContent:"center", color:"#7a5c38", fontSize:10, fontWeight:400, gridColumn:1, gridRow:ri+1, fontFamily:"Georgia,serif", userSelect:"none", opacity:0.62, letterSpacing:"0.02em"}}>{8-r}</div>,
        ...cols.map((c,ci) => {
          const isLight = (r+c)%2===0;
          const isSel = sel?.[0]===r && sel?.[1]===c;
          const isLg = lsq.some(([lr,lc]) => lr===r && lc===c);
          const isCapture = showKidsHints && sel !== null
            && lsq.some(([lr,lc]) => lr===r && lc===c)
            && board[r][c]?.color !== undefined
            && board[r][c]?.color !== (myColor || turn);
          const isLast = (last?.from?.[0]===r && last?.from?.[1]===c) || (last?.to?.[0]===r && last?.to?.[1]===c);
          const grainL = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Cpath d='M0 12 Q10 11 20 12.5 Q30 14 40 12' stroke='%23b89555' stroke-width='0.3' fill='none' opacity='0.22'/%3E%3Cpath d='M0 27 Q15 26 25 28 Q35 29 40 27' stroke='%23b89555' stroke-width='0.25' fill='none' opacity='0.17'/%3E%3C/svg%3E\")";
          const grainD = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Cpath d='M0 10 Q12 9 22 10.5 Q32 12 40 10' stroke='%236a3f1e' stroke-width='0.3' fill='none' opacity='0.18'/%3E%3Cpath d='M0 28 Q8 27 20 29 Q30 30 40 28' stroke='%236a3f1e' stroke-width='0.25' fill='none' opacity='0.15'/%3E%3C/svg%3E\")";
          const bg = isLight ? `${grainL} , #EDE0C8` : `${grainD} , #D4A888`;
          const pc = board[r][c];
          const myCol = myColor || turn;
          const isThreatened = showKidsHints && threatenedSquares.has(`${r},${c}`) && pc?.color === myCol;
          return (
            <div key={`${r}${c}`}
              onClick={() => click(r,c)}
              onContextMenu={isKids && pc ? (e) => { e.preventDefault(); setPieceInfo({...pc, r, c}); } : undefined}
              onTouchStart={() => handleTouchStart(r, c, pc)}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchEnd}
              style={{gridColumn:ci+2, gridRow:ri+1, background:bg, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", position:"relative", aspectRatio:"1", overflow:"hidden"}}>
              {isSel && <div style={{position:"absolute",inset:0,background:"rgba(100,130,60,0.46)",pointerEvents:"none",zIndex:1}}/>}
              {!isSel && isLast && <div style={{position:"absolute",inset:0,background:"rgba(188,156,76,0.38)",pointerEvents:"none",zIndex:1}}/>}
              {isLg && <div style={{position:"absolute",borderRadius:"50%",background:pc?"none":"rgba(80,50,20,0.14)",border:pc?"2.5px solid rgba(80,50,20,0.18)":"none",width:pc?"92%":"32%",height:pc?"92%":"32%",pointerEvents:"none",zIndex:2}}/>}
              {isThreatened && (
                <div style={{position:"absolute", top:1, right:1, fontSize:18, lineHeight:1, pointerEvents:"none", zIndex:2, animation:"pulse 1.5s ease-in-out infinite"}}>⚠️</div>
              )}
              {pc && (
                <div style={{width:"100%", height:"92%", display:"flex", alignItems:"flex-end", justifyContent:"center", transform: (() => {
                  if (!rotateTopPieces) return "none";
                  const topColor = flipped ? "w" : "b";
                  return pc.color === topColor ? "rotate(180deg)" : "none";
                })(), animation: isCapture ? "blink 0.8s ease-in-out infinite" : "none"}}>
                  <img src={PIECE_IMG[pc.color+pc.type]} alt={pc.color+pc.type} style={{height:`${PIECE_SCALE[pc.color+pc.type]}%`, width:"auto", maxWidth:"100%", display:"block", pointerEvents:"none",
                    filter: pc.color==="w"
                      ? "drop-shadow(0 0 0.8px #3A2416) drop-shadow(0 0 0.8px #3A2416) drop-shadow(0px 1.8px 3px rgba(90,58,34,0.16))"
                      : "drop-shadow(0 0 0.6px #1a0e04) drop-shadow(0 0 0.6px #1a0e04) drop-shadow(0px 2.5px 2px rgba(74,46,16,0.32))"
                  }}/>
                </div>
              )}
            </div>
          );
        })
      ])}
      {cols.map((c,ci) => (
        <div key={`l${c}`} style={{gridColumn:ci+2, gridRow:9, display:"flex", alignItems:"center", justifyContent:"center", position:"relative", color:"#7a5c38", fontSize:10, fontWeight:400, fontFamily:"Georgia,serif", userSelect:"none", opacity:0.72, letterSpacing:"0.06em"}}>
          {colL(c)}
          {ci < 7 && <span style={{position:"absolute", right:"-1px", top:"50%", transform:"translateY(-50%)", fontSize:5, color:"#9a7848", opacity:0.45, lineHeight:1, pointerEvents:"none"}}>✦</span>}
        </div>
      ))}
    </div>
    {/* 下部ロゴ */}
    {!flat && <div style={{textAlign:"center", fontFamily:"Georgia,serif", fontSize:11, color:"#8a6a40", letterSpacing:"2px", opacity:0.45, padding:"7px 0 9px", userSelect:"none", pointerEvents:"none"}}>
      FAMILY CHESS — WOODEN TRAVELER SERIES
    </div>}
    {/* 特別手宣言オーバーレイ */}
    {announcement && (
      <div style={{position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none", zIndex:100}}>
        <div style={{background:"rgba(42,26,8,0.85)", color:"#f5ead8", borderRadius:12, padding:"12px 24px", fontSize:"clamp(20px,5vw,28px)", fontWeight:"bold", fontFamily:"'Cormorant Garamond',Georgia,serif", letterSpacing:"0.08em", boxShadow:"0 4px 20px rgba(0,0,0,0.4)", animation:"fadeInScale 0.3s ease-out", textAlign:"center"}}>
          {announcement}
        </div>
      </div>
    )}
    </div>
    {/* プロモーション駒選択モーダル */}
    {promotionPending && (
      <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.65)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:4000}}>
        <div style={{background:"#faf5e8", borderRadius:20, padding:"24px 28px", boxShadow:"0 12px 40px rgba(42,26,8,0.45)", border:"2px solid #c4a058", textAlign:"center", animation:"fadeInScale 0.25s ease-out"}}>
          <div style={{fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontSize:20, fontWeight:600, color:"#3a2e22", marginBottom:18, letterSpacing:"0.06em"}}>
            {playerLang==="en" ? "Choose a promotion piece" : "プロモーションの駒を選んでください"}
          </div>
          <div style={{display:"flex", gap:10, justifyContent:"center"}}>
            {(isKids ? ["Q","R"] : ["Q","R","B","N"]).map(type => {
              const pColor = promotionPending.tr === 0 ? "w" : "b";
              const labels = { Q: playerLang==="en"?"Queen":"クイーン", R: playerLang==="en"?"Rook":"ルーク", B: playerLang==="en"?"Bishop":"ビショップ", N: playerLang==="en"?"Knight":"ナイト" };
              return (
                <button key={type} onClick={() => completePromotion(type)} style={{
                  background:"#fffcf5", border:"2px solid #d4bc88", borderRadius:12,
                  padding:"10px 8px 6px", cursor:"pointer", width:74,
                  display:"flex", flexDirection:"column", alignItems:"center", gap:4,
                  transition:"border-color 0.15s, box-shadow 0.15s",
                }}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor="#c4a058"; e.currentTarget.style.boxShadow="0 4px 12px rgba(196,160,88,0.3)";}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor="#d4bc88"; e.currentTarget.style.boxShadow="none";}}
                >
                  <img src={PIECE_IMG[pColor+type]} style={{width:48, height:48, objectFit:"contain"}} alt={type} />
                  <span style={{fontSize:16, color:"#7a5838", fontFamily:"'Cormorant Garamond',Georgia,serif", letterSpacing:"0.04em"}}>{labels[type]}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    )}

    {pieceInfo && (
      <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:3000}} onClick={() => setPieceInfo(null)}>
        <div style={{background:"#fffdf8", borderRadius:20, padding:28, maxWidth:300, width:"85vw", textAlign:"center", boxShadow:"0 8px 32px rgba(60,40,20,0.20)", border:"1px solid #e0d4c0"}} onClick={e => e.stopPropagation()}>
          <img src={PIECE_IMG[pieceInfo.color + pieceInfo.type]} style={{width:80, height:80, margin:"0 auto 12px"}}/>
          <h3 style={{color:"#3a2e22", margin:"0 0 8px", fontSize:22}}>
            {playerLang === "ja" ? PIECE_INFO[pieceInfo.type].ja : PIECE_INFO[pieceInfo.type].en}
          </h3>
          <p style={{color:"#5a4830", fontSize:18, lineHeight:1.7, margin:"0 0 20px"}}>
            {playerLang === "ja" ? PIECE_INFO[pieceInfo.type].descJa : PIECE_INFO[pieceInfo.type].descEn}
          </p>
          <button onClick={() => setPieceInfo(null)} style={{background:"linear-gradient(135deg,#7a5638,#5a3e28)", border:"none", borderRadius:10, color:"#f5ead8", padding:"10px 32px", fontSize:18, cursor:"pointer", fontWeight:"bold"}}>OK</button>
        </div>
      </div>
    )}
    </>
  );
}

function SettingsPanel({ members, saveMembers, playerName, playerLang, onClose, onChangeUser, onRenamePlayer, inline = false }) {
  const [newName, setNewName] = useState("");
  const [newLang, setNewLang] = useState("ja");
  const [newKids, setNewKids] = useState(false);
  const [avatarPickerFor, setAvatarPickerFor] = useState(null); // メンバーindex
  const [avatarPreview, setAvatarPreview] = useState(null);    // {url} 確認中
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetPwInput, setResetPwInput] = useState("");
  const [resetPwError, setResetPwError] = useState(false);
  const { trans: uiTrans, queue: queueTrans } = useContext(TransContext);
  const t = (ja, en) => {
    if (playerLang === "en") { if (ja) queueTrans(ja); return uiTrans[ja] || en; }
    return ja;
  };

  // 管理者判定
  const isAdmin = playerName === "Honami";

  const btnActive   = {background:"linear-gradient(135deg,#D4A888,#b88a6a)", border:"none", borderRadius:6, color:"#3a2e22", padding:"4px 10px", cursor:"pointer", fontSize:18, fontWeight:"bold"};
  const btnInactive = {background:"#f5f0e8", border:"1px solid #d8c8a8", borderRadius:6, color:"#7a6858", padding:"4px 10px", cursor:"pointer", fontSize:18};
  const secLabel    = {display:"block", fontSize:18, fontWeight:500, color:"#9a8876", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", letterSpacing:"0.12em", marginBottom:10, lineHeight:1.6};

  const currentMember = members.find(m => m.name === playerName);
  const myIndex = members.findIndex(m => m.name === playerName);

  const inner = (
    <div style={{background:"#fffdf8", border: inline ? "none" : "1px solid #e0d4c0", borderRadius: inline ? 0 : 20, padding:24, width: inline ? "100%" : "min(420px,90vw)", maxHeight: inline ? "none" : "82vh", overflowY:"auto", display:"flex", flexDirection:"column", gap:18, textAlign:"center", boxShadow: inline ? "none" : "0 12px 40px rgba(60,40,20,0.18)", boxSizing:"border-box"}}>

        {/* ━━ セクション1: マイ設定 ━━ */}
        <div>
          <div style={{display:"flex", flexDirection:"column", gap:14, padding:"14px 16px", background:"#faf6f0", borderRadius:12, border:"1px solid #e0d4c0"}}>

            {/* アバター */}
            <div style={{display:"flex", alignItems:"center", justifyContent:"center", gap:14}}>
              <div onClick={() => setAvatarPickerFor(myIndex)} style={{cursor:"pointer", position:"relative", flexShrink:0}}>
                <AvatarIcon url={currentMember?.avatarUrl} size={60} name={playerName} />
                <div style={{position:"absolute", bottom:0, right:0, background:"#D4A888", borderRadius:"50%", width:20, height:20, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, color:"#3a2e22", pointerEvents:"none"}}>✏️</div>
              </div>
              <div style={{display:"flex", flexDirection:"column", gap:6}}>
                <div style={{fontSize:18, color:"#9a8876"}}>{t("アイコン（タップで変更）","Avatar (tap to change)")}</div>
                {currentMember?.avatarUrl && (
                  <button onClick={() => {
                    const updated = members.map(x => x.name===playerName ? {...x, avatarUrl:undefined} : x);
                    saveMembers(updated);
                  }} style={{background:"none", border:"1px solid #ffaaaa", borderRadius:6, color:"#cc4444", padding:"2px 10px", cursor:"pointer", fontSize:18, alignSelf:"flex-start"}}>
                    {t("削除","Remove")}
                  </button>
                )}
              </div>
            </div>

            {/* 言語 */}
            <div>
              <div style={{fontSize:18, color:"#9a8876", marginBottom:6}}>{t("表示言語","Language")}</div>
              <div style={{display:"flex", gap:6, justifyContent:"center"}}>
                {["ja","en"].map(lang => (
                  <button key={lang} onClick={() => {
                    const updated = members.map(x => x.name===playerName ? {...x, lang} : x);
                    saveMembers(updated);
                  }} style={currentMember?.lang===lang ? btnActive : btnInactive}>
                    {lang==="ja" ? "🇯🇵 日本語" : "🇺🇸 English"}
                  </button>
                ))}
              </div>
            </div>

            {/* 表示名 */}
            <div>
              <div style={{fontSize:18, color:"#9a8876", marginBottom:6}}>{t("表示名","Display Name")}</div>
              {editingName ? (
                <div style={{display:"flex", flexDirection:"column", gap:8, alignItems:"center"}}>
                  <input
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    maxLength={20}
                    style={{padding:"8px 12px", borderRadius:8, border:"1px solid #c8b090", fontSize:18, outline:"none", textAlign:"center", width:"100%", boxSizing:"border-box", background:"#fffdf8", color:"#3a2e22"}}
                  />
                  <div style={{display:"flex", gap:8}}>
                    <button onClick={() => {
                      const trimmed = nameInput.trim();
                      if (!trimmed || trimmed === playerName) { setEditingName(false); return; }
                      const updated = members.map(x => x.name===playerName ? {...x, name:trimmed} : x);
                      saveMembers(updated);
                      onRenamePlayer(trimmed);
                      setEditingName(false);
                    }} style={{...btnActive, padding:"6px 18px"}}>
                      {t("保存","Save")}
                    </button>
                    <button onClick={() => setEditingName(false)} style={{...btnInactive, padding:"6px 18px"}}>
                      {t("キャンセル","Cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{display:"flex", alignItems:"center", gap:8, justifyContent:"center"}}>
                  <span style={{fontWeight:"bold", fontSize:18, color:"#3a2e22"}}>{playerName}</span>
                  <button onClick={() => { setNameInput(playerName); setEditingName(true); }} style={{...btnInactive, padding:"4px 14px"}}>
                    ✏️ {t("変更","Edit")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

      {/* アバター選択ピッカー */}
      {avatarPickerFor !== null && (
        <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.65)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:2000}} onClick={() => setAvatarPickerFor(null)}>
          <div style={{background:"#fffdf8", borderRadius:20, padding:20, width:"min(500px,96vw)", maxHeight:"85vh", overflowY:"auto", display:"flex", flexDirection:"column", gap:12, border:"1px solid #e0d4c0"}} onClick={e => e.stopPropagation()}>
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
              <h3 style={{margin:0, color:"#3a2e22", fontSize:"clamp(18px,4vw,22px)"}}>
                {members[avatarPickerFor]?.name} — {t("アイコンを選択","Choose Avatar")}
              </h3>
              <button onClick={() => setAvatarPickerFor(null)} style={{background:"#f5f0e8", border:"1px solid #d8c8a8", borderRadius:8, color:"#7a6858", padding:"4px 10px", cursor:"pointer", fontSize:18}}>✕</button>
            </div>
            {/* 現在のアバター */}
            <div style={{display:"flex", alignItems:"center", gap:12, padding:"10px 14px", background:"#faf6f0", borderRadius:10, border:"1px solid #e0d4c0"}}>
              <AvatarIcon url={members[avatarPickerFor]?.avatarUrl} size={100} name={members[avatarPickerFor]?.name} />
              <div style={{flex:1}}>
                <div style={{fontSize:18, color:"#8a5a3a", fontWeight:"bold"}}>
                  {members[avatarPickerFor]?.avatarUrl ? t("現在選択中","Currently selected") : t("未設定（👤 表示）","Not set (shows 👤)")}
                </div>
                {members[avatarPickerFor]?.avatarUrl && (
                  <button onClick={() => {
                    const updated = members.map((x,k) => k===avatarPickerFor ? {...x, avatarUrl:undefined} : x);
                    saveMembers(updated);
                  }} style={{marginTop:4, background:"none", border:"1px solid #ffaaaa", borderRadius:6, color:"#cc4444", padding:"2px 10px", cursor:"pointer", fontSize:18}}>
                    {t("削除","Remove")}
                  </button>
                )}
              </div>
            </div>
            {/* 36枚グリッド */}
            <div style={{display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10}}>
              {Array.from({length:36}, (_, j) => {
                const url = `/avatars/${j+1}.webp`;
                const currentMember = members[avatarPickerFor];
                const isSel = currentMember?.avatarUrl === url;
                // このアイコンを使用中の他ユーザーを取得
                const usersWithThis = members.filter((m, k) => m.avatarUrl === url && k !== avatarPickerFor);
                return (
                  <div key={j} onClick={() => setAvatarPreview({ url })} style={{
                    position:"relative", cursor:"pointer", borderRadius:8,
                    border: isSel ? "2px solid #D4A888" : "1px solid #e0d4c0",
                    overflow:"visible",
                    boxShadow: isSel ? "0 0 0 2px #c8a060" : "none",
                  }}>
                    <img src={url} alt={`avatar ${j+1}`} style={{width:"100%", aspectRatio:"1", objectFit:"cover", display:"block", borderRadius:6}}/>
                    {/* 自分が使用中 */}
                    {isSel && (
                      <div style={{position:"absolute", top:2, right:2, background:"#D4A888", color:"#3a2e22", borderRadius:"50%", width:20, height:20, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, fontWeight:"bold", zIndex:1}}>✓</div>
                    )}
                    {/* 使用中ラベル（自分 or 他ユーザー） */}
                    {(isSel || usersWithThis.length > 0) && (
                      <div style={{
                        position:"absolute", bottom:-1, left:0, right:0,
                        background: isSel ? "rgba(100,70,30,0.88)" : "rgba(60,48,36,0.80)",
                        color:"#f5ead8", fontSize:18, fontWeight:"bold",
                        textAlign:"center", padding:"1px 2px", borderRadius:"0 0 5px 5px",
                        whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
                        lineHeight:1.4,
                      }}>
                        {isSel
                          ? t("使用中","In Use")
                          : usersWithThis.map(m => m.name).join("・")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <button onClick={() => setAvatarPickerFor(null)} style={{background:"#f5f0e8", border:"1px solid #d8c8a8", borderRadius:10, color:"#7a6858", padding:"10px", cursor:"pointer", fontSize:18}}>
              {t("閉じる","Close")}
            </button>
          </div>
        </div>
      )}

      {/* アバター確認プレビュー */}
      {avatarPreview && (
        <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.84)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", zIndex:3000}}>
          <img
            src={avatarPreview.url.replace('/avatars/', '/avatars_large/')}
            alt="preview"
            style={{width:"min(300px, 80vw, 80vh)", height:"min(300px, 80vw, 80vh)", borderRadius:"50%", objectFit:"cover", border:"3px solid rgba(245,234,216,0.8)", boxShadow:"0 8px 40px rgba(0,0,0,0.5)", marginBottom:24}}
          />
          <div style={{display:"flex", gap:16}}>
            <button onClick={() => {
              const updated = members.map((x,k) => k===avatarPickerFor ? {...x, avatarUrl: avatarPreview.url} : x);
              saveMembers(updated);
              setAvatarPreview(null);
              setAvatarPickerFor(null);
            }} style={{background:"linear-gradient(135deg,#D4A888,#b88a6a)", border:"none", borderRadius:12, color:"#3a2e22", padding:"12px 28px", fontSize:18, fontWeight:"bold", cursor:"pointer", boxShadow:"0 4px 16px rgba(90,60,30,0.35)"}}>
              {t("これにする","Select")}
            </button>
            <button onClick={() => setAvatarPreview(null)} style={{background:"rgba(255,255,255,0.15)", border:"2px solid rgba(255,255,255,0.5)", borderRadius:12, color:"#ffffff", padding:"12px 28px", fontSize:18, fontWeight:"bold", cursor:"pointer"}}>
              {t("戻る","Back")}
            </button>
          </div>
        </div>
      )}

        {/* ━━ セクション4: メンバーを追加 ━━ */}
        <div style={{display:"flex", flexDirection:"column", gap:10, padding:"14px", background:"#faf6f0", borderRadius:10, border:"1px dashed #c8b090", alignItems:"center"}}>
          <span style={{...secLabel, marginBottom:4}}>➕ {t("メンバーを追加","Add Member")}</span>
          <input
            value={newName} onChange={e => setNewName(e.target.value)}
            placeholder={t("名前を入力", "Enter name")}
            style={{padding:"8px 12px", borderRadius:8, border:"1px solid #c8b090", fontSize:18, outline:"none", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", background:"#fffdf8", color:"#3a2e22", width:"100%", boxSizing:"border-box"}}
          />
          <div style={{display:"flex", gap:6}}>
            {["ja","en"].map(lang => (
              <button key={lang} onClick={() => setNewLang(lang)} style={newLang===lang ? btnActive : btnInactive}>
                {lang==="ja" ? "🇯🇵 日本語" : "🇺🇸 English"}
              </button>
            ))}
          </div>
          <label style={{display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontSize:18, color:"#5a4030"}}>
            <input type="checkbox" checked={newKids} onChange={e=>setNewKids(e.target.checked)}/>
            🧒 {t("キッズモード","Kids Mode")}
          </label>
          <button onClick={() => {
            const n = newName.trim();
            if (!n) return;
            if (members.find(m => m.name === n)) return;
            if (members.length >= 10) {
              alert(t("メンバーは最大10人までです", "Maximum 10 members allowed"));
              return;
            }
            saveMembers([...members, {name:n, lang:newLang, kids:newKids}]);
            setNewName(""); setNewKids(false);
          }} style={{background:"linear-gradient(135deg,#D4A888,#b88a6a)", border:"none", borderRadius:8, color:"#3a2e22", padding:"8px 12px", cursor:"pointer", fontSize:18, fontWeight:"bold", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", width:"100%"}}>
            {t("追加", "Add")}
          </button>
        </div>

        {/* リセットは管理者のみ */}
        {isAdmin && (<>
          <button onClick={() => { setShowResetModal(true); setResetPwInput(""); setResetPwError(false); }} style={{
            background:"linear-gradient(135deg,#c03020,#8a1810)",
            border:"none", borderRadius:10, color:"#fff5f0",
            padding:"12px", cursor:"pointer", fontSize:18, fontWeight:"bold",
            marginTop:8,
          }}>
            🗑 {t("全試合データをリセット","Reset All Game Data")}
          </button>

          {/* 2段階リセット確認モーダル */}
          {showResetModal && (
            <div onClick={() => setShowResetModal(false)} style={{position:"fixed", inset:0, background:"rgba(20,10,5,0.72)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9000, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif"}}>
              <div onClick={e => e.stopPropagation()} style={{background:"linear-gradient(160deg,#2a1e14,#1a120c)", border:"2px solid #8a1810", borderRadius:16, padding:"28px 24px", maxWidth:360, width:"90%", color:"#f5ead8"}}>
                <div style={{fontSize:26, fontWeight:"bold", color:"#f07060", marginBottom:8, textAlign:"center"}}>⚠️ {t("データリセット確認","Confirm Data Reset")}</div>
                <p style={{fontSize:16, color:"#d8c8b0", marginBottom:16, lineHeight:1.6, textAlign:"center"}}>
                  {t("全ての試合データが削除されます。この操作は取り消せません。","All game data will be deleted. This cannot be undone.")}
                </p>
                <p style={{fontSize:15, color:"#c0a888", marginBottom:8}}>
                  {t("確認のためパスワードを入力してください：","Enter the password to confirm:")}
                </p>
                <input
                  type="password"
                  value={resetPwInput}
                  onChange={e => { setResetPwInput(e.target.value); setResetPwError(false); }}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      if (resetPwInput === APP_PASSWORD) {
                        setShowResetModal(false);
                        const defaultGames = mkGames();
                        set(ref(db, "gamesData"), JSON.stringify(defaultGames));
                        alert(t("リセットしました。ページを再読み込みしてください。","Reset complete. Please reload the page."));
                      } else {
                        setResetPwError(true);
                      }
                    }
                  }}
                  placeholder={t("パスワード", "Password")}
                  style={{width:"100%", boxSizing:"border-box", padding:"10px 12px", borderRadius:8, border: resetPwError ? "2px solid #f07060" : "1px solid #6a4a3a", background:"#1a120c", color:"#f5ead8", fontSize:17, outline:"none", marginBottom:4}}
                  autoFocus
                />
                {resetPwError && <div style={{color:"#f07060", fontSize:15, marginBottom:8}}>{t("パスワードが違います","Incorrect password")}</div>}
                <div style={{display:"flex", gap:10, marginTop:14}}>
                  <button onClick={() => setShowResetModal(false)} style={{flex:1, padding:"10px", borderRadius:10, border:"1px solid #6a4a3a", background:"transparent", color:"#c0a888", cursor:"pointer", fontSize:17}}>
                    {t("キャンセル","Cancel")}
                  </button>
                  <button onClick={() => {
                    if (resetPwInput === APP_PASSWORD) {
                      setShowResetModal(false);
                      const defaultGames = mkGames();
                      set(ref(db, "gamesData"), JSON.stringify(defaultGames));
                      alert(t("リセットしました。ページを再読み込みしてください。","Reset complete. Please reload the page."));
                    } else {
                      setResetPwError(true);
                    }
                  }} style={{flex:1, padding:"10px", borderRadius:10, border:"none", background:"linear-gradient(135deg,#c03020,#8a1810)", color:"#fff5f0", cursor:"pointer", fontSize:17, fontWeight:"bold"}}>
                    🗑 {t("リセット実行","Execute Reset")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>)}
      </div>
  );

  if (inline) return inner;
  return (
    <div style={{position:"fixed", inset:0, background:"rgba(30,20,10,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000}}>
      {inner}
    </div>
  );
}

function GamePanel({ game, onUpdate, playerName, playerLang, gameIndex, onStartModal, memberNames, isKids, members, pcLayout = false, faceToFaceActive = false, onFaceToFaceEnd = null, onToggleLayout = null, gameMsgSeenTs = "", onMsgSeen = null, onFaceToFaceChange = null }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [faceToFace, setFaceToFace] = useState(false);
  // PC対面モード：外部stateを優先
  const activeFaceToFace = pcLayout ? faceToFaceActive : faceToFace;
  const enterFaceToFace = () => { setFaceToFace(true); onFaceToFaceChange?.(true); };
  const exitFaceToFace = () => { if (pcLayout) { onFaceToFaceEnd?.(); } else { setFaceToFace(false); onFaceToFaceChange?.(false); } };
  const [f2fTurn, setF2fTurn] = useState(null);
  const [showMsgModal, setShowMsgModal] = useState(false);
  // 吹き出し用：翻訳が保存されていないメッセージの翻訳キャッシュ { [ts]: string }
  const [extraTrans, setExtraTrans] = useState({});
  const [chatMessages, setChatMessages] = useState([]);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showWinModal, setShowWinModal] = useState(false);
  const [winModalMsg, setWinModalMsg] = useState({ emoji:"", title:"", subtitle:"" });
  const capturedPlayersRef = useRef({ white:"", black:"" });
  const prevStatusRef = useRef(game.status);
  const chatRoomId = game.chatRoomId || null;
  const { name, turn, history, status } = game;
  const allMessages = chatRoomId ? chatMessages : (game.messages || []);
  // ゲーム開始後のメッセージのみ表示
  // startedAt が未設定の場合は最初の指し手タイムスタンプをフォールバックとして使用
  const gameStartedAt = game.startedAt || (history?.length > 0 ? history[0].ts : null);
  const messages = allMessages.filter(m =>
    (!gameStartedAt || m.ts >= gameStartedAt) &&
    m.gameId === game.id
  );

  // ── リアクション機能 ─────────────────────────────────────────────
  const myGameColor = game.players
    ? (game.players.white === playerName ? "w" : game.players.black === playerName ? "b" : null)
    : null;
  const [reactionBar, setReactionBar]   = useState(false); // 相手手番後3秒表示
  const [reactionAnim, setReactionAnim] = useState(null);  // 受信アニメーション {emoji,key}
  const reactionBarTimerRef = useRef(null);
  const prevHistLenRef = useRef((game.history || []).length);

  // 相手が指したらリアクションバーを3秒表示
  useEffect(() => {
    const hist = game.history || [];
    const len = hist.length;
    if (len > prevHistLenRef.current && myGameColor && game.status === "playing") {
      const lastColor = hist[len - 1]?.color;
      if (lastColor && lastColor !== myGameColor) {
        if (reactionBarTimerRef.current) clearTimeout(reactionBarTimerRef.current);
        setReactionBar(true);
        reactionBarTimerRef.current = setTimeout(() => setReactionBar(false), 3000);
      }
    }
    prevHistLenRef.current = len;
  }, [(game.history || []).length]); // eslint-disable-line react-hooks/exhaustive-deps

  // gameReactions/{gameId} を購読して受信アニメーション
  useEffect(() => {
    if (!game.id) return;
    const r = ref(db, `gameReactions/${game.id}`);
    const unsub = onValue(r, snap => {
      const d = snap.val();
      if (d && d.from && d.from !== playerName && d.emoji) {
        setReactionAnim({ emoji: d.emoji, key: Date.now() });
        setTimeout(() => setReactionAnim(null), 2000);
      }
    });
    return () => unsub();
  }, [game.id, playerName]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendGameReaction = (emoji) => {
    setReactionBar(false);
    if (reactionBarTimerRef.current) clearTimeout(reactionBarTimerRef.current);
    // Firebase に一時保存（相手がアニメーション表示）
    const reactionData = { emoji, from: playerName, ts: Date.now() };
    set(ref(db, `gameReactions/${game.id}`), reactionData).catch(() => {});
    setTimeout(() => set(ref(db, `gameReactions/${game.id}`), null).catch(() => {}), 3000);
    // チャットに記録
    if (game.chatRoomId) {
      const logMsg = {
        text: playerLang === "en"
          ? `${playerName} sent ${emoji}`
          : `${playerName}が ${emoji} を送りました`,
        sender: playerName,
        ts: new Date().toISOString(),
        isJP: playerLang !== "en",
        reactionEmoji: emoji,
        auto: true,
        gameId: game.id,
        gameType: "chess",
      };
      push(ref(db, `chat/${game.chatRoomId}`), logMsg).catch(() => {});
    }
  };

  // 対面モード：盤面エリアの実測サイズ（ResizeObserver で正確に計算）
  const [boardAreaNode, setBoardAreaNode] = useState(null);
  const boardAreaRefCb = useCallback(node => setBoardAreaNode(node), []);
  const [boardPx, setBoardPx] = useState(0);
  const [chessF2FAreaW, setChessF2FAreaW] = useState(0);
  const [chessF2FAreaH, setChessF2FAreaH] = useState(0);
  useEffect(() => {
    if (!boardAreaNode) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBoardPx(Math.floor(Math.min(width - 4, height)));
      setChessF2FAreaW(Math.floor(width));
      setChessF2FAreaH(Math.floor(height));
    });
    ro.observe(boardAreaNode);
    return () => ro.disconnect();
  }, [boardAreaNode]);

  // チェス盤の実測幅（取り駒サイズ計算用）
  const [chessBoardWidthPx, setChessBoardWidthPx] = useState(0);
  const chessBoardRefCb = useCallback((node) => {
    if (!node) return;
    const ro = new ResizeObserver(([entry]) => {
      setChessBoardWidthPx(Math.floor(entry.contentRect.width));
    });
    ro.observe(node);
  }, []);
  const chessCellPx = chessBoardWidthPx > 0 ? Math.floor((chessBoardWidthPx - 16) / 8) : 40;

  useEffect(() => {
    if (!chatRoomId) { setChatMessages([]); return; }
    const msgRef = ref(db, `chat/${chatRoomId}`);
    const unsub = onValue(msgRef, snap => {
      const data = snap.val();
      const arr = data
        ? Object.entries(data).map(([id, m]) => ({ id, ...m })).sort((a,b) => a.ts > b.ts ? 1 : -1)
        : [];
      setChatMessages(arr);
    });
    return () => unsub();
  }, [chatRoomId]);

  // 吹き出しに表示されたメッセージは既読とみなす（ゲーム終了後に通知が来ないようにする）
  useEffect(() => {
    if (!chatRoomId || !playerName || messages.length === 0) return;
    const latestTs = messages.reduce((max, m) => (m.ts > max ? m.ts : max), "");
    if (latestTs) {
      set(ref(db, `userReadTs/${playerName}/${chatRoomId}`), latestTs);
    }
  }, [chatRoomId, playerName, messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // プレイヤー名を保持（投了後にクリアされても名前を表示するため）
  useEffect(() => {
    if (game.players?.white) capturedPlayersRef.current.white = game.players.white;
    if (game.players?.black) capturedPlayersRef.current.black = game.players.black;
  }, [game.players?.white, game.players?.black]); // eslint-disable-line react-hooks/exhaustive-deps

  // 勝利・敗北モーダル表示トリガー
  useEffect(() => {
    const s = game.status;
    if (s === prevStatusRef.current) return;
    prevStatusRef.current = s;
    if (!s) return;
    const isTerminal = s.startsWith("cm") || s.startsWith("resign") || s === "draw";
    if (!isTerminal) return;
    const wn = capturedPlayersRef.current.white || (playerLang === "en" ? "White" : "白");
    const bn = capturedPlayersRef.current.black || (playerLang === "en" ? "Black" : "黒");
    let emoji = "🤝", title = "", subtitle = "";
    if (s === "draw") {
      title = playerLang === "en" ? "Draw!" : "引き分け！";
      subtitle = playerLang === "en" ? "No winner this time." : "勝負がつきませんでした。";
    } else {
      const winnerColor = s.endsWith("w") ? "w" : "b";
      const winnerName  = winnerColor === "w" ? wn : bn;
      emoji   = "🏆";
      title   = playerLang === "en" ? `${winnerName} wins!` : `${winnerName} の勝ち！`;
      subtitle = s.startsWith("cm")
        ? (playerLang === "en" ? "by Checkmate" : "チェックメイト")
        : (playerLang === "en" ? "by Resignation" : "投了");
    }
    setWinModalMsg({ emoji, title, subtitle });
    setShowWinModal(true);
  }, [game.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const { trans: uiTrans, queue: queueTrans } = useContext(TransContext);
  const t = (ja, en, kidsJa, kidsEn) => {
    if (isKids) {
      if (playerLang === "en") return kidsEn || uiTrans[ja] || en;
      return kidsJa || ja;
    }
    if (playerLang === "en") { if (ja) queueTrans(ja); return uiTrans[ja] || en; }
    return ja;
  };
  const myTz = playerLang === "en" ? "US" : "JP";

  const handleBoardUpdate = (updated) => {
    // 終局時は history を消さない — AutoAnalyzer が棋譜を読んで解析するため
    // （次の対局開始時に start modal が history:[] でリセットする）
    onUpdate(updated);
    if (updated.status && updated.status !== game.status) {
      let winner = "";
      if (updated.status.startsWith("cm")) {
        winner = updated.status.endsWith("w") ? updated.players?.white : updated.players?.black;
      } else if (updated.status.startsWith("resign")) {
        winner = updated.status.endsWith("w") ? updated.players?.white : updated.players?.black;
      }
      if (winner) { playSound("win"); }
    }
  };


  // myColor derived from game.players — restricts moves to participants only
  const myColor = (() => {
    if (game.status !== "playing") return null;
    if (!game.players?.white && !game.players?.black) return null;
    const isWhite = game.players?.white === playerName;
    const isBlack = game.players?.black === playerName;
    if (!isWhite && !isBlack) return null;
    return isWhite ? "w" : "b";
  })();

  // flipped managed in localStorage only — not synced via Firebase
  const [localFlipped, setLocalFlipped] = useState(() => {
    const stored = localStorage.getItem(`game_${game.id}_flipped`);
    if (stored !== null) return stored === "true";
    return myColor === "b";
  });

  const setFlipped = (val) => {
    setLocalFlipped(val);
    localStorage.setItem(`game_${game.id}_flipped`, String(val));
  };

  // Re-sync when a new game starts or the active player switches
  useEffect(() => {
    const newFlip = myColor === "b";
    setLocalFlipped(newFlip);
    localStorage.setItem(`game_${game.id}_flipped`, String(newFlip));
  }, [game.id, game.players?.white, game.players?.black, playerName]);

  const whiteName = game.players?.white || t("白", "White");
  const blackName = game.players?.black || t("黒", "Black");
  const currentName = turn === "w" ? whiteName : blackName;
  const statusText = status === "playing"
    ? ""
    : status === "draw"    ? t("引き分け","Draw","ひきわけ！","It's a Draw!")
    : status?.startsWith("resign")
      ? `🏳️ ${status.endsWith("w") ? whiteName : blackName} ${t("の勝ち（投了）"," wins (Resign)","のかち！"," wins!")}`
    : status?.startsWith("cm")
      ? `♚ ${status.endsWith("w") ? whiteName : blackName} ${t("の勝ち（チェックメイト）"," wins (Checkmate)","のかち！すごい！"," wins! Amazing!")}`
    : "";

  const sendMsg = async () => {
    const tx = msg.trim(); if (!tx || busy) return;
    setBusy(true);
    try {
      const tr = tx ? await translate(tx) : "";
      const isJP = tx ? /[\u3000-\u9fff]/.test(tx) : false;
      const ts = new Date().toISOString();
      const newMsg = { text: tx || "", translation: tr, isJP, ts, sender: playerName, gameId: game.id, gameType: "chess", gameName: `No.${gameIndex+1}` };
      if (chatRoomId) {
        await push(ref(db, `chat/${chatRoomId}`), newMsg);
      } else {
        const MAX_MSGS = 50;
        const next = [...(game.messages||[]), newMsg];
        onUpdate({...game, messages: next.length > MAX_MSGS ? next.slice(-MAX_MSGS) : next});
      }
      setMsg("");
      onMsgSeen?.();
    } catch(e) { console.error("sendMsg error:", e); }
    setBusy(false);
  };

  // 手を打ったらメッセージ通知をクリア
  const prevChessHistLen = useRef((game.history||[]).length);
  useEffect(() => {
    const newLen = (game.history||[]).length;
    if (newLen > prevChessHistLen.current) { onMsgSeen?.(); prevChessHistLen.current = newLen; }
  }, [(game.history||[]).length]); // eslint-disable-line
  // パネルが表示された時点で通知をクリア
  useEffect(() => { onMsgSeen?.(); }, []); // eslint-disable-line

  const btnPrimary   = {background:"linear-gradient(135deg,#D4A888,#b88a6a)", border:"none", borderRadius:2, color:"#3a2e22", cursor:"pointer", fontWeight:600, boxShadow:"0 4px 12px rgba(180,120,80,0.22)", letterSpacing:"0.04em"};
  const btnSecondary = {background:WT.surfaceHi, border:`1px solid ${WT.border}`, borderRadius:2, color:WT.text, cursor:"pointer", letterSpacing:"0.03em"};

  // Board top/bottom based on localFlipped (not game.flipped)
  const topColor    = localFlipped ? "w" : "b";
  const topName     = (game.status === "waiting" || game.status === "ended")
    ? (topColor === "w" ? t("ユーザー1","User 1") : t("ユーザー2","User 2"))
    : (topColor === "w" ? game.players?.white : game.players?.black) || (topColor === "w" ? t("ユーザー1","User 1") : t("ユーザー2","User 2"));
  const bottomColor = localFlipped ? "b" : "w";
  const bottomName  = (game.status === "waiting" || game.status === "ended")
    ? (bottomColor === "w" ? t("ユーザー1","User 1") : t("ユーザー2","User 2"))
    : (bottomColor === "w" ? game.players?.white : game.players?.black) || (bottomColor === "w" ? t("ユーザー1","User 1") : t("ユーザー2","User 2"));
  const isMe = bottomColor === myColor;

  // 吹き出し表示用：翻訳未保存メッセージをバックグラウンドで取得
  useEffect(() => {
    const allMsgs = messages || [];
    // 上下吹き出し対象（各ユーザーの最新メッセージ）
    const candidates = [topName, bottomName]
      .map(name => [...allMsgs].reverse().find(m => m.sender === name))
      .filter(Boolean);
    candidates.forEach(async m => {
      if (!m.ts) return;
      if (m.translation) return;               // 翻訳あり → 不要
      if (extraTrans[m.ts] !== undefined) return; // 取得済み or 取得中 → スキップ
      setExtraTrans(prev => ({ ...prev, [m.ts]: null })); // null = 取得中
      const tr = await translate(m.text || "");
      setExtraTrans(prev => ({ ...prev, [m.ts]: tr || "" }));
    });
  }, [messages, topName, bottomName]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 取得駒計算（通常ボード・対面モード共通） ──────────────────────
  const PIECE_VALUES = { Q:9, R:5, B:3, N:3, P:1, K:0 };
  const pieceScore = (pieces) => pieces.reduce((s, p) => s + (PIECE_VALUES[p.type]||0), 0);
  const initCounts = { P:8, R:2, N:2, B:2, Q:1 };
  const countPieces = (board, color) => {
    const counts = {};
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if (board?.[r]?.[c]?.color === color) counts[board[r][c].type] = (counts[board[r][c].type]||0)+1;
    return counts;
  };
  const whiteCounts = countPieces(game.board, "w");
  const blackCounts = countPieces(game.board, "b");
  // capturedByWhite = 白が取った駒（盤上から消えた黒駒）
  const capturedByWhite = Object.entries(initCounts).flatMap(([type, n]) =>
    Array(Math.max(0, n - (blackCounts[type]||0))).fill({type, color:"b"})
  );
  // capturedByBlack = 黒が取った駒（盤上から消えた白駒）
  const capturedByBlack = Object.entries(initCounts).flatMap(([type, n]) =>
    Array(Math.max(0, n - (whiteCounts[type]||0))).fill({type, color:"w"})
  );

  // チェス取り駒行コンポーネント（将棋と同じ位置・同じサイズで表示）
  const ChessCapturedRow = ({pieces, cellPx}) => {
    const cs = cellPx || chessCellPx || 40;
    if (!pieces || pieces.length === 0) return <div style={{minHeight: Math.floor(cs * 0.8 / 2) + 4}}/>;
    return (
      <div style={{display:"flex", flexWrap:"wrap", gap:2, padding:"4px 0 4px 16px", alignItems:"flex-end", minHeight:Math.round(cs * 0.8) + 8}}>
        {pieces.map((p, i) => (
          <div key={i} style={{width:Math.round(cs * 0.8), height:Math.round(cs * 0.8), display:"flex", alignItems:"flex-end", justifyContent:"center", flexShrink:0}}>
            <img src={PIECE_IMG[p.color + p.type]} alt={p.color + p.type}
              style={{height:`${PIECE_SCALE[p.color + p.type] || 85}%`, width:"auto", maxWidth:"100%", display:"block", pointerEvents:"none"}}/>
          </div>
        ))}
      </div>
    );
  };
  const topCaptures    = topColor    === "w" ? capturedByWhite : capturedByBlack;
  const bottomCaptures = bottomColor === "w" ? capturedByWhite : capturedByBlack;

  if (activeFaceToFace) {
    if (myColor === null) {
      exitFaceToFace();
      return null;
    }
    const myColorInGame = myColor;
    const f2fBottomColor = myColorInGame || (game.players?.white === playerName ? "w" : "b");
    const f2fTopColor = f2fBottomColor === "w" ? "b" : "w";
    const bottomPlayerName = playerName;
    const topPlayerName = f2fTopColor === "w" ? game.players?.white : game.players?.black;
    const isMyTurn = game.turn === f2fBottomColor;
    const isBottomTurn = game.turn === f2fBottomColor;
    const isTopTurn = !isBottomTurn;
    const bottomColor = f2fBottomColor;
    const topColor = f2fTopColor;
    const f2fFlipped = f2fBottomColor === "b";

    const f2fBottomCaptured = f2fBottomColor === "w" ? capturedByWhite : capturedByBlack;
    const f2fTopCaptured    = f2fTopColor    === "w" ? capturedByWhite : capturedByBlack;
    // チェス対面: 幅・高さ両方から最適セルサイズを算出（将棋と同じ方式）
    // 盤面全幅: 8*cs + 16px ラベル列
    // 全高さ: 8*cs(board) + 16px(ファイルラベル行) + 2*(cs*0.8+16)(取り駒行) = 9.6cs + 48
    const f2fCellPx = (chessF2FAreaW > 0 && chessF2FAreaH > 0)
      ? Math.max(20, Math.floor(Math.min(
          (chessF2FAreaW - 24) / 8,
          (chessF2FAreaH - 48) / 9.6
        )))
      : boardPx > 0 ? Math.floor((boardPx - 16) / 8) : (chessCellPx || 40);
    const f2fBoardPx = f2fCellPx * 8 + 16;

    // ── 対面モード プレイヤー情報バー ────────────────────────────────
    const F2FInfoBar = ({ color, name: pname, isMyTurn, onResign }) => (
      <div style={{
        display:"flex", alignItems:"center", gap:6,
        padding:"4px 10px",
        maxWidth:560, width:"100%", boxSizing:"border-box",
        background:isMyTurn?(color==="w"?"rgba(255,235,185,0.22)":"rgba(90,55,25,0.28)"):"rgba(255,255,255,0.05)",
        borderRadius:8,
        border:isMyTurn?(color==="w"?"2px solid rgba(196,160,80,0.55)":"2px solid rgba(160,100,50,0.55)"):"1px solid rgba(255,255,255,0.1)",
      }}>
        <span style={{background:color==="w"?"#fffdf0":"#3a2010", color:color==="w"?"#5a3808":"#f5e8d0", border:color==="w"?"2px solid #c4a058":"2px solid #8a6030", borderRadius:5, padding:"1px 7px", fontSize:"clamp(18px,4vw,21px)", fontWeight:"bold", flexShrink:0}}>
          {color==="w"?"⬜ "+t("白","W","しろ","W"):"⬛ "+t("黒","B","くろ","B")}
        </span>
        <span style={{color:isMyTurn?"#f5c878":"rgba(240,210,175,0.60)", fontSize:"clamp(18px,4vw,21px)", fontWeight:"bold", animation:isMyTurn?"pulse 1.5s ease-in-out infinite":"none", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flexShrink:1}}>
          {isMyTurn ? t(`${pname}さんの番`,`${pname}'s turn`,`${pname}のばん`,`${pname}'s turn`) : pname}
        </span>
        {isMyTurn && onResign && game.status === "playing" && (
          <button onClick={onResign} style={{background:"transparent", border:"1px solid #c8b090", borderRadius:6, color:"#7a5838", padding:"4px 10px", cursor:"pointer", fontSize:18, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", flexShrink:0, marginLeft:"auto"}}>
            {t("投了","Resign","まけた","Resign")}
          </button>
        )}
      </div>
    );

    const exitBtn = (
      <button onClick={exitFaceToFace} style={{position:"absolute", top:"calc(env(safe-area-inset-top) + 6px)", right:8, zIndex:10, background:"rgba(255,255,255,0.12)", border:"1px solid rgba(255,255,255,0.25)", borderRadius:8, color:"#ffffff", padding:"5px 10px", cursor:"pointer", fontSize:"clamp(18px,4vw,21px)", whiteSpace:"nowrap"}}>
        ✕ {t("終了","Exit","もどる","Exit")}
      </button>
    );

    return (
      <div style={{
        position:"fixed", inset:0,
        paddingTop:"env(safe-area-inset-top)",
        paddingBottom:"env(safe-area-inset-bottom)",
        background:"#2a1808",
        display:"flex", flexDirection:"column",
        zIndex:2000, overflow:"hidden",
        fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif",
        boxSizing:"border-box",
      }}>
        {/* 上側エリア：プレイヤー情報（180度回転）+ 終了ボタン（absolute配置で常時表示） */}
        {exitBtn}
        <div style={{display:"flex", alignItems:"center", justifyContent:"center", padding:"2px 6px", paddingRight:90, flexShrink:0}}>
          <div style={{transform:"rotate(180deg)", width:"100%", maxWidth:560}}>
            <F2FInfoBar
              color={topColor} name={topPlayerName} isMyTurn={isTopTurn}
              onResign={isTopTurn ? () => {
                if (window.confirm(t(`${topPlayerName} が投了しますか？`, `Does ${topPlayerName} want to resign?`))) {
                  onUpdate({...game, status:`resign_${topColor==="w"?"b":"w"}`});
                  playSound("win"); exitFaceToFace();
                }
              } : null}
            />
          </div>
        </div>

        {/* 盤面（flex:1 で残り全スペース・ResizeObserver で正確にサイズ計算） */}
        <div ref={boardAreaRefCb} style={{flex:1, minHeight:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"1px 4px", overflow:"hidden"}}>
          {/* 上側取り駒（相手の取り駒 = 上手番プレイヤーが取った駒）180度回転 */}
          <div style={{transform:"rotate(180deg)", width: f2fBoardPx > 0 ? `${f2fBoardPx}px` : "min(calc(100vw - 8px), 90vw)"}}>
            <ChessCapturedRow pieces={f2fTopCaptured} cellPx={f2fCellPx}/>
          </div>
          <div style={{width: f2fBoardPx > 0 ? `${f2fBoardPx}px` : "min(calc(100vw - 8px), 90vw)"}}>
            <Board game={{...game, flipped:f2fFlipped}} onUpdate={handleBoardUpdate} myColor={game.turn} rotateTopPieces={true} isKids={(() => {
              const currentTurnPlayerName = game.turn === "w" ? game.players?.white : game.players?.black;
              return (members || []).find(m => m.name === currentTurnPlayerName)?.kids || false;
            })()} playerLang={playerLang} />
          </div>
          {/* 下側取り駒 */}
          <div style={{width: f2fBoardPx > 0 ? `${f2fBoardPx}px` : "min(calc(100vw - 8px), 90vw)"}}>
            <ChessCapturedRow pieces={f2fBottomCaptured} cellPx={f2fCellPx}/>
          </div>
        </div>

        {/* 下側プレイヤー */}
        <div style={{display:"flex", alignItems:"center", justifyContent:"center", padding:"2px 6px 2px", flexShrink:0}}>
          <F2FInfoBar
            color={bottomColor} name={bottomPlayerName} isMyTurn={isBottomTurn}
            onResign={isBottomTurn ? () => {
              if (window.confirm(t(`${bottomPlayerName} が投了しますか？`, `Does ${bottomPlayerName} want to resign?`))) {
                onUpdate({...game, status:`resign_${bottomColor==="w"?"b":"w"}`});
                playSound("win"); exitFaceToFace();
              }
            } : null}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{display:"flex", flexDirection:"column", gap: pcLayout ? 10 : 28, background:"transparent", borderRadius:0, padding: pcLayout ? "6px 12px" : "28px 20px", border:"none", width:"100%", maxWidth:"min(560px,98vw)", boxShadow:"none"}}>


      {/* 行1：ルール・終了申請・投了（モバイルのみ・参加中の対局） */}
      {!pcLayout && myColor !== null && status === "playing" && (
        <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", gap:8}}>
          {/* 左：ルールボタン */}
          <button onClick={() => setShowRulesModal(true)} style={{background:"transparent", border:"1px solid #c8b090", borderRadius:6, color:"#7a5838", padding:"5px 12px", cursor:"pointer", fontSize:18, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", flexShrink:0}}>
            {playerLang === "en" ? "Rules" : "ルール"}
          </button>
          {/* 右：終了申請・投了 */}
          <div style={{display:"flex", alignItems:"center", gap:8}}>
            {!game.endRequest && (
              <button onClick={() => {
                onUpdate({ ...game, endRequest: { requestedBy: myColor, requestedAt: new Date().toISOString() } });
              }} style={{background:"transparent", border:"1px solid #c8b090", borderRadius:6, color:"#7a5838", padding:"5px 12px", cursor:"pointer", fontSize:18, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif"}}>
                {t("終了申請","End Request","おわりたい","End")}
              </button>
            )}
            <button onClick={() => {
              if (window.confirm(t("本当に投了しますか？", "Are you sure?", "まけをみとめる？", "Give up?"))) {
                onUpdate({...game, status:`resign_${myColor==="w"?"b":"w"}`});
                playSound("win");
              }
            }} style={{background:"transparent", border:"1px solid #c8b090", borderRadius:6, color:"#7a5838", padding:"5px 12px", cursor:"pointer", fontSize:18, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif"}}>
              {t("投了","Resign","まけた","Resign")}
            </button>
          </div>
        </div>
      )}

      {/* キッズモードバナー */}
      {isKids && (
        <div style={{textAlign:"center", padding:"10px", borderRadius:10, background:"#fef8e6", border:"1px solid #d4a855", color:"#5a3e18", fontSize:18, lineHeight:1.6}}>
          🧒 {t("キッズモード：駒を長押しで動き方を確認できます！","Kids Mode: Long-press pieces to learn how they move!","こまをながおしすると、うごきかたがわかるよ！","Hold a piece to learn how it moves!")}
        </div>
      )}

      {/* キッズ：チェック警告（自分が参加している試合のみ） */}
      {isKids && myColor !== null && game.status === "playing" && (() => {
        const myCol = myColor;
        if (game.turn === myCol && inCheck(game.board, myCol)) {
          return (
            <div style={{textAlign:"center", padding:"8px 12px", borderRadius:10, background:"#fff0f0", border:"2px solid #ff4444", color:"#cc0000", fontSize:"clamp(18px,4vw,21px)", fontWeight:"bold", animation:"pulse 1s infinite"}}>
              🚨 {t("チェックされています！王様を守ってください！","Check! Protect your King!","やばい！おうさまがねらわれてる！まもってね！","Watch out! Your King is in danger! Save him!")}
            </div>
          );
        }
        return null;
      })()}

      {/* 上ユーザーの最新メッセージ吹き出し（下向き三角） */}
      {(() => {
        const m = [...(messages||[])].reverse().find(msg => msg.sender === topName);
        if (!m) return null;
        const bubbleUnread = m.sender !== playerName && gameMsgSeenTs && m.ts > gameMsgSeenTs;
        return (
          <div onClick={() => { setShowMsgModal(true); onMsgSeen?.(); }} style={{position:"relative", cursor:"pointer", marginBottom:2}}>
            <div style={{background:"#fffdf8", border:"1px solid #d4bc88", borderRadius:12, padding: pcLayout ? "4px 8px" : "6px 10px", display:"flex", alignItems:"flex-start", gap:6, boxShadow:"0 1px 6px rgba(42,26,8,0.08)", textAlign:"left"}}>
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontSize: pcLayout ? 18 : "clamp(18px,4vw,21px)", color:"#3a2e22", wordBreak:"break-word", lineHeight:1.5}}>{m.text}</div>
                {(m.translation || extraTrans[m.ts]) && (
                  <div style={{fontSize: pcLayout ? 18 : "clamp(18px,4vw,21px)", color:"#7a6040", paddingLeft:4, borderLeft:"2px solid #c8b090", marginTop:2, lineHeight:1.4, wordBreak:"break-word"}}>
                    {m.isJP ? "🇺🇸" : "🇯🇵"} {m.translation || extraTrans[m.ts]}
                  </div>
                )}
                {m.ts && (
                  <div style={{fontSize: pcLayout ? 18 : "clamp(18px,4vw,21px)", color:"#b0a090", marginTop:2, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontStyle:"italic"}}>
                    {fmtDualT(m.ts, playerLang)}
                  </div>
                )}
              </div>
            </div>
            {/* 下向き三角ポインター */}
            <div style={{position:"absolute", bottom:-7, left:22, width:0, height:0, borderLeft:"6px solid transparent", borderRight:"6px solid transparent", borderTop:"7px solid #d4bc88"}} />
            <div style={{position:"absolute", bottom:-6, left:23, width:0, height:0, borderLeft:"5px solid transparent", borderRight:"5px solid transparent", borderTop:"6px solid #fffdf8"}} />
            {bubbleUnread && <span style={{position:"absolute",top:4,right:6,width:10,height:10,borderRadius:"50%",background:"#c03020",boxShadow:"0 0 4px rgba(192,48,32,0.7)",animation:"pulse 1.5s ease-in-out infinite"}}/>}
          </div>
        );
      })()}

      {/* 盤面上部：localFlipped ベース */}
      {topName && (() => {
        const topCaptured = topColor === "w" ? capturedByWhite : capturedByBlack;
        const topLost     = topColor === "w" ? capturedByBlack : capturedByWhite;
        const topGain = pieceScore(topCaptured);
        const topLoss = pieceScore(topLost);
        const isTopTurn = game.status==="playing" && game.turn===topColor;
        return (
          <div style={{display:"flex", flexDirection:"row", alignItems:"center", gap:8, padding: pcLayout ? "4px 10px" : "10px 16px", background: isTopTurn ? (pcLayout ? "rgba(210,170,80,0.18)" : "#fff8ec") : "transparent", borderRadius:14, border: isTopTurn ? "1px solid #d4a855" : "none", transition:"all 0.3s", boxShadow: isTopTurn ? "0 2px 12px rgba(180,140,40,0.14)" : "none"}}>
            <AvatarIcon url={(members||[]).find(m=>m.name===topName)?.avatarUrl} size={pcLayout ? 36 : 60} name={topName} />
            <span style={{color:"#7a6040", fontWeight:"bold", fontSize: pcLayout ? 18 : "clamp(18px,4vw,21px)", flexShrink:0}}>＆</span>
            <KingBadge col={topColor} size={pcLayout ? 36 : 60} />
            <div style={{flex:1, display:"flex", flexDirection:"column", gap:2, alignItems:"center", textAlign:"center", minWidth:0}}>
              <div style={{color:"#3a2e22", fontSize: pcLayout ? 18 : "clamp(18px,4vw,21px)", fontWeight:500, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", letterSpacing:"0.04em", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:"100%"}}>
                {isTopTurn
                  ? <span style={{animation:"pulse 1.5s ease-in-out infinite", display:"inline"}}>{t(`${topName}さんの番です`, `It's ${topName}'s turn`, `${topName}のばんです`, `It's ${topName}'s turn`)}</span>
                  : topName}
              </div>
              {(topGain > 0 || topLoss > 0) && (
                <div style={{fontSize:16, fontFamily:"'Cormorant Garamond',Georgia,serif", color:"#5a7840", lineHeight:1.3}}>
                  +{topGain}<span style={{color:"#a08060"}}>（-{topLoss}）</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Board に localFlipped を注入 + チェス取り駒を盤上下に表示 */}
      <div ref={chessBoardRefCb} style={{width:"100%", margin:"0 auto"}}>
        <ChessCapturedRow pieces={topCaptures}/>
        <Board game={{...game, flipped: localFlipped}} onUpdate={handleBoardUpdate} myColor={myColor} isKids={isKids} playerLang={playerLang} flat={false} />
        <ChessCapturedRow pieces={bottomCaptures}/>
      </div>

      {/* 盤面下部：localFlipped ベース */}
      {bottomName && (() => {
        const bottomCapturedNormal = bottomColor === "w" ? capturedByWhite : capturedByBlack;
        const bottomLost           = bottomColor === "w" ? capturedByBlack : capturedByWhite;
        const bottomGain = pieceScore(bottomCapturedNormal);
        const bottomLoss = pieceScore(bottomLost);
        const isBottomTurn = game.status==="playing" && game.turn===bottomColor;
        return (
          <div style={{display:"flex", flexDirection:"row", alignItems:"center", gap:8, padding: pcLayout ? "4px 10px" : "10px 16px", background: isBottomTurn ? (pcLayout ? "rgba(210,170,80,0.18)" : "#fff8ec") : "transparent", borderRadius:14, border: isBottomTurn ? "1px solid #d4a855" : "none", transition:"all 0.3s", boxShadow: isBottomTurn ? "0 2px 12px rgba(180,140,40,0.14)" : "none"}}>
            <AvatarIcon url={(members||[]).find(m=>m.name===bottomName)?.avatarUrl} size={pcLayout ? 36 : 60} name={bottomName} />
            <span style={{color:"#7a6040", fontWeight:"bold", fontSize: pcLayout ? 18 : "clamp(18px,4vw,21px)", flexShrink:0}}>＆</span>
            <KingBadge col={bottomColor} size={pcLayout ? 36 : 60} />
            <div style={{flex:1, display:"flex", flexDirection:"column", gap:2, alignItems:"center", textAlign:"center", minWidth:0}}>
              <div style={{color:"#3a2e22", fontSize: pcLayout ? 18 : "clamp(18px,4vw,21px)", fontWeight:500, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", letterSpacing:"0.04em", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:"100%"}}>
                {isBottomTurn
                  ? <span style={{animation:"pulse 1.5s ease-in-out infinite", display:"inline"}}>{t(`${bottomName}さんの番です`, `It's ${bottomName}'s turn`, `${bottomName}のばんです`, `It's ${bottomName}'s turn`)}</span>
                  : bottomName}
              </div>
              {(bottomGain > 0 || bottomLoss > 0) && (
                <div style={{fontSize:16, fontFamily:"'Cormorant Garamond',Georgia,serif", color:"#5a7840", lineHeight:1.3}}>
                  +{bottomGain}<span style={{color:"#a08060"}}>（-{bottomLoss}）</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* 中央カラム区切りライン削除済み */}

      {/* 下ユーザーの最新メッセージ吹き出し（上向き三角） */}
      {(() => {
        const m = [...(messages||[])].reverse().find(msg => msg.sender === bottomName);
        if (!m) return null;
        const bubbleUnread = m.sender !== playerName && gameMsgSeenTs && m.ts > gameMsgSeenTs;
        return (
          <div onClick={() => { setShowMsgModal(true); onMsgSeen?.(); }} style={{position:"relative", cursor:"pointer", marginTop:2}}>
            {/* 上向き三角ポインター */}
            <div style={{position:"absolute", top:-7, left:22, width:0, height:0, borderLeft:"6px solid transparent", borderRight:"6px solid transparent", borderBottom:"7px solid #d4bc88"}} />
            <div style={{position:"absolute", top:-6, left:23, width:0, height:0, borderLeft:"5px solid transparent", borderRight:"5px solid transparent", borderBottom:"6px solid #fffdf8"}} />
            <div style={{background:"#fffdf8", border:"1px solid #d4bc88", borderRadius:12, padding: pcLayout ? "4px 8px" : "6px 10px", display:"flex", alignItems:"flex-start", gap:6, boxShadow:"0 1px 6px rgba(42,26,8,0.08)", textAlign:"left"}}>
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontSize: pcLayout ? 18 : "clamp(18px,4vw,21px)", color:"#3a2e22", wordBreak:"break-word", lineHeight:1.5}}>{m.text}</div>
                {(m.translation || extraTrans[m.ts]) && (
                  <div style={{fontSize: pcLayout ? 18 : "clamp(18px,4vw,21px)", color:"#7a6040", paddingLeft:4, borderLeft:"2px solid #c8b090", marginTop:2, lineHeight:1.4, wordBreak:"break-word"}}>
                    {m.isJP ? "🇺🇸" : "🇯🇵"} {m.translation || extraTrans[m.ts]}
                  </div>
                )}
                {m.ts && (
                  <div style={{fontSize: pcLayout ? 18 : "clamp(18px,4vw,21px)", color:"#b0a090", marginTop:2, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontStyle:"italic"}}>
                    {fmtDualT(m.ts, playerLang)}
                  </div>
                )}
              </div>
            </div>
            {bubbleUnread && <span style={{position:"absolute",top:4,right:6,width:10,height:10,borderRadius:"50%",background:"#c03020",boxShadow:"0 0 4px rgba(192,48,32,0.7)",animation:"pulse 1.5s ease-in-out infinite"}}/>}
          </div>
        );
      })()}

      {/* 行2：左=相手視点　右=メッセージ入力欄 */}
      <div style={{display:"flex", alignItems:"center", gap:8}}>
        {myColor && (
          <button onClick={() => setFlipped(!localFlipped)}
            style={{background:"transparent", border:"1px solid #c8b090", borderRadius:6, color:"#7a5838", padding:"5px 10px", cursor:"pointer", fontSize:18, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", flexShrink:0, whiteSpace:"nowrap"}}>
            {t("相手視点","Flip","ひっくりかえす","Flip")}
          </button>
        )}
        <input value={msg} onChange={e=>setMsg(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendMsg()}
          placeholder={status!=="playing" ? t("対局終了後は送信できません","Game has ended","おわったよ","Game ended") : t("日本語 or English...", "English or 日本語...", "なんでもかいてね！", "Type anything!")} disabled={busy || status!=="playing"}
          style={{flex:1, background: status!=="playing" ? "#f0ece4" : "#fffdf8", border:"1px solid #c8b090", borderRadius:10, padding: pcLayout ? "5px 10px" : "8px 12px", color: status!=="playing" ? "#a09080" : "#3a2e22", fontSize: pcLayout ? 16 : "clamp(18px,4vw,21px)", outline:"none", minWidth:0, cursor: status!=="playing" ? "not-allowed" : "text"}}/>
        <button onClick={sendMsg} disabled={busy || status!=="playing"}
          style={{...btnPrimary, padding: pcLayout ? "5px 10px" : "8px 14px", fontSize: pcLayout ? 16 : "clamp(18px,4vw,21px)", borderRadius:10, flexShrink:0, opacity: status!=="playing" ? 0.4 : 1, cursor: status!=="playing" ? "not-allowed" : "pointer"}}>
          {busy ? "…" : t("送信", "Send", "おくる", "Send")}
        </button>
      </div>

      {/* ══ 許可申請モーダル（全種・position:fixed ポップアップ） ══ */}

      {/* 1. endRequest: 相手から申請 → 承認ポップアップ */}
      {game.endRequest && game.endRequest.requestedBy !== myColor && myColor !== null && (
        <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.80)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:3000, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif"}}>
          <div style={{background:"linear-gradient(135deg,#2a1e0a,#4a3416)", border:"2px solid #ffaa44", borderRadius:24, padding:"32px 28px", maxWidth:360, width:"88vw", textAlign:"center", boxShadow:"0 20px 60px rgba(0,0,0,0.7)", animation:"fadeInScale 0.35s ease-out"}}>
            <div style={{fontSize:56, marginBottom:12, animation:"bounce 1s ease-in-out infinite"}}>🏁</div>
            <h2 style={{color:"#ffc060", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontSize:"clamp(19px,4.5vw,24px)", margin:"0 0 12px", textShadow:"0 0 16px rgba(255,180,60,0.5)"}}>
              {t("試合終了の申請","End Game Request","おわりたいって！","End Request!")}
            </h2>
            <p style={{color:"#ffe8b0", fontSize:"clamp(19px,4.5vw,22px)", margin:"0 0 28px", lineHeight:1.6}}>
              {t("相手が試合終了を申請しています","Opponent requested to end the game","おわりたいっていってるよ！","Opponent wants to end the game!")}
            </p>
            <div style={{display:"flex", flexDirection:"column", gap:12}}>
              <button onClick={() => {
                onUpdate({ ...game, status:"waiting", history:[], board:mkBoard(), endRequest:null, undoRequest:null, players:{white:"",black:""}, name:`No.${gameIndex+1}`, redoHistory:[] });
              }} style={{background:"linear-gradient(135deg,#cc3333,#aa1111)", border:"none", borderRadius:14, color:"#ffffff", padding:"16px 20px", cursor:"pointer", fontSize:"clamp(19px,4.5vw,23px)", fontWeight:"bold", boxShadow:"0 4px 14px rgba(180,20,20,0.45)"}}>
                ✓ {t("承認する","Approve","いいよ！","OK!")}
              </button>
              <button onClick={() => {
                onUpdate({ ...game, endRequest:null });
              }} style={{background:"rgba(255,255,255,0.10)", border:"2px solid rgba(255,180,80,0.35)", borderRadius:14, color:"#ffddaa", padding:"14px 20px", cursor:"pointer", fontSize:"clamp(19px,4.5vw,22px)", fontWeight:"bold"}}>
                ✕ {t("断る","Decline","やだ！","No!")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. endRequest: 自分が申請待ち → 待機ポップアップ */}
      {game.endRequest && game.endRequest.requestedBy === myColor && (
        <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.72)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:3000, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif"}}>
          <div style={{background:"linear-gradient(145deg,#fffbf2,#f5ead8)", border:"1px solid #c8a860", borderRadius:20, padding:"32px 28px", maxWidth:360, width:"88vw", textAlign:"center", boxShadow:"0 12px 40px rgba(60,40,20,0.22)", animation:"fadeInScale 0.35s ease-out"}}>
            <div style={{fontSize:56, marginBottom:12, animation:"pulse 1.5s ease-in-out infinite"}}>⏳</div>
            <h2 style={{color:"#5a3e18", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontWeight:500, fontSize:"clamp(19px,4.5vw,24px)", margin:"0 0 12px", letterSpacing:"0.06em"}}>
              {t("終了申請中","End Game Requested","おわりたい！","Requesting End...")}
            </h2>
            <p style={{color:"#6a5030", fontSize:"clamp(18px,4.5vw,21px)", margin:"0 0 28px", lineHeight:1.8}}>
              {t("相手の承認を待っています...","Waiting for opponent's approval...","おともだちがOKするのをまってるよ...","Waiting for friend's OK...")}
            </p>
            <button onClick={() => {
              onUpdate({ ...game, endRequest:null });
            }} style={{background:"#f5f0e8", border:"1px solid #d8c8a8", borderRadius:12, color:"#7a6858", padding:"14px 28px", cursor:"pointer", fontSize:"clamp(18px,4.5vw,21px)", fontWeight:"bold"}}>
              {t("取り消す","Cancel","やっぱりやめる","Cancel")}
            </button>
          </div>
        </div>
      )}

      {/* 3. undoRequest: 相手から申請 → 承認ポップアップ */}
      {(game.undoRequest || null) && game.undoRequest.by !== myColor && myColor !== null && (
        <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.80)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:3000, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif"}}>
          <div style={{background:"linear-gradient(145deg,#fffbf2,#f5ead8)", border:"1px solid #c8a860", borderRadius:20, padding:"32px 28px", maxWidth:360, width:"88vw", textAlign:"center", boxShadow:"0 12px 40px rgba(60,40,20,0.22)", animation:"fadeInScale 0.35s ease-out"}}>
            <div style={{fontSize:56, marginBottom:12, animation:"bounce 1s ease-in-out infinite"}}>
              {game.undoRequest.type === "redo" ? "↪" : "↩"}
            </div>
            <h2 style={{color:"#5a3e18", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontWeight:500, fontSize:"clamp(19px,4.5vw,24px)", margin:"0 0 12px", letterSpacing:"0.06em"}}>
              {game.undoRequest.type === "redo"
                ? t("やり直しの申請","Redo Request","やりなおしたいって！","Redo Request!")
                : t("手を戻す申請","Undo Request","もどしたいって！","Undo Request!")}
            </h2>
            <p style={{color:"#6a5030", fontSize:"clamp(18px,4.5vw,21px)", margin:"0 0 28px", lineHeight:1.8}}>
              {game.undoRequest.type === "redo"
                ? t("相手がやり直しを申請しています","Opponent requested redo","おともだちがやりなおしたいって！","Friend wants to redo!")
                : t("相手が手を戻すことを申請しています","Opponent requested undo","おともだちがもどしたいって！","Friend wants to undo!")}
            </p>
            {game.undoRequest.type !== "redo" && (() => {
              const idx = game.undoRequest.historyIndex;
              const undoCount = (history||[]).length - idx;
              const prevHistory = (history || []).slice(0, idx);
              let prevBoard = mkBoard();
              for (const move of prevHistory) { if (move.from && move.to) prevBoard = applyMove(prevBoard, move.from[0], move.from[1], move.to[0], move.to[1]); }
              const prevTurn = prevHistory.length % 2 === 0 ? "w" : "b";
              const previewGame = { ...game, board: prevBoard, history: prevHistory, turn: prevTurn, flipped: localFlipped };
              return (
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:"clamp(16px,4vw,18px)",color:"#8a6030",marginBottom:8,textAlign:"center"}}>
                    {t(`${undoCount}手を取り消します`,`Undo ${undoCount} move${undoCount>1?"s":""}`,`${undoCount}てもどるよ`,`Undo ${undoCount} move${undoCount>1?"s":""}`)}
                  </div>
                  <div style={{pointerEvents:"none",transform:"scale(0.55)",transformOrigin:"top center",marginBottom:-80}}>
                    <Board game={previewGame} onUpdate={()=>{}} myColor={null} isKids={false} playerLang={playerLang} flat={false}/>
                  </div>
                </div>
              );
            })()}
            <div style={{display:"flex", flexDirection:"column", gap:12}}>
              <button onClick={() => {
                if (game.undoRequest.type === "redo") {
                  const redoStack = game.redoHistory || [];
                  if (redoStack.length === 0) { onUpdate({ ...game, undoRequest: null }); return; }
                  const nextMove = redoStack[0];
                  const newRedoHistory = redoStack.slice(1);
                  const newHistory = [...(history || []), nextMove];
                  let newBoard = mkBoard();
                  for (const move of newHistory) { if (move.from && move.to) newBoard = applyMove(newBoard, move.from[0], move.from[1], move.to[0], move.to[1]); }
                  const newTurn = newHistory.length % 2 === 0 ? "w" : "b";
                  onUpdate({ ...game, board: newBoard, history: newHistory, turn: newTurn, redoHistory: newRedoHistory, undoRequest: null });
                } else {
                  const idx = game.undoRequest.historyIndex;
                  const newHistory = (history || []).slice(0, idx);
                  const removedMoves = (history || []).slice(idx);
                  let newBoard = mkBoard();
                  for (const move of newHistory) { if (move.from && move.to) newBoard = applyMove(newBoard, move.from[0], move.from[1], move.to[0], move.to[1]); }
                  const newTurn = newHistory.length % 2 === 0 ? "w" : "b";
                  onUpdate({ ...game, board: newBoard, history: newHistory, turn: newTurn, redoHistory: removedMoves, undoRequest: null });
                }
              }} style={{background:"linear-gradient(135deg,#7a5638,#5a3e28)", border:"none", borderRadius:12, color:"#f5ead8", padding:"16px 20px", cursor:"pointer", fontSize:"clamp(19px,4.5vw,23px)", fontWeight:"bold", boxShadow:"0 4px 14px rgba(90,60,30,0.28)"}}>
                ✓ {t("許可する","Allow","いいよ！","OK!")}
              </button>
              <button onClick={() => {
                onUpdate({ ...game, undoRequest: null });
              }} style={{background:"#f5f0e8", border:"1px solid #d8c8a8", borderRadius:12, color:"#7a6858", padding:"14px 20px", cursor:"pointer", fontSize:"clamp(18px,4.5vw,21px)", fontWeight:"bold"}}>
                {t("断る","Decline","やだ！","No!")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. undoRequest: 自分が申請待ち → 待機ポップアップ */}
      {(game.undoRequest || null)?.by === myColor && (
        <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.72)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:3000, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif"}}>
          <div style={{background:"linear-gradient(145deg,#fffbf2,#f5ead8)", border:"1px solid #c8a860", borderRadius:20, padding:"32px 28px", maxWidth:360, width:"88vw", textAlign:"center", boxShadow:"0 12px 40px rgba(60,40,20,0.22)", animation:"fadeInScale 0.35s ease-out"}}>
            <div style={{fontSize:56, marginBottom:12, animation:"pulse 1.5s ease-in-out infinite"}}>⏳</div>
            <h2 style={{color:"#5a3e18", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontWeight:500, fontSize:"clamp(19px,4.5vw,24px)", margin:"0 0 12px", letterSpacing:"0.06em"}}>
              {(game.undoRequest.type === "redo")
                ? t("やり直し申請中","Redo Requested","やりなおしたい！","Redo Requested!")
                : t("手戻し申請中","Undo Requested","もどしたい！","Undo Requested!")}
            </h2>
            <p style={{color:"#6a5030", fontSize:"clamp(18px,4.5vw,21px)", margin:"0 0 28px", lineHeight:1.8}}>
              {t("相手の承認を待っています...","Waiting for opponent's approval...","おともだちがOKするのをまってるよ...","Waiting for friend's OK...")}
            </p>
            <button onClick={() => {
              onUpdate({ ...game, undoRequest: null });
            }} style={{background:"#f5f0e8", border:"1px solid #d8c8a8", borderRadius:12, color:"#7a6858", padding:"14px 28px", cursor:"pointer", fontSize:"clamp(18px,4.5vw,21px)", fontWeight:"bold"}}>
              {t("取り消す","Cancel","やっぱりやめる","Cancel")}
            </button>
          </div>
        </div>
      )}

      {/* NY・Japan デジタル時計（PCでは右パネルへ移動） */}
      {!pcLayout && <DualClock playerLang={playerLang} flat />}

      {/* 履歴（PCでは右パネルへ移動） */}
      {!pcLayout && <div style={{background:"transparent", borderRadius:0, padding:"8px 20px 22px", border:"none"}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14}}>
          <span style={{fontFamily:"Georgia,serif", fontSize:18, letterSpacing:"1.5px", color:WT.textMuted, textTransform:"uppercase", opacity:0.8}}>{playerLang==="en" ? "MOVE HISTORY" : "指し手履歴"}</span>
          {myColor && game.status === "playing" && (
            <div style={{display:"flex", alignItems:"center", gap:6}}>
              {(() => {
                const redoStack = game.redoHistory || [];
                const isMyRedoRequest = (game.undoRequest || null)?.by === myColor && game.undoRequest?.type === "redo";
                const canRedo = redoStack.length > 0 && !(game.undoRequest || null);
                if (!canRedo && !isMyRedoRequest) return null;
                return (
                  <button
                    onClick={() => {
                      if (isMyRedoRequest) { onUpdate({ ...game, undoRequest: null }); return; }
                      if (!canRedo) return;
                      onUpdate({ ...game, undoRequest: { by: myColor, type: "redo" } });
                    }}
                    style={{
                      background:"transparent",
                      border:"1px solid #c8b090",
                      borderRadius:6,
                      color:"#7a5838",
                      padding:"4px 10px",
                      cursor:"pointer",
                      fontSize:18,
                      fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif",
                      fontWeight:"bold", whiteSpace:"nowrap", flexShrink:0,
                    }}
                  >
                    {isMyRedoRequest
                      ? `⏳ ${t("許可待ち…","Waiting...","まってるよ...","Waiting...")}`
                      : `${t("キャンセル","Cancel","キャンセル","Cancel")}${redoStack.length > 0 ? ` (${redoStack.length})` : ""}`}
                  </button>
                );
              })()}
            </div>
          )}
        </div>
        <div style={{maxHeight:180, overflowY:"auto", textAlign:"left"}}>
          {(!history||history.length===0) && <span style={{color:"#b0a090", fontSize:18}}>{t("まだ手がありません","No moves yet","まだうごかしてないよ","No moves yet")}</span>}
          {[...(history || [])].reverse().map((h, i, arr) => {
            const originalIndex = arr.length - 1 - i;
            const isWithin4 = i < 4;
            const canUndo = myColor && isWithin4 && game.status === "playing" && !(game.undoRequest || null);
            const isMyUndoRequest = (game.undoRequest || null)?.by === myColor && game.undoRequest?.type === "undo" && game.undoRequest?.historyIndex === originalIndex;
            return (
              <div key={originalIndex} style={{display:"flex", alignItems:"center", gap:8, padding:"11px 0", borderBottom:"1px solid rgba(180,150,120,0.15)"}}>
                <span style={{minWidth:24, color:"#b0a090", fontSize:"clamp(18px,3.5vw,20px)", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontStyle:"italic"}}>
                  {originalIndex + 1}.
                </span>
                <span style={{display:"flex", alignItems:"center", gap:4, minWidth:60, fontSize:18, fontWeight:"bold", color:h.color==="w"?"#7a5820":"#5a3c28", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>
                  <AvatarIcon url={(members||[]).find(m=>m.name===(h.color==="w"?game.players?.white:game.players?.black))?.avatarUrl} size={22} name={h.color==="w"?game.players?.white:game.players?.black} />
                  {h.color==="w" ? "⬜" : "⬛"} {h.color==="w" ? (game.players?.white || t("白","White","しろ","White")) : (game.players?.black || t("黒","Black","くろ","Black"))}
                </span>
                <span style={{minWidth:65, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontWeight:600, fontSize:"clamp(18px,3.5vw,21px)", color:h.color==="w"?"#3a2e22":"#5a3c28", letterSpacing:"0.04em"}}>
                  {h.notation}
                </span>
                <span style={{color:"#a09080", fontSize:"clamp(18px,4vw,21px)", flex:1, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontStyle:"italic"}}>
                  {fmtDualT(h.ts, playerLang)}
                </span>
                {(canUndo || isMyUndoRequest) && (
                  <button onClick={() => {
                    if (isMyUndoRequest) { onUpdate({ ...game, undoRequest: null }); return; }
                    if (!canUndo) return;
                    onUpdate({ ...game, undoRequest: { by: myColor, type: "undo", historyIndex: originalIndex } });
                  }} style={{
                    background:"transparent",
                    border:"1px solid #c8b090",
                    borderRadius:6,
                    color:"#7a5838",
                    padding:"4px 10px",
                    cursor:"pointer", fontSize:18,
                    fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif",
                    fontWeight:"bold", whiteSpace:"nowrap", flexShrink:0,
                  }}>
                    {isMyUndoRequest
                      ? `⏳ ${t("許可待ち…","Waiting...","まってるよ...","Waiting...")}`
                      : t("戻す","Back","もどす","Back")}
                  </button>
                )}
              </div>
            );
          })}
          {(game.redoHistory||[]).map((h, i) => {
            const redoIndex = (history||[]).length + i;
            return (
              <div key={`redo-${i}`} style={{display:"flex", alignItems:"center", gap:8, padding:"11px 0", borderBottom:"1px solid rgba(180,150,120,0.10)", opacity:0.45, textDecoration:"line-through"}}>
                <span style={{minWidth:24, color:"#b0a090", fontSize:"clamp(18px,3.5vw,20px)", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontStyle:"italic"}}>
                  {redoIndex + 1}.
                </span>
                <span style={{display:"flex", alignItems:"center", gap:4, minWidth:60, fontSize:18, fontWeight:"bold", color:h.color==="w"?"#7a5820":"#5a3c28", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>
                  {h.color==="w" ? "⬜" : "⬛"} {h.color==="w" ? (game.players?.white || t("白","White","しろ","White")) : (game.players?.black || t("黒","Black","くろ","Black"))}
                </span>
                <span style={{minWidth:65, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontWeight:600, fontSize:"clamp(18px,3.5vw,21px)", color:h.color==="w"?"#3a2e22":"#5a3c28", letterSpacing:"0.04em"}}>
                  {h.notation}
                </span>
                <span style={{color:"#a09080", fontSize:"clamp(18px,4vw,21px)", flex:1, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontStyle:"italic"}}>
                  {fmtDualT(h.ts, playerLang)}
                </span>
              </div>
            );
          })}
        </div>
      </div>}

      {/* メッセージモーダル（ボトムシート） */}
      {showMsgModal && (
        <div onClick={() => setShowMsgModal(false)} style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:5000, display:"flex", alignItems:"flex-end", justifyContent:"center", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif"}}>
          <div onClick={e => e.stopPropagation()} style={{background:"#faf6f0", borderRadius:"20px 20px 0 0", width:"100%", maxWidth:"min(560px,100vw)", maxHeight:"80vh", display:"flex", flexDirection:"column", boxShadow:"0 -4px 24px rgba(0,0,0,0.22)"}}>
            {/* ヘッダー */}
            <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", padding:"16px 20px 12px", borderBottom:"1px solid #e8d8b4", flexShrink:0}}>
              <img src="/badges/label-msg.webp" alt={t("メッセージ","Messages")} style={{height:"clamp(40px,10vw,52px)", width:"auto"}} />
              <button onClick={() => setShowMsgModal(false)} style={{background:"none", border:"none", color:"#a09080", cursor:"pointer", fontSize:22, padding:"4px 8px", lineHeight:1}}>✕</button>
            </div>
            {/* メッセージ一覧 */}
            <div style={{flex:1, overflowY:"auto", padding:"8px 20px", textAlign:"left"}}>
              {(messages || []).length === 0 && (
                <span style={{color:"#b0a090", fontSize:18, display:"block", padding:"16px 0"}}>
                  {t("メッセージはまだありません", "No messages yet", "まだメッセージはないよ", "No messages yet")}
                </span>
              )}
              {[...(messages || [])].reverse().map((m, i) => {
                const origIndex = (messages || []).length - 1 - i;
                return (
                  <div key={origIndex} style={{padding:"10px 0", borderBottom:"1px solid rgba(180,150,120,0.12)", lineHeight:1.8}}>
                    <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8}}>
                      <AvatarIcon url={members?.find(mb=>mb.name===m.sender)?.avatarUrl} size={32} name={m.sender||""} />
                      <div style={{flex:1}}>
                        <span style={{color:"#5a3e28", fontWeight:500, fontSize:18, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", letterSpacing:"0.03em"}}>{m.sender || "?"}{members?.find(mb=>mb.name===m.sender)?.kids ? " 🐥" : ""}: </span>
                        {m.text && <span style={{color:"#3a2e22", fontSize:"clamp(18px,4vw,21px)"}}>{m.text}</span>}
                        {m.translation && (
                          <div style={{color:"#5a4830", fontSize:18, paddingLeft:10, borderLeft:"2px solid #c8b090", marginTop:4, lineHeight:1.6}}>
                            {m.isJP ? "🇺🇸" : "🇯🇵"} {m.translation}
                          </div>
                        )}
                        <div style={{color:"#a09080", fontSize:18, marginTop:4, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontStyle:"italic"}}>{fmtDualT(m.ts, playerLang)}</div>
                      </div>
                      {m.sender === playerName && (
                        <button onClick={() => { const nm=(game.messages||[]).filter((_,j)=>j!==origIndex); onUpdate({...game,messages:nm}); }}
                          style={{background:"none", border:"none", color:"#b0a090", cursor:"pointer", fontSize:18, padding:"0 4px", flexShrink:0}}>🗑</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* 入力欄 */}
            <div style={{display:"flex", flexDirection:"column", borderTop:"1px solid #e8d8b4", flexShrink:0}}>
              <div style={{display:"flex", gap:8, padding:"12px 16px 20px"}}>
                <input value={msg} onChange={e=>setMsg(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendMsg()}
                  placeholder={status!=="playing" ? t("対局終了後は送信できません","Game has ended","おわったよ","Game ended") : t("日本語 or English...", "English or 日本語...", "なんでもかいてね！", "Type anything!")} disabled={busy || status!=="playing"}
                  style={{flex:1, background: status!=="playing" ? "#f0ece4" : "#fffdf8", border:"1px solid #c8b090", borderRadius:10, padding:"10px 14px", color: status!=="playing" ? "#a09080" : "#3a2e22", fontSize:"clamp(18px,4vw,21px)", outline:"none", cursor: status!=="playing" ? "not-allowed" : "text"}}/>
                <button onClick={sendMsg} disabled={busy || status!=="playing"}
                  style={{...btnPrimary, padding:"10px 18px", fontSize:"clamp(18px,4vw,21px)", borderRadius:10, opacity: status!=="playing" ? 0.4 : 1, cursor: status!=="playing" ? "not-allowed" : "pointer"}}>
                  {busy ? "…" : t("送信", "Send", "おくる", "Send")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!pcLayout && status === "playing" && myColor !== null && (
        <button onClick={enterFaceToFace} style={{background:"transparent", border:"1px solid #c8b090", borderRadius:6, color:"#7a5838", padding:"8px 14px", cursor:"pointer", fontSize:"clamp(18px,4vw,22px)", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", width:"100%", letterSpacing:"0.03em"}}>
          {t("対面モードで対局する","Play Face-to-Face","まえにいるひととあそぶ","Play Together!")}
        </button>
      )}

      {/* レイアウト切り替えボタン（タブレットのみ・小タブレット表示中） */}
      {!pcLayout && onToggleLayout && (
        <div style={{paddingTop:20}}>
          <button onClick={onToggleLayout} style={{background:"transparent", border:"1px solid #c8b090", borderRadius:6, color:"#7a5838", padding:"6px 14px", cursor:"pointer", fontSize:"clamp(18px,4vw,22px)", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", width:"100%", letterSpacing:"0.02em"}}>
            {playerLang === "en" ? "Switch to PC View" : "PC表示に切り替える"}
          </button>
        </div>
      )}

      {/* ─── ルールモーダル ─── */}
      {showRulesModal && (
        <div onClick={() => setShowRulesModal(false)} style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.72)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:3100, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif"}}>
          <div onClick={e => e.stopPropagation()} style={{background:"linear-gradient(145deg,#fffbf2,#f5ead8)", border:"1px solid #c8a860", borderRadius:20, padding:"28px 24px", maxWidth:340, width:"88vw", boxShadow:"0 12px 40px rgba(60,40,20,0.25)", animation:"fadeInScale 0.3s ease-out"}}>
            {/* タイトル */}
            <div style={{fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontSize:16, letterSpacing:"2px", color:"#a89070", textTransform:"uppercase", marginBottom:14, textAlign:"center"}}>
              {playerLang === "en" ? "Rules & Piece Values" : "ルール ＆ 駒の点数"}
            </div>
            {/* ルール */}
            <div style={{marginBottom:14}}>
              <div style={{fontSize:16, letterSpacing:"1.8px", color:"#b09060", textTransform:"uppercase", borderBottom:"1px solid #e8d8b4", paddingBottom:4, marginBottom:8}}>
                {playerLang === "en" ? "Rules" : "ルール"}
              </div>
              {[
                {key:"castling",  ja:"キャスリング",   en:"Castling"},
                {key:"promotion", ja:"プロモーション", en:"Promotion"},
                {key:"enPassant", ja:"アンパッサン",   en:"En Passant"},
              ].map(({key, ja, en}) => {
                const active = (game.rules?.[key] ?? true) !== false;
                return (
                  <div key={key} style={{display:"flex", justifyContent:"space-between", alignItems:"center", padding:"3px 0", borderBottom:"1px solid #f0e8d8"}}>
                    <span style={{fontSize:17, color: active ? "#3a2e22" : "#b0a090"}}>{playerLang === "en" ? en : ja}</span>
                    <span style={{fontSize:17, fontWeight:600, color: active ? "#5a8030" : "#b0a090"}}>
                      {active ? (playerLang === "en" ? "On" : "あり") : (playerLang === "en" ? "Off" : "なし")}
                    </span>
                  </div>
                );
              })}
            </div>
            {/* 駒の点数 */}
            <div style={{marginBottom:20}}>
              <div style={{fontSize:16, letterSpacing:"1.8px", color:"#b09060", textTransform:"uppercase", borderBottom:"1px solid #e8d8b4", paddingBottom:4, marginBottom:8}}>
                {playerLang === "en" ? "Piece Values" : "駒の点数"}
              </div>
              {[
                {type:"Q", val:9, ja:"クイーン",   en:"Queen"},
                {type:"R", val:5, ja:"ルーク",     en:"Rook"},
                {type:"B", val:3, ja:"ビショップ", en:"Bishop"},
                {type:"N", val:3, ja:"ナイト",     en:"Knight"},
                {type:"P", val:1, ja:"ポーン",     en:"Pawn"},
              ].map(({type, val, ja, en}) => (
                <div key={type} style={{display:"flex", justifyContent:"space-between", alignItems:"center", padding:"3px 0", borderBottom:"1px solid #f0e8d8"}}>
                  <span style={{fontSize:17, color:"#3a2e22", display:"flex", alignItems:"center", gap:6}}>
                    <img src={PIECE_IMG["w"+type]} style={{width:20, height:20, objectFit:"contain"}} alt={type} />
                    {playerLang === "en" ? en : ja}
                  </span>
                  <span style={{fontSize:17, fontWeight:500, color:"#3a2e22"}}>{val}</span>
                </div>
              ))}
            </div>
            {/* 閉じるボタン */}
            <button onClick={() => setShowRulesModal(false)} style={{width:"100%", background:"transparent", border:"1px solid #c8b090", borderRadius:8, color:"#7a5838", padding:"10px", cursor:"pointer", fontSize:17, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif"}}>
              {playerLang === "en" ? "Close" : "閉じる"}
            </button>
          </div>
        </div>
      )}

      {/* ─── 勝利・敗北モーダル（全デバイス） ─── */}
      {showWinModal && (
        <div onClick={() => setShowWinModal(false)} style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.80)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:3200, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif"}}>
          <div onClick={e => e.stopPropagation()} style={{background:"linear-gradient(135deg,#2a1e0a,#4a3416)", border:"2px solid #c8a040", borderRadius:24, padding:"40px 32px", maxWidth:380, width:"88vw", textAlign:"center", boxShadow:"0 20px 60px rgba(0,0,0,0.70)", animation:"fadeInScale 0.35s ease-out"}}>
            <div style={{fontSize:64, marginBottom:12, animation: winModalMsg.emoji === "🏆" ? "bounce 1s ease-in-out infinite" : "pulse 1.5s ease-in-out infinite"}}>{winModalMsg.emoji}</div>
            <h2 style={{color:"#ffe8a0", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontWeight:600, fontSize:"clamp(22px,5vw,28px)", margin:"0 0 8px", letterSpacing:"0.06em", lineHeight:1.3}}>
              {winModalMsg.title}
            </h2>
            {winModalMsg.subtitle && (
              <p style={{color:"#d4b870", fontSize:"clamp(17px,4vw,20px)", margin:"0 0 28px", letterSpacing:"0.08em", textTransform:"uppercase"}}>
                {winModalMsg.subtitle}
              </p>
            )}
            <div style={{display:"flex", gap:10, justifyContent:"center", flexWrap:"wrap"}}>
              <button onClick={() => setShowWinModal(false)} style={{background:"rgba(255,255,255,0.10)", border:"2px solid rgba(255,200,80,0.40)", borderRadius:14, color:"#ffe8a0", padding:"14px 32px", cursor:"pointer", fontSize:"clamp(17px,4vw,21px)", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", letterSpacing:"0.04em"}}>
                {playerLang === "en" ? "Close" : "閉じる"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── ゲームリアクション：受信フローティングアニメーション ─── */}
      {reactionAnim && (
        <div key={reactionAnim.key} style={{
          position:"fixed", left:"50%", top:"40%", zIndex:9999,
          fontSize:"clamp(40px,10vw,64px)", pointerEvents:"none",
          animation:"reactionFloat 1.6s ease-out forwards",
        }}>
          {reactionAnim.emoji}
        </div>
      )}

      {/* ─── ゲームリアクション：送信バー（相手手番後3秒） ─── */}
      {reactionBar && myGameColor && (
        <div style={{
          position:"fixed", bottom:72, left:"50%", transform:"translateX(-50%)",
          zIndex:3500, display:"flex", gap:6, padding:"8px 12px",
          background:"rgba(42,26,8,0.88)", borderRadius:32,
          boxShadow:"0 4px 16px rgba(0,0,0,0.40)",
          animation:"reactionBarIn 0.25s ease-out",
          backdropFilter:"blur(6px)",
        }}>
          {REACTIONS.map(r => (
            <button key={r} onClick={() => sendGameReaction(r)} style={{
              background:"none", border:"none", cursor:"pointer",
              fontSize: r.length > 2 ? 13 : 26,
              padding: r.length > 2 ? "4px 8px" : "2px 4px",
              borderRadius:20, color: r.length > 2 ? "#ffe8a0" : "inherit",
              fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif",
              transition:"transform 0.12s",
              lineHeight:1.2,
            }}
              onMouseEnter={e => e.currentTarget.style.transform="scale(1.35)"}
              onMouseLeave={e => e.currentTarget.style.transform="scale(1)"}
            >{r}</button>
          ))}
        </div>
      )}

    </div>
  );
}

// ── PC右カラム：対局情報 + タイムゾーン + 指し手履歴 ──────────────────────
const HIST_PREVIEW = 4; // 折りたたみ時に表示する手数

function GameRightPanel({ game, onUpdate, playerName, playerLang, members, isKids, gameIndex, onStartModal, onFaceToFace, onAnalyze }) {
  const [histExpanded, setHistExpanded] = useState(false);
  const { trans: uiTrans, queue: queueTrans } = useContext(TransContext);
  const t = (ja, en, kidsJa, kidsEn) => {
    if (isKids) {
      if (playerLang === "en") return kidsEn || uiTrans[ja] || en;
      return kidsJa || ja;
    }
    if (playerLang === "en") { if (ja) queueTrans(ja); return uiTrans[ja] || en; }
    return ja;
  };
  const myColor = (() => {
    if (game.status !== "playing") return null;
    if (!game.players?.white && !game.players?.black) return null;
    const isWhite = game.players?.white === playerName;
    const isBlack = game.players?.black === playerName;
    if (!isWhite && !isBlack) return null;
    return isWhite ? "w" : "b";
  })();
  const { history } = game;
  const moveCount = (history||[]).length;
  const whiteName = game.players?.white || t("白","White");
  const blackName = game.players?.black || t("黒","Black");
  const startTs = history?.[0]?.ts;
  const startDate = startTs
    ? new Date(startTs).toLocaleDateString(playerLang==="en" ? "en-US" : "ja-JP", {year:"numeric", month:"short", day:"numeric"})
    : "—";
  const serif = "'Cormorant Garamond','Zen Old Mincho',Georgia,serif";
  const secLabel = { fontFamily:"Georgia,serif", fontSize:18, letterSpacing:"1.5px", color:WT.textMuted, textTransform:"uppercase", marginBottom:6, opacity:0.8 };
  const sm = 18;
  const wMember = members.find(m => m.name === game.players?.white);
  const bMember = members.find(m => m.name === game.players?.black);

  return (
    <div style={{display:"flex", flexDirection:"column", gap:14, width:"100%"}}>

      {/* ── ルール ── */}
      <div>
        <div style={secLabel}>{playerLang==="en" ? "RULES" : "ルール"}</div>
        <div style={{display:"flex", flexDirection:"column", gap:3}}>
          {[
            {key:"castling",  ja:"キャスリング",   en:"Castling"},
            {key:"promotion", ja:"プロモーション", en:"Promotion"},
            {key:"enPassant", ja:"アンパッサン",   en:"En Passant"},
          ].map(({key, ja, en}) => {
            const active = (game.rules?.[key] ?? true) !== false;
            return (
              <div key={key} style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                <span style={{fontSize:sm, color: active ? WT.text : WT.textMuted, fontFamily:serif}}>
                  {playerLang==="en" ? en : ja}
                </span>
                <span style={{fontSize:sm, fontWeight:600, color: active ? WT.text : WT.textMuted}}>
                  {active ? (playerLang==="en" ? "On" : "あり") : (playerLang==="en" ? "Off" : "なし")}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 駒の点数 ── */}
      <div>
        <div style={secLabel}>{playerLang==="en" ? "PIECE VALUES" : "駒の点数"}</div>
        <div style={{display:"flex", flexDirection:"column", gap:3}}>
          {[
            {type:"Q", val:9, ja:"クイーン",   en:"Queen"},
            {type:"R", val:5, ja:"ルーク",     en:"Rook"},
            {type:"B", val:3, ja:"ビショップ", en:"Bishop"},
            {type:"N", val:3, ja:"ナイト",     en:"Knight"},
            {type:"P", val:1, ja:"ポーン",     en:"Pawn"},
          ].map(({type, val, ja, en}) => (
            <div key={type} style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
              <span style={{fontSize:sm, color:WT.text, fontFamily:serif, display:"flex", alignItems:"center", gap:4}}>
                <img src={PIECE_IMG["w"+type]} style={{width:18, height:18, objectFit:"contain"}} alt={type} />
                {playerLang==="en" ? en : ja}
              </span>
              <span style={{fontSize:sm, fontWeight:500, color:WT.textDark, fontFamily:serif}}>{val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── 対局情報 ── */}
      <div>
        <div style={secLabel}>{playerLang==="en" ? "GAME INFO" : "対局情報"}</div>
        <div style={{display:"flex", flexDirection:"column", gap:3}}>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"baseline"}}>
            <span style={{fontSize:sm, color:WT.textMuted, fontFamily:serif}}>{playerLang==="en"?"Game":"対局"}</span>
            <span style={{fontSize:sm, fontWeight:500, color:WT.textDark, fontFamily:serif}}>No.{gameIndex + 1}</span>
          </div>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"baseline"}}>
            <span style={{fontSize:sm, color:WT.textMuted, fontFamily:serif}}>{playerLang==="en"?"Started":"開始日"}</span>
            <span style={{fontSize:sm, color:WT.text, fontFamily:serif}}>{startDate}</span>
          </div>
          {game.status === "playing" && (
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"baseline"}}>
              <span style={{fontSize:sm, color:WT.textMuted, fontFamily:serif}}>{playerLang==="en"?"Turn":"手番"}</span>
              <span style={{fontSize:sm, color:WT.textDark, fontFamily:serif}}>{game.turn==="w"?"⬜":"⬛"} {game.turn==="w"?whiteName:blackName}</span>
            </div>
          )}
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"baseline"}}>
            <span style={{fontSize:sm, color:WT.textMuted, fontFamily:serif}}>{playerLang==="en"?"Moves":"手数"}</span>
            <span style={{fontSize:sm, fontWeight:500, color:WT.textDark, fontFamily:serif}}>{moveCount}{playerLang==="en"?" moves":"手目"}</span>
          </div>
          {game.status !== "playing" && (
            <div style={{fontSize:sm, color:WT.textMuted, fontFamily:serif, fontStyle:"italic"}}>
              {game.status==="ended"?(playerLang==="en"?"Ended":"終了"):(playerLang==="en"?"Waiting":"待機中")}
            </div>
          )}
        </div>
      </div>

      {/* ── 終了申請・投了ボタン ── */}
      {myColor !== null && game.status === "playing" && (
        <div style={{display:"flex", flexDirection:"column", gap:6}}>
          {!game.endRequest && (
            <button onClick={() => onUpdate({ ...game, endRequest: { requestedBy: myColor, requestedAt: new Date().toISOString() } })}
              style={{background:"transparent", border:"1px solid #c8b090", borderRadius:6, color:"#7a5838", padding:"4px 10px", cursor:"pointer", fontSize:18, fontWeight:"bold", whiteSpace:"nowrap", width:"100%"}}>
              {playerLang==="en" ? "Request End" : "終了申請"}
            </button>
          )}
          <button onClick={() => {
            const t_ = (ja,en) => playerLang==="en" ? en : ja;
            if (window.confirm(t_("本当に投了しますか？", "Are you sure?"))) {
              onUpdate({...game, status:`resign_${myColor==="w"?"b":"w"}`});
            }
          }} style={{background:"transparent", border:"1px solid #c8b090", borderRadius:6, color:"#7a5838", padding:"4px 10px", cursor:"pointer", fontSize:18, fontWeight:"bold", whiteSpace:"nowrap", width:"100%"}}>
            {playerLang==="en" ? "Resign" : "投了"}
          </button>
        </div>
      )}


      {/* ── 指し手履歴 ── */}
      <div style={{flex:1, minHeight:0}}>
        <div style={secLabel}>{playerLang==="en" ? "MOVE HISTORY" : "指し手履歴"}</div>
        {myColor && game.status === "playing" && (() => {
          const redoStack = game.redoHistory || [];
          const isMyRedoRequest = (game.undoRequest || null)?.by === myColor && game.undoRequest?.type === "redo";
          const canRedo = redoStack.length > 0 && !(game.undoRequest || null);
          if (!canRedo && !isMyRedoRequest) return null;
          return (
            <div style={{display:"flex", justifyContent:"flex-end", marginBottom:8}}>
              <button
                disabled={!canRedo && !isMyRedoRequest}
                onClick={() => {
                  if (isMyRedoRequest) { onUpdate({ ...game, undoRequest: null }); return; }
                  if (!canRedo) return;
                  onUpdate({ ...game, undoRequest: { by: myColor, type: "redo" } });
                }}
                style={{
                  background: isMyRedoRequest ? "#f5f0e8" : (canRedo ? "transparent" : "#d8d0c0"),
                  border: isMyRedoRequest ? "1px solid #c8b090" : (canRedo ? "1px solid #c8b090" : "none"),
                  borderRadius:6, color: isMyRedoRequest ? "#5a4028" : (canRedo ? "#7a5838" : "#9a9080"),
                  padding:"3px 8px", cursor: (canRedo || isMyRedoRequest) ? "pointer" : "not-allowed",
                  fontSize:18, fontWeight:"bold", whiteSpace:"nowrap", flexShrink:0,
                }}
              >
                {isMyRedoRequest
                  ? `⏳ ${t("許可待ち…","Waiting...")}`
                  : `${t("キャンセル","Cancel")}${redoStack.length > 0 ? ` (${redoStack.length})` : ""}`}
              </button>
            </div>
          );
        })()}
        {(() => {
          const reversed = [...(history || [])].reverse();
          const total = reversed.length;
          const showAll = histExpanded || total <= HIST_PREVIEW;
          const visible = showAll ? reversed : reversed.slice(0, HIST_PREVIEW);
          return (
            <div style={{textAlign:"left"}}>
              {total === 0 && <span style={{color:"#b0a090", fontSize:18}}>{t("まだ手がありません","No moves yet","まだうごかしてないよ","No moves yet")}</span>}
              {visible.map((h, i) => {
                const originalIndex = total - 1 - (showAll ? i : i);
                const reversedIndex = i;
                const isWithin4 = reversedIndex < 4;
                const canUndo = myColor && isWithin4 && game.status === "playing" && !(game.undoRequest || null);
                const isMyUndoRequest = (game.undoRequest || null)?.by === myColor && game.undoRequest?.type === "undo" && game.undoRequest?.historyIndex === originalIndex;
                return (
                  <div key={originalIndex} style={{display:"flex", alignItems:"center", gap:5, padding:"3px 0", borderBottom:"1px solid rgba(180,150,120,0.15)"}}>
                    <span style={{minWidth:22, color:"#b0a090", fontSize:sm, fontFamily:serif, fontStyle:"italic", flexShrink:0}}>{originalIndex + 1}.</span>
                    <AvatarIcon url={(members||[]).find(m=>m.name===(h.color==="w"?game.players?.white:game.players?.black))?.avatarUrl} size={20} name={h.color==="w"?game.players?.white:game.players?.black} />
                    <span style={{flex:1, display:"flex", alignItems:"baseline", gap:5, minWidth:0}}>
                      <span style={{fontFamily:serif, fontWeight:600, fontSize:sm, color:h.color==="w"?"#3a2e22":"#5a3c28", letterSpacing:"0.04em", whiteSpace:"nowrap"}}>{h.notation}</span>
                      <span style={{color:"#a09080", fontSize:sm, fontFamily:serif, fontStyle:"italic", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{fmtDualT(h.ts, playerLang)}</span>
                    </span>
                    {(canUndo || isMyUndoRequest) && (
                      <button onClick={() => {
                        if (isMyUndoRequest) { onUpdate({ ...game, undoRequest: null }); return; }
                        if (!canUndo) return;
                        onUpdate({ ...game, undoRequest: { by: myColor, type: "undo", historyIndex: originalIndex } });
                      }} style={{
                        background: isMyUndoRequest ? "#f5f0e8" : "transparent",
                        border: "1px solid #c8b090",
                        borderRadius:6, color: isMyUndoRequest ? "#5a4028" : "#7a5838",
                        padding:"3px 8px", cursor:"pointer", fontSize:sm, fontWeight:"bold", whiteSpace:"nowrap", flexShrink:0, marginLeft:"auto",
                      }}>
                        {isMyUndoRequest ? `⏳` : t("戻す","Back","もどす","Back")}
                      </button>
                    )}
                  </div>
                );
              })}
              {(game.redoHistory||[]).map((h, i) => {
                const redoIndex = (history||[]).length + i;
                return (
                  <div key={`redo-${i}`} style={{display:"flex", alignItems:"center", gap:5, padding:"3px 0", borderBottom:"1px solid rgba(180,150,120,0.10)", opacity:0.45, textDecoration:"line-through"}}>
                    <span style={{minWidth:22, color:"#b0a090", fontSize:sm, fontFamily:serif, fontStyle:"italic", flexShrink:0}}>{redoIndex + 1}.</span>
                    <span style={{flex:1, display:"flex", alignItems:"baseline", gap:5, minWidth:0}}>
                      <span style={{fontFamily:serif, fontWeight:600, fontSize:sm, color:h.color==="w"?"#3a2e22":"#5a3c28", letterSpacing:"0.04em", whiteSpace:"nowrap"}}>{h.notation}</span>
                      <span style={{color:"#a09080", fontSize:sm, fontFamily:serif, fontStyle:"italic", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{fmtDualT(h.ts, playerLang)}</span>
                    </span>
                  </div>
                );
              })}
              {total > HIST_PREVIEW && (
                <button onClick={() => setHistExpanded(v => !v)} style={{
                  background:"none", border:"none", cursor:"pointer",
                  color:WT.textMid, fontSize:sm, fontFamily:serif,
                  padding:"8px 0 4px", width:"100%", textAlign:"right",
                  letterSpacing:"0.04em",
                }}>
                  {histExpanded
                    ? t("閉じる ＜","Close ＜")
                    : `${t("もっと見る","More")} ＞ (${total - HIST_PREVIEW}${playerLang==="en" ? " more" : "手"})`}
                </button>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── 対面モードボタン（対局中かつ参加プレイヤーのみ） ── */}
      {myColor !== null && game.status === "playing" && (
        <button onClick={onFaceToFace} style={{background:"transparent", border:"1px solid #c8b090", borderRadius:6, color:"#7a5838", padding:"4px 10px", cursor:"pointer", fontSize:18, fontWeight:"bold", whiteSpace:"nowrap"}}>
          {playerLang==="en" ? "Play Face-to-Face" : "対面モードで対局する"}
        </button>
      )}

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  将棋 ─ ロジック・コンポーネント
// ═══════════════════════════════════════════════════════════════

// 駒の表示（通常 / 成り）
const SK  = {K:"玉",R:"飛",B:"角",G:"金",S:"銀",N:"桂",L:"香",P:"歩"};
const SKP = {R:"龍",B:"馬",S:"全",N:"圭",L:"杏",P:"と"};
const SK_EN  = {K:"King",R:"Rook",B:"Bishop",G:"Gold",S:"Silver",N:"Knight",L:"Lance",P:"Pawn"};
const SKP_EN = {R:"Dragon",B:"Horse",S:"Pr.S",N:"Pr.N",L:"Pr.L",P:"Tokin"};

// 駒画像パス取得（先手K=王将・後手K=玉将、成り駒は成り画像）
const getShogiImg = (piece) => {
  if (!piece) return null;
  const { type, color, p } = piece;
  if (type === "K") return color === "b" ? _SHOGI_IMGS.ou : _SHOGI_IMGS.gyoku;
  if (p) {
    if (type === "R") return _SHOGI_IMGS.ryuou;
    if (type === "B") return _SHOGI_IMGS.ryuma;
    if (type === "P") return _SHOGI_IMGS.tokin;
    return _SHOGI_IMGS.narikin; // S・N・L の成り → 成金
  }
  const map = { R:"hisha", B:"kaku", G:"kin", S:"gin", N:"keima", L:"kyosha", P:"fuhyo" };
  return _SHOGI_IMGS[map[type]] || null;
};

function mkShogiBoard() {
  const E=null, b=(t)=>({color:"b",type:t,p:false}), w=(t)=>({color:"w",type:t,p:false});
  return [
    [w("L"),w("N"),w("S"),w("G"),w("K"),w("G"),w("S"),w("N"),w("L")],
    [E,     w("R"),E,    E,    E,    E,    E,    w("B"),E    ],
    [w("P"),w("P"),w("P"),w("P"),w("P"),w("P"),w("P"),w("P"),w("P")],
    [E,E,E,E,E,E,E,E,E],[E,E,E,E,E,E,E,E,E],[E,E,E,E,E,E,E,E,E],
    [b("P"),b("P"),b("P"),b("P"),b("P"),b("P"),b("P"),b("P"),b("P")],
    [E,     b("B"),E,    E,    E,    E,    E,    b("R"),E    ],
    [b("L"),b("N"),b("S"),b("G"),b("K"),b("G"),b("S"),b("N"),b("L")],
  ];
}
function mkShogiGames() { return [
  {id:"s1",name:"No.1",board:mkShogiBoard(),turn:"b",history:[],status:"waiting",players:{black:"",white:""},cap:{b:{},w:{}},undoRequest:null,redoHistory:[]},
  {id:"s2",name:"No.2",board:mkShogiBoard(),turn:"b",history:[],status:"waiting",players:{black:"",white:""},cap:{b:{},w:{}},undoRequest:null,redoHistory:[]},
  {id:"s3",name:"No.3",board:mkShogiBoard(),turn:"b",history:[],status:"waiting",players:{black:"",white:""},cap:{b:{},w:{}},undoRequest:null,redoHistory:[]},
]; }

// 生の移動マス（王手チェックなし）
function sShogiMoves(board, r, c) {
  const piece = board[r]?.[c]; if (!piece) return [];
  const {color, type, p:promoted} = piece;
  const f = color==="b" ? -1 : 1;
  const moves = [];
  const addSt = (dr,dc) => {
    const nr=r+dr, nc=c+dc;
    if (nr<0||nr>8||nc<0||nc>8) return;
    if (board[nr][nc]?.color===color) return;
    moves.push([nr,nc]);
  };
  const addSl = (dr,dc) => {
    let nr=r+dr, nc=c+dc;
    while(nr>=0&&nr<=8&&nc>=0&&nc<=8) {
      if (board[nr][nc]?.color===color) break;
      moves.push([nr,nc]);
      if (board[nr][nc]) break;
      nr+=dr; nc+=dc;
    }
  };
  const gd = [[f,-1],[f,0],[f,1],[-f,0],[0,-1],[0,1]];
  if (promoted && type!=="K"&&type!=="G"&&type!=="R"&&type!=="B") { gd.forEach(([dr,dc])=>addSt(dr,dc)); return moves; }
  switch(type) {
    case "P": promoted ? gd.forEach(([dr,dc])=>addSt(dr,dc)) : addSt(f,0); break;
    case "L": promoted ? gd.forEach(([dr,dc])=>addSt(dr,dc)) : addSl(f,0); break;
    case "N": promoted ? gd.forEach(([dr,dc])=>addSt(dr,dc)) : (addSt(2*f,-1),addSt(2*f,1)); break;
    case "S": promoted ? gd.forEach(([dr,dc])=>addSt(dr,dc)) : [[f,0],[f,-1],[f,1],[-f,-1],[-f,1]].forEach(([dr,dc])=>addSt(dr,dc)); break;
    case "G": gd.forEach(([dr,dc])=>addSt(dr,dc)); break;
    case "B": [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(([dr,dc])=>addSl(dr,dc)); if(promoted) [[0,-1],[0,1],[-1,0],[1,0]].forEach(([dr,dc])=>addSt(dr,dc)); break;
    case "R": [[0,-1],[0,1],[-1,0],[1,0]].forEach(([dr,dc])=>addSl(dr,dc)); if(promoted) [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(([dr,dc])=>addSt(dr,dc)); break;
    case "K": [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].forEach(([dr,dc])=>addSt(dr,dc)); break;
  }
  return moves;
}

function inShogiCheck(board, color) {
  let kr=-1, kc=-1;
  for (let r=0;r<9;r++) for (let c=0;c<9;c++) { const p=board[r][c]; if(p?.color===color&&p?.type==="K"){kr=r;kc=c;} }
  if (kr===-1) return false;
  const opp=color==="b"?"w":"b";
  for (let r=0;r<9;r++) for (let c=0;c<9;c++) {
    if (board[r][c]?.color!==opp) continue;
    if (sShogiMoves(board,r,c).some(([mr,mc])=>mr===kr&&mc===kc)) return true;
  }
  return false;
}

function applyShogiMove(board, cap, fr, fc, tr, tc, promote) {
  const nb=board.map(row=>row.map(p=>p?{...p}:null));
  const nc={b:{...cap.b},w:{...cap.w}};
  const piece={...nb[fr][fc]};
  const target=nb[tr][tc];
  if (target) nc[piece.color][target.type]=(nc[piece.color][target.type]||0)+1;
  if (promote) piece.p=true;
  nb[tr][tc]=piece; nb[fr][fc]=null;
  return {board:nb,cap:nc};
}
function applyShogiDrop(board, cap, tr, tc, color, pType) {
  const nb=board.map(row=>row.map(p=>p?{...p}:null));
  const nc={b:{...cap.b},w:{...cap.w}};
  nb[tr][tc]={color,type:pType,p:false};
  const n=(nc[color][pType]||0)-1; if(n<=0) delete nc[color][pType]; else nc[color][pType]=n;
  return {board:nb,cap:nc};
}
function getShogiLegalMoves(board, cap, r, c) {
  const piece=board[r]?.[c]; if(!piece) return [];
  const color=piece.color;
  return sShogiMoves(board,r,c).filter(([tr,tc])=>{
    const {board:nb}=applyShogiMove(board,cap,r,c,tr,tc,false);
    return !inShogiCheck(nb,color);
  });
}
const sMustPromote=(color,type,tr)=>{
  if(type==="P"||type==="L") return (color==="b"&&tr===0)||(color==="w"&&tr===8);
  if(type==="N") return (color==="b"&&tr<=1)||(color==="w"&&tr>=7);
  return false;
};
const sCanPromote=(color,type,fr,tr)=>{
  if(type==="K"||type==="G") return false;
  const inZ=(r)=>color==="b"?r<=2:r>=6;
  return inZ(fr)||inZ(tr);
};
function getShogiLegalDrops(board, cap, color, skipFuri=false) {
  const drops=[]; const opp=color==="b"?"w":"b";
  Object.entries(cap[color]||{}).forEach(([pType,count])=>{
    if(!count) return;
    for(let r=0;r<9;r++) for(let c=0;c<9;c++){
      if(board[r][c]) continue;
      if((pType==="P"||pType==="L")&&((color==="b"&&r===0)||(color==="w"&&r===8))) continue;
      if(pType==="N"&&((color==="b"&&r<=1)||(color==="w"&&r>=7))) continue;
      if(pType==="P"){
        let hasPawn=false;
        for(let rr=0;rr<9;rr++){const pp=board[rr][c];if(pp?.color===color&&pp?.type==="P"&&!pp.p){hasPawn=true;break;}}
        if(hasPawn) continue;
        if(!skipFuri){
          const {board:nb}=applyShogiDrop(board,cap,r,c,color,pType);
          if(inShogiCheck(nb,opp)&&!hasShogiAnyMove(nb,cap,opp,true)) continue;
        }
      }
      const {board:nb}=applyShogiDrop(board,cap,r,c,color,pType);
      if(!inShogiCheck(nb,color)) drops.push({r,c,pType});
    }
  });
  return drops;
}
function hasShogiAnyMove(board, cap, color, skipFuri=false) {
  for(let r=0;r<9;r++) for(let c=0;c<9;c++){
    if(board[r][c]?.color!==color) continue;
    if(sShogiMoves(board,r,c).some(([tr,tc])=>{const{board:nb}=applyShogiMove(board,cap,r,c,tr,tc,false);return !inShogiCheck(nb,color);})) return true;
  }
  return getShogiLegalDrops(board,cap,color,skipFuri).length>0;
}
const isShogiMate=(board,cap,color)=>inShogiCheck(board,color)&&!hasShogiAnyMove(board,cap,color);

// ── 将棋 盤面コンポーネント ──────────────────────────────────────
function ShogiBoard({ game, onUpdate, myColor, playerLang, pcLayout=false, flipped=false, cellSizeOverride=0 }) {
  const [sel, setSel] = useState(null);
  const [legal, setLegal] = useState([]);
  const [promPending, setPromPending] = useState(null);
  // 駒画像のロード状態をReact stateで管理（DOM直接操作はre-renderで上書きされるため）
  const _shogiLoadedRef = useRef(new Set());
  const [_shogiLoadedVer, _setShogiLoadedVer] = useState(0);
  const _markShogiLoaded = useCallback((src)=>{
    if(src && !_shogiLoadedRef.current.has(src)){
      _shogiLoadedRef.current.add(src);
      _setShogiLoadedVer(v=>v+1);
    }
  }, []);
  const {board, turn, cap={b:{},w:{}}, status} = game;
  const canAct = status==="playing" && !!myColor && myColor===turn;

  const cellSize = cellSizeOverride > 0 ? cellSizeOverride : (
    pcLayout
      ? Math.min(57, Math.floor((Math.min(window.innerWidth - 460, 536) - 8) / 9))
      : Math.round((Math.min(window.innerWidth*0.98, 560)-59)/9)
  );
  const font = "'Zen Old Mincho','Noto Serif JP',serif";

  // flip座標変換：flipped=true のとき (r,c) → (8-r, 8-c)
  const logR = (dr) => flipped ? 8-dr : dr;
  const logC = (dc) => flipped ? 8-dc : dc;

  const executeMove = (fr,fc,tr,tc,promote) => {
    const {board:nb,cap:nc}=applyShogiMove(board,cap,fr,fc,tr,tc,promote);
    const opp=myColor==="b"?"w":"b";
    const newStatus=isShogiMate(nb,nc,opp)?`cm_${myColor}`:"playing";
    const movingPlayerName = myColor==="b"?(game.players?.black||"先手"):(game.players?.white||"後手");
    const isCheckNow = newStatus==="playing" && inShogiCheck(nb,opp);
    const checkMsgData = isCheckNow ? {
      sender:movingPlayerName,
      text:playerLang==="en"?"♟ Check!":"♟ 王手！",
      ts:new Date().toISOString(),
      isJP:playerLang!=="en",
      auto:true,
      gameId:game.id,
      gameType:"shogi",
    } : null;
    if(checkMsgData && game.chatRoomId) push(ref(db,`chat/${game.chatRoomId}`),checkMsgData).catch(()=>{});
    onUpdate({...game,board:nb,cap:nc,turn:opp,status:newStatus,
      history:[...(game.history||[]),{from:[fr,fc],to:[tr,tc],promote,ts:new Date().toISOString()}],redoHistory:[],
      messages:(checkMsgData&&!game.chatRoomId)?[...(game.messages||[]),checkMsgData]:(game.messages||[])});
    setSel(null); setLegal([]);
    if(newStatus.startsWith("cm")) playSound("win"); else if(isCheckNow) playSound("check"); else playSound("move");
  };
  const executeDrop = (r,c,pType) => {
    const {board:nb,cap:nc}=applyShogiDrop(board,cap,r,c,myColor,pType);
    const opp=myColor==="b"?"w":"b";
    const newStatus=isShogiMate(nb,nc,opp)?`cm_${myColor}`:"playing";
    const movingPlayerName = myColor==="b"?(game.players?.black||"先手"):(game.players?.white||"後手");
    const isCheckNow = newStatus==="playing" && inShogiCheck(nb,opp);
    const checkMsgData = isCheckNow ? {
      sender:movingPlayerName,
      text:playerLang==="en"?"♟ Check!":"♟ 王手！",
      ts:new Date().toISOString(),
      isJP:playerLang!=="en",
      auto:true,
      gameId:game.id,
      gameType:"shogi",
    } : null;
    if(checkMsgData && game.chatRoomId) push(ref(db,`chat/${game.chatRoomId}`),checkMsgData).catch(()=>{});
    onUpdate({...game,board:nb,cap:nc,turn:opp,status:newStatus,
      history:[...(game.history||[]),{drop:pType,to:[r,c],ts:new Date().toISOString()}],redoHistory:[],
      messages:(checkMsgData&&!game.chatRoomId)?[...(game.messages||[]),checkMsgData]:(game.messages||[])});
    setSel(null); setLegal([]);
    if(newStatus.startsWith("cm")) playSound("win"); else if(isCheckNow) playSound("check"); else playSound("move");
  };
  const onCellClick = (dr,dc) => {
    // dr,dc は表示上の座標。論理座標に変換
    const r=logR(dr), c=logC(dc);
    if(!canAct) return;
    const piece=board[r][c];
    if(sel?.type==="drop"){
      if(legal.some(([lr,lc])=>lr===r&&lc===c)){executeDrop(r,c,sel.pType);return;}
      if(piece?.color===myColor){const m=getShogiLegalMoves(board,cap,r,c);setSel({type:"board",r,c});setLegal(m);return;}
      setSel(null);setLegal([]);return;
    }
    if(sel?.type==="board"){
      if(legal.some(([lr,lc])=>lr===r&&lc===c)){
        const mp=board[sel.r][sel.c];
        const must=sMustPromote(mp.color,mp.type,r);
        const can=!mp.p&&sCanPromote(mp.color,mp.type,sel.r,r);
        if(can&&!must){setPromPending({fr:sel.r,fc:sel.c,tr:r,tc:c});setSel(null);setLegal([]);}
        else executeMove(sel.r,sel.c,r,c,must);
        return;
      }
      if(piece?.color===myColor){const m=getShogiLegalMoves(board,cap,r,c);setSel({type:"board",r,c});setLegal(m);return;}
      setSel(null);setLegal([]);return;
    }
    if(piece?.color===myColor){const m=getShogiLegalMoves(board,cap,r,c);setSel({type:"board",r,c});setLegal(m);}
  };
  const onHandClick = (color,pType) => {
    if(!canAct||color!==myColor) return;
    const drops=getShogiLegalDrops(board,cap,myColor);
    const squares=drops.filter(d=>d.pType===pType).map(d=>[d.r,d.c]);
    if(sel?.type==="drop"&&sel.pType===pType){setSel(null);setLegal([]);return;}
    setSel({type:"drop",pType});setLegal(squares);
  };

  // PieceCell は関数として直接呼び出す（JSXコンポーネントとして使うと
  // ShogiBoard の再レンダリング毎に新しい型とみなされアンマウント→再マウントが
  // 発生し画像が再ロードされるため）
  const renderPieceCell = (piece,isSel,isLeg,isCheck,dr,dc) => {
    const pieceRotate = piece ? (
      flipped
        ? (piece.color==="b" ? "rotate(180deg)" : "none")
        : (piece.color==="w" ? "rotate(180deg)" : "none")
    ) : "none";
    const sz = cellSize-4;
    const pSrc = piece ? getShogiImg(piece) : null;
    const pLoaded = pSrc && _shogiLoadedRef.current.has(pSrc);
    return (
      <div key={`${dr}-${dc}`} onClick={()=>onCellClick(dr,dc)} style={{
        width:cellSize,height:cellSize,
        background:isCheck?"#ffaaaa":"#EDE0C8",
        display:"flex",alignItems:"center",justifyContent:"center",
        cursor:canAct?"pointer":"default",position:"relative",
        boxSizing:"border-box",overflow:"hidden",
      }}>
        {isSel&&<div style={{position:"absolute",inset:0,background:"rgba(100,130,60,0.5)",pointerEvents:"none",zIndex:1}}/>}
        {isLeg&&!piece&&<div style={{width:cellSize*0.28,height:cellSize*0.28,borderRadius:"50%",background:"rgba(180,100,30,0.38)",position:"relative",zIndex:2}}/>}
        {isLeg&&piece&&<div style={{position:"absolute",inset:1,border:"2px solid rgba(200,100,20,0.6)",borderRadius:2,pointerEvents:"none",zIndex:2}}/>}
        {piece&&<div style={{
          width:sz,height:sz,
          position:"relative",zIndex:3,
          transform:pieceRotate,
          userSelect:"none",
          filter: isSel ? "drop-shadow(0 0 3px rgba(180,100,30,0.7))" : "none",
        }}>
          {/* 漢字フォールバック — PNG未ロード時のみ表示 */}
          {!pLoaded&&<div style={{
            position:"absolute",inset:0,
            display:"flex",alignItems:"center",justifyContent:"center",
            background:piece.p?"#ffe8a0":piece.color==="b"?"#faf0dc":"#f0e8d8",
            border:`1.5px solid ${piece.color==="b"?"#5a3810":"#9a7040"}`,
            borderRadius:2,
            fontSize:Math.floor(sz*0.42),fontFamily:font,fontWeight:700,
            color:piece.p?"#8a3000":piece.color==="b"?"#1a0e04":"#6a4020",
            lineHeight:1,boxShadow:"0 1px 3px rgba(0,0,0,0.12)",
          }}>{piece.p?SKP[piece.type]:SK[piece.type]}</div>}
          {/* PNG画像 — React stateでopacityを制御（DOM直接操作はre-renderで上書きされる） */}
          <img
            src={pSrc}
            alt=""
            draggable={false}
            style={{
              position:"absolute",inset:0,
              width:"100%",height:"100%",
              objectFit:"contain",
              display:"block",
              opacity: pLoaded ? 1 : 0,
            }}
            ref={el=>{ if(el&&el.complete&&el.naturalWidth>0) _markShogiLoaded(pSrc); }}
            onLoad={()=>_markShogiLoaded(pSrc)}
            onError={()=>{}}
          />
        </div>}
      </div>
    );
  };

  const HandRow = ({color, isTop=false}) => {
    const cp=cap[color]||{};
    const types=["R","B","G","S","N","L","P"];
    const cs=cellSize;
    // 手駒は成らない状態の駒なので piece.p=false として getShogiImg を使う
    const handRotate = "none";
    return (
      <div style={{display:"flex",gap:3,flexWrap:"wrap",padding:"6px 4px",minHeight:Math.round(cs*0.8)+12,alignItems:"center",justifyContent:"center",background:"transparent"}}>
        {types.map(t=>{
          const count=cp[t]||0; if(!count) return null;
          const isSelDrop=sel?.type==="drop"&&sel.pType===t&&myColor===color;
          const imgSrc = getShogiImg({type:t, color, p:false});
          return (
            <div key={t} onClick={()=>onHandClick(color,t)} style={{position:"relative",cursor:myColor===color&&color===turn?"pointer":"default"}}>
              <div style={{
                width:Math.round(cs*0.8),height:Math.round(cs*0.8)+2,
                background:isSelDrop?"rgba(212,168,136,0.5)":"transparent",
                border:`1px solid ${isSelDrop?"#b88a6a":"transparent"}`,
                borderRadius:3,
                position:"relative",
                transform:handRotate,userSelect:"none",
                filter:isSelDrop?"drop-shadow(0 0 3px rgba(180,100,30,0.7))":"none",
              }}>
                {/* 漢字フォールバック — PNG未ロード時のみ表示 */}
                {!_shogiLoadedRef.current.has(imgSrc)&&<div style={{
                  position:"absolute",inset:0,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:Math.floor(cs*0.8*0.48),fontFamily:font,fontWeight:700,
                  color:color==="b"?"#1a0e04":"#6a4020",
                }}>{SK[t]}</div>}
                {/* PNG画像 — React stateでopacity制御 */}
                <img
                  src={imgSrc}
                  alt=""
                  draggable={false}
                  style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"contain",display:"block",
                    opacity: _shogiLoadedRef.current.has(imgSrc) ? 1 : 0}}
                  ref={el=>{ if(el&&el.complete&&el.naturalWidth>0) _markShogiLoaded(imgSrc); }}
                  onLoad={()=>_markShogiLoaded(imgSrc)}
                  onError={()=>{}}
                />
              </div>
              {count>1&&<span style={{position:"absolute",top:-4,right:-4,background:"#8a5020",color:"#fff",borderRadius:"50%",width:14,height:14,fontSize:8,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:"bold"}}>{count}</span>}
            </div>
          );
        })}
      </div>
    );
  };

  const boardW=cellSize*9+8;
  const shogiFileLabel = (dc) => String(9 - logC(dc));
  const shogiRankLabel = (dr) => ["一","二","三","四","五","六","七","八","九"][logR(dr)];

  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",width:"100%"}}>
      <HandRow color={flipped?"b":"w"} isTop={true}/>
      <div style={{
        background:"#D4A888",borderRadius:10,
        border:"1.5px solid rgba(154,120,72,0.65)",
        padding:"10px 10px 0 10px",
        boxShadow:"0 4px 20px rgba(60,40,20,0.20), inset 0 1px 2px rgba(255,230,180,0.20)",
        position:"relative",boxSizing:"border-box",
      }}>
        <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:0,overflow:"hidden",borderRadius:10}} viewBox="0 0 100 100" preserveAspectRatio="none">
          <rect x="3" y="3" width="94" height="94" fill="none" stroke="#c4a46a" strokeWidth="0.5" opacity="0.35" rx="1.5"/>
          <rect x="6" y="6" width="88" height="88" fill="none" stroke="#b89a60" strokeWidth="0.4" opacity="0.25" rx="1" strokeDasharray="3,5"/>
        </svg>
        {[{top:2,left:2},{top:2,right:2},{bottom:2,left:2},{bottom:2,right:2}].map((pos,i) => (
          <svg key={i} style={{position:"absolute",...pos,width:11,height:11,pointerEvents:"none",zIndex:10,overflow:"visible"}} viewBox="0 0 10 10">
            <circle cx="5" cy="5" r="5" fill="#c8a84b" opacity="0.6"/>
            <circle cx="5" cy="5" r="3" fill="none" stroke="#a88830" strokeWidth="0.8" opacity="0.7"/>
            <circle cx="5" cy="5" r="1.2" fill="#a88830" opacity="0.6"/>
          </svg>
        ))}
        {/* 筋ラベル（上）*/}
        <div style={{display:"flex",marginBottom:2,paddingRight:16}}>
          {Array.from({length:9},(_,dc)=>(
            <div key={dc} style={{width:cellSize,textAlign:"center",fontSize:9,color:"#7a5c38",fontFamily:"Georgia,serif",opacity:0.7,userSelect:"none",lineHeight:"13px",flexShrink:0}}>{shogiFileLabel(dc)}</div>
          ))}
        </div>
        <div style={{display:"flex",alignItems:"stretch"}}>
          <div style={{display:"grid",gridTemplateColumns:`repeat(9,${cellSize}px)`,gridTemplateRows:`repeat(9,${cellSize}px)`,gap:1,background:"#c49070",borderRadius:4}}>
            {Array.from({length:9},(_,dr)=>Array.from({length:9},(_,dc)=>{
              const r=logR(dr), c=logC(dc);
              const piece=board[r][c];
              const isSel=sel?.type==="board"&&sel.r===r&&sel.c===c;
              const isLeg=legal.some(([lr,lc])=>lr===r&&lc===c);
              const isCheck=piece?.type==="K"&&inShogiCheck(board,piece.color)&&status==="playing";
              return renderPieceCell(piece,isSel,isLeg,isCheck,dr,dc);
            }))}
          </div>
          {/* 段ラベル（右）*/}
          <div style={{display:"flex",flexDirection:"column",width:16,flexShrink:0}}>
            {Array.from({length:9},(_,dr)=>(
              <div key={dr} style={{height:cellSize+1/9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#7a5c38",fontFamily:"'Zen Old Mincho',serif",opacity:0.7,userSelect:"none",lineHeight:1}}>{shogiRankLabel(dr)}</div>
            ))}
          </div>
        </div>
        <div style={{textAlign:"center",fontFamily:"Georgia,serif",fontSize:9,color:"#8a6a40",letterSpacing:"2px",opacity:0.4,padding:"5px 0 7px",userSelect:"none"}}>FAMILY SHOGI — WOODEN TRAVELER SERIES</div>
      </div>
      <HandRow color={flipped?"w":"b"} isTop={false}/>
      {promPending&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.62)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:4000,fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif"}}>
          <div style={{background:"linear-gradient(145deg,#fffbf2,#f5ead8)",border:"1px solid #c8a860",borderRadius:20,padding:"28px 24px",maxWidth:300,width:"86vw",textAlign:"center",animation:"fadeInScale 0.3s ease-out"}}>
            <div style={{fontSize:44,marginBottom:8}}>♟</div>
            <h3 style={{color:"#3a2e22",fontSize:"clamp(19px,4vw,22px)",margin:"0 0 16px",fontWeight:500,letterSpacing:"0.05em"}}>
              {playerLang==="en"?"Promote?":"成りますか？"}
            </h3>
            <div style={{display:"flex",gap:12,justifyContent:"center"}}>
              <button onClick={()=>{executeMove(promPending.fr,promPending.fc,promPending.tr,promPending.tc,true);setPromPending(null);}}
                style={{background:"linear-gradient(135deg,#D4A888,#b88a6a)",border:"none",borderRadius:10,color:"#3a2e22",padding:"12px 22px",cursor:"pointer",fontSize:18,fontWeight:"bold"}}>
                {playerLang==="en"?"Promote":"成る"}
              </button>
              <button onClick={()=>{executeMove(promPending.fr,promPending.fc,promPending.tr,promPending.tc,false);setPromPending(null);}}
                style={{background:"#f0e8d8",border:"1px solid #c8b090",borderRadius:10,color:"#5a3c18",padding:"12px 22px",cursor:"pointer",fontSize:18}}>
                {playerLang==="en"?"Keep":"成らない"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 将棋 ゲームパネル ─────────────────────────────────────────────
// 将棋の指し手履歴を先頭から再生して盤面・持ち駒を復元
function replayShogiHistory(history) {
  let board = mkShogiBoard();
  let cap = {b:{},w:{}};
  for (let i = 0; i < history.length; i++) {
    const move = history[i];
    const color = i % 2 === 0 ? "b" : "w";
    if (move.drop) {
      const res = applyShogiDrop(board, cap, move.to[0], move.to[1], color, move.drop);
      board = res.board; cap = res.cap;
    } else if (move.from && move.to) {
      const res = applyShogiMove(board, cap, move.from[0], move.from[1], move.to[0], move.to[1], move.promote||false);
      board = res.board; cap = res.cap;
    }
  }
  return {board, cap};
}

function ShogiPanel({ game, onUpdate, playerName, playerLang, gameIndex, members, pcLayout=false, onStartModal, onToggleLayout=null, isKids=false, faceToFaceActive=false, onFaceToFaceEnd=null, gameMsgSeenTs="", onMsgSeen=null, onFaceToFaceChange=null }) {
  const serif = "'Cormorant Garamond','Zen Old Mincho',Georgia,serif";
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [extraTrans, setExtraTrans] = useState({});
  const [showWinModal, setShowWinModal] = useState(false);
  const [winMsg, setWinMsg] = useState({emoji:"",title:"",sub:""});
  const [showMsgModal, setShowMsgModal] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [faceToFace, setFaceToFace] = useState(false);
  const [boardPx, setBoardPx] = useState(0);
  const [boardAreaW, setBoardAreaW] = useState(0);
  const [boardAreaH, setBoardAreaH] = useState(0);
  const capturedNamesRef = useRef({black:"",white:""});
  const prevStatusRef = useRef(game.status);

  // ── リアクション機能（将棋） ──────────────────────────────────────
  const myShogiColor = game.players
    ? (game.players.black === playerName ? "b" : game.players.white === playerName ? "w" : null)
    : null;
  const [shogiReactionBar, setShogiReactionBar]   = useState(false);
  const [shogiReactionAnim, setShogiReactionAnim] = useState(null);
  const shogiReactionBarTimerRef = useRef(null);
  const shogiPrevHistLenRef = useRef((game.history || []).length);

  useEffect(() => {
    const hist = game.history || [];
    const len = hist.length;
    if (len > shogiPrevHistLenRef.current && myShogiColor && game.status === "playing") {
      const lastColor = hist[len - 1]?.color;
      if (lastColor && lastColor !== myShogiColor) {
        if (shogiReactionBarTimerRef.current) clearTimeout(shogiReactionBarTimerRef.current);
        setShogiReactionBar(true);
        shogiReactionBarTimerRef.current = setTimeout(() => setShogiReactionBar(false), 3000);
      }
    }
    shogiPrevHistLenRef.current = len;
  }, [(game.history || []).length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!game.id) return;
    const r = ref(db, `gameReactions/${game.id}`);
    const unsub = onValue(r, snap => {
      const d = snap.val();
      if (d && d.from && d.from !== playerName && d.emoji) {
        setShogiReactionAnim({ emoji: d.emoji, key: Date.now() });
        setTimeout(() => setShogiReactionAnim(null), 2000);
      }
    });
    return () => unsub();
  }, [game.id, playerName]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendShogiReaction = (emoji) => {
    setShogiReactionBar(false);
    if (shogiReactionBarTimerRef.current) clearTimeout(shogiReactionBarTimerRef.current);
    set(ref(db, `gameReactions/${game.id}`), { emoji, from: playerName, ts: Date.now() }).catch(() => {});
    setTimeout(() => set(ref(db, `gameReactions/${game.id}`), null).catch(() => {}), 3000);
    if (game.chatRoomId) {
      const logMsg = {
        text: playerLang === "en"
          ? `${playerName} sent ${emoji}`
          : `${playerName}が ${emoji} を送りました`,
        sender: playerName, ts: new Date().toISOString(),
        isJP: playerLang !== "en", reactionEmoji: emoji,
        auto: true, gameId: game.id, gameType: "shogi",
      };
      push(ref(db, `chat/${game.chatRoomId}`), logMsg).catch(() => {});
    }
  };

  // ResizeObserver で対面モードの盤面サイズを計算（幅・高さ両方記録）
  const boardAreaRefCb = useCallback((node) => {
    if (!node) return;
    const ro = new ResizeObserver(([entry]) => {
      const {width, height} = entry.contentRect;
      setBoardPx(Math.floor(Math.min(width, height)));
      setBoardAreaW(Math.floor(width));
      setBoardAreaH(Math.floor(height));
    });
    ro.observe(node);
  }, []);

  const { trans: uiTrans, queue: queueTrans } = useContext(TransContext);
  const t = (ja, en, kidsJa, kidsEn) => {
    if (isKids) {
      if (playerLang==="en") return kidsEn || en;
      return kidsJa || ja;
    }
    if (playerLang==="en") { if (ja) queueTrans(ja); return uiTrans[ja] || en; }
    return ja;
  };

  const {status, turn, players={}, history=[]} = game;
  const chatRoomId = game.chatRoomId || null;
  const blackName = players.black||(playerLang==="en"?"Black":"先手");
  const whiteName = players.white||(playerLang==="en"?"White":"後手");
  const myColor = status!=="playing"?null:
    players.black===playerName?"b":players.white===playerName?"w":null;
  const activeFaceToFace = pcLayout ? faceToFaceActive : faceToFace;
  const enterFaceToFace = () => { setFaceToFace(true); onFaceToFaceChange?.(true); };
  const exitFaceToFace = () => { if (pcLayout) { onFaceToFaceEnd?.(); } else { setFaceToFace(false); onFaceToFaceChange?.(false); } };

  // flipped: w（後手）が下。デフォルトは myColor==="w" のとき flip
  const [localFlipped, setLocalFlipped] = useState(()=>{
    const stored = localStorage.getItem(`shogi_${game.id}_flipped`);
    if (stored !== null) return stored === "true";
    return myColor === "w";
  });
  const setFlipped = (val) => {
    setLocalFlipped(val);
    localStorage.setItem(`shogi_${game.id}_flipped`, String(val));
  };
  useEffect(()=>{
    const newFlip = myColor === "w";
    setLocalFlipped(newFlip);
    localStorage.setItem(`shogi_${game.id}_flipped`, String(newFlip));
  },[game.id, game.players?.black, game.players?.white, playerName]); // eslint-disable-line

  // flipped=true → w（後手）が下、b（先手）が上
  const topColor = localFlipped ? "b" : "w";
  const bottomColor = localFlipped ? "w" : "b";
  const topName = topColor==="b" ? blackName : whiteName;
  const bottomName = bottomColor==="b" ? blackName : whiteName;

  // Firebase チャット購読
  useEffect(()=>{
    if(!chatRoomId){setChatMessages([]);return;}
    const msgRef = ref(db, `chat/${chatRoomId}`);
    const unsub = onValue(msgRef, snap=>{
      const data = snap.val();
      const arr = data ? Object.entries(data).map(([id,m])=>({id,...m})).sort((a,b)=>a.ts>b.ts?1:-1) : [];
      setChatMessages(arr);
    });
    return ()=>unsub();
  },[chatRoomId]);

  // ゲーム開始後のメッセージのみ表示
  const gameStartedAt = game.startedAt || (game.history?.length>0 ? game.history[0].ts : null);
  // chatRoomId なしの旧ゲームは game.messages フォールバック（チェスと同じパターン）
  const allMessages = chatRoomId ? chatMessages : (game.messages || []);
  const messages = allMessages.filter(m=>
    (!gameStartedAt||m.ts>=gameStartedAt) &&
    m.gameId===game.id
  );

  // 吹き出し既読マーク
  useEffect(()=>{
    if(!chatRoomId||!playerName||messages.length===0) return;
    const latestTs = messages.reduce((max,m)=>(m.ts>max?m.ts:max),"");
    if(latestTs) set(ref(db,`userReadTs/${playerName}/${chatRoomId}`),latestTs);
  },[chatRoomId,playerName,messages.length]); // eslint-disable-line

  // 翻訳キャッシュ（吹き出し用）
  useEffect(()=>{
    const candidates=[topName,bottomName]
      .map(name=>[...messages].reverse().find(m=>m.sender===name))
      .filter(Boolean);
    candidates.forEach(async m=>{
      if(!m.ts||m.translation||extraTrans[m.ts]!==undefined) return;
      setExtraTrans(prev=>({...prev,[m.ts]:null}));
      const tr = await translate(m.text||"");
      setExtraTrans(prev=>({...prev,[m.ts]:tr||""}));
    });
  },[messages,topName,bottomName]); // eslint-disable-line

  // 勝利モーダル
  useEffect(()=>{
    if(game.players?.black) capturedNamesRef.current.black=game.players.black;
    if(game.players?.white) capturedNamesRef.current.white=game.players.white;
  },[game.players?.black,game.players?.white]); // eslint-disable-line

  useEffect(()=>{
    const s=game.status;
    if(s===prevStatusRef.current) return;
    prevStatusRef.current=s;
    if(!s) return;
    const isTerminal=s.startsWith("cm")||s.startsWith("resign")||s==="draw";
    if(!isTerminal) return;
    const bn=capturedNamesRef.current.black||(playerLang==="en"?"Black":"先手");
    const wn=capturedNamesRef.current.white||(playerLang==="en"?"White":"後手");
    let emoji="🤝",title="",sub="";
    if(s==="draw"){title=playerLang==="en"?"Draw!":"引き分け！";sub="";}
    else {
      const winColor=s.endsWith("b")?"b":"w";
      const wName=winColor==="b"?bn:wn;
      emoji="🏆";
      title=playerLang==="en"?`${wName} wins!`:`${wName} の勝ち！`;
      sub=s.startsWith("cm")?(playerLang==="en"?"by Checkmate":"詰み"):(playerLang==="en"?"by Resignation":"投了");
    }
    setWinMsg({emoji,title,sub});setShowWinModal(true);
  },[game.status]); // eslint-disable-line

  const isBlackTurn = status==="playing" && turn==="b";
  const isWhiteTurn = status==="playing" && turn==="w";

  // 手を打ったらメッセージ通知をクリア（早期リターンの前に宣言）
  const prevShogiHistLen = useRef((game.history||[]).length);
  useEffect(()=>{
    const newLen=(game.history||[]).length;
    if(newLen>prevShogiHistLen.current){onMsgSeen?.();prevShogiHistLen.current=newLen;}
  },[(game.history||[]).length]); // eslint-disable-line
  // パネルが表示された時点で通知をクリア
  useEffect(()=>{ onMsgSeen?.(); }, []); // eslint-disable-line

  // 対面モード
  if (activeFaceToFace) {
    if (myColor === null) { exitFaceToFace(); return null; }
    const f2fBottomColor = myColor;
    const f2fTopColor = f2fBottomColor === "b" ? "w" : "b";
    const bottomPlayerName = playerName;
    const topPlayerName = f2fTopColor === "b" ? players.black : players.white;
    const isBottomTurn = turn === f2fBottomColor;
    const isTopTurn = !isBottomTurn;
    const f2fFlipped = f2fBottomColor === "w"; // 後手が下のとき flip

    // cs=cellSize のため HandRow高さ ≈ cellSize+24 × 2 = 2*cellSize+48
    // 盤面全体高さ ≈ 11*cellSize + 90（board + 2*HandRow + ラベル + padding）
    const f2fCellSize = (boardAreaW > 0 && boardAreaH > 0) ? Math.max(16,
      Math.floor(Math.min(
        (boardAreaW - 44) / 9,    // 幅制約
        (boardAreaH - 90) / 11    // 高さ制約: 11*cs + 90 ≈ total height
      ))
    ) : boardPx > 0 ? Math.max(16, Math.floor((boardPx - 44) / 9)) : 0;

    // 持ち駒行を先手/後手別に列挙
    const HandSummary = ({color}) => {
      const cp = (game.cap||{})[color]||{};
      const entries = Object.entries(cp).filter(([,n])=>n>0);
      if (!entries.length) return <span style={{color:"rgba(255,255,255,0.3)",fontSize:16}}>—</span>;
      return (
        <span style={{display:"flex",flexWrap:"wrap",gap:2,alignItems:"center"}}>
          {entries.map(([t,n])=>(
            <span key={t} style={{background:"rgba(255,255,255,0.12)",borderRadius:3,padding:"1px 4px",fontSize:16,color:"#f5e8d0",fontFamily:serif}}>
              {SK[t]}{n>1?`×${n}`:""}
            </span>
          ))}
        </span>
      );
    };
    const F2FInfoBar = ({color, name: pname, isMyTurn, onResign}) => (
      <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 10px",maxWidth:560,width:"100%",boxSizing:"border-box",
        background:isMyTurn?(color==="b"?"rgba(90,55,25,0.28)":"rgba(255,235,185,0.22)"):"rgba(255,255,255,0.05)",
        borderRadius:8,border:isMyTurn?(color==="b"?"2px solid rgba(160,100,50,0.55)":"2px solid rgba(196,160,80,0.55)"):"1px solid rgba(255,255,255,0.1)"}}>
        <img src={color==="b"?"/badges/shogi-black.webp":"/badges/shogi-white.webp"} style={{width:48,height:48,minWidth:48,borderRadius:"50%",objectFit:"cover",border:"1px solid #c8b090",display:"block",flexShrink:0}}/>
        <span style={{background:color==="b"?"#3a2010":"#fffdf0",color:color==="b"?"#f5e8d0":"#5a3808",border:color==="b"?"2px solid #8a6030":"2px solid #c4a058",borderRadius:5,padding:"1px 7px",fontSize:"clamp(18px,4vw,21px)",fontWeight:"bold",flexShrink:0}}>
          {t(color==="b"?"先手":"後手",color==="b"?"Black":"White")}
        </span>
        <span style={{color:isMyTurn?"#f5c878":"rgba(240,210,175,0.6)",fontSize:"clamp(18px,4vw,21px)",fontWeight:"bold",animation:isMyTurn?"pulse 1.5s ease-in-out infinite":"none",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flexShrink:1}}>{isMyTurn?t(`${pname}さんの番`,`${pname}'s turn`):pname}</span>
        <div style={{marginLeft:"auto",flexShrink:1,overflow:"hidden"}}><HandSummary color={color}/></div>
        {isMyTurn&&onResign&&status==="playing"&&(
          <button onClick={onResign} style={{background:"transparent",border:"1px solid #c8b090",borderRadius:6,color:"#7a5838",padding:"4px 10px",cursor:"pointer",fontSize:18,fontFamily:serif,flexShrink:0,marginLeft:4}}>
            {t("投了","Resign")}
          </button>
        )}
      </div>
    );
    const exitBtn = (
      <button onClick={exitFaceToFace} style={{position:"absolute",top:"calc(env(safe-area-inset-top) + 6px)",right:8,zIndex:10,background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.25)",borderRadius:8,color:"#fff",padding:"5px 10px",cursor:"pointer",fontSize:"clamp(18px,4vw,21px)",whiteSpace:"nowrap"}}>
        ✕ {t("終了","Exit")}
      </button>
    );
    return (
      <div style={{position:"fixed",inset:0,paddingTop:"env(safe-area-inset-top)",paddingBottom:"env(safe-area-inset-bottom)",background:"#2a1808",display:"flex",flexDirection:"column",zIndex:2000,overflow:"hidden",fontFamily:serif,boxSizing:"border-box"}}>
        {exitBtn}
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"2px 6px",paddingRight:90,flexShrink:0}}>
          <div style={{transform:"rotate(180deg)",width:"100%",maxWidth:560}}>
            <F2FInfoBar color={f2fTopColor} name={topPlayerName} isMyTurn={isTopTurn}
              onResign={isTopTurn?()=>{if(window.confirm(t(`${topPlayerName} が投了しますか？`,`Does ${topPlayerName} want to resign?`))){onUpdate({...game,status:`resign_${f2fTopColor==="b"?"w":"b"}`});playSound("win");exitFaceToFace();}}:null}/>
          </div>
        </div>
        <div ref={boardAreaRefCb} style={{flex:1,minHeight:0,display:"flex",alignItems:"center",justifyContent:"center",padding:"1px 4px",overflow:"hidden"}}>
          <div style={{width:boardPx>0?`${boardPx}px`:"min(calc(100vw - 8px),80vw)"}}>
            <ShogiBoard game={{...game}} onUpdate={onUpdate} myColor={turn} playerLang={playerLang} pcLayout={false} flipped={f2fFlipped} cellSizeOverride={f2fCellSize}/>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"2px 6px",flexShrink:0}}>
          <F2FInfoBar color={f2fBottomColor} name={bottomPlayerName} isMyTurn={isBottomTurn}
            onResign={isBottomTurn?()=>{if(window.confirm(t(`${bottomPlayerName} が投了しますか？`,`Does ${bottomPlayerName} want to resign?`))){onUpdate({...game,status:`resign_${f2fBottomColor==="b"?"w":"b"}`});playSound("win");exitFaceToFace();}}:null}/>
        </div>
      </div>
    );
  }

  const sendMsg = async () => {
    const tx=msg.trim(); if(!tx||busy||status!=="playing") return;
    setBusy(true);
    try {
      const tr=tx?await translate(tx):"";
      const isJP=tx?/[　-鿿]/.test(tx):false;
      const ts=new Date().toISOString();
      const newMsg={text:tx||"",translation:tr,isJP,ts,sender:playerName,gameId:game.id,gameType:"shogi",gameName:`No.${gameIndex+1}`};
      let roomId=chatRoomId;
      if(!roomId&&players.black&&players.white){
        roomId=await findOrCreateDmRoomDb(players.black,players.white);
        onUpdate({...game,chatRoomId:roomId});
      }
      if(roomId){
        await push(ref(db,`chat/${roomId}`),newMsg);
      } else {
        const next=[...(game.messages||[]),newMsg];
        onUpdate({...game,messages:next.slice(-50)});
      }
    } catch(e){console.error("shogi sendMsg error:",e);}
    setMsg(""); setBusy(false);
    onMsgSeen?.();
  };

  const btnStyle = {background:"transparent",border:"1px solid #c8b090",borderRadius:6,color:"#7a5838",
    padding:"5px 12px",cursor:"pointer",fontSize:18,fontFamily:serif};
  const btnPrimary = {background:"linear-gradient(135deg,#D4A888,#b88a6a)",border:"none",borderRadius:2,
    color:"#3a2e22",cursor:"pointer",fontWeight:600,letterSpacing:"0.04em"};

  // プレイヤーバー（チェスと同じ構造＋素材点数表示）
  const SHOGI_PIECE_VALUES = {R:5,B:5,G:3,S:3,N:2,L:2,P:1};
  const PlayerBar = ({color}) => {
    const name = color==="b"?blackName:whiteName;
    const isMyTurn = color==="b"?isBlackTurn:isWhiteTurn;
    const member = (members||[]).find(m=>m.name===name);
    const oppColor = color==="b"?"w":"b";
    const myScore = Object.entries((game.cap||{})[color]||{}).reduce((s,[tp,n])=>s+(SHOGI_PIECE_VALUES[tp]||0)*n,0);
    const oppScore = Object.entries((game.cap||{})[oppColor]||{}).reduce((s,[tp,n])=>s+(SHOGI_PIECE_VALUES[tp]||0)*n,0);
    const adv = myScore - oppScore;
    return (
      <div style={{display:"flex",flexDirection:"row",alignItems:"center",gap:8,
        padding:pcLayout?"4px 10px":"10px 16px",
        background:isMyTurn?(pcLayout?"rgba(210,170,80,0.18)":"#fff8ec"):"transparent",
        borderRadius:14,border:isMyTurn?"1px solid #d4a855":"none",
        transition:"all 0.3s",boxShadow:isMyTurn?"0 2px 12px rgba(180,140,40,0.14)":"none"}}>
        <AvatarIcon url={member?.avatarUrl} size={pcLayout?36:60} name={name}/>
        <span style={{color:"#7a6040", fontWeight:"bold", fontSize:pcLayout?18:"clamp(18px,4vw,21px)", flexShrink:0}}>＆</span>
        <ShogiKingBadge color={color} size={pcLayout?36:60}/>
        <div style={{flex:1,display:"flex",flexDirection:"column",gap:2,alignItems:"center",textAlign:"center",minWidth:0}}>
          <div style={{color:"#3a2e22",fontSize:pcLayout?18:"clamp(18px,4vw,21px)",fontWeight:500,fontFamily:serif,letterSpacing:"0.04em",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%"}}>
            {isMyTurn?<span style={{animation:"pulse 1.5s ease-in-out infinite"}}>{t(`${name}さんの番です`,`It's ${name}'s turn`,`${name}のばんです`,`It's ${name}'s turn`)}</span>:name}
          </div>
          {status==="playing"&&adv>0&&(
            <span style={{fontSize:pcLayout?16:"clamp(16px,3vw,18px)",color:"#6a8a30",fontWeight:700,fontFamily:serif}}>+{adv}</span>
          )}
        </div>
      </div>
    );
  };

  // 吹き出し（クリックでメッセージモーダルを開く）
  const ChatBubble = ({name, arrowDir}) => {
    const m = [...messages].reverse().find(msg2=>msg2.sender===name);
    if(!m) return null;
    const arrowUp = arrowDir==="up";
    const bubbleUnread = m.sender !== playerName && gameMsgSeenTs && m.ts > gameMsgSeenTs;
    return (
      <div onClick={()=>{ setShowMsgModal(true); onMsgSeen?.(); }} style={{position:"relative",marginTop:arrowUp?0:2,marginBottom:arrowUp?2:0,cursor:"pointer"}}>
        {arrowUp&&<>
          <div style={{position:"absolute",top:-7,left:22,width:0,height:0,borderLeft:"6px solid transparent",borderRight:"6px solid transparent",borderBottom:"7px solid #d4bc88"}}/>
          <div style={{position:"absolute",top:-6,left:23,width:0,height:0,borderLeft:"5px solid transparent",borderRight:"5px solid transparent",borderBottom:"6px solid #fffdf8"}}/>
        </>}
        <div style={{background:"#fffdf8",border:"1px solid #d4bc88",borderRadius:12,padding:pcLayout?"4px 8px":"6px 10px",display:"flex",alignItems:"flex-start",gap:6,boxShadow:"0 1px 6px rgba(42,26,8,0.08)",textAlign:"left"}}>
          <div style={{flex:1,minWidth:0}}>
            {m.text&&<div style={{fontSize:pcLayout?18:"clamp(18px,4vw,21px)",color:"#3a2e22",wordBreak:"break-word",lineHeight:1.5}}>{m.text}</div>}
            {(m.translation||extraTrans[m.ts])&&(
              <div style={{fontSize:pcLayout?18:"clamp(18px,4vw,21px)",color:"#7a6040",paddingLeft:4,borderLeft:"2px solid #c8b090",marginTop:2,lineHeight:1.4,wordBreak:"break-word"}}>
                {m.isJP?"🇺🇸":"🇯🇵"} {m.translation||extraTrans[m.ts]}
              </div>
            )}
            {m.ts&&<div style={{fontSize:pcLayout?18:"clamp(18px,4vw,21px)",color:"#b0a090",marginTop:2,fontFamily:serif,fontStyle:"italic"}}>{fmtDualT(m.ts,playerLang)}</div>}
          </div>

        </div>
        {!arrowUp&&<>
          <div style={{position:"absolute",bottom:-7,left:22,width:0,height:0,borderLeft:"6px solid transparent",borderRight:"6px solid transparent",borderTop:"7px solid #d4bc88"}}/>
          <div style={{position:"absolute",bottom:-6,left:23,width:0,height:0,borderLeft:"5px solid transparent",borderRight:"5px solid transparent",borderTop:"6px solid #fffdf8"}}/>
        </>}
        {bubbleUnread&&<span style={{position:"absolute",top:4,right:6,width:10,height:10,borderRadius:"50%",background:"#c03020",boxShadow:"0 0 4px rgba(192,48,32,0.7)",animation:"pulse 1.5s ease-in-out infinite"}}/>}
      </div>
    );
  };

  // 将棋 undo 承認ロジック
  const applyShogiUndo = (historyIndex) => {
    const newHistory = (history||[]).slice(0, historyIndex);
    const removedMoves = (history||[]).slice(historyIndex);
    const {board:nb,cap:nc} = replayShogiHistory(newHistory);
    const newTurn = newHistory.length%2===0?"b":"w";
    onUpdate({...game,board:nb,cap:nc,history:newHistory,turn:newTurn,redoHistory:removedMoves,undoRequest:null});
  };
  const applyShogiRedo = () => {
    const redoStack = game.redoHistory||[];
    if(!redoStack.length){onUpdate({...game,undoRequest:null});return;}
    const nextMove = redoStack[0];
    const newRedoHistory = redoStack.slice(1);
    const newHistory = [...(history||[]),nextMove];
    const {board:nb,cap:nc} = replayShogiHistory(newHistory);
    const newTurn = newHistory.length%2===0?"b":"w";
    onUpdate({...game,board:nb,cap:nc,history:newHistory,turn:newTurn,redoHistory:newRedoHistory,undoRequest:null});
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:pcLayout?6:28,background:"transparent",padding:pcLayout?"6px 12px":"28px 20px",width:"100%",maxWidth:"min(560px,98vw)"}}>

      {/* 行1：ルール・終了申請・投了（モバイルのみ・参加中の対局） */}
      {!pcLayout && myColor !== null && status==="playing" && (
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
          <button onClick={()=>setShowRulesModal(true)} style={{...btnStyle,padding:"5px 12px"}}>
            {t("ルール","Rules","ルール","Rules")}
          </button>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {!game.endRequest&&(
              <button onClick={()=>onUpdate({...game,endRequest:{requestedBy:myColor,requestedAt:new Date().toISOString()}})} style={btnStyle}>
                {t("終了申請","End Request","おわりたい","End")}
              </button>
            )}
            <button onClick={()=>{if(window.confirm(t("本当に投了しますか？","Are you sure?","まけをみとめる？","Give up?"))){onUpdate({...game,status:`resign_${myColor==="b"?"w":"b"}`});playSound("win");}}} style={btnStyle}>
              {t("投了","Resign","まけた","Resign")}
            </button>
          </div>
        </div>
      )}

      {/* キッズモードバナー */}
      {isKids&&(
        <div style={{textAlign:"center",padding:"10px",borderRadius:10,background:"#fef8e6",border:"1px solid #d4a855",color:"#5a3e18",fontSize:18,lineHeight:1.6}}>
          🧒 {t("キッズモード：駒を長押しで動き方を確認できます！","Kids Mode: Tap pieces to learn how they move!","こまをながおしすると、うごきかたがわかるよ！","Hold a piece to learn how it moves!")}
        </div>
      )}

      {/* 上吹き出し（下向き三角） */}
      <ChatBubble name={topName} arrowDir="down"/>

      {/* 上プレイヤーバー */}
      <PlayerBar color={topColor}/>

      {/* 盤面 */}
      <div style={{width:"100%",margin:"0 auto",display:"flex",justifyContent:"center"}}>
        <ShogiBoard game={game} onUpdate={onUpdate} myColor={myColor} playerLang={playerLang} pcLayout={pcLayout} flipped={localFlipped}/>
      </div>

      {/* 下プレイヤーバー */}
      <PlayerBar color={bottomColor}/>

      {/* 下吹き出し（上向き三角） */}
      <ChatBubble name={bottomName} arrowDir="up"/>

      {/* 相手視点ボタン＋メッセージ入力 */}
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        {myColor&&(
          <button onClick={()=>setFlipped(!localFlipped)} style={{...btnStyle,flexShrink:0,whiteSpace:"nowrap"}}>
            {t("相手視点","Flip","ひっくりかえす","Flip")}
          </button>
        )}
        <input value={msg} onChange={e=>setMsg(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendMsg()}
          placeholder={status!=="playing"?t("対局終了後は送信できません","Game has ended","おわったよ","Game ended"):t("日本語 or English...","English or 日本語...","なんでもかいてね！","Type anything!")}
          disabled={busy||status!=="playing"}
          style={{flex:1,background:status!=="playing"?"#f0ece4":"#fffdf8",border:"1px solid #c8b090",borderRadius:10,
            padding:pcLayout?"5px 10px":"8px 12px",color:status!=="playing"?"#a09080":"#3a2e22",
            fontSize:pcLayout?14:"clamp(18px,4vw,21px)",outline:"none",minWidth:0,
            cursor:status!=="playing"?"not-allowed":"text",fontFamily:serif}}/>
        <button onClick={sendMsg} disabled={busy||status!=="playing"}
          style={{...btnPrimary,padding:pcLayout?"5px 10px":"8px 14px",fontSize:pcLayout?14:"clamp(18px,4vw,21px)",borderRadius:10,flexShrink:0,
            opacity:status!=="playing"?0.4:1,cursor:status!=="playing"?"not-allowed":"pointer",
            boxShadow:"0 4px 12px rgba(180,120,80,0.22)"}}>
          {busy?"…":t("送信","Send","おくる","Send")}
        </button>
      </div>

      {/* ── 許可申請モーダル ── */}

      {/* 1. endRequest: 相手から申請 → 承認ポップアップ */}
      {game.endRequest&&game.endRequest.requestedBy!==myColor&&myColor!==null&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.80)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:3000,fontFamily:serif}}>
          <div style={{background:"linear-gradient(135deg,#2a1e0a,#4a3416)",border:"2px solid #ffaa44",borderRadius:24,padding:"32px 28px",maxWidth:360,width:"88vw",textAlign:"center",boxShadow:"0 20px 60px rgba(0,0,0,0.7)",animation:"fadeInScale 0.35s ease-out"}}>
            <div style={{fontSize:56,marginBottom:12,animation:"bounce 1s ease-in-out infinite"}}>🏁</div>
            <h2 style={{color:"#ffc060",fontFamily:serif,fontSize:"clamp(19px,4.5vw,24px)",margin:"0 0 12px"}}>{t("試合終了の申請","End Game Request","おわりたいって！","End Request!")}</h2>
            <p style={{color:"#ffe8b0",fontSize:"clamp(19px,4.5vw,22px)",margin:"0 0 28px",lineHeight:1.6}}>{t("相手が試合終了を申請しています","Opponent requested to end the game","おわりたいっていってるよ！","Opponent wants to end the game!")}</p>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <button onClick={()=>onUpdate({...game,status:"waiting",history:[],board:mkShogiBoard(),cap:{b:{},w:{}},endRequest:null,undoRequest:null,players:{black:"",white:""},name:`No.${gameIndex+1}`,redoHistory:[]})} style={{background:"linear-gradient(135deg,#cc3333,#aa1111)",border:"none",borderRadius:14,color:"#fff",padding:"16px 20px",cursor:"pointer",fontSize:"clamp(19px,4.5vw,23px)",fontWeight:"bold",boxShadow:"0 4px 14px rgba(180,20,20,0.45)"}}>
                ✓ {t("承認する","Approve","いいよ！","OK!")}
              </button>
              <button onClick={()=>onUpdate({...game,endRequest:null})} style={{background:"rgba(255,255,255,0.10)",border:"2px solid rgba(255,180,80,0.35)",borderRadius:14,color:"#ffddaa",padding:"14px 20px",cursor:"pointer",fontSize:"clamp(19px,4.5vw,22px)",fontWeight:"bold"}}>
                ✕ {t("断る","Decline","やだ！","No!")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. endRequest: 自分が申請待ち */}
      {game.endRequest&&game.endRequest.requestedBy===myColor&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.72)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:3000,fontFamily:serif}}>
          <div style={{background:"linear-gradient(145deg,#fffbf2,#f5ead8)",border:"1px solid #c8a860",borderRadius:20,padding:"32px 28px",maxWidth:360,width:"88vw",textAlign:"center",boxShadow:"0 12px 40px rgba(60,40,20,0.22)",animation:"fadeInScale 0.35s ease-out"}}>
            <div style={{fontSize:56,marginBottom:12,animation:"pulse 1.5s ease-in-out infinite"}}>⏳</div>
            <h2 style={{color:"#5a3e18",fontFamily:serif,fontWeight:500,fontSize:"clamp(19px,4.5vw,24px)",margin:"0 0 12px"}}>{t("終了申請中","End Game Requested","おわりたい！","Requesting End...")}</h2>
            <p style={{color:"#6a5030",fontSize:"clamp(18px,4.5vw,21px)",margin:"0 0 28px",lineHeight:1.8}}>{t("相手の承認を待っています...","Waiting for opponent's approval...","おともだちがOKするのをまってるよ...","Waiting for friend's OK...")}</p>
            <button onClick={()=>onUpdate({...game,endRequest:null})} style={{background:"#f5f0e8",border:"1px solid #d8c8a8",borderRadius:12,color:"#7a6858",padding:"14px 28px",cursor:"pointer",fontSize:"clamp(18px,4.5vw,21px)",fontWeight:"bold"}}>
              {t("取り消す","Cancel","やっぱりやめる","Cancel")}
            </button>
          </div>
        </div>
      )}

      {/* 3. undoRequest: 相手から申請 → 承認ポップアップ */}
      {(game.undoRequest||null)&&game.undoRequest.by!==myColor&&myColor!==null&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.80)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:3000,fontFamily:serif}}>
          <div style={{background:"linear-gradient(145deg,#fffbf2,#f5ead8)",border:"1px solid #c8a860",borderRadius:20,padding:"32px 28px",maxWidth:360,width:"88vw",textAlign:"center",boxShadow:"0 12px 40px rgba(60,40,20,0.22)",animation:"fadeInScale 0.35s ease-out"}}>
            <div style={{fontSize:56,marginBottom:12,animation:"bounce 1s ease-in-out infinite"}}>{game.undoRequest.type==="redo"?"↪":"↩"}</div>
            <h2 style={{color:"#5a3e18",fontFamily:serif,fontWeight:500,fontSize:"clamp(19px,4.5vw,24px)",margin:"0 0 12px"}}>
              {game.undoRequest.type==="redo"?t("やり直しの申請","Redo Request","やりなおしたいって！","Redo Request!"):t("手を戻す申請","Undo Request","もどしたいって！","Undo Request!")}
            </h2>
            <p style={{color:"#6a5030",fontSize:"clamp(18px,4.5vw,21px)",margin:"0 0 28px",lineHeight:1.8}}>
              {game.undoRequest.type==="redo"?t("相手がやり直しを申請しています","Opponent requested redo","おともだちがやりなおしたいって！","Friend wants to redo!"):t("相手が手を戻すことを申請しています","Opponent requested undo","おともだちがもどしたいって！","Friend wants to undo!")}
            </p>
            {game.undoRequest.type !== "redo" && (() => {
              const idx = game.undoRequest.historyIndex;
              const undoCount = (history||[]).length - idx;
              const prevHistory = (history || []).slice(0, idx);
              const {board: prevBoard, cap: prevCap} = replayShogiHistory(prevHistory);
              const prevTurn = prevHistory.length % 2 === 0 ? "b" : "w";
              const previewGame = { ...game, board: prevBoard, cap: prevCap, history: prevHistory, turn: prevTurn };
              return (
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:"clamp(16px,4vw,18px)",color:"#8a6030",marginBottom:8,textAlign:"center"}}>
                    {t(`${undoCount}手を取り消します`,`Undo ${undoCount} move${undoCount>1?"s":""}`,`${undoCount}てもどるよ`,`Undo ${undoCount} move${undoCount>1?"s":""}`)}
                  </div>
                  <div style={{pointerEvents:"none",transform:"scale(0.45)",transformOrigin:"top center",marginBottom:-120}}>
                    <ShogiBoard game={previewGame} onUpdate={()=>{}} myColor={null} playerLang={playerLang} pcLayout={false} flipped={false}/>
                  </div>
                </div>
              );
            })()}
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <button onClick={()=>{game.undoRequest.type==="redo"?applyShogiRedo():applyShogiUndo(game.undoRequest.historyIndex);}}
                style={{background:"linear-gradient(135deg,#7a5638,#5a3e28)",border:"none",borderRadius:12,color:"#f5ead8",padding:"16px 20px",cursor:"pointer",fontSize:"clamp(19px,4.5vw,23px)",fontWeight:"bold",boxShadow:"0 4px 14px rgba(90,60,30,0.28)"}}>
                ✓ {t("許可する","Allow","いいよ！","OK!")}
              </button>
              <button onClick={()=>onUpdate({...game,undoRequest:null})} style={{background:"#f5f0e8",border:"1px solid #d8c8a8",borderRadius:12,color:"#7a6858",padding:"14px 20px",cursor:"pointer",fontSize:"clamp(18px,4.5vw,21px)",fontWeight:"bold"}}>
                {t("断る","Decline","やだ！","No!")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. undoRequest: 自分が申請待ち */}
      {(game.undoRequest||null)?.by===myColor&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.72)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:3000,fontFamily:serif}}>
          <div style={{background:"linear-gradient(145deg,#fffbf2,#f5ead8)",border:"1px solid #c8a860",borderRadius:20,padding:"32px 28px",maxWidth:360,width:"88vw",textAlign:"center",boxShadow:"0 12px 40px rgba(60,40,20,0.22)",animation:"fadeInScale 0.35s ease-out"}}>
            <div style={{fontSize:56,marginBottom:12,animation:"pulse 1.5s ease-in-out infinite"}}>⏳</div>
            <h2 style={{color:"#5a3e18",fontFamily:serif,fontWeight:500,fontSize:"clamp(19px,4.5vw,24px)",margin:"0 0 12px"}}>
              {game.undoRequest.type==="redo"?t("やり直し申請中","Redo Requested","やりなおしたい！","Redo Requested!"):t("手戻し申請中","Undo Requested","もどしたい！","Undo Requested!")}
            </h2>
            <p style={{color:"#6a5030",fontSize:"clamp(18px,4.5vw,21px)",margin:"0 0 28px",lineHeight:1.8}}>{t("相手の承認を待っています...","Waiting for opponent's approval...","おともだちがOKするのをまってるよ...","Waiting for friend's OK...")}</p>
            <button onClick={()=>onUpdate({...game,undoRequest:null})} style={{background:"#f5f0e8",border:"1px solid #d8c8a8",borderRadius:12,color:"#7a6858",padding:"14px 28px",cursor:"pointer",fontSize:"clamp(18px,4.5vw,21px)",fontWeight:"bold"}}>
              {t("取り消す","Cancel","やっぱりやめる","Cancel")}
            </button>
          </div>
        </div>
      )}

      {/* 時計（PCでは右パネルへ） */}
      {!pcLayout&&<DualClock playerLang={playerLang} flat/>}

      {/* 指し手履歴（PCでは右パネルへ） */}
      {!pcLayout&&(
        <div style={{background:"transparent",borderRadius:0,padding:"8px 20px 22px",border:"none"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <span style={{fontFamily:"Georgia,serif",fontSize:18,letterSpacing:"1.5px",color:"#a89070",textTransform:"uppercase",opacity:0.8}}>{playerLang==="en"?"MOVE HISTORY":"指し手履歴"}</span>
            {myColor&&status==="playing"&&(()=>{
              const redoStack=game.redoHistory||[];
              const isMyRedoReq=(game.undoRequest||null)?.by===myColor&&game.undoRequest?.type==="redo";
              const canRedo=redoStack.length>0&&!(game.undoRequest||null);
              if(!canRedo&&!isMyRedoReq) return null;
              return (
                <button onClick={()=>{if(isMyRedoReq){onUpdate({...game,undoRequest:null});return;}if(!canRedo)return;onUpdate({...game,undoRequest:{by:myColor,type:"redo"}});}}
                  style={{background:"transparent",border:"1px solid #c8b090",borderRadius:6,color:"#7a5838",padding:"4px 10px",cursor:"pointer",fontSize:18,fontFamily:serif,fontWeight:"bold",whiteSpace:"nowrap",flexShrink:0}}>
                  {isMyRedoReq?`⏳ ${t("許可待ち…","Waiting...")}` : `${t("キャンセル","Cancel")}${redoStack.length>0?` (${redoStack.length})`:""}`}
                </button>
              );
            })()}
          </div>
          <div style={{maxHeight:180,overflowY:"auto",textAlign:"left"}}>
            {(!history||history.length===0)&&<span style={{color:"#b0a090",fontSize:18}}>{t("まだ手がありません","No moves yet","まだうごかしてないよ","No moves yet")}</span>}
            {[...(history||[])].reverse().map((h,i,arr)=>{
              const origIdx=arr.length-1-i;
              const moveColor=origIdx%2===0?"b":"w";
              const mName=moveColor==="b"?blackName:whiteName;
              const isWithin4=i<4;
              const canUndo=myColor&&isWithin4&&status==="playing"&&!(game.undoRequest||null);
              const isMyUndoReq=(game.undoRequest||null)?.by===myColor&&game.undoRequest?.type==="undo"&&game.undoRequest?.historyIndex===origIdx;
              const notation=h.drop?`${SK[h.drop]}打 (${h.to[0]+1},${h.to[1]+1})`:h.from&&h.to?`(${h.from[0]+1},${h.from[1]+1})→(${h.to[0]+1},${h.to[1]+1})${h.promote?"成":""}`:""
              return (
                <div key={origIdx} style={{display:"flex",alignItems:"center",gap:8,padding:"11px 0",borderBottom:"1px solid rgba(180,150,120,0.15)"}}>
                  <span style={{minWidth:24,color:"#b0a090",fontSize:"clamp(18px,3.5vw,20px)",fontFamily:serif,fontStyle:"italic"}}>{origIdx+1}.</span>
                  <span style={{display:"flex",alignItems:"center",gap:4,minWidth:56,fontSize:18,fontWeight:"bold",color:moveColor==="b"?"#5a3c28":"#7a5820",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                    <AvatarIcon url={(members||[]).find(m=>m.name===mName)?.avatarUrl} size={22} name={mName}/>
                    {moveColor==="b"?"☗":"☖"} {mName}
                  </span>
                  <span style={{minWidth:65,fontFamily:serif,fontWeight:600,fontSize:"clamp(18px,3.5vw,21px)",color:"#3a2e22",letterSpacing:"0.04em"}}>{notation}</span>
                  <span style={{color:"#a09080",fontSize:"clamp(18px,4vw,21px)",flex:1,fontFamily:serif,fontStyle:"italic"}}>{fmtDualT(h.ts,playerLang)}</span>
                  {(canUndo||isMyUndoReq)&&(
                    <button onClick={()=>{if(isMyUndoReq){onUpdate({...game,undoRequest:null});return;}if(!canUndo)return;onUpdate({...game,undoRequest:{by:myColor,type:"undo",historyIndex:origIdx}});}}
                      style={{background:"transparent",border:"1px solid #c8b090",borderRadius:6,color:"#7a5838",padding:"4px 10px",cursor:"pointer",fontSize:18,fontFamily:serif,fontWeight:"bold",whiteSpace:"nowrap",flexShrink:0}}>
                      {isMyUndoReq?`⏳ ${t("許可待ち…","Waiting...")}`:t("戻す","Back","もどす","Back")}
                    </button>
                  )}
                </div>
              );
            })}
            {(game.redoHistory||[]).map((h,i)=>{
              const redoIndex=(history||[]).length+i;
              const moveColor=redoIndex%2===0?"b":"w";
              const mName=moveColor==="b"?blackName:whiteName;
              const notation=h.drop?`${SK[h.drop]}打 (${h.to[0]+1},${h.to[1]+1})`:h.from&&h.to?`(${h.from[0]+1},${h.from[1]+1})→(${h.to[0]+1},${h.to[1]+1})${h.promote?"成":""}`:""
              return (
                <div key={`redo-${i}`} style={{display:"flex",alignItems:"center",gap:8,padding:"11px 0",borderBottom:"1px solid rgba(180,150,120,0.10)",opacity:0.45,textDecoration:"line-through"}}>
                  <span style={{minWidth:24,color:"#b0a090",fontSize:"clamp(18px,3.5vw,20px)",fontFamily:serif,fontStyle:"italic"}}>{redoIndex+1}.</span>
                  <span style={{display:"flex",alignItems:"center",gap:4,minWidth:56,fontSize:18,fontWeight:"bold",color:moveColor==="b"?"#5a3c28":"#7a5820",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                    {moveColor==="b"?"☗":"☖"} {mName}
                  </span>
                  <span style={{minWidth:65,fontFamily:serif,fontWeight:600,fontSize:"clamp(18px,3.5vw,21px)",color:"#3a2e22",letterSpacing:"0.04em"}}>{notation}</span>
                  <span style={{color:"#a09080",fontSize:"clamp(18px,4vw,21px)",flex:1,fontFamily:serif,fontStyle:"italic"}}>{fmtDualT(h.ts,playerLang)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* メッセージモーダル（ボトムシート） */}
      {showMsgModal&&(
        <div onClick={()=>setShowMsgModal(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:5000,display:"flex",alignItems:"flex-end",justifyContent:"center",fontFamily:serif}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#faf6f0",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:"min(560px,100vw)",maxHeight:"80vh",display:"flex",flexDirection:"column",boxShadow:"0 -4px 24px rgba(0,0,0,0.22)"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px 12px",borderBottom:"1px solid #e8d8b4",flexShrink:0}}>
              <span style={{fontFamily:serif,fontSize:"clamp(19px,4vw,22px)",fontWeight:500,color:"#5a3e18",letterSpacing:"0.06em"}}>💬 {t("メッセージ","Messages","メッセージ","Messages")}</span>
              <button onClick={()=>setShowMsgModal(false)} style={{background:"none",border:"none",color:"#a09080",cursor:"pointer",fontSize:22,padding:"4px 8px",lineHeight:1}}>✕</button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"8px 20px",textAlign:"left"}}>
              {(messages||[]).length===0&&<span style={{color:"#b0a090",fontSize:18,display:"block",padding:"16px 0"}}>{t("メッセージはまだありません","No messages yet","まだメッセージはないよ","No messages yet")}</span>}
              {[...(messages||[])].reverse().map((m,i)=>{
                const origIndex=(messages||[]).length-1-i;
                return (
                  <div key={origIndex} style={{padding:"10px 0",borderBottom:"1px solid rgba(180,150,120,0.12)",lineHeight:1.8}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                      <AvatarIcon url={members?.find(mb=>mb.name===m.sender)?.avatarUrl} size={32} name={m.sender||""}/>
                      <div style={{flex:1}}>
                        <span style={{color:"#5a3e28",fontWeight:500,fontSize:18,fontFamily:serif}}>{m.sender||"?"}: </span>
                        {m.text&&<span style={{color:"#3a2e22",fontSize:"clamp(18px,4vw,21px)"}}>{m.text}</span>}
                        {m.translation&&<div style={{color:"#5a4830",fontSize:18,paddingLeft:10,borderLeft:"2px solid #c8b090",marginTop:4,lineHeight:1.6}}>{m.isJP?"🇺🇸":"🇯🇵"} {m.translation}</div>}
                        <div style={{color:"#a09080",fontSize:18,marginTop:4,fontFamily:serif,fontStyle:"italic"}}>{fmtDualT(m.ts,playerLang)}</div>
                      </div>
                      {m.sender===playerName&&(
                        <button onClick={()=>{const nm=(game.messages||[]).filter((_,j)=>j!==origIndex);onUpdate({...game,messages:nm});}}
                          style={{background:"none",border:"none",color:"#b0a090",cursor:"pointer",fontSize:18,padding:"0 4px",flexShrink:0}}>🗑</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{display:"flex",gap:8,padding:"12px 16px 20px",borderTop:"1px solid #e8d8b4",flexShrink:0}}>
              <div style={{display:"flex",flexDirection:"column",width:"100%"}}>
                <div style={{display:"flex",gap:8}}>
                  <input value={msg} onChange={e=>setMsg(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendMsg()}
                    placeholder={status!=="playing"?t("対局終了後は送信できません","Game has ended","おわったよ","Game ended"):t("日本語 or English...","English or 日本語...","なんでもかいてね！","Type anything!")}
                    disabled={busy||status!=="playing"}
                    style={{flex:1,background:status!=="playing"?"#f0ece4":"#fffdf8",border:"1px solid #c8b090",borderRadius:10,padding:"10px 14px",color:status!=="playing"?"#a09080":"#3a2e22",fontSize:"clamp(18px,4vw,21px)",outline:"none",cursor:status!=="playing"?"not-allowed":"text"}}/>
                  <button onClick={sendMsg} disabled={busy||status!=="playing"}
                    style={{...btnPrimary,padding:"10px 18px",fontSize:"clamp(18px,4vw,21px)",borderRadius:10,opacity:status!=="playing"?0.4:1,cursor:status!=="playing"?"not-allowed":"pointer"}}>
                    {busy?"…":t("送信","Send","おくる","Send")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 対面モードボタン（モバイル・対局中・参加プレイヤーのみ） */}
      {!pcLayout&&status==="playing"&&myColor!==null&&(
        <button onClick={enterFaceToFace} style={{...btnStyle,width:"100%",fontSize:"clamp(18px,4vw,22px)",letterSpacing:"0.03em"}}>
          {t("対面モードで対局する","Play Face-to-Face","まえにいるひととあそぶ","Play Together!")}
        </button>
      )}

      {/* PC表示切り替えボタン（モバイルのみ） */}
      {!pcLayout&&onToggleLayout&&(
        <div style={{paddingTop:20}}>
          <button onClick={onToggleLayout} style={{...btnStyle,width:"100%",fontSize:"clamp(18px,4vw,22px)"}}>{t("PC表示に切り替える","Switch to PC View","PC表示に切り替える","Switch to PC View")}</button>
        </div>
      )}

      {/* ── ルールモーダル（将棋） ── */}
      {showRulesModal&&(
        <div onClick={()=>setShowRulesModal(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.72)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:3100,fontFamily:serif}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"linear-gradient(145deg,#fffbf2,#f5ead8)",border:"1px solid #c8a860",borderRadius:20,padding:"28px 24px",maxWidth:340,width:"88vw",boxShadow:"0 12px 40px rgba(60,40,20,0.25)",animation:"fadeInScale 0.3s ease-out"}}>
            <div style={{fontSize:16,letterSpacing:"2px",color:"#a89070",textTransform:"uppercase",marginBottom:14,textAlign:"center"}}>{playerLang==="en"?"Rules & Piece Values":"ルール ＆ 駒の点数"}</div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:16,letterSpacing:"1.8px",color:"#b09060",textTransform:"uppercase",borderBottom:"1px solid #e8d8b4",paddingBottom:4,marginBottom:8}}>{playerLang==="en"?"Rules":"ルール"}</div>
              {[
                {ja:"打ち歩詰め禁止",en:"No Pawn Drop Checkmate"},
                {ja:"成りは相手陣3段目から",en:"Promote in opponent's 3 rows"},
                {ja:"二歩禁止（同列に歩は1枚）",en:"No two pawns in same column"},
                {ja:"千日手は引き分け",en:"Repetition is a draw"},
              ].map(({ja,en},i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3px 0",borderBottom:"1px solid #f0e8d8"}}>
                  <span style={{fontSize:17,color:"#3a2e22"}}>{playerLang==="en"?en:ja}</span>
                  <span style={{fontSize:17,fontWeight:600,color:"#5a8030"}}>{playerLang==="en"?"On":"あり"}</span>
                </div>
              ))}
            </div>
            <div style={{marginBottom:20}}>
              <div style={{fontSize:16,letterSpacing:"1.8px",color:"#b09060",textTransform:"uppercase",borderBottom:"1px solid #e8d8b4",paddingBottom:4,marginBottom:8}}>{playerLang==="en"?"Piece Values":"駒の点数"}</div>
              {[
                {type:"R",val:5,ja:"飛車",en:"Rook"},
                {type:"B",val:5,ja:"角行",en:"Bishop"},
                {type:"G",val:3,ja:"金将",en:"Gold"},
                {type:"S",val:3,ja:"銀将",en:"Silver"},
                {type:"N",val:2,ja:"桂馬",en:"Knight"},
                {type:"L",val:2,ja:"香車",en:"Lance"},
                {type:"P",val:1,ja:"歩兵",en:"Pawn"},
              ].map(({type,val,ja,en})=>(
                <div key={type} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3px 0",borderBottom:"1px solid #f0e8d8"}}>
                  <span style={{fontSize:17,color:"#3a2e22",display:"flex",alignItems:"center",gap:6}}>
                    <img src={getShogiImg({type,color:"b",p:false})} style={{width:20,height:20,objectFit:"contain"}} alt={type}/>
                    {playerLang==="en"?en:ja}
                  </span>
                  <span style={{fontSize:17,fontWeight:500,color:"#3a2e22"}}>{val}</span>
                </div>
              ))}
            </div>
            <button onClick={()=>setShowRulesModal(false)} style={{width:"100%",background:"transparent",border:"1px solid #c8b090",borderRadius:8,color:"#7a5838",padding:"10px",cursor:"pointer",fontSize:17,fontFamily:serif}}>
              {playerLang==="en"?"Close":"閉じる"}
            </button>
          </div>
        </div>
      )}

      {/* 勝利モーダル */}
      {showWinModal&&(
        <div onClick={()=>setShowWinModal(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.80)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:3200,fontFamily:serif}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"linear-gradient(135deg,#2a1e0a,#4a3416)",border:"2px solid #c8a040",borderRadius:24,padding:"40px 32px",maxWidth:380,width:"88vw",textAlign:"center",boxShadow:"0 20px 60px rgba(0,0,0,0.70)",animation:"fadeInScale 0.35s ease-out"}}>
            <div style={{fontSize:64,marginBottom:12,animation:winMsg.emoji==="🏆"?"bounce 1s ease-in-out infinite":"pulse 1.5s ease-in-out infinite"}}>{winMsg.emoji}</div>
            <h2 style={{color:"#ffe8a0",fontFamily:serif,fontWeight:600,fontSize:"clamp(22px,5vw,28px)",margin:"0 0 8px",letterSpacing:"0.06em"}}>{winMsg.title}</h2>
            {winMsg.sub&&<p style={{color:"#d4b870",fontSize:"clamp(17px,4vw,20px)",margin:"0 0 28px",letterSpacing:"0.08em",textTransform:"uppercase"}}>{winMsg.sub}</p>}
            <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
              <button onClick={()=>setShowWinModal(false)} style={{background:"rgba(255,255,255,0.10)",border:"2px solid rgba(255,200,80,0.40)",borderRadius:14,color:"#ffe8a0",padding:"14px 32px",cursor:"pointer",fontSize:"clamp(17px,4vw,21px)",fontFamily:serif,letterSpacing:"0.04em"}}>
                {t("閉じる","Close","とじる","Close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 将棋リアクション：受信フローティングアニメーション ─── */}
      {shogiReactionAnim && (
        <div key={shogiReactionAnim.key} style={{
          position:"fixed", left:"50%", top:"40%", zIndex:9999,
          fontSize:"clamp(40px,10vw,64px)", pointerEvents:"none",
          animation:"reactionFloat 1.6s ease-out forwards",
        }}>
          {shogiReactionAnim.emoji}
        </div>
      )}

      {/* ─── 将棋リアクション：送信バー ─── */}
      {shogiReactionBar && myShogiColor && (
        <div style={{
          position:"fixed", bottom:72, left:"50%", transform:"translateX(-50%)",
          zIndex:3500, display:"flex", gap:6, padding:"8px 12px",
          background:"rgba(42,26,8,0.88)", borderRadius:32,
          boxShadow:"0 4px 16px rgba(0,0,0,0.40)",
          animation:"reactionBarIn 0.25s ease-out",
          backdropFilter:"blur(6px)",
        }}>
          {REACTIONS.map(r => (
            <button key={r} onClick={() => sendShogiReaction(r)} style={{
              background:"none", border:"none", cursor:"pointer",
              fontSize: r.length > 2 ? 13 : 26,
              padding: r.length > 2 ? "4px 8px" : "2px 4px",
              borderRadius:20, color: r.length > 2 ? "#ffe8a0" : "inherit",
              fontFamily:serif, transition:"transform 0.12s", lineHeight:1.2,
            }}
              onMouseEnter={e => e.currentTarget.style.transform="scale(1.35)"}
              onMouseLeave={e => e.currentTarget.style.transform="scale(1)"}
            >{r}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 将棋 右パネル（PC）────────────────────────────────────────────
const SHOGI_HIST_PREVIEW = 4;
function ShogiRightPanel({ game, onUpdate, playerName, playerLang, members, gameIndex, onStartModal, isKids=false, onFaceToFace, onAnalyze }) {
  const serif = "'Cormorant Garamond','Zen Old Mincho',Georgia,serif";
  const sm = 18;
  const secLabel = {fontFamily:"Georgia,serif",fontSize:sm,letterSpacing:"1.5px",color:WT.textMuted,textTransform:"uppercase",marginBottom:6,opacity:0.8};
  const [histExpanded, setHistExpanded] = useState(false);
  const {status,turn,players={},history=[]} = game;
  const blackName=players.black||(playerLang==="en"?"Black":"先手");
  const whiteName=players.white||(playerLang==="en"?"White":"後手");
  const myColor=status!=="playing"?null:players.black===playerName?"b":players.white===playerName?"w":null;
  const moveCount=history.length;
  const startTs = game.startedAt || history[0]?.ts;
  const startDate = startTs ? new Date(startTs).toLocaleDateString(playerLang==="en"?"en-US":"ja-JP",{year:"numeric",month:"short",day:"numeric"}) : "—";
  const t_ = (ja,en) => playerLang==="en"?en:ja;

  const applyShogiUndoR = (historyIndex) => {
    const newHistory=(history||[]).slice(0,historyIndex);
    const removedMoves=(history||[]).slice(historyIndex);
    const {board:nb,cap:nc}=replayShogiHistory(newHistory);
    const newTurn=newHistory.length%2===0?"b":"w";
    onUpdate({...game,board:nb,cap:nc,history:newHistory,turn:newTurn,redoHistory:removedMoves,undoRequest:null});
  };
  const applyShogiRedoR = () => {
    const redoStack=game.redoHistory||[];
    if(!redoStack.length){onUpdate({...game,undoRequest:null});return;}
    const nextMove=redoStack[0];
    const newRedoHistory=redoStack.slice(1);
    const newHistory=[...(history||[]),nextMove];
    const {board:nb,cap:nc}=replayShogiHistory(newHistory);
    const newTurn=newHistory.length%2===0?"b":"w";
    onUpdate({...game,board:nb,cap:nc,history:newHistory,turn:newTurn,redoHistory:newRedoHistory,undoRequest:null});
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14,width:"100%",fontFamily:serif}}>

      {/* ── 駒の点数 ── */}
      <div>
        <div style={secLabel}>{t_("駒の点数","PIECE VALUES")}</div>
        <div style={{display:"flex",flexDirection:"column",gap:3}}>
          {[
            {type:"R",val:5,ja:"飛車",en:"Rook"},
            {type:"B",val:5,ja:"角行",en:"Bishop"},
            {type:"G",val:3,ja:"金将",en:"Gold"},
            {type:"S",val:3,ja:"銀将",en:"Silver"},
            {type:"N",val:2,ja:"桂馬",en:"Knight"},
            {type:"L",val:2,ja:"香車",en:"Lance"},
            {type:"P",val:1,ja:"歩兵",en:"Pawn"},
          ].map(({type,val,ja,en})=>(
            <div key={type} style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:sm,color:WT.text,fontFamily:serif,display:"flex",alignItems:"center",gap:4}}>
                <img src={getShogiImg({type,color:"b",p:false})} style={{width:18,height:18,objectFit:"contain"}} alt={type}/>
                {playerLang==="en"?en:ja}
              </span>
              <span style={{fontSize:sm,fontWeight:500,color:WT.textDark,fontFamily:serif}}>{val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── 対局情報 ── */}
      <div>
        <div style={secLabel}>{t_("対局情報","GAME INFO")}</div>
        <div style={{display:"flex",flexDirection:"column",gap:3}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
            <span style={{fontSize:sm,color:WT.textMuted,fontFamily:serif}}>{t_("対局","Game")}</span>
            <span style={{fontSize:sm,fontWeight:500,color:WT.textDark,fontFamily:serif}}>No.{gameIndex+1}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
            <span style={{fontSize:sm,color:WT.textMuted,fontFamily:serif}}>{t_("開始日","Started")}</span>
            <span style={{fontSize:sm,color:WT.text,fontFamily:serif}}>{startDate}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
            <span style={{fontSize:sm,color:WT.textMuted,fontFamily:serif}}>{t_("☗ 先手","☗ Black")}</span>
            <span style={{fontSize:sm,color:WT.textDark,fontFamily:serif}}>{blackName}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
            <span style={{fontSize:sm,color:WT.textMuted,fontFamily:serif}}>{t_("☖ 後手","☖ White")}</span>
            <span style={{fontSize:sm,color:WT.textDark,fontFamily:serif}}>{whiteName}</span>
          </div>
          {status==="playing"&&(
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
              <span style={{fontSize:sm,color:WT.textMuted,fontFamily:serif}}>{t_("手番","Turn")}</span>
              <span style={{fontSize:sm,color:WT.textDark,fontFamily:serif}}>{turn==="b"?t_("☗ 先手","☗ Black"):t_("☖ 後手","☖ White")}</span>
            </div>
          )}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
            <span style={{fontSize:sm,color:WT.textMuted,fontFamily:serif}}>{t_("手数","Moves")}</span>
            <span style={{fontSize:sm,fontWeight:500,color:WT.textDark,fontFamily:serif}}>{moveCount}{t_("手目"," moves")}</span>
          </div>
          {status!=="playing"&&(
            <div style={{fontSize:sm,color:WT.textMuted,fontFamily:serif,fontStyle:"italic"}}>{status==="ended"?t_("終了","Ended"):t_("待機中","Waiting")}</div>
          )}
        </div>
      </div>

      {/* ── 終了申請・投了 ── */}
      {myColor!==null&&status==="playing"&&(
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {!game.endRequest&&(
            <button onClick={()=>onUpdate({...game,endRequest:{requestedBy:myColor,requestedAt:new Date().toISOString()}})}
              style={{background:"transparent",border:"1px solid #c8b090",borderRadius:6,color:"#7a5838",padding:"4px 10px",cursor:"pointer",fontSize:sm,fontWeight:"bold",whiteSpace:"nowrap",width:"100%",fontFamily:serif}}>
              {t_("終了申請","Request End")}
            </button>
          )}
          <button onClick={()=>{if(window.confirm(t_("本当に投了しますか？","Are you sure?"))){onUpdate({...game,status:`resign_${myColor==="b"?"w":"b"}`});playSound("win");}}}
            style={{background:"transparent",border:"1px solid #c8b090",borderRadius:6,color:"#7a5838",padding:"4px 10px",cursor:"pointer",fontSize:sm,fontWeight:"bold",whiteSpace:"nowrap",width:"100%",fontFamily:serif}}>
            {t_("投了","Resign")}
          </button>
        </div>
      )}


      {/* ── 指し手履歴 ── */}
      <div style={{flex:1,minHeight:0}}>
        <div style={secLabel}>{t_("指し手履歴","MOVE HISTORY")}</div>
        {myColor&&status==="playing"&&(()=>{
          const redoStack=game.redoHistory||[];
          const isMyRedoReq=(game.undoRequest||null)?.by===myColor&&game.undoRequest?.type==="redo";
          const canRedo=redoStack.length>0&&!(game.undoRequest||null);
          if(!canRedo&&!isMyRedoReq) return null;
          return (
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}>
              <button disabled={!canRedo&&!isMyRedoReq}
                onClick={()=>{if(isMyRedoReq){onUpdate({...game,undoRequest:null});return;}if(!canRedo)return;onUpdate({...game,undoRequest:{by:myColor,type:"redo"}});}}
                style={{background:isMyRedoReq?"#f5f0e8":canRedo?"transparent":"#d8d0c0",border:isMyRedoReq||canRedo?"1px solid #c8b090":"none",borderRadius:6,color:isMyRedoReq?"#5a4028":canRedo?"#7a5838":"#9a9080",padding:"3px 8px",cursor:(canRedo||isMyRedoReq)?"pointer":"not-allowed",fontSize:sm,fontWeight:"bold",whiteSpace:"nowrap",flexShrink:0,fontFamily:serif}}>
                {isMyRedoReq?`⏳ ${t_("許可待ち…","Waiting...")}`:`${t_("キャンセル","Cancel")}${redoStack.length>0?` (${redoStack.length})`:""}`}
              </button>
            </div>
          );
        })()}
        {(()=>{
          const reversed=[...(history||[])].reverse();
          const total=reversed.length;
          const showAll=histExpanded||total<=SHOGI_HIST_PREVIEW;
          const visible=showAll?reversed:reversed.slice(0,SHOGI_HIST_PREVIEW);
          return (
            <div style={{textAlign:"left"}}>
              {total===0&&<span style={{color:"#b0a090",fontSize:sm}}>{t_("まだ手がありません","No moves yet")}</span>}
              {visible.map((h,i)=>{
                const origIdx=total-1-i;
                const moveColor=origIdx%2===0?"b":"w";
                const mName=moveColor==="b"?blackName:whiteName;
                const isWithin4=i<4;
                const canUndo=myColor&&isWithin4&&status==="playing"&&!(game.undoRequest||null);
                const isMyUndoReq=(game.undoRequest||null)?.by===myColor&&game.undoRequest?.type==="undo"&&game.undoRequest?.historyIndex===origIdx;
                const notation=h.drop?`${SK[h.drop]}打 (${h.to[0]+1},${h.to[1]+1})`:h.from&&h.to?`(${h.from[0]+1},${h.from[1]+1})→(${h.to[0]+1},${h.to[1]+1})${h.promote?"成":""}`:""
                return (
                  <div key={origIdx} style={{display:"flex",alignItems:"center",gap:5,padding:"3px 0",borderBottom:"1px solid rgba(180,150,120,0.15)"}}>
                    <span style={{minWidth:22,color:"#b0a090",fontSize:sm,fontFamily:serif,fontStyle:"italic",flexShrink:0}}>{origIdx+1}.</span>
                    <AvatarIcon url={(members||[]).find(m=>m.name===mName)?.avatarUrl} size={20} name={mName}/>
                    <span style={{flex:1,display:"flex",alignItems:"baseline",gap:4,minWidth:0,overflow:"hidden"}}>
                      <span style={{fontFamily:serif,fontWeight:600,fontSize:sm,color:"#3a2e22",letterSpacing:"0.04em",whiteSpace:"nowrap"}}>{notation}</span>
                      <span style={{color:"#a09080",fontSize:sm,fontFamily:serif,fontStyle:"italic",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{fmtDualT(h.ts,playerLang)}</span>
                    </span>
                    {(canUndo||isMyUndoReq)&&(
                      <button onClick={()=>{if(isMyUndoReq){onUpdate({...game,undoRequest:null});return;}if(!canUndo)return;onUpdate({...game,undoRequest:{by:myColor,type:"undo",historyIndex:origIdx}});}}
                        style={{background:isMyUndoReq?"#f5f0e8":"transparent",border:"1px solid #c8b090",borderRadius:6,color:isMyUndoReq?"#5a4028":"#7a5838",padding:"3px 8px",cursor:"pointer",fontSize:sm,fontWeight:"bold",whiteSpace:"nowrap",flexShrink:0,marginLeft:"auto",fontFamily:serif}}>
                        {isMyUndoReq?"⏳":t_("戻す","Back")}
                      </button>
                    )}
                  </div>
                );
              })}
              {(game.redoHistory||[]).map((h,i)=>{
                const redoIndex=(history||[]).length+i;
                const moveColor=redoIndex%2===0?"b":"w";
                const mName=moveColor==="b"?blackName:whiteName;
                const notation=h.drop?`${SK[h.drop]}打 (${h.to[0]+1},${h.to[1]+1})`:h.from&&h.to?`(${h.from[0]+1},${h.from[1]+1})→(${h.to[0]+1},${h.to[1]+1})${h.promote?"成":""}`:""
                return (
                  <div key={`redo-${i}`} style={{display:"flex",alignItems:"center",gap:5,padding:"3px 0",borderBottom:"1px solid rgba(180,150,120,0.10)",opacity:0.45,textDecoration:"line-through"}}>
                    <span style={{minWidth:22,color:"#b0a090",fontSize:sm,fontFamily:serif,fontStyle:"italic",flexShrink:0}}>{redoIndex+1}.</span>
                    <span style={{flex:1,display:"flex",alignItems:"baseline",gap:4,minWidth:0,overflow:"hidden"}}>
                      <span style={{fontFamily:serif,fontWeight:600,fontSize:sm,color:"#3a2e22",letterSpacing:"0.04em",whiteSpace:"nowrap"}}>{notation}</span>
                      <span style={{color:"#a09080",fontSize:sm,fontFamily:serif,fontStyle:"italic",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{fmtDualT(h.ts,playerLang)}</span>
                    </span>
                  </div>
                );
              })}
              {total>SHOGI_HIST_PREVIEW&&(
                <button onClick={()=>setHistExpanded(v=>!v)} style={{background:"none",border:"none",cursor:"pointer",color:WT.textMid,fontSize:sm,fontFamily:serif,padding:"8px 0 4px",width:"100%",textAlign:"right",letterSpacing:"0.04em"}}>
                  {histExpanded?t_("閉じる ＜","Close ＜"):`${t_("もっと見る","More")} ＞ (${total-SHOGI_HIST_PREVIEW}${t_("手","")})`}
                </button>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── 対面モードボタン ── */}
      {myColor!==null&&status==="playing"&&(
        <button onClick={onFaceToFace} style={{background:"transparent",border:"1px solid #c8b090",borderRadius:6,color:"#7a5838",padding:"4px 10px",cursor:"pointer",fontSize:sm,fontWeight:"bold",whiteSpace:"nowrap",fontFamily:serif}}>
          {t_("対面モードで対局する","Play Face-to-Face")}
        </button>
      )}
    </div>
  );
}

// DM チャットルーム作成（モジュールスコープ — ShogiPanel / GamePanel どちらからも利用可能）
function _roomMembers(room) {
  if (Array.isArray(room.members)) return room.members;
  if (room.members && typeof room.members === "object") return Object.values(room.members);
  return [];
}
async function findOrCreateDmRoomDb(p1, p2) {
  const snap = await get(ref(db, "chatRooms"));
  const data = snap.val() || {};
  const existing = Object.entries(data).find(([id, room]) => {
    if (room.type !== "direct") return false;
    const m = _roomMembers(room);
    return m.includes(p1) && m.includes(p2);
  });
  if (existing) return existing[0];
  const newRoom = {
    name: `${p1} & ${p2}`,
    type: "direct",
    members: [p1, p2],
    createdBy: p1,
    createdAt: new Date().toISOString(),
  };
  const result = await push(ref(db, "chatRooms"), newRoom);
  return result.key;
}

// ═══════════════════════════════════════════════════════════════
//  駒の動き確認ページ ─ チェス
// ═══════════════════════════════════════════════════════════════
function mkChessPracticeBoard() {
  // Standard starting position (same as actual game)
  const b = (t) => ({color:"b",type:t});
  const w = (t) => ({color:"w",type:t});
  const back = ["R","N","B","Q","K","B","N","R"];
  const E = null;
  return [
    back.map(t=>b(t)),
    Array(8).fill(null).map(()=>b("P")),
    Array(8).fill(E),Array(8).fill(E),Array(8).fill(E),Array(8).fill(E),
    Array(8).fill(null).map(()=>w("P")),
    back.map(t=>w(t)),
  ];
}

const CHESS_PRACTICE_RULES_JA = [
  {piece:"歩（ポーン）", icon:"♟", desc:"前に1マス進む。初手のみ2マス。斜め前に敵を取れる。"},
  {piece:"桂馬（ナイト）",icon:"♞", desc:"L字に動く。他の駒を飛び越せる唯一の駒。"},
  {piece:"象（ビショップ）",icon:"♝", desc:"斜めに何マスでも進める。"},
  {piece:"飛車（ルーク）",icon:"♜", desc:"縦横に何マスでも進める。"},
  {piece:"女王（クイーン）",icon:"♛", desc:"縦横斜めに何マスでも進める。最強の駒。"},
  {piece:"王（キング）",icon:"♚", desc:"縦横斜めに1マスだけ進める。取られたら負け。"},
  {piece:"特殊ルール",icon:"✦", desc:"アンパッサン・キャスリング・プロモーションがある（ゲーム画面で有効）。"},
];

const CHESS_PRACTICE_RULES_EN = [
  {piece:"Pawn", icon:"♟", desc:"Moves 1 square forward. 2 on first move. Captures diagonally."},
  {piece:"Knight",icon:"♞", desc:"Moves in L-shape. Only piece that can jump over others."},
  {piece:"Bishop",icon:"♝", desc:"Moves diagonally any number of squares."},
  {piece:"Rook",icon:"♜", desc:"Moves horizontally/vertically any number of squares."},
  {piece:"Queen",icon:"♛", desc:"Moves in any direction any number of squares. Most powerful."},
  {piece:"King",icon:"♚", desc:"Moves 1 square in any direction. Cannot be captured."},
  {piece:"Special",icon:"✦", desc:"En passant, castling, and pawn promotion apply in real games."},
];

const CHESS_PIECE_LIST = [
  {type:"K", img:"/pieces/wK.webp", nameJa:"王（キング）",   nameEn:"King",   descJa:"縦横斜め1マス。取られたら負け",          descEn:"1 sq any dir. Game over if captured",   pts:"∞"},
  {type:"Q", img:"/pieces/wQ.webp", nameJa:"女王（クイーン）",nameEn:"Queen",  descJa:"縦横斜め何マスでも動ける最強駒",          descEn:"Any dir, any distance. Most powerful",  pts:"9"},
  {type:"R", img:"/pieces/wR.webp", nameJa:"飛車（ルーク）",  nameEn:"Rook",   descJa:"縦横に何マスでも",                      descEn:"Horizontal & vertical, any distance",   pts:"5"},
  {type:"B", img:"/pieces/wB.webp", nameJa:"象（ビショップ）",nameEn:"Bishop", descJa:"斜めに何マスでも",                      descEn:"Diagonal, any distance",                pts:"3"},
  {type:"N", img:"/pieces/wN.webp", nameJa:"桂馬（ナイト）",  nameEn:"Knight", descJa:"L字に動く。駒を飛び越せる唯一の駒",      descEn:"L-shape. Only piece that can jump",     pts:"3"},
  {type:"P", img:"/pieces/wP.webp", nameJa:"歩（ポーン）",    nameEn:"Pawn",   descJa:"前1マス進む。斜め前に取る。最終段でクイーンに昇格",descEn:"1 sq forward. Captures diagonally. Promotes to Queen", pts:"1"},
];
const CHESS_VS_SHOGI_JA = [
  "取った駒は消える（将棋の「持ち駒」制度なし）",
  "成れるのはポーンのみ。最終段でクイーン・ルーク・ビショップ・ナイトを選べる",
  "キャスリング：王と端ルークが1手で入れ替わる特殊手",
  "アンパッサン：2マス進んだポーンを隣のポーンが斜めに取れる特殊規則",
  "チェックメイトになった瞬間即終了。入玉（敵陣への王の侵入）で引き分けになる場合がある",
];
const CHESS_VS_SHOGI_EN = [
  "Captured pieces are removed from the game (no 'hand pieces' like in Shogi)",
  "Only Pawns can promote — choose Queen, Rook, Bishop or Knight at the last rank",
  "Castling: King and Rook swap positions in a single move",
  "En passant: a pawn that moved 2 squares can be captured diagonally by an adjacent enemy pawn",
  "Game ends immediately on checkmate. Stalemate is a draw",
];
const SHOGI_PIECE_LIST_BASE = [
  {type:"K",p:false,nameJa:"玉将（王将）",nameEn:"King",   descJa:"縦横斜め1マス。取られたら負け",       descEn:"1 sq any dir. Lose if captured",          promType:null, pts:"∞"},
  {type:"R",p:false,nameJa:"飛車",        nameEn:"Rook",   descJa:"縦横に何マスでも",                   descEn:"Vert & horiz, any distance",              promType:"R",  pts:"5"},
  {type:"B",p:false,nameJa:"角行",        nameEn:"Bishop", descJa:"斜めに何マスでも",                   descEn:"Diagonal, any distance",                  promType:"B",  pts:"5"},
  {type:"G",p:false,nameJa:"金将",        nameEn:"Gold",   descJa:"縦横＋斜め前方向に1マス。成れない",  descEn:"1 sq vert/horiz/diag-fwd. Cannot promote",promType:null, pts:"3"},
  {type:"S",p:false,nameJa:"銀将",        nameEn:"Silver", descJa:"前と斜め4方向に1マス",               descEn:"1 sq: forward & all diagonals",           promType:"S",  pts:"3"},
  {type:"N",p:false,nameJa:"桂馬",        nameEn:"Knight", descJa:"前2・横1のL字のみ。他を飛び越せる", descEn:"L-shape forward only. Can jump over pieces",promType:"N", pts:"2"},
  {type:"L",p:false,nameJa:"香車",        nameEn:"Lance",  descJa:"前に何マスでも",                     descEn:"Forward any distance",                    promType:"L",  pts:"2"},
  {type:"P",p:false,nameJa:"歩兵",        nameEn:"Pawn",   descJa:"前に1マスのみ",                      descEn:"1 sq forward only",                       promType:"P",  pts:"1"},
];
const SHOGI_PIECE_LIST_PROM = [
  {type:"R",p:true,nameJa:"竜王（龍）",nameEn:"Dragon",     descJa:"飛車＋斜め1マス",    descEn:"Rook + 1 sq diag",       pts:"5"},
  {type:"B",p:true,nameJa:"竜馬（馬）",nameEn:"Horse",      descJa:"角行＋縦横1マス",    descEn:"Bishop + 1 sq vert/horiz",pts:"5"},
  {type:"S",p:true,nameJa:"成銀（全）",nameEn:"Prom.Silver",descJa:"金将と同じ動き",     descEn:"Moves like Gold",         pts:"3"},
  {type:"N",p:true,nameJa:"成桂（圭）",nameEn:"Prom.Knight",descJa:"金将と同じ動き",     descEn:"Moves like Gold",         pts:"2"},
  {type:"L",p:true,nameJa:"成香（杏）",nameEn:"Prom.Lance", descJa:"金将と同じ動き",     descEn:"Moves like Gold",         pts:"2"},
  {type:"P",p:true,nameJa:"と金",      nameEn:"Tokin",      descJa:"金将と同じ動き",     descEn:"Moves like Gold",         pts:"1"},
];
const SHOGI_VS_CHESS_JA = [
  "取った駒を「持ち駒」として自分の番に盤上へ打てる（最大の特徴）",
  "飛車・角行・銀将・桂馬・香車・歩兵が敵陣（3段目以内）で「成り」別の動きに変化",
  "クイーンに相当する駒はなく、竜王（飛車成）・竜馬（角行成）が最強",
  "駒に向きがある。後ろに下がれない駒（歩・香・桂）は敵陣に入ると成ることが多い",
  "打ち歩詰め・二歩などの反則がある。千日手・持将棋によるドロー規則あり",
];
const SHOGI_VS_CHESS_EN = [
  "Captured pieces become your own 'hand pieces' — you can drop them back on the board",
  "Rook, Bishop, Silver, Knight, Lance and Pawn can promote inside enemy territory (top 3 rows)",
  "No queen; Dragon (promoted Rook) and Horse (promoted Bishop) are the strongest pieces",
  "Pieces have direction — pieces that can't retreat (Pawn, Lance, Knight) usually promote in enemy territory",
  "Special rules: no pawn-drop checkmate, no two pawns in same column; perpetual check and impasse draws",
];
const CHESS_FORMATIONS = [
  { id:"kingside_castle", nameJa:"キングサイドキャスリング", nameEn:"Kingside Castle",
    descJa:"王をg1・ルークをf1に配置。f・g・hポーンが盾となる最も基本的な安全陣形。",
    descEn:"King to g1, Rook to f1. The f/g/h pawns form a shield — the most common safe king position.",
    pieces:[[7,6,"K","w"],[7,5,"R","w"],[6,5,"P","w"],[6,6,"P","w"],[6,7,"P","w"]] },
  { id:"queenside_castle", nameJa:"クイーンサイドキャスリング", nameEn:"Queenside Castle",
    descJa:"王をc1・ルークをd1に配置。攻撃的な展開と組み合わせやすい反撃しやすい陣形。",
    descEn:"King to c1, Rook to d1. Often paired with aggressive play — more dynamic than kingside.",
    pieces:[[7,2,"K","w"],[7,3,"R","w"],[6,0,"P","w"],[6,1,"P","w"],[6,2,"P","w"]] },
  { id:"fianchetto", nameJa:"フィアンケット", nameEn:"Fianchetto",
    descJa:"ビショップをg2に展開し長い対角線を支配。King's Indianやドラゴン変化の強力な配置。",
    descEn:"Bishop to g2 controls the long diagonal. A key setup in King's Indian and Dragon variations.",
    pieces:[[7,6,"K","w"],[7,7,"R","w"],[6,6,"B","w"],[6,5,"P","w"],[6,7,"P","w"]] },
  { id:"pawn_center", nameJa:"ポーン中央支配", nameEn:"Pawn Center",
    descJa:"e4・d4のポーンで中央を制圧しナイトをf3・c3に展開。全駒の働きを高める基本陣形。",
    descEn:"Pawns on e4 and d4 dominate the center, Knights to f3 and c3. A foundational setup.",
    pieces:[[4,4,"P","w"],[4,3,"P","w"],[5,5,"N","w"],[5,2,"N","w"]] },
  { id:"knight_outpost", nameJa:"ナイト前哨地", nameEn:"Knight Outpost",
    descJa:"ナイトをd5/e5などの中央前哨地に配置し相手ポーンで攻撃できない強力な位置を確保する配置。",
    descEn:"A knight planted on d5/e5 where no enemy pawn can attack it — a dominant central outpost.",
    pieces:[[3,3,"N","w"],[4,3,"P","w"],[4,4,"P","w"],[5,5,"B","w"]] },
  { id:"rook_battery", nameJa:"ルーク砲台", nameEn:"Rook Battery",
    descJa:"2枚のルークを同じファイルまたはランクに並べ圧倒的な縦・横の支配力を生む基本的な終盤陣形。",
    descEn:"Two rooks doubled on a file or rank — a powerful battery that dominates lines in the endgame.",
    pieces:[[0,3,"R","w"],[4,3,"R","w"],[7,4,"K","w"]] },
  { id:"bishop_pair", nameJa:"ビショップペア", nameEn:"Bishop Pair",
    descJa:"2枚のビショップで盤の両対角線を支配。オープンポジションで特に強力な長距離支配陣形。",
    descEn:"Two bishops controlling both diagonals. Especially powerful in open positions with long-range dominance.",
    pieces:[[4,4,"B","w"],[4,2,"B","w"],[5,5,"N","w"],[5,2,"N","w"],[7,4,"K","w"]] },
];
const SHOGI_FORMATIONS = [
  { id:"yagura", nameJa:"矢倉囲い", nameEn:"Yagura Castle",
    descJa:"金銀を組み合わせた居飛車の代表陣形。上部に強く横も堅固。攻守バランスが優れた囲い。",
    descEn:"The classic static-rook castle. Strong against vertical attacks, balanced offense and defense.",
    pieces:[[7,3,"K",false],[7,2,"G",false],[6,2,"G",false],[6,3,"S",false],[6,1,"S",false]] },
  { id:"mino", nameJa:"美濃囲い", nameEn:"Mino Castle",
    descJa:"振り飛車の代表陣形。コンパクトで素早く完成。振り飛車戦で最多使用のバランスの良い囲い。",
    descEn:"The standard ranging-rook castle. Compact and quick to build, most common in rook-swinging games.",
    pieces:[[7,1,"K",false],[7,2,"G",false],[6,2,"S",false]] },
  { id:"anaguma", nameJa:"穴熊", nameEn:"Anaguma",
    descJa:"玉を9九の隅に配置した最も堅固な囲い。崩しにくいが完成まで多くの手数が必要。",
    descEn:"King tucked in the corner — the most solid castle. Very hard to break but takes many moves.",
    pieces:[[8,0,"K",false],[8,1,"G",false],[7,0,"G",false],[7,1,"S",false]] },
  { id:"funa_gakoi", nameJa:"舟囲い", nameEn:"Boat Castle",
    descJa:"居飛車の最もシンプルな囲い。素早く完成でき速攻に向いた実戦的な陣形。",
    descEn:"The simplest static-rook castle. Quick to build, ideal for fast attacks.",
    pieces:[[8,3,"K",false],[7,4,"G",false],[7,5,"S",false]] },
  { id:"hidari_mino", nameJa:"左美濃囲い", nameEn:"Left Mino Castle",
    descJa:"居飛車で美濃と似た配置を左側に築く囲い。振り飛車に対して有力な持久戦向けの囲い。",
    descEn:"A static-rook castle mirroring the Mino on the left. Effective against ranging-rook strategies.",
    pieces:[[7,7,"K",false],[7,6,"G",false],[6,6,"S",false],[8,7,"G",false]] },
  { id:"ibisha_anaguma", nameJa:"居飛車穴熊", nameEn:"Static Rook Anaguma",
    descJa:"居飛車のまま玉を1九に深く潜らせた超堅固な囲い。長期戦に最も強い現代の最強囲いの一つ。",
    descEn:"King buried deep on 1i with static rook — the ultimate fortress. Dominant in prolonged games.",
    pieces:[[8,8,"K",false],[8,7,"G",false],[7,8,"G",false],[7,7,"S",false],[7,6,"S",false]] },
  { id:"kin_musou", nameJa:"金無双", nameEn:"Kin-Musou",
    descJa:"金2枚で玉を守る左右対称の囲い。コンパクトで速攻向きだが上部が薄く注意が必要。",
    descEn:"Two golds protect the king in a symmetric formation. Quick to build but vulnerable from above.",
    pieces:[[8,4,"K",false],[8,3,"G",false],[8,5,"G",false]] },
];

const SHOGI_AI_LEVELS = [
  {nameJa:"キッズ",    nameEn:"Kids"},
  {nameJa:"入門",      nameEn:"Beginner"},
  {nameJa:"初級",      nameEn:"Easy"},
  {nameJa:"初中級",    nameEn:"Easy+"},
  {nameJa:"中級",      nameEn:"Medium"},
  {nameJa:"中上級",    nameEn:"Medium+"},
  {nameJa:"上級",      nameEn:"Hard"},
  {nameJa:"高段",      nameEn:"Hard+"},
  {nameJa:"マスター",  nameEn:"Expert"},
  {nameJa:"エキスパート",nameEn:"Master"},
];

// Shared AI controls UI (used in both ChessPracticeBoard and ShogiPracticeBoard)
function AIControlBar({vsAI,setVsAI,aiLevel,setAiLevel,aiColor,setAiColor,aiThinking,playerLang,gameType,serif,onToggle,onAnalyze,canAnalyze}){
  const t=(ja,en)=>playerLang==="en"?en:ja;
  const levels=gameType==="chess"?CHESS_AI_LEVELS:SHOGI_AI_LEVELS;
  const lv=levels[Math.min(aiLevel-1,levels.length-1)];
  const btnBase={border:"1px solid #c8b090",borderRadius:6,cursor:"pointer",fontFamily:serif,fontSize:16,padding:"4px 10px",transition:"background 0.15s"};
  return (
    <div style={{width:"100%",padding:"8px 0 4px",display:"flex",flexDirection:"column",gap:6}}>
      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <button onClick={onToggle||((e)=>setVsAI(v=>!v))} style={{...btnBase,background:vsAI?"#c8a86a":"#faf5e8",color:vsAI?"#fff":"#5a3e28",fontWeight:600,minWidth:88}}>
          {vsAI ? t("AI対戦 ON","vs AI  ON") : t("AI対戦","vs AI")}
        </button>
        {vsAI&&(<>
          <div style={{display:"flex",alignItems:"center",gap:4,background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:6,padding:"2px 6px"}}>
            <button onClick={()=>setAiLevel(l=>Math.max(1,l-1))} style={{background:"transparent",border:"none",cursor:"pointer",fontSize:17,color:"#7a5838",padding:"0 2px",lineHeight:1}}>◀</button>
            <span style={{minWidth:72,textAlign:"center",fontSize:15,color:"#3a2e22",fontFamily:serif}}>
              {`Lv${aiLevel} ${playerLang==="en"?lv.nameEn:lv.nameJa}`}
            </span>
            <button onClick={()=>setAiLevel(l=>Math.min(10,l+1))} style={{background:"transparent",border:"none",cursor:"pointer",fontSize:17,color:"#7a5838",padding:"0 2px",lineHeight:1}}>▶</button>
          </div>
          <div style={{display:"flex",gap:4}}>
            <button onClick={()=>setAiColor(gameType==="chess"?"b":"w")} style={{...btnBase,background:aiColor===(gameType==="chess"?"b":"w")?"#e8d8b4":"#faf5e8",color:"#3a2e22",fontSize:15}}>
              {gameType==="chess" ? t("白で対戦","Play White") : t("先手で対戦","Play Sente")}
            </button>
            <button onClick={()=>setAiColor(gameType==="chess"?"w":"b")} style={{...btnBase,background:aiColor===(gameType==="chess"?"w":"b")?"#e8d8b4":"#faf5e8",color:"#3a2e22",fontSize:15}}>
              {gameType==="chess" ? t("黒で対戦","Play Black") : t("後手で対戦","Play Gote")}
            </button>
          </div>
          {canAnalyze && onAnalyze && (
            <button onClick={onAnalyze} style={{...btnBase,background:"#faf5e8",color:"#3a2e22",fontSize:15}}>
              {t("解析","Analyze")}
            </button>
          )}
        </>)}
      </div>
      {vsAI&&aiThinking&&(
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"4px 8px",background:"rgba(200,168,106,0.12)",borderRadius:6,color:"#7a5838",fontSize:15,fontFamily:serif}}>
          <span style={{animation:"spin 1s linear infinite",display:"inline-block",fontSize:18}}>⟳</span>
          {t("AI思考中...","AI is thinking...")}
        </div>
      )}
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function ChessFormBoard({ pieces, cellSize }) {
  return (
    <div style={{display:"grid",gridTemplateColumns:`repeat(8,${cellSize}px)`,gridTemplateRows:`repeat(8,${cellSize}px)`,border:"1px solid #c8a86a",borderRadius:2,overflow:"hidden",flexShrink:0}}>
      {Array.from({length:64},(_,i)=>{
        const r=Math.floor(i/8), c=i%8;
        const piece = pieces.find(([pr,pc])=>pr===r&&pc===c);
        const bg = (r+c)%2===0 ? "#f0d9b5" : "#b58863";
        return (
          <div key={i} style={{width:cellSize,height:cellSize,background:bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
            {piece && <img src={`/pieces/${piece[3]}${piece[2]}.webp`} alt="" style={{width:cellSize*0.85,height:cellSize*0.85,objectFit:"contain"}}/>}
          </div>
        );
      })}
    </div>
  );
}
function ShogiFormBoard({ pieces, cellSize, getShogiImg: gsi }) {
  return (
    <div style={{display:"grid",gridTemplateColumns:`repeat(9,${cellSize}px)`,gridTemplateRows:`repeat(9,${cellSize}px)`,border:"1px solid #c8a86a",borderRadius:2,overflow:"hidden",background:"#D4A888",flexShrink:0}}>
      {Array.from({length:81},(_,i)=>{
        const r=Math.floor(i/9), c=i%9;
        const piece = pieces.find(([pr,pc])=>pr===r&&pc===c);
        return (
          <div key={i} style={{width:cellSize,height:cellSize,border:"0.5px solid #c49070",display:"flex",alignItems:"center",justifyContent:"center",boxSizing:"border-box"}}>
            {piece && <img src={gsi({type:piece[2],color:"b",p:piece[3]})} alt="" style={{width:cellSize*0.85,height:cellSize*0.85,objectFit:"contain"}}/>}
          </div>
        );
      })}
    </div>
  );
}
function FormationModal({ modal, setModal, playerLang, getShogiImg: gsi }) {
  if (!modal) return null;
  const { formation, gameType } = modal;
  const cellSize = gameType === "chess" ? 36 : 30;
  return (
    <div onClick={()=>setModal(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#faf5e8",border:"1px solid #c8a86a",borderRadius:12,padding:"16px 20px",maxWidth:"90vw",boxShadow:"0 8px 32px rgba(0,0,0,0.4)",display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
        <div style={{fontWeight:600,fontSize:18,color:"#3a2e22",textAlign:"center"}}>{playerLang==="en"?formation.nameEn:formation.nameJa}</div>
        {gameType==="chess"
          ? <ChessFormBoard pieces={formation.pieces} cellSize={cellSize}/>
          : <ShogiFormBoard pieces={formation.pieces} cellSize={cellSize} getShogiImg={gsi}/>}
        <div style={{fontSize:15,color:"#5a3c18",lineHeight:1.6,textAlign:"center",maxWidth:280}}>{playerLang==="en"?formation.descEn:formation.descJa}</div>
        <button onClick={()=>setModal(null)} style={{width:"100%",background:"transparent",border:"1px solid #c8b090",borderRadius:8,color:"#7a5838",padding:"6px",cursor:"pointer",fontSize:15}}>
          {playerLang==="en"?"Close":"閉じる"}
        </button>
      </div>
    </div>
  );
}

// ── Strategy helpers (module-level, shared by StrategyModal) ─────────
function _stratFenToBoard(fen) {
  const [placement] = fen.split(' ');
  const bd = Array(8).fill(null).map(()=>Array(8).fill(null));
  let row=0, col=0;
  for (const ch of placement) {
    if (ch==='/') { row++; col=0; }
    else if (/\d/.test(ch)) { col+=parseInt(ch); }
    else { bd[row][col]={type:ch.toUpperCase(),color:ch===ch.toUpperCase()?'w':'b'}; col++; }
  }
  return bd;
}
function _stratApplyMove(bd, uci) {
  const fc=uci.charCodeAt(0)-97, fr=8-parseInt(uci[1]);
  const tc=uci.charCodeAt(2)-97, tr=8-parseInt(uci[3]);
  const promo=uci[4];
  const nb=bd.map(r=>[...r]);
  const piece=nb[fr][fc]; if(!piece) return nb;
  if(piece.type==='P'&&fc!==tc&&!nb[tr][tc]) nb[fr][tc]=null; // en passant
  if(piece.type==='K'&&Math.abs(tc-fc)===2) {
    if(tc===6){nb[tr][5]=nb[tr][7];nb[tr][7]=null;} else {nb[tr][3]=nb[tr][0];nb[tr][0]=null;}
  }
  nb[tr][tc]=promo?{type:promo.toUpperCase(),color:piece.color}:piece;
  nb[fr][fc]=null;
  return nb;
}

// ── StrategyModal ─────────────────────────────────────────────────────
function StrategyModal({ theme, playerLang, serif, onClose, onPractice }) {
  const [step, setStep] = useState(0);

  // Responsive board size — same formula as OpeningDetailView
  const [vw, setVw] = useState(typeof window !== "undefined" ? window.innerWidth : 600);
  useEffect(() => {
    const handler = () => setVw(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  // Same formula as Opening modal (Math.min(vw - 40, 520)), but capped to fit inside
  // this modal's inner width (maxWidth:560 – padding:20*2 = 520)
  const cellSize = Math.floor(Math.min(vw - 40, 520) / 8);
  const boardW = cellSize * 8;

  // Pre-compute all board states
  const boards = useMemo(() => {
    if (!theme?.fen) return [];
    const states = [];
    let bd = _stratFenToBoard(theme.fen);
    states.push(bd);
    for (const uci of (theme.moves||[])) {
      bd = _stratApplyMove(bd, uci);
      states.push(bd);
    }
    return states;
  }, [theme]);

  // Reset step when theme changes
  useEffect(() => { setStep(0); }, [theme?.id]);

  if (!theme) return null;
  const board = boards[step];
  const lastMoveUci = step>0 ? theme.moves[step-1] : null;
  const lastFrom = lastMoveUci ? [8-parseInt(lastMoveUci[1]), lastMoveUci.charCodeAt(0)-97] : null;
  const lastTo   = lastMoveUci ? [8-parseInt(lastMoveUci[3]), lastMoveUci.charCodeAt(2)-97] : null;
  const comments = playerLang==="en" ? theme.moveComments.en : theme.moveComments.ja;
  const comment = comments[step] || "";
  const points = playerLang==="en" ? theme.pointsEn : theme.pointsJa;
  const maxStep = (theme.moves||[]).length;
  const lvlColor = {beginner:"#4a9",intermediate:"#c90",advanced:"#d44"}[theme.level]||"#888";
  const lvlLabel = ({beginner:{ja:"初級",en:"Beginner"},intermediate:{ja:"中級",en:"Intermediate"},advanced:{ja:"上級",en:"Advanced"}}[theme.level]||{})[playerLang==="en"?"en":"ja"]||theme.level;
  const catLabel = playerLang==="en" ? theme.categoryEn : theme.category;
  const navBtn = {background:"#fdf6e8",border:"1px solid #c8b090",borderRadius:6,color:"#7a5838",padding:"4px 10px",cursor:"pointer",fontSize:16,fontFamily:serif};
  // Font sizes matching Opening modal
  const bodyFs = playerLang==="en" ? 17 : 16;
  // Practice button: only show for themes with a valid 1-to-1 Lichess tactics theme mapping
  const VALID_TACTIC_IDS = new Set(['fork','pin','sacrifice','skewer','discoveredAttack','doubleCheck','deflection','decoy','endgame']);
  const canPractice = onPractice && theme.tacticTheme && VALID_TACTIC_IDS.has(theme.tacticTheme);
  // Coordinate label style — matches main chess board (color, font, opacity)
  const coordFs = Math.max(9, Math.floor(cellSize * 0.18));
  const coordW = Math.max(12, Math.floor(cellSize * 0.25));
  const coordH = Math.max(10, Math.floor(cellSize * 0.22));
  const coordLbl = {display:"flex",alignItems:"center",justifyContent:"center",color:"#7a5c38",fontSize:coordFs,fontFamily:"Georgia,serif",userSelect:"none",opacity:0.72,fontWeight:400,letterSpacing:"0.04em"};

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",zIndex:9900,display:"flex",alignItems:"flex-start",justifyContent:"center",overflowY:"auto",padding:"10px 0",fontFamily:serif}}
      onClick={onClose}>
      <div style={{background:"#faf5e8",border:"2px solid #c8a86a",borderRadius:16,padding:"20px 20px 16px",maxWidth:560,width:"94vw",boxSizing:"border-box",margin:"auto"}}
        onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
          <div>
            <div style={{fontWeight:700,fontSize:20,color:"#3a2e22",marginBottom:4}}>
              {playerLang==="en"?theme.nameEn:theme.nameJa}
            </div>
            <span style={{background:lvlColor,color:"#fff",borderRadius:8,padding:"1px 8px",fontSize:13,fontWeight:600,marginRight:6}}>{lvlLabel}</span>
            <span style={{background:"rgba(100,80,40,0.1)",color:"#7a5838",borderRadius:8,padding:"1px 8px",fontSize:13,fontWeight:500}}>{catLabel}</span>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#7a5838",lineHeight:1,paddingLeft:8}}>✕</button>
        </div>

        {/* Description */}
        <div style={{fontSize:bodyFs,color:"#5a3c18",lineHeight:1.75,marginBottom:14,whiteSpace:"pre-line"}}>
          {playerLang==="en"?theme.descriptionEn:theme.descriptionJa}
        </div>

        {/* Board with coordinates (only for chess with FEN) */}
        {board && (
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",marginBottom:12}}>
            {/* Board + rank/file labels */}
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-start"}}>
              <div style={{display:"flex"}}>
                {/* Rank labels (8→1, left side) */}
                <div style={{display:"flex",flexDirection:"column",width:coordW,marginRight:2}}>
                  {[8,7,6,5,4,3,2,1].map(n=>(
                    <div key={n} style={{...coordLbl,height:cellSize}}>{n}</div>
                  ))}
                </div>
                {/* Chess board */}
                <div style={{border:"2px solid #8b6040",borderRadius:3,overflow:"hidden"}}>
                  <div style={{display:"grid",gridTemplateColumns:`repeat(8,${cellSize}px)`,gridTemplateRows:`repeat(8,${cellSize}px)`}}>
                    {Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>{
                      const isLight=(r+c)%2===0;
                      const piece=board[r]?.[c];
                      const isHlFrom=lastFrom&&lastFrom[0]===r&&lastFrom[1]===c;
                      const isHlTo=lastTo&&lastTo[0]===r&&lastTo[1]===c;
                      const bg=(isHlFrom||isHlTo)?(isLight?"#f6f669":"#baca2b"):(isLight?"#f0d9b5":"#b58863");
                      return (
                        <div key={`${r}-${c}`} style={{width:cellSize,height:cellSize,background:bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
                          {piece&&<img src={`/pieces/${piece.color}${piece.type}.webp`} alt="" style={{width:"82%",height:"82%",objectFit:"contain"}}/>}
                        </div>
                      );
                    }))}
                  </div>
                </div>
              </div>
              {/* File labels (a→h, bottom) */}
              <div style={{display:"flex",marginLeft:coordW+2}}>
                {["a","b","c","d","e","f","g","h"].map(f=>(
                  <div key={f} style={{...coordLbl,width:cellSize,height:coordH,marginTop:2}}>{f}</div>
                ))}
              </div>
            </div>
            <div style={{marginTop:6,fontSize:bodyFs,color:"#6a4820",textAlign:"center",minHeight:20,padding:"0 4px",lineHeight:1.55}}>{comment}</div>
            <div style={{display:"flex",gap:6,marginTop:8,alignItems:"center"}}>
              <button onClick={()=>setStep(0)} disabled={step===0} style={{...navBtn,opacity:step===0?0.35:1}}>◀◀</button>
              <button onClick={()=>setStep(s=>Math.max(0,s-1))} disabled={step===0} style={{...navBtn,opacity:step===0?0.35:1}}>◀</button>
              <span style={{fontSize:16,color:"#7a5838",minWidth:48,textAlign:"center"}}>{step} / {maxStep}</span>
              <button onClick={()=>setStep(s=>Math.min(maxStep,s+1))} disabled={step>=maxStep} style={{...navBtn,opacity:step>=maxStep?0.35:1}}>▶</button>
              <button onClick={()=>setStep(maxStep)} disabled={step>=maxStep} style={{...navBtn,opacity:step>=maxStep?0.35:1}}>▶▶</button>
            </div>
          </div>
        )}

        {/* Key Points */}
        <div style={{background:"rgba(100,80,40,0.07)",borderRadius:8,padding:"10px 12px",marginBottom:14}}>
          <div style={{fontWeight:700,fontSize:16,color:"#7a5838",marginBottom:8,letterSpacing:0.5}}>
            {playerLang==="en"?"Key Points":"ポイント"}
          </div>
          {points.map((pt,i)=>(
            <div key={i} style={{fontSize:bodyFs,color:"#5a3c18",marginBottom:i<points.length-1?6:0,lineHeight:1.6}}>{pt}</div>
          ))}
        </div>

        {/* Practice button — only for themes with a valid 1-to-1 Lichess tactics theme */}
        {canPractice && (
          <button onClick={()=>onPractice(theme)} style={{display:"block",width:"100%",background:"#c8a86a",color:"#fff",border:"none",borderRadius:10,padding:"11px 0",fontSize:16,fontWeight:700,cursor:"pointer",fontFamily:serif,marginBottom:8}}>
            {playerLang==="en"?"Practice this theme →":"このテーマで練習する →"}
          </button>
        )}
        <button onClick={onClose} style={{display:"block",width:"100%",background:"transparent",border:"1px solid #c8b090",borderRadius:10,padding:"8px 0",fontSize:15,color:"#9a8878",cursor:"pointer",fontFamily:serif}}>
          {playerLang==="en"?"Close":"閉じる"}
        </button>
      </div>
    </div>
  );
}

function ChessPracticeBoard({playerLang, pcLayout, hideRules=false, playerName="", onAnalyze, startInFullScreen=false, onSwitchToGame, onFsConsumed, onOpenOpening, onOpenTactic}) {
  const boardKey = `chessPracticeBoard_${playerName}`;
  const capKey = `chessPracticeCapPieces_${playerName}`;
  const [board, setBoard] = useState(()=>{
    try { const s=localStorage.getItem(boardKey); if(s) return JSON.parse(s); } catch{}
    return mkChessPracticeBoard();
  });
  const [sel, setSel] = useState(null);
  const [legal, setLegal] = useState([]);
  const [capPieces, setCapPieces] = useState(()=>{
    try { const s=localStorage.getItem(capKey); if(s) return JSON.parse(s); } catch{}
    return {b:{},w:{}};
  });
  const [moveHistory, setMoveHistory] = useState([]);
  const [practiceGameHistory, setPracticeGameHistory] = useState([]);
  const [formationModal, setFormationModal] = useState(null);
  const [showAllFormations, setShowAllFormations] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [pieceGuideOpen, setPieceGuideOpen] = useState(false);
  // Strategy modal
  const [strategyOpen, setStrategyOpen] = useState(null); // null | strategy theme object
  const [strategyShowAll, setStrategyShowAll] = useState(false);
  // Endgame modal
  const [endgameOpen, setEndgameOpen] = useState(null);
  const [endgameShowAll, setEndgameShowAll] = useState(false);
  const [practiceRules, setPracticeRules] = useState({castling:true, enPassant:true, promotion:true});
  // Tactics mode
  const [tacticsMode, setTacticsMode] = useState(false);
  const [tacticsDiff, setTacticsDiff] = useState(null); // null='all' | 'Easy'|'Normal'|'Hard'
  const [tacticsTheme, setTacticsTheme] = useState(null); // null='all' | 'mateIn1' etc.
  const [tacticsPuzzles, setTacticsPuzzles] = useState([]);
  const [tacticsIdx, setTacticsIdx] = useState(0);
  const [tacticsResult, setTacticsResult] = useState(null); // null|'correct'|'incorrect'
  const [tacticsHintUsed, setTacticsHintUsed] = useState(false);
  const [tacticsShowAnswer, setTacticsShowAnswer] = useState(false);
  const [tacticsDiffSelect, setTacticsDiffSelect] = useState(false);
  const [tacticsMovesFilter, setTacticsMovesFilter] = useState(null); // null=all | 1 | 2 | 3 | '4+'
  const [tacticsAttempt, setTacticsAttempt] = useState(0);
  const [tacticsStep, setTacticsStep] = useState(0); // current move index in puzzle.moves (0=player, 1=opp, 2=player…)
  const [tacticsLoading, setTacticsLoading] = useState(false);
  const [tacticsError, setTacticsError] = useState(null);
  const [tacticsStatusMsg, setTacticsStatusMsg] = useState(null); // shown during 429 retry wait
  const tacticsRestoredRef = useRef(false); // true during localStorage restore → skip initial fetch
  // AI mode
  const [vsAI, setVsAI] = useState(false);
  const [aiLevel, setAiLevel] = useState(3);
  const [aiColor, setAiColor] = useState("b"); // AI plays black by default
  const [aiThinking, setAiThinking] = useState(false);
  const [chessTurn, setChessTurn] = useState("w");
  const [castlingRights, setCastlingRights] = useState({wK:true,wQR:true,wKR:true,bK:true,bQR:true,bKR:true});
  const [epSquare, setEpSquare] = useState(null);
  const [lastMove, setLastMove] = useState(null); // {from:[r,c], to:[r,c]}
  const [checkAnnouncement, setCheckAnnouncement] = useState(null); // string or null
  const [victoryModal, setVictoryModal] = useState(null); // {winner:'player'|'ai'}
  const engineRef = useRef(null);
  const serif = "'Cormorant Garamond','Zen Old Mincho',Georgia,serif";
  const [fullScreen, setFullScreen] = useState(startInFullScreen||false);
  useEffect(()=>{ if(startInFullScreen && onFsConsumed) onFsConsumed(); },[]);// eslint-disable-line react-hooks/exhaustive-deps
  const [fsAreaW, setFsAreaW] = useState(0);
  const [fsAreaH, setFsAreaH] = useState(0);
  const fsAreaRefCb = useCallback((node) => {
    if (!node) return;
    const ro = new ResizeObserver(([entry]) => {
      setFsAreaW(Math.floor(entry.contentRect.width));
      setFsAreaH(Math.floor(entry.contentRect.height));
    });
    ro.observe(node);
  }, []);
  const cellSizeNormal = pcLayout
    ? Math.min(64, Math.floor((Math.min(window.innerWidth - 460, 536) - 28) / 8))
    : Math.floor((Math.min(window.innerWidth*0.98, 560)-51)/8);
  // FS時: 盤面(8cs+33px) + 取り駒行(最大2行分: 1.6cs+16)×2 = 11.2cs+65 → 余裕を見て70
  const cellSize = (fullScreen && fsAreaW > 0 && fsAreaH > 0)
    ? Math.max(20, Math.floor(Math.min((fsAreaW - 44) / 8, (fsAreaH - 70) / 11.2)))
    : cellSizeNormal;
  useEffect(()=>{ try{localStorage.setItem(boardKey,JSON.stringify(board));}catch{} },[board,boardKey]);
  useEffect(()=>{ try{localStorage.setItem(capKey,JSON.stringify(capPieces));}catch{} },[capPieces,capKey]);
  // Cleanup engine on unmount
  useEffect(()=>()=>{ engineRef.current?.destroy(); engineRef.current=null; },[]);

  // Lazy-init Stockfish and return the engine
  const getEngine = useCallback(async ()=>{
    if (engineRef.current?.ready) return engineRef.current;
    if (!engineRef.current) {
      const eng = new ChessEngine();
      engineRef.current = eng;
    }
    if (!engineRef.current.ready) await engineRef.current.init();
    return engineRef.current;
  },[]);

  // Check if a king of the given color is in check on the board
  const isChessKingInCheck = useCallback((bd, color) => {
    let kr=-1, kc=-1;
    for(let r=0;r<8;r++) for(let c=0;c<8;c++) if(bd[r]?.[c]?.type==='K'&&bd[r][c].color===color){kr=r;kc=c;}
    if(kr<0) return false;
    const opp=color==='w'?'b':'w';
    const inB=(r,c)=>r>=0&&r<8&&c>=0&&c<8;
    // Check by pawns
    const pDir=color==='w'?-1:1;
    if(inB(kr+pDir,kc-1)&&bd[kr+pDir]?.[kc-1]?.type==='P'&&bd[kr+pDir][kc-1].color===opp) return true;
    if(inB(kr+pDir,kc+1)&&bd[kr+pDir]?.[kc+1]?.type==='P'&&bd[kr+pDir][kc+1].color===opp) return true;
    // Check by knights
    for(const[dr,dc] of [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]]){
      if(inB(kr+dr,kc+dc)&&bd[kr+dr]?.[kc+dc]?.type==='N'&&bd[kr+dr][kc+dc].color===opp) return true;
    }
    // Check by sliders
    for(const[dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]]){
      let nr=kr+dr,nc=kc+dc;
      while(inB(nr,nc)){const p=bd[nr]?.[nc];if(p){if(p.color===opp&&(p.type==='R'||p.type==='Q'))return true;break;}nr+=dr;nc+=dc;}
    }
    for(const[dr,dc] of [[1,1],[1,-1],[-1,1],[-1,-1]]){
      let nr=kr+dr,nc=kc+dc;
      while(inB(nr,nc)){const p=bd[nr]?.[nc];if(p){if(p.color===opp&&(p.type==='B'||p.type==='Q'))return true;break;}nr+=dr;nc+=dc;}
    }
    // Check by king (shouldn't happen in practice but for completeness)
    for(const[dr,dc] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
      if(inB(kr+dr,kc+dc)&&bd[kr+dr]?.[kc+dc]?.type==='K'&&bd[kr+dr][kc+dc].color===opp) return true;
    }
    return false;
  },[]);

  // Get piece giving check (for queen check announcement)
  const getChessCheckGiver = useCallback((bd, color) => {
    let kr=-1, kc=-1;
    for(let r=0;r<8;r++) for(let c=0;c<8;c++) if(bd[r]?.[c]?.type==='K'&&bd[r][c].color===color){kr=r;kc=c;}
    if(kr<0) return null;
    const opp=color==='w'?'b':'w';
    const inB=(r,c)=>r>=0&&r<8&&c>=0&&c<8;
    for(const[dr,dc] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
      let nr=kr+dr,nc=kc+dc;
      while(inB(nr,nc)){const p=bd[nr]?.[nc];if(p){if(p.color===opp&&(p.type==='Q'||p.type==='R'||p.type==='B'))return p;break;}nr+=dr;nc+=dc;}
    }
    return null;
  },[]);

  // Apply an AI move (UCI string) to the board
  const applyChessAIMove = useCallback((uci, bd, ca, ep, cp, tn)=>{
    const coords = uciToCoords(uci); if(!coords) return;
    const {fr,fc,tr,tc,promo}=coords;
    const nb=bd.map(r=>[...r]);
    const mp=nb[fr][fc]; if(!mp) return;
    const newCap={b:{...cp.b},w:{...cp.w}};
    if(nb[tr][tc]){ const ct=nb[tr][tc].type; newCap[mp.color][ct]=(newCap[mp.color][ct]||0)+1; }
    // En passant capture
    if(mp.type==='P'&&fc!==tc&&!nb[tr][tc]){
      const epR=mp.color==='w'?tr+1:tr-1; newCap[mp.color].P=(newCap[mp.color].P||0)+1; nb[epR][tc]=null;
    }
    nb[tr][tc]=promo?{...mp,type:promo}:mp; nb[fr][fc]=null;
    // Castling – also move rook
    if(mp.type==='K'&&Math.abs(tc-fc)===2){
      if(tc===6){nb[fr][5]=nb[fr][7];nb[fr][7]=null;}
      else{nb[fr][3]=nb[fr][0];nb[fr][0]=null;}
    }
    const newCa={
      wK:ca.wK&&!(fr===7&&fc===4), wQR:ca.wQR&&!(fr===7&&fc===0)&&!(tr===7&&tc===0),
      wKR:ca.wKR&&!(fr===7&&fc===7)&&!(tr===7&&tc===7), bK:ca.bK&&!(fr===0&&fc===4),
      bQR:ca.bQR&&!(fr===0&&fc===0)&&!(tr===0&&tc===0), bKR:ca.bKR&&!(fr===0&&fc===7)&&!(tr===0&&tc===7),
    };
    const newEp=(mp.type==='P'&&Math.abs(tr-fr)===2)?[(fr+tr)/2,tc]:null;
    const newTurn=tn==='w'?'b':'w';
    setLastMove({from:[fr,fc],to:[tr,tc]});
    setMoveHistory(prev=>[...prev,{board:bd.map(r=>[...r]),capPieces:{b:{...cp.b},w:{...cp.w}}}]);
    setPracticeGameHistory(prev=>[...prev,{from:[fr,fc],to:[tr,tc],...(promo?{notation:`=${promo.toUpperCase()}`}:{})}]);
    setBoard(nb); setCapPieces(newCap); setCastlingRights(newCa); setEpSquare(newEp); setChessTurn(newTurn);
    // Check/checkmate announcement after AI move
    const playerColor=newTurn; // after AI moves, it's now the player's turn
    if(isChessKingInCheck(nb, playerColor)){
      // Check if any legal moves exist (simplified: just announce check/checkmate)
      const giver=getChessCheckGiver(nb, playerColor);
      let msg;
      if(giver?.type==='Q') msg="クイーンチェック / Queen Check!";
      else msg="チェック！/ Check!";
      setCheckAnnouncement(msg);
      setTimeout(()=>setCheckAnnouncement(null),2500);
    }
  },[isChessKingInCheck,getChessCheckGiver]);

  // Use refs to always have latest vsAI and aiLevel values in async callbacks
  const vsAIRef = useRef(vsAI);
  const aiLevelRef = useRef(aiLevel);
  useEffect(()=>{ vsAIRef.current=vsAI; },[vsAI]);
  useEffect(()=>{ aiLevelRef.current=aiLevel; },[aiLevel]);

  // Use refs to track practiceRules for AI callbacks
  const practiceRulesRef = useRef(practiceRules);
  useEffect(()=>{ practiceRulesRef.current=practiceRules; },[practiceRules]);

  // Trigger chess AI move (forceRun=true bypasses vsAI guard for first-move trigger)
  const triggerChessAI = useCallback(async (bd,tn,ca,ep,cp,forceRun=false)=>{
    if(!forceRun && !vsAIRef.current) return;
    setAiThinking(true);
    try {
      const eng = await getEngine();
      const rules = practiceRulesRef.current;
      const effectiveCa = rules.castling ? ca : null;
      const effectiveEp = rules.enPassant ? ep : null;
      const fen = boardToFen(bd,tn,effectiveCa,effectiveEp);
      const uci = await eng.getBestMove(fen,aiLevelRef.current);
      if(uci) applyChessAIMove(uci,bd,ca,ep,cp,tn);
    } catch(e){ console.error('Chess AI:',e); }
    setAiThinking(false);
  },[getEngine,applyChessAIMove]);

  // Toggle vsAI – reset to initial position, then trigger AI if it moves first
  const handleToggleVsAI = useCallback(()=>{
    const next=!vsAI;
    setVsAI(next);
    if(next){
      const initBoard=mkChessPracticeBoard();
      const initCap={b:{},w:{}};
      const initCa={wK:true,wQR:true,wKR:true,bK:true,bQR:true,bKR:true};
      setBoard(initBoard); setCapPieces(initCap); setChessTurn("w");
      setCastlingRights(initCa); setEpSquare(null);
      setMoveHistory([]); setPracticeGameHistory([]);
      setSel(null); setLegal([]);
      try { localStorage.setItem(boardKey,JSON.stringify(initBoard)); localStorage.setItem(capKey,JSON.stringify(initCap)); } catch {}
      if(aiColor==="w"){
        getEngine().then(()=>triggerChessAI(initBoard,"w",initCa,null,initCap,true)).catch(console.error);
      }
    }
  },[vsAI,aiColor,boardKey,capKey,getEngine,triggerChessAI]);

  // Set AI color and trigger AI if it now matches the current turn (while vsAI is ON)
  const handleChessSetAiColor = useCallback((color)=>{
    setAiColor(color);
    if(vsAI && chessTurn===color){
      getEngine().then(()=>triggerChessAI(board,chessTurn,castlingRights,epSquare,capPieces,true)).catch(console.error);
    }
  },[vsAI,chessTurn,board,castlingRights,epSquare,capPieces,getEngine,triggerChessAI]);

  const handleAnalyzeGame = useCallback(()=>{
    if(!onAnalyze||!practiceGameHistory.length) return;
    const players=aiColor==="b"?{white:playerName,black:"AI"}:{white:"AI",black:playerName};
    onAnalyze({id:`practice_chess_${Date.now()}`,history:practiceGameHistory,players,aiLevel,status:"practice"},"chess");
  },[onAnalyze,aiColor,playerName,practiceGameHistory,aiLevel]);

  const getPieceImg = (piece) => {
    if (!piece) return null;
    const map = {K:"wK",Q:"wQ",R:"wR",B:"wB",N:"wN",P:"wP"};
    const bmap = {K:"bK",Q:"bQ",R:"bR",B:"bB",N:"bN",P:"bP"};
    return `/pieces/${piece.color==="w"?map[piece.type]:bmap[piece.type]}.webp`;
  };

  const calcLegal = (bd, r, c) => {
    const piece = bd[r]?.[c];
    if (!piece) return [];
    const moves = [];
    const inBounds = (r,c) => r>=0&&r<8&&c>=0&&c<8;
    const isEmpty = (r,c) => inBounds(r,c) && !bd[r][c];
    const isEnemy = (r,c,col) => inBounds(r,c) && bd[r][c] && bd[r][c].color !== col;
    const canGo = (r,c,col) => isEmpty(r,c) || isEnemy(r,c,col);
    const slide = (dr,dc) => {
      let nr=r+dr, nc=c+dc;
      while(inBounds(nr,nc)){
        if(bd[nr][nc]){if(bd[nr][nc].color!==piece.color)moves.push([nr,nc]);break;}
        moves.push([nr,nc]);
        nr+=dr;nc+=dc;
      }
    };
    const {type,color} = piece;
    const dir = color==="w"?-1:1;
    if(type==="P"){
      if(isEmpty(r+dir,c))moves.push([r+dir,c]);
      if((color==="w"&&r===6)||(color==="b"&&r===1))if(isEmpty(r+dir,c)&&isEmpty(r+2*dir,c))moves.push([r+2*dir,c]);
      if(isEnemy(r+dir,c-1,color))moves.push([r+dir,c-1]);
      if(isEnemy(r+dir,c+1,color))moves.push([r+dir,c+1]);
      // アンパッサン
      if(practiceRules.enPassant && epSquare){
        const [er,ec]=epSquare;
        if(r+dir===er&&Math.abs(c-ec)===1)moves.push([er,ec]);
      }
    } else if(type==="N"){
      [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]].forEach(([dr,dc])=>{if(canGo(r+dr,c+dc,color))moves.push([r+dr,c+dc]);});
    } else if(type==="B"){
      [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dr,dc])=>slide(dr,dc));
    } else if(type==="R"){
      [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dr,dc])=>slide(dr,dc));
    } else if(type==="Q"){
      [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dr,dc])=>slide(dr,dc));
    } else if(type==="K"){
      [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dr,dc])=>{if(canGo(r+dr,c+dc,color))moves.push([r+dr,c+dc]);});
      // キャスリング
      if(practiceRules.castling){
        if(color==="w"&&r===7&&c===4){
          if(castlingRights.wKR&&!bd[7][5]&&!bd[7][6])moves.push([7,6]);
          if(castlingRights.wQR&&!bd[7][3]&&!bd[7][2]&&!bd[7][1])moves.push([7,2]);
        }
        if(color==="b"&&r===0&&c===4){
          if(castlingRights.bKR&&!bd[0][5]&&!bd[0][6])moves.push([0,6]);
          if(castlingRights.bQR&&!bd[0][3]&&!bd[0][2]&&!bd[0][1])moves.push([0,2]);
        }
      }
    }
    return moves;
  };

  const handleClick = (r, c) => {
    if (aiThinking) return;
    // Tactics mode: check if move matches solution (UCI format e.g. "h5f7" or "a2a1q")
    if (tacticsMode) {
      if (tacticsResult) return; // already resolved
      const tacPuzzle = tacticsPuzzles[tacticsIdx];
      if (!tacPuzzle) return;
      const movesArr = normalizeMoves(tacPuzzle.moves);
      const solUci = movesArr[tacticsStep]; // current player's move at this step
      // UCI → row/col: file a-h → col 0-7; rank 1-8 → row 7-0
      const uciFromRow = solUci ? 8 - parseInt(solUci[1]) : -1;
      const uciFromCol = solUci ? solUci.charCodeAt(0) - 97 : -1;
      const uciToRow   = solUci ? 8 - parseInt(solUci[3]) : -1;
      const uciToCol   = solUci ? solUci.charCodeAt(2) - 97 : -1;
      const uciPromo   = solUci?.[4]; // promotion piece if any (e.g. 'q')
      if (sel) {
        const isLegal = legal.some(([lr,lc])=>lr===r&&lc===c);
        if (isLegal) {
          const isCorrect = solUci && uciFromRow===sel.r && uciFromCol===sel.c && uciToRow===r && uciToCol===c;
          const newAttempt = tacticsAttempt + 1;
          setTacticsAttempt(newAttempt);
          if (isCorrect) {
            // Apply move visually
            const nb = board.map(row=>[...row]);
            nb[r][c] = board[sel.r][sel.c];
            nb[sel.r][sel.c] = null;
            if (uciPromo) nb[r][c] = { type: uciPromo.toUpperCase(), color: nb[r][c].color };
            setBoard(nb);
            setLastMove({from:[sel.r,sel.c],to:[r,c]});
            setChessTurn(prev => prev === 'w' ? 'b' : 'w');
            setSel(null); setLegal([]);
            const nextStep = tacticsStep + 1;
            if (nextStep >= movesArr.length) {
              // All moves complete – puzzle solved!
              setTacticsResult('correct');
              saveTacticsFb(tacPuzzle, 'correct', tacticsHintUsed, newAttempt);
            } else {
              // Opponent's response will be auto-applied by useEffect
              setTacticsStep(nextStep);
            }
          } else {
            setSel(null); setLegal([]);
            setTacticsResult('incorrect');
          }
          return;
        }
        setSel(null); setLegal([]);
      }
      const piece = board[r]?.[c];
      if (piece && piece.color === chessTurn) {
        setSel({r,c});
        setLegal(calcLegal(board,r,c));
      } else { setSel(null); setLegal([]); }
      return;
    }
    const playerColor = vsAI ? (aiColor==="b"?"w":"b") : null;
    // In AI mode, block moves when it's the AI's turn
    if (vsAI && chessTurn === aiColor) { setSel(null); setLegal([]); return; }
    if (sel) {
      const isLegal = legal.some(([lr,lc])=>lr===r&&lc===c);
      if (isLegal) {
        // 1手前の状態を保存（undo用）
        setMoveHistory(prev => [...prev, {board: board.map(row=>[...row]), capPieces: {b:{...capPieces.b},w:{...capPieces.w}}}]);
        const nb = board.map(row=>[...row]);
        let movedPiece = board[sel.r][sel.c];
        const newCap = {b:{...capPieces.b},w:{...capPieces.w}};
        if (board[r][c]) {
          const captured = board[r][c];
          newCap[movedPiece.color][captured.type]=(newCap[movedPiece.color][captured.type]||0)+1;
        }
        // アンパッサン捕獲：ポーンが斜めに空きマスへ移動した場合
        const isEP = movedPiece.type==="P" && c!==sel.c && !board[r][c];
        if(isEP){
          newCap[movedPiece.color]["P"]=(newCap[movedPiece.color]["P"]||0)+1;
          nb[sel.r][c]=null; // 取られたポーンを除去
        }
        // キャスリング：キングが2マス移動したらルークも動かす
        const isCastle = movedPiece.type==="K" && Math.abs(c-sel.c)===2;
        if(isCastle){
          if(c===6){ nb[r][5]=nb[r][7]; nb[r][7]=null; } // キングサイド
          if(c===2){ nb[r][3]=nb[r][0]; nb[r][0]=null; } // クイーンサイド
        }
        // ポーンが最終段に到達したら自動でクイーンに昇格（ルール ON の場合）
        const isPromoRank = movedPiece.type==="P"&&((movedPiece.color==="w"&&r===0)||(movedPiece.color==="b"&&r===7));
        if (isPromoRank && practiceRules.promotion) {
          movedPiece = {...movedPiece, type:"Q"};
        }
        nb[r][c] = movedPiece;
        nb[sel.r][sel.c] = null;
        // Update castling rights & ep square for AI FEN
        const newCa={
          wK:castlingRights.wK&&!(sel.r===7&&sel.c===4),
          wQR:castlingRights.wQR&&!(sel.r===7&&sel.c===0)&&!(r===7&&c===0),
          wKR:castlingRights.wKR&&!(sel.r===7&&sel.c===7)&&!(r===7&&c===7),
          bK:castlingRights.bK&&!(sel.r===0&&sel.c===4),
          bQR:castlingRights.bQR&&!(sel.r===0&&sel.c===0)&&!(r===0&&c===0),
          bKR:castlingRights.bKR&&!(sel.r===0&&sel.c===7)&&!(r===0&&c===7),
        };
        const newEp=(board[sel.r][sel.c]?.type==="P"&&Math.abs(r-sel.r)===2)?[(sel.r+r)/2,c]:null;
        const newTurn=chessTurn==="w"?"b":"w";
        const isPromo=isPromoRank&&practiceRules.promotion;
        setPracticeGameHistory(prev=>[...prev,{from:[sel.r,sel.c],to:[r,c],...(isPromo?{notation:"=Q"}:{})}]);
        setLastMove({from:[sel.r,sel.c],to:[r,c]});
        setBoard(nb); setCapPieces(newCap); setCastlingRights(newCa); setEpSquare(newEp); setChessTurn(newTurn);
        setSel(null); setLegal([]);
        if (vsAI && newTurn===aiColor) triggerChessAI(nb,newTurn,newCa,newEp,newCap);
        return;
      }
    }
    const piece = board[r]?.[c];
    if (piece && (!vsAI || piece.color===playerColor)) {
      setSel({r,c});
      setLegal(calcLegal(board,r,c));
    } else {
      setSel(null);
      setLegal([]);
    }
  };

  const handleChessUndo = () => {
    if (moveHistory.length === 0) return;
    const last = moveHistory[moveHistory.length - 1];
    setBoard(last.board);
    setCapPieces(last.capPieces);
    setSel(null);
    setLegal([]);
    setMoveHistory(prev => prev.slice(0, -1));
    setPracticeGameHistory(prev => prev.slice(0, -1));
  };

  // 駒一覧（モジュールレベルの CHESS_PIECE_LIST / CHESS_VS_SHOGI_JA / CHESS_VS_SHOGI_EN を参照）
  const chessFormationsEl = (
    <div style={{width:"100%",maxWidth:520,fontFamily:serif,background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"10px 14px",boxSizing:"border-box"}}>
      <div style={{fontWeight:600,fontSize:17,color:"#3a2e22",marginBottom:8}}>
        {playerLang==="en"?"Effective Formations":"効果的な陣形"}
      </div>
      {(showAllFormations?CHESS_FORMATIONS:CHESS_FORMATIONS.slice(0,4)).map(f=>(
        <div key={f.id} onClick={()=>setFormationModal({formation:f,gameType:"chess"})}
          style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,cursor:"pointer",padding:"4px 6px",borderRadius:6,background:"rgba(200,168,106,0.08)"}}>
          <ChessFormBoard pieces={f.pieces} cellSize={8}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontWeight:600,fontSize:15,color:"#3a2e22"}}>{playerLang==="en"?f.nameEn:f.nameJa}</div>
            <div style={{fontSize:16,color:"#7a5828",lineHeight:1.4}}>{playerLang==="en"?f.descEn:f.descJa}</div>
          </div>
        </div>
      ))}
      {CHESS_FORMATIONS.length>4&&(
        <button onClick={()=>setShowAllFormations(v=>!v)} style={{width:"100%",background:"transparent",border:"1px solid #c8b090",borderRadius:6,color:"#7a5838",padding:"4px",cursor:"pointer",fontSize:15,marginTop:2}}>
          {showAllFormations?(playerLang==="en"?"Show Less":"閉じる"):(playerLang==="en"?"Show More":"もっと見る")}
        </button>
      )}
    </div>
  );
  const pieceOverviewEl = (
    <div style={{width:"100%",maxWidth:520,fontFamily:serif,marginTop:12}}>
      <div onClick={()=>setPieceGuideOpen(v=>!v)} style={{fontSize:16,letterSpacing:"2px",color:"#a89070",textTransform:"uppercase",textAlign:"center",marginBottom:pieceGuideOpen?10:0,cursor:"pointer",userSelect:"none",display:"flex",justifyContent:"center",gap:8,alignItems:"center"}}>
        {playerLang==="en"?"Piece Guide":"駒ガイド"}
        <span style={{fontSize:14}}>{pieceGuideOpen?"▲":"▼"}</span>
      </div>
      {pieceGuideOpen && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:14}}>
          {CHESS_PIECE_LIST.map(p=>(
            <div key={p.type} style={{background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 6px",display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
              <img src={p.img} alt={p.type} style={{width:36,height:36,objectFit:"contain"}}/>
              <div style={{fontWeight:600,fontSize:17,color:"#3a2e22",textAlign:"center",lineHeight:1.2}}>{playerLang==="en"?p.nameEn:p.nameJa}</div>
              <div style={{fontSize:16,color:"#c4a058",fontWeight:600,textAlign:"center"}}>{p.pts}{playerLang==="en"?" pt":" 点"}</div>
              <div style={{fontSize:16,color:"#7a5828",lineHeight:1.4,textAlign:"center"}}>{playerLang==="en"?p.descEn:p.descJa}</div>
            </div>
          ))}
        </div>
      )}
      {pieceGuideOpen && (
        <div style={{background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 14px",marginTop:8}}>
          <div onClick={()=>setDiffOpen(v=>!v)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",userSelect:"none"}}>
            <div style={{fontWeight:600,fontSize:17,color:"#3a2e22"}}>{playerLang==="en"?"Differences from Shogi":"将棋との違い"}</div>
            <span style={{color:"#a89070",fontSize:16}}>{diffOpen?"▲":"▼"}</span>
          </div>
          {diffOpen && (playerLang==="en"?CHESS_VS_SHOGI_EN:CHESS_VS_SHOGI_JA).map((t,i)=>(
            <div key={i} style={{display:"flex",gap:6,marginBottom:5,fontSize:16,color:"#5a3c18",lineHeight:1.5,alignItems:"flex-start",marginTop:i===0?8:0}}>
              <span style={{flexShrink:0,color:"#c4a058",fontWeight:"bold"}}>•</span>
              <span>{t}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
  const resetChess = useCallback(() => {
    const b = mkChessPracticeBoard();
    setBoard(b);
    setCapPieces({b:{},w:{}});
    setSel(null);
    setLegal([]);
    setMoveHistory([]);
    setPracticeGameHistory([]);
    setChessTurn("w");
    setCastlingRights({wK:true,wQR:true,wKR:true,bK:true,bQR:true,bKR:true});
    setEpSquare(null);
    setVsAI(false);
    try {
      localStorage.setItem(boardKey,JSON.stringify(b));
      localStorage.setItem(capKey,JSON.stringify({b:{},w:{}}));
    } catch {}
  }, []);

  // ── Tactics helpers ────────────────────────────────────────────────
  // Normalize puzzle.moves to an array of UCI strings (Lichess returns solution as array,
  // but defensively handle space-separated string format too)
  const normalizeMoves = (moves) =>
    Array.isArray(moves) ? moves
    : typeof moves === 'string' ? moves.trim().split(/\s+/).filter(Boolean)
    : [];

  // Apply a UCI move (e.g. "e2e4" or "a7a8q") to a board snapshot and return new board
  const applyUciMoveToBoard = (bd, uci) => {
    const fc = uci.charCodeAt(0) - 97;
    const fr = 8 - parseInt(uci[1]);
    const tc = uci.charCodeAt(2) - 97;
    const tr = 8 - parseInt(uci[3]);
    const promo = uci[4]; // promotion piece letter or undefined
    const nb = bd.map(row => [...row]);
    const piece = nb[fr][fc];
    if (!piece) return nb;
    // En passant: pawn captures diagonally to empty square
    if (piece.type === 'P' && fc !== tc && !nb[tr][tc]) nb[fr][tc] = null;
    // Castling: king moves 2 squares → move rook
    if (piece.type === 'K' && Math.abs(tc - fc) === 2) {
      if (tc === 6) { nb[tr][5] = nb[tr][7]; nb[tr][7] = null; }
      if (tc === 2) { nb[tr][3] = nb[tr][0]; nb[tr][0] = null; }
    }
    nb[tr][tc] = promo ? { type: promo.toUpperCase(), color: piece.color } : piece;
    nb[fr][fc] = null;
    return nb;
  };

  // Parse FEN string into board array [{type,color}|null][8][8]
  const fenToBoard = (fen) => {
    const [placement, , , ] = fen.split(' ');
    const bd = Array(8).fill(null).map(()=>Array(8).fill(null));
    let row = 0, col = 0;
    for (const ch of placement) {
      if (ch === '/') { row++; col = 0; }
      else if (/\d/.test(ch)) { col += parseInt(ch); }
      else {
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        bd[row][col] = { type: ch.toUpperCase(), color };
        col++;
      }
    }
    return bd;
  };

  const loadTacticsPuzzle = useCallback((puzzle) => {
    if (!puzzle) return;
    // Parse FEN for board state
    const parts = puzzle.fen.split(' ');
    const [, turn, castling, ep] = parts;
    const bd = (() => {
      const [placement] = parts;
      const b = Array(8).fill(null).map(()=>Array(8).fill(null));
      let row = 0, col = 0;
      for (const ch of placement) {
        if (ch === '/') { row++; col = 0; }
        else if (/\d/.test(ch)) { col += parseInt(ch); }
        else { b[row][col] = { type: ch.toUpperCase(), color: ch === ch.toUpperCase() ? 'w' : 'b' }; col++; }
      }
      return b;
    })();
    setBoard(bd);
    setCapPieces({b:{},w:{}});
    setSel(null); setLegal([]);
    setMoveHistory([]);
    setPracticeGameHistory([]);
    setChessTurn(turn || puzzle.turn || 'w');
    setCastlingRights({
      wK: castling?.includes('K')??false, wQR: castling?.includes('Q')??false, wKR: castling?.includes('K')??false,
      bK: castling?.includes('k')??false, bQR: castling?.includes('q')??false, bKR: castling?.includes('k')??false,
    });
    if (ep && ep !== '-') {
      setEpSquare({ r: 8 - parseInt(ep[1]), c: ep.charCodeAt(0) - 97 });
    } else { setEpSquare(null); }
    setLastMove(null);
    setTacticsResult(null);
    setTacticsHintUsed(false);
    setTacticsShowAnswer(false);
    setTacticsAttempt(0);
    setTacticsStep(0);
  }, []);

  // ── Lichess puzzle fetcher ────────────────────────────────────────
  const LICHESS_DIFF = { Easy: 'easiest', Normal: 'normal', Hard: 'hardest' };
  const SEEN_KEY = 'chess_tactics_seen';
  const PUZZLE_CACHE_KEY = 'chess_tactics_cache'; // last 5 puzzles for offline fallback

  // movesFilter: null=all | 1 | 2 | 3 | '4+'
  // Server-side: if no theme set, use mateIn* to narrow results at API level
  // Client-side: if theme set, fetch then filter by solution length (retry up to 12 times)
  const fetchTacticsPuzzle = useCallback(async (diff, theme, movesFilter, { onStatus } = {}) => {
    const lichessDiff = LICHESS_DIFF[diff];
    const base = 'https://lichess.org/api/puzzle/next';
    const params = new URLSearchParams();
    if (lichessDiff) params.set('difficulty', lichessDiff);

    // Combine theme + movesFilter into comma-separated themes param
    // e.g. theme='skewer' + movesFilter=2 → ?themes=skewer,mateIn2
    const MATE_THEMES = { 1: 'mateIn1', 2: 'mateIn2', 3: 'mateIn3', '4+': 'mateIn4' };
    const mateTheme = movesFilter !== null ? (MATE_THEMES[movesFilter] || null) : null;
    const themeParts = [theme, mateTheme].filter(Boolean);
    if (themeParts.length > 0) params.set('themes', themeParts.join(','));

    // Client-side length check function
    const movesOk = (len) => {
      if (movesFilter === null) return true;
      if (movesFilter === 1) return len === 1;
      if (movesFilter === 2) return len === 3;
      if (movesFilter === 3) return len === 5;
      if (movesFilter === '4+') return len >= 7;
      return true;
    };

    const url = params.toString() ? `${base}?${params}` : base;
    const seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));
    let rate429 = 0;
    // More retries when client-side filtering is needed (theme + movesFilter combo)
    const maxAttempts = (theme && movesFilter !== null) ? 15 : 8;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let resp;
      try {
        resp = await fetch(url, { headers: { Accept: 'application/json' } });
      } catch (e) {
        // Network error – fall through to cache
        break;
      }

      // Rate-limit handling: wait 3 s and retry (max 3 times)
      if (resp.status === 429) {
        rate429++;
        if (rate429 >= 3) break;
        if (onStatus) onStatus(playerLang === 'en' ? 'Rate limited – retrying in 3 s…' : '少し待ってから再読み込みします...');
        await new Promise(r => setTimeout(r, 3000));
        if (onStatus) onStatus(null);
        continue;
      }

      if (!resp.ok) break; // other HTTP error – fall through to cache

      const data = await resp.json();
      const p = data.puzzle;
      if (!p) break;

      if (seen.has(p.id)) {
        // After 5 consecutive seen hits, auto-reset the list so we never get stuck
        if (attempt >= 4) {
          seen.clear();
          localStorage.removeItem(SEEN_KEY);
        }
        await new Promise(r => setTimeout(r, 200));
        continue;
      }

      // FEN: use puzzle.fen if available, otherwise reconstruct from PGN
      let fen = p.fen;
      if (!fen && data.game?.pgn && p.initialPly != null) {
        const chess = new Chess();
        const tokens = data.game.pgn.trim().split(/\s+/).filter(t => !/^\d+\./.test(t));
        for (let i = 0; i <= p.initialPly && i < tokens.length; i++) {
          try { chess.move(tokens[i], { strict: false }); } catch { break; }
        }
        fen = chess.fen();
      }
      if (!fen) break; // bad data – fall through to cache

      const turn = fen.split(' ')[1]; // 'w' or 'b'
      const firstMove = p.solution?.[0] || '';
      const hint = firstMove.length >= 4
        ? [8 - parseInt(firstMove[3]), firstMove.charCodeAt(2) - 97] : null;

      // Record as seen (keep last 200)
      seen.add(p.id);
      localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200)));

      // Defensive: normalize solution to array (Lichess returns array, but guard against string)
      const movesArr = Array.isArray(p.solution) ? p.solution
        : typeof p.solution === 'string' ? p.solution.trim().split(/\s+/).filter(Boolean)
        : [];
      console.log('[Tactics] puzzle id:', p.id, '| moves:', movesArr, '| count:', movesArr.length);

      // Client-side moves-count filter: skip and retry if length doesn't match
      if (!movesOk(movesArr.length)) {
        seen.add(p.id); // mark as seen to avoid re-fetching same puzzle
        localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200)));
        await new Promise(r => setTimeout(r, 150));
        continue;
      }

      const puzzle = {
        id: `lichess_${p.id}`,
        difficulty: diff || 'Normal',
        titleJa: diff === 'Easy' ? '初級タクティクス' : diff === 'Hard' ? '上級タクティクス' : 'タクティクス',
        titleEn: diff === 'Easy' ? 'Easy Tactics' : diff === 'Hard' ? 'Advanced Tactics' : 'Tactics',
        descJa: turn === 'w' ? '白番です。最善手を見つけてください。' : '黒番です。最善手を見つけてください。',
        descEn: turn === 'w' ? 'White to move. Find the best move.' : 'Black to move. Find the best move.',
        turn, fen, moves: movesArr, rating: p.rating, themes: p.themes || [], hint,
      };

      // Save to puzzle cache (keep last 5 for offline fallback)
      try {
        const cache = JSON.parse(localStorage.getItem(PUZZLE_CACHE_KEY) || '[]');
        cache.push(puzzle);
        localStorage.setItem(PUZZLE_CACHE_KEY, JSON.stringify(cache.slice(-5)));
      } catch (e) { /* storage full – ignore */ }

      return puzzle;
    }

    // API completely failed – try cache fallback
    try {
      const cache = JSON.parse(localStorage.getItem(PUZZLE_CACHE_KEY) || '[]');
      if (cache.length > 0) {
        const fallback = cache[Math.floor(Math.random() * cache.length)];
        return { ...fallback, fromCache: true };
      }
    } catch (e) { /* ignore */ }

    const errMsg = rate429 >= 3
      ? (playerLang === 'en' ? 'Rate limit reached. Please wait a moment and retry.' : 'APIのレート制限に達しました。しばらく待ってから再試行してください。')
      : (playerLang === 'en' ? 'Failed to load puzzle. Please retry.' : '新しい問題を取得できませんでした。再試行してください。');
    throw new Error(errMsg);
  }, [playerLang]); // eslint-disable-line

  // Restore chess tactics session from localStorage on mount
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('chess_tactics_session'));
      const puzzle = saved?.puzzle ?? (saved?.puzzles?.[saved?.idx ?? 0]); // support old format
      if (puzzle) {
        tacticsRestoredRef.current = true;
        setTacticsDiff(saved.diff ?? null);
        // migrate: mateIn* were moved from theme to movesFilter — clear old theme values
        const savedTheme = saved.theme ?? null;
        setTacticsTheme(/^mateIn/.test(savedTheme) ? null : savedTheme);
        setTacticsMovesFilter(saved.movesFilter ?? null);
        setTacticsPuzzles([puzzle]);
        setTacticsIdx(0);
        setTacticsMode(true);
      }
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Save chess tactics session to localStorage (only current puzzle to avoid unbounded growth)
  useEffect(() => {
    if (!tacticsMode || !tacticsPuzzles.length) return;
    try {
      const cur = tacticsPuzzles[tacticsIdx];
      if (!cur) return;
      localStorage.setItem('chess_tactics_session', JSON.stringify({
        diff: tacticsDiff, theme: tacticsTheme, movesFilter: tacticsMovesFilter, puzzle: cur, idx: 0,
      }));
    } catch {}
  }, [tacticsMode, tacticsDiff, tacticsTheme, tacticsMovesFilter, tacticsPuzzles, tacticsIdx]);

  // Fetch first puzzle when tactics mode starts (or difficulty changes)
  useEffect(() => {
    if (!tacticsMode) return;
    // Skip initial fetch when restoring from localStorage
    if (tacticsRestoredRef.current) { tacticsRestoredRef.current = false; return; }
    setTacticsPuzzles([]);
    setTacticsIdx(0);
    setTacticsLoading(true);
    setTacticsError(null);
    setTacticsStatusMsg(null);
    fetchTacticsPuzzle(tacticsDiff, tacticsTheme, tacticsMovesFilter, {
      onStatus: msg => setTacticsStatusMsg(msg),
    }).then(puzzle => {
      setTacticsPuzzles([puzzle]);
      setTacticsLoading(false);
      setTacticsStatusMsg(null);
    }).catch(err => {
      setTacticsLoading(false);
      setTacticsStatusMsg(null);
      setTacticsError(err.message);
    });
  }, [tacticsMode, tacticsDiff, tacticsTheme, fetchTacticsPuzzle]);

  // Load puzzle onto board when current puzzle changes
  useEffect(() => {
    if (!tacticsMode || !tacticsPuzzles.length) return;
    const cur = tacticsPuzzles[tacticsIdx];
    if (cur) loadTacticsPuzzle(cur);
  }, [tacticsMode, tacticsPuzzles, tacticsIdx, loadTacticsPuzzle]);

  // (prefetch removed – fetching on-demand in handleTacticsNext avoids rate-limit bursts)

  // Auto-apply opponent's response when tacticsStep is odd (opponent's turn)
  useEffect(() => {
    if (!tacticsMode || tacticsResult) return;
    const puzzle = tacticsPuzzles[tacticsIdx];
    if (!puzzle) return;
    const movesArr = normalizeMoves(puzzle.moves);
    if (tacticsStep % 2 === 0) return; // even step = player's turn, nothing to auto-apply
    if (tacticsStep >= movesArr.length) {
      // No more moves – last move was player's, puzzle complete
      return;
    }
    const oppUci = movesArr[tacticsStep];
    const fc = oppUci.charCodeAt(0) - 97;
    const fr = 8 - parseInt(oppUci[1]);
    const tc = oppUci.charCodeAt(2) - 97;
    const tr = 8 - parseInt(oppUci[3]);
    const timer = setTimeout(() => {
      setBoard(prev => applyUciMoveToBoard(prev, oppUci));
      setLastMove({ from: [fr, fc], to: [tr, tc] });
      setChessTurn(prev => prev === 'w' ? 'b' : 'w');
      setSel(null); setLegal([]);
      // Reset hint/answer display for the next player turn
      setTacticsHintUsed(false);
      setTacticsShowAnswer(false);
      setTacticsStep(prev => {
        const next = prev + 1;
        return next;
      });
    }, 700);
    return () => clearTimeout(timer);
  }, [tacticsStep, tacticsMode, tacticsResult, tacticsPuzzles, tacticsIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Go to next puzzle ─────────────────────────────────────────────
  const handleTacticsNext = useCallback(() => {
    setTacticsLoading(true);
    setTacticsError(null);
    setTacticsStatusMsg(null);
    setTacticsResult(null);
    fetchTacticsPuzzle(tacticsDiff, tacticsTheme, tacticsMovesFilter, {
      onStatus: msg => setTacticsStatusMsg(msg),
    }).then(p => {
      setTacticsPuzzles(prev => [...prev, p]);
      setTacticsIdx(prev => prev + 1);
      setTacticsLoading(false);
      setTacticsStatusMsg(null);
    }).catch(err => {
      setTacticsLoading(false);
      setTacticsStatusMsg(null);
      setTacticsError(err.message);
    });
  }, [tacticsDiff, tacticsTheme, tacticsMovesFilter, fetchTacticsPuzzle]);

  const saveTacticsFb = useCallback(async (puzzle, result, hintUsed, attemptCount) => {
    if (!playerName || !puzzle) return;
    try {
      await set(ref(db, `tactics/${playerName}/${puzzle.id}`), {
        puzzleId: puzzle.id, gameType: 'chess',
        difficulty: puzzle.difficulty, result, hintUsed, attemptCount,
        solvedAt: new Date().toISOString(),
      });
    } catch(e) { console.warn('tactics save failed:', e); }
  }, [playerName]);

  const ChessCapRow = ({capColor}) => {
    const types = ["Q","R","B","N","P"];
    const oppColor = capColor==="w"?"b":"w";
    const pieces = types.flatMap(t => Array(capPieces[capColor]?.[t]||0).fill(t));
    if (!pieces.length) return <div style={{minHeight: Math.floor(cellSize * 0.8 / 2) + 4}}/>;
    return (
      <div style={{display:"flex", gap:2, flexWrap:"wrap", minHeight:Math.round(cellSize * 0.8) + 8, alignItems:"flex-end", padding:"4px 0 4px 16px"}}>
        {pieces.map((t,i) => (
          <div key={i} style={{width:Math.round(cellSize * 0.8), height:Math.round(cellSize * 0.8), display:"flex", alignItems:"flex-end", justifyContent:"center", flexShrink:0}}>
            <img src={`/pieces/${oppColor}${t}.webp`} alt={t}
              style={{height:`${PIECE_SCALE[oppColor+t]||85}%`, width:"auto", maxWidth:"100%", display:"block", pointerEvents:"none"}}/>
          </div>
        ))}
      </div>
    );
  };

  const rules = playerLang==="en" ? CHESS_PRACTICE_RULES_EN : CHESS_PRACTICE_RULES_JA;
  const rulesPanel = (
    <div style={{fontFamily:serif, fontSize:18, color:"#3a2e22"}}>
      <div style={{fontSize:16, letterSpacing:"2px", color:"#a89070", textTransform:"uppercase", marginBottom:12, textAlign:"center"}}>
        {playerLang==="en" ? "How Pieces Move" : "駒の動き方"}
      </div>
      {rules.map((r,i)=>(
        <div key={i} style={{marginBottom:10, padding:"6px 0", borderBottom:"1px solid #e8d8b4"}}>
          <div style={{fontWeight:600, fontSize:18, marginBottom:2}}>{r.icon} {r.piece}</div>
          <div style={{fontSize:17, color:"#5a3c18", lineHeight:1.5}}>{r.desc}</div>
        </div>
      ))}
      <button onClick={resetChess} style={{marginTop:8,width:"100%",background:"transparent",border:"1px solid #c8b090",borderRadius:8,color:"#7a5838",padding:"8px",cursor:"pointer",fontSize:17,fontFamily:serif}}>
        {playerLang==="en"?"Reset Board":"配置をリセット"}
      </button>
    </div>
  );

  // 特殊ルールUIエレメント（AI ONのときに表示）
  const chessRulesToggleEl = vsAI ? (
    <div style={{display:"flex",flexWrap:"wrap",gap:4,alignItems:"center",padding:"4px 0 2px"}}>
      {[
        {key:"castling",  ja:"キャスリング", en:"Castling"},
        {key:"enPassant", ja:"アンパッサン", en:"En Passant"},
        {key:"promotion", ja:"プロモーション",en:"Promotion"},
      ].map(({key,ja,en})=>(
        <button key={key}
          onClick={()=>setPracticeRules(v=>({...v,[key]:!v[key]}))}
          style={{background:practiceRules[key]?"#c8a86a":"#faf5e8",color:practiceRules[key]?"#fff":"#7a5838",border:"1px solid #c8b090",borderRadius:12,padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}>
          {playerLang==="en"?en:ja} {practiceRules[key]?"ON":"OFF"}
        </button>
      ))}
    </div>
  ) : null;

  // In tactics mode, flip board so the active side is always at the bottom
  const tacticsTurn = tacticsMode ? (tacticsPuzzles[tacticsIdx]?.turn ?? null) : null;
  const boardFlipped = tacticsMode ? (tacticsTurn === 'b') : (vsAI && aiColor === "w");
  const grainCL = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Cpath d='M0 12 Q10 11 20 12.5 Q30 14 40 12' stroke='%23b89555' stroke-width='0.3' fill='none' opacity='0.22'/%3E%3Cpath d='M0 27 Q15 26 25 28 Q35 29 40 27' stroke='%23b89555' stroke-width='0.25' fill='none' opacity='0.17'/%3E%3C/svg%3E\")";
  const grainCD = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Cpath d='M0 10 Q12 9 22 10.5 Q32 12 40 10' stroke='%236a3f1e' stroke-width='0.3' fill='none' opacity='0.18'/%3E%3Cpath d='M0 28 Q8 27 20 29 Q30 30 40 28' stroke='%236a3f1e' stroke-width='0.25' fill='none' opacity='0.15'/%3E%3C/svg%3E\")";
  const boardEl = (
    <div style={{position:"relative",background:"#e8d9c0",borderRadius:12,border:"1.5px solid rgba(154,120,72,0.65)",padding:"14px 14px 0 14px",boxShadow:"0 6px 24px rgba(60,40,20,0.20), inset 0 1px 2px rgba(255,230,180,0.20)",display:"inline-block"}}>
      <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:0,overflow:"hidden",borderRadius:12}} viewBox="0 0 100 100" preserveAspectRatio="none">
        <rect x="4" y="4" width="92" height="92" fill="none" stroke="#c4a46a" strokeWidth="0.5" opacity="0.35" rx="1.5"/>
        <rect x="7.5" y="7.5" width="85" height="85" fill="none" stroke="#b89a60" strokeWidth="0.4" opacity="0.25" rx="1" strokeDasharray="3,5"/>
      </svg>
      {[{top:2,left:2},{top:2,right:2},{bottom:2,left:2},{bottom:2,right:2}].map((pos,i) => (
        <svg key={i} style={{position:"absolute",...pos,width:11,height:11,pointerEvents:"none",zIndex:10,overflow:"visible"}} viewBox="0 0 10 10">
          <circle cx="5" cy="5" r="5" fill="#c8a84b" opacity="0.6"/>
          <circle cx="5" cy="5" r="3" fill="none" stroke="#a88830" strokeWidth="0.8" opacity="0.7"/>
          <circle cx="5" cy="5" r="1.2" fill="#a88830" opacity="0.6"/>
        </svg>
      ))}
      <div style={{display:"grid",gridTemplateColumns:`16px repeat(8,${cellSize}px)`,gridTemplateRows:`repeat(8,${cellSize}px) 16px`}}>
        {Array.from({length:8},(_,vr)=>{
          const r = boardFlipped ? 7-vr : vr;
          return [
            <div key={`n${vr}`} style={{display:"flex",alignItems:"center",justifyContent:"center",color:"#7a5c38",fontSize:10,fontWeight:400,gridColumn:1,gridRow:vr+1,fontFamily:"Georgia,serif",userSelect:"none",opacity:0.62,letterSpacing:"0.02em"}}>{8-r}</div>,
            ...Array.from({length:8},(_,vc)=>{
              const c = boardFlipped ? 7-vc : vc;
              const piece=board[r]?.[c];
              const isSel=sel?.r===r&&sel?.c===c;
              const isLeg=legal.some(([lr,lc])=>lr===r&&lc===c);
              const isLastFrom=lastMove&&lastMove.from[0]===r&&lastMove.from[1]===c;
              const isLastTo=lastMove&&lastMove.to[0]===r&&lastMove.to[1]===c;
              const tacPz = tacticsMode && tacticsPuzzles[tacticsIdx];
              // Hint: show "to" square of current player move
              const _tacCurMoves = tacPz ? normalizeMoves(tacPz.moves) : [];
              const _tacCurUci = _tacCurMoves[tacticsStep];
              const _tacHintTo = _tacCurUci && _tacCurUci.length >= 4
                ? [8 - parseInt(_tacCurUci[3]), _tacCurUci.charCodeAt(2) - 97] : null;
              const isHintSq = tacticsMode && tacticsHintUsed && !tacticsResult && _tacHintTo && _tacHintTo[0]===r && _tacHintTo[1]===c;
              const _tacAnsUci = tacticsMode && tacticsShowAnswer && _tacCurUci;
              const isAnsSq = _tacAnsUci && (() => {
                const fc=_tacAnsUci.charCodeAt(0)-97, fr=8-parseInt(_tacAnsUci[1]);
                const tc=_tacAnsUci.charCodeAt(2)-97, tr=8-parseInt(_tacAnsUci[3]);
                return (fr===r&&fc===c)||(tr===r&&tc===c);
              })(
              );
              const isLight=(r+c)%2===0;
              const bg=isLight?`${grainCL} , #EDE0C8`:`${grainCD} , #D4A888`;
              return (
                <div key={vc} onClick={()=>handleClick(r,c)} style={{
                  width:cellSize,height:cellSize,
                  background:bg,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  cursor:"pointer",position:"relative",boxSizing:"border-box",overflow:"hidden",
                  gridColumn:vc+2,gridRow:vr+1,
                }}>
                  {(isLastFrom||isLastTo)&&!isSel&&<div style={{position:"absolute",inset:0,background:"rgba(200,168,106,0.45)",pointerEvents:"none",zIndex:1}}/>}
                  {isSel&&<div style={{position:"absolute",inset:0,background:"rgba(100,130,60,0.46)",pointerEvents:"none",zIndex:1}}/>}
                  {!isSel&&isLeg&&piece&&<div style={{position:"absolute",inset:0,border:"2.5px solid rgba(80,50,20,0.18)",borderRadius:0,pointerEvents:"none",zIndex:2}}/>}
                  {isLeg&&!piece&&<div style={{position:"absolute",width:cellSize*0.32,height:cellSize*0.32,borderRadius:"50%",background:"rgba(80,50,20,0.14)",zIndex:2}}/>}
                  {isHintSq&&<div style={{position:"absolute",inset:0,background:"rgba(100,220,100,0.45)",pointerEvents:"none",zIndex:3}}/>}
                  {isAnsSq&&<div style={{position:"absolute",inset:0,background:"rgba(60,140,255,0.40)",pointerEvents:"none",zIndex:3}}/>}
                  {piece&&<img src={getPieceImg(piece)} alt={piece.type} draggable={false} style={{width:cellSize*0.88,height:cellSize*0.88,objectFit:"contain",display:"block",position:"relative",zIndex:3,
                    filter: piece.color==="w"
                      ? "drop-shadow(0 0 0.8px #3A2416) drop-shadow(0px 1.8px 3px rgba(90,58,34,0.16))"
                      : "drop-shadow(0 0 0.6px #1a0e04) drop-shadow(0px 2.5px 2px rgba(74,46,16,0.32))"
                  }}/>}
                </div>
              );
            })
          ];
        })}
        {Array.from({length:8},(_,ci)=>(
          <div key={`l${ci}`} style={{gridColumn:ci+2,gridRow:9,display:"flex",alignItems:"center",justifyContent:"center",color:"#7a5c38",fontSize:10,fontWeight:400,fontFamily:"Georgia,serif",userSelect:"none",opacity:0.72,letterSpacing:"0.06em"}}>
            {"abcdefgh"[boardFlipped ? 7-ci : ci]}
          </div>
        ))}
      </div>
      <div style={{textAlign:"center",fontFamily:"Georgia,serif",fontSize:11,color:"#8a6a40",letterSpacing:"2px",opacity:0.45,padding:"7px 0 9px",userSelect:"none",pointerEvents:"none"}}>FAMILY CHESS — WOODEN TRAVELER SERIES</div>
    </div>
  );

  const chessAnnouncementEl = checkAnnouncement ? (
    <div style={{position:"fixed",top:"20%",left:"50%",transform:"translateX(-50%)",zIndex:9000,background:"rgba(50,30,10,0.92)",color:"#ffe8a0",fontSize:22,fontWeight:700,padding:"14px 28px",borderRadius:12,border:"2px solid #c8a86a",fontFamily:serif,textAlign:"center",pointerEvents:"none",boxShadow:"0 4px 24px rgba(0,0,0,0.5)"}}>
      {checkAnnouncement}
    </div>
  ) : null;

  // ── Tactics result modal (chess) ─────────────────────────────────────
  // Must be declared before tacticsResultModalEl to avoid TDZ crash on correct answer
  const tacCurPuzzle = tacticsMode && tacticsPuzzles.length > 0 ? tacticsPuzzles[tacticsIdx] : null;
  const btnMod = {border:"none",borderRadius:12,padding:"11px 0",fontSize:15,cursor:"pointer",fontFamily:serif,width:"100%"};
  const tacticsResultModalEl = (tacticsMode && tacticsResult) ? (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.52)",zIndex:9600,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:serif}}>
      <div style={{background:"#faf5e8",border:"2px solid #c8a86a",borderRadius:24,padding:"36px 32px 28px",maxWidth:290,width:"88vw",textAlign:"center",boxShadow:"0 12px 48px rgba(0,0,0,0.38)",animation:"tacModalPop 0.22s cubic-bezier(0.34,1.56,0.64,1) both"}}>
        <div style={{fontSize:60,lineHeight:1.1,marginBottom:8}}>
          {tacticsResult==='correct'?'✅':'❌'}
        </div>
        <div style={{fontSize:26,fontWeight:700,letterSpacing:1,color:tacticsResult==='correct'?"#2a7a2a":"#c04040",marginBottom:6}}>
          {tacticsResult==='correct'
            ?(playerLang==="en"?"Correct!":"正解！")
            :(playerLang==="en"?"Incorrect":"不正解")}
        </div>
        {tacticsResult==='correct' && tacCurPuzzle?.rating && (
          <div style={{fontSize:13,color:"#9a7848",marginBottom:12}}>★{tacCurPuzzle.rating}</div>
        )}
        {tacticsResult==='incorrect' && (
          <div style={{fontSize:13,color:"#7a5838",marginBottom:12}}>
            {playerLang==="en"?"Keep trying — you'll get it!":"惜しい！もう一度チャレンジしよう！"}
          </div>
        )}
        <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:4}}>
          {tacticsResult==='correct' ? (
            <button onClick={handleTacticsNext}
              style={{...btnMod,background:"#c8a86a",color:"#fff",fontWeight:600,fontSize:16}}>
              ▶ {playerLang==="en"?"Next Puzzle":"次の問題"}
            </button>
          ) : (<>
            <button onClick={()=>{ setTacticsResult(null); loadTacticsPuzzle(tacCurPuzzle); }}
              style={{...btnMod,background:"#f5ece0",color:"#7a5838",border:"1px solid #c8b090"}}>
              {playerLang==="en"?"Try Again":"もう一度"}
            </button>
            <button onClick={()=>{ setTacticsResult(null); setTacticsShowAnswer(true); }}
              style={{...btnMod,background:"#f5ece0",color:"#7a5838",border:"1px solid #c8b090"}}>
              {playerLang==="en"?"Show Answer":"答えを見る"}
            </button>
            <button onClick={handleTacticsNext}
              style={{...btnMod,background:"#c8a86a",color:"#fff",fontWeight:600}}>
              ▶ {playerLang==="en"?"Next Puzzle":"次の問題"}
            </button>
          </>)}
        </div>
      </div>
    </div>
  ) : null;

  const chessVictoryModalEl = victoryModal ? (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:9500,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:serif}}>
      <div style={{background:"#faf5e8",border:"2px solid #c8a86a",borderRadius:16,padding:"32px 36px",maxWidth:320,width:"90vw",textAlign:"center",boxShadow:"0 8px 40px rgba(0,0,0,0.5)"}}>
        <div style={{fontSize:48,marginBottom:12}}>{victoryModal.winner==="player"?"🏆":"🤖"}</div>
        <div style={{fontSize:22,fontWeight:700,color:"#3a2e22",marginBottom:8}}>
          {victoryModal.winner==="player"
            ? (playerLang==="en"?"You Win! / 勝利！":"勝利！/ You Win!")
            : (playerLang==="en"?"AI Wins / AI の勝ち":"AI の勝ち / AI Wins")}
        </div>
        <div style={{display:"flex",gap:10,marginTop:16,flexDirection:"column"}}>
          <button onClick={()=>{ setVictoryModal(null); resetChess(); }} style={{background:"#c8a86a",border:"none",borderRadius:8,color:"#fff",padding:"10px",cursor:"pointer",fontSize:18,fontFamily:serif,fontWeight:600}}>
            {playerLang==="en"?"Play Again / もう一度":"もう一度 / Play Again"}
          </button>
          {onAnalyze&&practiceGameHistory.length>0&&(
            <button onClick={()=>{ setVictoryModal(null); handleAnalyzeGame(); }} style={{background:"transparent",border:"1px solid #c8b090",borderRadius:8,color:"#7a5838",padding:"10px",cursor:"pointer",fontSize:18,fontFamily:serif}}>
              {playerLang==="en"?"Analyze / 解析":"解析 / Analyze"}
            </button>
          )}
          <button onClick={()=>setVictoryModal(null)} style={{background:"transparent",border:"1px solid #c8b090",borderRadius:8,color:"#9a8878",padding:"8px",cursor:"pointer",fontSize:16,fontFamily:serif}}>
            {playerLang==="en"?"Close":"閉じる"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  // ── Tactics UI elements ─────────────────────────────────────────
  const btnStyle = {background:"transparent",border:"1px solid #c8b090",borderRadius:8,color:"#7a5838",padding:"6px 14px",cursor:"pointer",fontSize:16,fontFamily:serif};

  const TACTICS_THEMES = [
    { id: null,               ja: 'すべて',           en: 'All' },
    { id: 'fork',             ja: 'フォーク・両取り',  en: 'Fork' },
    { id: 'pin',              ja: 'ピン',              en: 'Pin' },
    { id: 'sacrifice',        ja: 'サクリファイス',    en: 'Sacrifice' },
    { id: 'skewer',           ja: 'スキュアー',        en: 'Skewer' },
    { id: 'discoveredAttack', ja: '陰の攻撃',          en: 'Discovered Attack' },
    { id: 'doubleCheck',      ja: 'ダブルチェック',    en: 'Double Check' },
    { id: 'deflection',       ja: 'そらし',            en: 'Deflection' },
    { id: 'decoy',            ja: '誘い込み',          en: 'Decoy' },
    { id: 'endgame',          ja: 'エンドゲーム',      en: 'Endgame' },
  ];

  const tacticsDiffSelectModal = tacticsDiffSelect ? (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9800,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:serif,padding:"12px 0"}}>
      <div style={{background:"#faf5e8",border:"2px solid #c8a86a",borderRadius:16,padding:"24px 24px 20px",maxWidth:340,width:"92vw",maxHeight:"90vh",overflowY:"auto",boxSizing:"border-box"}}>

        {/* ── 難易度 ── */}
        <div style={{fontSize:16,fontWeight:700,color:"#7a5838",marginBottom:10,letterSpacing:1}}>
          {playerLang==="en"?"Difficulty":"難易度"}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:18}}>
          {[null,'Easy','Normal','Hard'].map(d=>{
            const active = tacticsDiff === d;
            const label = d===null?(playerLang==="en"?"All":"すべて"):d;
            const bg = active ? (d==='Easy'?"#4a9":d==='Hard'?"#d44":d==='Normal'?"#c90":"#c8a86a") : "transparent";
            return (
              <button key={String(d)} onClick={()=>setTacticsDiff(d)}
                style={{border:`1.5px solid ${active?"transparent":"#c8b090"}`,borderRadius:8,padding:"7px 0",fontSize:13,cursor:"pointer",fontFamily:serif,
                  background:bg,color:active?"#fff":"#7a5838",fontWeight:active?700:400,transition:"background 0.15s"}}>
                {label}
              </button>
            );
          })}
        </div>

        {/* ── 手数 ── */}
        <div style={{fontSize:16,fontWeight:700,color:"#7a5838",marginBottom:10,letterSpacing:1}}>
          {playerLang==="en"?"Moves":"手数"}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6,marginBottom:18}}>
          {[
            { val: null,  ja: "すべて", en: "All" },
            { val: 1,     ja: "1手",    en: "1 move" },
            { val: 2,     ja: "2手",    en: "2 moves" },
            { val: 3,     ja: "3手",    en: "3 moves" },
            { val: '4+',  ja: "4手以上", en: "4+ moves" },
          ].map(({ val, ja, en }) => {
            const active = tacticsMovesFilter === val;
            return (
              <button key={String(val)} onClick={() => setTacticsMovesFilter(val)}
                style={{border:`1.5px solid ${active?"transparent":"#c8b090"}`,borderRadius:8,padding:"7px 2px",fontSize:12,cursor:"pointer",fontFamily:serif,
                  background:active?"#6a8abf":"transparent",color:active?"#fff":"#7a5838",fontWeight:active?700:400,transition:"background 0.15s",whiteSpace:"nowrap"}}>
                {playerLang==="en"?en:ja}
              </button>
            );
          })}
        </div>

        {/* ── テーマ ── */}
        <div style={{fontSize:16,fontWeight:700,color:"#7a5838",marginBottom:10,letterSpacing:1}}>
          {playerLang==="en"?"Theme":"テーマ"}
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:20}}>
          {TACTICS_THEMES.map(t=>{
            const active = tacticsTheme === t.id;
            return (
              <button key={String(t.id)} onClick={()=>setTacticsTheme(t.id)}
                style={{border:`1.5px solid ${active?"transparent":"#c8b090"}`,borderRadius:20,padding:"5px 12px",fontSize:13,cursor:"pointer",fontFamily:serif,
                  background:active?"#c8a86a":"transparent",color:active?"#fff":"#7a5838",fontWeight:active?700:400,whiteSpace:"nowrap",transition:"background 0.15s"}}>
                {playerLang==="en"?t.en:t.ja}
              </button>
            );
          })}
        </div>

        {/* ── ボタン ── */}
        <button onClick={()=>{
          setTacticsDiffSelect(false);
          setTacticsMode(true); setVsAI(false);
        }} style={{...btnStyle,display:"block",width:"100%",marginBottom:8,fontSize:16,background:"#c8a86a",color:"#fff",border:"none",fontWeight:700,borderRadius:10,padding:"11px 0"}}>
          {playerLang==="en"?"Start":"スタート"}
        </button>
        <button onClick={()=>setTacticsDiffSelect(false)} style={{...btnStyle,display:"block",width:"100%",fontSize:14,color:"#9a8878",textAlign:"center"}}>
          {playerLang==="en"?"Cancel":"キャンセル"}
        </button>
      </div>
    </div>
  ) : null;

  const tacThemeLabel = tacticsTheme ? (TACTICS_THEMES.find(t=>t.id===tacticsTheme)?.[playerLang==="en"?"en":"ja"] ?? tacticsTheme) : null;
  const tacMovesLabel = tacticsMovesFilter !== null
    ? (playerLang==="en"
        ? (tacticsMovesFilter === '4+' ? '4+ moves' : `${tacticsMovesFilter} move${tacticsMovesFilter > 1 ? 's' : ''}`)
        : (tacticsMovesFilter === '4+' ? '4手以上' : `${tacticsMovesFilter}手`))
    : null;
  const tacticsHeaderEl = tacticsMode && (tacCurPuzzle || tacticsLoading) ? (
    <div style={{fontFamily:serif,textAlign:"center",padding:"6px 0 2px"}}>
      {tacCurPuzzle && <>
        <span style={{background:tacCurPuzzle.difficulty==='Easy'?"#4a9":(tacCurPuzzle.difficulty==='Hard'?"#d44":"#c90"),color:"#fff",borderRadius:8,padding:"1px 8px",fontSize:13,fontWeight:600,marginRight:6}}>
          {tacCurPuzzle.difficulty}
        </span>
        {tacThemeLabel && <span style={{background:"#6a7a9a",color:"#fff",borderRadius:8,padding:"1px 8px",fontSize:12,fontWeight:600,marginRight:6}}>{tacThemeLabel}</span>}
        {tacMovesLabel && <span style={{background:"#6a8abf",color:"#fff",borderRadius:8,padding:"1px 8px",fontSize:12,fontWeight:600,marginRight:6}}>{tacMovesLabel}</span>}
        {tacCurPuzzle.rating && <span style={{fontSize:13,color:"#9a7848"}}>★{tacCurPuzzle.rating}</span>}
        <div style={{fontSize:15,color:"#5a3c18",marginTop:3}}>
          {playerLang==="en"?tacCurPuzzle.descEn:tacCurPuzzle.descJa}
        </div>
      </>}
    </div>
  ) : null;

  const tacticsControlsEl = tacticsMode ? (
    <div style={{display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center",padding:"6px 0"}}>
      {tacticsError ? (<>
        <span style={{fontFamily:serif,fontSize:14,color:"#c04040",alignSelf:"center"}}>{playerLang==="en"?"Failed to load puzzle":"問題を読み込めませんでした"}</span>
        <button onClick={()=>{
          setTacticsError(null); setTacticsLoading(true); setTacticsStatusMsg(null); setTacticsResult(null);
          fetchTacticsPuzzle(tacticsDiff, tacticsTheme, tacticsMovesFilter, { onStatus: msg => setTacticsStatusMsg(msg) })
            .then(p=>{ setTacticsPuzzles(prev=>[...prev,p]); setTacticsIdx(prev=>prev+1); setTacticsLoading(false); setTacticsStatusMsg(null); })
            .catch(e=>{ setTacticsLoading(false); setTacticsStatusMsg(null); setTacticsError(e.message); });
        }} style={{...btnStyle,background:"#c8a86a",color:"#fff",border:"none"}}>{playerLang==="en"?"Retry":"再試行"}</button>
      </>) : tacticsLoading ? (<>
        <span style={{fontFamily:serif,fontSize:15,color:"#7a5838",alignSelf:"center"}}>
          {tacticsStatusMsg || (playerLang==="en"?"Loading…":"読み込み中…")}
        </span>
      </>) : tacticsResult==='correct' ? (<>
        <span style={{fontSize:22}}>✅</span>
        <span style={{fontFamily:serif,fontSize:16,color:"#3a7a3a",alignSelf:"center"}}>{playerLang==="en"?"Correct!":"正解！"}</span>
        <button onClick={handleTacticsNext} style={{...btnStyle,background:"#c8a86a",color:"#fff",border:"none"}}>
          ▶ {playerLang==="en"?"Next":"次の問題"}
        </button>
      </>) : tacticsResult==='incorrect' ? (<>
        <span style={{fontSize:22}}>❌</span>
        <span style={{fontFamily:serif,fontSize:16,color:"#c04040",alignSelf:"center"}}>{playerLang==="en"?"Incorrect":"不正解"}</span>
        <button onClick={()=>{ setTacticsResult(null); loadTacticsPuzzle(tacCurPuzzle); }} style={btnStyle}>{playerLang==="en"?"Retry":"もう一度"}</button>
        <button onClick={()=>{ setTacticsResult(null); setTacticsShowAnswer(true); }} style={btnStyle}>{playerLang==="en"?"Show Answer":"答えを見る"}</button>
        <button onClick={handleTacticsNext} style={{...btnStyle,background:"#c8a86a",color:"#fff",border:"none"}}>▶ {playerLang==="en"?"Next":"次の問題"}</button>
      </>) : (<>
        <button onClick={()=>{ setTacticsHintUsed(true); }} disabled={tacticsHintUsed} style={{...btnStyle,opacity:tacticsHintUsed?0.5:1}}>{playerLang==="en"?"Hint 💡":"ヒント 💡"}</button>
        <button onClick={()=>setTacticsShowAnswer(true)} style={btnStyle}>{playerLang==="en"?"Show Answer":"答えを見る"}</button>
        <button onClick={handleTacticsNext} style={btnStyle}>⏭ {playerLang==="en"?"Skip":"スキップ"}</button>
      </>)}
      <button onClick={()=>setTacticsIdx(i=>Math.max(0,i-1))} disabled={tacticsIdx===0} style={{...btnStyle,opacity:tacticsIdx===0?0.4:1}}>◀</button>
      <button onClick={()=>{ localStorage.removeItem('chess_tactics_session'); setTacticsMode(false); resetChess(); }} style={{...btnStyle,color:"#9a8878"}}>✕ {playerLang==="en"?"Exit":"終了"}</button>
    </div>
  ) : null;

  const tacticsBtn = (
    <button onClick={()=>setTacticsDiffSelect(true)} disabled={tacticsMode}
      style={{background:tacticsMode?"#c8a86a":"transparent",border:"1px solid #c8b090",borderRadius:8,color:tacticsMode?"#fff":"#7a5838",padding:"6px 14px",cursor:tacticsMode?"default":"pointer",fontSize:16,fontFamily:serif,whiteSpace:"nowrap"}}>
      {playerLang==="en"?"Tactics 🎯":"タクティクス 🎯"}
    </button>
  );

  if (fullScreen) {
    const bw = cellSize * 8 + 44;
    const bwStr = bw > 0 ? `${bw}px` : "min(calc(100vw - 8px),96vw)";
    const fsBtn={background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.25)",borderRadius:8,color:"#fff",padding:"4px 10px",cursor:"pointer",fontSize:"clamp(15px,3.5vw,18px)",whiteSpace:"nowrap",fontFamily:serif};
    return (
      <div style={{position:"fixed",inset:0,paddingTop:"env(safe-area-inset-top)",paddingBottom:"env(safe-area-inset-bottom)",background:"#2a1808",display:"flex",flexDirection:"column",zIndex:2000,overflow:"hidden",fontFamily:serif,boxSizing:"border-box"}}>
        {/* Row 1: Reset | Undo | Exit */}
        <div style={{flexShrink:0,display:"flex",alignItems:"center",gap:6,padding:"5px 8px",boxSizing:"border-box"}}>
          <button onClick={resetChess} style={fsBtn}>↺ {playerLang==="en"?"Reset":"リセット"}</button>
          <button onClick={handleChessUndo} disabled={moveHistory.length===0} style={{...fsBtn,opacity:moveHistory.length===0?0.35:1,cursor:moveHistory.length===0?"default":"pointer"}}>↩ {playerLang==="en"?"Undo":"1手戻す"}</button>
          <div style={{flex:1}}/>
          <button onClick={()=>setFullScreen(false)} style={fsBtn}>✕ {playerLang==="en"?"Exit":"終了"}</button>
        </div>
        {/* Row 2: Chess|将棋 switcher + AI controls */}
        <div style={{flexShrink:0,display:"flex",alignItems:"center",gap:5,padding:"3px 8px",background:"rgba(0,0,0,0.3)",boxSizing:"border-box",flexWrap:"wrap"}}>
          {onSwitchToGame && (<>
            <button onClick={()=>onSwitchToGame("chess")} style={{...fsBtn,background:"rgba(200,168,106,0.45)",fontWeight:700}}>Chess</button>
            <button onClick={()=>onSwitchToGame("shogi")} style={{...fsBtn,background:"rgba(255,255,255,0.08)"}}>将棋</button>
            <div style={{width:1,height:16,background:"rgba(255,255,255,0.2)",margin:"0 2px"}}/>
          </>)}
          <button onClick={handleToggleVsAI} style={{...fsBtn,background:vsAI?"rgba(200,168,106,0.5)":"rgba(255,255,255,0.08)"}}>
            {vsAI ? `AI ON  Lv${aiLevel}` : (playerLang==="en"?"AI: OFF":"AI: OFF")}
          </button>
          {vsAI&&(<>
            <button onClick={()=>handleChessSetAiColor(aiColor==="b"?"w":"b")} style={{...fsBtn,background:"rgba(255,255,255,0.08)"}}>
              {aiColor==="b"?(playerLang==="en"?"▶ White":"▶ 白"):(playerLang==="en"?"▶ Black":"▶ 黒")}
            </button>
            {[
              {key:"castling",  ja:"城",en:"Cast"},
              {key:"enPassant", ja:"EP",en:"EP"},
              {key:"promotion", ja:"成",en:"Prom"},
            ].map(({key,ja,en})=>(
              <button key={key}
                onClick={()=>setPracticeRules(v=>({...v,[key]:!v[key]}))}
                style={{...fsBtn,background:practiceRules[key]?"rgba(200,168,106,0.5)":"rgba(255,255,255,0.08)",fontSize:13,padding:"3px 7px"}}>
                {playerLang==="en"?en:ja} {practiceRules[key]?"ON":"OFF"}
              </button>
            ))}
            {practiceGameHistory.length>0&&onAnalyze&&(
              <button onClick={handleAnalyzeGame} style={{...fsBtn,background:"rgba(255,255,255,0.08)"}}>
                {playerLang==="en"?"Analyze":"解析"}
              </button>
            )}
            {aiThinking&&<span style={{color:"rgba(200,168,106,0.9)",fontSize:16,animation:"spin 1s linear infinite",display:"inline-block"}}>⟳</span>}
          </>)}
        </div>
        {/* Board area */}
        <div ref={fsAreaRefCb} style={{flex:1,minHeight:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"4px",overflow:"hidden",boxSizing:"border-box"}}>
          <div style={{width:bwStr}}>
            {tacticsMode && tacCurPuzzle && <div style={{color:"#fff",fontSize:14,fontFamily:serif,textAlign:"center",marginBottom:4,opacity:0.9}}>
              {playerLang==="en"?`Puzzle #${tacticsIdx+1}`:`問題 ${tacticsIdx+1}問目`} · {tacCurPuzzle.difficulty}{tacMovesLabel ? ` · ${tacMovesLabel}` : ''} · {playerLang==="en"?tacCurPuzzle.descEn:tacCurPuzzle.descJa}
            </div>}
            <div style={{transform:"rotate(180deg)"}}><ChessCapRow capColor="b"/></div>
            {boardEl}
            <ChessCapRow capColor="w"/>
            {tacticsMode && <div style={{display:"flex",flexWrap:"wrap",gap:5,justifyContent:"center",marginTop:4}}>
              {tacticsError ? (<>
                <span style={{color:"#f08080",fontFamily:serif,fontSize:13,alignSelf:"center"}}>{playerLang==="en"?"Load failed":"読込失敗"}</span>
                <button onClick={()=>{
                  setTacticsError(null); setTacticsLoading(true); setTacticsStatusMsg(null); setTacticsResult(null);
                  fetchTacticsPuzzle(tacticsDiff, tacticsTheme, tacticsMovesFilter, { onStatus: msg => setTacticsStatusMsg(msg) })
                    .then(p=>{ setTacticsPuzzles(prev=>[...prev,p]); setTacticsIdx(prev=>prev+1); setTacticsLoading(false); setTacticsStatusMsg(null); })
                    .catch(e=>{ setTacticsLoading(false); setTacticsStatusMsg(null); setTacticsError(e.message); });
                }} style={fsBtn}>{playerLang==="en"?"Retry":"再試行"}</button>
              </>) : tacticsLoading ? (
                <span style={{color:"rgba(255,255,255,0.7)",fontFamily:serif,fontSize:14,alignSelf:"center"}}>
                  {tacticsStatusMsg || (playerLang==="en"?"Loading…":"読み込み中…")}
                </span>
              ) : tacticsResult==='correct' ? (<>
                <span style={{fontSize:20,alignSelf:"center"}}>✅</span>
                <span style={{color:"#7ef07e",fontFamily:serif,fontSize:14,alignSelf:"center"}}>{playerLang==="en"?"Correct!":"正解！"}</span>
                <button onClick={handleTacticsNext} style={{...fsBtn,background:"rgba(80,180,80,0.4)"}}>▶ {playerLang==="en"?"Next":"次"}</button>
              </>) : tacticsResult==='incorrect' ? (<>
                <span style={{fontSize:20,alignSelf:"center"}}>❌</span>
                <button onClick={()=>{setTacticsResult(null);loadTacticsPuzzle(tacCurPuzzle);}} style={fsBtn}>{playerLang==="en"?"Retry":"もう一度"}</button>
                <button onClick={()=>{setTacticsResult(null);setTacticsShowAnswer(true);}} style={fsBtn}>{playerLang==="en"?"Answer":"答え"}</button>
                <button onClick={handleTacticsNext} style={{...fsBtn,background:"rgba(80,180,80,0.4)"}}>▶</button>
              </>) : (<>
                <button onClick={()=>setTacticsHintUsed(true)} disabled={tacticsHintUsed} style={{...fsBtn,opacity:tacticsHintUsed?0.5:1}}>💡</button>
                <button onClick={()=>setTacticsShowAnswer(true)} style={fsBtn}>{playerLang==="en"?"Answer":"答え"}</button>
                <button onClick={handleTacticsNext} style={fsBtn}>⏭</button>
              </>)}
              <button onClick={()=>setTacticsIdx(i=>Math.max(0,i-1))} disabled={tacticsIdx===0} style={{...fsBtn,opacity:tacticsIdx===0?0.4:1}}>◀</button>
              <button onClick={()=>{localStorage.removeItem('chess_tactics_session');setTacticsMode(false);resetChess();}} style={{...fsBtn,opacity:0.7}}>✕</button>
            </div>}
          </div>
        </div>
        {chessAnnouncementEl}
        {chessVictoryModalEl}
        {tacticsResultModalEl}
        {tacticsDiffSelectModal}
      </div>
    );
  }

  if (pcLayout) {
    if (hideRules) {
      return (
        <>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8,padding:"12px 16px",width:"100%",boxSizing:"border-box"}}>
            {tacticsMode && tacticsHeaderEl}
            <ChessCapRow capColor="b"/>
            {boardEl}
            <ChessCapRow capColor="w"/>
            {tacticsMode && tacticsControlsEl}
            <div style={{display:"flex",flexDirection:"column",gap:6,alignItems:"center",marginTop:4,width:"100%"}}>
              {!tacticsMode && <><AIControlBar vsAI={vsAI} setVsAI={setVsAI} aiLevel={aiLevel} setAiLevel={setAiLevel} aiColor={aiColor} setAiColor={handleChessSetAiColor} aiThinking={aiThinking} playerLang={playerLang} gameType="chess" serif={serif} onToggle={handleToggleVsAI} onAnalyze={handleAnalyzeGame} canAnalyze={practiceGameHistory.length>0}/>
              {chessRulesToggleEl}</>}
              {tacticsBtn}
              <button onClick={()=>setFullScreen(true)} style={{background:"transparent",border:"1px solid #c8b090",borderRadius:8,color:"#7a5838",padding:"6px 20px",cursor:"pointer",fontSize:17,fontFamily:serif,width:"100%"}}>
                ⛶ {playerLang==="en"?"Full Screen":"全画面"}
              </button>
              <div style={{display:"flex",gap:8,width:"100%"}}>
                <button onClick={handleChessUndo} disabled={moveHistory.length===0} style={{flex:1,background:moveHistory.length===0?"rgba(200,176,144,0.15)":"transparent",border:"1px solid #c8b090",borderRadius:8,color:moveHistory.length===0?"#c8b090":"#7a5838",padding:"6px 0",cursor:moveHistory.length===0?"default":"pointer",fontSize:17,fontFamily:serif}}>
                  ↩ {playerLang==="en"?"Undo":"1手戻す"}
                </button>
                <button onClick={resetChess} style={{flex:1,background:"transparent",border:"1px solid #c8b090",borderRadius:8,color:"#7a5838",padding:"6px 0",cursor:"pointer",fontSize:17,fontFamily:serif}}>
                  {playerLang==="en"?"Reset Board":"配置をリセット"}
                </button>
              </div>
            </div>
            {/* Openings section */}
            {onOpenOpening && (
              <div style={{width:"100%",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 12px",boxSizing:"border-box",marginTop:4}}>
                <div style={{fontSize:14,letterSpacing:"1.5px",color:"#a89070",textTransform:"uppercase",marginBottom:5,fontFamily:serif}}>
                  {playerLang==="en"?"Openings":"定石"}
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                  {CHESS_OPENINGS.map(o=>(
                    <button key={o.id} onClick={()=>onOpenOpening(o,"chess")}
                      style={{background:"#fdf6e8",border:"1px solid #c8b090",borderRadius:14,color:"#5a3e28",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}
                      onMouseEnter={e=>e.currentTarget.style.background="#eddcb8"}
                      onMouseLeave={e=>e.currentTarget.style.background="#fdf6e8"}>
                      {playerLang==="en"?o.nameEn:o.nameJa}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* Tactics section */}
            {onOpenTactic && (
              <div style={{width:"100%",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 12px",boxSizing:"border-box",marginTop:4}}>
                <div style={{fontSize:14,letterSpacing:"1.5px",color:"#a89070",textTransform:"uppercase",marginBottom:5,fontFamily:serif}}>
                  {playerLang==="en"?"Tactics":"タクティクス"}
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                  {CHESS_TACTICS.filter(tt=>tt.direct).map(tt=>(
                    <button key={tt.id} onClick={()=>onOpenTactic(tt,"chess")}
                      style={{background:"#fdf6e8",border:"1px solid #c8b090",borderRadius:14,color:"#5a3e28",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}
                      onMouseEnter={e=>e.currentTarget.style.background="#eddcb8"}
                      onMouseLeave={e=>e.currentTarget.style.background="#fdf6e8"}>
                      {playerLang==="en"?tt.nameEn:tt.nameJa}
                    </button>
                  ))}
                  <button onClick={()=>{ const first = CHESS_TACTICS.find(tt=>!tt.direct); if(first) onOpenTactic(first,"chess"); }}
                    style={{background:"transparent",border:"1px solid #c8b090",borderRadius:14,color:"#7a5838",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}>
                    {playerLang==="en"?"More ▸":"もっと見る ▸"}
                  </button>
                </div>
              </div>
            )}
            {/* Strategy section (chess) */}
            <div style={{width:"100%",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 12px",boxSizing:"border-box",marginTop:4}}>
              <div style={{fontSize:14,letterSpacing:"1.5px",color:"#a89070",textTransform:"uppercase",marginBottom:5,fontFamily:serif}}>
                {playerLang==="en"?"Strategy":"ストラテジー"}
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                {(strategyShowAll ? CHESS_STRATEGY : CHESS_STRATEGY.filter(s=>CHESS_STRATEGY_FEATURED.includes(s.id))).map(s=>(
                  <button key={s.id} onClick={()=>setStrategyOpen(s)}
                    style={{background:"#fdf6e8",border:"1px solid #c8b090",borderRadius:14,color:"#5a3e28",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}
                    onMouseEnter={e=>e.currentTarget.style.background="#eddcb8"}
                    onMouseLeave={e=>e.currentTarget.style.background="#fdf6e8"}>
                    {playerLang==="en"?s.nameEn:s.nameJa}
                  </button>
                ))}
                {!strategyShowAll && CHESS_STRATEGY.length > CHESS_STRATEGY_FEATURED.length && (
                  <button onClick={()=>setStrategyShowAll(true)}
                    style={{background:"transparent",border:"1px solid #c8b090",borderRadius:14,color:"#7a5838",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}>
                    {playerLang==="en"?"More ▸":"もっと見る ▸"}
                  </button>
                )}
              </div>
            </div>
            {/* Endgame section (chess) */}
            <div style={{width:"100%",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 12px",boxSizing:"border-box",marginTop:4}}>
              <div style={{fontSize:14,letterSpacing:"1.5px",color:"#a89070",textTransform:"uppercase",marginBottom:5,fontFamily:serif}}>
                {playerLang==="en"?"Endgame":"エンドゲーム"}
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                {(endgameShowAll ? CHESS_ENDGAME : CHESS_ENDGAME.filter(s=>CHESS_ENDGAME_FEATURED.includes(s.id))).map(s=>(
                  <button key={s.id} onClick={()=>setEndgameOpen(s)}
                    style={{background:"#fdf6e8",border:"1px solid #c8b090",borderRadius:14,color:"#5a3e28",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}
                    onMouseEnter={e=>e.currentTarget.style.background="#eddcb8"}
                    onMouseLeave={e=>e.currentTarget.style.background="#fdf6e8"}>
                    {playerLang==="en"?s.nameEn:s.nameJa}
                  </button>
                ))}
                {!endgameShowAll && CHESS_ENDGAME.length > CHESS_ENDGAME_FEATURED.length && (
                  <button onClick={()=>setEndgameShowAll(true)}
                    style={{background:"transparent",border:"1px solid #c8b090",borderRadius:14,color:"#7a5838",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}>
                    {playerLang==="en"?"More ▸":"もっと見る ▸"}
                  </button>
                )}
              </div>
            </div>
            <div style={{width:"100%",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 14px",boxSizing:"border-box",marginTop:4}}>
              <div onClick={()=>setDiffOpen(v=>!v)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",userSelect:"none"}}>
                <div style={{fontWeight:600,fontSize:16,color:"#3a2e22"}}>{playerLang==="en"?"Differences from Shogi":"将棋との違い"}</div>
                <span style={{color:"#a89070",fontSize:16}}>{diffOpen?"▲":"▼"}</span>
              </div>
              {diffOpen && (playerLang==="en"?CHESS_VS_SHOGI_EN:CHESS_VS_SHOGI_JA).map((tx,i)=>(
                <div key={i} style={{display:"flex",gap:6,marginBottom:5,fontSize:16,color:"#5a3c18",lineHeight:1.5,alignItems:"flex-start",textAlign:"left",marginTop:i===0?8:0}}>
                  <span style={{flexShrink:0,color:"#c4a058",fontWeight:"bold"}}>•</span><span>{tx}</span>
                </div>
              ))}
            </div>
          </div>
          {chessAnnouncementEl}
          {chessVictoryModalEl}
          {tacticsResultModalEl}
          {tacticsDiffSelectModal}
          {strategyOpen && (
            <StrategyModal theme={strategyOpen} playerLang={playerLang} serif={serif} onClose={()=>setStrategyOpen(null)}
              onPractice={(theme)=>{
                setStrategyOpen(null);
                setTacticsTheme(theme.tacticTheme);
                setTacticsDiff(null);
                setTacticsMovesFilter(null);
                setVsAI(false);
                setTacticsMode(true);
              }}
            />
          )}
          {endgameOpen && (
            <StrategyModal theme={endgameOpen} playerLang={playerLang} serif={serif} onClose={()=>setEndgameOpen(null)}
              onPractice={(theme)=>{
                setEndgameOpen(null);
                setTacticsTheme(theme.tacticTheme);
                setTacticsDiff(null);
                setTacticsMovesFilter(null);
                setVsAI(false);
                setTacticsMode(true);
              }}
            />
          )}
        </>
      );
    }
    return (
      <>
        <div style={{display:"flex",gap:16,alignItems:"flex-start",padding:"12px 16px",width:"100%",boxSizing:"border-box"}}>
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
            {tacticsMode && tacticsHeaderEl}
            <ChessCapRow capColor="b"/>
            {boardEl}
            <ChessCapRow capColor="w"/>
            {tacticsMode && tacticsControlsEl}
            <div style={{display:"flex",flexDirection:"column",gap:5,alignItems:"stretch",width:"100%"}}>
              {!tacticsMode && <><AIControlBar vsAI={vsAI} setVsAI={setVsAI} aiLevel={aiLevel} setAiLevel={setAiLevel} aiColor={aiColor} setAiColor={handleChessSetAiColor} aiThinking={aiThinking} playerLang={playerLang} gameType="chess" serif={serif} onToggle={handleToggleVsAI} onAnalyze={handleAnalyzeGame} canAnalyze={practiceGameHistory.length>0}/>
              {chessRulesToggleEl}</>}
              {tacticsBtn}
              <button onClick={()=>setFullScreen(true)} style={{background:"transparent",border:"1px solid #c8b090",borderRadius:8,color:"#7a5838",padding:"5px 16px",cursor:"pointer",fontSize:17,fontFamily:serif}}>
                ⛶ {playerLang==="en"?"Full Screen":"全画面"}
              </button>
              {!tacticsMode && <div style={{display:"flex",gap:6}}>
                <button onClick={handleChessUndo} disabled={moveHistory.length===0} style={{flex:1,background:moveHistory.length===0?"rgba(200,176,144,0.15)":"transparent",border:"1px solid #c8b090",borderRadius:8,color:moveHistory.length===0?"#c8b090":"#7a5838",padding:"5px 0",cursor:moveHistory.length===0?"default":"pointer",fontSize:17,fontFamily:serif}}>
                  ↩ {playerLang==="en"?"Undo":"1手戻す"}
                </button>
                <button onClick={resetChess} style={{flex:1,background:"transparent",border:"1px solid #c8b090",borderRadius:8,color:"#7a5838",padding:"5px 0",cursor:"pointer",fontSize:17,fontFamily:serif}}>
                  {playerLang==="en"?"Reset":"配置をリセット"}
                </button>
              </div>}
            </div>
          </div>
          <div style={{width:240,flexShrink:0,background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"12px 14px",boxSizing:"border-box"}}>
            {rulesPanel}
          </div>
        </div>
        {chessAnnouncementEl}
        {chessVictoryModalEl}
        {tacticsResultModalEl}
        {tacticsDiffSelectModal}
        {strategyOpen && (
          <StrategyModal theme={strategyOpen} playerLang={playerLang} serif={serif} onClose={()=>setStrategyOpen(null)}
            onPractice={(theme)=>{
              setStrategyOpen(null);
              setTacticsTheme(theme.tacticTheme);
              setTacticsDiff(null);
              setTacticsMovesFilter(null);
              setVsAI(false);
              setTacticsMode(true);
            }}
          />
        )}
      </>
    );
  }
  // モバイル：駒ガイドは盤面下に残す
  return (
    <>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12,padding:"12px 8px",width:"100%",boxSizing:"border-box",fontFamily:serif}}>
        {tacticsMode && tacticsHeaderEl}
        <ChessCapRow capColor="b"/>
        {boardEl}
        <ChessCapRow capColor="w"/>
        {tacticsMode && tacticsControlsEl}
        <div style={{display:"flex",flexDirection:"column",gap:6,alignItems:"stretch",marginTop:4,width:"100%",paddingLeft:8,paddingRight:8,boxSizing:"border-box"}}>
          {!tacticsMode && <><AIControlBar vsAI={vsAI} setVsAI={setVsAI} aiLevel={aiLevel} setAiLevel={setAiLevel} aiColor={aiColor} setAiColor={handleChessSetAiColor} aiThinking={aiThinking} playerLang={playerLang} gameType="chess" serif={serif} onToggle={handleToggleVsAI} onAnalyze={handleAnalyzeGame} canAnalyze={practiceGameHistory.length>0}/>
          {chessRulesToggleEl}</>}
          {tacticsBtn}
          <button onClick={()=>setFullScreen(true)} style={{background:"transparent",border:"1px solid #c8b090",borderRadius:8,color:"#7a5838",padding:"6px 20px",cursor:"pointer",fontSize:17,fontFamily:serif}}>
            ⛶ {playerLang==="en"?"Full Screen":"全画面"}
          </button>
          {!tacticsMode && <div style={{display:"flex",gap:8}}>
            <button onClick={handleChessUndo} disabled={moveHistory.length===0} style={{flex:1,background:moveHistory.length===0?"rgba(200,176,144,0.15)":"transparent",border:"1px solid #c8b090",borderRadius:8,color:moveHistory.length===0?"#c8b090":"#7a5838",padding:"6px 0",cursor:moveHistory.length===0?"default":"pointer",fontSize:17,fontFamily:serif}}>
              ↩ {playerLang==="en"?"Undo":"1手戻す"}
            </button>
            <button onClick={resetChess} style={{flex:1,background:"transparent",border:"1px solid #c8b090",borderRadius:8,color:"#7a5838",padding:"6px 0",cursor:"pointer",fontSize:17,fontFamily:serif}}>
              {playerLang==="en"?"Reset":"配置をリセット"}
            </button>
          </div>}
        </div>
        {pieceOverviewEl}
        {onOpenOpening && (
          <div style={{width:"100%",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 12px",boxSizing:"border-box"}}>
            <div style={{fontSize:14,letterSpacing:"1.5px",color:"#a89070",textTransform:"uppercase",marginBottom:5,fontFamily:serif}}>{playerLang==="en"?"Openings":"定石"}</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {CHESS_OPENINGS.map(o=>(
                <button key={o.id} onClick={()=>onOpenOpening(o,"chess")}
                  style={{background:"#fdf6e8",border:"1px solid #c8b090",borderRadius:14,color:"#5a3e28",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}>
                  {playerLang==="en"?o.nameEn:o.nameJa}
                </button>
              ))}
            </div>
          </div>
        )}
        {onOpenTactic && (
          <div style={{width:"100%",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 12px",boxSizing:"border-box"}}>
            <div style={{fontSize:14,letterSpacing:"1.5px",color:"#a89070",textTransform:"uppercase",marginBottom:5,fontFamily:serif}}>{playerLang==="en"?"Tactics":"タクティクス"}</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {CHESS_TACTICS.filter(tt=>tt.direct).map(tt=>(
                <button key={tt.id} onClick={()=>onOpenTactic(tt,"chess")}
                  style={{background:"#fdf6e8",border:"1px solid #c8b090",borderRadius:14,color:"#5a3e28",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}>
                  {playerLang==="en"?tt.nameEn:tt.nameJa}
                </button>
              ))}
              <button onClick={()=>{ const first=CHESS_TACTICS.find(tt=>!tt.direct); if(first) onOpenTactic(first,"chess"); }}
                style={{background:"transparent",border:"1px solid #c8b090",borderRadius:14,color:"#7a5838",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}>
                {playerLang==="en"?"More ▸":"もっと見る ▸"}
              </button>
            </div>
          </div>
        )}
        {/* Strategy section (chess mobile) */}
        <div style={{width:"100%",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 12px",boxSizing:"border-box"}}>
          <div style={{fontSize:14,letterSpacing:"1.5px",color:"#a89070",textTransform:"uppercase",marginBottom:5,fontFamily:serif}}>{playerLang==="en"?"Strategy":"ストラテジー"}</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
            {(strategyShowAll ? CHESS_STRATEGY : CHESS_STRATEGY.filter(s=>CHESS_STRATEGY_FEATURED.includes(s.id))).map(s=>(
              <button key={s.id} onClick={()=>setStrategyOpen(s)}
                style={{background:"#fdf6e8",border:"1px solid #c8b090",borderRadius:14,color:"#5a3e28",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}>
                {playerLang==="en"?s.nameEn:s.nameJa}
              </button>
            ))}
            {!strategyShowAll && CHESS_STRATEGY.length > CHESS_STRATEGY_FEATURED.length && (
              <button onClick={()=>setStrategyShowAll(true)}
                style={{background:"transparent",border:"1px solid #c8b090",borderRadius:14,color:"#7a5838",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}>
                {playerLang==="en"?"More ▸":"もっと見る ▸"}
              </button>
            )}
          </div>
        </div>
        {/* Endgame section (chess mobile) */}
        <div style={{width:"100%",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 12px",boxSizing:"border-box"}}>
          <div style={{fontSize:14,letterSpacing:"1.5px",color:"#a89070",textTransform:"uppercase",marginBottom:5,fontFamily:serif}}>{playerLang==="en"?"Endgame":"エンドゲーム"}</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
            {(endgameShowAll ? CHESS_ENDGAME : CHESS_ENDGAME.filter(s=>CHESS_ENDGAME_FEATURED.includes(s.id))).map(s=>(
              <button key={s.id} onClick={()=>setEndgameOpen(s)}
                style={{background:"#fdf6e8",border:"1px solid #c8b090",borderRadius:14,color:"#5a3e28",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}>
                {playerLang==="en"?s.nameEn:s.nameJa}
              </button>
            ))}
            {!endgameShowAll && CHESS_ENDGAME.length > CHESS_ENDGAME_FEATURED.length && (
              <button onClick={()=>setEndgameShowAll(true)}
                style={{background:"transparent",border:"1px solid #c8b090",borderRadius:14,color:"#7a5838",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}>
                {playerLang==="en"?"More ▸":"もっと見る ▸"}
              </button>
            )}
          </div>
        </div>
        {chessFormationsEl}
        <FormationModal modal={formationModal} setModal={setFormationModal} playerLang={playerLang} getShogiImg={null}/>
      </div>
      {chessAnnouncementEl}
      {chessVictoryModalEl}
      {tacticsResultModalEl}
      {tacticsDiffSelectModal}
      {strategyOpen && (
        <StrategyModal
          theme={strategyOpen}
          playerLang={playerLang}
          serif={serif}
          onClose={()=>setStrategyOpen(null)}
          onPractice={(theme)=>{
            setStrategyOpen(null);
            setTacticsTheme(theme.tacticTheme);
            setTacticsDiff(null);
            setTacticsMovesFilter(null);
            setVsAI(false);
            setTacticsMode(true);
          }}
        />
      )}
      {endgameOpen && (
        <StrategyModal
          theme={endgameOpen}
          playerLang={playerLang}
          serif={serif}
          onClose={()=>setEndgameOpen(null)}
          onPractice={(theme)=>{
            setEndgameOpen(null);
            setTacticsTheme(theme.tacticTheme);
            setTacticsDiff(null);
            setTacticsMovesFilter(null);
            setVsAI(false);
            setTacticsMode(true);
          }}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
//  駒の動き確認ページ ─ 将棋
// ═══════════════════════════════════════════════════════════════
function mkShogiPracticeBoard() {
  // Standard starting position (same as actual game)
  const E=null, b=(t)=>({color:"b",type:t,p:false}), w=(t)=>({color:"w",type:t,p:false});
  return [
    [w("L"),w("N"),w("S"),w("G"),w("K"),w("G"),w("S"),w("N"),w("L")],
    [E,     w("R"),E,    E,    E,    E,    E,    w("B"),E    ],
    [w("P"),w("P"),w("P"),w("P"),w("P"),w("P"),w("P"),w("P"),w("P")],
    [E,E,E,E,E,E,E,E,E],[E,E,E,E,E,E,E,E,E],[E,E,E,E,E,E,E,E,E],
    [b("P"),b("P"),b("P"),b("P"),b("P"),b("P"),b("P"),b("P"),b("P")],
    [E,     b("B"),E,    E,    E,    E,    E,    b("R"),E    ],
    [b("L"),b("N"),b("S"),b("G"),b("K"),b("G"),b("S"),b("N"),b("L")],
  ];
}

const SHOGI_FORBIDDEN_JA = [
  {title:"打ち歩詰め禁止", desc:"歩を打って相手の王将を即詰みにすることはできない。"},
  {title:"二歩禁止", desc:"同じ縦列に自分の歩を2枚置くことはできない。"},
  {title:"行き所のない駒", desc:"動けない場所（盤の端）に駒を打つことはできない。桂馬は最低2段、香車・歩は最低1段空けて打つ必要がある。"},
  {title:"千日手", desc:"同じ局面が4回繰り返されると引き分け（千日手）になる。"},
  {title:"持将棋", desc:"双方の玉が敵陣に入り、対局継続が不能な場合は点数計算（駒の点数の合計が24点以上で勝ち）。"},
];

const SHOGI_FORBIDDEN_EN = [
  {title:"No Pawn Drop Checkmate", desc:"Cannot drop a pawn to immediately checkmate the opponent's king."},
  {title:"No Two Pawns", desc:"Cannot have two of your own pawns in the same column."},
  {title:"No Dead Ends", desc:"Cannot place pieces where they have no legal moves. Knights need 2+ rows, lances/pawns need 1+ row from the back."},
  {title:"Repetition Draw", desc:"If the same position repeats 4 times, the game is a draw."},
  {title:"Impasse", desc:"If both kings enter the opponent's territory, the game is decided by piece count (24+ points wins)."},
];

function ShogiPracticeBoard({playerLang, pcLayout, hideRules=false, playerName="", onAnalyze, startInFullScreen=false, onSwitchToGame, onFsConsumed, onOpenOpening, onOpenTactic}) {
  const boardKey = `shogiPracticeBoard_${playerName}`;
  const capKey = `shogiPracticeCapPieces_${playerName}`;
  const [board, setBoard] = useState(()=>{
    try { const s=localStorage.getItem(boardKey); if(s) return JSON.parse(s); } catch{}
    return mkShogiPracticeBoard();
  });
  const [sel, setSel] = useState(null);
  const [legal, setLegal] = useState([]);
  const [cap, setCap] = useState(()=>{
    try { const s=localStorage.getItem(capKey); if(s) return JSON.parse(s); } catch{}
    return {b:{},w:{}};
  });
  const [dropSel, setDropSel] = useState(null);
  const [shogiMoveHistory, setShogiMoveHistory] = useState([]);
  const [practiceGameHistory, setPracticeGameHistory] = useState([]);
  const [vsAI, setVsAI] = useState(false);
  const [aiLevel, setAiLevel] = useState(3);
  const [aiColor, setAiColor] = useState("w"); // AI plays gote by default, user plays sente
  const [aiThinking, setAiThinking] = useState(false);
  const [shogiTurn, setShogiTurn] = useState("b");
  // Tactics mode (shogi)
  const [tacticsModeS, setTacticsModeS] = useState(false);
  const [tacticsDiffS, setTacticsDiffS] = useState(null);
  const [tacticsPuzzlesS, setTacticsPuzzlesS] = useState([]);
  const [tacticsIdxS, setTacticsIdxS] = useState(0);
  const [tacticsResultS, setTacticsResultS] = useState(null);
  const [tacticsHintUsedS, setTacticsHintUsedS] = useState(false);
  const [tacticsShowAnswerS, setTacticsShowAnswerS] = useState(false);
  const [tacticsDiffSelectS, setTacticsDiffSelectS] = useState(false);
  const [tacticsMoveFilterS, setTacticsMoveFilterS] = useState(null); // null=all | 1 | 3 | 5 (手詰め数)
  const [tacticsAttemptS, setTacticsAttemptS] = useState(0);
  const [tacticsLoadingS, setTacticsLoadingS] = useState(false);
  const [tacticsErrorS, setTacticsErrorS] = useState(null);
  const [tacticsSolStepS, setTacticsSolStepS] = useState(0); // 多手詰み用: 現在の解答ステップ
  const [lastMoveSh, setLastMoveSh] = useState(null); // {from:[r,c], to:[r,c]} or {drop:true, to:[r,c]}
  const [checkAnnouncementSh, setCheckAnnouncementSh] = useState(null);
  const [victoryModalSh, setVictoryModalSh] = useState(null);
  const shogiWorkerRef = useRef(null);
  const oppMoveStateRef = useRef(null); // 多手詰み用: 相手の自動応手に使うboard/cap
  const shogiRestoreIdxRef = useRef(null); // localStorage復元時のpuzzle index
  // Use refs to avoid stale closures in async AI callbacks
  const vsAIRefSh = useRef(false);
  const aiLevelRefSh = useRef(3);
  useEffect(()=>{ vsAIRefSh.current=vsAI; },[vsAI]);
  useEffect(()=>{ aiLevelRefSh.current=aiLevel; },[aiLevel]);
  const [formationModal, setFormationModal] = useState(null);
  const [showAllFormations, setShowAllFormations] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [forbidOpen, setForbidOpen] = useState(false);
  const [shogiGuideOpen, setShogiGuideOpen] = useState(false);
  // Strategy modal
  const [strategyOpenS, setStrategyOpenS] = useState(null);
  const [strategyShowAllS, setStrategyShowAllS] = useState(false);
  // Endgame modal
  const [endgameOpenS, setEndgameOpenS] = useState(null);
  const [endgameShowAllS, setEndgameShowAllS] = useState(false);
  const serif = "'Cormorant Garamond','Zen Old Mincho',Georgia,serif";
  const [fullScreen, setFullScreen] = useState(startInFullScreen||false);
  useEffect(()=>{ if(startInFullScreen && onFsConsumed) onFsConsumed(); },[]);// eslint-disable-line react-hooks/exhaustive-deps
  const [fsAreaW, setFsAreaW] = useState(0);
  const [fsAreaH, setFsAreaH] = useState(0);
  const fsAreaRefCb = useCallback((node) => {
    if (!node) return;
    const ro = new ResizeObserver(([entry]) => {
      setFsAreaW(Math.floor(entry.contentRect.width));
      setFsAreaH(Math.floor(entry.contentRect.height));
    });
    ro.observe(node);
  }, []);
  const cellSizeNormal = pcLayout
    ? Math.min(57, Math.floor((Math.min(window.innerWidth - 460, 536) - 8) / 9))
    : Math.round((Math.min(window.innerWidth*0.98, 560)-59)/9);
  // FS時: 盤面(9cs+33px) + 持ち駒行(最大2行: 1.7cs+20)×2 = 12.4cs+73 → 余裕を見て78
  const cellSize = (fullScreen && fsAreaW > 0 && fsAreaH > 0)
    ? Math.max(16, Math.floor(Math.min((fsAreaW - 44) / 9, (fsAreaH - 78) / 12.4)))
    : cellSizeNormal;
  const font = "'Zen Old Mincho','Noto Serif JP',serif";
  useEffect(()=>{ try{localStorage.setItem(boardKey,JSON.stringify(board));}catch{} },[board,boardKey]);
  useEffect(()=>{ try{localStorage.setItem(capKey,JSON.stringify(cap));}catch{} },[cap,capKey]);

  useEffect(()=>()=>{
    if(shogiWorkerRef.current){ shogiWorkerRef.current.terminate(); shogiWorkerRef.current=null; }
  },[]);

  const triggerShogiAI = useCallback(async (bd, cp, tn) => {
    setAiThinking(true);
    if(shogiWorkerRef.current){ shogiWorkerRef.current.terminate(); }
    const w = new Worker(new URL('./shogiAIWorker.js', import.meta.url), {type:'module'});
    shogiWorkerRef.current = w;
    const move = await new Promise(resolve => {
      w.onmessage = (e) => resolve(e.data.move);
      w.onerror = () => resolve(null);
      w.postMessage({board:bd, cap:cp, color:tn, level:aiLevelRefSh.current});
    });
    shogiWorkerRef.current = null;
    w.terminate();
    if(!move){ setAiThinking(false); return; }
    // If we switched to tactics mode while AI was computing, discard the move
    if(!vsAIRefSh.current){ setAiThinking(false); return; }
    setShogiMoveHistory(prev=>[...prev,{board:bd.map(row=>row.map(p=>p?{...p}:null)),cap:{b:{...cp.b},w:{...cp.w}}}]);
    if(move.type==='drop'){
      setPracticeGameHistory(prev=>[...prev,{drop:move.pType,to:[move.r,move.c]}]);
      setLastMoveSh({drop:true,to:[move.r,move.c]});
    } else {
      setPracticeGameHistory(prev=>[...prev,{from:[move.fr,move.fc],to:[move.tr,move.tc],promote:!!move.promote}]);
      setLastMoveSh({from:[move.fr,move.fc],to:[move.tr,move.tc]});
    }
    let finalBoard;
    if(move.type==='drop'){
      const nb=bd.map(row=>[...row]);
      nb[move.r][move.c]={color:tn,type:move.pType,p:false};
      setCap(prev=>{
        const cnt=(prev[tn][move.pType]||0)-1;
        const m={...prev[tn]};
        if(cnt<=0) delete m[move.pType]; else m[move.pType]=cnt;
        return {...prev,[tn]:m};
      });
      setBoard(nb);
      finalBoard=nb;
    } else {
      const nb=bd.map(row=>[...row]);
      const piece={...nb[move.fr][move.fc]};
      if(nb[move.tr][move.tc]){
        const capType=nb[move.tr][move.tc].type;
        setCap(prev=>({...prev,[tn]:{...prev[tn],[capType]:(prev[tn][capType]||0)+1}}));
      }
      if(move.promote) piece.p=true;
      nb[move.tr][move.tc]=piece; nb[move.fr][move.fc]=null;
      setBoard(nb);
      finalBoard=nb;
    }
    const next=tn==='b'?'w':'b';
    setShogiTurn(next);
    setDropSel(null); setSel(null); setLegal([]);
    setAiThinking(false);
    // Check if player's king is in check after AI move
    if(finalBoard) {
      const playerKingColor=next;
      const oppColor=playerKingColor==='b'?'w':'b';
      let kr=-1,kc=-1;
      for(let r=0;r<9;r++) for(let c=0;c<9;c++) if(finalBoard[r]?.[c]?.type==='K'&&finalBoard[r][c].color===playerKingColor){kr=r;kc=c;}
      if(kr>=0){
        // Check if any opponent piece can attack the king square
        let inCheck=false;
        for(let r=0;r<9&&!inCheck;r++){
          for(let c=0;c<9&&!inCheck;c++){
            if(finalBoard[r]?.[c]?.color===oppColor){
              const moves=sShogiMoves(finalBoard,r,c);
              if(moves.some(([mr,mc])=>mr===kr&&mc===kc)) inCheck=true;
            }
          }
        }
        if(inCheck){
          setCheckAnnouncementSh("王手！/ Check!");
          setTimeout(()=>setCheckAnnouncementSh(null),2500);
        }
      }
    }
  },[]);

  const handleToggleShogiVsAI = useCallback(()=>{
    const next=!vsAI;
    setVsAI(next);
    if(next){
      const initBoard=mkShogiPracticeBoard();
      const initCap={b:{},w:{}};
      setBoard(initBoard); setCap(initCap); setShogiTurn("b");
      setShogiMoveHistory([]); setPracticeGameHistory([]);
      setDropSel(null); setSel(null); setLegal([]); setAiThinking(false);
      try { localStorage.setItem(boardKey,JSON.stringify(initBoard)); localStorage.setItem(capKey,JSON.stringify(initCap)); } catch {}
      if(aiColor==="b"){
        triggerShogiAI(initBoard, initCap, "b");
      }
    }
  },[vsAI,aiColor,boardKey,capKey,triggerShogiAI]);

  const handleShogiSetAiColor = useCallback((color)=>{
    setAiColor(color);
    if(vsAI && shogiTurn===color){
      triggerShogiAI(board, cap, shogiTurn);
    }
  },[vsAI,shogiTurn,board,cap,triggerShogiAI]);

  const handleAnalyzeGame = useCallback(()=>{
    if(!onAnalyze||!practiceGameHistory.length) return;
    const players=aiColor==="w"?{black:playerName,white:"AI"}:{black:"AI",white:playerName};
    onAnalyze({id:`practice_shogi_${Date.now()}`,history:practiceGameHistory,players,aiLevel,status:"practice"},"shogi");
  },[onAnalyze,aiColor,playerName,practiceGameHistory,aiLevel]);

  const _shogiLoadedRef2 = useRef(new Set());
  const [_shogiLoadedVer2, _setShogiLoadedVer2] = useState(0);
  const _markLoaded2 = useCallback((src)=>{
    if(src && !_shogiLoadedRef2.current.has(src)){
      _shogiLoadedRef2.current.add(src);
      _setShogiLoadedVer2(v=>v+1);
    }
  },[]);

  const calcShogiLegal = (bd, r, c) => {
    return sShogiMoves(bd, r, c);
  };

  const handleClick = (r, c) => {
    if (aiThinking) return;
    // Shogi tactics mode check
    if (tacticsModeS) {
      if (tacticsResultS) return;
      if (tacticsSolStepS % 2 === 1) return; // 相手の応手アニメーション中は入力ブロック
      const tacPuzzle = tacticsPuzzlesS[tacticsIdxS];
      if (!tacPuzzle) return;
      const sol = tacPuzzle.solution?.[tacticsSolStepS]; // 現在のステップの正解手
      // Handle drop in hand: handled in onHandClick; here handle board moves
      if (dropSel) {
        const isLegal = legal.some(([lr,lc])=>lr===r&&lc===c);
        if (isLegal) {
          const isCorrect = sol && sol.drop && sol.drop===dropSel.type && sol.to[0]===r && sol.to[1]===c;
          const newAtt = tacticsAttemptS + 1; setTacticsAttemptS(newAtt);
          if (isCorrect) {
            const nb = board.map(row=>[...row]);
            nb[r][c] = {color:dropSel.color, type:dropSel.type, p:false};
            const newCap = {b:{...cap.b},w:{...cap.w}};
            const cnt = (newCap[dropSel.color][dropSel.type]||0)-1;
            if(cnt<=0) delete newCap[dropSel.color][dropSel.type]; else newCap[dropSel.color][dropSel.type]=cnt;
            setCap(newCap);
            setBoard(nb); setDropSel(null); setSel(null); setLegal([]);
            setLastMoveSh({drop:true,to:[r,c]});
            const isLastStep = tacticsSolStepS >= tacPuzzle.solution.length - 1;
            if (isLastStep) {
              setTacticsResultS('correct');
              saveShogiTacticsFb(tacPuzzle,'correct',tacticsHintUsedS,newAtt);
            } else {
              oppMoveStateRef.current = {board: nb, cap: newCap};
              setTacticsSolStepS(prev => prev + 1);
            }
            return;
          } else {
            setDropSel(null); setLegal([]);
            setTacticsResultS('incorrect');
            return;
          }
        }
        // Not a legal drop square — clear hand selection and fall through to board piece selection
        setDropSel(null); setLegal([]);
      }
      if (sel) {
        const isLegal = legal.some(([lr,lc])=>lr===r&&lc===c);
        if (isLegal) {
          const isCorrect = sol && sol.from && sol.from[0]===sel.r && sol.from[1]===sel.c && sol.to[0]===r && sol.to[1]===c;
          const newAtt = tacticsAttemptS + 1; setTacticsAttemptS(newAtt);
          if (isCorrect) {
            const nb = board.map(row=>[...row]);
            const movingPiece = board[sel.r][sel.c];
            if (!movingPiece) { setSel(null); setLegal([]); return; } // null guard
            const newCap = {b:{...cap.b},w:{...cap.w}};
            if (board[r][c]) {
              const capType = board[r][c].type;
              newCap[movingPiece.color][capType] = (newCap[movingPiece.color][capType]||0)+1;
            }
            const shouldPromote = sol.promote || (!movingPiece.p && movingPiece.type!=="K" && movingPiece.type!=="G" &&
              ((movingPiece.color==="b" && r<=2)||(movingPiece.color==="w" && r>=6)));
            nb[r][c] = shouldPromote ? {...movingPiece, p:true} : {...movingPiece};
            nb[sel.r][sel.c] = null;
            setCap(newCap); setBoard(nb); setSel(null); setLegal([]);
            setLastMoveSh({from:[sel.r,sel.c],to:[r,c]});
            const isLastStep = tacticsSolStepS >= tacPuzzle.solution.length - 1;
            if (isLastStep) {
              setTacticsResultS('correct');
              saveShogiTacticsFb(tacPuzzle,'correct',tacticsHintUsedS,newAtt);
            } else {
              oppMoveStateRef.current = {board: nb, cap: newCap};
              setTacticsSolStepS(prev => prev + 1);
            }
          } else {
            setSel(null); setLegal([]);
            setTacticsResultS('incorrect');
          }
          return;
        }
        setSel(null); setLegal([]);
      }
      const piece = board[r]?.[c];
      if (piece && piece.color === shogiTurn) {
        setSel({r,c}); setDropSel(null); setLegal(calcShogiLegal(board,r,c));
      } else { setSel(null); setDropSel(null); setLegal([]); }
      return;
    }
    const playerColor = vsAI ? (aiColor==="b"?"w":"b") : null;
    // In AI mode, block moves when it's the AI's turn
    if (vsAI && shogiTurn === aiColor) { setSel(null); setDropSel(null); setLegal([]); return; }
    if (dropSel) {
      if (vsAI && dropSel.color !== playerColor) { setDropSel(null); setLegal([]); return; }
      const isLegal = legal.some(([lr,lc])=>lr===r&&lc===c);
      if (isLegal) {
        setShogiMoveHistory(prev => [...prev, {board: board.map(row=>row.map(p=>p?{...p}:null)), cap: {b:{...cap.b},w:{...cap.w}}}]);
        setPracticeGameHistory(prev=>[...prev,{drop:dropSel.type,to:[r,c]}]);
        const nb = board.map(row=>[...row]);
        nb[r][c] = {color:dropSel.color, type:dropSel.type, p:false};
        const newCap = {b:{...cap.b},w:{...cap.w}};
        const cnt = (newCap[dropSel.color][dropSel.type]||0)-1;
        if(cnt<=0) delete newCap[dropSel.color][dropSel.type]; else newCap[dropSel.color][dropSel.type]=cnt;
        setCap(newCap);
        setBoard(nb); setDropSel(null); setSel(null); setLegal([]);
        setLastMoveSh({drop:true,to:[r,c]});
        const next=dropSel.color==='b'?'w':'b'; setShogiTurn(next);
        if(vsAI && next===aiColor) triggerShogiAI(nb,newCap,next);
        return;
      }
      setDropSel(null); setLegal([]);
    }
    if (sel) {
      const isLegal = legal.some(([lr,lc])=>lr===r&&lc===c);
      if (isLegal) {
        setShogiMoveHistory(prev => [...prev, {board: board.map(row=>row.map(p=>p?{...p}:null)), cap: {b:{...cap.b},w:{...cap.w}}}]);
        const nb = board.map(row=>[...row]);
        const movingPiece = board[sel.r][sel.c];
        const newCap = {b:{...cap.b},w:{...cap.w}};
        if (board[r][c]) {
          const capType = board[r][c].type;
          newCap[movingPiece.color][capType] = (newCap[movingPiece.color][capType]||0)+1;
        }
        const shouldPromote = !movingPiece.p && movingPiece.type!=="K" && movingPiece.type!=="G" &&
          ((movingPiece.color==="b" && r<=2)||(movingPiece.color==="w" && r>=6));
        nb[r][c] = shouldPromote ? {...movingPiece, p:true} : movingPiece;
        nb[sel.r][sel.c] = null;
        setPracticeGameHistory(prev=>[...prev,{from:[sel.r,sel.c],to:[r,c],promote:!!shouldPromote}]);
        setCap(newCap);
        setLastMoveSh({from:[sel.r,sel.c],to:[r,c]});
        setBoard(nb); setSel(null); setLegal([]);
        const next=movingPiece.color==='b'?'w':'b'; setShogiTurn(next);
        if(vsAI && next===aiColor) triggerShogiAI(nb,newCap,next);
        return;
      }
    }
    const piece = board[r]?.[c];
    if (piece && (!vsAI || piece.color===playerColor)) {
      setSel({r,c}); setDropSel(null); setLegal(calcShogiLegal(board,r,c));
    } else {
      setSel(null); setDropSel(null); setLegal([]);
    }
  };

  const onHandClick = (color, type) => {
    if (aiThinking) return;
    if (tacticsModeS && color !== shogiTurn) return;
    if (!tacticsModeS && vsAI && color === aiColor) return;
    if (!(cap[color]?.[type]>0)) return;
    const empties = [];
    for(let r=0;r<9;r++) for(let c=0;c<9;c++) if(!board[r][c]) empties.push([r,c]);
    setSel(null); setDropSel({color,type}); setLegal(empties);
  };

  const handleShogiUndo = () => {
    if (shogiMoveHistory.length === 0) return;
    const last = shogiMoveHistory[shogiMoveHistory.length - 1];
    setBoard(last.board);
    setCap(last.cap);
    setSel(null); setDropSel(null); setLegal([]);
    setShogiMoveHistory(prev => prev.slice(0, -1));
    setPracticeGameHistory(prev => prev.slice(0, -1));
  };

  const resetShogi = useCallback(() => {
    if(shogiWorkerRef.current){ shogiWorkerRef.current.terminate(); shogiWorkerRef.current=null; }
    const b = mkShogiPracticeBoard();
    setBoard(b);
    setCap({b:{},w:{}});
    setDropSel(null); setSel(null); setLegal([]);
    setShogiMoveHistory([]);
    setPracticeGameHistory([]);
    setShogiTurn("b");
    setVsAI(false);
    setAiThinking(false);
    try {
      localStorage.setItem(boardKey,JSON.stringify(b));
      localStorage.setItem(capKey,JSON.stringify({b:{},w:{}}));
    } catch {}
  }, []);

  // ── Shogi Tactics helpers ──────────────────────────────────────
  const loadShogiTacticsPuzzle = useCallback((puzzle) => {
    if (!puzzle) return;
    console.log('[ShogiTactics] puzzle id:', puzzle.id, '| mate:', puzzle.mate, '| moves:', puzzle.moves, '| solution count:', puzzle.solution?.length);
    const bd = puzzle.board.map(row => row.map(cell => cell ? {type:cell.t, color:cell.c, p:cell.p||false} : null));
    setBoard(bd);
    const handB = {}; const handW = {};
    if (puzzle.hand?.b) Object.assign(handB, puzzle.hand.b);
    if (puzzle.hand?.w) Object.assign(handW, puzzle.hand.w);
    setCap({b:handB, w:handW});
    setDropSel(null); setSel(null); setLegal([]);
    setShogiMoveHistory([]);
    setPracticeGameHistory([]);
    setShogiTurn(puzzle.turn ?? 'b');
    setLastMoveSh(null);
    setTacticsResultS(null);
    setTacticsHintUsedS(false);
    setTacticsShowAnswerS(false);
    setTacticsAttemptS(0);
    setTacticsSolStepS(0);
    oppMoveStateRef.current = null;
  }, []);

  // Restore shogi tactics session from localStorage on mount
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('shogi_tactics_session'));
      if (saved && saved.idxS != null) {
        shogiRestoreIdxRef.current = saved.idxS;
        setTacticsDiffS(saved.diffS ?? null);
        setTacticsMoveFilterS(saved.moveFilterS ?? null);
        setTacticsModeS(true);
      }
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Save shogi tactics session to localStorage whenever state changes
  useEffect(() => {
    if (!tacticsModeS || !tacticsPuzzlesS.length) return;
    try {
      localStorage.setItem('shogi_tactics_session', JSON.stringify({
        diffS: tacticsDiffS, moveFilterS: tacticsMoveFilterS, idxS: tacticsIdxS,
      }));
    } catch {}
  }, [tacticsModeS, tacticsDiffS, tacticsMoveFilterS, tacticsPuzzlesS, tacticsIdxS]);

  useEffect(() => {
    if (!tacticsModeS) return;
    setTacticsLoadingS(true);
    setTacticsErrorS(null);
    setTacticsPuzzlesS([]);
    setTacticsIdxS(0);
    // tacticsMoveFilterS takes priority over tacticsDiffS for file selection
    // mate:1→easy, mate:3→normal, mate:5→hard
    const _shogiFiles = (() => {
      if (tacticsMoveFilterS === 1) return ['/puzzles/shogi/easy.json'];
      if (tacticsMoveFilterS === 3) return ['/puzzles/shogi/normal.json'];
      if (tacticsMoveFilterS === 5) return ['/puzzles/shogi/hard.json'];
      // Fall back to difficulty filter
      if (tacticsDiffS === 'Easy')   return ['/puzzles/shogi/easy.json'];
      if (tacticsDiffS === 'Normal') return ['/puzzles/shogi/normal.json'];
      if (tacticsDiffS === 'Hard')   return ['/puzzles/shogi/hard.json'];
      return ['/puzzles/shogi/easy.json','/puzzles/shogi/normal.json','/puzzles/shogi/hard.json'];
    })();
    Promise.all(_shogiFiles.map(f => fetch(f).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })))
      .then(arrays => {
        let data = arrays.flat();
        if (data.length === 0) throw new Error(playerLang === 'en' ? 'No puzzles found.' : 'この条件の問題が見つかりません。');
        // Shuffle puzzles for random order
        const list = [...data];
        for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
        setTacticsPuzzlesS(list);
        // Restore saved puzzle index if coming back from a session
        const restoreIdx = shogiRestoreIdxRef.current;
        if (restoreIdx !== null) {
          setTacticsIdxS(Math.min(restoreIdx, list.length - 1));
          shogiRestoreIdxRef.current = null;
        } else {
          setTacticsIdxS(0);
        }
        setTacticsLoadingS(false);
      })
      .catch(err => { setTacticsLoadingS(false); setTacticsErrorS(err.message); });
  }, [tacticsModeS, tacticsDiffS, tacticsMoveFilterS, playerLang]);

  useEffect(() => {
    if (!tacticsModeS || !tacticsPuzzlesS.length) return;
    loadShogiTacticsPuzzle(tacticsPuzzlesS[tacticsIdxS]);
  }, [tacticsModeS, tacticsPuzzlesS, tacticsIdxS, loadShogiTacticsPuzzle]);

  // 多手詰み用: 相手の自動応手 (奇数ステップ = 相手番)
  useEffect(() => {
    if (!tacticsModeS || tacticsSolStepS % 2 !== 1 || tacticsResultS) return;
    const tacPuzzle = tacticsPuzzlesS[tacticsIdxS];
    if (!tacPuzzle?.solution?.[tacticsSolStepS]) return;
    const oppSol = tacPuzzle.solution[tacticsSolStepS];
    const savedState = oppMoveStateRef.current;
    if (!savedState) return;
    const step = tacticsSolStepS;
    const timer = setTimeout(() => {
      const { board: prevBd, cap: prevCap } = savedState;
      let nb, newCap;
      if (oppSol.drop) {
        nb = prevBd.map(row => [...row]);
        nb[oppSol.to[0]][oppSol.to[1]] = { color: 'w', type: oppSol.drop, p: false };
        newCap = { b: { ...prevCap.b }, w: { ...prevCap.w } };
        const cnt = (newCap.w[oppSol.drop] || 0) - 1;
        if (cnt <= 0) delete newCap.w[oppSol.drop]; else newCap.w[oppSol.drop] = cnt;
      } else {
        nb = prevBd.map(row => [...row]);
        const oppPiece = prevBd[oppSol.from[0]]?.[oppSol.from[1]];
        if (!oppPiece) { oppMoveStateRef.current = null; return; }
        newCap = { b: { ...prevCap.b }, w: { ...prevCap.w } };
        if (prevBd[oppSol.to[0]]?.[oppSol.to[1]]) {
          const capType = prevBd[oppSol.to[0]][oppSol.to[1]].type;
          newCap.w[capType] = (newCap.w[capType] || 0) + 1;
        }
        nb[oppSol.to[0]][oppSol.to[1]] = oppSol.promote ? { ...oppPiece, p: true } : { ...oppPiece };
        nb[oppSol.from[0]][oppSol.from[1]] = null;
      }
      setBoard(nb);
      setCap(newCap);
      setLastMoveSh(oppSol.drop ? { drop: true, to: oppSol.to } : { from: oppSol.from, to: oppSol.to });
      oppMoveStateRef.current = null;
      // Reset hint/answer display for the next player turn
      setTacticsHintUsedS(false);
      setTacticsShowAnswerS(false);
      setTacticsSolStepS(step + 1);
    }, 700);
    return () => clearTimeout(timer);
  }, [tacticsModeS, tacticsSolStepS, tacticsPuzzlesS, tacticsIdxS, tacticsResultS]);

  const saveShogiTacticsFb = useCallback(async (puzzle, result, hintUsed, attemptCount) => {
    if (!playerName || !puzzle) return;
    try {
      await set(ref(db, `tactics/${playerName}/${puzzle.id}`), {
        puzzleId: puzzle.id, gameType: 'shogi',
        difficulty: puzzle.difficulty, result, hintUsed, attemptCount,
        solvedAt: new Date().toISOString(),
      });
    } catch(e) { console.warn('shogi tactics save failed:', e); }
  }, [playerName]);

  const ShogiHandArea = ({color}) => {
    const types=["R","B","G","S","N","L","P"];
    const sz = fullScreen ? Math.round(cellSize * 0.85) : Math.min(cellSize-4, 36);
    return (
      <div style={{display:"flex",gap:3,flexWrap:"wrap",minHeight:sz+10,alignItems:"center",justifyContent:"center",padding:"4px 6px",background:"rgba(180,140,80,0.06)",borderRadius:6}}>
        {types.map(t=>{
          const count=cap[color]?.[t]||0; if(!count) return null;
          const isSelDrop=dropSel?.color===color&&dropSel?.type===t;
          const pSrc=getShogiImg({type:t,color,p:false});
          const pLoaded=_shogiLoadedRef2.current.has(pSrc);
          return (
            <div key={t} onClick={()=>onHandClick(color,t)} style={{position:"relative",cursor:"pointer",touchAction:"manipulation"}}>
              <div style={{width:sz,height:sz+2,background:isSelDrop?"rgba(212,168,136,0.5)":"transparent",border:`1px solid ${isSelDrop?"#b88a6a":"transparent"}`,borderRadius:3,position:"relative",filter:isSelDrop?"drop-shadow(0 0 3px rgba(180,100,30,0.7))":"none"}}>
                {!pLoaded&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:Math.floor(sz*0.48),fontFamily:font,fontWeight:700,color:color==="b"?"#1a0e04":"#6a4020"}}>{SK[t]}</div>}
                <img src={pSrc} alt="" draggable={false} style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"contain",display:"block",opacity:pLoaded?1:0}} ref={el=>{if(el&&el.complete&&el.naturalWidth>0)_markLoaded2(pSrc);}} onLoad={()=>_markLoaded2(pSrc)} onError={()=>{}}/>
              </div>
              {count>1&&<span style={{position:"absolute",top:-4,right:-4,background:"#8a5020",color:"#fff",borderRadius:"50%",width:14,height:14,fontSize:8,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:"bold"}}>{count}</span>}
            </div>
          );
        })}
      </div>
    );
  };

  const sz = cellSize-4;
  const boardFlipped = vsAI && aiColor === "b";

  const renderCell = (r, c) => {
    const piece = board[r]?.[c];
    const isSel = sel?.r===r&&sel?.c===c;
    const isLeg = legal.some(([lr,lc])=>lr===r&&lc===c);
    const isLastFrom = lastMoveSh && !lastMoveSh.drop && lastMoveSh.from && lastMoveSh.from[0]===r && lastMoveSh.from[1]===c;
    const isLastTo = lastMoveSh && lastMoveSh.to && lastMoveSh.to[0]===r && lastMoveSh.to[1]===c;
    const tacPzS = tacticsModeS && tacticsPuzzlesS[tacticsIdxS];
    // 多手詰み対応: 現在のプレイヤー手番ステップ（偶数）の解答マスを表示
    const curPlayerStep = tacticsSolStepS % 2 === 0 ? tacticsSolStepS : tacticsSolStepS - 1;
    const curSolS = tacPzS?.solution?.[curPlayerStep];
    const isHintSqS = tacticsModeS && tacticsHintUsedS && !tacticsResultS && tacPzS?.hint && tacPzS.hint[0]===r && tacPzS.hint[1]===c;
    const isAnsSqS = tacticsModeS && tacticsShowAnswerS && curSolS && !curSolS.drop && (
      (curSolS.from?.[0]===r && curSolS.from?.[1]===c) ||
      (curSolS.to[0]===r && curSolS.to[1]===c)
    );
    const pieceRotate = piece
      ? (boardFlipped ? (piece.color==="b" ? "rotate(180deg)" : "none") : (piece.color==="w" ? "rotate(180deg)" : "none"))
      : "none";
    const pSrc = piece ? getShogiImg(piece) : null;
    const pLoaded = pSrc && _shogiLoadedRef2.current.has(pSrc);
    return (
      <div key={`${r}-${c}`} onClick={()=>handleClick(r,c)} style={{
        width:cellSize,height:cellSize,
        background:"#EDE0C8",
        display:"flex",alignItems:"center",justifyContent:"center",
        cursor:"pointer",position:"relative",boxSizing:"border-box",overflow:"hidden",
        touchAction:"manipulation",
      }}>
        {(isLastFrom||isLastTo)&&!isSel&&<div style={{position:"absolute",inset:0,background:"rgba(200,168,106,0.45)",pointerEvents:"none",zIndex:1}}/>}
        {isSel&&<div style={{position:"absolute",inset:0,background:"rgba(100,130,60,0.5)",pointerEvents:"none",zIndex:1}}/>}
        {isLeg&&!piece&&<div style={{width:cellSize*0.28,height:cellSize*0.28,borderRadius:"50%",background:"rgba(180,100,30,0.38)",position:"relative",zIndex:2}}/>}
        {isLeg&&piece&&<div style={{position:"absolute",inset:1,border:"2px solid rgba(200,100,20,0.6)",borderRadius:2,pointerEvents:"none",zIndex:2}}/>}
        {isHintSqS&&<div style={{position:"absolute",inset:0,background:"rgba(100,220,100,0.45)",pointerEvents:"none",zIndex:3}}/>}
        {isAnsSqS&&<div style={{position:"absolute",inset:0,background:"rgba(60,140,255,0.40)",pointerEvents:"none",zIndex:3}}/>}
        {piece&&<div style={{width:sz,height:sz,position:"relative",zIndex:3,transform:pieceRotate,userSelect:"none"}}>
          {!pLoaded&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:piece.p?"#ffe8a0":piece.color==="b"?"#faf0dc":"#f0e8d8",border:`1.5px solid ${piece.color==="b"?"#5a3810":"#9a7040"}`,borderRadius:2,fontSize:Math.floor(sz*0.42),fontFamily:font,fontWeight:700,color:piece.p?"#8a3000":piece.color==="b"?"#1a0e04":"#6a4020",lineHeight:1}}>{piece.p?SKP[piece.type]:SK[piece.type]}</div>}
          <img src={pSrc} alt="" draggable={false} style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"contain",display:"block",opacity:pLoaded?1:0}} ref={el=>{if(el&&el.complete&&el.naturalWidth>0)_markLoaded2(pSrc);}} onLoad={()=>_markLoaded2(pSrc)} onError={()=>{}}/>
        </div>}
      </div>
    );
  };

  const forbidden = playerLang==="en" ? SHOGI_FORBIDDEN_EN : SHOGI_FORBIDDEN_JA;
  const rulesPanel = (
    <div style={{fontFamily:serif, fontSize:18, color:"#3a2e22", width:"100%", maxWidth:520, margin:"0 auto"}}>
      <div style={{fontSize:16, letterSpacing:"2px", color:"#a89070", textTransform:"uppercase", marginBottom:12, textAlign:"center"}}>
        {playerLang==="en" ? "Forbidden Moves" : "反則ルール（できないこと）"}
      </div>
      {forbidden.map((r,i)=>(
        <div key={i} style={{marginBottom:10, padding:"6px 0", borderBottom:"1px solid #e8d8b4"}}>
          <div style={{fontWeight:600, fontSize:18, marginBottom:2, textAlign:"left"}}>{r.title}</div>
          <div style={{fontSize:17, color:"#5a3c18", lineHeight:1.5, textAlign:"left"}}>{r.desc}</div>
        </div>
      ))}
    </div>
  );

  // 将棋駒一覧（モジュールレベルの SHOGI_PIECE_LIST_BASE / SHOGI_PIECE_LIST_PROM / SHOGI_VS_CHESS_JA / SHOGI_VS_CHESS_EN を参照）
  const renderPieceChip = (p) => {
    const src = getShogiImg({type:p.type, color:"b", p:p.p});
    return (
      <div key={`${p.type}-${p.p}`} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"6px 4px",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,minWidth:0}}>
        <img src={src} alt="" style={{width:32,height:32,objectFit:"contain"}}/>
        <div style={{fontSize:16,color:"#3a2e22",fontWeight:600,lineHeight:1.2,textAlign:"center",whiteSpace:"nowrap"}}>{playerLang==="en"?p.nameEn:p.nameJa}</div>
      </div>
    );
  };
  const shogiFormationsEl = (
    <div style={{width:"100%",maxWidth:520,boxSizing:"border-box",fontFamily:serif,background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"10px 14px"}}>
      <div style={{fontWeight:600,fontSize:17,color:"#3a2e22",marginBottom:8}}>
        {playerLang==="en"?"Effective Formations":"効果的な陣形"}
      </div>
      {(showAllFormations?SHOGI_FORMATIONS:SHOGI_FORMATIONS.slice(0,4)).map(f=>(
        <div key={f.id} onClick={()=>setFormationModal({formation:f,gameType:"shogi"})}
          style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,cursor:"pointer",padding:"4px 6px",borderRadius:6,background:"rgba(200,168,106,0.08)"}}>
          <ShogiFormBoard pieces={f.pieces} cellSize={7} getShogiImg={getShogiImg}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontWeight:600,fontSize:15,color:"#3a2e22"}}>{playerLang==="en"?f.nameEn:f.nameJa}</div>
            <div style={{fontSize:16,color:"#7a5828",lineHeight:1.4}}>{playerLang==="en"?f.descEn:f.descJa}</div>
          </div>
        </div>
      ))}
      {SHOGI_FORMATIONS.length>4&&(
        <button onClick={()=>setShowAllFormations(v=>!v)} style={{width:"100%",background:"transparent",border:"1px solid #c8b090",borderRadius:6,color:"#7a5838",padding:"4px",cursor:"pointer",fontSize:15,marginTop:2}}>
          {showAllFormations?(playerLang==="en"?"Show Less":"閉じる"):(playerLang==="en"?"Show More":"もっと見る")}
        </button>
      )}
    </div>
  );
  const shogiPieceOverviewEl = (
    <div style={{width:"100%",maxWidth:520,fontFamily:serif,marginTop:12}}>
      <div onClick={()=>setShogiGuideOpen(v=>!v)} style={{fontSize:16,letterSpacing:"2px",color:"#a89070",textTransform:"uppercase",textAlign:"center",marginBottom:shogiGuideOpen?10:0,cursor:"pointer",userSelect:"none",display:"flex",justifyContent:"center",gap:8,alignItems:"center"}}>
        {playerLang==="en"?"Piece Guide":"駒ガイド"}
        <span style={{fontSize:14}}>{shogiGuideOpen?"▲":"▼"}</span>
      </div>
      {shogiGuideOpen && SHOGI_PIECE_LIST_BASE.map(base=>{
        const promInfo = base.promType ? SHOGI_PIECE_LIST_PROM.find(p=>p.type===base.promType) : null;
        const baseSrc = getShogiImg({type:base.type, color:"b", p:false});
        const promSrc = promInfo ? getShogiImg({type:promInfo.type, color:"b", p:true}) : null;
        return (
          <div key={base.type} style={{display:"flex",alignItems:"stretch",gap:4,marginBottom:6}}>
            <div style={{flexBasis:"calc(50% - 13px)",flexShrink:0,flexGrow:0,minWidth:0,display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:"6px 4px",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:7}}>
              <img src={baseSrc} alt="" style={{width:30,height:30,objectFit:"contain"}}/>
              <div style={{fontSize:16,fontWeight:600,color:"#3a2e22",textAlign:"center",lineHeight:1.2}}>{playerLang==="en"?base.nameEn:base.nameJa}</div>
              <div style={{fontSize:16,color:"#c4a058",fontWeight:600,textAlign:"center"}}>{base.pts}{playerLang==="en"?" pt":" 点"}</div>
              <div style={{fontSize:16,color:"#7a5828",textAlign:"center",lineHeight:1.3}}>{playerLang==="en"?base.descEn:base.descJa}</div>
            </div>
            <div style={{width:18,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",color:promInfo?"#a89070":"transparent",fontSize:16,userSelect:"none"}}>→</div>
            <div style={{flexBasis:"calc(50% - 13px)",flexShrink:0,flexGrow:0,minWidth:0,display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:promInfo?"6px 4px":"0",background:promInfo?"#fff8ec":"transparent",border:promInfo?"1px solid #d4bc88":"none",borderRadius:7}}>
              {promInfo && <>
                <img src={promSrc} alt="" style={{width:30,height:30,objectFit:"contain"}}/>
                <div style={{fontSize:16,fontWeight:600,color:"#8a3000",textAlign:"center",lineHeight:1.2}}>{playerLang==="en"?promInfo.nameEn:promInfo.nameJa}</div>
                <div style={{fontSize:16,color:"#c4a058",fontWeight:600,textAlign:"center"}}>{promInfo.pts}{playerLang==="en"?" pt":" 点"}</div>
                <div style={{fontSize:16,color:"#7a5828",textAlign:"center",lineHeight:1.3}}>{playerLang==="en"?promInfo.descEn:promInfo.descJa}</div>
              </>}
            </div>
          </div>
        );
      })}
      {shogiGuideOpen && (
        <div style={{width:"100%",boxSizing:"border-box",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 14px",marginTop:8}}>
          <div onClick={()=>setDiffOpen(v=>!v)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",userSelect:"none"}}>
            <div style={{fontWeight:600,fontSize:17,color:"#3a2e22"}}>{playerLang==="en"?"Differences from Chess":"チェスとの違い"}</div>
            <span style={{color:"#a89070",fontSize:16}}>{diffOpen?"▲":"▼"}</span>
          </div>
          {diffOpen && (playerLang==="en"?SHOGI_VS_CHESS_EN:SHOGI_VS_CHESS_JA).map((t,i)=>(
            <div key={i} style={{display:"flex",gap:6,marginBottom:5,fontSize:16,color:"#5a3c18",lineHeight:1.5,alignItems:"flex-start",marginTop:i===0?8:0}}>
              <span style={{flexShrink:0,color:"#c4a058",fontWeight:"bold"}}>•</span>
              <span>{t}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const boardEl = (
    <div style={{position:"relative",background:"#D4A888",borderRadius:10,border:"1.5px solid rgba(154,120,72,0.65)",padding:"10px 10px 0 10px",boxShadow:"0 4px 20px rgba(60,40,20,0.20), inset 0 1px 2px rgba(255,230,180,0.20)",boxSizing:"border-box"}}>
      <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:0,overflow:"hidden",borderRadius:10}} viewBox="0 0 100 100" preserveAspectRatio="none">
        <rect x="3" y="3" width="94" height="94" fill="none" stroke="#c4a46a" strokeWidth="0.5" opacity="0.35" rx="1.5"/>
        <rect x="6" y="6" width="88" height="88" fill="none" stroke="#b89a60" strokeWidth="0.4" opacity="0.25" rx="1" strokeDasharray="3,5"/>
      </svg>
      {[{top:2,left:2},{top:2,right:2},{bottom:2,left:2},{bottom:2,right:2}].map((pos,i) => (
        <svg key={i} style={{position:"absolute",...pos,width:11,height:11,pointerEvents:"none",zIndex:10,overflow:"visible"}} viewBox="0 0 10 10">
          <circle cx="5" cy="5" r="5" fill="#c8a84b" opacity="0.6"/>
          <circle cx="5" cy="5" r="3" fill="none" stroke="#a88830" strokeWidth="0.8" opacity="0.7"/>
          <circle cx="5" cy="5" r="1.2" fill="#a88830" opacity="0.6"/>
        </svg>
      ))}
      {/* 筋ラベル（上）*/}
      <div style={{display:"flex",marginBottom:2,paddingRight:16}}>
        {Array.from({length:9},(_,vc)=>(
          <div key={vc} style={{width:cellSize,textAlign:"center",fontSize:9,color:"#7a5c38",fontFamily:"Georgia,serif",opacity:0.7,userSelect:"none",lineHeight:"13px",flexShrink:0}}>{boardFlipped ? vc+1 : 9-vc}</div>
        ))}
      </div>
      <div style={{display:"flex",alignItems:"stretch"}}>
        <div style={{display:"grid",gridTemplateColumns:`repeat(9,${cellSize}px)`,gridTemplateRows:`repeat(9,${cellSize}px)`,gap:1,background:"#c49070",borderRadius:4}}>
          {Array.from({length:9},(_,vr)=>Array.from({length:9},(_,vc)=>{
            const r = boardFlipped ? 8-vr : vr;
            const c = boardFlipped ? 8-vc : vc;
            return renderCell(r, c);
          }))}
        </div>
        {/* 段ラベル（右）*/}
        <div style={{display:"flex",flexDirection:"column",width:16,flexShrink:0}}>
          {["一","二","三","四","五","六","七","八","九"].map((label,i)=>(
            <div key={i} style={{height:cellSize+1/9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#7a5c38",fontFamily:"'Zen Old Mincho',serif",opacity:0.7,userSelect:"none",lineHeight:1}}>
              {["一","二","三","四","五","六","七","八","九"][boardFlipped ? 8-i : i]}
            </div>
          ))}
        </div>
      </div>
      <div style={{textAlign:"center",fontFamily:"Georgia,serif",fontSize:9,color:"#8a6a40",letterSpacing:"2px",opacity:0.4,padding:"5px 0 7px",userSelect:"none"}}>FAMILY SHOGI — WOODEN TRAVELER SERIES</div>
    </div>
  );

  const shogiAnnouncementEl = checkAnnouncementSh ? (
    <div style={{position:"fixed",top:"20%",left:"50%",transform:"translateX(-50%)",zIndex:9000,background:"rgba(50,30,10,0.92)",color:"#ffe8a0",fontSize:22,fontWeight:700,padding:"14px 28px",borderRadius:12,border:"2px solid #c8a86a",fontFamily:serif,textAlign:"center",pointerEvents:"none",boxShadow:"0 4px 24px rgba(0,0,0,0.5)"}}>
      {checkAnnouncementSh}
    </div>
  ) : null;


  const shogiVictoryModalEl = victoryModalSh ? (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:9500,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:serif}}>
      <div style={{background:"#faf5e8",border:"2px solid #c8a86a",borderRadius:16,padding:"32px 36px",maxWidth:320,width:"90vw",textAlign:"center",boxShadow:"0 8px 40px rgba(0,0,0,0.5)"}}>
        <div style={{fontSize:48,marginBottom:12}}>{victoryModalSh.winner==="player"?"🏆":"🤖"}</div>
        <div style={{fontSize:22,fontWeight:700,color:"#3a2e22",marginBottom:8}}>
          {victoryModalSh.winner==="player"
            ? (playerLang==="en"?"You Win! / 勝利！":"勝利！/ You Win!")
            : (playerLang==="en"?"AI Wins / AI の勝ち":"AI の勝ち / AI Wins")}
        </div>
        <div style={{display:"flex",gap:10,marginTop:16,flexDirection:"column"}}>
          <button onClick={()=>{ setVictoryModalSh(null); resetShogi(); }} style={{background:"#c8a86a",border:"none",borderRadius:8,color:"#fff",padding:"10px",cursor:"pointer",fontSize:18,fontFamily:serif,fontWeight:600}}>
            {playerLang==="en"?"Play Again / もう一度":"もう一度 / Play Again"}
          </button>
          {onAnalyze&&practiceGameHistory.length>0&&(
            <button onClick={()=>{ setVictoryModalSh(null); handleAnalyzeGame(); }} style={{background:"transparent",border:"1px solid #c8b090",borderRadius:8,color:"#7a5838",padding:"10px",cursor:"pointer",fontSize:18,fontFamily:serif}}>
              {playerLang==="en"?"Analyze / 解析":"解析 / Analyze"}
            </button>
          )}
          <button onClick={()=>setVictoryModalSh(null)} style={{background:"transparent",border:"1px solid #c8b090",borderRadius:8,color:"#9a8878",padding:"8px",cursor:"pointer",fontSize:16,fontFamily:serif}}>
            {playerLang==="en"?"Close":"閉じる"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  // ── Shogi Tactics UI ──────────────────────────────────────────
  const tacCurPuzzleS = tacticsModeS && tacticsPuzzlesS.length > 0 ? tacticsPuzzlesS[tacticsIdxS] : null;
  const btnStyleS = {background:"transparent",border:"1px solid #c8b090",borderRadius:8,color:"#7a5838",padding:"6px 14px",cursor:"pointer",fontSize:16,fontFamily:serif};

  const btnModS = {border:"none",borderRadius:12,padding:"11px 0",fontSize:15,cursor:"pointer",fontFamily:serif,width:"100%"};
  const tacticsResultModalElS = (tacticsModeS && tacticsResultS) ? (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.52)",zIndex:9600,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:serif}}>
      <div style={{background:"#faf5e8",border:"2px solid #c8a86a",borderRadius:24,padding:"36px 32px 28px",maxWidth:290,width:"88vw",textAlign:"center",boxShadow:"0 12px 48px rgba(0,0,0,0.38)",animation:"tacModalPop 0.22s cubic-bezier(0.34,1.56,0.64,1) both"}}>
        <div style={{fontSize:60,lineHeight:1.1,marginBottom:8}}>
          {tacticsResultS==='correct'?'✅':'❌'}
        </div>
        <div style={{fontSize:26,fontWeight:700,letterSpacing:1,color:tacticsResultS==='correct'?"#2a7a2a":"#c04040",marginBottom:6}}>
          {tacticsResultS==='correct'
            ?(playerLang==="en"?"Correct!":"正解！")
            :(playerLang==="en"?"Incorrect":"不正解")}
        </div>
        {tacticsResultS==='incorrect' && (
          <div style={{fontSize:13,color:"#7a5838",marginBottom:12}}>
            {playerLang==="en"?"Keep trying — you'll get it!":"惜しい！もう一度チャレンジしよう！"}
          </div>
        )}
        <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:4}}>
          {tacticsResultS==='correct' ? (<>
            <button onClick={()=>{ setTacticsResultS(null); setTacticsIdxS(i=>(i+1)%tacticsPuzzlesS.length); }}
              style={{...btnModS,background:"#c8a86a",color:"#fff",fontWeight:600,fontSize:16}}>
              ▶ {playerLang==="en"?"Next Puzzle":"次の問題"}
            </button>
          </>) : (<>
            <button onClick={()=>{ setTacticsResultS(null); loadShogiTacticsPuzzle(tacCurPuzzleS); }}
              style={{...btnModS,background:"#f5ece0",color:"#7a5838",border:"1px solid #c8b090"}}>
              {playerLang==="en"?"Try Again":"もう一度"}
            </button>
            <button onClick={()=>{ setTacticsResultS(null); setTacticsShowAnswerS(true); }}
              style={{...btnModS,background:"#f5ece0",color:"#7a5838",border:"1px solid #c8b090"}}>
              {playerLang==="en"?"Show Answer":"答えを見る"}
            </button>
          </>)}
        </div>
      </div>
    </div>
  ) : null;

  const tacticsDiffSelectModalS = tacticsDiffSelectS ? (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:9800,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:serif,padding:"12px 0"}}>
      <div style={{background:"#faf5e8",border:"2px solid #c8a86a",borderRadius:16,padding:"24px 24px 20px",maxWidth:340,width:"92vw",maxHeight:"90vh",overflowY:"auto",boxSizing:"border-box"}}>

        {/* ── 難易度 ── */}
        <div style={{fontSize:16,fontWeight:700,color:"#7a5838",marginBottom:10,letterSpacing:1}}>
          {playerLang==="en"?"Difficulty":"難易度"}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:18}}>
          {[null,'Easy','Normal','Hard'].map(d=>{
            const active = tacticsDiffS === d;
            const label = d===null?(playerLang==="en"?"All":"すべて"):d;
            const bg = active ? (d==='Easy'?"#4a9":d==='Hard'?"#d44":d==='Normal'?"#c90":"#c8a86a") : "transparent";
            return (
              <button key={String(d)} onClick={()=>setTacticsDiffS(d)}
                style={{border:`1.5px solid ${active?"transparent":"#c8b090"}`,borderRadius:8,padding:"7px 0",fontSize:13,cursor:"pointer",fontFamily:serif,
                  background:bg,color:active?"#fff":"#7a5838",fontWeight:active?700:400,transition:"background 0.15s"}}>
                {label}
              </button>
            );
          })}
        </div>

        {/* ── 手数 ── */}
        <div style={{fontSize:16,fontWeight:700,color:"#7a5838",marginBottom:10,letterSpacing:1}}>
          {playerLang==="en"?"Moves":"手数"}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:20}}>
          {[
            { val: null, ja: "すべて",  en: "All" },
            { val: 1,    ja: "1手詰め", en: "Mate in 1" },
            { val: 3,    ja: "3手詰め", en: "Mate in 3" },
            { val: 5,    ja: "5手詰め", en: "Mate in 5" },
          ].map(({ val, ja, en }) => {
            const active = tacticsMoveFilterS === val;
            return (
              <button key={String(val)} onClick={() => setTacticsMoveFilterS(val)}
                style={{border:`1.5px solid ${active?"transparent":"#c8b090"}`,borderRadius:8,padding:"7px 2px",fontSize:12,cursor:"pointer",fontFamily:serif,
                  background:active?"#6a8abf":"transparent",color:active?"#fff":"#7a5838",fontWeight:active?700:400,transition:"background 0.15s",whiteSpace:"nowrap"}}>
                {playerLang==="en"?en:ja}
              </button>
            );
          })}
        </div>

        {/* ── ボタン ── */}
        <button onClick={()=>{
          if(shogiWorkerRef.current){ shogiWorkerRef.current.terminate(); shogiWorkerRef.current=null; }
          setAiThinking(false);
          setTacticsDiffSelectS(false);
          setTacticsModeS(true); setVsAI(false);
        }} style={{...btnStyleS,display:"block",width:"100%",marginBottom:8,fontSize:16,background:"#c8a86a",color:"#fff",border:"none",fontWeight:700,borderRadius:10,padding:"11px 0"}}>
          {playerLang==="en"?"Start":"スタート"}
        </button>
        <button onClick={()=>setTacticsDiffSelectS(false)} style={{...btnStyleS,display:"block",width:"100%",fontSize:14,color:"#9a8878",textAlign:"center"}}>
          {playerLang==="en"?"Cancel":"キャンセル"}
        </button>
      </div>
    </div>
  ) : null;

  // Shogi tactics: moves filter label + progress indicator
  const tacSMoveFilterLabel = tacticsMoveFilterS !== null
    ? (playerLang==="en" ? `Mate in ${tacticsMoveFilterS}` : `${tacticsMoveFilterS}手詰め`)
    : null;
  // Progress: which player move are we on (0,2,4=player steps → 1st,2nd,3rd move)
  const tacSPlayerMoveNum = Math.floor(tacticsSolStepS / 2) + 1;
  const tacSMateNum = tacCurPuzzleS?.mate ?? (tacCurPuzzleS?.solution ? Math.ceil(tacCurPuzzleS.solution.length / 2) : null);

  const tacticsHeaderElS = tacticsModeS && tacCurPuzzleS ? (
    <div style={{fontFamily:serif,textAlign:"center",padding:"6px 0 2px"}}>
      <span style={{fontSize:15,color:"#7a5838",marginRight:8}}>
        {playerLang==="en"?`Puzzle #${tacticsIdxS+1}`:`問題 ${tacticsIdxS+1}問目`}
      </span>
      <span style={{background:tacCurPuzzleS.difficulty==='Easy'?"#4a9":(tacCurPuzzleS.difficulty==='Hard'?"#d44":"#c90"),color:"#fff",borderRadius:8,padding:"1px 8px",fontSize:13,fontWeight:600,marginRight:6}}>
        {tacCurPuzzleS.difficulty}
      </span>
      {tacSMoveFilterLabel && (
        <span style={{background:"#6a8abf",color:"#fff",borderRadius:8,padding:"1px 8px",fontSize:12,fontWeight:600,marginRight:6}}>{tacSMoveFilterLabel}</span>
      )}
      {/* Progress indicator: 1手目/3手詰め */}
      {!tacticsResultS && tacSMateNum && tacSMateNum > 1 && (
        <span style={{background:"rgba(100,80,40,0.12)",color:"#6a4820",borderRadius:8,padding:"1px 8px",fontSize:12,fontWeight:600,marginRight:6}}>
          {playerLang==="en"
            ? `Move ${tacSPlayerMoveNum} / ${tacSMateNum}-move mate`
            : `${tacSPlayerMoveNum}手目 / ${tacSMateNum}手詰め`}
        </span>
      )}
      <div style={{fontSize:14,color:"#3a7a3a",fontWeight:600,marginTop:4,background:"rgba(60,140,60,0.08)",borderRadius:6,padding:"2px 8px",display:"inline-block"}}>
        {tacCurPuzzleS.turn==="b"
          ? (playerLang==="en"?"▶ Sente (Black) to move — your pieces are at the BOTTOM ↓":"▶ あなたは先手（下側の駒）です")
          : (playerLang==="en"?"▶ Gote (White) to move — your pieces are at the TOP ↑":"▶ あなたは後手（上側の駒）です")
        }
      </div>
      <div style={{fontSize:15,color:"#5a3c18",marginTop:3}}>
        {playerLang==="en"?tacCurPuzzleS.descEn:tacCurPuzzleS.descJa}
      </div>
    </div>
  ) : null;

  const tacticsControlsElS = tacticsModeS ? (
    <div style={{display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center",padding:"6px 0"}}>
      {tacticsErrorS ? (<>
        <span style={{fontFamily:serif,fontSize:14,color:"#c04040",alignSelf:"center"}}>{tacticsErrorS}</span>
        <button onClick={()=>{
          setTacticsErrorS(null); setTacticsLoadingS(true);
          const _rf1=tacticsDiffS==='Easy'?['/puzzles/shogi/easy.json']:tacticsDiffS==='Normal'?['/puzzles/shogi/normal.json']:tacticsDiffS==='Hard'?['/puzzles/shogi/hard.json']:['/puzzles/shogi/easy.json','/puzzles/shogi/normal.json','/puzzles/shogi/hard.json'];
          Promise.all(_rf1.map(f=>fetch(f).then(r=>r.json()))).then(arrays=>{const list=[...arrays.flat()];for(let i=list.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[list[i],list[j]]=[list[j],list[i]];}setTacticsPuzzlesS(list);setTacticsIdxS(0);setTacticsLoadingS(false);}).catch(e=>{setTacticsLoadingS(false);setTacticsErrorS(e.message);});
        }} style={{...btnStyleS,background:"#c8a86a",color:"#fff",border:"none"}}>{playerLang==="en"?"Retry":"再試行"}</button>
      </>) : tacticsLoadingS ? (<>
        <span style={{fontFamily:serif,fontSize:15,color:"#7a5838",alignSelf:"center"}}>{playerLang==="en"?"Loading…":"読み込み中…"}</span>
      </>) : tacticsResultS==='correct' ? (<>
        <span style={{fontSize:22}}>✅</span>
        <span style={{fontFamily:serif,fontSize:16,color:"#3a7a3a",alignSelf:"center"}}>{playerLang==="en"?"Correct!":"正解！"}</span>
        <button onClick={()=>{ setTacticsResultS(null); setTacticsIdxS(i=>(i+1)%tacticsPuzzlesS.length); }} style={{...btnStyleS,background:"#c8a86a",color:"#fff",border:"none"}}>▶ {playerLang==="en"?"Next":"次の問題"}</button>
      </>) : tacticsResultS==='incorrect' ? (<>
        <span style={{fontSize:22}}>❌</span>
        <span style={{fontFamily:serif,fontSize:16,color:"#c04040",alignSelf:"center"}}>{playerLang==="en"?"Incorrect":"不正解"}</span>
        <button onClick={()=>{ setTacticsResultS(null); loadShogiTacticsPuzzle(tacCurPuzzleS); }} style={btnStyleS}>{playerLang==="en"?"Retry":"もう一度"}</button>
        <button onClick={()=>{ setTacticsResultS(null); setTacticsShowAnswerS(true); }} style={btnStyleS}>{playerLang==="en"?"Show Answer":"答えを見る"}</button>
        <button onClick={()=>{ setTacticsResultS(null); setTacticsIdxS(i=>(i+1)%tacticsPuzzlesS.length); }} style={{...btnStyleS,background:"#c8a86a",color:"#fff",border:"none"}}>▶ {playerLang==="en"?"Next":"次の問題"}</button>
      </>) : (<>
        <button onClick={()=>setTacticsHintUsedS(true)} disabled={tacticsHintUsedS} style={{...btnStyleS,opacity:tacticsHintUsedS?0.5:1}}>{playerLang==="en"?"Hint 💡":"ヒント 💡"}</button>
        <button onClick={()=>setTacticsShowAnswerS(true)} style={btnStyleS}>{playerLang==="en"?"Show Answer":"答えを見る"}</button>
        <button onClick={()=>setTacticsIdxS(i=>(i+1)%tacticsPuzzlesS.length)}>⏭ {playerLang==="en"?"Skip":"スキップ"}</button>
      </>)}
      {!tacticsErrorS && !tacticsLoadingS && (<>
        <button onClick={()=>setTacticsIdxS(i=>Math.max(0,i-1))} disabled={tacticsIdxS===0} style={{...btnStyleS,opacity:tacticsIdxS===0?0.4:1}}>◀</button>
        <button onClick={()=>setTacticsIdxS(i=>(i+1)%tacticsPuzzlesS.length)} style={btnStyleS}>▶</button>
      </>)}
      <button onClick={()=>{ localStorage.removeItem('shogi_tactics_session'); setTacticsModeS(false); resetShogi(); }} style={{...btnStyleS,color:"#9a8878"}}>✕ {playerLang==="en"?"Exit":"終了"}</button>
    </div>
  ) : null;

  const tacticsBtnS = (
    <button onClick={()=>setTacticsDiffSelectS(true)} disabled={tacticsModeS}
      style={{background:tacticsModeS?"#c8a86a":"transparent",border:"1px solid #c8b090",borderRadius:8,color:tacticsModeS?"#fff":"#7a5838",padding:"6px 14px",cursor:tacticsModeS?"default":"pointer",fontSize:16,fontFamily:serif,whiteSpace:"nowrap"}}>
      {playerLang==="en"?"Tactics 🎯":"タクティクス 🎯"}
    </button>
  );

  if (fullScreen) {
    const bw = cellSize * 9 + 44;
    const bwStr = bw > 0 ? `${bw}px` : "min(calc(100vw - 8px),96vw)";
    const fsBtn={background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.25)",borderRadius:8,color:"#fff",padding:"4px 10px",cursor:"pointer",fontSize:"clamp(15px,3.5vw,18px)",whiteSpace:"nowrap",fontFamily:serif};
    return (
      <div style={{position:"fixed",inset:0,paddingTop:"env(safe-area-inset-top)",paddingBottom:"env(safe-area-inset-bottom)",background:"#2a1808",display:"flex",flexDirection:"column",zIndex:2000,overflow:"hidden",fontFamily:serif,boxSizing:"border-box"}}>
        {/* Row 1: Reset | Undo | Exit */}
        <div style={{flexShrink:0,display:"flex",alignItems:"center",gap:6,padding:"5px 8px",boxSizing:"border-box"}}>
          <button onClick={resetShogi} style={fsBtn}>↺ {playerLang==="en"?"Reset":"リセット"}</button>
          <button onClick={handleShogiUndo} disabled={shogiMoveHistory.length===0} style={{...fsBtn,opacity:shogiMoveHistory.length===0?0.35:1,cursor:shogiMoveHistory.length===0?"default":"pointer"}}>↩ {playerLang==="en"?"Undo":"1手戻す"}</button>
          <div style={{flex:1}}/>
          <button onClick={()=>setFullScreen(false)} style={fsBtn}>✕ {playerLang==="en"?"Exit":"終了"}</button>
        </div>
        {/* Row 2: Chess|将棋 switcher + AI controls */}
        <div style={{flexShrink:0,display:"flex",alignItems:"center",gap:5,padding:"3px 8px",background:"rgba(0,0,0,0.3)",boxSizing:"border-box",flexWrap:"wrap"}}>
          {onSwitchToGame && (<>
            <button onClick={()=>onSwitchToGame("chess")} style={{...fsBtn,background:"rgba(255,255,255,0.08)"}}>Chess</button>
            <button onClick={()=>onSwitchToGame("shogi")} style={{...fsBtn,background:"rgba(200,168,106,0.45)",fontWeight:700}}>将棋</button>
            <div style={{width:1,height:16,background:"rgba(255,255,255,0.2)",margin:"0 2px"}}/>
          </>)}
          <button onClick={handleToggleShogiVsAI} style={{...fsBtn,background:vsAI?"rgba(200,168,106,0.5)":"rgba(255,255,255,0.08)"}}>
            {vsAI ? `AI ON  Lv${aiLevel}` : (playerLang==="en"?"AI: OFF":"AI: OFF")}
          </button>
          {vsAI&&(<>
            <button onClick={()=>handleShogiSetAiColor(aiColor==="w"?"b":"w")} style={{...fsBtn,background:"rgba(255,255,255,0.08)"}}>
              {aiColor==="w"?(playerLang==="en"?"▶ Sente":"▶ 先手"):(playerLang==="en"?"▶ Gote":"▶ 後手")}
            </button>
            {practiceGameHistory.length>0&&onAnalyze&&(
              <button onClick={handleAnalyzeGame} style={{...fsBtn,background:"rgba(255,255,255,0.08)"}}>
                {playerLang==="en"?"Analyze":"解析"}
              </button>
            )}
            {aiThinking&&<span style={{color:"rgba(200,168,106,0.9)",fontSize:16,animation:"spin 1s linear infinite",display:"inline-block"}}>⟳</span>}
          </>)}
        </div>
        {/* Board area */}
        <div ref={fsAreaRefCb} style={{flex:1,minHeight:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"4px",overflow:"hidden",boxSizing:"border-box"}}>
          <div style={{width:bwStr}}>
            {tacticsModeS && tacCurPuzzleS && <div style={{color:"#fff",fontSize:14,fontFamily:serif,textAlign:"center",marginBottom:4,opacity:0.9}}>
              {playerLang==="en"?`Puzzle #${tacticsIdxS+1}`:`問題 ${tacticsIdxS+1}問目`} · {tacCurPuzzleS.difficulty} · {playerLang==="en"?tacCurPuzzleS.descEn:tacCurPuzzleS.descJa}
            </div>}
            <div style={{transform:"rotate(180deg)"}}><ShogiHandArea color="b"/></div>
            {boardEl}
            <ShogiHandArea color="w"/>
            {tacticsModeS && <div style={{display:"flex",flexWrap:"wrap",gap:5,justifyContent:"center",marginTop:4}}>
              {tacticsErrorS ? (<>
                <span style={{color:"#f08080",fontFamily:serif,fontSize:13,alignSelf:"center"}}>{tacticsErrorS}</span>
                <button onClick={()=>{
                  setTacticsErrorS(null); setTacticsLoadingS(true);
                  const _rf2=tacticsDiffS==='Easy'?['/puzzles/shogi/easy.json']:tacticsDiffS==='Normal'?['/puzzles/shogi/normal.json']:tacticsDiffS==='Hard'?['/puzzles/shogi/hard.json']:['/puzzles/shogi/easy.json','/puzzles/shogi/normal.json','/puzzles/shogi/hard.json'];
                  Promise.all(_rf2.map(f=>fetch(f).then(r=>r.json()))).then(arrays=>{const list=[...arrays.flat()];for(let i=list.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[list[i],list[j]]=[list[j],list[i]];}setTacticsPuzzlesS(list);setTacticsIdxS(0);setTacticsLoadingS(false);}).catch(e=>{setTacticsLoadingS(false);setTacticsErrorS(e.message);});
                }} style={fsBtn}>{playerLang==="en"?"Retry":"再試行"}</button>
              </>) : tacticsLoadingS ? (
                <span style={{color:"rgba(255,255,255,0.7)",fontFamily:serif,fontSize:14,alignSelf:"center"}}>{playerLang==="en"?"Loading…":"読み込み中…"}</span>
              ) : tacticsResultS==='correct' ? (<>
                <span style={{fontSize:20,alignSelf:"center"}}>✅</span>
                <span style={{color:"#7ef07e",fontFamily:serif,fontSize:14,alignSelf:"center"}}>{playerLang==="en"?"Correct!":"正解！"}</span>
                <button onClick={()=>{setTacticsResultS(null);setTacticsIdxS(i=>(i+1)%tacticsPuzzlesS.length);}} style={{...fsBtn,background:"rgba(80,180,80,0.4)"}}>▶ {playerLang==="en"?"Next":"次"}</button>
              </>) : tacticsResultS==='incorrect' ? (<>
                <span style={{fontSize:20,alignSelf:"center"}}>❌</span>
                <button onClick={()=>{setTacticsResultS(null);loadShogiTacticsPuzzle(tacCurPuzzleS);}} style={fsBtn}>{playerLang==="en"?"Retry":"もう一度"}</button>
                <button onClick={()=>{setTacticsResultS(null);setTacticsShowAnswerS(true);}} style={fsBtn}>{playerLang==="en"?"Answer":"答え"}</button>
                <button onClick={()=>{setTacticsResultS(null);setTacticsIdxS(i=>(i+1)%tacticsPuzzlesS.length);}} style={{...fsBtn,background:"rgba(80,180,80,0.4)"}}>▶</button>
              </>) : (<>
                <button onClick={()=>setTacticsHintUsedS(true)} disabled={tacticsHintUsedS} style={{...fsBtn,opacity:tacticsHintUsedS?0.5:1}}>💡</button>
                <button onClick={()=>setTacticsShowAnswerS(true)} style={fsBtn}>{playerLang==="en"?"Answer":"答え"}</button>
                <button onClick={()=>setTacticsIdxS(i=>(i+1)%tacticsPuzzlesS.length)} style={fsBtn}>⏭</button>
              </>)}
              {!tacticsErrorS && !tacticsLoadingS && (<>
                <button onClick={()=>setTacticsIdxS(i=>Math.max(0,i-1))} disabled={tacticsIdxS===0} style={{...fsBtn,opacity:tacticsIdxS===0?0.4:1}}>◀</button>
                <button onClick={()=>setTacticsIdxS(i=>(i+1)%tacticsPuzzlesS.length)} style={fsBtn}>▶</button>
              </>)}
              <button onClick={()=>{localStorage.removeItem('shogi_tactics_session');setTacticsModeS(false);resetShogi();}} style={{...fsBtn,opacity:0.7}}>✕</button>
            </div>}
          </div>
        </div>
        {shogiAnnouncementEl}
        {shogiVictoryModalEl}
        {tacticsResultModalElS}
        {tacticsDiffSelectModalS}
      </div>
    );
  }

  if (pcLayout) {
    if (hideRules) {
      return (
        <>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8,padding:"12px 16px",width:"100%",boxSizing:"border-box"}}>
            {tacticsModeS && tacticsHeaderElS}
            <ShogiHandArea color="w"/>
            {boardEl}
            <ShogiHandArea color="b"/>
            {tacticsModeS && tacticsControlsElS}
            <div style={{display:"flex",flexDirection:"column",gap:6,alignItems:"stretch",marginTop:4,width:"100%"}}>
              {!tacticsModeS && <AIControlBar vsAI={vsAI} setVsAI={setVsAI} aiLevel={aiLevel} setAiLevel={setAiLevel} aiColor={aiColor} setAiColor={handleShogiSetAiColor} aiThinking={aiThinking} playerLang={playerLang} gameType="shogi" serif={serif} onToggle={handleToggleShogiVsAI} onAnalyze={handleAnalyzeGame} canAnalyze={practiceGameHistory.length>0}/>}
              {tacticsBtnS}
              <button onClick={()=>setFullScreen(true)} style={{background:"transparent",border:"1px solid #c8b090",borderRadius:8,color:"#7a5838",padding:"6px 20px",cursor:"pointer",fontSize:17,fontFamily:serif,width:"100%"}}>
                ⛶ {playerLang==="en"?"Full Screen":"全画面"}
              </button>
              {!tacticsModeS && <div style={{display:"flex",gap:8}}>
                <button onClick={handleShogiUndo} disabled={shogiMoveHistory.length===0} style={{flex:1,background:shogiMoveHistory.length===0?"rgba(200,176,144,0.15)":"transparent",border:"1px solid #c8b090",borderRadius:8,color:shogiMoveHistory.length===0?"#c8b090":"#7a5838",padding:"6px 0",cursor:shogiMoveHistory.length===0?"default":"pointer",fontSize:17,fontFamily:serif}}>
                  ↩ {playerLang==="en"?"Undo":"1手戻す"}
                </button>
                <button onClick={resetShogi} style={{flex:1,background:"transparent",border:"1px solid #c8b090",borderRadius:8,color:"#7a5838",padding:"6px 0",cursor:"pointer",fontSize:17,fontFamily:serif}}>
                  {playerLang==="en"?"Reset":"配置をリセット"}
                </button>
              </div>}
            </div>
            {/* Openings section */}
            {onOpenOpening && (
              <div style={{width:"100%",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 12px",boxSizing:"border-box",marginTop:4}}>
                <div style={{fontSize:14,letterSpacing:"1.5px",color:"#a89070",textTransform:"uppercase",marginBottom:5,fontFamily:serif}}>
                  {playerLang==="en"?"Openings":"定石"}
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                  {SHOGI_OPENINGS.map(o=>(
                    <button key={o.id} onClick={()=>onOpenOpening(o,"shogi")}
                      style={{background:"#fdf6e8",border:"1px solid #c8b090",borderRadius:14,color:"#5a3e28",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}
                      onMouseEnter={e=>e.currentTarget.style.background="#eddcb8"}
                      onMouseLeave={e=>e.currentTarget.style.background="#fdf6e8"}>
                      {playerLang==="en"?o.nameEn:o.nameJa}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* Tactics section */}
            {onOpenTactic && (
              <div style={{width:"100%",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 12px",boxSizing:"border-box",marginTop:4}}>
                <div style={{fontSize:14,letterSpacing:"1.5px",color:"#a89070",textTransform:"uppercase",marginBottom:5,fontFamily:serif}}>
                  {playerLang==="en"?"Tactics":"タクティクス"}
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                  {SHOGI_TACTICS.filter(tt=>tt.direct).map(tt=>(
                    <button key={tt.id} onClick={()=>onOpenTactic(tt,"shogi")}
                      style={{background:"#fdf6e8",border:"1px solid #c8b090",borderRadius:14,color:"#5a3e28",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}
                      onMouseEnter={e=>e.currentTarget.style.background="#eddcb8"}
                      onMouseLeave={e=>e.currentTarget.style.background="#fdf6e8"}>
                      {playerLang==="en"?tt.nameEn:tt.nameJa}
                    </button>
                  ))}
                  <button onClick={()=>{ const first = SHOGI_TACTICS.find(tt=>!tt.direct); if(first) onOpenTactic(first,"shogi"); }}
                    style={{background:"transparent",border:"1px solid #c8b090",borderRadius:14,color:"#7a5838",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}>
                    {playerLang==="en"?"More ▸":"もっと見る ▸"}
                  </button>
                </div>
              </div>
            )}
            {/* Strategy section (shogi desktop) */}
            <div style={{width:"100%",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 12px",boxSizing:"border-box",marginTop:4}}>
              <div style={{fontSize:14,letterSpacing:"1.5px",color:"#a89070",textTransform:"uppercase",marginBottom:5,fontFamily:serif}}>
                {playerLang==="en"?"Strategy":"ストラテジー"}
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                {(strategyShowAllS ? SHOGI_STRATEGY : SHOGI_STRATEGY.filter(s=>SHOGI_STRATEGY_FEATURED.includes(s.id))).map(s=>(
                  <button key={s.id} onClick={()=>setStrategyOpenS(s)}
                    style={{background:"#fdf6e8",border:"1px solid #c8b090",borderRadius:14,color:"#5a3e28",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}
                    onMouseEnter={e=>e.currentTarget.style.background="#eddcb8"}
                    onMouseLeave={e=>e.currentTarget.style.background="#fdf6e8"}>
                    {playerLang==="en"?s.nameEn:s.nameJa}
                  </button>
                ))}
                {!strategyShowAllS && SHOGI_STRATEGY.length > SHOGI_STRATEGY_FEATURED.length && (
                  <button onClick={()=>setStrategyShowAllS(true)}
                    style={{background:"transparent",border:"1px solid #c8b090",borderRadius:14,color:"#7a5838",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}>
                    {playerLang==="en"?"More ▸":"もっと見る ▸"}
                  </button>
                )}
              </div>
            </div>
            {/* Endgame section (shogi desktop) */}
            <div style={{width:"100%",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 12px",boxSizing:"border-box",marginTop:4}}>
              <div style={{fontSize:14,letterSpacing:"1.5px",color:"#a89070",textTransform:"uppercase",marginBottom:5,fontFamily:serif}}>
                {playerLang==="en"?"Endgame":"エンドゲーム"}
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                {(endgameShowAllS ? SHOGI_ENDGAME : SHOGI_ENDGAME.filter(s=>SHOGI_ENDGAME_FEATURED.includes(s.id))).map(s=>(
                  <button key={s.id} onClick={()=>setEndgameOpenS(s)}
                    style={{background:"#fdf6e8",border:"1px solid #c8b090",borderRadius:14,color:"#5a3e28",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}
                    onMouseEnter={e=>e.currentTarget.style.background="#eddcb8"}
                    onMouseLeave={e=>e.currentTarget.style.background="#fdf6e8"}>
                    {playerLang==="en"?s.nameEn:s.nameJa}
                  </button>
                ))}
                {!endgameShowAllS && SHOGI_ENDGAME.length > SHOGI_ENDGAME_FEATURED.length && (
                  <button onClick={()=>setEndgameShowAllS(true)}
                    style={{background:"transparent",border:"1px solid #c8b090",borderRadius:14,color:"#7a5838",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}>
                    {playerLang==="en"?"More ▸":"もっと見る ▸"}
                  </button>
                )}
              </div>
            </div>
            <div style={{width:"100%",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 14px",boxSizing:"border-box",marginTop:4}}>
              <div onClick={()=>setDiffOpen(v=>!v)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",userSelect:"none"}}>
                <div style={{fontWeight:600,fontSize:16,color:"#3a2e22"}}>{playerLang==="en"?"Differences from Chess":"チェスとの違い"}</div>
                <span style={{color:"#a89070",fontSize:16}}>{diffOpen?"▲":"▼"}</span>
              </div>
              {diffOpen && (playerLang==="en"?SHOGI_VS_CHESS_EN:SHOGI_VS_CHESS_JA).map((tx,i)=>(
                <div key={i} style={{display:"flex",gap:6,marginBottom:5,fontSize:16,color:"#5a3c18",lineHeight:1.5,alignItems:"flex-start",textAlign:"left",marginTop:i===0?8:0}}>
                  <span style={{flexShrink:0,color:"#c4a058",fontWeight:"bold"}}>•</span><span>{tx}</span>
                </div>
              ))}
            </div>
            <div style={{width:"100%",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 14px",boxSizing:"border-box"}}>
              <div onClick={()=>setForbidOpen(v=>!v)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",userSelect:"none"}}>
                <div style={{fontWeight:600,fontSize:16,color:"#3a2e22"}}>{playerLang==="en"?"Forbidden Moves":"反則ルール"}</div>
                <span style={{color:"#a89070",fontSize:16}}>{forbidOpen?"▲":"▼"}</span>
              </div>
              {forbidOpen && (playerLang==="en"?SHOGI_FORBIDDEN_EN:SHOGI_FORBIDDEN_JA).map((rule,i)=>(
                <div key={i} style={{marginBottom:8,paddingBottom:8,paddingTop:i===0?8:0,borderBottom:i<SHOGI_FORBIDDEN_JA.length-1?"1px solid #e8d8b4":"none",textAlign:"left"}}>
                  <div style={{fontWeight:600,fontSize:16,marginBottom:2,color:"#3a2e22"}}>{rule.title}</div>
                  <div style={{fontSize:16,color:"#5a3c18",lineHeight:1.5}}>{rule.desc}</div>
                </div>
              ))}
            </div>
          </div>
          {shogiAnnouncementEl}
          {shogiVictoryModalEl}
          {tacticsResultModalElS}
          {tacticsDiffSelectModalS}
          {strategyOpenS && (
            <StrategyModal theme={strategyOpenS} playerLang={playerLang} serif={serif} onClose={()=>setStrategyOpenS(null)}
              onPractice={(theme)=>{ setStrategyOpenS(null); setTacticsModeS(true); }}
            />
          )}
          {endgameOpenS && (
            <StrategyModal theme={endgameOpenS} playerLang={playerLang} serif={serif} onClose={()=>setEndgameOpenS(null)}
              onPractice={(theme)=>{ setEndgameOpenS(null); setTacticsModeS(true); }}
            />
          )}
        </>
      );
    }
    return (
      <>
        <div style={{display:"flex",gap:16,alignItems:"flex-start",padding:"12px 16px",width:"100%",boxSizing:"border-box"}}>
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
            {tacticsModeS && tacticsHeaderElS}
            <ShogiHandArea color="w"/>
            {boardEl}
            <ShogiHandArea color="b"/>
            {tacticsModeS && tacticsControlsElS}
            <div style={{display:"flex",flexDirection:"column",gap:5,alignItems:"stretch",width:"100%"}}>
              {!tacticsModeS && <><AIControlBar vsAI={vsAI} setVsAI={setVsAI} aiLevel={aiLevel} setAiLevel={setAiLevel} aiColor={aiColor} setAiColor={handleShogiSetAiColor} aiThinking={aiThinking} playerLang={playerLang} gameType="shogi" serif={serif} onToggle={handleToggleShogiVsAI} onAnalyze={handleAnalyzeGame} canAnalyze={practiceGameHistory.length>0}/></>}
              {tacticsBtnS}
              <button onClick={()=>setFullScreen(true)} style={{background:"transparent",border:"1px solid #c8b090",borderRadius:8,color:"#7a5838",padding:"5px 16px",cursor:"pointer",fontSize:17,fontFamily:serif}}>
                ⛶ {playerLang==="en"?"Full Screen":"全画面"}
              </button>
              {!tacticsModeS && <div style={{display:"flex",gap:6}}>
                <button onClick={handleShogiUndo} disabled={shogiMoveHistory.length===0} style={{flex:1,background:shogiMoveHistory.length===0?"rgba(200,176,144,0.15)":"transparent",border:"1px solid #c8b090",borderRadius:8,color:shogiMoveHistory.length===0?"#c8b090":"#7a5838",padding:"5px 0",cursor:shogiMoveHistory.length===0?"default":"pointer",fontSize:17,fontFamily:serif}}>
                  ↩ {playerLang==="en"?"Undo":"1手戻す"}
                </button>
                <button onClick={resetShogi} style={{flex:1,background:"transparent",border:"1px solid #c8b090",borderRadius:8,color:"#7a5838",padding:"5px 0",cursor:"pointer",fontSize:17,fontFamily:serif}}>
                  {playerLang==="en"?"Reset":"配置をリセット"}
                </button>
              </div>}
            </div>
          </div>
          <div style={{width:240,flexShrink:0,background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"12px 14px",boxSizing:"border-box"}}>
            {rulesPanel}
          </div>
        </div>
        {shogiAnnouncementEl}
        {shogiVictoryModalEl}
        {tacticsResultModalElS}
        {tacticsDiffSelectModalS}
        {strategyOpenS && (
          <StrategyModal theme={strategyOpenS} playerLang={playerLang} serif={serif} onClose={()=>setStrategyOpenS(null)}
            onPractice={(theme)=>{ setStrategyOpenS(null); setTacticsModeS(true); }}
          />
        )}
        {endgameOpenS && (
          <StrategyModal theme={endgameOpenS} playerLang={playerLang} serif={serif} onClose={()=>setEndgameOpenS(null)}
            onPractice={(theme)=>{ setEndgameOpenS(null); setTacticsModeS(true); }}
          />
        )}
      </>
    );
  }
  // モバイル：駒ガイドは盤面下に残す
  return (
    <>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12,padding:"12px 8px",width:"100%",boxSizing:"border-box",fontFamily:serif}}>
        {tacticsModeS && tacticsHeaderElS}
        <ShogiHandArea color="w"/>
        {boardEl}
        <ShogiHandArea color="b"/>
        {tacticsModeS && tacticsControlsElS}
        <div style={{display:"flex",flexDirection:"column",gap:6,alignItems:"stretch",marginTop:4,width:"100%",paddingLeft:8,paddingRight:8,boxSizing:"border-box"}}>
          {!tacticsModeS && <><AIControlBar vsAI={vsAI} setVsAI={setVsAI} aiLevel={aiLevel} setAiLevel={setAiLevel} aiColor={aiColor} setAiColor={handleShogiSetAiColor} aiThinking={aiThinking} playerLang={playerLang} gameType="shogi" serif={serif} onToggle={handleToggleShogiVsAI} onAnalyze={handleAnalyzeGame} canAnalyze={practiceGameHistory.length>0}/></>}
          {tacticsBtnS}
          <button onClick={()=>setFullScreen(true)} style={{background:"transparent",border:"1px solid #c8b090",borderRadius:8,color:"#7a5838",padding:"6px 20px",cursor:"pointer",fontSize:17,fontFamily:serif}}>
            ⛶ {playerLang==="en"?"Full Screen":"全画面"}
          </button>
          {!tacticsModeS && <div style={{display:"flex",gap:8}}>
            <button onClick={handleShogiUndo} disabled={shogiMoveHistory.length===0} style={{flex:1,background:shogiMoveHistory.length===0?"rgba(200,176,144,0.15)":"transparent",border:"1px solid #c8b090",borderRadius:8,color:shogiMoveHistory.length===0?"#c8b090":"#7a5838",padding:"6px 0",cursor:shogiMoveHistory.length===0?"default":"pointer",fontSize:17,fontFamily:serif}}>
              ↩ {playerLang==="en"?"Undo":"1手戻す"}
            </button>
            <button onClick={resetShogi} style={{flex:1,background:"transparent",border:"1px solid #c8b090",borderRadius:8,color:"#7a5838",padding:"6px 0",cursor:"pointer",fontSize:17,fontFamily:serif}}>
              {playerLang==="en"?"Reset":"配置をリセット"}
            </button>
          </div>}
        </div>
        {shogiPieceOverviewEl}
        {onOpenOpening && (
          <div style={{width:"100%",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 12px",boxSizing:"border-box"}}>
            <div style={{fontSize:14,letterSpacing:"1.5px",color:"#a89070",textTransform:"uppercase",marginBottom:5,fontFamily:serif}}>{playerLang==="en"?"Openings":"定石"}</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {SHOGI_OPENINGS.map(o=>(
                <button key={o.id} onClick={()=>onOpenOpening(o,"shogi")}
                  style={{background:"#fdf6e8",border:"1px solid #c8b090",borderRadius:14,color:"#5a3e28",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}>
                  {playerLang==="en"?o.nameEn:o.nameJa}
                </button>
              ))}
            </div>
          </div>
        )}
        {onOpenTactic && (
          <div style={{width:"100%",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 12px",boxSizing:"border-box"}}>
            <div style={{fontSize:14,letterSpacing:"1.5px",color:"#a89070",textTransform:"uppercase",marginBottom:5,fontFamily:serif}}>{playerLang==="en"?"Tactics":"タクティクス"}</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {SHOGI_TACTICS.filter(tt=>tt.direct).map(tt=>(
                <button key={tt.id} onClick={()=>onOpenTactic(tt,"shogi")}
                  style={{background:"#fdf6e8",border:"1px solid #c8b090",borderRadius:14,color:"#5a3e28",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}>
                  {playerLang==="en"?tt.nameEn:tt.nameJa}
                </button>
              ))}
              <button onClick={()=>{ const first=SHOGI_TACTICS.find(tt=>!tt.direct); if(first) onOpenTactic(first,"shogi"); }}
                style={{background:"transparent",border:"1px solid #c8b090",borderRadius:14,color:"#7a5838",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}>
                {playerLang==="en"?"More ▸":"もっと見る ▸"}
              </button>
            </div>
          </div>
        )}
        {shogiFormationsEl}
        <FormationModal modal={formationModal} setModal={setFormationModal} playerLang={playerLang} getShogiImg={getShogiImg}/>
        {/* Strategy section (shogi mobile) */}
        <div style={{width:"100%",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 12px",boxSizing:"border-box"}}>
          <div style={{fontSize:14,letterSpacing:"1.5px",color:"#a89070",textTransform:"uppercase",marginBottom:5,fontFamily:serif}}>{playerLang==="en"?"Strategy":"ストラテジー"}</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
            {(strategyShowAllS ? SHOGI_STRATEGY : SHOGI_STRATEGY.filter(s=>SHOGI_STRATEGY_FEATURED.includes(s.id))).map(s=>(
              <button key={s.id} onClick={()=>setStrategyOpenS(s)}
                style={{background:"#fdf6e8",border:"1px solid #c8b090",borderRadius:14,color:"#5a3e28",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}>
                {playerLang==="en"?s.nameEn:s.nameJa}
              </button>
            ))}
            {!strategyShowAllS && SHOGI_STRATEGY.length > SHOGI_STRATEGY_FEATURED.length && (
              <button onClick={()=>setStrategyShowAllS(true)}
                style={{background:"transparent",border:"1px solid #c8b090",borderRadius:14,color:"#7a5838",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}>
                {playerLang==="en"?"More ▸":"もっと見る ▸"}
              </button>
            )}
          </div>
        </div>
        {/* Endgame section (shogi mobile) */}
        <div style={{width:"100%",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 12px",boxSizing:"border-box"}}>
          <div style={{fontSize:14,letterSpacing:"1.5px",color:"#a89070",textTransform:"uppercase",marginBottom:5,fontFamily:serif}}>{playerLang==="en"?"Endgame":"エンドゲーム"}</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
            {(endgameShowAllS ? SHOGI_ENDGAME : SHOGI_ENDGAME.filter(s=>SHOGI_ENDGAME_FEATURED.includes(s.id))).map(s=>(
              <button key={s.id} onClick={()=>setEndgameOpenS(s)}
                style={{background:"#fdf6e8",border:"1px solid #c8b090",borderRadius:14,color:"#5a3e28",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}>
                {playerLang==="en"?s.nameEn:s.nameJa}
              </button>
            ))}
            {!endgameShowAllS && SHOGI_ENDGAME.length > SHOGI_ENDGAME_FEATURED.length && (
              <button onClick={()=>setEndgameShowAllS(true)}
                style={{background:"transparent",border:"1px solid #c8b090",borderRadius:14,color:"#7a5838",padding:"2px 10px",cursor:"pointer",fontSize:15,fontFamily:serif,whiteSpace:"nowrap"}}>
                {playerLang==="en"?"More ▸":"もっと見る ▸"}
              </button>
            )}
          </div>
        </div>
        <div style={{width:"100%",maxWidth:520,background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 14px",boxSizing:"border-box"}}>
          <div onClick={()=>setForbidOpen(v=>!v)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",userSelect:"none"}}>
            <div style={{fontWeight:600,fontSize:16,color:"#3a2e22"}}>{playerLang==="en"?"Forbidden Moves":"反則ルール"}</div>
            <span style={{color:"#a89070",fontSize:16}}>{forbidOpen?"▲":"▼"}</span>
          </div>
          {forbidOpen && (playerLang==="en"?SHOGI_FORBIDDEN_EN:SHOGI_FORBIDDEN_JA).map((r,i)=>(
            <div key={i} style={{marginBottom:10,padding:"6px 0",borderBottom:"1px solid #e8d8b4",paddingTop:i===0?8:0}}>
              <div style={{fontWeight:600,fontSize:18,marginBottom:2,textAlign:"left"}}>{r.title}</div>
              <div style={{fontSize:17,color:"#5a3c18",lineHeight:1.5,textAlign:"left"}}>{r.desc}</div>
            </div>
          ))}
        </div>
      </div>
      {shogiAnnouncementEl}
      {shogiVictoryModalEl}
      {tacticsResultModalElS}
      {tacticsDiffSelectModalS}
      {strategyOpenS && (
        <StrategyModal theme={strategyOpenS} playerLang={playerLang} serif={serif} onClose={()=>setStrategyOpenS(null)}
          onPractice={(theme)=>{ setStrategyOpenS(null); setTacticsModeS(true); }}
        />
      )}
      {endgameOpenS && (
        <StrategyModal theme={endgameOpenS} playerLang={playerLang} serif={serif} onClose={()=>setEndgameOpenS(null)}
          onPractice={(theme)=>{ setEndgameOpenS(null); setTacticsModeS(true); }}
        />
      )}
    </>
  );
}

function OpeningDetailView({ openingData, allOpenings, playerLang, getShogiImg, onClose, onOpenOther }) {
  const { game, gameType, nameJa, nameEn, descJa, descEn } = openingData;
  const history = game.history || [];
  const isChess = gameType === "chess";
  const serif = "'Cormorant Garamond','Zen Old Mincho',Georgia,serif";
  const t = (ja, en) => playerLang === "en" ? en : ja;

  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Auto-play
  useEffect(() => {
    if (!playing) return;
    if (step >= history.length) { setPlaying(false); return; }
    const id = setTimeout(() => setStep(s => Math.min(s + 1, history.length)), 1200);
    return () => clearTimeout(id);
  }, [playing, step, history.length]);

  // Reset step when opening changes
  useEffect(() => {
    setStep(0);
    setPlaying(false);
  }, [game.id]);

  // Build chess board up to step
  const chessBoard = useMemo(() => {
    if (!isChess) return null;
    const back = ["R","N","B","Q","K","B","N","R"];
    let b = [];
    for (let r = 0; r < 8; r++) { b[r] = []; for (let c = 0; c < 8; c++) b[r][c] = null; }
    for (let c = 0; c < 8; c++) {
      b[0][c] = {type:back[c],color:"b"}; b[1][c] = {type:"P",color:"b"};
      b[6][c] = {type:"P",color:"w"};    b[7][c] = {type:back[c],color:"w"};
    }
    for (let i = 0; i < step; i++) {
      const h = history[i];
      if (!h || !h.from || !h.to) continue;
      const [fr,fc] = h.from, [tr,tc] = h.to;
      const p = b[fr][fc];
      if (!p) continue;
      const nb = b.map(row => [...row]);
      // Promotion
      const isPromRow = p.color==="w" ? tr===0 : tr===7;
      nb[tr][tc] = (p.type==="P" && isPromRow) ? {type:"Q",color:p.color} : {...p};
      nb[fr][fc] = null;
      // Castling
      if (p.type==="K" && Math.abs(tc-fc)===2) {
        if (tc===6){nb[fr][5]={...nb[fr][7]};nb[fr][7]=null;} else {nb[fr][3]={...nb[fr][0]};nb[fr][0]=null;}
      }
      b = nb;
    }
    return b;
  }, [isChess, step, history]);

  // Build shogi board up to step
  const { shogiBoard, shogiCap } = useMemo(() => {
    if (isChess) return { shogiBoard: null, shogiCap: null };
    const E=null, bP=(t)=>({color:"b",type:t,p:false}), wP=(t)=>({color:"w",type:t,p:false});
    let board = [
      [wP("L"),wP("N"),wP("S"),wP("G"),wP("K"),wP("G"),wP("S"),wP("N"),wP("L")],
      [E,wP("R"),E,E,E,E,E,wP("B"),E],
      [wP("P"),wP("P"),wP("P"),wP("P"),wP("P"),wP("P"),wP("P"),wP("P"),wP("P")],
      [E,E,E,E,E,E,E,E,E],[E,E,E,E,E,E,E,E,E],[E,E,E,E,E,E,E,E,E],
      [bP("P"),bP("P"),bP("P"),bP("P"),bP("P"),bP("P"),bP("P"),bP("P"),bP("P")],
      [E,bP("B"),E,E,E,E,E,bP("R"),E],
      [bP("L"),bP("N"),bP("S"),bP("G"),bP("K"),bP("G"),bP("S"),bP("N"),bP("L")],
    ];
    let cap = {b:{},w:{}};
    for (let i = 0; i < step; i++) {
      const h = history[i];
      if (!h) continue;
      if (h.drop) {
        const nb = board.map(r=>r.map(p=>p?{...p}:null));
        nb[h.to[0]][h.to[1]] = {color: i%2===0?"b":"w", type:h.drop, p:false};
        const nc = {b:{...cap.b},w:{...cap.w}};
        const dropper = i%2===0?"b":"w";
        nc[dropper][h.drop] = Math.max(0,(nc[dropper][h.drop]||0)-1);
        board = nb; cap = nc;
      } else if (h.from && h.to) {
        const [fr,fc] = h.from, [tr,tc] = h.to;
        const piece = board[fr][fc];
        if (!piece) continue;
        const nb = board.map(r=>r.map(p=>p?{...p}:null));
        const nc = {b:{...cap.b},w:{...cap.w}};
        const target = nb[tr][tc];
        if (target) nc[piece.color][target.type] = (nc[piece.color][target.type]||0)+1;
        nb[tr][tc] = h.promote ? {...piece, p:true} : {...piece};
        nb[fr][fc] = null;
        board = nb; cap = nc;
      }
    }
    return { shogiBoard: board, shogiCap: cap };
  }, [isChess, step, history]);

  // Current move for arrow
  const currentMove = step > 0 ? history[step - 1] : null;

  const [vw, setVw] = useState(typeof window !== "undefined" ? window.innerWidth : 600);
  useEffect(() => {
    const handler = () => setVw(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  const cellSize = useMemo(() => {
    const available = Math.min(vw - 40, 520);
    return isChess ? Math.floor(available / 8) : Math.floor(available / 9);
  }, [isChess, vw]);
  const boardW = isChess ? cellSize * 8 : cellSize * 9;

  // Arrow SVG
  const arrowEl = useMemo(() => {
    if (!currentMove || !currentMove.from || !currentMove.to) return null;
    const [fr,fc] = currentMove.from, [tr,tc] = currentMove.to;
    const x1 = fc * cellSize + cellSize/2;
    const y1 = fr * cellSize + cellSize/2;
    const x2 = tc * cellSize + cellSize/2;
    const y2 = tr * cellSize + cellSize/2;
    const dx = x2-x1, dy = y2-y1;
    const len = Math.sqrt(dx*dx+dy*dy);
    if (len < 1) return null;
    const ux = dx/len, uy = dy/len;
    const headLen = 14;
    const hx = x2 - ux*headLen, hy = y2 - uy*headLen;
    const px = -uy*6, py = ux*6;
    return (
      <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:5}} viewBox={`0 0 ${boardW} ${isChess?boardW:cellSize*9}`}>
        <defs><marker id="ah" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="rgba(200,100,20,0.85)"/></marker></defs>
        <line x1={x1} y1={y1} x2={hx} y2={hy} stroke="rgba(200,100,20,0.75)" strokeWidth="4" strokeLinecap="round"/>
        <polygon points={`${x2},${y2} ${hx+px},${hy+py} ${hx-px},${hy-py}`} fill="rgba(200,100,20,0.85)"/>
      </svg>
    );
  }, [currentMove, cellSize, boardW, isChess]);

  // Coordinate label style — matches main chess board style
  const coordFs = Math.max(9, Math.floor(cellSize * 0.18));
  const coordW  = Math.max(12, Math.floor(cellSize * 0.25));
  const coordH  = Math.max(10, Math.floor(cellSize * 0.22));
  const coordLbl = {display:"flex",alignItems:"center",justifyContent:"center",color:"#7a5c38",fontSize:coordFs,fontFamily:"Georgia,serif",userSelect:"none",opacity:0.72,fontWeight:400,letterSpacing:"0.04em"};

  // Render chess board with rank/file coordinates
  const chessBoardEl = chessBoard && (
    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-start"}}>
      <div style={{display:"flex"}}>
        {/* Rank labels 8→1 on the left */}
        <div style={{display:"flex",flexDirection:"column",width:coordW,marginRight:2}}>
          {[8,7,6,5,4,3,2,1].map(n=>(
            <div key={n} style={{...coordLbl,height:cellSize}}>{n}</div>
          ))}
        </div>
        {/* Chess board */}
        <div style={{position:"relative",width:boardW,height:boardW,flexShrink:0}}>
          <div style={{display:"grid",gridTemplateColumns:`repeat(8,${cellSize}px)`,gridTemplateRows:`repeat(8,${cellSize}px)`}}>
            {Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>{
              const isLight = (r+c)%2===0;
              const piece = chessBoard[r][c];
              return (
                <div key={`${r}-${c}`} style={{width:cellSize,height:cellSize,background:isLight?"#f0d9b5":"#b58863",position:"relative",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {piece && <img src={`/pieces/${piece.color}${piece.type}.webp`} alt="" style={{width:"80%",height:"80%",objectFit:"contain",position:"relative",zIndex:1}}/>}
                </div>
              );
            }))}
          </div>
          {arrowEl}
        </div>
      </div>
      {/* File labels a→h on the bottom */}
      <div style={{display:"flex",marginLeft:coordW+2}}>
        {["a","b","c","d","e","f","g","h"].map(f=>(
          <div key={f} style={{...coordLbl,width:cellSize,height:coordH,marginTop:2}}>{f}</div>
        ))}
      </div>
    </div>
  );

  // Render shogi board with file/rank coordinates (9-1 columns, 1-9 rows)
  const shogiBoardW = cellSize * 9;
  const shogiBoardEl = shogiBoard && (
    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-start"}}>
      <div style={{display:"flex"}}>
        {/* Rank labels 1→9 on the left */}
        <div style={{display:"flex",flexDirection:"column",width:coordW,marginRight:2}}>
          {[1,2,3,4,5,6,7,8,9].map(n=>(
            <div key={n} style={{...coordLbl,height:cellSize}}>{n}</div>
          ))}
        </div>
        {/* Shogi board */}
        <div style={{position:"relative",width:shogiBoardW,flexShrink:0}}>
          <div style={{display:"grid",gridTemplateColumns:`repeat(9,${cellSize}px)`,gridTemplateRows:`repeat(9,${cellSize}px)`,background:"#D4A888",gap:1}}>
            {Array.from({length:9},(_,r)=>Array.from({length:9},(_,c)=>{
              const piece = shogiBoard[r][c];
              const src = piece ? getShogiImg(piece) : null;
              return (
                <div key={`${r}-${c}`} style={{width:cellSize,height:cellSize,background:"#D4A888",position:"relative",display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid #c49070"}}>
                  {src && <img src={src} alt="" style={{width:"85%",height:"85%",objectFit:"contain",transform:piece.color==="w"?"rotate(180deg)":"none",position:"relative",zIndex:1}}/>}
                </div>
              );
            }))}
          </div>
          {arrowEl}
        </div>
      </div>
      {/* Column labels 9→1 on the bottom */}
      <div style={{display:"flex",marginLeft:coordW+2}}>
        {[9,8,7,6,5,4,3,2,1].map(n=>(
          <div key={n} style={{...coordLbl,width:cellSize,height:coordH,marginTop:2}}>{n}</div>
        ))}
      </div>
    </div>
  );

  const navBtn = {background:"rgba(200,168,106,0.15)",border:"1px solid #c8b090",borderRadius:6,color:"#5a3e28",padding:"5px 12px",cursor:"pointer",fontSize:18,fontFamily:serif};

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(20,12,4,0.88)",zIndex:3000,display:"flex",alignItems:"flex-start",justifyContent:"center",overflowY:"auto",padding:"16px 8px 32px"}}>
      <div style={{background:"#fdf8ef",borderRadius:14,maxWidth:560,width:"100%",boxShadow:"0 8px 40px rgba(0,0,0,0.5)",overflow:"hidden",fontFamily:serif}}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",padding:"14px 16px 10px",background:"#3a2414",gap:8}}>
          <div style={{flex:1,fontSize:20,fontWeight:700,color:"#f5ead8",letterSpacing:"0.04em"}}>
            {playerLang==="en"?nameEn:nameJa}
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.3)",borderRadius:6,color:"#f5ead8",padding:"4px 12px",cursor:"pointer",fontSize:17,fontFamily:serif}}>✕</button>
        </div>

        {/* Board */}
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"14px 16px 8px",gap:10}}>
          <div style={{position:"relative"}}>
            {isChess ? chessBoardEl : shogiBoardEl}
          </div>

          {/* Nav controls */}
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <button onClick={()=>{setPlaying(false);setStep(0);}} style={navBtn}>◀◀</button>
            <button onClick={()=>{setPlaying(false);setStep(s=>Math.max(0,s-1));}} style={navBtn}>◀</button>
            <button onClick={()=>setPlaying(v=>!v)} style={{...navBtn,background:playing?"rgba(200,100,20,0.25)":"rgba(200,168,106,0.15)",minWidth:48}}>
              {playing?"⏸":"▶"}
            </button>
            <button onClick={()=>{setPlaying(false);setStep(s=>Math.min(history.length,s+1));}} style={navBtn}>▶</button>
            <button onClick={()=>{setPlaying(false);setStep(history.length);}} style={navBtn}>▶▶</button>
            <span style={{fontSize:16,color:"#7a5838",marginLeft:4}}>{step}/{history.length}</span>
          </div>

          {/* Move label */}
          {step>0 && history[step-1] && (
            <div style={{fontSize:16,color:"#7a5838",background:"rgba(200,168,106,0.12)",padding:"3px 10px",borderRadius:6,border:"1px solid #e0d0b0"}}>
              {t("手目","Move")} {step}
            </div>
          )}
        </div>

        {/* Description */}
        <div style={{margin:"0 16px 12px",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"10px 14px"}}>
          <div style={{fontSize:17,color:"#4a3020",lineHeight:1.7}}>
            {playerLang==="en" ? descEn : descJa}
          </div>
        </div>

        {/* Other openings */}
        {allOpenings.length > 0 && (
          <div style={{margin:"0 16px 16px"}}>
            <div style={{fontSize:14,letterSpacing:"2px",color:"#a89070",textTransform:"uppercase",marginBottom:6}}>
              {t("定石一覧","Openings")}
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {allOpenings.map(o=>{
                const isCurrent = o.id === game.id.replace("opening_","");
                return (
                  <button key={o.id} onClick={()=>onOpenOther(o)}
                    style={{background:isCurrent?"#c8a86a":"#faf5e8",border:"1px solid #c8b090",borderRadius:14,color:isCurrent?"#fff":"#5a3e28",padding:"3px 12px",cursor:"pointer",fontSize:16,fontFamily:serif,whiteSpace:"nowrap",fontWeight:isCurrent?700:400}}
                    onMouseEnter={e=>{ if(!isCurrent) e.currentTarget.style.background="#eddcb8"; }}
                    onMouseLeave={e=>{ if(!isCurrent) e.currentTarget.style.background="#faf5e8"; }}>
                    {playerLang==="en"?o.nameEn:o.nameJa}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TacticsDetailView({ tacticsData, allTactics, playerLang, onClose, onOpenOther }) {
  const { tactic, gameType } = tacticsData;
  const serif = "'Cormorant Garamond','Zen Old Mincho',Georgia,serif";
  const t = (ja, en) => playerLang === "en" ? en : ja;

  const [step, setStep] = useState(0);

  // Responsive board size — same formula as StrategyModal
  const [vw, setVw] = useState(typeof window !== "undefined" ? window.innerWidth : 600);
  useEffect(() => {
    const handler = () => setVw(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  const cellSize = Math.floor(Math.min(vw - 40, 520) / 8);

  // Pre-compute all board states
  const boards = useMemo(() => {
    if (!tactic?.fen) return [];
    const states = [];
    let bd = _stratFenToBoard(tactic.fen);
    states.push(bd);
    for (const uci of (tactic.moves || [])) {
      bd = _stratApplyMove(bd, uci);
      states.push(bd);
    }
    return states;
  }, [tactic]);

  // Reset step when tactic changes
  useEffect(() => { setStep(0); }, [tactic?.id]);

  const board = boards[step];
  const lastMoveUci = step > 0 ? tactic.moves[step - 1] : null;
  const lastFrom = lastMoveUci ? [8 - parseInt(lastMoveUci[1]), lastMoveUci.charCodeAt(0) - 97] : null;
  const lastTo   = lastMoveUci ? [8 - parseInt(lastMoveUci[3]), lastMoveUci.charCodeAt(2) - 97] : null;
  const comments = playerLang === "en" ? (tactic.moveComments?.en || []) : (tactic.moveComments?.ja || []);
  const comment = comments[step] || "";
  const maxStep = (tactic.moves || []).length;
  const bodyFs = playerLang === "en" ? 17 : 16;
  const navBtn = {background:"#fdf6e8",border:"1px solid #c8b090",borderRadius:6,color:"#7a5838",padding:"4px 10px",cursor:"pointer",fontSize:16,fontFamily:serif};

  // Coordinate label style — same as StrategyModal
  const coordFs = Math.max(9, Math.floor(cellSize * 0.18));
  const coordW = Math.max(12, Math.floor(cellSize * 0.25));
  const coordH = Math.max(10, Math.floor(cellSize * 0.22));
  const coordLbl = {display:"flex",alignItems:"center",justifyContent:"center",color:"#7a5c38",fontSize:coordFs,fontFamily:"Georgia,serif",userSelect:"none",opacity:0.72,fontWeight:400,letterSpacing:"0.04em"};

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(20,12,4,0.88)",zIndex:3000,display:"flex",alignItems:"flex-start",justifyContent:"center",overflowY:"auto",padding:"16px 8px 32px"}}>
      <div style={{background:"#fdf8ef",borderRadius:14,maxWidth:560,width:"100%",boxShadow:"0 8px 40px rgba(0,0,0,0.5)",overflow:"hidden",fontFamily:serif}}>
        <div style={{display:"flex",alignItems:"center",padding:"14px 16px 10px",background:"#3a2414",gap:8}}>
          <div style={{flex:1,fontSize:20,fontWeight:700,color:"#f5ead8",letterSpacing:"0.04em"}}>
            {playerLang==="en"?tactic.nameEn:tactic.nameJa}
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.3)",borderRadius:6,color:"#f5ead8",padding:"4px 12px",cursor:"pointer",fontSize:17,fontFamily:serif}}>✕</button>
        </div>
        <div style={{padding:"16px"}}>
          {/* Description */}
          <div style={{background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"12px 14px",marginBottom:14}}>
            <div style={{fontSize:bodyFs,color:"#4a3020",lineHeight:1.7}}>
              {playerLang==="en" ? tactic.descEn : tactic.descJa}
            </div>
          </div>

          {/* Board with coordinates (chess only) */}
          {board && (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",marginBottom:14}}>
              <div style={{display:"flex",flexDirection:"column",alignItems:"flex-start"}}>
                <div style={{display:"flex"}}>
                  {/* Rank labels (8→1, left side) */}
                  <div style={{display:"flex",flexDirection:"column",width:coordW,marginRight:2}}>
                    {[8,7,6,5,4,3,2,1].map(n=>(
                      <div key={n} style={{...coordLbl,height:cellSize}}>{n}</div>
                    ))}
                  </div>
                  {/* Chess board */}
                  <div style={{border:"2px solid #8b6040",borderRadius:3,overflow:"hidden"}}>
                    <div style={{display:"grid",gridTemplateColumns:`repeat(8,${cellSize}px)`,gridTemplateRows:`repeat(8,${cellSize}px)`}}>
                      {Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>{
                        const isLight=(r+c)%2===0;
                        const piece=board[r]?.[c];
                        const isHlFrom=lastFrom&&lastFrom[0]===r&&lastFrom[1]===c;
                        const isHlTo=lastTo&&lastTo[0]===r&&lastTo[1]===c;
                        const bg=(isHlFrom||isHlTo)?(isLight?"#f6f669":"#baca2b"):(isLight?"#f0d9b5":"#b58863");
                        return (
                          <div key={`${r}-${c}`} style={{width:cellSize,height:cellSize,background:bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
                            {piece&&<img src={`/pieces/${piece.color}${piece.type}.webp`} alt="" style={{width:"82%",height:"82%",objectFit:"contain"}}/>}
                          </div>
                        );
                      }))}
                    </div>
                  </div>
                </div>
                {/* File labels (a→h, bottom) */}
                <div style={{display:"flex",marginLeft:coordW+2}}>
                  {["a","b","c","d","e","f","g","h"].map(f=>(
                    <div key={f} style={{...coordLbl,width:cellSize,height:coordH,marginTop:2}}>{f}</div>
                  ))}
                </div>
              </div>
              <div style={{marginTop:6,fontSize:bodyFs,color:"#6a4820",textAlign:"center",minHeight:20,padding:"0 4px",lineHeight:1.55}}>{comment}</div>
              <div style={{display:"flex",gap:6,marginTop:8,alignItems:"center"}}>
                <button onClick={()=>setStep(0)} disabled={step===0} style={{...navBtn,opacity:step===0?0.35:1}}>◀◀</button>
                <button onClick={()=>setStep(s=>Math.max(0,s-1))} disabled={step===0} style={{...navBtn,opacity:step===0?0.35:1}}>◀</button>
                <span style={{fontSize:16,color:"#7a5838",minWidth:48,textAlign:"center"}}>{step} / {maxStep}</span>
                <button onClick={()=>setStep(s=>Math.min(maxStep,s+1))} disabled={step>=maxStep} style={{...navBtn,opacity:step>=maxStep?0.35:1}}>▶</button>
                <button onClick={()=>setStep(maxStep)} disabled={step>=maxStep} style={{...navBtn,opacity:step>=maxStep?0.35:1}}>▶▶</button>
              </div>
            </div>
          )}

          {/* Tactics list */}
          {allTactics.length > 0 && (
            <div>
              <div style={{fontSize:14,letterSpacing:"2px",color:"#a89070",textTransform:"uppercase",marginBottom:6}}>
                {t("タクティクス一覧","Tactics")}
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {allTactics.map(tt=>{
                  const isCurrent = tt.id === tactic.id;
                  return (
                    <button key={tt.id} onClick={()=>onOpenOther(tt)}
                      style={{background:isCurrent?"#c8a86a":"#faf5e8",border:"1px solid #c8b090",borderRadius:14,color:isCurrent?"#fff":"#5a3e28",padding:"3px 12px",cursor:"pointer",fontSize:16,fontFamily:serif,whiteSpace:"nowrap",fontWeight:isCurrent?700:400}}
                      onMouseEnter={e=>{ if(!isCurrent) e.currentTarget.style.background="#eddcb8"; }}
                      onMouseLeave={e=>{ if(!isCurrent) e.currentTarget.style.background="#faf5e8"; }}>
                      {playerLang==="en"?tt.nameEn:tt.nameJa}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [games, setGames] = useState(null);
  const [tab, setTab] = useState(() => {
    try { return parseInt(localStorage.getItem("lastTab") || "0", 10) || 0; } catch { return 0; }
  });

  // ── 解析モード ────────────────────────────────────────────────────
  const [analysisData, setAnalysisData] = useState(null); // {game, gameType}
  const [openingData, setOpeningData] = useState(null);   // {game, gameType, staticEvals, descJa, descEn, nameJa, nameEn}
  const [tacticsData, setTacticsData] = useState(null); // {tactic, gameType}
  const [showAnalysisList, setShowAnalysisList] = useState(false);
  // 解析新着バッジ
  const [analysisNewTs, setAnalysisNewTs] = useState(() => { try { return localStorage.getItem("analysisNewTs") || ""; } catch { return ""; } });
  const [analysisSeenTs, setAnalysisSeenTs] = useState(() => { try { return localStorage.getItem("analysisSeenTs") || ""; } catch { return ""; } });
  const hasAnalysisBadge = analysisNewTs > analysisSeenTs && analysisNewTs !== "";
  const [autoAnalysisProgress, setAutoAnalysisProgress] = useState({});
  const [practiceAnalysisGames, setPracticeAnalysisGames] = useState([]);
  const [failedAnalysisGameIds, setFailedAnalysisGameIds] = useState(() => new Set());
  const [analysisListRefreshKey, setAnalysisListRefreshKey] = useState(0);
  // playerName より前に定義 → TDZ回避のため ref でアクセス
  const _playerNameRef = useRef(null);

  const onAutoAnalysisComplete = useCallback((gameId, _gameType, isNew = false) => {
    if (isNew) {
      const ts = new Date().toISOString();
      setAnalysisNewTs(prev => ts > prev ? ts : prev);
      try { localStorage.setItem("analysisNewTs", ts); } catch {}
      if (_playerNameRef.current) set(ref(db, `userAnalysisTs/${_playerNameRef.current}/newTs`), ts).catch(() => {});
    }
    setAutoAnalysisProgress(prev => { const n = {...prev}; delete n[gameId]; return n; });
    setAnalysisListRefreshKey(k => k + 1);
  }, []);
  const onAutoAnalysisProgress = useCallback((gameId, pct) => {
    setAutoAnalysisProgress(prev => ({...prev, [gameId]: pct}));
  }, []);
  const handlePracticeAnalyze = useCallback((game, gameType) => {
    setPracticeAnalysisGames(prev => [...prev.filter(g => g.game.id !== game.id), {game, gameType}]);
    setShowAnalysisList(true);
    const ts = new Date().toISOString();
    setAnalysisSeenTs(prev => ts > prev ? ts : prev);
    try { localStorage.setItem("analysisSeenTs", ts); } catch {}
  }, []);

  const onAutoAnalysisFailed = useCallback((gameId) => {
    setFailedAnalysisGameIds(prev => new Set([...prev, gameId]));
    setAutoAnalysisProgress(prev => { const n = {...prev}; delete n[gameId]; return n; });
  }, []);
  const openAnalysisList = useCallback(() => {
    setShowAnalysisList(v => !v);
    const ts = new Date().toISOString();
    setAnalysisSeenTs(prev => ts > prev ? ts : prev);
    try { localStorage.setItem("analysisSeenTs", ts); } catch {}
    if (_playerNameRef.current) set(ref(db, `userAnalysisTs/${_playerNameRef.current}/seenTs`), ts).catch(() => {});
  }, []);
  const openAnalysis = useCallback((game, gameType) => {
    setAnalysisData({game, gameType});
    const ts = new Date().toISOString();
    setAnalysisSeenTs(prev => ts > prev ? ts : prev);
    try { localStorage.setItem("analysisSeenTs", ts); } catch {}
    if (_playerNameRef.current) set(ref(db, `userAnalysisTs/${_playerNameRef.current}/seenTs`), ts).catch(() => {});
  }, []);
  // Open AnalysisView from a cached Firebase item (from AnalysisList)
  const openAnalysisFromCache = useCallback((cachedItem) => {
    const game = {
      id:      cachedItem.gameId,
      history: cachedItem.history || [],
      players: cachedItem.players || {},
      status:  "finished",
      name:    cachedItem.gameId,
    };
    setAnalysisData({ game, gameType: cachedItem.gameType });
    setShowAnalysisList(false);
    const ts = new Date().toISOString();
    setAnalysisSeenTs(prev => ts > prev ? ts : prev);
    try { localStorage.setItem("analysisSeenTs", ts); } catch {}
    if (_playerNameRef.current) set(ref(db, `userAnalysisTs/${_playerNameRef.current}/seenTs`), ts).catch(() => {});
  }, []);

  // 定石ページを開く
  const openOpening = useCallback((opening, gameType) => {
    const history = gameType === "chess"
      ? uciMovesToChessHistory(opening.moves)
      : usiMovesToShogiHistory(opening.moves);
    const staticEvals = Array(opening.moves.length + 1).fill(0);
    const game = {
      id:      `opening_${opening.id}`,
      history,
      players: gameType === "chess"
        ? { white: "White", black: "Black" }
        : { black: "先手", white: "後手" },
      status:  "finished",
    };
    setOpeningData({ game, gameType, staticEvals, nameJa: opening.nameJa, nameEn: opening.nameEn, descJa: opening.descJa, descEn: opening.descEn });
  }, []);

  const openTactic = useCallback((tactic, gameType) => {
    setTacticsData({ tactic, gameType });
  }, []);

  // tab を localStorage に同期（shogiTab は shogiTab 宣言後に配置）
  useEffect(() => { try { localStorage.setItem("lastTab", String(tab)); } catch {} }, [tab]);

  // games ロード時にタブ範囲を補正（shogi 側は shogiGames/shogiTab 宣言後）
  useEffect(() => {
    if (games && games.length > 0 && tab >= games.length) setTab(games.length - 1);
  }, [games]);

  // analysisData を localStorage に同期
  useEffect(() => {
    try {
      if (analysisData) {
        localStorage.setItem("lastAnalysisId", analysisData.game.id);
        localStorage.setItem("lastAnalysisType", analysisData.gameType);
      } else {
        localStorage.removeItem("lastAnalysisId");
        localStorage.removeItem("lastAnalysisType");
      }
    } catch {}
  }, [analysisData]);

  // ── Lingva 翻訳キャッシュ（Firebase永続 + メモリRef）──────────────────
  const [uiTrans, setUiTrans] = useState({});
  const uiTransRef = useRef({});
  const transPending = useRef(new Set());
  const transFlushTimer = useRef(null);

  // 起動時に Firebase から翻訳キャッシュを読み込む（30日で自動リセット）
  useEffect(() => {
    get(ref(db, "uiTranslations")).then(snap => {
      const data = snap.val() || {};
      const { _cacheTs, ...translations } = data;
      const ageMs = Date.now() - (_cacheTs || 0);
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      if (ageMs > thirtyDays) {
        // 30日経過 → キャッシュをリセット（次回アクセス時に再翻訳される）
        set(ref(db, "uiTranslations"), { _cacheTs: Date.now() }).catch(() => {});
        uiTransRef.current = {};
        setUiTrans({});
      } else {
        uiTransRef.current = translations;
        setUiTrans(translations);
      }
    }).catch(() => {});
  }, []);

  // 未翻訳文字列をキューに積み、800ms デバウンスで Lingva に一括リクエスト
  const queueTrans = useCallback((ja) => {
    if (!ja || uiTransRef.current[ja] !== undefined) return;
    transPending.current.add(ja);
    clearTimeout(transFlushTimer.current);
    transFlushTimer.current = setTimeout(async () => {
      const toTranslate = [...transPending.current].filter(s => uiTransRef.current[s] === undefined);
      transPending.current.clear();
      if (toTranslate.length === 0) return;
      const results = {};
      for (const text of toTranslate) {
        try {
          const r = await fetch(`https://lingva.ml/api/v1/ja/en/${encodeURIComponent(text)}`);
          const d = await r.json();
          if (d.translation) results[text] = d.translation;
        } catch {}
      }
      if (Object.keys(results).length > 0) {
        const next = { ...uiTransRef.current, ...results };
        uiTransRef.current = next;
        set(ref(db, "uiTranslations"), { ...next, _cacheTs: Date.now() }).catch(() => {});
        setUiTrans({ ...next });
      }
    }, 800);
  }, []);

  // ゲームタブ通知・最終閲覧履歴数（Firebase同期 + localStorageキャッシュ）
  const [gameTabSeen, setGameTabSeen] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gameTabSeen") || "{}"); } catch { return {}; }
  });
  const [shogiTabSeen, setShogiTabSeen] = useState(()=>{
    try { return JSON.parse(localStorage.getItem("shogiTabSeen")||"{}"); } catch { return {}; }
  });
  const hasRestoredTab = useRef(false);
  const [playerName, setPlayerName] = useState(() => { try { return localStorage.getItem("playerName") || null; } catch { return null; } });
  // ref を常に最新 playerName に同期
  _playerNameRef.current = playerName;

  // 解析バッジ timestamps を Firebase で同期（デバイス間共有）
  useEffect(() => {
    if (!playerName) return;
    const newUnsub = onValue(ref(db, `userAnalysisTs/${playerName}/newTs`), (snap) => {
      const ts = snap.val();
      if (ts && typeof ts === "string") setAnalysisNewTs(prev => ts > prev ? ts : prev);
    });
    const seenUnsub = onValue(ref(db, `userAnalysisTs/${playerName}/seenTs`), (snap) => {
      const ts = snap.val();
      if (ts && typeof ts === "string") setAnalysisSeenTs(prev => ts > prev ? ts : prev);
    });
    return () => { newUnsub(); seenUnsub(); };
  }, [playerName]);

  // playerName 確定後に analysisData を Firebase から復元（playerName 宣言後に配置: TDZ回避）
  useEffect(() => {
    if (!playerName || analysisData) return;
    try {
      const savedId   = localStorage.getItem("lastAnalysisId");
      const savedType = localStorage.getItem("lastAnalysisType");
      if (!savedId || !savedType) return;
      get(ref(db, `analyses/${playerName}/${savedId}`)).then(snap => {
        if (!snap.exists()) return;
        const d = snap.val();
        const game = {
          id:      d.gameId || savedId,
          history: d.history || [],
          players: d.players || {},
          status:  "finished",
          name:    d.gameId || savedId,
        };
        setAnalysisData({ game, gameType: d.gameType || savedType });
      }).catch(() => {});
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerName]);
  const [showNameSelect, setShowNameSelect] = useState(() => { try { return !localStorage.getItem("playerName"); } catch { return true; } });
  const [startModal, setStartModal] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [authed, setAuthed] = useState(() => { try { return localStorage.getItem("chess_authed") === "true"; } catch { return false; } });
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [chatRooms, setChatRooms] = useState([]);
  const [activeRoomId, setActiveRoomId] = useState(null);
  const [chatReactionPicker, setChatReactionPicker] = useState(null); // {msgId, roomId}
  // プレイヤーが切り替わったらアクティブルームをリセット（他ユーザーのチャットが残らないように）
  useEffect(() => { setActiveRoomId(null); }, [playerName]);
  const [roomMessages, setRoomMessages] = useState({});
  const [chatUnread, setChatUnread] = useState(0);
  const [perRoomUnread, setPerRoomUnread] = useState({});
  const [lastReadTs, setLastReadTs] = useState({});
  const [roomLastMsgTs, setRoomLastMsgTs] = useState({});
  const [showNewRoom, setShowNewRoom] = useState(false);
  // isWide: 実際の画面幅 ≥ 1024px（自動）
  const [isWide, setIsWide] = useState(() => typeof window !== "undefined" ? window.innerWidth >= 1024 : false);
  // layoutPref: null=自動, "pc"=PC表示強制, "mobile"=モバイル表示強制（localStorageで永続化）
  const [layoutPref, setLayoutPref] = useState(() => {
    try { const v = localStorage.getItem("tabletLayoutPref"); return (v === "pc" || v === "mobile") ? v : null; } catch { return null; }
  });
  // effectiveWide: 実レイアウト判定（明示指定 or 自動）
  const effectiveWide = layoutPref === "pc" ? true : layoutPref === "mobile" ? false : isWide;
  const toggleTabletLayout = () => {
    const next = effectiveWide ? "mobile" : "pc";
    setLayoutPref(next);
    try { localStorage.setItem("tabletLayoutPref", next); } catch {}
  };
  const [pcF2F, setPcF2F] = useState(false);
  const [mobileF2F, setMobileF2F] = useState(false);
  const [currentView, setCurrentView] = useState(() => {
    try { const v = localStorage.getItem("lastView"); return v === "shogi" ? "shogi" : "chess"; } catch { return "chess"; }
  });
  const [showPractice, setShowPractice] = useState(()=>{ try{return localStorage.getItem("lastShowPractice")==="true";}catch{return false;} });
  const [practiceType, setPracticeType] = useState(()=>{ try{const v=localStorage.getItem("lastPracticeType");return v==="shogi"?"shogi":"chess";}catch{return "chess";} });
  const [practiceStartFs, setPracticeStartFs] = useState(false);
  const handleSwitchPracticeGame = useCallback((gt)=>{
    setPracticeType(gt);
    setPracticeStartFs(true);
  },[]);
  const switchView = (v) => {
    setCurrentView(v);
    setShowPractice(false);
    try { localStorage.setItem("lastView", v); } catch {}
  };
  // currentView が変化するたびに localStorage へ同期（switchView 経由以外のケースも含む）
  useEffect(() => {
    try { localStorage.setItem("lastView", currentView); } catch {}
  }, [currentView]);
  useEffect(()=>{ try{localStorage.setItem("lastShowPractice",showPractice?"true":"false");}catch{} },[showPractice]);
  useEffect(()=>{ try{localStorage.setItem("lastPracticeType",practiceType);}catch{} },[practiceType]);
  const [shogiGames, setShogiGames] = useState(null);
  const [shogiTab, setShogiTab] = useState(() => {
    try { return parseInt(localStorage.getItem("lastShogiTab") || "0", 10) || 0; } catch { return 0; }
  });
  // shogiTab を localStorage に同期 & shogiGames ロード時にタブ範囲を補正
  useEffect(() => { try { localStorage.setItem("lastShogiTab", String(shogiTab)); } catch {} }, [shogiTab]);
  useEffect(() => {
    if (shogiGames && shogiGames.length > 0 && shogiTab >= shogiGames.length) setShogiTab(shogiGames.length - 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shogiGames]);
  const [shogiStartModal, setShogiStartModal] = useState(null);
  const [appFormationModal, setAppFormationModal] = useState(null);

  const [showAllAppChessFormations, setShowAllAppChessFormations] = useState(false);
  const [showAllAppShogiFormations, setShowAllAppShogiFormations] = useState(false);
  // ゲーム内メッセージ通知
  const [gameMsgSeen, setGameMsgSeen] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gameMsgSeen") || "{}"); } catch { return {}; }
  });
  const gameMsgSeenRef = useRef({});
  useEffect(() => { gameMsgSeenRef.current = gameMsgSeen; }, [gameMsgSeen]);
  const [gameMsgUnread, setGameMsgUnread] = useState({});
  const markGameMsgRead = useCallback((gameId) => {
    const now = new Date().toISOString();
    setGameMsgSeen(prev => {
      const next = {...prev, [gameId]: now};
      try { localStorage.setItem("gameMsgSeen", JSON.stringify(next)); } catch {}
      return next;
    });
    setGameMsgUnread(prev => ({...prev, [gameId]: false}));
  }, []);
  useEffect(() => {
    const handler = () => setIsWide(window.innerWidth >= 1024);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const handlePassword = () => {
    if (pwInput === APP_PASSWORD) {
      localStorage.setItem("chess_authed", "true");
      setAuthed(true);
    } else {
      setPwError(true);
      setPwInput("");
    }
  };
  const [members, setMembers] = useState(DEFAULT_MEMBERS);

  // membersをFirebaseに保存するヘルパー：名前キー形式 {Thomas:{lang,kids,avatarUrl}, ...} で保存
  // これによりFirebaseセキュリティルールで root.child('members').child($name).exists() が使える
  const membersToFirebaseObj = (arr) =>
    Object.fromEntries(arr.map(m => [m.name, {
      lang:      m.lang      ?? "ja",
      kids:      m.kids      ?? false,
      avatarUrl: m.avatarUrl ?? null,
    }]));

  const saveMembers = (newMembers) => {
    setMembers(newMembers);
    set(ref(db, "members"), membersToFirebaseObj(newMembers));
    localStorage.setItem("chess_members", JSON.stringify(newMembers));
  };

  // findOrCreateDmRoomDb はモジュールスコープ関数を使用

  const playerLang = members.find(m => m.name === playerName)?.lang || "ja";
  const isKids = members.find(m => m.name === playerName)?.kids || false;
  const t = (ja, en, kidsJa, kidsEn) => {
    if (isKids) {
      if (playerLang === "en") return kidsEn || uiTrans[ja] || en;
      return kidsJa || ja;
    }
    if (playerLang === "en") {
      if (ja) queueTrans(ja);
      return uiTrans[ja] || en;
    }
    return ja;
  };
  const memberNames = members.map(m => m.name);

  useEffect(() => {
    const unsub = onValue(ref(db, "gamesData"), snap => {
      const raw = snap.val();
      if (!raw) { const d=mkGames(); set(ref(db,"gamesData"),JSON.stringify(d)); setGames(d); return; }
      try { setGames(JSON.parse(raw)); }
      catch { const d=mkGames(); set(ref(db,"gamesData"),JSON.stringify(d)); setGames(d); }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onValue(ref(db, "shogiGamesData"), snap => {
      const raw = snap.val();
      if (!raw) { const d=mkShogiGames(); set(ref(db,"shogiGamesData"),JSON.stringify(d)); setShogiGames(d); return; }
      try { setShogiGames(JSON.parse(raw)); }
      catch { const d=mkShogiGames(); set(ref(db,"shogiGamesData"),JSON.stringify(d)); setShogiGames(d); }
    });
    return () => unsub();
  }, []);

  // 全ゲームチャットルームを購読してメッセージ通知バッジを更新
  useEffect(() => {
    if (!games || !shogiGames || !playerName) return;
    const allGames = [...games, ...shogiGames];
    const seen = new Map(); // chatRoomId -> unsub
    allGames.forEach(g => {
      if (!g.chatRoomId || seen.has(g.chatRoomId)) return;
      const unsub = onValue(ref(db, `chat/${g.chatRoomId}`), snap => {
        const data = snap.val();
        if (!data) return;
        const msgs = Object.values(data);
        const seenTs = gameMsgSeenRef.current[g.id] || "";
        const hasUnread = msgs.some(m => m.gameId === g.id && m.sender !== playerName && (m.ts||"") > seenTs);
        setGameMsgUnread(prev => {
          if (!!prev[g.id] === hasUnread) return prev;
          return {...prev, [g.id]: hasUnread};
        });
      });
      seen.set(g.chatRoomId, unsub);
    });
    return () => seen.forEach(unsub => unsub());
  }, [games?.length, shogiGames?.length, playerName]); // eslint-disable-line

  // 初回ゲーム読み込み時にタブを復元
  useEffect(() => {
    if (!games || hasRestoredTab.current) return;
    hasRestoredTab.current = true;
    const lastId = localStorage.getItem("lastGameTabId");
    if (lastId) {
      const idx = games.findIndex(g => g.id === lastId);
      if (idx >= 0) { setTab(idx); return; }
    }
    // 保存なし → デフォルト 0
  }, [games]);

  // ゲームメッセージ → DM チャット マイグレーション（初回のみ）
  const migrationDoneRef = useRef(false);
  useEffect(() => {
    if (!games || migrationDoneRef.current) return;
    migrationDoneRef.current = true;
    (async () => {
      for (let i = 0; i < games.length; i++) {
        const g = games[i];
        if (!g.players?.white || !g.players?.black) continue;
        if (g.chatRoomId) continue; // already migrated
        try {
          const roomId = await findOrCreateDmRoomDb(g.players.white, g.players.black);
          const msgs = g.messages || [];
          for (const m of msgs) {
            await push(ref(db, `chat/${roomId}`), { ...m, gameId: m.gameId || g.id, gameType: m.gameType || "chess" });
          }
          update(i, { ...g, chatRoomId: roomId, messages: [] });
        } catch (e) { console.warn("[migration] chess game", g.id, e); }
      }
    })().catch(e => console.warn("[migration] chess", e));
  }, [games]); // eslint-disable-line react-hooks/exhaustive-deps

  // Firebase gameTabSeen をリアルタイム購読（複数端末同期）
  useEffect(() => {
    if (!playerName) return;
    const seenRef = ref(db, `gameTabSeen/${playerName}`);
    const unsub = onValue(seenRef, snap => {
      const data = snap.val();
      if (!data || typeof data !== "object") return;
      setGameTabSeen(prev => {
        const merged = { ...prev };
        let changed = false;
        Object.entries(data).forEach(([k, v]) => {
          if ((merged[k] || 0) < v) { merged[k] = v; changed = true; }
        });
        if (!changed) return prev;
        try { localStorage.setItem("gameTabSeen", JSON.stringify(merged)); } catch {}
        return merged;
      });
    });
    return () => unsub();
  }, [playerName]);

  // Firebase shogiTabSeen をリアルタイム購読（複数端末同期）
  useEffect(() => {
    if (!playerName) return;
    const shogiSeenRef = ref(db, `shogiTabSeen/${playerName}`);
    const unsub2 = onValue(shogiSeenRef, snap => {
      const data = snap.val();
      if (!data || typeof data !== "object") return;
      setShogiTabSeen(prev => {
        const merged = { ...prev };
        let changed = false;
        Object.entries(data).forEach(([k, v]) => {
          if ((merged[k] || 0) < v) { merged[k] = v; changed = true; }
        });
        if (!changed) return prev;
        try { localStorage.setItem("shogiTabSeen", JSON.stringify(merged)); } catch {}
        return merged;
      });
    });
    return () => unsub2();
  }, [playerName]);

  // チェスタブを閲覧中は常に既読扱い（チェス画面のときのみ）
  useEffect(() => {
    if (currentView !== "chess") return;
    if (!games || games[tab] === undefined) return;
    const g = games[tab];
    const histLen = (g.history || []).length;
    setGameTabSeen(prev => {
      if ((prev[g.id] || 0) >= histLen) return prev;
      const next = { ...prev, [g.id]: histLen };
      try { localStorage.setItem("gameTabSeen", JSON.stringify(next)); } catch {}
      if (playerName) set(ref(db, `gameTabSeen/${playerName}`), next);
      return next;
    });
  }, [games, tab, playerName, currentView]);

  // 将棋タブを閲覧中は常に既読扱い（将棋画面のときのみ）
  useEffect(() => {
    if (currentView !== "shogi") return;
    if (!shogiGames || shogiGames[shogiTab] === undefined) return;
    const g = shogiGames[shogiTab];
    const histLen = (g.history || []).length;
    setShogiTabSeen(prev => {
      if ((prev[g.id] || 0) >= histLen) return prev;
      const next = { ...prev, [g.id]: histLen };
      try { localStorage.setItem("shogiTabSeen", JSON.stringify(next)); } catch {}
      if (playerName) set(ref(db, `shogiTabSeen/${playerName}`), next);
      return next;
    });
  }, [shogiGames, shogiTab, playerName, currentView]);

  useEffect(() => {
    const membersRef = ref(db, "members");
    const unsub = onValue(membersRef, (snap) => {
      const data = snap.val();

      // ── Firebase からメンバーを読み込む（読み取り専用・自動書き込み禁止）──
      // メンバーデータの正はFirebaseのみ。
      // アプリ側からの自動初期化・上書きは一切行わない。
      // メンバーの追加・編集・削除はユーザーが設定画面で明示的に操作した
      // 場合のみ saveMembers() を通じて書き込む。

      if (!data) {
        // Firebase に members ノードが存在しない場合は何もしない。
        // （DEFAULT_MEMBERS の useState 初期値がそのまま表示される）
        return;
      }

      // 名前キーオブジェクト形式 {Thomas:{lang,kids,avatarUrl}, ...} → 配列に変換
      if (typeof data === "object" && !Array.isArray(data)) {
        const membersArr = Object.entries(data).map(([name, v]) => ({
          name,
          lang:      v?.lang      ?? "ja",
          kids:      v?.kids      ?? false,
          avatarUrl: v?.avatarUrl ?? undefined,
        }));
        if (membersArr.length > 0) {
          setMembers(membersArr);
        }
        return;
      }

      // 旧形式（数値キー配列）が万一来た場合も読み取り専用で反映
      // Firebase への書き戻しは行わない
      if (Array.isArray(data) && data.length > 0) {
        const membersArr = data.filter(Boolean);
        if (membersArr.length > 0) {
          setMembers(membersArr);
        }
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const roomsRef = ref(db, "chatRooms");
    const unsub = onValue(roomsRef, (snap) => {
      const data = snap.val();
      if (!data) {
        const globalRoom = { name: "全体 / Everyone", isPublic: true, createdBy: "system", createdAt: new Date().toISOString() };
        set(ref(db, "chatRooms/global"), globalRoom);
        setChatRooms([{ id:"global", ...globalRoom }]);
        return;
      }
      const arr = Object.entries(data).map(([id, r]) => ({ id, ...r })).sort((a,b) => a.createdAt > b.createdAt ? 1 : -1);
      setChatRooms(arr);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!activeRoomId) return;
    const msgRef = ref(db, `chat/${activeRoomId}`);
    const unsub = onValue(msgRef, (snap) => {
      const data = snap.val();
      const arr = data ? Object.entries(data).map(([id, m]) => ({ id, ...m })).sort((a,b) => a.ts > b.ts ? 1 : -1) : [];
      setRoomMessages(prev => ({ ...prev, [activeRoomId]: arr }));
    });
    return () => unsub();
  }, [activeRoomId]);

  // 既読タイムスタンプを Firebase で同期（デバイス間共有）
  useEffect(() => {
    if (!playerName) return;
    const lrtRef = ref(db, `userReadTs/${playerName}`);
    const unsub = onValue(lrtRef, (snap) => {
      const data = snap.val();
      if (data && typeof data === "object") {
        setLastReadTs(prev => {
          const next = { ...prev };
          Object.entries(data).forEach(([id, ts]) => {
            if (!next[id] || ts > next[id]) next[id] = ts;
          });
          return next;
        });
      }
    });
    return () => unsub();
  }, [playerName]);

  useEffect(() => {
    if (!playerName) return;
    const chatRef = ref(db, "chat");
    const unsub = onValue(chatRef, (snap) => {
      const data = snap.val();
      if (!data) { setChatUnread(0); setPerRoomUnread({}); setRoomLastMsgTs({}); return; }

      // 各ルームの最終メッセージ時刻を抽出（ソート用）
      const lastMsgMap = {};
      Object.entries(data).forEach(([roomId, msgs]) => {
        const tsList = Object.values(msgs).map(m => m.ts).filter(Boolean);
        if (tsList.length > 0) lastMsgMap[roomId] = tsList.reduce((a, b) => (a > b ? a : b));
      });
      setRoomLastMsgTs(lastMsgMap);

      // 自分がアクセスできるルームIDだけを対象にする
      // （アクセス不可の古いルームのメッセージをバッジに含めない）
      const myRoomIds = new Set(
        chatRooms
          .filter(r => { const mArr = Array.isArray(r.members) ? r.members : (r.members && typeof r.members === "object" ? Object.values(r.members) : []); return r.isPublic || r.createdBy === playerName || mArr.includes(playerName); })
          .map(r => r.id)
      );

      // 対局中のゲームに紐づいたDMルーム → ゲーム開始時刻のマップ
      // 開始「後」のメッセージは吹き出し表示で既読扱い、開始「前」の未読は通知する
      const activeGameRoomStartedAt = {};
      (games || []).forEach(g => {
        if (g.status === "playing" && g.chatRoomId) {
          const startedAt = g.startedAt || (g.history?.length > 0 ? g.history[0].ts : null);
          activeGameRoomStartedAt[g.chatRoomId] = startedAt || "";
        }
      });

      let total = 0;
      const perRoom = {};
      Object.entries(data).forEach(([roomId, msgs]) => {
        if (!myRoomIds.has(roomId)) return; // アクセス不可ルームをスキップ
        const lastRead = lastReadTs[roomId] || "";

        if (Object.prototype.hasOwnProperty.call(activeGameRoomStartedAt, roomId)) {
          // 対局中のDMルーム：ゲーム開始前の未読のみ通知（開始後は吹き出しで既読扱い）
          const gameStart = activeGameRoomStartedAt[roomId];
          if (!gameStart) return; // 開始時刻不明なら抑制
          const count = Object.values(msgs).filter(
            m => m.ts < gameStart && m.ts > lastRead && m.sender !== playerName
          ).length;
          if (count > 0) { total += count; perRoom[roomId] = count; }
          return;
        }

        // 通常ルーム：全未読カウント（自分発言・ゲームボード発言は除く）
        const count = Object.values(msgs).filter(m => m.ts > lastRead && m.sender !== playerName && !(m.auto && m.gameType)).length;
        total += count;
        if (count > 0) perRoom[roomId] = count;
      });
      setChatUnread(total);
      setPerRoomUnread(perRoom);
    });
    return () => unsub();
  }, [lastReadTs, playerName, chatRooms, games]);

  // チャットを開いているとき・ルームを切り替えたとき → 現在のルームを既読にする（楽観的更新＋Firebase同期）
  useEffect(() => {
    if (!showChat || !activeRoomId || !playerName) return;
    const now = new Date().toISOString();
    setLastReadTs(prev => ({...prev, [activeRoomId]: now}));
    set(ref(db, `userReadTs/${playerName}/${activeRoomId}`), now).catch(() => {});
  }, [showChat, activeRoomId, playerName]);

  // チャット開時・ルーム切替時 → メッセージ一覧の最下部（最新）へスクロール
  const chatScrolledRoomRef = useRef(null);
  useEffect(() => {
    if (!showChat || !activeRoomId) { chatScrolledRoomRef.current = null; return; }
    if (chatScrolledRoomRef.current === activeRoomId) return; // このルームは既にスクロール済み
    const msgs = roomMessages[activeRoomId];
    if (msgs !== undefined) { // Firebase からデータ到着（空配列も含む）
      chatScrolledRoomRef.current = activeRoomId;
      setTimeout(() => document.getElementById("chat-bottom")?.scrollIntoView({ behavior:"instant" }), 0);
    }
  }, [showChat, activeRoomId, roomMessages]);

  const update = useCallback((i, g) => {
    setGames(prev => {
      const n = prev.map((x,j) => j===i ? g : x);
      set(ref(db,"gamesData"), JSON.stringify(n));
      return n;
    });
  }, []);

  const updateShogi = useCallback((i, g) => {
    setShogiGames(prev => {
      const n = prev.map((x,j) => j===i ? g : x);
      set(ref(db,"shogiGamesData"), JSON.stringify(n));
      return n;
    });
  }, []);

  // 将棋ゲームメッセージ → DM チャット マイグレーション（初回のみ）
  const shogiMigrationDoneRef = useRef(false);
  useEffect(() => {
    if (!shogiGames || shogiMigrationDoneRef.current) return;
    shogiMigrationDoneRef.current = true;
    (async () => {
      for (let i = 0; i < shogiGames.length; i++) {
        const g = shogiGames[i];
        if (!g.players?.white || !g.players?.black) continue;
        if (g.chatRoomId) continue;
        try {
          const roomId = await findOrCreateDmRoomDb(g.players.white, g.players.black);
          const msgs = g.messages || [];
          for (const m of msgs) {
            await push(ref(db, `chat/${roomId}`), { ...m, gameId: m.gameId || g.id, gameType: m.gameType || "shogi" });
          }
          updateShogi(i, { ...g, chatRoomId: roomId, messages: [] });
        } catch (e) { console.warn("[migration] shogi game", g.id, e); }
      }
    })().catch(e => console.warn("[migration] shogi", e));
  }, [shogiGames]); // eslint-disable-line react-hooks/exhaustive-deps

  const PAPER_TEX = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='320'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.69 0 0 0 0 0.58 0 0 0 0 0.40 0 0 0 0.055 0'/%3E%3C/filter%3E%3Crect width='320' height='320' filter='url(%23n)'/%3E%3C/svg%3E")`;
  const pageBg = {
    minHeight:"100vh",
    background: WT.surface,
    backgroundImage: PAPER_TEX,
    backgroundBlendMode: "multiply",
    fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif",
    color: WT.text,
  };
  const modalBox = {
    background: WT.surfaceHi,
    border: `1px solid ${WT.border}`,
    borderRadius: 4,
    padding: 36,
    display:"flex", flexDirection:"column", gap:20, alignItems:"center",
    minWidth:280, maxWidth:"min(340px,90vw)",
    boxShadow:`0 16px 48px rgba(42,26,8,0.14), 0 4px 12px rgba(42,26,8,0.08)`,
    position:"relative",
  };
  const btnModalPrimary = {
    background: `linear-gradient(160deg, ${WT.wood}, ${WT.woodDark})`,
    border:"none", borderRadius:3,
    color:"#f5ead8",
    padding:"13px 32px", fontSize:"clamp(18px,4vw,22px)",
    fontWeight:600, cursor:"pointer", width:"100%",
    letterSpacing:"0.08em",
    boxShadow:`0 4px 14px rgba(76,46,12,0.28)`,
  };
  const btnModalCancel = { color:WT.textMuted, background:"none", border:"none", cursor:"pointer", fontSize:18, letterSpacing:"0.05em" };

  if (!authed) return (
    <div style={{
      minHeight:"100vh", background:WT.bg,
      backgroundImage: PAPER_TEX, backgroundBlendMode:"multiply",
      display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
      gap:0, padding:24, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif",
    }}>
      {/* 外枠ボーダー + コーナー装飾 */}
      <div style={{
        position:"relative", border:`1px solid ${WT.borderGold}`,
        padding:"48px 40px 40px", maxWidth:"min(380px,90vw)", width:"100%",
        background:`rgba(255,252,245,0.82)`,
        backdropFilter:"blur(2px)",
        boxShadow:`0 20px 60px rgba(42,26,8,0.10), 0 4px 16px rgba(42,26,8,0.07)`,
        display:"flex", flexDirection:"column", alignItems:"center", gap:28,
      }}>
        {/* 四隅の装飾 */}
        {[{top:-7,left:-7},{top:-7,right:-7},{bottom:-7,left:-7},{bottom:-7,right:-7}].map((pos,i)=>(
          <span key={i} style={{position:"absolute", ...pos, color:WT.borderGold, fontSize:11, lineHeight:1, background:WT.bg, padding:"0 1px"}}>✦</span>
        ))}
        {/* ブランドロゴ */}
        <BrandMark size="lg" />
        <OrnamentalRule style={{width:"100%"}} />
        {/* フォーム */}
        <div style={{display:"flex", flexDirection:"column", alignItems:"center", gap:16, width:"100%"}}>
          <p style={{
            color:WT.textMuted, fontSize:18, margin:0,
            letterSpacing:"0.12em", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontStyle:"italic",
          }}>パスワードを入力 · Enter password</p>
          <input
            type="password" value={pwInput}
            onChange={e => { setPwInput(e.target.value); setPwError(false); }}
            onKeyDown={e => e.key==="Enter" && handlePassword()}
            placeholder="· · · · · · · ·"
            style={{
              padding:"12px 20px", fontSize:18,
              border:`1px solid ${pwError ? "#b84030" : WT.border}`,
              borderRadius:2, outline:"none",
              width:"100%", textAlign:"center",
              background:WT.surfaceHi, color:WT.textDark,
              letterSpacing:"0.2em", boxSizing:"border-box",
              fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif",
            }}
          />
          {pwError && (
            <p style={{color:"#b84030", margin:0, fontSize:18, letterSpacing:"0.05em"}}>
              パスワードが違います · Incorrect password
            </p>
          )}
          <button onClick={handlePassword} style={{
            background:`linear-gradient(160deg, ${WT.wood}, ${WT.woodDark})`,
            border:"none", borderRadius:2,
            color:"#f5e8d0", padding:"13px 0", fontSize:18,
            fontWeight:600, cursor:"pointer", width:"100%",
            letterSpacing:"0.18em", boxShadow:`0 4px 16px rgba(76,46,12,0.28)`,
            fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif",
          }}>
            ENTER
          </button>
        </div>
      </div>
    </div>
  );

  if (!games || !shogiGames) return (
    <div style={{...pageBg, display:"flex", alignItems:"center", justifyContent:"center"}}>♟ 読み込み中...</div>
  );

  if (showNameSelect) return (
    <div style={{...pageBg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:0, padding:24}}>
      <div style={{
        position:"relative", border:`1px solid ${WT.borderGold}`,
        padding:"40px 36px 36px", maxWidth:"min(400px,92vw)", width:"100%",
        background:"rgba(255,252,245,0.84)", backdropFilter:"blur(2px)",
        boxShadow:`0 20px 60px rgba(42,26,8,0.10)`,
        display:"flex", flexDirection:"column", alignItems:"center", gap:24,
      }}>
        {[{top:-7,left:-7},{top:-7,right:-7},{bottom:-7,left:-7},{bottom:-7,right:-7}].map((pos,i)=>(
          <span key={i} style={{position:"absolute",...pos,color:WT.borderGold,fontSize:11,lineHeight:1,background:WT.bg,padding:"0 1px"}}>✦</span>
        ))}
        <BrandMark size="sm" />
        <OrnamentalRule style={{width:"100%"}} />
        <div style={{display:"flex", flexDirection:"column", alignItems:"center", gap:4}}>
          <h2 style={{
            fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontWeight:500,
            color:WT.textDark, fontSize:"clamp(18px,4.5vw,26px)",
            margin:0, letterSpacing:"0.08em", lineHeight:1.4,
          }}>
            {t("あなたは誰ですか？", "Who are you?")}
          </h2>
          <p style={{
            fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontStyle:"italic",
            color:WT.textMuted, fontSize:18, margin:0, letterSpacing:"0.1em",
          }}>
            {t("名前を選んでください", "Select your name")}
          </p>
        </div>
        <div style={{display:"flex", flexDirection:"column", gap:10, width:"100%"}}>
          {members.map(m => (
            <button key={m.name}
              onClick={() => { localStorage.setItem("playerName",m.name); setPlayerName(m.name); setShowNameSelect(false); }}
              style={{
                background: WT.surfaceHi,
                border:`1px solid ${WT.border}`,
                borderRadius:2, color:WT.textDark,
                padding:"14px 20px",
                fontSize:"clamp(19px,4vw,23px)", fontWeight:500,
                fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif",
                letterSpacing:"0.06em", cursor:"pointer", width:"100%",
                boxShadow:`0 2px 8px rgba(42,26,8,0.07)`,
                display:"flex", alignItems:"center", gap:14,
                transition:"background 0.15s, box-shadow 0.15s",
                touchAction:"manipulation",
              }}
              onMouseEnter={e=>{e.currentTarget.style.background=WT.surface; e.currentTarget.style.boxShadow=`0 4px 14px rgba(42,26,8,0.12)`;}}
              onMouseLeave={e=>{e.currentTarget.style.background=WT.surfaceHi; e.currentTarget.style.boxShadow=`0 2px 8px rgba(42,26,8,0.07)`;}}
            >
              <AvatarIcon url={m.avatarUrl} size={40} name={m.name} />
              <span>{m.name}{m.kids && " 🐥"}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ナビボタン共通スタイル
  const navBtn = {
    background: WT.surfaceHi,
    border: `1px solid ${WT.border}`,
    borderRadius: 2, color: WT.textMid,
    padding:"4px 10px", cursor:"pointer",
    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
    gap:2, height:52, minWidth:48,
    transition:"background 0.15s",
  };

  // ゲームタブ共通レンダラー（PC・モバイル共用）
  const renderGameTabs = () => games.map((g, i) => {
          const isActive = tab === i;
          const isPlayerInGame = playerName && (g.players?.white===playerName || g.players?.black===playerName);
          const histLen = (g.history||[]).length;
          const rawLastSeen = gameTabSeen[g.id] || 0;
          const lastSeen = histLen < rawLastSeen ? 0 : rawLastSeen;
          const myChessColor = g.players?.white === playerName ? 'w' : 'b';
          const hasGameUpdate = !isActive && isPlayerInGame && g.status==="playing" && histLen > lastSeen && g.turn === myChessColor;
          const hasMsgUpdate = isPlayerInGame && !!gameMsgUnread[g.id];
          const wMember = members.find(m => m.name === g.players?.white);
          const bMember = members.find(m => m.name === g.players?.black);
          return (
            <button key={g.id} onClick={() => {
              setTab(i);
              markGameMsgRead(g.id);
              const hl = (g.history||[]).length;
              setGameTabSeen(prev => {
                const next = {...prev, [g.id]: hl};
                try { localStorage.setItem("gameTabSeen", JSON.stringify(next)); } catch {}
                if (playerName) set(ref(db, `gameTabSeen/${playerName}`), next);
                return next;
              });
              try { localStorage.setItem("lastGameTabId", g.id); } catch {}
              if (g.status !== "playing") setStartModal({gameIndex: i, step:1, opponent:null});
            }} style={{
              position: "relative",
              flex: 1,
              background: isActive
                ? "linear-gradient(135deg,#D4A888,#b88a6a)"
                : WT.surfaceHi,
              border: `1px solid ${isActive ? "#b88a6a" : (hasGameUpdate||hasMsgUpdate) ? "#c03020" : WT.border}`,
              borderRadius: 6,
              color: isActive ? "#3a2e22" : WT.text,
              padding: "10px 6px",
              cursor: "pointer",
              fontSize: "clamp(18px,4vw,21px)",
              fontWeight: isActive ? 600 : 400,
              textAlign: "center",
              display: "flex", flexDirection:"column", alignItems: "center", justifyContent:"flex-start", gap:0,
              boxShadow: isActive
                ? `0 6px 20px rgba(76,46,12,0.22), inset 0 1px 0 rgba(255,240,200,0.12)`
                : hasGameUpdate
                  ? `0 2px 8px rgba(192,48,32,0.18)`
                  : `0 1px 4px rgba(42,26,8,0.05)`,
              transition: "all 0.18s",
              letterSpacing: "0.04em",
              fontFamily: "'Cormorant Garamond','Zen Old Mincho',Georgia,serif",
              minHeight: 88,
            }}>
              {/* ゲーム番号：駒アイコン＋No */}
              <span style={{display:"flex", alignItems:"center", gap:4, alignSelf:"center", paddingTop:2, paddingBottom:4}}>
                <img src={["/pieces/bK.webp","/pieces/bQ.webp","/pieces/bN.webp"][i] || "/pieces/bK.webp"} alt="" style={{width:20,height:20,objectFit:"contain",display:"block"}} />
                <span style={{fontSize:18, opacity:0.85, letterSpacing:"0.06em"}}>No.{i+1}</span>
              </span>
              {/* プレイヤー表示：高さ中央寄せ */}
              <span style={{flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:3, width:"100%"}}>
              {g.status==="playing" ? (
                <>
                  <span style={{fontSize:"clamp(18px,4vw,21px)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:"100%"}}>{g.players?.white||""}</span>
                  <span style={{fontSize:18, opacity:0.85, letterSpacing:"0.08em"}}>vs</span>
                  <span style={{fontSize:"clamp(18px,4vw,21px)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:"100%"}}>{g.players?.black||""}</span>
                </>
              ) : (
                <span style={{display:"flex", flexDirection:"column", alignItems:"center", gap:2}}>
                  <span style={{fontSize:22, lineHeight:1, opacity: isActive ? 0.85 : 0.45, color: isActive ? "#f5ead8" : WT.borderGold}}>＋</span>
                  <span style={{fontSize:16, opacity:0.75, textAlign:"center", lineHeight:1.3, whiteSpace:"normal", letterSpacing:"0.02em"}}>
                    {playerLang==="en" ? "Start new game" : "新たに対局を始める"}
                  </span>
                </span>
              )}
              </span>
              {/* 未読バッジ */}
              {(hasGameUpdate || hasMsgUpdate) && (
                <span style={{
                  position:"absolute", top:5, right:5,
                  background:"#c03020", color:"#fff",
                  borderRadius:"50%", width:16, height:16,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:9, fontWeight:"bold",
                  boxShadow:"0 1px 4px rgba(192,48,32,0.4)",
                  animation:"pulse 1.5s ease-in-out infinite",
                }}>●</span>
              )}
            </button>
          );
        });

  // 将棋ゲームタブ共通レンダラー
  const renderShogiTabs = () => shogiGames.map((g, i) => {
    const isActive = shogiTab === i;
    const isPlayerInShogiGame = playerName && (g.players?.white===playerName || g.players?.black===playerName);
    const shogiHistLen = (g.history||[]).length;
    const rawShogiLastSeen2 = shogiTabSeen[g.id] || 0;
    const shogiLastSeen = shogiHistLen < rawShogiLastSeen2 ? 0 : rawShogiLastSeen2;
    const myShogiColor = g.players?.black === playerName ? 'b' : 'w';
    const hasShogiGameUpdate = !isActive && isPlayerInShogiGame && g.status==="playing" && shogiHistLen > shogiLastSeen && g.turn === myShogiColor;
    const hasShogiMsgUpdate = isPlayerInShogiGame && !!gameMsgUnread[g.id];
    const wMember = members.find(m => m.name === g.players?.white);
    const bMember = members.find(m => m.name === g.players?.black);
    return (
      <button key={g.id} onClick={() => {
        setShogiTab(i);
        markGameMsgRead(g.id);
        const hl = (g.history||[]).length;
        setShogiTabSeen(prev => {
          const next = {...prev, [g.id]: hl};
          try { localStorage.setItem("shogiTabSeen", JSON.stringify(next)); } catch {}
          if (playerName) set(ref(db, `shogiTabSeen/${playerName}`), next);
          return next;
        });
        if (g.status !== "playing") setShogiStartModal({ gameIndex: i, step:1, opponent:null });
      }} style={{
        position: "relative",
        flex: 1,
        background: isActive ? "linear-gradient(135deg,#D4A888,#b88a6a)" : WT.surfaceHi,
        border: `1px solid ${isActive ? "#b88a6a" : (hasShogiGameUpdate||hasShogiMsgUpdate) ? "#c03020" : WT.border}`,
        borderRadius: 6,
        color: isActive ? "#3a2e22" : WT.text,
        padding: "10px 6px",
        cursor: "pointer",
        fontSize: "clamp(18px,4vw,21px)",
        fontWeight: isActive ? 600 : 400,
        textAlign: "center",
        display: "flex", flexDirection:"column", alignItems: "center", justifyContent:"flex-start", gap:0,
        boxShadow: isActive ? `0 6px 20px rgba(76,46,12,0.22)` : `0 1px 4px rgba(42,26,8,0.05)`,
        transition: "all 0.18s",
        letterSpacing: "0.04em",
        fontFamily: "'Cormorant Garamond','Zen Old Mincho',Georgia,serif",
        minHeight: 88,
      }}>
        <span style={{display:"flex", alignItems:"center", gap:4, alignSelf:"center", paddingTop:2, paddingBottom:4}}>
          <img src={["/shogi/ou.png","/shogi/kaku.png","/shogi/hisha.png"][i] || "/shogi/ou.png"} alt="" style={{width:20,height:20,objectFit:"contain",display:"block"}} />
          <span style={{fontSize:18, opacity:0.85, letterSpacing:"0.06em"}}>No.{i+1}</span>
        </span>
        <span style={{flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:3, width:"100%"}}>
          {g.status==="playing" ? (
            <>
              <span style={{fontSize:"clamp(18px,4vw,21px)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:"100%"}}>{g.players?.white||""}</span>
              <span style={{fontSize:18, opacity:0.85, letterSpacing:"0.08em"}}>vs</span>
              <span style={{fontSize:"clamp(18px,4vw,21px)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:"100%"}}>{g.players?.black||""}</span>
            </>
          ) : (
            <span style={{display:"flex", flexDirection:"column", alignItems:"center", gap:2}}>
              <span style={{fontSize:22, lineHeight:1, opacity: isActive ? 0.85 : 0.45, color: isActive ? "#f5ead8" : WT.borderGold}}>＋</span>
              <span style={{fontSize:16, opacity:0.75, textAlign:"center", lineHeight:1.3, whiteSpace:"normal", letterSpacing:"0.02em"}}>
                {playerLang==="en" ? "Start new game" : "新たに対局を始める"}
              </span>
            </span>
          )}
        </span>
        {/* 未読バッジ（将棋） */}
        {(hasShogiGameUpdate || hasShogiMsgUpdate) && (
          <span style={{
            position:"absolute", top:5, right:5,
            background:"#c03020", color:"#fff",
            borderRadius:"50%", width:16, height:16,
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:9, fontWeight:"bold",
            boxShadow:"0 1px 4px rgba(192,48,32,0.4)",
            animation:"pulse 1.5s ease-in-out infinite",
          }}>●</span>
        )}
      </button>
    );
  });

  return (
    <TransContext.Provider value={{ trans: uiTrans, queue: queueTrans }}>
    <div style={{...pageBg, display:"flex", flexDirection:"column", alignItems: effectiveWide ? "stretch" : "center", padding: effectiveWide ? 0 : "0 0 calc(56px + env(safe-area-inset-bottom, 0px))"}}>

      {/* ─── ヘッダー画像（モバイルのみ）─── */}
      {!effectiveWide && (
        <div className="header-wrap">
          <div style={{maxWidth:"min(640px,96vw)", margin:"0 auto"}}>
            <picture>
              <source media="(max-width: 600px)" srcSet="/header-mobile.webp" />
              <img src="/header.webp" alt="Family Chess — Wooden Traveler Series"
                style={{width:"100%", maxHeight:"clamp(110px, 22vw, 180px)", objectFit:"cover", objectPosition:"left center", display:"block"}}
              />
            </picture>
          </div>
          <div style={{position:"absolute", top:0, left:0, right:0, bottom:0, display:"flex", justifyContent:"center", pointerEvents:"none"}}>
            <div style={{width:"100%", maxWidth:"min(560px,98vw)", padding:"0 12px", boxSizing:"border-box", display:"flex", justifyContent:"flex-end", alignItems:"stretch"}}>
              <button onClick={() => setShowNameSelect(true)} style={{position:"relative", background:"none", border:"none", cursor:"pointer", padding:0, height:"100%", display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"auto"}}>
                {members.find(m=>m.name===playerName)?.avatarUrl ? (
                  <img src={members.find(m=>m.name===playerName).avatarUrl.replace('/avatars/', '/avatars_large/')} alt={playerName}
                    style={{height:"100%", aspectRatio:"1/1", borderRadius:"50%", objectFit:"cover", display:"block", border:"2px solid rgba(255,255,255,0.6)", boxShadow:"0 2px 12px rgba(42,26,8,0.28)"}}
                  />
                ) : (
                  <span style={{height:"100%", aspectRatio:"1/1", borderRadius:"50%", background:"#e8d8c0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"clamp(28px, 6vw, 52px)", border:"2px solid rgba(255,255,255,0.6)", boxShadow:"0 2px 12px rgba(42,26,8,0.28)"}}>👤</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {effectiveWide ? (
        /* ══ PC 3カラムレイアウト（≥1024px or タブレットPC表示）══ */
        <div style={{display:"flex", flexDirection:"row", width:"100%", alignItems:"stretch", minHeight:"100svh", background:"inherit"}}>

          {/* ────────────────────────────────────────────────────
              左カラム（200px・sticky）
              ──────────────────────────────────────────────────── */}
          <aside style={{
            width:200, minWidth:200, flexShrink:0,
            borderRight:"1px solid #faf5e8",
            background:"inherit",
            display:"flex", flexDirection:"column", boxSizing:"border-box",
            position:"sticky", top:0, height:"100svh", overflowY:"auto",
          }}>
            {/* ── ロゴ ── */}
            <div style={{padding:"6px 12px 10px", textAlign:"center"}}>
              <div style={{fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontSize:18, fontWeight:600, color:WT.textDark, letterSpacing:"0.14em", lineHeight:1.2}}>Family Chess</div>
              <div style={{fontFamily:"Georgia,serif", fontSize:9, color:WT.textMuted, letterSpacing:"1.5px", textTransform:"uppercase", opacity:0.8}}>Wooden Traveler Series</div>
            </div>

            {/* ── 現在のユーザー ── */}
            <button onClick={() => setShowNameSelect(true)} style={{
              display:"flex", flexDirection:"column", alignItems:"center", gap:5,
              padding:"8px 0 10px",
              background:"none", border:"none",
              cursor:"pointer", width:"100%", transition:"background 0.15s",
            }}
              onMouseEnter={e=>e.currentTarget.style.background=WT.surfaceHi}
              onMouseLeave={e=>e.currentTarget.style.background="none"}
            >
              {(() => {
                const avatarUrl = members.find(m=>m.name===playerName)?.avatarUrl;
                return avatarUrl
                  ? <img src={avatarUrl} alt={playerName||""} style={{width:150, height:150, borderRadius:"50%", objectFit:"cover", border:"1px solid #c8b090", display:"block", flexShrink:0}} />
                  : <span style={{width:150, height:150, borderRadius:"50%", background:"#f0e8d8", display:"inline-flex", alignItems:"center", justifyContent:"center", fontSize:72, border:"1px solid #c8b090", flexShrink:0}}>👤</span>;
              })()}
              <span style={{fontSize:18, fontWeight:500, color:WT.textDark, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", width:"100%", textAlign:"center", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", marginTop:4}}>{playerName}</span>
            </button>

            {/* ── ナビゲーション ── */}
            <nav style={{display:"flex", flexDirection:"column", gap:1, padding:"10px 8px 0"}}>
              {[
                {label: playerLang==="en" ? "Chess"   : "チェス",   icon:<img src="/pieces/bK.webp" alt="chess" style={{width:18,height:18,objectFit:"contain",display:"block"}}/>, active:!showChat&&!showAnalysisList&&!showPractice&&currentView==="chess",  action:()=>{ setAnalysisData(null); setOpeningData(null); setShowChat(false); setShowAnalysisList(false); setShowSettings(false); setShowPractice(false); switchView("chess"); }},
                {label: playerLang==="en" ? "Shogi"   : "将棋",     icon:<img src={getShogiImg({type:"K",color:"b",p:false})} alt="shogi" style={{width:18,height:18,objectFit:"contain",display:"block"}}/>, active:!showChat&&!showAnalysisList&&!showPractice&&currentView==="shogi",  action:()=>{ setAnalysisData(null); setOpeningData(null); setShowChat(false); setShowAnalysisList(false); setShowSettings(false); setShowPractice(false); switchView("shogi"); }},
                {label: playerLang==="en" ? "Practice" : "練習", icon:"📖", active:!showChat&&!showAnalysisList&&showPractice, action:()=>{ setAnalysisData(null); if(openingData){setOpeningData(null);return;} setOpeningData(null); setShowChat(false); setShowAnalysisList(false); setShowSettings(false); if(showPractice){setShowPractice(false);}else{setShowPractice(true);setPracticeType(currentView==="chess"?"chess":"shogi");} }},
                {label: playerLang==="en" ? "Analysis" : "解析", icon:"📊", active:!showChat&&showAnalysisList, badge:hasAnalysisBadge?"●":null, action:()=>{ setAnalysisData(null); setOpeningData(null); setShowChat(false); setShowSettings(false); openAnalysisList(); }},
                {label: playerLang==="en" ? "Chat"    : "チャット", icon:"💬", active:showChat, badge:chatUnread||null, action:()=>{ setAnalysisData(null); setOpeningData(null); setShowAnalysisList(false); setShowSettings(false); setShowChat(true); }},
                {label: playerLang==="en" ? "Settings": "設定",      icon:"⚙️", active:showSettings, action:()=>{ setAnalysisData(null); setOpeningData(null); setShowChat(false); setShowAnalysisList(false); setShowSettings(true); }},
              ].map(({label,icon,active,badge,action}) => (
                <button key={label} onClick={action||undefined} style={{
                  display:"flex", alignItems:"center", gap:8, padding:"4px 8px",
                  background: active ? "#D4A888" : "transparent",
                  border:"none", borderRadius:6,
                  color: active ? "#3a2e22" : WT.textMid,
                  cursor: action ? "pointer" : "default",
                  fontSize:18, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif",
                  letterSpacing:"0.04em", textAlign:"left", width:"100%", transition:"background 0.15s",
                }}
                onMouseEnter={e=>{ if(!active&&action) e.currentTarget.style.background=WT.surfaceHi; }}
                onMouseLeave={e=>{ if(!active&&action) e.currentTarget.style.background="transparent"; }}
                >
                  {typeof icon==="string" ? <span style={{fontSize:18}}>{icon}</span> : <span style={{width:18,height:18,display:"flex",alignItems:"center",justifyContent:"center"}}>{icon}</span>}
                  <span>{label}</span>
                  {badge ? <span style={{marginLeft:"auto", background:"#c03020", color:"#fff", borderRadius:"50%", minWidth:18, height:18, fontSize:10, fontWeight:"bold", display:"flex", alignItems:"center", justifyContent:"center"}}>{badge > 9 ? "9+" : badge}</span> : null}
                </button>
              ))}
            </nav>

            {/* ── ゲームタブ（縦並び）── チェス・将棋ページのみ表示 */}
            {!showPractice && <div style={{padding:"4px 8px 0"}}>
              <div style={{display:"flex", flexDirection:"column", gap:3}}>
                {currentView==="chess" ? games.map((g, i) => {
                  const isActive = tab === i;
                  const isPlayerInGame = playerName && (g.players?.white===playerName || g.players?.black===playerName);
                  const histLen = (g.history||[]).length;
                  const rawLastSeen = gameTabSeen[g.id] || 0;
                  const lastSeen = histLen < rawLastSeen ? 0 : rawLastSeen;
                  const myChessColor2 = g.players?.white === playerName ? 'w' : 'b';
                  const hasGameUpdate = !isActive && isPlayerInGame && g.status==="playing" && histLen > lastSeen && g.turn === myChessColor2;
                  const wMember = members.find(m => m.name === g.players?.white);
                  const bMember = members.find(m => m.name === g.players?.black);
                  return (
                    <button key={g.id} onClick={() => {
                      setTab(i);
                      setShowPractice(false);
                      const hl = (g.history||[]).length;
                      setGameTabSeen(prev => {
                        const next = {...prev, [g.id]: hl};
                        try { localStorage.setItem("gameTabSeen", JSON.stringify(next)); } catch {}
                        if (playerName) set(ref(db, `gameTabSeen/${playerName}`), next);
                        return next;
                      });
                      try { localStorage.setItem("lastGameTabId", g.id); } catch {}
                      if (g.status !== "playing") setStartModal({gameIndex: i, step:1, opponent:null});
                    }} style={{
                      position:"relative", width:"100%",
                      background: isActive ? "#D4A888" : WT.surfaceHi,
                      border:`1px solid ${isActive ? "#b88a70" : hasGameUpdate ? "#c03020" : (g.status!=="playing" ? WT.borderGold : WT.border)}`,
                      borderRadius:6, color: isActive ? "#3a2e22" : WT.text,
                      padding:"4px 6px", cursor:"pointer",
                      fontSize:18, textAlign:"left",
                      display:"flex", flexDirection:"column", gap:3,
                      boxShadow: isActive ? `0 3px 10px rgba(180,130,100,0.28)` : hasGameUpdate ? `0 2px 6px rgba(192,48,32,0.18)` : "none",
                      transition:"all 0.18s",
                      fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif",
                    }}>
                      <div style={{display:"flex", alignItems:"center", justifyContent:"space-between"}}>
                        <span style={{fontSize:18, opacity:0.85, letterSpacing:"0.06em"}}>No.{i+1}</span>
                        {hasGameUpdate && <span style={{background:"#c03020", color:"#fff", borderRadius:"50%", width:14, height:14, display:"flex", alignItems:"center", justifyContent:"center", fontSize:8, fontWeight:"bold", animation:"pulse 1.5s ease-in-out infinite"}}>●</span>}
                      </div>
                      {g.status==="playing" ? (
                        <div style={{display:"flex", flexDirection:"column", gap:2}}>
                          <div style={{display:"flex", alignItems:"center", gap:4}}>
                            <AvatarIcon url={wMember?.avatarUrl} size={16} name={g.players?.white||""} noPreview />
                            <span style={{fontSize:18, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{g.players?.white||""}</span>
                          </div>
                          <div style={{fontSize:18, opacity:0.7, paddingLeft:4}}>vs</div>
                          <div style={{display:"flex", alignItems:"center", gap:4}}>
                            <AvatarIcon url={bMember?.avatarUrl} size={16} name={g.players?.black||""} noPreview />
                            <span style={{fontSize:18, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{g.players?.black||""}</span>
                          </div>
                        </div>
                      ) : (
                        <div style={{display:"flex", flexDirection:"column", alignItems:"center", padding:"6px 0 4px", gap:3, width:"100%"}}>
                          <span style={{fontSize:26, lineHeight:1, opacity: isActive ? 0.85 : 0.45, color: isActive ? "#f5ead8" : WT.borderGold}}>＋</span>
                          <span style={{fontSize: 16, opacity:0.7, textAlign:"center", lineHeight:1.4, whiteSpace:"normal", letterSpacing:"0.03em"}}>
                            {playerLang==="en" ? "Start new game" : "新たに対局を始める"}
                          </span>
                        </div>
                      )}
                    </button>
                  );
                }) : shogiGames.map((g, i) => {
                  const isActive = shogiTab === i;
                  const isPlayerInShogi = playerName && (g.players?.white===playerName || g.players?.black===playerName);
                  const shogiHistLen = (g.history||[]).length;
                  const rawShogiLastSeen = shogiTabSeen[g.id] || 0;
                  const shogiLastSeen = shogiHistLen < rawShogiLastSeen ? 0 : rawShogiLastSeen;
                  const myShogiColor2 = g.players?.black === playerName ? 'b' : 'w';
                  const hasShogiUpdate = !isActive && isPlayerInShogi && g.status==="playing" && shogiHistLen > shogiLastSeen && g.turn === myShogiColor2;
                  const wMember = members.find(m => m.name === g.players?.white);
                  const bMember = members.find(m => m.name === g.players?.black);
                  return (
                    <button key={g.id} onClick={() => {
                      setShogiTab(i);
                      setShowPractice(false);
                      const hl = (g.history||[]).length;
                      setShogiTabSeen(prev => {
                        const next = {...prev, [g.id]: hl};
                        try { localStorage.setItem("shogiTabSeen", JSON.stringify(next)); } catch {}
                        if (playerName) set(ref(db, `shogiTabSeen/${playerName}`), next);
                        return next;
                      });
                      if (g.status !== "playing") setShogiStartModal({gameIndex: i, step:1, opponent:null});
                    }} style={{
                      position:"relative", width:"100%",
                      background: isActive ? "#D4A888" : WT.surfaceHi,
                      border:`1px solid ${isActive ? "#b88a70" : hasShogiUpdate ? "#c03020" : (g.status!=="playing" ? WT.borderGold : WT.border)}`,
                      borderRadius:6, color: isActive ? "#3a2e22" : WT.text,
                      padding:"4px 6px", cursor:"pointer",
                      fontSize:18, textAlign:"left",
                      display:"flex", flexDirection:"column", gap:3,
                      boxShadow: isActive ? `0 3px 10px rgba(180,130,100,0.28)` : hasShogiUpdate ? `0 2px 6px rgba(192,48,32,0.18)` : "none",
                      transition:"all 0.18s",
                      fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif",
                    }}>
                      <div style={{display:"flex", alignItems:"center", justifyContent:"space-between"}}>
                        <span style={{fontSize:18, opacity:0.85, letterSpacing:"0.06em"}}>No.{i+1}</span>
                        {hasShogiUpdate && <span style={{background:"#c03020", color:"#fff", borderRadius:"50%", width:14, height:14, display:"flex", alignItems:"center", justifyContent:"center", fontSize:8, fontWeight:"bold", animation:"pulse 1.5s ease-in-out infinite"}}>●</span>}
                      </div>
                      {g.status==="playing" ? (
                        <div style={{display:"flex", flexDirection:"column", gap:2}}>
                          <div style={{display:"flex", alignItems:"center", gap:4}}>
                            <AvatarIcon url={wMember?.avatarUrl} size={16} name={g.players?.white||""} noPreview />
                            <span style={{fontSize:18, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{g.players?.white||""}</span>
                          </div>
                          <div style={{fontSize:18, opacity:0.7, paddingLeft:4}}>vs</div>
                          <div style={{display:"flex", alignItems:"center", gap:4}}>
                            <AvatarIcon url={bMember?.avatarUrl} size={16} name={g.players?.black||""} noPreview />
                            <span style={{fontSize:18, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{g.players?.black||""}</span>
                          </div>
                        </div>
                      ) : (
                        <div style={{display:"flex", flexDirection:"column", alignItems:"center", padding:"6px 0 4px", gap:3, width:"100%"}}>
                          <span style={{fontSize:26, lineHeight:1, opacity: isActive ? 0.85 : 0.45, color: isActive ? "#f5ead8" : WT.borderGold}}>＋</span>
                          <span style={{fontSize: 16, opacity:0.7, textAlign:"center", lineHeight:1.4, whiteSpace:"normal", letterSpacing:"0.03em"}}>
                            {playerLang==="en" ? "Start new game" : "新たに対局を始める"}
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>}

            <div style={{marginTop:10}}>
              <DualClock playerLang={playerLang} flat />
            </div>
            <div style={{flex:1}} />
            {/* レイアウト切り替えボタン（PC・タブレット共通） */}
            <div style={{padding:"8px 8px 14px"}}>
              <button onClick={toggleTabletLayout} style={{background:"transparent", border:"1px solid #c8b090", borderRadius:6, color:"#7a5838", padding:"5px 10px", cursor:"pointer", fontSize:17, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", width:"100%", letterSpacing:"0.02em"}}>
                {playerLang==="en" ? "Switch to Tablet View" : "小タブレット表示"}
              </button>
            </div>
          </aside>

          {/* ────────────────────────────────────────────────────
              中央カラム（flex:1, max 600px）
              ──────────────────────────────────────────────────── */}
          <main style={{flex:1, display:"flex", flexDirection:"column", alignItems:"center", padding:"8px 0 16px", minWidth:0, background:"inherit", boxSizing:"border-box"}}>
            {showPractice ? (
              <>
                <div style={{display:"flex",gap:8,padding:"8px 16px 4px",alignSelf:"flex-start"}}>
                  <button onClick={()=>setPracticeType("chess")} style={{background:practiceType==="chess"?"#D4A888":"transparent",border:"1px solid #c8b090",borderRadius:6,color:"#3a2e22",padding:"4px 12px",cursor:"pointer",fontSize:18,fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif"}}>
                    <img src="/pieces/bK.webp" style={{width:18,height:18,objectFit:"contain",verticalAlign:"middle"}}/> {playerLang==="en"?"Chess":"チェス"}
                  </button>
                  <button onClick={()=>setPracticeType("shogi")} style={{background:practiceType==="shogi"?"#D4A888":"transparent",border:"1px solid #c8b090",borderRadius:6,color:"#3a2e22",padding:"4px 12px",cursor:"pointer",fontSize:18,fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif"}}>
                    <img src={getShogiImg({type:"K",color:"b",p:false})} style={{width:18,height:18,objectFit:"contain",verticalAlign:"middle"}}/> {playerLang==="en"?"Shogi":"将棋"}
                  </button>
                </div>
                {practiceType==="chess"
                  ? <ChessPracticeBoard key={playerName} playerLang={playerLang} pcLayout={true} hideRules={true} playerName={playerName} onAnalyze={handlePracticeAnalyze} startInFullScreen={practiceStartFs} onSwitchToGame={handleSwitchPracticeGame} onFsConsumed={()=>setPracticeStartFs(false)} onOpenOpening={openOpening} onOpenTactic={openTactic}/>
                  : <ShogiPracticeBoard key={playerName} playerLang={playerLang} pcLayout={true} hideRules={true} playerName={playerName} onAnalyze={handlePracticeAnalyze} startInFullScreen={practiceStartFs} onSwitchToGame={handleSwitchPracticeGame} onFsConsumed={()=>setPracticeStartFs(false)} onOpenOpening={openOpening} onOpenTactic={openTactic}/>
                }
              </>
            ) : currentView==="chess" ? (
              <GamePanel
                key={games[tab].id}
                game={games[tab]}
                onUpdate={g=>update(tab,g)}
                playerName={playerName}
                playerLang={playerLang}
                gameIndex={tab}
                onStartModal={setStartModal}
                memberNames={memberNames}
                isKids={isKids}
                members={members}
                pcLayout={true}
                faceToFaceActive={pcF2F}
                onFaceToFaceEnd={() => setPcF2F(false)}
                gameMsgSeenTs={gameMsgSeen[games[tab].id] || ""}
                onMsgSeen={() => markGameMsgRead(games[tab].id)}
                             />
            ) : (
              <ShogiPanel
                key={shogiGames[shogiTab].id}
                game={shogiGames[shogiTab]}
                onUpdate={g=>updateShogi(shogiTab,g)}
                playerName={playerName}
                playerLang={playerLang}
                gameIndex={shogiTab}
                members={members}
                pcLayout={true}
                onStartModal={setShogiStartModal}
                onToggleLayout={null}
                isKids={isKids}
                faceToFaceActive={pcF2F}
                onFaceToFaceEnd={() => setPcF2F(false)}
                gameMsgSeenTs={gameMsgSeen[shogiGames[shogiTab].id] || ""}
                onMsgSeen={() => markGameMsgRead(shogiGames[shogiTab].id)}
                             />
            )}
          </main>

          {/* ────────────────────────────────────────────────────
              右カラム（260px・sticky）
              ──────────────────────────────────────────────────── */}
          <aside style={{
            width:260, minWidth:260, flexShrink:0,
            borderLeft:"1px solid #faf5e8",
            background:"inherit",
            padding:"8px 12px",
            boxSizing:"border-box",
            overflowY:"auto",
          }}>
            {showPractice ? (
              <div style={{fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontSize:18, color:"#3a2e22", padding:"4px 0"}}>
                {/* 駒ガイド */}
                <div style={{fontSize:16, letterSpacing:"2px", color:"#a89070", textTransform:"uppercase", marginBottom:8, textAlign:"center"}}>
                  {playerLang==="en"?"Piece Guide":"駒ガイド"}
                </div>
                {practiceType==="chess" ? (
                  <>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:5,marginBottom:12}}>
                      {CHESS_PIECE_LIST.map(p=>(
                        <div key={p.type} style={{background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"6px 5px",display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                          <img src={p.img} alt={p.type} style={{width:30,height:30,objectFit:"contain"}}/>
                          <div style={{fontWeight:600,fontSize:16,color:"#3a2e22",textAlign:"center",lineHeight:1.2}}>{playerLang==="en"?p.nameEn:p.nameJa}</div>
                          <div style={{fontSize:16,color:"#c4a058",fontWeight:600,textAlign:"center"}}>{p.pts}{playerLang==="en"?" pt":" 点"}</div>
                          <div style={{fontSize:16,color:"#7a5828",lineHeight:1.4,textAlign:"left",alignSelf:"stretch"}}>{playerLang==="en"?p.descEn:p.descJa}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 12px",marginTop:8}}>
                      <div style={{fontWeight:600,fontSize:16,color:"#3a2e22",marginBottom:7}}>{playerLang==="en"?"Effective Formations":"効果的な陣形"}</div>
                      {(showAllAppChessFormations?CHESS_FORMATIONS:CHESS_FORMATIONS.slice(0,4)).map(f=>(
                        <div key={f.id} onClick={()=>setAppFormationModal({formation:f,gameType:"chess"})}
                          style={{display:"flex",alignItems:"center",gap:8,marginBottom:7,cursor:"pointer",padding:"3px 4px",borderRadius:5,background:"rgba(200,168,106,0.08)"}}>
                          <ChessFormBoard pieces={f.pieces} cellSize={7}/>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontWeight:600,fontSize:16,color:"#3a2e22"}}>{playerLang==="en"?f.nameEn:f.nameJa}</div>
                            <div style={{fontSize:16,color:"#7a5828",lineHeight:1.4}}>{playerLang==="en"?f.descEn:f.descJa}</div>
                          </div>
                        </div>
                      ))}
                      {CHESS_FORMATIONS.length>4&&(
                        <button onClick={()=>setShowAllAppChessFormations(v=>!v)} style={{width:"100%",background:"transparent",border:"1px solid #c8b090",borderRadius:6,color:"#7a5838",padding:"4px",cursor:"pointer",fontSize:16,marginTop:2}}>
                          {showAllAppChessFormations?(playerLang==="en"?"Show Less":"閉じる"):(playerLang==="en"?"Show More":"もっと見る")}
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    {SHOGI_PIECE_LIST_BASE.map(base=>{
                      const promInfo = base.promType ? SHOGI_PIECE_LIST_PROM.find(p=>p.type===base.promType) : null;
                      const baseSrc = getShogiImg({type:base.type,color:"b",p:false});
                      const promSrc = promInfo ? getShogiImg({type:promInfo.type,color:"b",p:true}) : null;
                      return (
                        <div key={base.type} style={{display:"flex",alignItems:"stretch",gap:4,marginBottom:5}}>
                          <div style={{flexBasis:"calc(50% - 13px)",flexShrink:0,flexGrow:0,minWidth:0,display:"flex",flexDirection:"column",alignItems:"center",gap:1,padding:"4px 3px",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:6}}>
                            <img src={baseSrc} alt="" style={{width:24,height:24,objectFit:"contain"}}/>
                            <div style={{fontSize:16,fontWeight:600,color:"#3a2e22",textAlign:"center",lineHeight:1.2}}>{playerLang==="en"?base.nameEn:base.nameJa}</div>
                            <div style={{fontSize:16,color:"#c4a058",fontWeight:600,textAlign:"center"}}>{base.pts}{playerLang==="en"?" pt":" 点"}</div>
                            <div style={{fontSize:16,color:"#7a5828",textAlign:"center",lineHeight:1.3}}>{playerLang==="en"?base.descEn:base.descJa}</div>
                          </div>
                          <div style={{width:18,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",color:promInfo?"#a89070":"transparent",fontSize:16,userSelect:"none"}}>→</div>
                          <div style={{flexBasis:"calc(50% - 13px)",flexShrink:0,flexGrow:0,minWidth:0,display:"flex",flexDirection:"column",alignItems:"center",gap:1,padding:promInfo?"4px 3px":"0",background:promInfo?"#fff8ec":"transparent",border:promInfo?"1px solid #d4bc88":"none",borderRadius:6}}>
                            {promInfo && <>
                              <img src={promSrc} alt="" style={{width:24,height:24,objectFit:"contain"}}/>
                              <div style={{fontSize:16,fontWeight:600,color:"#8a3000",textAlign:"center",lineHeight:1.2}}>{playerLang==="en"?promInfo.nameEn:promInfo.nameJa}</div>
                              <div style={{fontSize:16,color:"#c4a058",fontWeight:600,textAlign:"center"}}>{promInfo.pts}{playerLang==="en"?" pt":" 点"}</div>
                              <div style={{fontSize:16,color:"#7a5828",textAlign:"center",lineHeight:1.3}}>{playerLang==="en"?promInfo.descEn:promInfo.descJa}</div>
                            </>}
                          </div>
                        </div>
                      );
                    })}
                    <div style={{width:"100%",boxSizing:"border-box",background:"#faf5e8",border:"1px solid #e0d0b0",borderRadius:8,padding:"8px 12px",marginTop:8}}>
                      <div style={{fontWeight:600,fontSize:16,color:"#3a2e22",marginBottom:7}}>{playerLang==="en"?"Effective Formations":"効果的な陣形"}</div>
                      {(showAllAppShogiFormations?SHOGI_FORMATIONS:SHOGI_FORMATIONS.slice(0,4)).map(f=>(
                        <div key={f.id} onClick={()=>setAppFormationModal({formation:f,gameType:"shogi"})}
                          style={{display:"flex",alignItems:"center",gap:8,marginBottom:7,cursor:"pointer",padding:"3px 4px",borderRadius:5,background:"rgba(200,168,106,0.08)"}}>
                          <ShogiFormBoard pieces={f.pieces} cellSize={6} getShogiImg={getShogiImg}/>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontWeight:600,fontSize:16,color:"#3a2e22"}}>{playerLang==="en"?f.nameEn:f.nameJa}</div>
                            <div style={{fontSize:16,color:"#7a5828",lineHeight:1.4}}>{playerLang==="en"?f.descEn:f.descJa}</div>
                          </div>
                        </div>
                      ))}
                      {SHOGI_FORMATIONS.length>4&&(
                        <button onClick={()=>setShowAllAppShogiFormations(v=>!v)} style={{width:"100%",background:"transparent",border:"1px solid #c8b090",borderRadius:6,color:"#7a5838",padding:"4px",cursor:"pointer",fontSize:16,marginTop:2}}>
                          {showAllAppShogiFormations?(playerLang==="en"?"Show Less":"閉じる"):(playerLang==="en"?"Show More":"もっと見る")}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ) : currentView==="chess" ? (
              <GameRightPanel
                game={games[tab]}
                onUpdate={g=>update(tab,g)}
                playerName={playerName}
                playerLang={playerLang}
                members={members}
                isKids={isKids}
                gameIndex={tab}
                onStartModal={setStartModal}
                onFaceToFace={() => setPcF2F(true)}
                             />
            ) : (
              <ShogiRightPanel
                game={shogiGames[shogiTab]}
                onUpdate={g=>updateShogi(shogiTab,g)}
                playerName={playerName}
                playerLang={playerLang}
                members={members}
                gameIndex={shogiTab}
                onStartModal={setShogiStartModal}
                isKids={isKids}
                onFaceToFace={() => setPcF2F(true)}
                             />
            )}
          </aside>

        </div>
      ) : (
        /* ══ モバイル シングルカラム（＜1024px）══ */
        <>
          <div style={{width:"100%", maxWidth:"min(560px,98vw)", padding:"16px 12px 0", boxSizing:"border-box"}}></div>
          {!showPractice && (
          <div style={{display:"flex", flexDirection:"row", gap:6, marginBottom:4, width:"100%", maxWidth:"min(560px,98vw)", padding:"0 12px", boxSizing:"border-box"}}>
            {currentView==="chess" ? renderGameTabs() : renderShogiTabs()}
          </div>
          )}
          {showPractice ? (
            <>
              <div style={{display:"flex",gap:8,padding:"4px 12px 8px",justifyContent:"center"}}>
                <button onClick={()=>setPracticeType("chess")} style={{background:practiceType==="chess"?"#D4A888":"transparent",border:"1px solid #c8b090",borderRadius:6,color:"#3a2e22",padding:"4px 12px",cursor:"pointer",fontSize:18,fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif"}}>
                  <img src="/pieces/bK.webp" style={{width:18,height:18,objectFit:"contain",verticalAlign:"middle"}}/> {playerLang==="en"?"Chess":"チェス"}
                </button>
                <button onClick={()=>setPracticeType("shogi")} style={{background:practiceType==="shogi"?"#D4A888":"transparent",border:"1px solid #c8b090",borderRadius:6,color:"#3a2e22",padding:"4px 12px",cursor:"pointer",fontSize:18,fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif"}}>
                  <img src={getShogiImg({type:"K",color:"b",p:false})} style={{width:18,height:18,objectFit:"contain",verticalAlign:"middle"}}/> {playerLang==="en"?"Shogi":"将棋"}
                </button>
              </div>
              {practiceType==="chess"
                ? <ChessPracticeBoard key={playerName} playerLang={playerLang} pcLayout={false} playerName={playerName} onAnalyze={handlePracticeAnalyze} startInFullScreen={practiceStartFs} onSwitchToGame={handleSwitchPracticeGame} onFsConsumed={()=>setPracticeStartFs(false)} onOpenOpening={openOpening} onOpenTactic={openTactic}/>
                : <ShogiPracticeBoard key={playerName} playerLang={playerLang} pcLayout={false} playerName={playerName} onAnalyze={handlePracticeAnalyze} startInFullScreen={practiceStartFs} onSwitchToGame={handleSwitchPracticeGame} onFsConsumed={()=>setPracticeStartFs(false)} onOpenOpening={openOpening} onOpenTactic={openTactic}/>
              }
              {toggleTabletLayout && (
                <div style={{padding:"8px 12px 20px"}}>
                  <button onClick={toggleTabletLayout} style={{width:"100%", background:"transparent", border:"1px solid #c8b090", borderRadius:6, color:"#7a5838", padding:"5px 12px", cursor:"pointer", fontSize:"clamp(18px,4vw,22px)", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", letterSpacing:"0.03em"}}>
                    {playerLang==="en" ? "Switch to PC View" : "PC表示に切り替える"}
                  </button>
                </div>
              )}
            </>
          ) : currentView==="chess" ? (
            <GamePanel key={games[tab].id} game={games[tab]} onUpdate={g=>update(tab,g)} playerName={playerName} playerLang={playerLang} gameIndex={tab} onStartModal={setStartModal} memberNames={memberNames} isKids={isKids} members={members} onToggleLayout={toggleTabletLayout} gameMsgSeenTs={gameMsgSeen[games[tab].id]||""} onMsgSeen={()=>markGameMsgRead(games[tab].id)} onAnalyze={openAnalysis} onFaceToFaceChange={setMobileF2F} />
          ) : (
            <ShogiPanel key={shogiGames[shogiTab].id} game={shogiGames[shogiTab]} onUpdate={g=>updateShogi(shogiTab,g)} playerName={playerName} playerLang={playerLang} gameIndex={shogiTab} members={members} pcLayout={false} onStartModal={setShogiStartModal} onToggleLayout={toggleTabletLayout} isKids={isKids} gameMsgSeenTs={gameMsgSeen[shogiGames[shogiTab].id]||""} onMsgSeen={()=>markGameMsgRead(shogiGames[shogiTab].id)} onAnalyze={openAnalysis} onFaceToFaceChange={setMobileF2F} />
          )}
        </>
      )}

      {/* ゲーム開始モーダル */}
      {startModal !== null && (
        <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000}}>
          {startModal.step === 1 ? (
            <div style={modalBox}>
              <h3 style={{fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontWeight:500, color:"#3a2e22", fontSize:"clamp(19px,4vw,24px)", margin:0, letterSpacing:"0.06em", lineHeight:1.4}}>
                {t("対戦相手を選んでください", "Choose your opponent", "だれとあそぶ？", "Who do you want to play?")}
              </h3>
              <p style={{color:"#7a6040", fontSize:18, margin:0}}>
                {playerName} {t("の対戦相手", "'s opponent", "のあいて", "'s opponent")}
              </p>
              {members.filter(m => m.name !== playerName).map(m => (
                <button key={m.name}
                  onClick={() => setStartModal({...startModal, step:2, opponent:m.name})}
                  style={btnModalPrimary}>
                  {m.name}{m.kids && " 🐥"}
                </button>
              ))}
              {/* ルール選択チェックボックス */}
              <div style={{borderTop:"1px solid #e8d8b4", paddingTop:12, textAlign:"left", width:"100%"}}>
                <div style={{fontFamily:"Georgia,serif", fontSize:16, letterSpacing:"1.5px", color:"#a89070", textTransform:"uppercase", marginBottom:8, opacity:0.8}}>
                  {playerLang==="en" ? "Rules" : "適用するルール"}
                </div>
                {[
                  {key:"castling",   ja:"キャスリング",   en:"Castling"},
                  {key:"promotion",  ja:"プロモーション", en:"Promotion"},
                  {key:"enPassant",  ja:"アンパッサン",   en:"En Passant"},
                ].map(({key, ja, en}) => (
                  <label key={key} style={{display:"flex", alignItems:"center", gap:8, marginBottom:6, cursor:"pointer", fontSize:18, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", color:"#3a2e22"}}>
                    <input type="checkbox"
                      checked={startModal.rules?.[key] ?? true}
                      onChange={e => setStartModal({...startModal, rules:{...(startModal.rules||{castling:true,promotion:true,enPassant:true}), [key]:e.target.checked}})}
                      style={{width:16, height:16, accentColor:"#7a5638"}} />
                    {playerLang==="en" ? en : ja}
                  </label>
                ))}
              </div>
              <button onClick={() => setStartModal(null)} style={btnModalCancel}>
                {t("キャンセル", "Cancel", "やめる", "Cancel")}
              </button>
            </div>
          ) : (
            <div style={modalBox}>
              <h3 style={{fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontWeight:500, color:"#3a2e22", fontSize:"clamp(19px,4vw,24px)", margin:0, letterSpacing:"0.06em", lineHeight:1.4}}>
                {t("あなたの色を選んでください", "Choose your color", "なんいろであそぶ？", "Pick your color!")}
              </h3>
              <p style={{color:"#7a6040", fontSize:18, margin:0}}>
                {playerName} vs {startModal.opponent}
              </p>
              {[
                {label: t("⬜ 白番（先手）", "⬜ White (First)", "⬜ しろ！", "⬜ White!"),  color:"w"},
                {label: t("⬛ 黒番（後手）", "⬛ Black (Second)", "⬛ くろ！", "⬛ Black!"), color:"b"},
                {label: t("🎲 ランダム", "🎲 Random", "🎲 おまかせ！", "🎲 Surprise me!"), color:"r"},
              ].map(({label, color}) => (
                <button key={color} onClick={() => {
                  const myColor  = color==="r" ? (Math.random()<0.5?"w":"b") : color;
                  const opponent = startModal.opponent;
                  const players  = myColor==="w"
                    ? {white:playerName, black:opponent}
                    : {white:opponent,   black:playerName};
                  const whiteBadge = members.find(m => m.name === players.white)?.kids ? " 🐥" : "";
                  const blackBadge = members.find(m => m.name === players.black)?.kids ? " 🐥" : "";
                  const newName  = `⬜ ${players.white}${whiteBadge} 対 ⬛ ${players.black}${blackBadge}`;
                  const gi       = startModal.gameIndex;

                  // flipped は localStorage のみで管理 — Firebase には保存しない
                  localStorage.setItem(`game_${games[gi].id}_flipped`, String(myColor === "b"));

                  (async () => {
                    const chatRoomId = await findOrCreateDmRoomDb(players.white, players.black);
                    update(gi, {
                      ...games[gi],
                      name: newName,
                      board: mkBoard(),
                      turn: "w",
                      history: [],
                      status: "playing",
                      players,
                      undoRequest: null,
                      redoHistory: [],
                      chatRoomId,
                      startedAt: new Date().toISOString(),
                      rules: startModal.rules || {castling:true, promotion:true, enPassant:true},
                    });
                    setStartModal(null);
                  })().catch(e => console.warn("[startChess]", e));
                }} style={btnModalPrimary}>{label}</button>
              ))}
              <button onClick={() => setStartModal({...startModal, step:1, opponent:null})} style={btnModalCancel}>
                {t("← 戻る", "← Back", "← もどる", "← Back")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 将棋ゲーム開始モーダル */}
      {shogiStartModal !== null && (
        <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000}}>
          {shogiStartModal.step === 1 ? (
            <div style={modalBox}>
              <h3 style={{fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontWeight:500, color:"#3a2e22", fontSize:"clamp(19px,4vw,24px)", margin:0, letterSpacing:"0.06em", lineHeight:1.4}}>
                {playerLang==="en" ? "Choose your opponent" : "対戦相手を選んでください"}
              </h3>
              <p style={{color:"#7a6040", fontSize:18, margin:0}}>
                {playerName}{playerLang==="en" ? "'s opponent" : " の対戦相手"}
              </p>
              {members.filter(m => m.name !== playerName).map(m => (
                <button key={m.name}
                  onClick={() => setShogiStartModal({...shogiStartModal, step:2, opponent:m.name})}
                  style={btnModalPrimary}>
                  {m.name}{m.kids && " 🐥"}
                </button>
              ))}
              <button onClick={() => setShogiStartModal(null)} style={btnModalCancel}>
                {playerLang==="en" ? "Cancel" : "キャンセル"}
              </button>
            </div>
          ) : (
            <div style={modalBox}>
              <h3 style={{fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontWeight:500, color:"#3a2e22", fontSize:"clamp(19px,4vw,24px)", margin:0, letterSpacing:"0.06em", lineHeight:1.4}}>
                {playerLang==="en" ? "Choose your side" : "あなたの手番を選んでください"}
              </h3>
              <p style={{color:"#7a6040", fontSize:18, margin:0}}>
                {playerName} vs {shogiStartModal.opponent}
              </p>
              {[
                {label: playerLang==="en" ? "☗ Black (First)" : "☗ 先手（黒）", color:"b"},
                {label: playerLang==="en" ? "☖ White (Second)" : "☖ 後手（白）", color:"w"},
                {label: playerLang==="en" ? "🎲 Random" : "🎲 ランダム", color:"r"},
              ].map(({label, color}) => (
                <button key={color} onClick={() => {
                  const myColor = color==="r" ? (Math.random()<0.5?"b":"w") : color;
                  const opponent = shogiStartModal.opponent;
                  const players = myColor==="b"
                    ? {black: playerName, white: opponent}
                    : {black: opponent,   white: playerName};
                  const blackBadge = members.find(m => m.name === players.black)?.kids ? " 🐥" : "";
                  const whiteBadge = members.find(m => m.name === players.white)?.kids ? " 🐥" : "";
                  const newName = `☗ ${players.black}${blackBadge} 対 ☖ ${players.white}${whiteBadge}`;
                  const gi = shogiStartModal.gameIndex;
                  (async () => {
                    const chatRoomId = await findOrCreateDmRoomDb(players.black, players.white);
                    // flipped: w（後手）視点のときフリップ
                    localStorage.setItem(`shogi_${shogiGames[gi].id}_flipped`, String(myColor === "w"));
                    updateShogi(gi, {
                      ...shogiGames[gi],
                      name: newName,
                      board: mkShogiBoard(),
                      turn: "b",
                      history: [],
                      status: "playing",
                      players,
                      cap: {b:{}, w:{}},
                      undoRequest: null,
                      redoHistory: [],
                      chatRoomId,
                      startedAt: new Date().toISOString(),
                    });
                    setShogiStartModal(null);
                  })().catch(e => console.warn("[startShogi]", e));
                }} style={btnModalPrimary}>{label}</button>
              ))}
              <button onClick={() => setShogiStartModal({...shogiStartModal, step:1, opponent:null})} style={btnModalCancel}>
                {playerLang==="en" ? "← Back" : "← 戻る"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* チャット全画面UI */}
      {showChat && (
        <div style={{position:"fixed", top:0, left:0, right:0,
                     bottom: effectiveWide ? 0 : "calc(56px + env(safe-area-inset-bottom, 0px))",
                     background:"#f7f0e6", display:"flex", flexDirection:"column", zIndex:2000, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif"}}>
          <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 16px", background:"linear-gradient(135deg,#D4A888,#b88a6a)", boxShadow:"0 2px 8px rgba(60,40,20,0.18)", flexShrink:0}}>
            <h2 style={{color:"#3a2e22", margin:0, fontSize:"clamp(19px,4vw,24px)", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", letterSpacing:"0.06em"}}>💬 {t("チャット","Chat","チャット","Chat")}</h2>
            {effectiveWide && (
              <button onClick={() => setShowChat(false)} style={{background:"rgba(42,26,8,0.08)", border:"1px solid rgba(42,26,8,0.2)", borderRadius:8, color:"#3a2e22", padding:"6px 14px", cursor:"pointer", fontSize:18}}>
                ✕ {t("閉じる","Close","とじる","Close")}
              </button>
            )}
          </div>
          <div style={{display:"flex", flex:1, minHeight:0}}>
            {/* 左サイドバー：ルーム一覧 */}
            <div style={{width:"clamp(100px,28%,180px)", background:"#f2ebe0", borderRight:"1px solid #e0d4c0", display:"flex", flexDirection:"column", flexShrink:0}}>
              <div style={{padding:"10px 8px", borderBottom:"1px solid #e0d4c0", display:"flex", alignItems:"center", justifyContent:"space-between"}}>
                <span style={{fontWeight:"bold", fontSize:18, color:"#8a5a3a"}}>{t("ルーム","Rooms","ルーム","Rooms")}</span>
                <button onClick={() => setShowNewRoom(true)} style={{background:"#D4A888", border:"none", borderRadius:6, color:"#3a2e22", width:22, height:22, cursor:"pointer", fontSize:18, display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1}}>+</button>
              </div>
              <div style={{flex:1, overflowY:"auto"}}>
                {(() => {
                  const visibleRooms = chatRooms.filter(r => {
                    if (r.isPublic) return true;
                    if (r.createdBy === playerName) return true;
                    const mArr = Array.isArray(r.members) ? r.members : (r.members && typeof r.members === "object" ? Object.values(r.members) : []);
                    if (mArr.includes(playerName)) return true;
                    return false;
                  });
                  // ゲームに chatRoomId が設定されているが chatRooms にメタデータがないルームを補完
                  const visibleIds = new Set(visibleRooms.map(r => r.id));
                  const allMyGames = [
                    ...(games || []).filter(g => g.chatRoomId && (g.players?.white === playerName || g.players?.black === playerName)),
                    ...(shogiGames || []).filter(g => g.chatRoomId && (g.players?.white === playerName || g.players?.black === playerName)),
                  ];
                  allMyGames.forEach(g => {
                    if (!g.chatRoomId || visibleIds.has(g.chatRoomId)) return;
                    const other = g.players?.white === playerName ? g.players?.black : g.players?.white;
                    visibleRooms.push({ id: g.chatRoomId, type: "direct", name: `${playerName} & ${other}`, members: [playerName, other], createdBy: playerName, createdAt: "" });
                    visibleIds.add(g.chatRoomId);
                  });
                  return visibleRooms.sort((a, b) => {
                    const lastA = roomLastMsgTs[a.id] || a.lastMessageAt || a.createdAt || "";
                    const lastB = roomLastMsgTs[b.id] || b.lastMessageAt || b.createdAt || "";
                    return lastB > lastA ? 1 : lastB < lastA ? -1 : 0;
                  });
                })().map(room => {
                  const msgs = roomMessages[room.id] || [];
                  const unread = perRoomUnread[room.id] || 0;
                  const lastMsg = msgs[msgs.length - 1];
                  const roomIcon = room.type === "direct" ? "👤" : room.type === "group" ? "👥" : "🌐";
                  return (
                    <button key={room.id} onClick={() => {
                      setActiveRoomId(room.id);
                      const _now = new Date().toISOString();
                      setLastReadTs(prev => ({...prev, [room.id]: _now}));
                      set(ref(db, `userReadTs/${playerName}/${room.id}`), _now).catch(() => {});
                    }} style={{width:"100%", textAlign:"left", padding:"10px 8px", background: activeRoomId===room.id ? "#f8f0e0" : "transparent", border:"none", borderBottom:"1px solid #e8ddd0", cursor:"pointer", borderLeft: activeRoomId===room.id ? "3px solid #D4A888" : "3px solid transparent"}}>
                      <div style={{display:"flex", alignItems:"center", justifyContent:"space-between"}}>
                        <span style={{fontWeight:"bold", fontSize:18, color:"#3a2e22", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1, display:"flex", alignItems:"center", gap:6}}>
                          {room.type === "direct" ? (() => {
                            const otherName = room.members?.find(m => m !== playerName) || "";
                            const otherMember = (members||[]).find(m => m.name === otherName);
                            return <><AvatarIcon url={otherMember?.avatarUrl} size={24} name={otherName} noPreview /><span style={{overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{otherName}</span></>;
                          })() : <>{roomIcon} {getRoomDisplayName(room, playerName)}</>}
                        </span>
                        {unread > 0 && (
                          <span style={{background:"#8a3322", color:"#ffe8e0", borderRadius:"50%", minWidth:20, height:20, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, fontWeight:"bold", flexShrink:0}}>
                            {unread}
                          </span>
                        )}
                      </div>
                      {lastMsg && (
                        <div style={{fontSize:18, color:"#9a8876", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                          {lastMsg.sender}: {lastMsg.text}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 右側：メッセージエリア */}
            <div style={{flex:1, display:"flex", flexDirection:"column", minWidth:0, overflowY:"hidden"}}>
              {activeRoomId ? (
                <>
                  {(() => {
                    const room = chatRooms.find(r => r.id === activeRoomId);
                    const roomIcon = room?.type === "direct" ? "👤" : room?.type === "group" ? "👥" : "🌐";
                    return (
                      <div style={{padding:"10px 16px", background:"#faf6f0", borderBottom:"1px solid #e0d4c0", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0}}>
                        <div style={{flex:1, minWidth:0}}>
                          <div style={{fontWeight:"bold", color:"#3a2e22", fontSize:"clamp(18px,4vw,21px)", display:"flex", alignItems:"center", gap:8}}>
                            {room?.type === "direct" ? (() => {
                              const otherName = room.members?.find(m => m !== playerName) || "";
                              const otherMember = (members||[]).find(m => m.name === otherName);
                              return <>
                                <AvatarIcon url={otherMember?.avatarUrl} size={32} name={otherName} noPreview />
                                <span>{otherName}</span>
                              </>;
                            })() : <>{roomIcon} {getRoomDisplayName(room, playerName)}</>}
                          </div>
                          {room?.type === "group" && Array.isArray(room.members) && (
                            <div style={{fontSize:18, color:"#9a8876", marginTop:2}}>
                              👥 {room.members.join(" · ")}
                            </div>
                          )}
                        </div>
                        <div style={{display:"flex", gap:6, flexShrink:0}}>
                          {room?.type === "group" && Array.isArray(room.members) && room.members.includes(playerName) && (
                            <button onClick={() => {
                              const newName = window.prompt(t("グループ名を変更", "Rename group"), room.name);
                              if (newName && newName.trim()) {
                                set(ref(db, `chatRooms/${activeRoomId}/name`), newName.trim());
                              }
                            }} style={{background:"none", border:"1px solid #c8a060", borderRadius:6, color:"#7a5030", padding:"3px 10px", cursor:"pointer", fontSize:18}}>
                              ✏️ {t("名前変更", "Rename")}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                  <div style={{flex:1, overflowY:"auto", padding:"14px 16px", display:"flex", flexDirection:"column", gap:12}}>
                    {(roomMessages[activeRoomId] || []).length === 0 && (
                      <div style={{textAlign:"center", color:"#b0a090", marginTop:40, fontSize:18}}>
                        {t("まだメッセージはありません","No messages yet","まだメッセージはないよ","No messages yet")}
                      </div>
                    )}
                    {(roomMessages[activeRoomId] || []).map((m) => {
                      const isMe = m.sender === playerName;
                      return (
                        <div key={m.id} style={{display:"flex", flexDirection:"column", alignItems: isMe ? "flex-end" : "flex-start"}}>
                          <div style={{display:"flex", alignItems:"center", gap:6, marginBottom:4, flexDirection: isMe ? "row-reverse" : "row"}}>
                            <AvatarIcon url={members.find(mb=>mb.name===m.sender)?.avatarUrl} size={28} name={m.sender} />
                            <span style={{fontWeight:500, fontSize:18, color:"#8a5a3a", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", letterSpacing:"0.04em"}}>
                              {m.sender}{members.find(mb=>mb.name===m.sender)?.kids ? " 🐥" : ""}
                            </span>
                            <span style={{color:"#b0a090", fontSize:18, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontStyle:"italic"}}>{fmtDualT(m.ts, playerLang)}</span>
                            {m.gameId && (
                              <span style={{fontSize:16, background: m.gameType==="shogi" ? "#e8f0f8" : "#f0ece0", color: m.gameType==="shogi" ? "#4a6a8a" : "#7a5a28", borderRadius:6, padding:"1px 6px", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", letterSpacing:"0.03em", whiteSpace:"nowrap"}}>
                                {m.gameType==="shogi" ? <img src="/shogi/ou.png" alt="shogi" style={{width:14,height:14,objectFit:"contain",verticalAlign:"middle",display:"inline-block"}}/> : <img src="/pieces/bK.webp" alt="chess" style={{width:14,height:14,objectFit:"contain",verticalAlign:"middle",display:"inline-block"}}/>} {m.gameName || `No.${m.gameId?.slice(-1)}`}
                              </span>
                            )}
                            {m.fromChat && !m.gameId && (
                              <span style={{fontSize:16, background:"#eef4ec", color:"#4a7a5a", borderRadius:6, padding:"1px 6px", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", letterSpacing:"0.03em", whiteSpace:"nowrap"}}>
                                💬 {playerLang==="en" ? "Chat" : "チャット"}
                              </span>
                            )}
                          </div>
                          <div style={{maxWidth:"78%", position:"relative"}}>
                            {/* 吹き出し本体（長押し/右クリックでリアクションピッカー） */}
                            {(() => {
                              const longPressTimer = { current: null };
                              const startLP = () => { longPressTimer.current = setTimeout(() => setChatReactionPicker({msgId: m.id, roomId: activeRoomId}), 500); };
                              const cancelLP = () => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; } };
                              return (
                                <div
                                  onTouchStart={startLP} onTouchEnd={cancelLP} onTouchMove={cancelLP}
                                  onContextMenu={e => { e.preventDefault(); setChatReactionPicker({msgId: m.id, roomId: activeRoomId}); }}
                                  style={{background: m.reactionEmoji ? "transparent" : (isMe ? "linear-gradient(135deg,#D4A888,#b88a6a)" : "#fffdf8"), color:"#3a2e22", borderRadius: isMe ? "16px 4px 16px 16px" : "4px 16px 16px 16px", padding: m.reactionEmoji ? "2px 4px" : "10px 14px", boxShadow: m.reactionEmoji ? "none" : "0 1px 4px rgba(60,40,20,0.10)", border: (isMe || m.reactionEmoji) ? "none" : "1px solid #e0d4c0", cursor:"default", userSelect:"none"}}
                                >
                                  {m.reactionEmoji
                                    ? <span style={{fontSize:"clamp(15px,3.5vw,18px)", color:"#8a6848", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", fontStyle:"italic"}}>{m.text}</span>
                                    : <>
                                        {m.text && <div style={{fontSize:"clamp(18px,4vw,21px)", lineHeight:1.6}}>{m.text}</div>}
                                        {m.translation && (
                                          <div style={{fontSize:"clamp(18px,4vw,21px)", marginTop:4, lineHeight:1.5, color: isMe ? "rgba(245,234,216,0.75)" : "#7a6040", borderTop: isMe ? "1px solid rgba(245,234,216,0.2)" : "1px solid #e0d4c0", paddingTop:4}}>
                                            {m.isJP ? "🇺🇸" : "🇯🇵"} {m.translation}
                                          </div>
                                        )}
                                      </>
                                  }
                                </div>
                              );
                            })()}
                            {isMe && !m.reactionEmoji && (
                              <button onClick={() => { remove(ref(db, `chat/${activeRoomId}/${m.id}`)); }} style={{position:"absolute", top:-6, right:-6, background:"#8a3322", border:"none", borderRadius:"50%", color:"#ffe8e0", width:20, height:20, fontSize:18, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center"}}>✕</button>
                            )}
                            {/* リアクション集計バッジ */}
                            {m.reactions && Object.keys(m.reactions).length > 0 && (() => {
                              const grouped = Object.values(m.reactions).reduce((acc, emoji) => {
                                acc[emoji] = (acc[emoji] || 0) + 1; return acc;
                              }, {});
                              const myReaction = m.reactions?.[playerName];
                              return (
                                <div style={{display:"flex", flexWrap:"wrap", gap:4, marginTop:4, justifyContent: isMe ? "flex-end" : "flex-start"}}>
                                  {Object.entries(grouped).map(([emoji, count]) => (
                                    <button key={emoji} onClick={() => {
                                      if (myReaction === emoji) remove(ref(db, `chat/${activeRoomId}/${m.id}/reactions/${playerName}`)).catch(() => {});
                                      else set(ref(db, `chat/${activeRoomId}/${m.id}/reactions/${playerName}`), emoji).catch(() => {});
                                    }} style={{
                                      background: myReaction === emoji ? "rgba(212,168,136,0.35)" : "rgba(255,253,248,0.9)",
                                      border: myReaction === emoji ? "1.5px solid #D4A888" : "1px solid #e0d4c0",
                                      borderRadius:12, padding:"2px 7px", cursor:"pointer", fontSize:15,
                                      display:"flex", alignItems:"center", gap:3,
                                      animation:"chatReactionPop 0.25s ease-out",
                                    }}>
                                      {emoji} {count > 1 && <span style={{fontSize:13, color:"#7a5838", fontWeight:600}}>{count}</span>}
                                    </button>
                                  ))}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })}
                    <div id="chat-bottom"/>
                  </div>
                  <ChatInput playerName={playerName} roomId={activeRoomId} t={t} isKids={isKids}
                    onSent={() => setTimeout(() => document.getElementById("chat-bottom")?.scrollIntoView({behavior:"smooth"}), 100)}
                  />
                  <div style={{textAlign:"center", fontSize:"clamp(18px,4vw,21px)", color:"#b0a090", padding:"4px 12px 8px", letterSpacing:"0.03em"}}>
                    {t("全メッセージが200件を超えると古い順から自動削除されます。","Messages older than 200 are automatically deleted.")}
                  </div>
                </>
              ) : (
                <div style={{flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:"#b0a090", fontSize:18}}>
                  {t("ルームを選んでください","Select a room","ルームをえらんでね","Select a room")}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* チャットリアクションピッカー */}
      {chatReactionPicker && (
        <div onClick={() => setChatReactionPicker(null)} style={{position:"fixed", inset:0, zIndex:9100}}>
          <div onClick={e => e.stopPropagation()} style={{
            position:"fixed", left:"50%", top:"50%", transform:"translate(-50%,-50%)",
            background:"linear-gradient(135deg,#2a1e14,#1a120c)",
            border:"1.5px solid #6a4a3a", borderRadius:20, padding:"14px 16px",
            boxShadow:"0 8px 32px rgba(0,0,0,0.50)", zIndex:9101,
            display:"flex", flexDirection:"column", alignItems:"center", gap:10,
          }}>
            <div style={{color:"#c0a888", fontSize:15, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", letterSpacing:"0.06em"}}>
              {playerLang === "en" ? "React" : "リアクション"}
            </div>
            <div style={{display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center", maxWidth:260}}>
              {REACTIONS.map(r => {
                const isTextReaction = r.length > 2;
                return (
                  <button key={r} onClick={() => {
                    const existing = (roomMessages[chatReactionPicker.roomId] || []).find(m => m.id === chatReactionPicker.msgId);
                    if (existing?.reactions?.[playerName] === r) {
                      remove(ref(db, `chat/${chatReactionPicker.roomId}/${chatReactionPicker.msgId}/reactions/${playerName}`)).catch(() => {});
                    } else {
                      set(ref(db, `chat/${chatReactionPicker.roomId}/${chatReactionPicker.msgId}/reactions/${playerName}`), r).catch(() => {});
                    }
                    setChatReactionPicker(null);
                  }} style={{
                    background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.12)",
                    borderRadius:isTextReaction ? 10 : "50%",
                    width: isTextReaction ? "auto" : 44, height: isTextReaction ? "auto" : 44,
                    padding: isTextReaction ? "6px 10px" : 0,
                    cursor:"pointer", fontSize: isTextReaction ? 13 : 24,
                    color: isTextReaction ? "#ffe8a0" : "inherit",
                    fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    transition:"transform 0.12s, background 0.12s",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.transform="scale(1.25)"; e.currentTarget.style.background="rgba(255,255,255,0.18)"; }}
                    onMouseLeave={e => { e.currentTarget.style.transform="scale(1)"; e.currentTarget.style.background="rgba(255,255,255,0.08)"; }}
                  >{r}</button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 新規ルーム作成モーダル */}
      {showNewRoom && (
        <NewRoomModal members={members} playerName={playerName} t={t}
          onClose={() => setShowNewRoom(false)}
          onCreated={(roomId) => { setActiveRoomId(roomId); setShowNewRoom(false); }}
        />
      )}

      {/* ─── 設定パネル オーバーレイ ─── */}
      {showSettings && (
        <div style={{position:"fixed", inset:0, background:"#f7f0e6", display:"flex", flexDirection:"column", zIndex:2500, fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif"}}>
          <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 16px", background:"linear-gradient(135deg,#D4A888,#b88a6a)", boxShadow:"0 2px 8px rgba(60,40,20,0.18)", flexShrink:0}}>
            <h2 style={{color:"#3a2e22", margin:0, fontSize:"clamp(19px,4vw,24px)", fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif", letterSpacing:"0.06em"}}>⚙️ {t("設定","Settings","せってい","Settings")}</h2>
            {effectiveWide && (
              <button onClick={() => setShowSettings(false)} style={{background:"rgba(42,26,8,0.08)", border:"1px solid rgba(42,26,8,0.2)", borderRadius:8, color:"#3a2e22", padding:"6px 14px", cursor:"pointer", fontSize:18}}>
                ✕ {t("閉じる","Close","とじる","Close")}
              </button>
            )}
          </div>
          <div style={{flex:1, overflowY:"auto"}}>
            <SettingsPanel
              inline={true}
              members={members}
              saveMembers={saveMembers}
              playerName={playerName}
              playerLang={playerLang}
              onClose={() => setShowSettings(false)}
              onChangeUser={() => { setShowSettings(false); setShowNameSelect(true); }}
              onRenamePlayer={(newName) => { localStorage.setItem("playerName", newName); setPlayerName(newName); }}
            />
          </div>
        </div>
      )}

      {/* ─── モバイル専用 固定ボトムナビ ─── */}
      {!effectiveWide && !mobileF2F && (
        <nav style={{
          position:"fixed", bottom:0, left:0, right:0,
          minHeight:56, zIndex:5000,
          background:"#faf5e8",
          borderTop:"1px solid #e0d0b0",
          display:"flex", alignItems:"stretch", flexWrap:"nowrap",
          boxShadow:"0 -2px 10px rgba(60,40,20,0.10)",
          fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif",
          boxSizing:"border-box",
          paddingBottom:"env(safe-area-inset-bottom, 0px)",
          transform:"translateZ(0)", WebkitTransform:"translateZ(0)",
          overflow:"hidden",
        }}>
          {[
            {icon:<img src="/pieces/bK.webp" style={{width:20,height:20,objectFit:"contain"}}/>, labelJa:"チェス",   labelEn:"Chess",   action: ()=>{ setAnalysisData(null); setOpeningData(null); setShowChat(false); setShowAnalysisList(false); setShowSettings(false); setShowPractice(false); switchView("chess"); }, active: !showChat&&!showAnalysisList&&!showPractice&&currentView==="chess", badge: (currentView!=="chess"||showPractice) && games.some((g,i)=>{ const isP=playerName&&(g.players?.white===playerName||g.players?.black===playerName); const hl=(g.history||[]).length; const ls=gameTabSeen[g.id]||0; const mc=g.players?.white===playerName?'w':'b'; return isP&&g.status==="playing"&&hl>(hl<ls?0:ls)&&g.turn===mc; }) ? "!" : null},
            {icon:<img src={getShogiImg({type:"K",color:"b",p:false})} style={{width:20,height:20,objectFit:"contain"}}/>, labelJa:"将棋",     labelEn:"Shogi",   action: ()=>{ setAnalysisData(null); setOpeningData(null); setShowChat(false); setShowAnalysisList(false); setShowSettings(false); setShowPractice(false); switchView("shogi"); }, active: !showChat&&!showAnalysisList&&!showPractice&&currentView==="shogi", badge: (currentView!=="shogi"||showPractice) && shogiGames.some((g,i)=>{ const isP=playerName&&(g.players?.white===playerName||g.players?.black===playerName); const hl=(g.history||[]).length; const ls=shogiTabSeen[g.id]||0; const mc=g.players?.black===playerName?'b':'w'; return isP&&g.status==="playing"&&hl>(hl<ls?0:ls)&&g.turn===mc; }) ? "!" : null},
            {icon:"📖", labelJa:"練習", labelEn:"Practice", action: ()=>{ setAnalysisData(null); if(openingData){setOpeningData(null);return;} setOpeningData(null); setShowChat(false); setShowAnalysisList(false); setShowSettings(false); if(showPractice){setShowPractice(false);}else{setShowPractice(true);setPracticeType(currentView==="chess"?"chess":"shogi");} }, active: !showChat&&!showAnalysisList&&showPractice},
            {icon:"📊", labelJa:"解析", labelEn:"Analysis", action: ()=>{ setAnalysisData(null); setOpeningData(null); setShowChat(false); setShowSettings(false); openAnalysisList(); }, active: !showChat&&showAnalysisList, badge: hasAnalysisBadge?"●":null},
            {icon:"💬", labelJa:"チャット", labelEn:"Chat",    action: ()=>{ setAnalysisData(null); setOpeningData(null); setShowAnalysisList(false); setShowSettings(false); setShowChat(true); }, active: showChat, badge: chatUnread||null},
            {icon:"⚙️", labelJa:"設定",     labelEn:"Settings",action: ()=>{ setAnalysisData(null); setOpeningData(null); setShowChat(false); setShowAnalysisList(false); setShowSettings(true); }, active: showSettings},
          ].map(({icon, labelJa, labelEn, action, active, badge}) => (
            <button key={labelJa} onClick={action||undefined} style={{
              flex:"1 0 0", minWidth:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:2,
              background: active ? "rgba(212,168,136,0.22)" : "transparent",
              border:"none", borderTop: active ? "2px solid #D4A888" : "2px solid transparent",
              cursor: action ? "pointer" : "default",
              color: active ? "#3a2e22" : WT.textMid,
              fontSize:18, position:"relative",
              padding:"4px 2px 4px",
              transition:"background 0.15s",
              overflow:"hidden", boxSizing:"border-box",
            }}>
              <span style={{width:20,height:20,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{icon}</span>
              <span style={{fontSize:16, letterSpacing:"0.02em", lineHeight:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:"100%"}}>{playerLang==="en" ? labelEn : labelJa}</span>
              {badge && (
                <span style={{position:"absolute", top:4, right:"50%", transform:"translateX(12px)", background:"#c03020", color:"#fff", borderRadius:"50%", minWidth:16, height:16, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:"bold"}}>
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </button>
          ))}
        </nav>
      )}

    </div>

    {/* ── 自動解析（終局ゲームをバックグラウンドで解析・Firebase 保存） ── */}
    {playerName && games && shogiGames && [
      ...(games      || []).filter(g => g.status !== "playing" && g.status !== "waiting" && (g.history||[]).length > 0 && (g.players?.white === playerName || g.players?.black === playerName)).map(g => ({game:g, gameType:"chess"})),
      ...(shogiGames || []).filter(g => g.status !== "playing" && g.status !== "waiting" && (g.history||[]).length > 0 && (g.players?.white === playerName || g.players?.black === playerName)).map(g => ({game:g, gameType:"shogi"})),
    ].map(({game, gameType}) => (
      <AutoAnalyzer key={`${gameType}-${game.id}`} game={game} gameType={gameType} playerName={playerName} onComplete={onAutoAnalysisComplete} onProgress={onAutoAnalysisProgress} onFailed={onAutoAnalysisFailed} />
    ))}
    {practiceAnalysisGames.map(({game, gameType}) => (
      <AutoAnalyzer key={`practice-${gameType}-${game.id}`} game={game} gameType={gameType} playerName={playerName}
        onComplete={(id, gt, isNew) => { onAutoAnalysisComplete(id, gt, isNew); setPracticeAnalysisGames(prev => prev.filter(g => g.game.id !== id)); }}
        onProgress={onAutoAnalysisProgress} onFailed={onAutoAnalysisFailed} />
    ))}

    {/* ── 解析一覧（全画面オーバーレイ） ── */}
    {showAnalysisList && (
      <AnalysisList
        playerName={playerName}
        playerLang={playerLang}
        pcLayout={effectiveWide}
        progressMap={autoAnalysisProgress}
        failedGameIds={failedAnalysisGameIds}
        refreshKey={analysisListRefreshKey}
        onClose={() => { setShowAnalysisList(false); }}
        onOpenAnalysis={openAnalysisFromCache}
        finishedGames={[
          ...((games||[]).filter(g=>
            g.status!=="playing"&&g.status!=="waiting"&&
            (g.history||[]).length>0&&
            (g.players?.white===playerName||g.players?.black===playerName)
          ).map(g=>({...g,gameType:"chess"}))),
          ...((shogiGames||[]).filter(g=>
            g.status!=="playing"&&g.status!=="waiting"&&
            (g.history||[]).length>0&&
            (g.players?.black===playerName||g.players?.white===playerName)
          ).map(g=>({...g,gameType:"shogi"}))),
          ...practiceAnalysisGames.map(({game,gameType})=>({...game,gameType})),
        ]}
      />
    )}

    {/* ── 解析ビュー（全画面オーバーレイ） ── */}
    {analysisData && (
      <AnalysisView
        game={analysisData.game}
        gameType={analysisData.gameType}
        playerLang={playerLang}
        playerName={playerName}
        getShogiImg={getShogiImg}
        members={members}
        hasMobileNav={!effectiveWide}
        onClose={() => setAnalysisData(null)}
        onBackToList={() => { setAnalysisData(null); setShowAnalysisList(true); }}
      />
    )}

    {/* ── 定石ビュー（全画面オーバーレイ） ── */}
    {openingData && (
      <OpeningDetailView
        openingData={openingData}
        allOpenings={openingData.gameType==="chess" ? CHESS_OPENINGS : SHOGI_OPENINGS}
        playerLang={playerLang}
        getShogiImg={getShogiImg}
        onClose={() => setOpeningData(null)}
        onOpenOther={(o) => openOpening(o, openingData.gameType)}
      />
    )}
    {/* ── タクティクスビュー ── */}
    {tacticsData && (
      <TacticsDetailView
        tacticsData={tacticsData}
        allTactics={tacticsData.gameType==="chess" ? CHESS_TACTICS : SHOGI_TACTICS}
        playerLang={playerLang}
        onClose={() => setTacticsData(null)}
        onOpenOther={(tt) => openTactic(tt, tacticsData.gameType)}
      />
    )}
    <FormationModal modal={appFormationModal} setModal={setAppFormationModal} playerLang={playerLang} getShogiImg={getShogiImg}/>
    </TransContext.Provider>
  );
}

