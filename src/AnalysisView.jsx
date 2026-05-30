import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ReferenceLine, ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  CHESS_URL, SHOGI_URL,
  chessHistToUCI, shogiHistToUSI,
  normalizeEval, getCPL, calcAccuracy, CLASSIFY, classify,
  EngineWorker, FB_PATH, fbLoad, fbSave,
} from "./analysisEngine.js";

/* ══ board helpers (pure functions – duplicated from App.jsx) ════════ */
function avMkBoard() {
  const b = []; const back = ["R","N","B","Q","K","B","N","R"];
  for (let r = 0; r < 8; r++) { b[r] = []; for (let c = 0; c < 8; c++) b[r][c] = null; }
  for (let c = 0; c < 8; c++) {
    b[0][c] = {type:back[c],color:"b"}; b[1][c] = {type:"P",color:"b"};
    b[6][c] = {type:"P",color:"w"};    b[7][c] = {type:back[c],color:"w"};
  } return b;
}
function avApplyMove(board, fr, fc, tr, tc, promoteType="Q", epSq=null) {
  const nb = board.map(r=>[...r]); const p = nb[fr][fc];
  nb[tr][tc] = (p.type==="P"&&(tr===0||tr===7)) ? {type:promoteType,color:p.color} : p;
  nb[fr][fc] = null;
  if (p.type==="P"&&epSq&&tr===epSq[0]&&tc===epSq[1]&&fc!==tc) nb[fr][tc]=null;
  if (p.type==="K"&&Math.abs(tc-fc)===2) {
    if (tc===6){nb[fr][5]=nb[fr][7];nb[fr][7]=null;} else {nb[fr][3]=nb[fr][0];nb[fr][0]=null;}
  } return nb;
}
function avMkShogiBoard() {
  const E=null, b=(t)=>({color:"b",type:t,p:false}), w=(t)=>({color:"w",type:t,p:false});
  return [
    [w("L"),w("N"),w("S"),w("G"),w("K"),w("G"),w("S"),w("N"),w("L")],
    [E,w("R"),E,E,E,E,E,w("B"),E],
    [w("P"),w("P"),w("P"),w("P"),w("P"),w("P"),w("P"),w("P"),w("P")],
    [E,E,E,E,E,E,E,E,E],[E,E,E,E,E,E,E,E,E],[E,E,E,E,E,E,E,E,E],
    [b("P"),b("P"),b("P"),b("P"),b("P"),b("P"),b("P"),b("P"),b("P")],
    [E,b("B"),E,E,E,E,E,b("R"),E],
    [b("L"),b("N"),b("S"),b("G"),b("K"),b("G"),b("S"),b("N"),b("L")],
  ];
}
function avApplyShogiMove(board, cap, fr, fc, tr, tc, promote) {
  const nb=board.map(r=>r.map(p=>p?{...p}:null));
  const nc={b:{...cap.b},w:{...cap.w}};
  const piece={...nb[fr][fc]}; const target=nb[tr][tc];
  if (target) nc[piece.color][target.type]=(nc[piece.color][target.type]||0)+1;
  if (promote) piece.p=true;
  nb[tr][tc]=piece; nb[fr][fc]=null;
  return {board:nb,cap:nc};
}
function avApplyShogiDrop(board, cap, tr, tc, color, pType) {
  const nb=board.map(r=>r.map(p=>p?{...p}:null));
  const nc={b:{...cap.b},w:{...cap.w}};
  nb[tr][tc]={color,type:pType,p:false};
  const n=(nc[color][pType]||0)-1; if(n<=0) delete nc[color][pType]; else nc[color][pType]=n;
  return {board:nb,cap:nc};
}

/* ══ position builder ════════════════════════════════════════════════ */
function buildChessPositions(history) {
  let board = avMkBoard(); let epSq = null;
  const positions = [board];
  for (let i = 0; i < history.length; i++) {
    const h = history[i]; const prev = positions[i];
    const piece = prev[h.from[0]][h.from[1]];
    let promo = "Q";
    if (h.notation && h.notation.includes("=")) promo = h.notation.split("=")[1][0];
    const nb = avApplyMove(prev, h.from[0], h.from[1], h.to[0], h.to[1], promo, epSq);
    epSq = (piece?.type==="P" && Math.abs(h.to[0]-h.from[0])===2)
      ? [(h.from[0]+h.to[0])/2, h.to[1]] : null;
    positions.push(nb);
  }
  return positions;
}
function buildShogiPositions(history) {
  let board = avMkShogiBoard(); let cap = {b:{},w:{}};
  const positions = [{board,cap}];
  for (let i = 0; i < history.length; i++) {
    const h = history[i]; const color = i%2===0 ? "b" : "w";
    const res = h.drop
      ? avApplyShogiDrop(board,cap,h.to[0],h.to[1],color,h.drop)
      : avApplyShogiMove(board,cap,h.from[0],h.from[1],h.to[0],h.to[1],h.promote||false);
    board=res.board; cap=res.cap; positions.push({board,cap});
  }
  return positions;
}


/* ══ coordinate conversion ═══════════════════════════════════════════ */
function uciToCoords(mv) {
  if (!mv||mv.length<4) return null;
  return { from:[8-parseInt(mv[1]), mv.charCodeAt(0)-97], to:[8-parseInt(mv[3]), mv.charCodeAt(2)-97] };
}
function usiToCoords(mv) {
  if (!mv||mv.length<4) return null;
  if (mv[1]==="*") return { from:null, to:[mv.charCodeAt(3)-97, 9-parseInt(mv[2])], drop:mv[0] };
  return { from:[mv.charCodeAt(1)-97, 9-parseInt(mv[0])], to:[mv.charCodeAt(3)-97, 9-parseInt(mv[2])] };
}

/* ══ SVG arrow ═══════════════════════════════════════════════════════ */
const BestMoveArrow = ({ from, to, cellSize, rows, cols, flipped }) => {
  if (!from||!to) return null;
  const W=cols*cellSize, H=rows*cellSize;
  const fr = flipped ? (r) => (rows-1-r) : (r) => r;
  const fc = flipped ? (c) => (cols-1-c) : (c) => c;
  const x1=(fc(from[1])+0.5)*cellSize, y1=(fr(from[0])+0.5)*cellSize;
  const x2=(fc(to[1])+0.5)*cellSize,   y2=(fr(to[0])+0.5)*cellSize;
  const sw = Math.max(2, cellSize*0.14);
  return (
    <svg style={{position:"absolute",top:0,left:0,width:W,height:H,pointerEvents:"none",zIndex:8}}
         viewBox={`0 0 ${W} ${H}`}>
      <defs>
        <marker id="av-arr" markerWidth="9" markerHeight="7" refX="7" refY="3.5" orient="auto">
          <polygon points="0 0,9 3.5,0 7" fill="rgba(30,220,90,0.88)"/>
        </marker>
      </defs>
      <line x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="rgba(30,220,90,0.75)" strokeWidth={sw}
            markerEnd="url(#av-arr)" strokeLinecap="round"/>
    </svg>
  );
};

