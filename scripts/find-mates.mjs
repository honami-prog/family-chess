/**
 * Finds valid checkmate-in-1 positions using chess.js by trying moves.
 * Run: node scripts/find-mates.mjs
 */
import { Chess } from "chess.js";

// Verify a single move is checkmate
function isCheckmate1(fen, uciMove) {
  try {
    const c = new Chess(fen);
    const from = uciMove.slice(0,2);
    const to   = uciMove.slice(2,4);
    const promo = uciMove[4];
    const m = c.move({ from, to, ...(promo ? { promotion: promo } : {}) });
    if (!m) return false;
    return c.isCheckmate();
  } catch { return false; }
}

// Find all Mate-in-1 moves from a position
function findMates(fen) {
  const c = new Chess(fen);
  return c.moves({ verbose: true }).filter(m => {
    const c2 = new Chess(fen);
    c2.move(m);
    return c2.isCheckmate();
  }).map(m => m.lan || (m.from + m.to + (m.promotion||'')));
}

// Test positions
const positions = [
  // easy_005: need valid Rf8# position
  { id: "easy_005", fen: "6k1/5Rpp/8/8/8/8/6PP/6K1 w - - 0 1" },
  // easy_007: need valid Nf7# position
  { id: "easy_007", fen: "r1bk3r/ppp2ppp/8/4N3/8/8/PPP2PPP/R1B1K2R w KQ - 0 1" },
  // easy_010: original
  { id: "easy_010", fen: "6kR/6P1/5K2/8/8/8/8/8 w - - 0 1" },
  // normal_001
  { id: "normal_001", fen: "r2qkb1r/ppp2ppp/2np1n2/1B2p1B1/3PP3/2N2N2/PPP2PPP/R2QK2R w KQkq - 0 1" },
  // normal_003
  { id: "normal_003", fen: "rnbqk1nr/pppp1ppp/8/4p3/1bB1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 4" },
  // normal_006
  { id: "normal_006", fen: "rnb1kbnr/pppp1ppp/8/4p3/2B1P1q1/8/PPPP1PPP/RNBQK1NR w KQkq - 2 3" },
  // normal_009
  { id: "normal_009", fen: "2r3k1/1ppq1ppp/p2p1n2/4r3/4Q3/8/PPP2PPP/R4RK1 b - - 0 1" },
  // hard_002
  { id: "hard_002", fen: "5rk1/ppp2ppp/8/3Q4/8/8/PPP2PPP/5RK1 w - - 0 1" },
  // hard_005
  { id: "hard_005", fen: "r4rk1/pp3ppp/2p5/q3n3/8/2NQ4/PPP2PPP/R4RK1 w - - 0 1" },
  // hard_008
  { id: "hard_008", fen: "8/8/8/8/8/k7/pR6/K7 b - - 0 1" },
];

for (const p of positions) {
  const mates = findMates(p.fen);
  const allMoves = new Chess(p.fen).moves({ verbose:true }).slice(0,5).map(m=>m.lan||m.from+m.to);
  console.log(`\n[${p.id}]`);
  console.log(`  FEN: ${p.fen}`);
  console.log(`  Turn: ${new Chess(p.fen).turn()}`);
  console.log(`  Mate-in-1 moves: ${mates.length > 0 ? mates.join(', ') : 'NONE'}`);
  console.log(`  Sample legal moves: ${allMoves.join(', ')}`);
}
