import { useEffect, useRef } from "react";
import {
  CHESS_URL, SHOGI_URL,
  chessHistToUCI, shogiHistToUSI,
  normalizeEval, EngineWorker,
  FB_PATH, fbLoad, fbSave, fbCopyToUser, fbIsDeleted,
} from "./analysisEngine.js";

// localStorage key for manually-deleted analysis IDs (per user: "playerName/gameId")
export const DELETED_ANALYSES_KEY = 'deleted_analyses';

export function getDeletedAnalyses() {
  try { return new Set(JSON.parse(localStorage.getItem(DELETED_ANALYSES_KEY)) || []); } catch { return new Set(); }
}
export function addDeletedAnalysis(playerName, gameId) {
  try {
    const set = getDeletedAnalyses();
    set.add(`${playerName}/${gameId}`);
    localStorage.setItem(DELETED_ANALYSES_KEY, JSON.stringify([...set]));
  } catch {}
}

/**
 * 終局したゲームを UI なしでバックグラウンド解析し Firebase に保存する。
 * Firebase にキャッシュが既にあれば何もしない。
 * レンダリングは null（画面に何も出さない）。
 * onComplete(gameId, gameType) は解析保存完了時に呼ばれる。
 *
 * deletedGameIds: Set<gameId> — App.jsx が Firebase deletedAnalyses から購読する削除済みゲームID集合。
 * このセットに含まれるゲームは解析をスキップする。
 */
export default function AutoAnalyzer({ game, gameType, playerName, onComplete, onProgress, onFailed, deletedGameIds }) {
  const abortRef = useRef(false);
  const workerRef = useRef(null);

  useEffect(() => {
    const history = game.history || [];
    if (!history.length || !playerName) return;

    // Skip games the user has manually deleted — check prop (Firebase-backed) first, then localStorage fallback
    const isDeletedLocally = getDeletedAnalyses().has(`${playerName}/${game.id}`);
    const isDeletedRemotely = deletedGameIds instanceof Set && deletedGameIds.has(game.id);
    if (isDeletedLocally || isDeletedRemotely) {
      console.log(`[AutoAnalyzer] skipping deleted analysis ${game.id}`);
      return;
    }

    const isChess = gameType === "chess";
    abortRef.current = false;

    console.log(`[AutoAnalyzer] start ${gameType} ${game.id} (${history.length} moves)`);

    (async () => {
      // Firebase 側の削除フラグを再確認（deletedGameIds が未ロード状態の場合のフォールバック）
      if (!(deletedGameIds instanceof Set) || !deletedGameIds.has(game.id)) {
        const fbDeleted = await fbIsDeleted(playerName, game.id);
        if (fbDeleted) {
          console.log(`[AutoAnalyzer] Firebase deleted flag found for ${game.id}, skipping`);
          return;
        }
      }
      if (abortRef.current) return;

      // 既に解析済みか確認
      const cached = await fbLoad(playerName, game.id, history.length);
      if (cached) {
        const ownPath = FB_PATH(playerName, game.id);
        if (cached.path === ownPath) {
          // 自分の解析が既に保存済み — 新規通知不要
          console.log(`[AutoAnalyzer] already cached ${game.id}`);
          onComplete?.(game.id, gameType, false);
        } else {
          // 他ユーザーの解析を自分のパスにコピー — 新規通知不要
          console.log(`[AutoAnalyzer] copying from ${cached.path} to ${ownPath}`);
          const copied = await fbCopyToUser(playerName, game.id, cached.data);
          if (copied) onComplete?.(game.id, gameType, false);
        }
        return;
      }
      if (abortRef.current) return;

      const uciMoves = isChess ? chessHistToUCI(history) : shogiHistToUSI(history);
      const depth = isChess ? 15 : 12;
      const worker = new EngineWorker(
        isChess ? CHESS_URL : SHOGI_URL,
        isChess ? "uci" : "usi"
      );
      workerRef.current = worker;

      try {
        await worker.init();
        const evR = [], bmR = [];

        for (let i = 0; i <= history.length; i++) {
          if (abortRef.current) break;
          const { score, bestMove } = await worker.analyze(uciMoves.slice(0, i), depth);
          evR.push(normalizeEval(score, i));
          bmR.push(bestMove);
          onProgress?.(game.id, Math.round((i / history.length) * 100));
        }

        if (!abortRef.current && evR.length === history.length + 1) {
          await fbSave(playerName, game.id, gameType, game, uciMoves, evR, bmR);
          console.log(`[AutoAnalyzer] saved ${game.id}`);
          onComplete?.(game.id, gameType, true); // isNew=true → バッジ通知
        }
      } catch (e) {
        console.error(`[AutoAnalyzer] error [${gameType} ${game.id}]:`, e);
        onFailed?.(game.id);
      } finally {
        worker.terminate();
        workerRef.current = null;
      }
    })();

    return () => {
      abortRef.current = true;
      if (workerRef.current) { workerRef.current.terminate(); workerRef.current = null; }
    };
    // game.id と history.length が変わったときだけ再実行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, (game.history || []).length, playerName]);

  return null;
}