/* ══ Chess board ══════════════════════════════════════════════════════ */
const PIECE_IMG_AV = {
  wK:"/pieces/wK.webp",wQ:"/pieces/wQ.webp",wR:"/pieces/wR.webp",
  wB:"/pieces/wB.webp",wN:"/pieces/wN.webp",wP:"/pieces/wP.webp",
  bK:"/pieces/bK.webp",bQ:"/pieces/bQ.webp",bR:"/pieces/bR.webp",
  bB:"/pieces/bB.webp",bN:"/pieces/bN.webp",bP:"/pieces/bP.webp",
};
const PIECE_SCALE_AV = {wK:100,wQ:87,wR:87,wN:93,wB:92,wP:78,bK:99,bQ:88,bR:86,bN:88,bB:94,bP:83};

const AnalysisChessBoard = ({ board, cellSize, hlFrom, hlTo, bestMove, flipped }) => {
  const cs = cellSize||44;
  const coords = bestMove ? uciToCoords(bestMove) : null;
  const rowOrder = flipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
  const colOrder = flipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
  return (
    <div style={{position:"relative",display:"inline-block",flexShrink:0}}>
      <div style={{display:"flex",flexDirection:"column",border:"2px solid #8b6914"}}>
        {rowOrder.map(r=>(
          <div key={r} style={{display:"flex"}}>
            {colOrder.map(c=>{
              const piece=board[r][c];
              const light=(r+c)%2===0;
              const isFr=hlFrom&&hlFrom[0]===r&&hlFrom[1]===c;
              const isTo=hlTo&&hlTo[0]===r&&hlTo[1]===c;
              const bg=(isFr||isTo)?"rgba(255,215,0,0.8)":light?"#f0d9b5":"#b58863";
              return (
                <div key={c} style={{width:cs,height:cs,background:bg,position:"relative",flexShrink:0}}>
                  {piece&&<img src={PIECE_IMG_AV[piece.color+piece.type]}
                    style={{position:"absolute",bottom:0,left:"50%",transform:"translateX(-50%)",
                            height:`${PIECE_SCALE_AV[piece.color+piece.type]||88}%`,
                            width:"auto",maxWidth:"95%",pointerEvents:"none"}}
                    alt=""/>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{display:"flex"}}>
        {colOrder.map((c,i)=>(
          <div key={i} style={{width:cs,textAlign:"center",fontSize:10,color:"#8b6914",lineHeight:1.3}}>{"abcdefgh"[c]}</div>
        ))}
      </div>
      <div style={{position:"absolute",left:-14,top:0,height:cs*8,display:"flex",flexDirection:"column",width:12}}>
        {rowOrder.map(r=>(
          <div key={r} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"#8b6914"}}>{8-r}</div>
        ))}
      </div>
    </div>
  );
};

/* ══ Shogi board ══════════════════════════════════════════════════════ */
const SK_AV   = {K:"玉",R:"飛",B:"角",G:"金",S:"銀",N:"桂",L:"香",P:"歩"};
const SK_EN_AV= {K:"K",R:"R",B:"B",G:"G",S:"S",N:"N",L:"L",P:"P"};

const ShogiHandArea = ({ cap, color, cellSize, getShogiImg, playerLang }) => {
  const sz=Math.round(cellSize*0.72);
  const pieces=["R","B","G","S","N","L","P"]
    .filter(t=>(cap[color]?.[t]||0)>0)
    .map(t=>({type:t,cnt:cap[color][t]}));
  return (
    <div style={{display:"flex",flexWrap:"wrap",gap:2,minHeight:sz+4,padding:"2px 0",flex:1}}>
      {pieces.length===0&&<span style={{fontSize:10,color:"#a89070"}}>{playerLang==="en"?"—":"なし"}</span>}
      {pieces.map(({type,cnt})=>(
        <div key={type} style={{position:"relative",width:sz,height:sz,flexShrink:0}}>
          <img src={getShogiImg({type,color,p:false})}
            style={{width:"100%",height:"100%",objectFit:"contain",
                    transform:color==="w"?"rotate(180deg)":"none"}} alt=""/>
          {cnt>1&&<span style={{position:"absolute",bottom:0,right:0,fontSize:9,fontWeight:"bold",
            color:"#333",background:"rgba(255,255,255,0.75)",borderRadius:2,lineHeight:1,padding:"0 1px"}}>{cnt}</span>}
        </div>
      ))}
    </div>
  );
};

const AnalysisShogiBoard = ({ board, cap, cellSize, hlFrom, hlTo, bestMove, getShogiImg, playerLang, flipped, noHands }) => {
  const cs=cellSize||40;
  const coords=bestMove?usiToCoords(bestMove):null;
  const topColor  = flipped ? "b" : "w";
  const btmColor  = flipped ? "w" : "b";
  const rowOrder  = flipped ? [8,7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7,8];
  const colOrder  = flipped ? [8,7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7,8];
  return (
    <div style={{display:"flex",flexDirection:"column",gap:3,flexShrink:0}}>
      {!noHands && (
        <div style={{display:"flex",gap:4,alignItems:"center",minHeight:Math.round(cs*0.72)+6}}>
          <span style={{fontSize:16,color:"#a89070",width:28,textAlign:"right",flexShrink:0}}>
            {playerLang==="en"?(topColor==="w"?"W":"B"):(topColor==="w"?"後手":"先手")}
          </span>
          <ShogiHandArea cap={cap} color={topColor} cellSize={cs} getShogiImg={getShogiImg} playerLang={playerLang}/>
        </div>
      )}
      <div style={{position:"relative",display:"inline-flex",flexDirection:"column",border:"2px solid #8b6914",flexShrink:0}}>
        {rowOrder.map((r,ri)=>(
          <div key={r} style={{display:"flex"}}>
            {colOrder.map((c,ci)=>{
              const piece=board[r][c];
              const isFr=hlFrom&&hlFrom[0]===r&&hlFrom[1]===c;
              const isTo=hlTo&&hlTo[0]===r&&hlTo[1]===c;
              const bg=(isFr||isTo)?"rgba(255,215,0,0.8)":"#f5ddb0";
              return (
                <div key={c} style={{width:cs,height:cs,background:bg,position:"relative",flexShrink:0,
                  borderRight:ci<8?"1px solid #c8a040":"none",borderBottom:ri<8?"1px solid #c8a040":"none",
                  boxSizing:"border-box"}}>
                  {piece&&<img src={getShogiImg(piece)}
                    style={{position:"absolute",top:"5%",left:"5%",width:"90%",height:"90%",
                            objectFit:"contain",transform:piece.color==="w"?"rotate(180deg)":"none",
                            pointerEvents:"none"}} alt=""/>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {!noHands && (
        <div style={{display:"flex",gap:4,alignItems:"center",minHeight:Math.round(cs*0.72)+6}}>
          <span style={{fontSize:16,color:"#a89070",width:28,textAlign:"right",flexShrink:0}}>
            {playerLang==="en"?(btmColor==="w"?"W":"B"):(btmColor==="w"?"後手":"先手")}
          </span>
          <ShogiHandArea cap={cap} color={btmColor} cellSize={cs} getShogiImg={getShogiImg} playerLang={playerLang}/>
        </div>
      )}
    </div>
  );
};

/* ══ Eval graph tooltip ═══════════════════════════════════════════════ */
const EvalTip = ({ active, payload, label, playerLang }) => {
  if (!active||!payload?.length) return null;
  const ev = payload[0]?.value??0;
  const who = playerLang==="en"?(ev>=0?"White +":"Black +"):(ev>=0?"白 +":"黒 +");
  return (
    <div style={{background:"#fffcf5",border:"1px solid #c4a058",borderRadius:6,
                 padding:"4px 10px",fontSize:20,color:"#2a1a08",boxShadow:"0 2px 8px rgba(42,26,8,0.15)"}}>
      <div style={{color:"#7c6040"}}>{playerLang==="en"?"Move ":"手数 "}{label}</div>
      <div style={{fontFamily:"monospace",fontWeight:600}}>{who}{Math.abs(ev).toFixed(2)}</div>
    </div>
  );
};

/* ══ Analysis player info mini-components ════════════════════════════ */
const AvAvatarIcon = ({ url, size = 36, name = "" }) => {
  const [err, setErr] = useState(false);
  const [preview, setPreview] = useState(false);
  const sz = size + "px";
  const canPreview = !!url && !err;
  return (
    <>
      {(!url||err)
        ? <span style={{width:sz,height:sz,minWidth:sz,borderRadius:"50%",background:"#f0e8d8",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:Math.round(size*0.52)+"px",flexShrink:0,border:"1px solid #c8b090",userSelect:"none",overflow:"hidden"}}>👤</span>
        : <img src={url} alt={name} onError={()=>setErr(true)} onClick={e=>{e.stopPropagation();if(canPreview)setPreview(true);}}
            style={{width:sz,height:sz,minWidth:sz,borderRadius:"50%",objectFit:"cover",flexShrink:0,border:"1px solid #c8b090",display:"block",cursor:canPreview?"pointer":"inherit"}}/>
      }
      {preview&&(
        <div onClick={()=>setPreview(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.72)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:9999,cursor:"pointer"}}>
          <img src={url.replace('/avatars/','/avatars_large/')} alt={name} style={{width:"min(300px,80vw,80vh)",height:"min(300px,80vw,80vh)",borderRadius:"50%",objectFit:"cover",border:"4px solid #fff",boxShadow:"0 8px 40px rgba(0,0,0,0.6)"}}/>
          {name&&<div style={{marginTop:16,color:"#fff",fontSize:20,fontWeight:"bold",fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif"}}>{name}</div>}
          <div style={{marginTop:10,color:"rgba(255,255,255,0.6)",fontSize:18}}>タップして閉じる / Tap to close</div>
        </div>
      )}
    </>
  );
};

const AvKingBadge = ({ col, size = 36 }) => {
  const [preview, setPreview] = useState(false);
  const src = col==="w" ? "/badges/king-white.webp" : "/badges/king-black.webp";
  const sz = size + "px";
  return (
    <>
      <img src={src} alt={col==="w"?"White King":"Black King"} onClick={e=>{e.stopPropagation();setPreview(true);}}
        style={{width:sz,height:sz,minWidth:sz,borderRadius:"50%",objectFit:"cover",display:"block",flexShrink:0,border:"1px solid #c8b090",cursor:"pointer",boxShadow:"0 1px 4px rgba(42,26,8,0.18)"}}/>
      {preview&&(
        <div onClick={()=>setPreview(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.72)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:9999,cursor:"pointer"}}>
          <img src={src} alt={col==="w"?"White King":"Black King"} style={{width:300,height:300,borderRadius:"50%",objectFit:"cover",border:"4px solid #fff",boxShadow:"0 8px 40px rgba(0,0,0,0.6)"}}/>
          <div style={{marginTop:10,color:"rgba(255,255,255,0.6)",fontSize:18}}>タップして閉じる / Tap to close</div>
        </div>
      )}
    </>
  );
};

const AvShogiKingBadge = ({ color, size = 36 }) => {
  const [preview, setPreview] = useState(false);
  const src = color==="b" ? "/badges/shogi-black.webp" : "/badges/shogi-white.webp";
  const sz = size + "px";
  return (
    <>
      <img src={src} onClick={e=>{e.stopPropagation();setPreview(true);}}
        style={{width:sz,height:sz,minWidth:sz,borderRadius:"50%",objectFit:"cover",border:"1px solid #c8b090",display:"block",flexShrink:0,cursor:"pointer",boxShadow:"0 1px 4px rgba(42,26,8,0.18)"}}/>
      {preview&&(
        <div onClick={()=>setPreview(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.72)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:9999,cursor:"pointer"}}>
          <img src={src} style={{width:300,height:300,borderRadius:"50%",objectFit:"cover",border:"4px solid #fff",boxShadow:"0 8px 40px rgba(0,0,0,0.6)"}}/>
          <div style={{marginTop:10,color:"rgba(255,255,255,0.6)",fontSize:18}}>タップして閉じる / Tap to close</div>
        </div>
      )}
    </>
  );
};

const AvChessCapturedRow = ({ pieces, cellPx }) => {
  const cs = cellPx || 44;
  if (!pieces || pieces.length===0) return <div style={{minHeight:Math.floor(cs*0.8/2)+4}}/>;
  return (
    <div style={{display:"flex",flexWrap:"wrap",gap:2,padding:"4px 0 4px 16px",alignItems:"flex-end",minHeight:Math.round(cs*0.8)+8}}>
      {pieces.map((p,i)=>(
        <div key={i} style={{width:Math.round(cs*0.8),height:Math.round(cs*0.8),display:"flex",alignItems:"flex-end",justifyContent:"center",flexShrink:0}}>
          <img src={PIECE_IMG_AV[p.color+p.type]} alt={p.color+p.type}
            style={{height:`${PIECE_SCALE_AV[p.color+p.type]||85}%`,width:"auto",maxWidth:"100%",display:"block",pointerEvents:"none"}}/>
        </div>
      ))}
    </div>
  );
};

/* ══ カラーパレット（チェスゲーム画面に合わせた暖色系） ══════════════ */
const AV = {
  pageBg:      "#faf5e8",
  surface:     "#fffcf5",
  surfaceMid:  "rgba(255,248,230,0.85)",
  header:      "linear-gradient(160deg,#4c2e0c,#7a5020)",
  border:      "#d4bc88",
  borderGold:  "#c4a058",
  text:        "#2a1a08",
  textMid:     "#7c6040",
  textMuted:   "#a89070",
  gold:        "#b08830",
  danger:      "#c03020",
  dangerBg:    "rgba(192,48,32,0.10)",
  dangerBorder:"rgba(192,48,32,0.40)",
  evalBarBg:   "#2a2a2a",
};

/* ══ Main component ═══════════════════════════════════════════════════ */
export default function AnalysisView({ game, gameType, playerLang, playerName, getShogiImg, onClose, onBackToList, members, hasMobileNav, staticEvals, deletedGameIds }) {
  const serif = "'Cormorant Garamond','Zen Old Mincho',Georgia,serif";
  const t = (ja,en) => playerLang==="en" ? en : ja;
  const isChess = gameType==="chess";
  const history = game.history||[];

  /* ── state ─────────────────────────────────────────────────── */
  const [flipped, setFlipped]        = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [evals, setEvals]            = useState([]);
  const [bestMoves, setBestMoves]    = useState([]);
  const [progress, setProgress]      = useState(0);
  const [isAnalyzing, setIsAnalyzing]= useState(false);
  const [engineError, setEngineError]= useState(null);
  const [analysisDone, setAnalysisDone] = useState(false);

  // Firebase source info
  const [fbSource, setFbSource]      = useState(null);  // { analyzedBy, createdAt, path }
  const [fbSaving, setFbSaving]      = useState(false);

  const engineRef  = useRef(null);
  const abortRef   = useRef(false);
  const wrapRef    = useRef(null);
  const moveListRef = useRef(null);
  const activeItemRef = useRef(null);
  const [wrapW, setWrapW] = useState(0);

  /* ── positions ─────────────────────────────────────────────── */
  const positions = useMemo(()=>
    isChess ? buildChessPositions(history) : buildShogiPositions(history),
    // eslint-disable-next-line
    [history.length, isChess]
  );
  const uciMoves = useMemo(()=>
    isChess ? chessHistToUCI(history) : shogiHistToUSI(history),
    // eslint-disable-next-line
    [history.length, isChess]
  );

  /* ── resize ────────────────────────────────────────────────── */
  useEffect(()=>{
    const el = wrapRef.current; if(!el) return;
    const ro = new ResizeObserver(([e])=>setWrapW(Math.floor(e.contentRect.width)));
    ro.observe(el); return ()=>ro.disconnect();
  },[]);

  /* ── analysis engine (Firebase-first) ─────────────────────── */
  useEffect(()=>{
    if (history.length === 0) { setEvals([0]); setAnalysisDone(true); return; }

    // 定石表示: 静的評価値が渡された場合はエンジン解析をスキップ
    if (staticEvals) {
      setEvals(staticEvals);
      setBestMoves(Array(history.length).fill(null));
      setProgress(100);
      setAnalysisDone(true);
      return;
    }

    abortRef.current = false;
    setIsAnalyzing(true);
    setEngineError(null);

    const depth = isChess ? 15 : 12;

    (async()=>{
      // ── 1. Try Firebase cache ───────────────────────────────
      const cached = await fbLoad(playerName, game.id, history.length);
      if (cached && !abortRef.current) {
        const { data, path } = cached;
        setEvals(data.evaluations);
        setBestMoves(data.bestMoves || []);
        setFbSource({ analyzedBy: data.analyzedBy, createdAt: data.createdAt, path });
        setProgress(100);
        setAnalysisDone(true);
        setIsAnalyzing(false);
        return;
      }
      if (abortRef.current) { setIsAnalyzing(false); return; }

      // ── 2. Run engine ───────────────────────────────────────
      const worker = new EngineWorker(
        isChess ? CHESS_URL : SHOGI_URL,
        isChess ? "uci"     : "usi"
      );
      engineRef.current = worker;

      try {
        await worker.init();
        const evR=[], bmR=[];

        for (let i = 0; i <= history.length; i++) {
          if (abortRef.current) break;
          const { score, bestMove } = await worker.analyze(uciMoves.slice(0,i), depth);
          evR.push(normalizeEval(score, i));
          bmR.push(bestMove);
          setEvals([...evR]);
          setBestMoves([...bmR]);
          setProgress(Math.round((i+1)/(history.length+1)*100));
        }

        // ── 3. Save to Firebase ────────────────────────────────
        if (!abortRef.current && evR.length === history.length+1) {
          // ユーザーが削除した解析は自動再保存しない
          const isDeleted = deletedGameIds instanceof Set && deletedGameIds.has(game.id);
          if (!isDeleted) {
            setFbSaving(true);
            const saved = await fbSave(playerName, game.id, gameType, game, uciMoves, evR, bmR);
            setFbSaving(false);
            if (saved) {
              setFbSource({
                analyzedBy: playerName,
                createdAt:  saved.createdAt,
                path:       FB_PATH(playerName, game.id),
              });
            }
          }
          setAnalysisDone(true);
        }

      } catch(e) {
        setEngineError(e?.message || String(e));
      } finally {
        setIsAnalyzing(false);
        worker.terminate();
        engineRef.current = null;
      }
    })();

    return ()=>{
      abortRef.current = true;
      if (engineRef.current) { engineRef.current.terminate(); engineRef.current = null; }
    };
    // eslint-disable-next-line
  }, [game.id, history.length]);

  /* ── auto-scroll move list（ページ全体ではなくリスト内だけスクロール） */
  useEffect(()=>{
    const container = moveListRef.current;
    const active    = activeItemRef.current;
    if (!container || !active) return;
    const cr = container.getBoundingClientRect();
    const ir = active.getBoundingClientRect();
    if (ir.top < cr.top) {
      container.scrollTop -= cr.top - ir.top + 4;
    } else if (ir.bottom > cr.bottom) {
      container.scrollTop += ir.bottom - cr.bottom + 4;
    }
  },[currentIdx]);

  /* ── derived ────────────────────────────────────────────────── */
  const graphData = useMemo(()=>
    evals.map((ev,i)=>({move:i, eval:Math.max(-15,Math.min(15,ev/100))})),
    [evals]
  );

  const {accFirst, accSecond} = useMemo(()=>{
    if (evals.length<2) return {accFirst:null,accSecond:null};
    return {accFirst:calcAccuracy(evals,true), accSecond:calcAccuracy(evals,false)};
  },[evals]);

  const curMoveCPL = useMemo(()=>{
    if (currentIdx===0||evals[currentIdx-1]===undefined||evals[currentIdx]===undefined) return null;
    return getCPL(evals[currentIdx-1], evals[currentIdx], currentIdx-1);
  },[currentIdx,evals]);

  const curClassify = curMoveCPL!==null ? classify(curMoveCPL) : null;

  const firstName  = isChess ? (game.players?.white||t("白","White")) : (game.players?.black||t("先手","Black"));
  const secondName = isChess ? (game.players?.black||t("黒","Black")) : (game.players?.white||t("後手","White"));

  const curPos   = positions[Math.min(currentIdx,positions.length-1)];
  const curBoard = isChess ? curPos : curPos.board;
  const curCap   = isChess ? null   : curPos.cap;
  const prevMove = currentIdx>0 ? history[currentIdx-1] : null;
  const hlFrom   = prevMove&&!prevMove.drop ? prevMove.from : null;
  const hlTo     = prevMove ? prevMove.to : null;
  const curBM    = bestMoves[currentIdx]||null;

  const pcLayout = wrapW >= 680;
  // 横並びレイアウト: 形勢バー(20) + gap(4) + 盤面 + gap(4) + ユーザーブロック(80) = 108px のオーバーヘッド
  // PC: 右パネル最小 220 + gap 14 = 234px を確保
  const cellSize = isChess
    ? (pcLayout ? Math.min(50,Math.floor((wrapW-352)/8)) : Math.min(34,Math.floor((wrapW-118)/8)))
    : (pcLayout ? Math.min(44,Math.floor((wrapW-338)/9)) : Math.min(28,Math.floor((wrapW-104)/9)));

  // Player orientation (pcLayout・curBoard・curCap が確定した後に配置: TDZ 回避)
  const topColor    = isChess ? (flipped ? "w" : "b") : (flipped ? "b" : "w");
  const bottomColor = isChess ? (flipped ? "b" : "w") : (flipped ? "w" : "b");
  const topName    = isChess ? (topColor==="w"    ? firstName : secondName) : (topColor==="b"    ? firstName : secondName);
  const bottomName = isChess ? (bottomColor==="w" ? firstName : secondName) : (bottomColor==="b" ? firstName : secondName);
  const topMember    = (members||[]).find(m=>m.name===topName);
  const bottomMember = (members||[]).find(m=>m.name===bottomName);
  const iconSz = pcLayout ? 36 : 44;

  // Chess captured pieces from current board position
  const CHESS_INIT = {P:8,R:2,N:2,B:2,Q:1};
  const CHESS_PV   = {Q:9,R:5,B:3,N:3,P:1};
  let capturedByWhite = [], capturedByBlack = [];
  if (isChess) {
    const wC={}, bC={};
    for (let r=0; r<8; r++) for (let c=0; c<8; c++) {
      const p=curBoard[r][c]; if(!p) continue;
      if(p.color==="w") wC[p.type]=(wC[p.type]||0)+1;
      else bC[p.type]=(bC[p.type]||0)+1;
    }
    capturedByWhite = Object.entries(CHESS_INIT).flatMap(([tp,n])=>
      Array(Math.max(0,n-(bC[tp]||0))).fill({type:tp,color:"b"})
    );
    capturedByBlack = Object.entries(CHESS_INIT).flatMap(([tp,n])=>
      Array(Math.max(0,n-(wC[tp]||0))).fill({type:tp,color:"w"})
    );
  }
  const topCaptures    = isChess ? (topColor==="w"    ? capturedByWhite : capturedByBlack) : null;
  const bottomCaptures = isChess ? (bottomColor==="w" ? capturedByWhite : capturedByBlack) : null;
  const cpScore = (pieces) => pieces.reduce((s,p)=>s+(CHESS_PV[p.type]||0),0);

  // Shogi piece advantage
  const SHOGI_PV = {R:5,B:5,G:3,S:3,N:2,L:2,P:1};
  const shogiAdv = (color) => {
    if (!isChess && curCap) {
      const opp=color==="b"?"w":"b";
      const myS=Object.entries(curCap[color]||{}).reduce((s,[tp,n])=>s+(SHOGI_PV[tp]||0)*n,0);
      const opS=Object.entries(curCap[opp]||{}).reduce((s,[tp,n])=>s+(SHOGI_PV[tp]||0)*n,0);
      return myS - opS;
    }
    return 0;
  };

  const evalCp   = evals[currentIdx];
  const evalPawn = evalCp!==undefined ? Math.max(-50,Math.min(50,evalCp/100)) : null;
  const evalStr  = evalPawn!==null ? (evalPawn>=0?"+":"")+evalPawn.toFixed(2) : "—";
  const whiteBarW = `${evalPawn!==null ? Math.round(50+evalPawn) : 50}%`;

  const goTo = useCallback((i)=>setCurrentIdx(Math.max(0,Math.min(history.length,i))),[history.length]);

  /* ── shogi notation ─────────────────────────────────────────── */
  const shogiNota = (h) => {
    if (!h) return "";
    if (h.drop) return `${playerLang==="en"?SK_EN_AV[h.drop]:SK_AV[h.drop]}${t("打","*")}`;
    return `(${h.from[0]+1},${h.from[1]+1})→(${h.to[0]+1},${h.to[1]+1})${h.promote?t("成","+"):""}`;
  };

  /* ── nav button style ───────────────────────────────────────── */
  const nb = (dis) => ({
    background: dis ? "rgba(180,140,80,0.06)" : AV.surface,
    border: `1px solid ${dis ? AV.border : AV.borderGold}`,
    borderRadius: 6,
    color: dis ? AV.textMuted : AV.textMid,
    width: 36, height: 36, cursor: dis ? "default" : "pointer",
    fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center",
    fontFamily: serif, flexShrink: 0,
  });

  /* ── re-analyze after delete ────────────────────────────────── */
  const handleReanalyze = () => {
    setFbDeleted(false);
    setEvals([]);
    setBestMoves([]);
    setAnalysisDone(false);
    setProgress(0);
    setFbSource(null);
    setEngineError(null);
    // trigger effect by bumping a counter — simplest: just close and reopen
    // Instead: we'll force by calling the async block inline
    setIsAnalyzing(true);
    const depth = isChess ? 15 : 12;
    abortRef.current = false;
    const worker = new EngineWorker(isChess?CHESS_URL:SHOGI_URL, isChess?"uci":"usi");
    engineRef.current = worker;
    (async()=>{
      try {
        await worker.init();
        const evR=[], bmR=[];
        for (let i=0; i<=history.length; i++) {
          if (abortRef.current) break;
          const {score,bestMove} = await worker.analyze(uciMoves.slice(0,i), depth);
          evR.push(normalizeEval(score,i));
          bmR.push(bestMove);
          setEvals([...evR]);
          setBestMoves([...bmR]);
          setProgress(Math.round((i+1)/(history.length+1)*100));
        }
        if (!abortRef.current && evR.length===history.length+1) {
          // ユーザーが削除した解析は自動再保存しない
          const isDeleted = deletedGameIds instanceof Set && deletedGameIds.has(game.id);
          if (!isDeleted) {
            setFbSaving(true);
            const saved = await fbSave(playerName,game.id,gameType,game,uciMoves,evR,bmR);
            setFbSaving(false);
            if (saved) setFbSource({analyzedBy:playerName,createdAt:saved.createdAt,path:FB_PATH(playerName,game.id)});
          }
          setAnalysisDone(true);
        }
      } catch(e) {
        setEngineError(e?.message||String(e));
      } finally {
        setIsAnalyzing(false);
        worker.terminate();
        engineRef.current=null;
      }
    })();
  };

  /* ── format date ────────────────────────────────────────────── */
  const fmtDate = (iso) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString(playerLang==="en"?"en-US":"ja-JP", {month:"short",day:"numeric"});
    } catch { return ""; }
  };

  /* ── render ─────────────────────────────────────────────────── */
  return (
    <div style={{position:"fixed",top:0,left:0,right:0,
                 bottom: hasMobileNav ? "calc(56px + env(safe-area-inset-bottom, 0px))" : 0,
                 background:AV.pageBg,zIndex:4000,
                 display:"flex",flexDirection:"column",fontFamily:serif,overflow:"hidden"}}>

      {/* ── header ───────────────────────────────────────────── */}
      <div style={{flexShrink:0,background:AV.header,
                   borderBottom:`2px solid ${AV.borderGold}`,padding:"10px 16px",
                   display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
          <span style={{fontSize:24}}>🔍</span>
          <div style={{minWidth:0}}>
            <div style={{color:"#fffcf5",fontWeight:600,fontSize:"clamp(20px,3vw,24px)",
                         letterSpacing:"0.06em",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
              {t("解析・振り返り","Game Analysis")}
            </div>
            <div style={{color:"#d4bc88",fontSize:20}}>
              {isChess?"Chess":t("将棋","Shogi")}
              {fbSaving && <span style={{color:"#d4bc88",marginLeft:6}}>{t("保存中…","Saving…")}</span>}
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
          {onBackToList && (
            <button onClick={onBackToList}
              style={{background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.3)",
                      borderRadius:8,color:"#d4bc88",padding:"6px 12px",cursor:"pointer",
                      fontSize:20,fontFamily:serif}}>
              ‹ {t("一覧","List")}
            </button>
          )}
          {!hasMobileNav && (
            <button onClick={onClose}
              style={{background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.3)",
                      borderRadius:8,color:"#fffcf5",padding:"6px 14px",cursor:"pointer",
                      fontSize:"clamp(20px,3vw,22px)",fontFamily:serif}}>
              ✕ {t("閉じる","Close")}
            </button>
          )}
        </div>
      </div>

      {/* ── Firebase source info ─────────────────────────────── */}
      {fbSource && (
        <div style={{flexShrink:0,padding:"5px 14px",background:AV.surface,
                     borderBottom:`1px solid ${AV.border}`,display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:20,color:AV.textMid}}>
            {t("解析者","Analyzed by")}: <strong style={{color:AV.text}}>{fbSource.analyzedBy}</strong>
            {fbSource.createdAt && <span style={{color:AV.textMuted,marginLeft:6}}>{fmtDate(fbSource.createdAt)}</span>}
          </span>
          {fbSource.analyzedBy !== playerName && (
            <button onClick={handleReanalyze}
              style={{marginLeft:"auto",background:AV.pageBg,border:`1px solid ${AV.border}`,
                      borderRadius:6,color:AV.textMid,padding:"3px 12px",cursor:"pointer",fontSize:20,fontFamily:serif}}>
              {t("再解析","Re-analyze")}
            </button>
          )}
        </div>
      )}

      {/* ── progress bar ─────────────────────────────────────── */}
      {isAnalyzing&&(
        <div style={{flexShrink:0,padding:"6px 14px 7px",background:AV.surface,borderBottom:`1px solid ${AV.border}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
            <span style={{fontSize:20,color:AV.textMid}}>{t("解析中…","Analyzing…")} {progress}%</span>
            <span style={{fontSize:20,color:AV.textMuted}}>{Math.min(evals.length,history.length+1)}/{history.length+1}</span>
          </div>
          <div style={{height:4,background:AV.border,borderRadius:2}}>
            <div style={{height:"100%",width:`${progress}%`,background:`linear-gradient(to right,${AV.gold},${AV.borderGold})`,
                         borderRadius:2,transition:"width 0.3s"}}/>
          </div>
        </div>
      )}
      {engineError&&(
        <div style={{flexShrink:0,padding:"6px 14px",background:AV.dangerBg,
                     borderBottom:AV.dangerBorder}}>
          <span style={{fontSize:20,color:AV.danger}}>⚠ {t("エンジンエラー","Engine error")}: {engineError}</span>
        </div>
      )}

      {/* ── main body ────────────────────────────────────────── */}
      <div ref={wrapRef} style={{flex:1,minHeight:0,overflowY:"auto",
             background:AV.pageBg,
             display:"flex",flexDirection:pcLayout?"row":"column",
             gap:pcLayout?0:10,padding:pcLayout?"10px 14px":"8px 10px",
             boxSizing:"border-box",alignItems:pcLayout?"flex-start":"stretch"}}>

          {/* ── left: board area row + nav ───────────────── */}
          <div style={{display:"flex",flexDirection:"column",gap:4,alignItems:"center",
                       flexShrink:0,width:pcLayout?"auto":"100%"}}>

            {/* ── 横並び: 形勢バー | 盤面 | ユーザーブロック ── */}
            <div style={{display:"flex",flexDirection:"row",alignItems:"stretch",gap:4,flexShrink:0}}>

              {/* 1. 縦形勢バー（盤面の向きに合わせて上下ラベルを切り替え） */}
              {(()=>{
                // topColor に合わせてバーの向きを決定
                const topIsWhite = topColor === "w";
                const topLbl  = topIsWhite ? t("白","W") : t("黒","B");
                const btmLbl  = topIsWhite ? t("黒","B") : t("白","W");
                const topClr  = topIsWhite ? "#e0e0e0" : "#1a1a1a";
                const btmClr  = topIsWhite ? "#1a1a1a" : "#e0e0e0";
                const topLblBg = topIsWhite ? "#888" : "#222";
                const btmLblBg = topIsWhite ? "#222" : "#888";
                // 上側プレイヤーの優勢 % (0–100)
                const topPct = evalPawn !== null
                  ? (topIsWhite ? Math.round(50 + evalPawn) : Math.round(50 - evalPawn))
                  : 50;
                return (
                  <div style={{width:20,display:"flex",flexDirection:"column",alignItems:"center",
                               flexShrink:0,paddingTop:2,paddingBottom:2,gap:1}}>
                    <span style={{fontSize:9,color:"#e8e0d0",fontWeight:700,background:topLblBg,
                                  borderRadius:2,padding:"0 2px",lineHeight:"14px",userSelect:"none"}}>
                      {topLbl}
                    </span>
                    <div style={{flex:1,width:10,background:btmClr,borderRadius:3,overflow:"hidden",
                                 border:"1px solid #444",position:"relative"}}>
                      <div style={{position:"absolute",top:0,left:0,right:0,
                                   height:`${topPct}%`,
                                   background:topClr,transition:"height 0.45s ease"}}/>
                    </div>
                    <span style={{fontSize:9,fontWeight:700,background:btmLblBg,borderRadius:2,
                                  padding:"0 2px",lineHeight:"14px",border:"1px solid #444",
                                  color:"#e8e0d0",userSelect:"none"}}>
                      {btmLbl}
                    </span>
                    <span style={{fontSize:9,color:"#7c6040",fontFamily:"monospace",
                                  marginTop:2,userSelect:"none",whiteSpace:"nowrap"}}>
                      {evalStr}
                    </span>
                  </div>
                );
              })()}

              {/* 2. 盤面 */}
              <div style={{paddingLeft:isChess?14:0,flexShrink:0}}>
                {isChess
                  ? <AnalysisChessBoard board={curBoard} cellSize={cellSize}
                      hlFrom={hlFrom} hlTo={hlTo} bestMove={curBM} flipped={flipped}/>
                  : <AnalysisShogiBoard board={curBoard} cap={curCap} cellSize={cellSize}
                      hlFrom={hlFrom} hlTo={hlTo} bestMove={curBM}
                      getShogiImg={getShogiImg} playerLang={playerLang} flipped={flipped}
                      noHands/>
                }
              </div>

              {/* 3. ユーザーブロック列（上・下） */}
              <div style={{flex:1,minWidth:72,display:"flex",flexDirection:"column",
                           justifyContent:"space-between",paddingLeft:4}}>

                {/* 上ユーザーブロック: アイコン→名前→取り駒 */}
                <div style={{display:"flex",flexDirection:"column",gap:3}}>
                  {/* アイコン＆バッジ */}
                  <div style={{display:"flex",gap:3,alignItems:"center"}}>
                    <AvAvatarIcon url={topMember?.avatarUrl} size={22} name={topName}/>
                    {isChess
                      ? <AvKingBadge col={topColor} size={22}/>
                      : <AvShogiKingBadge color={topColor} size={22}/>
                    }
                  </div>
                  {/* ユーザーネーム */}
                  <div style={{fontSize:16,fontWeight:500,color:"#3a2e22",textAlign:"left",
                               fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif",
                               overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                               letterSpacing:"0.03em"}}>
                    {topName}
                  </div>
                  {/* 取り駒 */}
                  {isChess ? (
                    <div style={{display:"flex",flexWrap:"wrap",gap:1,
                                 minHeight:Math.round(cellSize*0.42)+2}}>
                      {(topCaptures||[]).map((p,i)=>(
                        <img key={i} src={PIECE_IMG_AV[p.color+p.type]} alt=""
                          style={{width:Math.round(cellSize*0.42),height:Math.round(cellSize*0.42),
                                  objectFit:"contain",flexShrink:0}}/>
                      ))}
                    </div>
                  ) : (
                    <ShogiHandArea cap={curCap} color={topColor}
                      cellSize={Math.round(cellSize*0.65)}
                      getShogiImg={getShogiImg} playerLang={playerLang}/>
                  )}
                </div>

                {/* 下ユーザーブロック: 取り駒→名前→アイコン */}
                <div style={{display:"flex",flexDirection:"column",gap:3}}>
                  {/* 取り駒 */}
                  {isChess ? (
                    <div style={{display:"flex",flexWrap:"wrap",gap:1,
                                 minHeight:Math.round(cellSize*0.42)+2}}>
                      {(bottomCaptures||[]).map((p,i)=>(
                        <img key={i} src={PIECE_IMG_AV[p.color+p.type]} alt=""
                          style={{width:Math.round(cellSize*0.42),height:Math.round(cellSize*0.42),
                                  objectFit:"contain",flexShrink:0}}/>
                      ))}
                    </div>
                  ) : (
                    <ShogiHandArea cap={curCap} color={bottomColor}
                      cellSize={Math.round(cellSize*0.65)}
                      getShogiImg={getShogiImg} playerLang={playerLang}/>
                  )}
                  {/* ユーザーネーム */}
                  <div style={{fontSize:16,fontWeight:500,color:"#3a2e22",textAlign:"left",
                               fontFamily:"'Cormorant Garamond','Zen Old Mincho',Georgia,serif",
                               overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                               letterSpacing:"0.03em"}}>
                    {bottomName}
                  </div>
                  {/* アイコン＆バッジ */}
                  <div style={{display:"flex",gap:3,alignItems:"center"}}>
                    <AvAvatarIcon url={bottomMember?.avatarUrl} size={22} name={bottomName}/>
                    {isChess
                      ? <AvKingBadge col={bottomColor} size={22}/>
                      : <AvShogiKingBadge color={bottomColor} size={22}/>
                    }
                  </div>
                </div>
              </div>
            </div>

            {/* ナビゲーション */}
            <div style={{display:"flex",gap:6,alignItems:"center",width:"100%",justifyContent:"center"}}>
              <button style={nb(currentIdx===0)} disabled={currentIdx===0}
                onMouseDown={e=>e.preventDefault()} onClick={()=>goTo(0)}>⏮</button>
              <button style={nb(currentIdx===0)} disabled={currentIdx===0}
                onMouseDown={e=>e.preventDefault()} onClick={()=>goTo(currentIdx-1)}>◀</button>
              <div style={{minWidth:88,textAlign:"center",flexShrink:0,lineHeight:1.25}}>
                <div style={{color:AV.textMid,fontSize:19,fontFamily:"monospace"}}>
                  {currentIdx} / {history.length}
                </div>
                {currentIdx>0 && curClassify ? (
                  <div style={{fontSize:15,fontWeight:700,color:curClassify.color,whiteSpace:"nowrap"}}>
                    {curClassify.icon} {playerLang==="en"?curClassify.en:curClassify.ja}
                  </div>
                ) : (
                  <div style={{fontSize:15,color:AV.textMuted}}>
                    {currentIdx===0 ? t("開始局面","Start") : ""}
                  </div>
                )}
              </div>
              <button style={nb(currentIdx===history.length)} disabled={currentIdx===history.length}
                onMouseDown={e=>e.preventDefault()} onClick={()=>goTo(currentIdx+1)}>▶</button>
              <button style={nb(currentIdx===history.length)} disabled={currentIdx===history.length}
                onMouseDown={e=>e.preventDefault()} onClick={()=>goTo(history.length)}>⏭</button>
              <button onMouseDown={e=>e.preventDefault()} onClick={()=>setFlipped(f=>!f)}
                style={{...nb(false),marginLeft:4,fontSize:16}}>⇅</button>
            </div>
          </div>

          {/* ── right: graph + accuracy + move list ───────── */}
          <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:10,
                       paddingLeft:pcLayout?14:0}}>

            {/* eval graph */}
            {graphData.length>1&&(
              <div style={{background:AV.surface,borderRadius:10,padding:"10px 6px 6px",
                           border:`1px solid ${AV.border}`,flexShrink:0,
                           boxShadow:"0 1px 4px rgba(42,26,8,0.06)"}}>
                <div style={{fontSize:20,color:AV.textMid,marginBottom:4,letterSpacing:"0.05em",paddingLeft:4}}>
                  {t("評価グラフ","Evaluation Graph")}
                </div>
                <ResponsiveContainer width="100%" height={100}>
                  <LineChart data={graphData}
                    onClick={(d)=>{ if(d?.activeLabel!==undefined) goTo(Number(d.activeLabel)); }}
                    style={{cursor:"pointer"}}>
                    <CartesianGrid strokeDasharray="2 4" stroke="rgba(180,140,80,0.18)"/>
                    <XAxis dataKey="move" hide/>
                    <YAxis domain={[-15,15]} tickCount={5} tick={{fill:"#a89070",fontSize:10}} width={26}/>
                    <ReferenceLine y={0} stroke="rgba(180,140,80,0.45)" strokeDasharray="4 4"/>
                    {currentIdx>0&&<ReferenceLine x={currentIdx} stroke="rgba(176,136,48,0.65)" strokeWidth={2}/>}
                    <Line type="monotone" dataKey="eval" stroke="#b08830" strokeWidth={2}
                          dot={false} activeDot={{r:5,fill:"#7c6040"}}/>
                    <Tooltip content={<EvalTip playerLang={playerLang}/>}/>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* accuracy — logged-in user only */}
            {accFirst!==null&&(()=>{
              const myAcc = playerName===firstName ? accFirst : playerName===secondName ? accSecond : null;
              if (myAcc===null) return null;
              return (
                <div style={{flexShrink:0,background:AV.surface,borderRadius:8,
                             padding:"8px 10px",border:`1px solid ${AV.border}`,
                             textAlign:"center",boxShadow:"0 1px 4px rgba(42,26,8,0.06)"}}>
                  <div style={{fontSize:20,color:AV.textMuted,marginBottom:2}}>{playerName}</div>
                  <div style={{fontSize:"clamp(22px,4vw,28px)",fontWeight:"bold",fontFamily:"monospace",
                               color:myAcc>=90?"#4ed":myAcc>=75?"#ae4":myAcc>=60?"#fa0":"#f66"}}>
                    {Math.round(myAcc)}%
                  </div>
                  <div style={{fontSize:20,color:AV.textMuted}}>{t("最善手を選べた割合","Best move rate")}</div>
                </div>
              );
            })()}

            {/* move list */}
            <div ref={moveListRef}
              style={{flex:1,minHeight:120,background:AV.surface,
                      borderRadius:10,padding:"8px",border:`1px solid ${AV.border}`,
                      overflowY:"auto",boxShadow:"0 1px 4px rgba(42,26,8,0.06)"}}>
              <div style={{fontSize:20,color:AV.textMid,marginBottom:5,letterSpacing:"0.04em"}}>
                {t("指し手一覧","Move List")}
              </div>
              {/* initial position */}
              <div ref={currentIdx===0?activeItemRef:null} onClick={()=>goTo(0)}
                style={{display:"flex",alignItems:"center",gap:6,padding:"4px 6px",borderRadius:4,
                        cursor:"pointer",background:currentIdx===0?"rgba(180,140,80,0.14)":"transparent",
                        marginBottom:1,borderLeft:"3px solid transparent"}}>
                <span style={{minWidth:28,fontSize:20,color:AV.textMuted,textAlign:"right",flexShrink:0}}>0.</span>
                <span style={{fontSize:20,color:AV.textMid}}>{t("開始局面","Start")}</span>
              </div>
              {history.map((h,i)=>{
                const cpl=(evals[i]!==undefined&&evals[i+1]!==undefined)?getCPL(evals[i],evals[i+1],i):null;
                const cls=cpl!==null?classify(cpl):null;
                const isAct=currentIdx===i+1;
                const nota=isChess?(h.notation||uciMoves[i]||""):shogiNota(h);
                return (
                  <div key={i} ref={isAct?activeItemRef:null} onClick={()=>goTo(i+1)}
                    style={{display:"flex",alignItems:"center",gap:4,padding:"4px 6px",
                            borderRadius:4,cursor:"pointer",marginBottom:1,
                            background:isAct?"rgba(180,140,80,0.14)":"transparent",
                            borderLeft:`3px solid ${cls?cls.color:"transparent"}`}}>
                    <span style={{minWidth:28,fontSize:20,color:AV.textMuted,textAlign:"right",flexShrink:0}}>{i+1}.</span>
                    <span style={{fontSize:20,color:AV.text,fontFamily:"monospace",minWidth:80,flexShrink:0,
                                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{nota}</span>
                    {cls&&(
                      <span style={{fontSize:20,color:cls.color,flexShrink:0,whiteSpace:"nowrap"}}>
                        {cls.icon} {playerLang==="en"?cls.en:cls.ja}
                      </span>
                    )}
                    {cpl!==null&&cpl>10&&(
                      <span style={{fontSize:20,color:AV.textMuted,marginLeft:"auto",flexShrink:0}}>
                        -{Math.round(cpl)}cp
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
    </div>
  );
}
