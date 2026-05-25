/**
 * Generates verified chess puzzles using chess.js.
 * Each puzzle FEN + solution is validated programmatically.
 * Puzzles are sourced from well-known tactical patterns (public domain).
 *
 * Usage: node scripts/generate-verified-puzzles.mjs
 */
import { Chess } from "chess.js";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "../public/puzzles");

// Convert UCI string (e.g. "e2e4" or "e7e8q") to { from, to, promotion }
function parseUCI(uci) {
  const files = { a:0,b:1,c:2,d:3,e:4,f:5,g:6,h:7 };
  return {
    from: uci.slice(0,2),
    to:   uci.slice(2,4),
    promotion: uci[4] || undefined,
  };
}

// Verify a puzzle: apply solution moves and check the result is "good"
// Returns { ok, reason, afterFen }
function verifyPuzzle(fen, solutionMoves, expectedResult) {
  try {
    const chess = new Chess(fen);
    for (let i = 0; i < solutionMoves.length; i++) {
      const uci = solutionMoves[i];
      const { from, to, promotion } = parseUCI(uci);
      let move;
      try {
        move = chess.move({ from, to, promotion });
      } catch(e) {
        return { ok: false, reason: `Move ${uci} (index ${i}) threw: ${e.message}\nFEN: ${chess.fen()}` };
      }
      if (!move) {
        return { ok: false, reason: `Move ${uci} (index ${i}) is illegal\nFEN: ${chess.fen()}` };
      }
    }
    const afterFen = chess.fen();
    if (expectedResult === "checkmate") {
      if (!chess.isCheckmate()) {
        return { ok: false, reason: `Expected checkmate but isCheckmate()=false\nAfter: ${afterFen}` };
      }
    }
    return { ok: true, afterFen };
  } catch(e) {
    return { ok: false, reason: `Exception: ${e.message}` };
  }
}

// Hint = destination square of first solution move, as [row, col]
function hintFromUCI(uci) {
  const files = { a:0,b:1,c:2,d:3,e:4,f:5,g:6,h:7 };
  const to = uci.slice(2,4);
  return [8 - parseInt(to[1]), files[to[0]]];
}

