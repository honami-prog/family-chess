/**
 * Fetches real puzzles from Lichess API and saves them to public/puzzles/chess.json
 * Usage: node scripts/fetch-puzzles.mjs
 */
import { Chess } from "chess.js";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "../public/puzzles");

// Fetch one puzzle from Lichess
async function fetchPuzzle() {
  const resp = await fetch("https://lichess.org/api/puzzle/next", {
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// Given PGN moves string + initialPly, return FEN at that ply
function fenAtPly(pgnMoves, ply) {
  const chess = new Chess();
  const tokens = pgnMoves.trim().split(/\s+/);
  // tokens may include move numbers like "1." – filter them out
  const moves = tokens.filter(t => !/^\d+\./.test(t));
  for (let i = 0; i < ply && i < moves.length; i++) {
    try {
      chess.move(moves[i], { strict: false });
    } catch {
      // try sloppy
      const result = chess.move(moves[i]);
      if (!result) break;
    }
  }
  return chess.fen();
}

// Classify difficulty by rating
function classifyRating(r) {
  if (r < 1200) return "Easy";
  if (r < 1600) return "Normal";
  return "Hard";
}

// Fetch until we have target counts per difficulty
async function collectPuzzles(targetPerDiff = 10) {
  const buckets = { Easy: [], Normal: [], Hard: [] };
  const needed = () => Object.values(buckets).some(b => b.length < targetPerDiff);
  let attempts = 0;

  while (needed() && attempts < 200) {
    attempts++;
    try {
      const data = await fetchPuzzle();
      const p = data.puzzle;
      const diff = classifyRating(p.rating);
      if (buckets[diff].length >= targetPerDiff) continue;

      // Reconstruct FEN at initialPly
      const fen = fenAtPly(data.game.pgn, p.initialPly);
      const chess = new Chess(fen);
      const turn = chess.turn(); // 'w' or 'b'

      buckets[diff].push({
        id: `lichess_${p.id}`,
        difficulty: diff,
        titleJa: diff === "Easy" ? "タクティクス" : diff === "Normal" ? "中級タクティクス" : "上級タクティクス",
        titleEn: diff === "Easy" ? "Tactics" : diff === "Normal" ? "Intermediate Tactics" : "Advanced Tactics",
        descJa: turn === "w" ? "白番です。最善手を見つけてください。" : "黒番です。最善手を見つけてください。",
        descEn: turn === "w" ? "White to move. Find the best move." : "Black to move. Find the best move.",
        turn,
        fen,
        moves: p.solution, // UCI format e.g. ["e2e4", "d7d5"]
        rating: p.rating,
        themes: p.themes,
        // hint: destination square of first move
        hint: uciToCoords(p.solution[0])?.to ?? null,
      });

      const counts = Object.entries(buckets).map(([k,v]) => `${k}:${v.length}`).join(", ");
      console.log(`[${attempts}] ${diff} ${p.id} (${p.rating}) → ${counts}`);

      // Be polite to the API
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.warn(`Attempt ${attempts} failed:`, e.message);
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return buckets;
}

function uciToCoords(uci) {
  if (!uci || uci.length < 4) return null;
  const fileMap = { a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7 };
  const fromCol = fileMap[uci[0]];
  const fromRow = 8 - parseInt(uci[1]);
  const toCol   = fileMap[uci[2]];
  const toRow   = 8 - parseInt(uci[3]);
  return {
    from: [fromRow, fromCol],
    to:   [toRow,   toCol],
  };
}

async function main() {
  console.log("Fetching Lichess puzzles...");
  const buckets = await collectPuzzles(10);

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  // Combine all into one file (sorted by difficulty then rating)
  const all = [
    ...buckets.Easy,
    ...buckets.Normal,
    ...buckets.Hard,
  ];

  const outPath = join(OUT_DIR, "chess.json");
  writeFileSync(outPath, JSON.stringify(all, null, 2), "utf8");
  console.log(`\nSaved ${all.length} puzzles to ${outPath}`);
  console.log(`  Easy:   ${buckets.Easy.length}`);
  console.log(`  Normal: ${buckets.Normal.length}`);
  console.log(`  Hard:   ${buckets.Hard.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
