// validate-chess.mjs
// Validates all chess FEN + moves data across all learning content files.
// Run: node validate-chess.mjs

import { Chess } from 'chess.js';

// ── helpers ────────────────────────────────────────────────────────────────
function validateMoves(id, fen, moves) {
  const chess = fen ? new Chess(fen) : new Chess();
  const errors = [];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const from = m.slice(0, 2);
    const to   = m.slice(2, 4);
    const promo = m[4] || undefined;
    let result = null;
    try {
      result = chess.move({ from, to, promotion: promo });
    } catch (e) {
      result = null;
    }
    if (!result) {
      errors.push(`  Move ${i+1} "${m}" is ILLEGAL. FEN before: ${chess.fen()}`);
      break; // stop after first illegal move to avoid cascading errors
    }
  }
  if (errors.length) {
    console.error(`\n❌  ${id}`);
    errors.forEach(e => console.error(e));
  } else {
    console.log(`✅  ${id}`);
  }
  return errors.length === 0;
}

// ── CHESS_OPENINGS (start position implied) ────────────────────────────────
const CHESS_OPENINGS = [
  { id:'ruy_lopez',     moves:['e2e4','e7e5','g1f3','b8c6','f1b5'] },
  { id:'italian',       moves:['e2e4','e7e5','g1f3','b8c6','f1c4','f8c5'] },
  { id:'sicilian',      moves:['e2e4','c7c5','g1f3','d7d6','d2d4','c5d4','f3d4','g8f6','b1c3','a7a6'] },
  { id:'queens_gambit', moves:['d2d4','d7d5','c2c4','e7e6','b1c3','g8f6','c1g5'] },
  { id:'kings_indian',  moves:['d2d4','g8f6','c2c4','g7g6','b1c3','f8g7','e2e4','d7d6','g1f3'] },
  { id:'french',        moves:['e2e4','e7e6','d2d4','d7d5','b1c3','g8f6','c1g5'] },
  { id:'caro_kann',     moves:['e2e4','c7c6','d2d4','d7d5','b1c3','d5e4','c3e4','c8f5'] },
  { id:'london',        moves:['d2d4','d7d5','g1f3','g8f6','c1f4','e7e6','e2e3','c7c5'] },
  { id:'english',       moves:['c2c4','e7e5','b1c3','g8f6','g2g3','d7d5','c4d5','f6d5'] },
  { id:'nimzo_indian',  moves:['d2d4','g8f6','c2c4','e7e6','b1c3','f8b4'] },
];

// ── CHESS_TACTICS ──────────────────────────────────────────────────────────
const CHESS_TACTICS = [
  { id:'fork',             fen:'r1bqkb1r/pppp1ppp/2n2n2/4p3/3NP3/8/PPPP1PPP/RNBQKB1R w KQkq - 0 1',      moves:['d4c6'] },
  { id:'pin',              fen:'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1',   moves:['c4f7'] },
  { id:'skewer',           fen:'4k3/8/8/8/8/8/4R3/4K3 w - - 0 1',                                         moves:['e2e8'] },
  { id:'back_rank',        fen:'6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',                                    moves:['a1a8'] },
  { id:'discovered_attack',fen:'r1bqkb1r/ppp2ppp/2np1n2/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 1', moves:['c3d5'] },
  { id:'double_attack',    fen:'r1bqkb1r/ppp2ppp/2np4/4p3/2BnP3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 1',   moves:['f3e5'] },
  { id:'zwischenzug',      fen:'r1bqk2r/pppp1ppp/2n2n2/2b5/2BpP3/5N2/PPP2PPP/RNBQK2R w KQkq - 0 1',     moves:['c4f7'] },
  { id:'overloading',      fen:'6k1/3r1ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',                                moves:['d1d7'] },
  { id:'deflection',       fen:'3r2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',                                moves:['d1d8'] },
  { id:'decoy',            fen:'6k1/5ppp/8/8/8/8/5PPP/Q5K1 w - - 0 1',                                    moves:['a1a8'] },
  { id:'zugzwang',         fen:'8/8/3k4/8/3K4/8/8/8 w - - 0 1',                                           moves:['d4c4','d6c6'] },
  { id:'xray',             fen:'4k3/8/8/3r4/8/8/8/R3K3 w Q - 0 1',                                        moves:['a1a5'] },
  { id:'endgame',          fen:'4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',                                         moves:['e1d2','e8d7','e2e4'] },
];