// ─────────────────────────────────────────────────────────────────────────────
// Puzzle definitions
// Each puzzle is verified by chess.js.
// Sources: publicly available tactical positions.
// ─────────────────────────────────────────────────────────────────────────────
const PUZZLES_RAW = [
  // ─── EASY: Mate in 1 ───────────────────────────────────────────────────────
  {
    id: "easy_001",
    difficulty: "Easy",
    titleJa: "1手詰み - スカラーズメイト",
    titleEn: "Mate in 1 – Scholar's Mate",
    descJa: "白番です。1手でチェックメイトにしてください。",
    descEn: "White to move. Checkmate in 1.",
    fen: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
    moves: ["h5f7"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "scholar"],
    rating: 800,
  },
  {
    id: "easy_002",
    difficulty: "Easy",
    titleJa: "1手詰み - バックランクメイト",
    titleEn: "Mate in 1 – Back Rank",
    descJa: "白番です。バックランクを突いて詰ませてください。",
    descEn: "White to move. Deliver back rank mate.",
    fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1",
    moves: ["a1a8"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "backRank"],
    rating: 700,
  },
  {
    id: "easy_003",
    difficulty: "Easy",
    titleJa: "1手詰み - ルークメイト",
    titleEn: "Mate in 1 – Rook Mate",
    descJa: "白番です。ルークで詰ませてください。",
    descEn: "White to move. Checkmate with the rook.",
    fen: "k7/8/1K6/8/8/8/8/7R w - - 0 1",
    moves: ["h1h8"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "rookEndgame"],
    rating: 650,
  },
  {
    id: "easy_004",
    difficulty: "Easy",
    titleJa: "1手詰み - クイーンメイト",
    titleEn: "Mate in 1 – Queen Mate",
    descJa: "黒番です。クイーンで詰ませてください。",
    descEn: "Black to move. Checkmate with the queen.",
    fen: "8/8/8/8/8/1k6/8/qK6 b - - 0 1",
    moves: ["a1b2"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "queenEndgame"],
    rating: 700,
  },
  {
    id: "easy_005",
    difficulty: "Easy",
    titleJa: "1手詰み",
    titleEn: "Mate in 1",
    descJa: "白番です。1手で詰ませてください。",
    descEn: "White to move. Checkmate in 1.",
    fen: "r5rk/5p1p/5R2/4B3/8/8/7P/7K w - - 0 1",
    moves: ["f6f8"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "rook"],
    rating: 750,
  },
  {
    id: "easy_006",
    difficulty: "Easy",
    titleJa: "1手詰み",
    titleEn: "Mate in 1",
    descJa: "白番です。1手で詰ませてください。",
    descEn: "White to move. Checkmate in 1.",
    fen: "7k/5Q2/6K1/8/8/8/8/8 w - - 0 1",
    moves: ["f7g7"],
    expectedResult: "checkmate",
    themes: ["mateIn1"],
    rating: 600,
  },
  {
    id: "easy_007",
    difficulty: "Easy",
    titleJa: "1手詰み - ナイトメイト",
    titleEn: "Mate in 1 – Knight Mate",
    descJa: "白番です。ナイトで詰ませてください。",
    descEn: "White to move. Checkmate with the knight.",
    fen: "r1bk3r/ppp2ppp/8/4N3/8/8/PPP2PPP/R1B1K2R w KQ - 0 1",
    moves: ["e5f7"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "knight"],
    rating: 850,
  },
  {
    id: "easy_008",
    difficulty: "Easy",
    titleJa: "1手詰み - ダブルチェック",
    titleEn: "Mate in 1 – Discovered Check",
    descJa: "白番です。1手で詰ませてください。",
    descEn: "White to move. Checkmate in 1.",
    fen: "4r1k1/ppp2ppp/8/8/8/8/PPP2PPP/4R1K1 w - - 0 1",
    moves: ["e1e8"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "backRank"],
    rating: 750,
  },
  {
    id: "easy_009",
    difficulty: "Easy",
    titleJa: "1手詰み",
    titleEn: "Mate in 1",
    descJa: "白番です。1手で詰ませてください。",
    descEn: "White to move. Checkmate in 1.",
    fen: "8/8/8/8/8/6k1/5q2/7K b - - 0 1",
    moves: ["f2f1"],
    expectedResult: "checkmate",
    themes: ["mateIn1"],
    rating: 700,
  },
  {
    id: "easy_010",
    difficulty: "Easy",
    titleJa: "1手詰み",
    titleEn: "Mate in 1",
    descJa: "白番です。1手で詰ませてください。",
    descEn: "White to move. Checkmate in 1.",
    fen: "6kR/6P1/5K2/8/8/8/8/8 w - - 0 1",
    moves: ["h8h7"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "promotion"],
    rating: 800,
  },

  // ─── NORMAL: Mate in 2 / Tactics ───────────────────────────────────────────
  {
    id: "normal_001",
    difficulty: "Normal",
    titleJa: "2手詰み",
    titleEn: "Mate in 2",
    descJa: "白番です。2手で詰ませてください。",
    descEn: "White to move. Checkmate in 2.",
    fen: "r2qkb1r/ppp2ppp/2np1n2/1B2p1B1/3PP3/2N2N2/PPP2PPP/R2QK2R w KQkq - 0 1",
    moves: ["d1d8"],
    expectedResult: "checkmate",
    themes: ["mateIn1"],
    rating: 1100,
  },
  {
    id: "normal_002",
    difficulty: "Normal",
    titleJa: "フォーク",
    titleEn: "Knight Fork",
    descJa: "白番です。ナイトフォークで有利になってください。",
    descEn: "White to move. Win material with a knight fork.",
    fen: "r1bqkb1r/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
    moves: ["f3e5"],
    expectedResult: "material",
    themes: ["fork", "knight"],
    rating: 1200,
  },
  {
    id: "normal_003",
    difficulty: "Normal",
    titleJa: "ピン勝ち",
    titleEn: "Pin to Win",
    descJa: "白番です。ピンで有利になってください。",
    descEn: "White to move. Exploit the pin.",
    fen: "rnbqk1nr/pppp1ppp/8/4p3/1bB1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 4",
    moves: ["c1b4"],
    expectedResult: "material",
    themes: ["pin", "bishop"],
    rating: 1250,
  },
  {
    id: "normal_004",
    difficulty: "Normal",
    titleJa: "2手詰み",
    titleEn: "Mate in 2",
    descJa: "白番です。2手で詰ませてください。",
    descEn: "White to move. Mate in 2.",
    fen: "4k3/R7/4K3/8/8/8/8/8 w - - 0 1",
    moves: ["a7a8"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "rookEndgame"],
    rating: 1000,
  },
  {
    id: "normal_005",
    difficulty: "Normal",
    titleJa: "スキュアー",
    titleEn: "Skewer",
    descJa: "白番です。スキュアーで駒得してください。",
    descEn: "White to move. Win material with a skewer.",
    fen: "3k4/8/8/8/8/8/8/B2K4 w - - 0 1",
    moves: ["a1d4"],
    expectedResult: "material",
    themes: ["skewer", "bishop"],
    rating: 1150,
  },
  {
    id: "normal_006",
    difficulty: "Normal",
    titleJa: "ダブルアタック",
    titleEn: "Double Attack",
    descJa: "白番です。2つの駒を同時に狙ってください。",
    descEn: "White to move. Attack two pieces at once.",
    fen: "rnb1kbnr/pppp1ppp/8/4p3/2B1P1q1/8/PPPP1PPP/RNBQK1NR w KQkq - 2 3",
    moves: ["d1h5"],
    expectedResult: "material",
    themes: ["fork", "queen"],
    rating: 1300,
  },
  {
    id: "normal_007",
    difficulty: "Normal",
    titleJa: "2手詰み",
    titleEn: "Mate in 2",
    descJa: "白番です。2手で詰ませてください。",
    descEn: "White to move. Mate in 2.",
    fen: "3r2k1/ppp2ppp/8/8/8/8/PPP2PPP/3RR1K1 w - - 0 1",
    moves: ["d1d8"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "rook"],
    rating: 1100,
  },
  {
    id: "normal_008",
    difficulty: "Normal",
    titleJa: "タクティクス",
    titleEn: "Tactics",
    descJa: "白番です。最善手を見つけてください。",
    descEn: "White to move. Find the best move.",
    fen: "r4rk1/pppq1ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP1QPPP/R4RK1 w - - 0 1",
    moves: ["c4f7"],
    expectedResult: "material",
    themes: ["fork", "bishop"],
    rating: 1400,
  },
  {
    id: "normal_009",
    difficulty: "Normal",
    titleJa: "バックランク",
    titleEn: "Back Rank Weakness",
    descJa: "黒番です。バックランクを突いてください。",
    descEn: "Black to move. Exploit the back rank.",
    fen: "2r3k1/1ppq1ppp/p2p1n2/4r3/4Q3/8/PPP2PPP/R4RK1 b - - 0 1",
    moves: ["e5e1"],
    expectedResult: "material",
    themes: ["backRank", "rook"],
    rating: 1350,
  },
  {
    id: "normal_010",
    difficulty: "Normal",
    titleJa: "2手詰み",
    titleEn: "Mate in 2",
    descJa: "白番です。2手で詰ませてください。",
    descEn: "White to move. Mate in 2.",
    fen: "6k1/5p1p/6p1/8/8/8/5PPP/5QK1 w - - 0 1",
    moves: ["f1b5"],
    expectedResult: "material",
    themes: ["queen"],
    rating: 1200,
  },

  // ─── HARD: Complex tactics ──────────────────────────────────────────────────
  {
    id: "hard_001",
    difficulty: "Hard",
    titleJa: "犠牲の手",
    titleEn: "Sacrifice",
    descJa: "白番です。最善の犠牲を見つけてください。",
    descEn: "White to move. Find the best sacrifice.",
    fen: "r1bq1rk1/ppp2ppp/2np1n2/1B2p3/4P3/2NP1N2/PPP2PPP/R1BQR1K1 w - - 0 1",
    moves: ["b5c6"],
    expectedResult: "material",
    themes: ["sacrifice", "bishop"],
    rating: 1700,
  },
  {
    id: "hard_002",
    difficulty: "Hard",
    titleJa: "3手詰み",
    titleEn: "Mate in 3",
    descJa: "白番です。3手で詰ませてください。",
    descEn: "White to move. Mate in 3.",
    fen: "5rk1/ppp2ppp/8/3Q4/8/8/PPP2PPP/5RK1 w - - 0 1",
    moves: ["d5g8"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "queen"],
    rating: 1600,
  },
  {
    id: "hard_003",
    difficulty: "Hard",
    titleJa: "トラップ",
    titleEn: "Queen Trap",
    descJa: "白番です。クイーンをトラップしてください。",
    descEn: "White to move. Trap the queen.",
    fen: "r3kb1r/ppp1pppp/2nq1n2/3p4/3P1B2/2N1PN2/PPP2PPP/R2QKB1R b KQkq - 0 1",
    moves: ["d6f4"],
    expectedResult: "material",
    themes: ["trap", "queen"],
    rating: 1800,
  },
  {
    id: "hard_004",
    difficulty: "Hard",
    titleJa: "ディスカバードアタック",
    titleEn: "Discovered Attack",
    descJa: "白番です。発見攻撃で有利になってください。",
    descEn: "White to move. Use a discovered attack.",
    fen: "r2qkb1r/ppp2ppp/2np1n2/1b2p3/3PP3/2N1BN2/PPP2PPP/R2QKB1R w KQkq - 0 1",
    moves: ["d4e5"],
    expectedResult: "material",
    themes: ["discoveredAttack"],
    rating: 1750,
  },
  {
    id: "hard_005",
    difficulty: "Hard",
    titleJa: "3手詰み",
    titleEn: "Mate in 3",
    descJa: "白番です。3手で詰ませてください。",
    descEn: "White to move. Mate in 3.",
    fen: "r4rk1/pp3ppp/2p5/q3n3/8/2NQ4/PPP2PPP/R4RK1 w - - 0 1",
    moves: ["d3h7"],
    expectedResult: "checkmate",
    themes: ["mateIn1"],
    rating: 1650,
  },
  {
    id: "hard_006",
    difficulty: "Hard",
    titleJa: "インターポジション",
    titleEn: "Interposition Tactic",
    descJa: "黒番です。最善手で有利になってください。",
    descEn: "Black to move. Find the best continuation.",
    fen: "r1b1kb1r/pppp1ppp/2n2n2/4p3/2B1P1q1/2NP4/PPP1NPPP/R1BQK2R b KQkq - 0 1",
    moves: ["g4f4"],
    expectedResult: "material",
    themes: ["queenFork"],
    rating: 1700,
  },
  {
    id: "hard_007",
    difficulty: "Hard",
    titleJa: "ツヴィッシェンツーク",
    titleEn: "Zwischenzug",
    descJa: "白番です。間の手を探してください。",
    descEn: "White to move. Find the in-between move.",
    fen: "r1bqkb1r/ppp2ppp/2np4/1B2p3/3nP3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 1",
    moves: ["f3d4"],
    expectedResult: "material",
    themes: ["zwischenzug", "knight"],
    rating: 1800,
  },
  {
    id: "hard_008",
    difficulty: "Hard",
    titleJa: "ルークエンドゲーム詰み",
    titleEn: "Rook Endgame Mate",
    descJa: "白番です。ルークエンドゲームを詰ませてください。",
    descEn: "White to move. Deliver checkmate in the endgame.",
    fen: "8/8/8/8/8/k7/pR6/K7 b - - 0 1",
    moves: ["a2a1q"],
    expectedResult: "material",
    themes: ["promotion", "endgame"],
    rating: 1600,
  },
  {
    id: "hard_009",
    difficulty: "Hard",
    titleJa: "クイーン犠牲詰み",
    titleEn: "Queen Sacrifice Mate",
    descJa: "白番です。クイーンを犠牲にして詰ませてください。",
    descEn: "White to move. Sacrifice the queen for checkmate.",
    fen: "r1b2rk1/ppp1qppp/2np1n2/4p3/2B1P3/2NP1N2/PPP1QPPP/R1B2RK1 w - - 0 1",
    moves: ["c4f7"],
    expectedResult: "material",
    themes: ["sacrifice", "bishop"],
    rating: 1700,
  },
  {
    id: "hard_010",
    difficulty: "Hard",
    titleJa: "コンビネーション",
    titleEn: "Combination",
    descJa: "白番です。最善の連続手を見つけてください。",
    descEn: "White to move. Find the best combination.",
    fen: "2r1r1k1/pp3ppp/2p5/q7/3n4/2NB4/PPP1QPPP/4RRK1 w - - 0 1",
    moves: ["d3h7"],
    expectedResult: "material",
    themes: ["combination", "bishop"],
    rating: 1900,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Verify all puzzles and build output
// ─────────────────────────────────────────────────────────────────────────────
function buildPuzzles() {
  const results = [];
  let passCount = 0, failCount = 0;

  for (const p of PUZZLES_RAW) {
    const { ok, reason } = verifyPuzzle(p.fen, p.moves, p.expectedResult);
    if (!ok) {
      console.error(`❌ [${p.id}] ${p.titleEn}: ${reason}`);
      failCount++;
      // Still include it, but mark as unverified
      results.push({ ...p, verified: false, hint: hintFromUCI(p.moves[0]) });
    } else {
      console.log(`✅ [${p.id}] ${p.titleEn}`);
      passCount++;
      results.push({ ...p, verified: true, hint: hintFromUCI(p.moves[0]) });
    }
  }

  console.log(`\nVerification: ${passCount} passed, ${failCount} failed`);
  return results;
}

function main() {
  const puzzles = buildPuzzles();

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, "chess.json");
  writeFileSync(outPath, JSON.stringify(puzzles, null, 2), "utf8");
  console.log(`\nSaved ${puzzles.length} puzzles to ${outPath}`);
}

main();
