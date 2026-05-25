import { useState, useEffect } from "react";
import { db } from "./firebase.js";
import { ref, get, set, remove } from "firebase/database";
import { FB_PATH } from "./analysisEngine.js";
import { addDeletedAnalysis } from "./AutoAnalyzer.jsx";
import shogiOuImg from "./assets/shogi/ou.png";

const serif = "'Cormorant Garamond','Zen Old Mincho',Georgia,serif";
const MAX_LOCKED = 9;

/* ── カラーパレット ── */
const C = {
  pageBg:      "#faf5e8",
  surface:     "#fffcf5",
  surfaceLock: "#fff8e8",
  header:      "linear-gradient(160deg,#4c2e0c,#7a5020)",
  border:      "#d4bc88",
  borderGold:  "#c4a058",
  borderLock:  "#b08830",
  text:        "#2a1a08",
  textMid:     "#7c6040",
  textMuted:   "#a89070",
  gold:        "#b08830",
  accRow:      "rgba(180,140,80,0.08)",
  btnLock:     "rgba(192,160,48,0.18)",
  btnDel:      "rgba(192,48,32,0.10)",
  btnDelText:  "#c03020",
  errorBg:     "rgba(192,120,30,0.15)",
  errorBorder: "rgba(192,120,30,0.4)",
  errorText:   "#8c5a10",
};

const fmtDateTime = (iso) => {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const mo = d.getMonth() + 1;
    const da = d.getDate();
    const hh = d.getHours().toString().padStart(2, "0");
    const mm = d.getMinutes().toString().padStart(2, "0");
    return `${mo}/${da} ${hh}:${mm}`;
  } catch { return ""; }
};

