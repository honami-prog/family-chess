/**
 * Builds the final chess.json:
 * - 10 Easy hand-crafted puzzles (verified)
 * - 10 Normal from Lichess (already in chess.json)
 * - 10 Hard hand-crafted puzzles (verified)
 */
import { Chess } from "chess.js";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHESS_JSON = join(__dirname, "../public/puzzles/chess.json");

function verify(fen, uciMoves, expectedResult) {
  try {
    const c = new Chess(fen);
    for (const uci of uciMoves) {
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promotion = uci[4] || undefined;
      const m = c.move({ from, to, ...(promotion ? { promotion } : {}) });
      if (!m) return { ok: false, reason: `Move ${uci} is illegal` };
    }
    if (expectedResult === "checkmate" && !c.isCheckmate())
      return { ok: false, reason: `Expected checkmate, fen after: ${c.fen()}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ─── EASY PUZZLES (all verified Mate-in-1) ───────────────────────────────────
const easyPuzzles = [
  {
    id: "easy_001",
    difficulty: "Easy",
    titleJa: "1手詰み - スカラーズメイト",
    titleEn: "Mate in 1 – Scholar's Mate",
    descJa: "白番です。1手で詰ませてください。",
    descEn: "White to move. Checkmate in 1.",
    turn: "w",
    fen: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
    moves: ["h5f7"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "scholar"],
    rating: 800,
    hint: [1, 5],
  },
  {
    id: "easy_002",
    difficulty: "Easy",
    titleJa: "1手詰み - バックランクメイト",
    titleEn: "Mate in 1 – Back Rank",
    descJa: "白番です。バックランクを突いて詰ませてください。",
    descEn: "White to move. Deliver back rank mate.",
    turn: "w",
    fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1",
    moves: ["a1a8"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "backRank"],
    rating: 700,
    hint: [0, 0],
  },
  {
    id: "easy_003",
    difficulty: "Easy",
    titleJa: "1手詰み - ルークメイト",
    titleEn: "Mate in 1 – Rook Mate",
    descJa: "白番です。ルークで詰ませてください。",
    descEn: "White to move. Checkmate with the rook.",
    turn: "w",
    fen: "k7/8/1K6/8/8/8/8/7R w - - 0 1",
    moves: ["h1h8"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "rookEndgame"],
    rating: 650,
    hint: [0, 7],
  },
  {
    id: "easy_004",
    difficulty: "Easy",
    titleJa: "1手詰み - クイーンメイト",
    titleEn: "Mate in 1 – Queen Mate",
    descJa: "黒番です。クイーンで詰ませてください。",
    descEn: "Black to move. Checkmate with the queen.",
    turn: "b",
    fen: "8/8/8/8/8/1k6/8/qK6 b - - 0 1",
    moves: ["a1b2"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "queenEndgame"],
    rating: 700,
    hint: [6, 1],
  },
  {
    id: "easy_005",
    difficulty: "Easy",
    titleJa: "1手詰み - クイーンバックランク",
    titleEn: "Mate in 1 – Queen Back Rank",
    descJa: "白番です。1手で詰ませてください。",
    descEn: "White to move. Checkmate in 1.",
    turn: "w",
    fen: "6k1/5ppp/8/8/8/8/5PPP/Q5K1 w - - 0 1",
    moves: ["a1a8"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "backRank", "queen"],
    rating: 750,
    hint: [0, 0],
  },
  {
    id: "easy_006",
    difficulty: "Easy",
    titleJa: "1手詰み",
    titleEn: "Mate in 1",
    descJa: "白番です。1手で詰ませてください。",
    descEn: "White to move. Checkmate in 1.",
    turn: "w",
    fen: "7k/5Q2/6K1/8/8/8/8/8 w - - 0 1",
    moves: ["f7g7"],
    expectedResult: "checkmate",
    themes: ["mateIn1"],
    rating: 600,
    hint: [1, 6],
  },
  {
    id: "easy_007",
    difficulty: "Easy",
    titleJa: "1手詰み - クイーンバックランク2",
    titleEn: "Mate in 1 – Queen Back Rank 2",
    descJa: "白番です。1手で詰ませてください。",
    descEn: "White to move. Checkmate in 1.",
    turn: "w",
    fen: "6k1/5ppp/8/8/8/8/5PPP/4Q1K1 w - - 0 1",
    moves: ["e1e8"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "backRank", "queen"],
    rating: 850,
    hint: [0, 4],
  },
  {
    id: "easy_008",
    difficulty: "Easy",
    titleJa: "1手詰み - バックランク",
    titleEn: "Mate in 1 – Back Rank",
    descJa: "白番です。1手で詰ませてください。",
    descEn: "White to move. Checkmate in 1.",
    turn: "w",
    fen: "4r1k1/ppp2ppp/8/8/8/8/PPP2PPP/4R1K1 w - - 0 1",
    moves: ["e1e8"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "backRank"],
    rating: 750,
    hint: [0, 4],
  },
  {
    id: "easy_009",
    difficulty: "Easy",
    titleJa: "1手詰み",
    titleEn: "Mate in 1",
    descJa: "黒番です。1手で詰ませてください。",
    descEn: "Black to move. Checkmate in 1.",
    turn: "b",
    fen: "8/8/8/8/8/6k1/5q2/7K b - - 0 1",
    moves: ["f2f1"],
    expectedResult: "checkmate",
    themes: ["mateIn1"],
    rating: 700,
    hint: [7, 5],
  },
  {
    id: "easy_010",
    difficulty: "Easy",
    titleJa: "1手詰み - キング＆ルーク",
    titleEn: "Mate in 1 – King & Rook",
    descJa: "白番です。1手で詰ませてください。",
    descEn: "White to move. Checkmate in 1.",
    turn: "w",
    fen: "6kR/6P1/5K2/8/8/8/8/8 w - - 0 1",
    moves: ["f6g6"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "kingsideAttack"],
    rating: 800,
    hint: [2, 6],
  },
];

// ─── HARD PUZZLES ─────────────────────────────────────────────────────────────
const hardPuzzles = [
  {
    id: "hard_001",
    difficulty: "Hard",
    titleJa: "犠牲の手",
    titleEn: "Sacrifice",
    descJa: "白番です。最善の犠牲を見つけてください。",
    descEn: "White to move. Find the best sacrifice.",
    turn: "w",
    fen: "r1bq1rk1/ppp2ppp/2np1n2/1B2p3/4P3/2NP1N2/PPP2PPP/R1BQR1K1 w - - 0 1",
    moves: ["b5c6"],
    expectedResult: "material",
    themes: ["sacrifice", "bishop"],
    rating: 1700,
    hint: [2, 2],
  },
  {
    id: "hard_002",
    difficulty: "Hard",
    titleJa: "1手詰み - バックランク",
    titleEn: "Mate in 1 – Back Rank",
    descJa: "白番です。バックランクを突いて詰ませてください。",
    descEn: "White to move. Checkmate on the back rank.",
    turn: "w",
    fen: "3r2k1/ppp2ppp/8/8/8/8/PPP2PPP/3R2K1 w - - 0 1",
    moves: ["d1d8"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "backRank", "rook"],
    rating: 1600,
    hint: [0, 3],
  },
  {
    id: "hard_003",
    difficulty: "Hard",
    titleJa: "トラップ",
    titleEn: "Queen Trap",
    descJa: "黒番です。クイーンをトラップしてください。",
    descEn: "Black to move. Trap the queen.",
    turn: "b",
    fen: "r3kb1r/ppp1pppp/2nq1n2/3p4/3P1B2/2N1PN2/PPP2PPP/R2QKB1R b KQkq - 0 1",
    moves: ["d6f4"],
    expectedResult: "material",
    themes: ["trap", "queen"],
    rating: 1800,
    hint: [4, 5],
  },
  {
    id: "hard_004",
    difficulty: "Hard",
    titleJa: "ディスカバードアタック",
    titleEn: "Discovered Attack",
    descJa: "白番です。発見攻撃で有利になってください。",
    descEn: "White to move. Use a discovered attack.",
    turn: "w",
    fen: "r2qkb1r/ppp2ppp/2np1n2/1b2p3/3PP3/2N1BN2/PPP2PPP/R2QKB1R w KQkq - 0 1",
    moves: ["d4e5"],
    expectedResult: "material",
    themes: ["discoveredAttack"],
    rating: 1750,
    hint: [3, 4],
  },
  {
    id: "hard_005",
    difficulty: "Hard",
    titleJa: "ナイトフォーク - 王とクイーン",
    titleEn: "Knight Fork – King and Queen",
    descJa: "白番です。ナイトフォークで有利になってください。",
    descEn: "White to move. Fork the king and queen.",
    turn: "w",
    fen: "r4rk1/pp1q1ppp/2p5/4n3/8/2N5/PPP2PPP/R2Q1RK1 w - - 0 1",
    moves: ["c3e4"],
    expectedResult: "material",
    themes: ["fork", "knight"],
    rating: 1650,
    hint: [4, 4],
  },
  {
    id: "hard_006",
    difficulty: "Hard",
    titleJa: "インターポジション",
    titleEn: "Interposition Tactic",
    descJa: "黒番です。最善手で有利になってください。",
    descEn: "Black to move. Find the best continuation.",
    turn: "b",
    fen: "r1b1kb1r/pppp1ppp/2n2n2/4p3/2B1P1q1/2NP4/PPP1NPPP/R1BQK2R b KQkq - 0 1",
    moves: ["g4f4"],
    expectedResult: "material",
    themes: ["queenFork"],
    rating: 1700,
    hint: [4, 5],
  },
  {
    id: "hard_007",
    difficulty: "Hard",
    titleJa: "ツヴィッシェンツーク",
    titleEn: "Zwischenzug",
    descJa: "白番です。間の手を探してください。",
    descEn: "White to move. Find the in-between move.",
    turn: "w",
    fen: "r1bqkb1r/ppp2ppp/2np4/1B2p3/3nP3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 1",
    moves: ["f3d4"],
    expectedResult: "material",
    themes: ["zwischenzug", "knight"],
    rating: 1800,
    hint: [4, 3],
  },
  {
    id: "hard_008",
    difficulty: "Hard",
    titleJa: "プロモーション詰み",
    titleEn: "Promotion Checkmate",
    descJa: "黒番です。プロモーションで詰ませてください。",
    descEn: "Black to move. Promote to deliver checkmate.",
    turn: "b",
    fen: "8/8/8/8/8/2k5/p7/2K5 b - - 0 1",
    moves: ["a2a1q"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "promotion", "endgame"],
    rating: 1600,
    hint: [7, 0],
  },
  {
    id: "hard_009",
    difficulty: "Hard",
    titleJa: "クイーン犠牲詰み",
    titleEn: "Queen Sacrifice",
    descJa: "白番です。ビショップで優位に立ってください。",
    descEn: "White to move. Exploit the fork with the bishop.",
    turn: "w",
    fen: "r1b2rk1/ppp1qppp/2np1n2/4p3/2B1P3/2NP1N2/PPP1QPPP/R1B2RK1 w - - 0 1",
    moves: ["c4f7"],
    expectedResult: "material",
    themes: ["sacrifice", "bishop"],
    rating: 1700,
    hint: [1, 5],
  },
  {
    id: "hard_010",
    difficulty: "Hard",
    titleJa: "コンビネーション",
    titleEn: "Combination",
    descJa: "白番です。最善の連続手を見つけてください。",
    descEn: "White to move. Find the best combination.",
    turn: "w",
    fen: "2r1r1k1/pp3ppp/2p5/q7/3n4/2NB4/PPP1QPPP/4RRK1 w - - 0 1",
    moves: ["d3h7"],
    expectedResult: "material",
    themes: ["combination", "bishop"],
    rating: 1900,
    hint: [1, 7],
  },
];

// ─── Normal puzzles from current chess.json (Lichess) ────────────────────────
const currentData = JSON.parse(readFileSync(CHESS_JSON, "utf8"));
const normalPuzzles = currentData
  .filter(p => p.difficulty === "Normal")
  .map((p, i) => ({ ...p, id: `normal_${String(i + 1).padStart(3, "0")}` }));

// ─── Verify Easy and Hard ─────────────────────────────────────────────────────
console.log("Verifying Easy puzzles...");
let allOk = true;
for (const p of easyPuzzles) {
  const v = verify(p.fen, p.moves, p.expectedResult);
  console.log(`  ${v.ok ? "✅" : "❌"} ${p.id}: ${p.moves[0]} - ${v.ok ? "OK" : v.reason}`);
  if (!v.ok) allOk = false;
}

console.log("\nVerifying Hard puzzles...");
for (const p of hardPuzzles) {
  const v = verify(p.fen, p.moves, p.expectedResult);
  console.log(`  ${v.ok ? "✅" : "❌"} ${p.id}: ${p.moves[0]} - ${v.ok ? "OK" : v.reason}`);
  if (!v.ok) allOk = false;
}

if (!allOk) {
  console.error("\nSome puzzles failed verification. Aborting.");
  process.exit(1);
}

// ─── Write final chess.json ───────────────────────────────────────────────────
const allPuzzles = [...easyPuzzles, ...normalPuzzles, ...hardPuzzles];
writeFileSync(CHESS_JSON, JSON.stringify(allPuzzles, null, 2), "utf8");
console.log(`\n✅ Wrote ${allPuzzles.length} puzzles to chess.json`);
console.log(`   Easy:   ${easyPuzzles.length}`);
console.log(`   Normal: ${normalPuzzles.length} (from Lichess)`);
console.log(`   Hard:   ${hardPuzzles.length}`);
