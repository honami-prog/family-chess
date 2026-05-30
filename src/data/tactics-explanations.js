export const TACTICS_EXPLANATIONS = {
  fork: {
    nameJa: 'フォーク（両取り）',
    nameEn: 'Fork',
    emoji: '🍴',
    descJa: '1つの駒で相手の2つ以上の駒を同時に攻撃する手筋です。相手はどちらかしか守れないため、必ず得をすることができます。',
    descEn: 'Attack two or more pieces simultaneously with one piece. The opponent can only save one, so you gain material.',
    tipJa: 'ナイトのフォークが最も代表的。常に相手の駒が2つ以上狙える位置を探しましょう。',
    tipEn: 'Knight forks are the most common. Always look for squares where you can attack two pieces at once.',
  },
  pin: {
    nameJa: 'ピン',
    nameEn: 'Pin',
    emoji: '📌',
    descJa: '駒を動かすと後ろにある価値の高い駒が取られてしまうため、動けなくなる状態です。',
    descEn: 'A piece cannot move without exposing a more valuable piece behind it to capture.',
    tipJa: 'キングやクイーンへのピンが特に強力。ビショップやルークでピンを狙いましょう。',
    tipEn: 'Pins against the king or queen are especially powerful. Use bishops and rooks to create pins.',
  },
  skewer: {
    nameJa: 'スキュアー',
    nameEn: 'Skewer',
    emoji: '🗡️',
    descJa: 'ピンの逆。価値の高い駒を攻撃し、その駒が動いた後ろにある駒を取る手筋です。',
    descEn: 'The reverse of a pin. Attack a valuable piece, and take what is behind it after it moves.',
    tipJa: 'キングへのスキュアーが最も強力。キングが逃げた後ろのクイーンやルークを取れます。',
    tipEn: 'Skewers against the king are most powerful. After the king moves, take the queen or rook behind it.',
  },
  discoveredAttack: {
    nameJa: '陰の攻撃（ディスカバードアタック）',
    nameEn: 'Discovered Attack',
    emoji: '👁️',
    descJa: '駒を動かすことで、後ろに隠れていた駒の攻撃ラインを開く手筋です。動かした駒と開いた駒の両方で攻撃できます。',
    descEn: 'Moving a piece reveals an attack by a piece behind it. You attack with both the moved piece and the revealed piece.',
    tipJa: '動かす駒自体も攻撃的に使うと効果倍増。相手は2つの脅威を同時に対処しなければなりません。',
    tipEn: 'Make the moving piece threatening too for double impact. The opponent must deal with two threats at once.',
  },
  doubleCheck: {
    nameJa: 'ダブルチェック',
    nameEn: 'Double Check',
    emoji: '‼️',
    descJa: '2つの駒が同時にキングをチェックする手筋です。キングは必ず逃げるしかなく、チェックをブロックすることができません。',
    descEn: 'Two pieces check the king simultaneously. The king must move since blocks cannot stop both checks.',
    tipJa: 'ダブルチェックはチェックメイトに直結しやすい強力な手筋です。',
    tipEn: 'Double check often leads directly to checkmate. It is one of the most powerful tactical motifs.',
  },
  deflection: {
    nameJa: 'そらし（デフレクション）',
    nameEn: 'Deflection',
    emoji: '↗️',
    descJa: '守りの重要な任務を担っている駒を、別の場所に誘い出して守りを崩す手筋です。',
    descEn: 'Lure away a piece that is performing an important defensive duty to expose weaknesses.',
    tipJa: '駒捨てで守り駒をそらすのが典型的な手法です。',
    tipEn: 'A sacrifice to deflect a key defender is the classic method.',
  },
  decoy: {
    nameJa: '誘い込み（デコイ）',
    nameEn: 'Decoy',
    emoji: '🎣',
    descJa: '相手の駒を不利な位置に誘い込む手筋です。誘い込まれた駒は取られるか悪い状況に追い込まれます。',
    descEn: "Lure an opponent's piece to an unfavorable square where it can be captured or exploited.",
    tipJa: '駒捨てで相手を誘い込み、その後の手順で得をするのが典型的なパターンです。',
    tipEn: 'Sacrifice a piece to lure the opponent, then exploit the position with a follow-up.',
  },
  sacrifice: {
    nameJa: 'サクリファイス（捨て駒）',
    nameEn: 'Sacrifice',
    emoji: '♟️',
    descJa: '短期的に駒を犠牲にして、より大きな利益（チェックメイトや駒得）を得る手筋です。',
    descEn: 'Give up material in the short term to gain a greater advantage such as checkmate or winning more material.',
    tipJa: '相手の守りを崩すために駒を捨てるのが典型的。常に駒を捨てた後の手順を計算しましょう。',
    tipEn: "Sacrificing to break open the king's defense is classic. Always calculate the follow-up before sacrificing.",
  },
  mateIn1: {
    nameJa: '1手詰め',
    nameEn: 'Mate in 1',
    emoji: '👑',
    descJa: '1手でチェックメイトできる局面です。相手のキングに逃げ場がなくなっています。',
    descEn: "Checkmate in one move. The opponent's king has no escape.",
    tipJa: 'キングの逃げ場を全て塞いでから詰ます。チェックになる手を全て確認しましょう。',
    tipEn: 'Make sure all escape squares are covered. Check every possible checking move.',
  },
  mateIn2: {
    nameJa: '2手詰め',
    nameEn: 'Mate in 2',
    emoji: '👑👑',
    descJa: '2手の手順でチェックメイトできる局面です。1手目で相手の選択肢を限定し、2手目で詰ます。',
    descEn: "Checkmate in two moves. The first move limits the opponent's options, the second delivers mate.",
    tipJa: '1手目でキングの逃げ場を減らし、どう応じても2手目で詰む形を作りましょう。',
    tipEn: 'Use the first move to restrict the king, ensuring mate on the second move regardless of the response.',
  },
  mateIn3: {
    nameJa: '3手詰め',
    nameEn: 'Mate in 3',
    emoji: '👑👑👑',
    descJa: '3手の手順でチェックメイトできる局面です。手順を正確に読み切ることが重要です。',
    descEn: 'Checkmate in three moves. Precise calculation is key.',
    tipJa: '相手の全ての応手に対して詰みがあることを確認してから1手目を指しましょう。',
    tipEn: 'Verify that mate exists against all opponent responses before playing the first move.',
  },
  endgame: {
    nameJa: 'エンドゲーム',
    nameEn: 'Endgame',
    emoji: '🏁',
    descJa: '駒が少なくなった終盤での手筋です。キングを積極的に使い、ポーンを昇格させることが重要です。',
    descEn: 'Tactical motifs in the endgame with few pieces. Active king play and pawn promotion are key.',
    tipJa: 'エンドゲームではキングも攻撃的な駒になります。積極的に前進させましょう。',
    tipEn: 'In the endgame, the king becomes an active piece. Advance it aggressively.',
  },
  backRankMate: {
    nameJa: 'バックランクメイト',
    nameEn: 'Back Rank Mate',
    emoji: '🚪',
    descJa: '相手のキングが最終列に閉じ込められているときに、ルークやクイーンで詰ます手筋です。',
    descEn: 'Deliver checkmate on the back rank when the king is trapped by its own pawns.',
    tipJa: 'キャスリング後にポーンを動かさないとバックランクメイトの危険があります。h3やg3のポーンで逃げ道を作りましょう。',
    tipEn: 'Avoid back rank mate by creating an escape square with h3 or g3 after castling.',
  },
};

// テーマが見つからない場合のデフォルト
export const DEFAULT_EXPLANATION = {
  nameJa: 'タクティクス',
  nameEn: 'Tactics',
  emoji: '♟️',
  descJa: '相手の弱点を突いて有利を得る手筋です。常に相手の駒の配置を確認し、機会を逃さないようにしましょう。',
  descEn: "Exploit weaknesses in the opponent's position. Always look for tactical opportunities.",
  tipJa: '相手が最後に指した手の後、必ず戦術的なチャンスがないか確認する習慣をつけましょう。',
  tipEn: 'After every opponent move, make it a habit to check for tactical opportunities.',
};

/**
 * puzzle.themes 配列から TACTICS_EXPLANATIONS に存在するテーマを探す。
 * 複数ある場合は最初に見つかったものを返す。
 * 見つからない場合は DEFAULT_EXPLANATION を返す。
 */
export function getTacticsExplanation(themes) {
  if (Array.isArray(themes)) {
    for (const theme of themes) {
      if (TACTICS_EXPLANATIONS[theme]) return TACTICS_EXPLANATIONS[theme];
    }
  }
  return DEFAULT_EXPLANATION;
}
