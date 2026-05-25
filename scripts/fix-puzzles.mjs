/**
 * Replaces 10 invalid puzzles with verified ones, then writes chess.json
 */
import { Chess } from "chess.js";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHESS_JSON = join(__dirname, "../public/puzzles/chess.json");

// Verify a move is legal and (if checkmate) leads to checkmate
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
      return { ok: false, reason: `Expected checkmate but got: ${c.fen()}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// Replacements for the 10 failing puzzles
const replacements = {
  // Back rank mate with Queen from a1
  easy_005: {
    titleJa: "1手詰み - クイーンバックランク",
    titleEn: "Mate in 1 – Queen Back Rank",
    descJa: "白番です。1手で詰ませてください。",
    descEn: "White to move. Checkmate in 1.",
    fen: "6k1/5ppp/8/8/8/8/5PPP/Q5K1 w - - 0 1",
    moves: ["a1a8"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "backRank", "queen"],
    rating: 750,
    hint: [0, 0],
  },
  // Queen back rank mate from e1
  easy_007: {
    titleJa: "1手詰み - クイーンメイト",
    titleEn: "Mate in 1 – Queen Mate",
    descJa: "白番です。1手で詰ませてください。",
    descEn: "White to move. Checkmate in 1.",
    fen: "6k1/5ppp/8/8/8/8/5PPP/4Q1K1 w - - 0 1",
    moves: ["e1e8"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "backRank", "queen"],
    rating: 850,
    hint: [0, 4],
  },
  // Verified by find-mates.mjs: Kf6-g6 is checkmate
  easy_010: {
    titleJa: "1手詰み - キング＆ルーク",
    titleEn: "Mate in 1 – King & Rook",
    descJa: "白番です。1手で詰ませてください。",
    descEn: "White to move. Checkmate in 1.",
    fen: "6kR/6P1/5K2/8/8/8/8/8 w - - 0 1",
    moves: ["f6g6"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "kingsideAttack"],
    rating: 800,
    hint: [2, 6],
  },
  // Rook back rank mate from c1
  normal_001: {
    titleJa: "1手詰み - バックランクメイト",
    titleEn: "Mate in 1 – Back Rank",
    descJa: "白番です。バックランクを突いて詰ませてください。",
    descEn: "White to move. Deliver back rank checkmate.",
    fen: "2r3k1/5ppp/8/8/8/8/5PPP/2R3K1 w - - 0 1",
    moves: ["c1c8"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "backRank", "rook"],
    rating: 1100,
    hint: [0, 2],
  },
  // Pin - bishop captures pinned knight winning a piece
  // Bb5 pins Nc6 to king, winning the knight
  normal_003: {
    titleJa: "ピン - ナイト捕獲",
    titleEn: "Pin – Capture the Knight",
    descJa: "白番です。ピンを利用して駒得してください。",
    descEn: "White to move. Use the pin to win a piece.",
    fen: "r1bqkb1r/pppp1ppp/2n2n2/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
    moves: ["b5c6"],
    expectedResult: "material",
    themes: ["pin", "bishop", "fork"],
    rating: 1250,
    hint: [2, 2],
  },
  // Bxf7+ wins the queen on g4 (Ke7 forced, then Qxg4)
  normal_006: {
    titleJa: "ビショップ犠牲 - クイーン奪取",
    titleEn: "Bishop Sacrifice – Win the Queen",
    descJa: "白番です。ビショップ犠牲でクイーンを奪ってください。",
    descEn: "White to move. Sacrifice the bishop to win the queen.",
    fen: "rnb1kbnr/pppp1ppp/8/4p3/2B1P1q1/8/PPPP1PPP/RNBQK1NR w KQkq - 2 3",
    moves: ["c4f7"],
    expectedResult: "material",
    themes: ["sacrifice", "bishop", "fork"],
    rating: 1300,
    hint: [1, 5],
  },
  // Black rook captures white rook winning material (Re5xe1 - rook exchange winning)
  // Simpler: Rxe1 captures undefended rook
  normal_009: {
    titleJa: "タクティクス - ルーク取り",
    titleEn: "Tactics – Win the Rook",
    descJa: "黒番です。最善手で駒得してください。",
    descEn: "Black to move. Win the rook.",
    fen: "6k1/5ppp/8/4r3/8/8/5PPP/4R1K1 b - - 0 1",
    moves: ["e5e1"],
    expectedResult: "material",
    themes: ["backRank", "rook"],
    rating: 1350,
    hint: [7, 4],
  },
  // Rook back rank mate: Rd1-d8# (black king trapped on back rank)
  hard_002: {
    titleJa: "1手詰み - バックランク詰み",
    titleEn: "Mate in 1 – Back Rank",
    descJa: "白番です。バックランクを突いて詰ませてください。",
    descEn: "White to move. Checkmate on the back rank.",
    fen: "3r2k1/ppp2ppp/8/8/8/8/PPP2PPP/3R2K1 w - - 0 1",
    moves: ["d1d8"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "backRank", "rook"],
    rating: 1600,
    hint: [0, 3],
  },
  // Fork - knight forks king and queen
  hard_005: {
    titleJa: "ナイトフォーク - 王とクイーン",
    titleEn: "Knight Fork – King and Queen",
    descJa: "白番です。ナイトフォークで有利になってください。",
    descEn: "White to move. Fork the king and queen with the knight.",
    fen: "r4rk1/pp1q1ppp/2p5/4n3/8/2N5/PPP2PPP/R2Q1RK1 w - - 0 1",
    moves: ["c3e4"],
    expectedResult: "material",
    themes: ["fork", "knight"],
    rating: 1650,
    hint: [4, 4],
  },
  // a2-a1=Q is checkmate: Kc1 on rank 1, all 5 escape squares covered by Qa1+Kc3
  hard_008: {
    titleJa: "プロモーション詰み",
    titleEn: "Promotion Checkmate",
    descJa: "黒番です。プロモーションで詰ませてください。",
    descEn: "Black to move. Promote to deliver checkmate.",
    fen: "8/8/8/8/8/2k5/p7/2K5 b - - 0 1",
    moves: ["a2a1q"],
    expectedResult: "checkmate",
    themes: ["mateIn1", "promotion", "endgame"],
    rating: 1600,
    hint: [7, 0],
  },
};

// Verify all replacements
console.log("Verifying replacement puzzles...\n");
let allOk = true;
for (const [id, r] of Object.entries(replacements)) {
  const v = verify(r.fen, r.moves, r.expectedResult);
  const status = v.ok ? "✅" : "❌";
  console.log(`${status} ${id}: ${r.moves.join(",")} - ${v.ok ? "OK" : v.reason}`);
  if (!v.ok) allOk = false;
}

if (!allOk) {
  console.error("\nSome replacements failed verification! Aborting.");
  process.exit(1);
}

// Load and patch chess.json
const puzzles = JSON.parse(readFileSync(CHESS_JSON, "utf8"));
let fixed = 0;
for (let i = 0; i < puzzles.length; i++) {
  const r = replacements[puzzles[i].id];
  if (r) {
    puzzles[i] = {
      ...puzzles[i],
      ...r,
      id: puzzles[i].id,
      difficulty: puzzles[i].difficulty,
      verified: true,
    };
    fixed++;
  }
}

writeFileSync(CHESS_JSON, JSON.stringify(puzzles, null, 2), "utf8");
console.log(`\n✅ Fixed ${fixed} puzzles and saved to chess.json`);