// ── CHESS_STRATEGY ─────────────────────────────────────────────────────────
const CHESS_STRATEGY = [
  { id:'center-control',     fen:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',                 moves:['e2e4','e7e5','d2d4','d7d5'] },
  { id:'piece-activity',     fen:'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',              moves:['e7e5','g1f3','b8c6','f1c4'] },
  { id:'king-safety',        fen:'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 4 5', moves:['e1g1','e8g8'] },
  { id:'tempo',              fen:'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',            moves:['g1f3','b8c6','f1b5'] },
  { id:'passed-pawn',        fen:'8/8/4k3/8/3PP3/8/8/4K3 w - - 0 1',                                           moves:['d4d5','e6e7','e4e5'] },
  { id:'doubled-pawn',       fen:'rnbqkb1r/ppp2ppp/3p1n2/4p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 2 5',   moves:['c4f7','e8f7'] },
  { id:'isolated-pawn',      fen:'r1bqr1k1/pp3ppp/2n2n2/4p3/3P4/2NB1N2/PPP2PPP/R1BQ1RK1 w - - 0 9',         moves:['d4d5'] },
  { id:'pawn-chain',         fen:'rnbqkb1r/pp3ppp/2pp1n2/3Pp3/2P1P3/2N5/PP3PPP/R1BQKBNR w KQkq - 0 6',      moves:['c4c5'] },
  { id:'open-file',          fen:'r2q1rk1/ppp2ppp/2n2n2/3p4/3P4/2N2N2/PPP2PPP/R2Q1RK1 w - - 0 8',           moves:['f1e1','f8e8'] },
  { id:'bishop-pair',        fen:'r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 4 4',   moves:['f1b5','a7a6','b5c6','d7c6'] },
  { id:'knight-vs-bishop',   fen:'4k3/pp3ppp/2p5/3p1N2/3P4/2P5/PP3PPP/4K3 w - - 0 1',                       moves:['f5e3','e8d7'] },
  { id:'rook-seventh',       fen:'6k1/pp4R1/8/8/8/8/PP3r2/6K1 w - - 0 1',                                     moves:['g7h7'] },
  { id:'opening-principles', fen:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',                  moves:['e2e4','e7e5','g1f3','b8c6','f1c4','f8c5','e1g1'] },
  { id:'middlegame-planning', fen:'r1bq1rk1/pp3ppp/2n1pn2/2pp4/3P4/2PB1N2/PP3PPP/R1BQ1RK1 w - - 0 9',        moves:['c1f4','c5d4','c3d4'] },
  { id:'endgame-basics',     fen:'8/4k3/8/3pP3/8/8/4K3/8 w - - 0 1',                                          moves:['e2d3','e7e6','d3d4'] },
];

// ── CHESS_ENDGAME ──────────────────────────────────────────────────────────
const CHESS_ENDGAME = [
  {
    id:'kr-vs-k',
    fen:'8/8/8/3k4/8/8/8/R3K3 w Q - 0 1',
    moves:['e1e2','d5d6','a1a6','d6c5','e2e3','c5b5','e3d3','b5c5','a6a5','c5b6','a5b5','b6c6','d3e4','c6d6','b5d5'],
  },
  {
    id:'kq-vs-k',
    fen:'8/8/8/3k4/8/8/8/Q3K3 w Q - 0 1',
    moves:['e1e2','d5d6','a1a4','d6e5','a4e4','e5d6','e2d3','d6c5','e4e5','c5b4','e5b5','b4a3','d3c4','a3a2','b5a4'],
  },
  {
    id:'pawn-ending',
    fen:'8/8/8/4p3/4P3/8/8/4K1k1 w - - 0 1',
    moves:['e1e2','g1h2','e2d3','h2g3','d3c4','g3f4','c4b5','f4e3','b5c5','e3d3','c5d5'],
  },
  {
    id:'passed-pawn',
    fen:'8/8/8/8/1P6/8/3K4/3k4 w - - 0 1',
    moves:['d2c3','d1c1','c3b3','c1b1','b4b5','b1a1','b5b6','a1b1','b3a4','b1a2','b6b7','a2a1','b7b8q'],
  },
  {
    id:'rook-ending',
    fen:'8/8/8/3k4/3p4/8/3K4/3R4 w - - 0 1',
    moves:['d2c2','d5e4','d1d3','e4f4','d3d1','f4e3','d1e1','e3f3','e1f1','f3g3','f1g1','g3h3','g1h1'],
  },
  {
    id:'bishop-vs-knight',
    fen:'4k3/5p2/8/3B4/8/5N2/5P2/4K3 w - - 0 1',
    moves:['e1d2','e8d7','d5f7','d7c8','d2e3','c8d7','f7d5','d7e8','d5b7'],
  },
];

// ── Run all validations ────────────────────────────────────────────────────
console.log('\n=== CHESS_OPENINGS ===');
let allOk = true;
for (const o of CHESS_OPENINGS) {
  if (!validateMoves(`opening:${o.id}`, null, o.moves)) allOk = false;
}

console.log('\n=== CHESS_TACTICS ===');
for (const t of CHESS_TACTICS) {
  if (!validateMoves(`tactic:${t.id}`, t.fen, t.moves)) allOk = false;
}

console.log('\n=== CHESS_STRATEGY ===');
for (const s of CHESS_STRATEGY) {
  if (!validateMoves(`strategy:${s.id}`, s.fen, s.moves)) allOk = false;
}

console.log('\n=== CHESS_ENDGAME ===');
for (const e of CHESS_ENDGAME) {
  if (!validateMoves(`endgame:${e.id}`, e.fen, e.moves)) allOk = false;
}

console.log(allOk ? '\n✅  All data is valid!' : '\n⚠️  Errors found — see above.');