/* ゲームアイコン：チェス=黒キング駒、将棋=王将駒 */
const GameBadge = ({ isChess, size = 52 }) => {
  const src = isChess ? "/pieces/bK.webp" : shogiOuImg;
  const bg  = isChess
    ? "linear-gradient(135deg,#e8e0d4,#d4c8b8)"
    : "linear-gradient(135deg,#e8d8b8,#d4c090)";
  return (
    <div style={{
      width: size, height: size, flexShrink: 0,
      borderRadius: "50%",
      background: bg,
      border: `1.5px solid ${C.borderGold}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      overflow: "hidden",
      boxShadow: "0 2px 6px rgba(42,26,8,0.18)",
    }}>
      <img src={src} alt="" style={{
        width: isChess ? "78%" : "82%",
        height: isChess ? "78%" : "82%",
        objectFit: "contain",
        display: "block",
      }} />
    </div>
  );
};

export default function AnalysisList({ playerName, playerLang, onClose, onOpenAnalysis, finishedGames, progressMap, pcLayout, failedGameIds, refreshKey }) {
  const t = (ja, en) => playerLang === "en" ? en : ja;
  const [analyses, setAnalyses] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [locking, setLocking] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [lockError, setLockError] = useState(false);

  useEffect(() => {
    if (!playerName) { setAnalyses([]); return; }
    setAnalyses(null);
    get(ref(db, `analyses/${playerName}`))
      .then(snap => {
        const val = snap.val() || {};
        const arr = Object.entries(val)
          .map(([gameId, data]) => ({ ...data, gameId }))
          .filter(item => {
            const p = item.players || {};
            return p.white === playerName || p.black === playerName;
          })
          .sort((a, b) => ((b.createdAt || "") < (a.createdAt || "") ? -1 : 1));
        setAnalyses(arr);
      })
      .catch(() => setAnalyses([]));
  }, [playerName, refreshKey]);

  /* 解析済みではない終局ゲーム → 「解析中...」or「解析失敗」プレースホルダー */
  const pendingGames = analyses
    ? (finishedGames || []).filter(fg => {
        const fgLen = (fg.history || []).length;
        return !analyses.some(a =>
          a.gameId === fg.id && a.historyLength === fgLen
        );
      })
    : [];

  const lockedCount = analyses ? analyses.filter(a => a.locked).length : 0;

  const handleToggleLock = async (gameId, currentLocked) => {
    if (!currentLocked && lockedCount >= MAX_LOCKED) {
      setLockError(true);
      setTimeout(() => setLockError(false), 2500);
      return;
    }
    setLocking(gameId);
    try {
      await set(ref(db, `${FB_PATH(playerName, gameId)}/locked`), !currentLocked);
      setAnalyses(prev => prev.map(a =>
        a.gameId === gameId ? { ...a, locked: !currentLocked } : a
      ));
    } catch (e) { console.warn("lock toggle failed:", e); }
    setLocking(null);
  };

  const handleDelete = async (gameId) => {
    setDeleting(gameId);
    setConfirmDelete(null);
    try {
      await remove(ref(db, `analyses/${playerName}/${gameId}`));
      // Record in localStorage so AutoAnalyzer won't re-trigger for this game
      addDeletedAnalysis(playerName, gameId);
      setAnalyses(prev => prev.filter(a => a.gameId !== gameId));
    } catch (e) { console.warn("delete failed:", e); }
    setDeleting(null);
  };

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0,
      bottom: pcLayout ? 0 : "calc(56px + env(safe-area-inset-bottom, 0px))",
      background: C.pageBg, zIndex: 3500,
      display: "flex", flexDirection: "column", fontFamily: serif,
    }}>

      {/* ── Header ── */}
      <div style={{
        flexShrink: 0, background: C.header,
        borderBottom: `2px solid ${C.borderGold}`,
        padding: "12px 16px",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 26 }}>📊</span>
          <div>
            <div style={{ color: "#fffcf5", fontWeight: 600,
                          fontSize: "clamp(20px,3vw,24px)", letterSpacing: "0.06em" }}>
              {t("解析一覧", "Analysis History")}
            </div>
            <div style={{ color: "#d4bc88", fontSize: 20 }}>
              {analyses ? analyses.length + pendingGames.length : "…"}/10
              {lockedCount > 0 && (
                <span style={{ color: "#f0d080", marginLeft: 8 }}>
                  🔒 {lockedCount}/{MAX_LOCKED}
                </span>
              )}
            </div>
          </div>
        </div>
        {pcLayout && (
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.3)",
            borderRadius: 8, color: "#fffcf5", padding: "6px 16px", cursor: "pointer",
            fontSize: "clamp(20px,3vw,22px)", fontFamily: serif,
          }}>
            ✕ {t("閉じる", "Close")}
          </button>
        )}
      </div>

      {/* ── ロック上限エラー ── */}
      {lockError && (
        <div style={{
          flexShrink: 0, padding: "10px 16px",
          background: C.errorBg, borderBottom: `1px solid ${C.errorBorder}`,
          color: C.errorText, fontSize: 20, textAlign: "left",
        }}>
          🔒 {t(`ロックは最大${MAX_LOCKED}件までです`, `Max ${MAX_LOCKED} locked analyses`)}
        </div>
      )}

      {/* ── Body ── */}
      <div style={{
        flex: 1, overflowY: "auto", padding: "14px",
        display: "flex", flexDirection: "column", gap: 10,
      }}>

        {/* Loading */}
        {analyses === null && (
          <div style={{ color: C.textMid, fontSize: 20, textAlign: "left", marginTop: 40 }}>
            {t("読み込み中…", "Loading…")}
          </div>
        )}

        {/* Empty */}
        {analyses !== null && analyses.length === 0 && pendingGames.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 12, marginTop: 48 }}>
            <span style={{ fontSize: 48 }}>🔍</span>
            <span style={{ color: C.textMid, fontSize: 22 }}>
              {t("解析データがありません", "No analyses yet")}
            </span>
            <span style={{ color: C.textMuted, fontSize: 20 }}>
              {t("全解析が10件を超えると自動削除されます。", "Analyses over 10 are auto-deleted.")}
            </span>
          </div>
        )}

        {/* 解析中 / 解析失敗プレースホルダー */}
        {pendingGames.map(fg => {
          const isChess = fg.gameType === "chess";
          const fmtPG = (name) => name === "AI" ? (fg.aiLevel ? `AI (Lv ${fg.aiLevel})` : "AI") : (name || "—");
          const firstName  = fmtPG(isChess ? fg.players?.white : fg.players?.black);
          const secondName = fmtPG(isChess ? fg.players?.black : fg.players?.white);
          const isFailed = failedGameIds?.has(fg.id);
          return (
            <div key={fg.id} style={{
              background: C.surface, border: `1px solid ${isFailed ? C.errorBorder : C.border}`,
              borderRadius: 14, padding: "14px",
              display: "flex", flexDirection: "column", gap: 8,
              boxShadow: "0 2px 8px rgba(42,26,8,0.06)", opacity: isFailed ? 0.85 : 0.72,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <GameBadge isChess={isChess} size={52} />
                <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <div style={{ fontSize: 22, fontWeight: 600, color: C.text,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "left" }}>
                    {firstName}
                    <span style={{ color: C.textMuted, fontWeight: 400, margin: "0 6px" }}>vs</span>
                    {secondName}
                  </div>
                  <div style={{ color: C.textMuted, fontSize: 20, marginTop: 3, textAlign: "left" }}>
                    {(fg.history||[]).length}{t("手", " moves")}
                  </div>
                </div>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{isFailed ? "⚠️" : "⏳"}</span>
              </div>
              <div style={{
                fontSize: 20, color: isFailed ? C.errorText : C.textMid,
                background: isFailed ? C.errorBg : C.accRow, borderRadius: 8,
                padding: "6px 12px",
                border: `1px solid ${isFailed ? C.errorBorder : C.border}`,
                display: "flex", flexDirection: "column", gap: 4,
              }}>
                {isFailed ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>⚠️</span>
                    {t("解析に失敗しました", "Analysis failed")}
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ animation: "pulse 1.5s ease-in-out infinite" }}>🔍</span>
                      {t("解析中…", "Analyzing…")}
                      {progressMap?.[fg.id] != null && (
                        <span style={{ marginLeft: "auto", color: C.gold, fontWeight: 600 }}>
                          {progressMap[fg.id]}%
                        </span>
                      )}
                    </div>
                    {progressMap?.[fg.id] != null && (
                      <div style={{ height: 3, background: C.border, borderRadius: 2 }}>
                        <div style={{ height: "100%", width: `${progressMap[fg.id]}%`, background: C.gold, borderRadius: 2, transition: "width 0.3s" }} />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}

        {/* List */}
        {analyses !== null && analyses.map(item => {
          const isChess = item.gameType === "chess";
          const fmtPlayer = (name) => {
            if (name === "AI") return item.aiLevel ? `AI (Lv ${item.aiLevel})` : "AI";
            return name || "—";
          };
          const firstName  = fmtPlayer(isChess ? item.players?.white : item.players?.black);
          const secondName = fmtPlayer(isChess ? item.players?.black : item.players?.white);

          const winner   = item.winner || null;
          const isLocked = !!item.locked;

          /* 自分の精度だけ表示 */
          const isFirstPlayer  = playerName === firstName;
          const isSecondPlayer = playerName === secondName;
          const myAcc = isFirstPlayer
            ? item.accuracy?.first
            : isSecondPlayer
              ? item.accuracy?.second
              : null;

          const moveCount = item.historyLength || 0;

          const cardBg     = isLocked ? C.surfaceLock : C.surface;
          const cardBorder = isLocked ? C.borderLock  : C.border;

          return (
            <div
              key={item.gameId}
              style={{
                background: cardBg, border: `1px solid ${cardBorder}`,
                borderRadius: 14, padding: "14px", cursor: "pointer",
                transition: "background 0.15s, border-color 0.15s, box-shadow 0.15s",
                display: "flex", flexDirection: "column", gap: 10,
                boxShadow: "0 2px 8px rgba(42,26,8,0.06)",
              }}
              onClick={() => onOpenAnalysis(item)}
              onMouseEnter={e => {
                e.currentTarget.style.boxShadow = "0 4px 16px rgba(42,26,8,0.12)";
                e.currentTarget.style.borderColor = C.borderGold;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.boxShadow = "0 2px 8px rgba(42,26,8,0.06)";
                e.currentTarget.style.borderColor = cardBorder;
              }}
            >
              {/* Top row */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <GameBadge isChess={isChess} size={52} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* 対局者名 */}
                  <div style={{
                    fontSize: 22, fontWeight: 600, color: C.text,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    display: "flex", alignItems: "center", gap: 6,
                  }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
                      {firstName}
                      <span style={{ color: C.textMuted, fontWeight: 400, margin: "0 6px" }}>vs</span>
                      {secondName}
                    </span>
                    {isLocked && <span style={{ fontSize: 18, flexShrink: 0 }}>🔒</span>}
                  </div>

                  {/* 勝者 */}
                  {winner && (
                    <div style={{ color: C.gold, fontWeight: 400, fontSize: 19, marginTop: 2, textAlign: "left" }}>
                      {t(`勝者：${winner}`, `Winner: ${winner}`)}
                    </div>
                  )}

                  {/* メタ情報 */}
                  {(item.startedAt || item.endedAt) && (
                    <div style={{ color: C.textMuted, fontSize: 19, marginTop: 3, textAlign: "left", lineHeight: 1.6 }}>
                      {item.startedAt && (
                        <div>{t("開始：", "Start: ")}{fmtDateTime(item.startedAt)}</div>
                      )}
                      {item.endedAt && (
                        <div>{t("終了：", "End: ")}{fmtDateTime(item.endedAt)}</div>
                      )}
                      <div>{t("手数：", "Moves: ")}{moveCount}{t("手", "")}</div>
                    </div>
                  )}
                  {!item.startedAt && !item.endedAt && (
                    <div style={{ color: C.textMuted, fontSize: 19, marginTop: 3, textAlign: "left" }}>
                      {t("手数：", "Moves: ")}{moveCount}{t("手", "")}
                    </div>
                  )}
                </div>

                <span style={{ color: C.gold, fontSize: 26, flexShrink: 0 }}>›</span>
              </div>

              {/* ロック・削除ボタン */}
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <button
                  onClick={e => { e.stopPropagation(); handleToggleLock(item.gameId, isLocked); }}
                  disabled={locking === item.gameId}
                  title={isLocked ? t("ロック解除", "Unlock") : t("ロック（自動削除から除外）", "Lock")}
                  style={{
                    background: isLocked ? "rgba(192,160,48,0.22)" : C.btnLock,
                    border: `1px solid ${isLocked ? C.borderLock : C.border}`,
                    borderRadius: 8, color: isLocked ? C.gold : C.textMid,
                    padding: "4px 14px", cursor: "pointer", fontSize: 20, fontFamily: serif,
                  }}
                >
                  {locking === item.gameId ? "…" : isLocked ? "🔒" : "🔓"}
                </button>
                <button
                  onClick={e => { e.stopPropagation(); setConfirmDelete(item.gameId); }}
                  disabled={deleting === item.gameId}
                  style={{
                    background: C.btnDel, border: `1px solid rgba(192,48,32,0.3)`,
                    borderRadius: 8, color: C.btnDelText, padding: "4px 14px",
                    cursor: "pointer", fontSize: 20, fontFamily: serif,
                  }}
                >
                  {deleting === item.gameId ? "…" : "🗑"}
                </button>
              </div>
            </div>
          );
        })}

        {/* 件数説明 */}
        {analyses !== null && (analyses.length > 0 || pendingGames.length > 0) && (
          <div style={{ color: C.textMuted, fontSize: 20, textAlign: "left", padding: "4px 0 8px" }}>
            {t(
              "10件を超えると古い解析から自動削除されます（🔒ロック済みを除く）",
              "Oldest unlocked analyses are auto-deleted when over 10"
            )}
          </div>
        )}
      </div>

      {/* ── Delete Confirmation Modal ── */}
      {confirmDelete && (
        <div
          onClick={() => setConfirmDelete(null)}
          style={{
            position: "absolute", inset: 0, background: "rgba(42,26,8,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: C.surface, border: `2px solid ${C.borderGold}`,
              borderRadius: 16, padding: "28px 24px",
              maxWidth: 340, width: "85vw", textAlign: "left", fontFamily: serif,
              boxShadow: "0 20px 60px rgba(42,26,8,0.25)",
            }}
          >
            <div style={{ fontSize: 44, marginBottom: 8 }}>🗑</div>
            <div style={{ color: C.text, fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
              {t("解析を削除しますか？", "Delete this analysis?")}
            </div>
            {analyses?.find(a => a.gameId === confirmDelete)?.locked && (
              <div style={{ color: C.gold, fontSize: 20, marginBottom: 8 }}>
                ⚠ {t("ロック済みの解析です", "This analysis is locked")}
              </div>
            )}
            <div style={{ color: C.textMuted, fontSize: 20, marginBottom: 20 }}>
              {t("この操作は取り消せません。", "This cannot be undone.")}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setConfirmDelete(null)}
                style={{
                  background: C.pageBg, border: `1px solid ${C.border}`,
                  borderRadius: 10, color: C.textMid, padding: "10px 22px",
                  cursor: "pointer", fontSize: 20, fontFamily: serif,
                }}
              >
                {t("キャンセル", "Cancel")}
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                style={{
                  background: "rgba(192,48,32,0.15)", border: "1px solid rgba(192,48,32,0.5)",
                  borderRadius: 10, color: C.btnDelText, padding: "10px 22px",
                  cursor: "pointer", fontSize: 20, fontFamily: serif,
                }}
              >
                {t("削除", "Delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
