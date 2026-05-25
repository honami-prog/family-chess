// Chess AI engine wrapper (Stockfish 18 via UCI)

export const CHESS_AI_LEVELS = [
  { nameJa:"キッズ",    nameEn:"Kids",      skillLevel:0,  movetime:300  },
  { nameJa:"入門",      nameEn:"Beginner",  skillLevel:2,  movetime:400  },
  { nameJa:"初級",      nameEn:"Easy",      skillLevel:4,  movetime:500  },
  { nameJa:"初中級",    nameEn:"Easy+",     skillLevel:6,  movetime:700  },
  { nameJa:"中級",      nameEn:"Medium",    skillLevel:9,  movetime:1000 },
  { nameJa:"中上級",    nameEn:"Medium+",   skillLevel:11, movetime:1500 },
  { nameJa:"上級",      nameEn:"Hard",      skillLevel:14, movetime:2000 },
  { nameJa:"高段",      nameEn:"Hard+",     skillLevel:16, movetime:3000 },
  { nameJa:"マスター",  nameEn:"Expert",    skillLevel:18, movetime:4000 },
  { nameJa:"エキスパート",nameEn:"Master",  skillLevel:20, movetime:6000 },
];

export class ChessEngine {
  constructor() {
    this._w = null;
    this._ready = false;
    this._resolve = null;
  }

  init() {
    return new Promise((resolve, reject) => {
      try { this._w = new Worker('/stockfish.js'); }
      catch(e) { reject(e); return; }
      const tid = setTimeout(() => reject(new Error('Stockfish timeout')), 15000);
      this._w.onmessage = (e) => {
        const msg = typeof e.data === 'string' ? e.data : String(e.data ?? '');
        if (msg === 'uciok') {
          this._w.postMessage('isready');
        } else if (msg === 'readyok') {
          clearTimeout(tid);
          this._ready = true;
          resolve(this);
        } else if (msg.startsWith('bestmove ')) {
          if (this._resolve) {
            const m = msg.split(' ')[1];
            this._resolve(m === '(none)' ? null : m);
            this._resolve = null;
          }
        }
      };
      this._w.onerror = (e) => { clearTimeout(tid); reject(e); };
      this._w.postMessage('uci');
    });
  }

  get ready() { return this._ready; }

  getBestMove(fen, level) {
    return new Promise((resolve) => {
      if (!this._w || !this._ready) { resolve(null); return; }
      const lv = CHESS_AI_LEVELS[Math.min(level - 1, CHESS_AI_LEVELS.length - 1)];
      this._resolve = resolve;
      this._w.postMessage('ucinewgame');
      this._w.postMessage(`setoption name Skill Level value ${lv.skillLevel}`);
      this._w.postMessage(`position fen ${fen}`);
      this._w.postMessage(`go movetime ${lv.movetime}`);
    });
  }

  stop() { if (this._w) try { this._w.postMessage('stop'); } catch(e) {} }

  destroy() {
    if (this._w) {
      try { this._w.postMessage('quit'); } catch(e) {}
      try { this._w.terminate(); } catch(e) {}
      this._w = null;
      this._ready = false;
    }
  }
}

// board[r][c] = {color:'w'|'b', type:'K'|'Q'|'R'|'B'|'N'|'P'} or null
// row 0 = rank 8 (black back rank), row 7 = rank 1 (white back rank)
export function boardToFen(board, turn, castling, epSquare) {
  let fen = '';
  for (let r = 0; r < 8; r++) {
    let emp = 0;
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) { emp++; }
      else {
        if (emp) { fen += emp; emp = 0; }
        fen += p.color === 'w' ? p.type : p.type.toLowerCase();
      }
    }
    if (emp) fen += emp;
    if (r < 7) fen += '/';
  }
  fen += ` ${turn} `;
  if (castling) {
    let cs = '';
    if (castling.wK && castling.wKR) cs += 'K';
    if (castling.wK && castling.wQR) cs += 'Q';
    if (castling.bK && castling.bKR) cs += 'k';
    if (castling.bK && castling.bQR) cs += 'q';
    fen += cs || '-';
  } else { fen += '-'; }
  fen += ' ';
  if (epSquare) {
    fen += String.fromCharCode(97 + epSquare[1]) + (8 - epSquare[0]);
  } else { fen += '-'; }
  fen += ' 0 1';
  return fen;
}

// UCI move string "e2e4"/"e7e8q" → {fr,fc,tr,tc,promo}
export function uciToCoords(uci) {
  if (!uci || uci.length < 4) return null;
  return {
    fc: uci.charCodeAt(0) - 97,
    fr: 8 - parseInt(uci[1]),
    tc: uci.charCodeAt(2) - 97,
    tr: 8 - parseInt(uci[3]),
    promo: uci[4] ? uci[4].toUpperCase() : null,
  };
}
