// Shogi AI Web Worker — all logic self-contained (no imports)

// ── Move generation (mirrors App.jsx) ─────────────────────────────
function sShogiMoves(board, r, c) {
  const piece = board[r]?.[c]; if (!piece) return [];
  const {color, type, p:promoted} = piece;
  const f = color==='b' ? -1 : 1;
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
  if (promoted && type!=='K'&&type!=='G'&&type!=='R'&&type!=='B') { gd.forEach(([dr,dc])=>addSt(dr,dc)); return moves; }
  switch(type) {
    case 'P': promoted ? gd.forEach(([dr,dc])=>addSt(dr,dc)) : addSt(f,0); break;
    case 'L': promoted ? gd.forEach(([dr,dc])=>addSt(dr,dc)) : addSl(f,0); break;
    case 'N': promoted ? gd.forEach(([dr,dc])=>addSt(dr,dc)) : (addSt(2*f,-1),addSt(2*f,1)); break;
    case 'S': promoted ? gd.forEach(([dr,dc])=>addSt(dr,dc)) : [[f,0],[f,-1],[f,1],[-f,-1],[-f,1]].forEach(([dr,dc])=>addSt(dr,dc)); break;
    case 'G': gd.forEach(([dr,dc])=>addSt(dr,dc)); break;
    case 'B': [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(([dr,dc])=>addSl(dr,dc)); if(promoted) [[0,-1],[0,1],[-1,0],[1,0]].forEach(([dr,dc])=>addSt(dr,dc)); break;
    case 'R': [[0,-1],[0,1],[-1,0],[1,0]].forEach(([dr,dc])=>addSl(dr,dc)); if(promoted) [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(([dr,dc])=>addSt(dr,dc)); break;
    case 'K': [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].forEach(([dr,dc])=>addSt(dr,dc)); break;
  }
  return moves;
}
function inShogiCheck(board, color) {
  let kr=-1, kc=-1;
  for (let r=0;r<9;r++) for (let c=0;c<9;c++) { const p=board[r][c]; if(p?.color===color&&p?.type==='K'){kr=r;kc=c;} }
  if (kr===-1) return false;
  const opp=color==='b'?'w':'b';
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
function getShogiLegalDrops(board, cap, color) {
  const drops=[]; const opp=color==='b'?'w':'b';
  Object.entries(cap[color]||{}).forEach(([pType,count])=>{
    if(!count) return;
    for(let r=0;r<9;r++) for(let c=0;c<9;c++){
      if(board[r][c]) continue;
      if((pType==='P'||pType==='L')&&((color==='b'&&r===0)||(color==='w'&&r===8))) continue;
      if(pType==='N'&&((color==='b'&&r<=1)||(color==='w'&&r>=7))) continue;
      if(pType==='P'){
        let hasPawn=false;
        for(let rr=0;rr<9;rr++){const pp=board[rr][c];if(pp?.color===color&&pp?.type==='P'&&!pp.p){hasPawn=true;break;}}
        if(hasPawn) continue;
        // 打ち歩詰め check
        const {board:nb}=applyShogiDrop(board,cap,r,c,color,pType);
        let oppCanMove=false;
        for(let rr=0;rr<9;rr++) for(let cc=0;cc<9;cc++){
          if(nb[rr][cc]?.color!==opp) continue;
          if(sShogiMoves(nb,rr,cc).some(([tr,tc])=>{const{board:nb2}=applyShogiMove(nb,cap,rr,cc,tr,tc,false);return !inShogiCheck(nb2,opp);})){oppCanMove=true;break;}
          if(oppCanMove) break;
        }
        if(inShogiCheck(nb,opp)&&!oppCanMove) continue;
      }
      const {board:nb}=applyShogiDrop(board,cap,r,c,color,pType);
      if(!inShogiCheck(nb,color)) drops.push({r,c,pType});
    }
  });
  return drops;
}
const sMustPromote=(color,type,tr)=>{
  if(type==='P'||type==='L') return (color==='b'&&tr===0)||(color==='w'&&tr===8);
  if(type==='N') return (color==='b'&&tr<=1)||(color==='w'&&tr>=7);
  return false;
};
const sCanPromote=(color,type,fr,tr)=>{
  if(type==='K'||type==='G') return false;
  const inZ=(r)=>color==='b'?r<=2:r>=6;
  return inZ(fr)||inZ(tr);
};

// ── AI Evaluation & Minimax ────────────────────────────────────────
const PV  = {K:100000,R:510,B:460,G:410,S:390,N:270,L:260,P:100};
const PPV = {R:610,B:560,S:450,N:450,L:450,P:450};

function evalBoard(bd, cap) {
  let s=0;
  for(let r=0;r<9;r++) for(let c=0;c<9;c++){
    const p=bd[r][c]; if(!p) continue;
    const v = p.p ? (PPV[p.type]||PV[p.type]||0) : (PV[p.type]||0);
    s += p.color==='b' ? v : -v;
  }
  for(const[t,n] of Object.entries(cap.b||{})) s+=(PV[t]||0)*n*0.9;
  for(const[t,n] of Object.entries(cap.w||{})) s-=(PV[t]||0)*n*0.9;
  return s;
}

function minimax(bd, cap, color, depth, alpha, beta) {
  if(depth===0) return evalBoard(bd,cap);
  const opp=color==='b'?'w':'b';
  let best=color==='b'?-1e9:1e9;
  let hasMoves=false;

  for(let r=0;r<9;r++){
    for(let c=0;c<9;c++){
      if(bd[r][c]?.color!==color) continue;
      const legal=getShogiLegalMoves(bd,cap,r,c);
      for(const[tr,tc] of legal){
        hasMoves=true;
        const t=bd[r][c].type;
        const canP=!bd[r][c].p&&sCanPromote(color,t,r,tr);
        const {board:nb,cap:nc}=applyShogiMove(bd,cap,r,c,tr,tc,canP);
        const score=minimax(nb,nc,opp,depth-1,alpha,beta);
        if(color==='b'){if(score>best)best=score;if(score>alpha)alpha=score;}
        else{if(score<best)best=score;if(score<beta)beta=score;}
        if(beta<=alpha) return best;
      }
    }
  }
  const drops=getShogiLegalDrops(bd,cap,color);
  for(const{r,c,pType} of drops){
    hasMoves=true;
    const {board:nb,cap:nc}=applyShogiDrop(bd,cap,r,c,color,pType);
    const score=minimax(nb,nc,opp,depth-1,alpha,beta);
    if(color==='b'){if(score>best)best=score;if(score>alpha)alpha=score;}
    else{if(score<best)best=score;if(score<beta)beta=score;}
    if(beta<=alpha) return best;
  }
  if(!hasMoves) return color==='b'?-99999:99999;
  return best;
}

function getBestShogiMove(board, cap, color, level) {
  // depth by level
  const depth = level<=2?0 : level<=5?1 : level<=7?2 : 3;
  const noise = level<=2?300 : level<=4?120 : level<=5?40 : 0;
  const opp=color==='b'?'w':'b';
  const sign=color==='b'?1:-1;

  // Collect all candidate moves
  const moves=[];
  for(let r=0;r<9;r++) for(let c=0;c<9;c++){
    if(board[r][c]?.color!==color) continue;
    const legal=getShogiLegalMoves(board,cap,r,c);
    for(const[tr,tc] of legal){
      const t=board[r][c].type;
      const canP=!board[r][c].p&&sCanPromote(color,t,r,tr);
      const mustP=sMustPromote(color,t,tr);
      moves.push({type:'move',fr:r,fc:c,tr,tc,promote:canP});
      if(canP&&!mustP) moves.push({type:'move',fr:r,fc:c,tr,tc,promote:false});
    }
  }
  for(const d of getShogiLegalDrops(board,cap,color)){
    moves.push({type:'drop',r:d.r,c:d.c,pType:d.pType});
  }
  if(!moves.length) return null;
  if(depth===0) return moves[Math.floor(Math.random()*moves.length)];

  let best=-1e9, bestMoves=[];
  for(const mv of moves){
    let nb,nc;
    if(mv.type==='move') ({board:nb,cap:nc}=applyShogiMove(board,cap,mv.fr,mv.fc,mv.tr,mv.tc,mv.promote));
    else ({board:nb,cap:nc}=applyShogiDrop(board,cap,mv.r,mv.c,color,mv.pType));
    let score=sign*minimax(nb,nc,opp,depth-1,-1e9,1e9);
    score+=(Math.random()-0.5)*noise*2;
    if(score>best){best=score;bestMoves=[mv];}
    else if(score>=best-1) bestMoves.push(mv);
  }
  return bestMoves[Math.floor(Math.random()*bestMoves.length)]||moves[0];
}

// ── Worker entry point ─────────────────────────────────────────────
self.onmessage = function(e) {
  const {board, cap, color, level} = e.data;
  const move = getBestShogiMove(board, cap, color, level);
  self.postMessage({move});
};
