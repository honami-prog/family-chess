/* ── チェス・将棋 定石データ ─────────────────────────────────────── */

export const CHESS_OPENINGS = [
  {
    id: "ruy_lopez",
    nameJa: "ルイ・ロペス",
    nameEn: "Ruy López",
    moves: ["e2e4","e7e5","g1f3","b8c6","f1b5"],
    descJa: "ビショップをb5に展開し相手ナイトを牽制。最も古典的なオープニングの一つ。",
    descEn: "White develops the bishop to b5, pressuring Black's knight. One of the oldest classical openings.",
  },
  {
    id: "italian",
    nameJa: "イタリアン・ゲーム",
    nameEn: "Italian Game",
    moves: ["e2e4","e7e5","g1f3","b8c6","f1c4","f8c5"],
    descJa: "ビショップをc4に向け中央支配を目指す。ジョコ・ピアノとも呼ばれる王道オープニング。",
    descEn: "White places the bishop on c4 aiming for central control. Also known as Giuoco Piano.",
  },
  {
    id: "sicilian",
    nameJa: "シシリアン・ディフェンス",
    nameEn: "Sicilian Defense",
    moves: ["e2e4","c7c5","g1f3","d7d6","d2d4","c5d4","f3d4","g8f6","b1c3","a7a6"],
    descJa: "黒がc5で非対称に応じる最人気の対1.e4応手。ナイドーフ変化を示す。",
    descEn: "Black's most popular response to 1.e4 with asymmetric c5. Shows the Najdorf variation.",
  },
  {
    id: "queens_gambit",
    nameJa: "クイーンズ・ギャンビット",
    nameEn: "Queen's Gambit",
    moves: ["d2d4","d7d5","c2c4","e7e6","b1c3","g8f6","c1g5"],
    descJa: "c4でポーンを差し出し中央支配を狙う。クローズドゲームの代表的オープニング。",
    descEn: "White offers a pawn on c4 to gain central control. A classic closed-game opening.",
  },
  {
    id: "kings_indian",
    nameJa: "キングズ・インディアン",
    nameEn: "King's Indian Defense",
    moves: ["d2d4","g8f6","c2c4","g7g6","b1c3","f8g7","e2e4","d7d6","g1f3"],
    descJa: "ビショップをg7にフィアンケット展開し積極的な反撃を目指す現代的ディフェンス。",
    descEn: "Black fianchettoes the bishop to g7 and prepares dynamic counterplay. A modern aggressive defense.",
  },
  {
    id: "french",
    nameJa: "フレンチ・ディフェンス",
    nameEn: "French Defense",
    moves: ["e2e4","e7e6","d2d4","d7d5","b1c3","g8f6","c1g5"],
    descJa: "e6で堅固な駒組みを作り白のd4ポーンに圧力をかける戦略的ディフェンス。",
    descEn: "Black builds a solid structure with e6, attacking White's d4 pawn. Strategic and solid.",
  },
  {
    id: "caro_kann",
    nameJa: "カロ・カン・ディフェンス",
    nameEn: "Caro-Kann Defense",
    moves: ["e2e4","c7c6","d2d4","d7d5","b1c3","d5e4","c3e4","c8f5"],
    descJa: "c6でポーンを支えd5を突く堅実なディフェンス。フランス系より駒の活動性が高い。",
    descEn: "Black supports d5 with c6 — solid and active. Bishops stay freer than in the French.",
  },
  {
    id: "london",
    nameJa: "ロンドン・システム",
    nameEn: "London System",
    moves: ["d2d4","d7d5","g1f3","g8f6","c1f4","e7e6","e2e3","c7c5"],
    descJa: "白がビショップをf4・ナイトをf3に固定する安定したシステム。幅広い局面に対応しやすい。",
    descEn: "White sets up Bf4 and Nf3 as a solid system. Reliable and flexible against most setups.",
  },
  {
    id: "english",
    nameJa: "イングリッシュ・オープニング",
    nameEn: "English Opening",
    moves: ["c2c4","e7e5","b1c3","g8f6","g2g3","d7d5","c4d5","f6d5"],
    descJa: "c4から始まるフランキングオープニング。柔軟な展開で多彩な変化に対応できる現代的戦法。",
    descEn: "A flank opening starting with c4. Highly flexible and transposes into many modern systems.",
  },
  {
    id: "nimzo_indian",
    nameJa: "ニムゾ・インディアン・ディフェンス",
    nameEn: "Nimzo-Indian Defense",
    moves: ["d2d4","g8f6","c2c4","e7e6","b1c3","f8b4"],
    descJa: "黒がビショップをb4に配置し白のe4前進を牽制。ダブルポーンを誘発する高度な戦略的ディフェンス。",
    descEn: "Black pins the knight on c3 with Bb4. Doubles White's pawns and creates strategic imbalances.",
  },
];

export const SHOGI_OPENINGS = [
  {
    id: "yagura",
    nameJa: "矢倉",
    nameEn: "Yagura",
    moves: ["7g7f","8c8d","6g6f","3c3d","7i6h","3a4b","6i7h","4a3b"],
    descJa: "居飛車の代表的な囲い。金銀を組み合わせ玉を固める最も基本的で堅固な囲いの一つ。",
    descEn: "A classic castle for static rook players. Combines golds and silvers to secure the king.",
  },
  {
    id: "shiken_bisha",
    nameJa: "四間飛車",
    nameEn: "Fourth-file Rook",
    moves: ["7g7f","8c8d","2h4h","8d8e","4g4f","3c3d","6i7h"],
    descJa: "飛車を4筋に移動させる振り飛車の代表戦法。攻守バランスに優れた人気の作戦。",
    descEn: "Rook moves to the 4th file. A popular flying-rook strategy with balanced attack and defense.",
  },
  {
    id: "kakugawari",
    nameJa: "角換わり",
    nameEn: "Bishop Exchange",
    moves: ["7g7f","3c3d","8h2b+","3a2b"],
    descJa: "序盤に角を交換する積極的戦法。角を手持ちにして後の打ち込みを狙う。",
    descEn: "Both sides exchange bishops early. Holding a bishop in hand allows powerful drop attacks later.",
  },
  {
    id: "sangen_bisha",
    nameJa: "三間飛車",
    nameEn: "Third-file Rook",
    moves: ["7g7f","8c8d","2h3h","8d8e","3g3f","3c3d"],
    descJa: "飛車を3筋に移動させる振り飛車。四間飛車より守りに厚く9筋攻めと組み合わせやすい。",
    descEn: "Rook moves to the 3rd file. More solid than 4th-file rook, good for 9th-file attacks.",
  },
  {
    id: "mukai_bisha",
    nameJa: "向い飛車",
    nameEn: "Opposing Rook",
    moves: ["7g7f","8c8d","8h7g","2h8h","8d8e","3c3d"],
    descJa: "飛車を8筋に移動させ相手飛車と向かい合わせにする振り飛車。直接対決を狙う積極的戦法。",
    descEn: "Rook moves to face opponent's rook on the 8th file. A direct and aggressive flying-rook strategy.",
  },
  {
    id: "naka_bisha",
    nameJa: "中飛車",
    nameEn: "Central Rook",
    moves: ["7g7f","8c8d","5g5f","8d8e","2h5h"],
    descJa: "飛車を5筋（中央）に配置する振り飛車。中央支配と攻撃の両立が得意な均衡型戦法。",
    descEn: "Rook moves to the central 5th file. Controls the center while building balanced attack potential.",
  },
  {
    id: "gangi",
    nameJa: "雁木",
    nameEn: "Gangi",
    moves: ["7g7f","8c8d","6g6f","3c3d","6i7h","4a3b","3i4h","8b3b"],
    descJa: "桂馬を活用した居飛車の囲い。矢倉に似るが桂馬が跳ねやすく積極的な攻撃に向く。",
    descEn: "A static-rook formation emphasizing the knight. Similar to Yagura but with more active knight play.",
  },
  {
    id: "ishida",
    nameJa: "石田流",
    nameEn: "Ishida Formation",
    moves: ["7g7f","8c8d","7f7e","3c3d","7i7h","2b3c","8h7g"],
    descJa: "7五歩から飛車・角・桂を連携させる三間飛車の発展形。攻撃的かつスピーディーな戦法。",
    descEn: "An aggressive three-file rook setup with pawn on 7e. Coordinates rook, bishop, and knight for rapid attack.",
  },
];

export const CHESS_TACTICS = [
  // The first 7 are "direct" (shown inline in practice page)
  { id:"fork",             nameJa:"フォーク",             nameEn:"Fork",              descJa:"1つの駒で2つ以上の相手の駒を同時に攻撃する手筋。ナイトフォークが代表的。", descEn:"Attacking two or more opponent pieces simultaneously with one piece. The knight fork is most common.", direct:true },
  { id:"pin",              nameJa:"ピン",                 nameEn:"Pin",               descJa:"駒を動かすと背後の価値の高い駒が取られてしまう状態。絶対ピンと相対ピンがある。", descEn:"A piece cannot move without exposing a more valuable piece behind it. Absolute and relative pins exist.", direct:true },
  { id:"skewer",           nameJa:"スキュア",             nameEn:"Skewer",            descJa:"ピンの逆。価値の高い駒を攻撃し、動かした後ろの駒を取る手筋。", descEn:"The reverse of a pin. Attack a high-value piece, then capture what was behind it when it moves.", direct:true },
  { id:"back_rank",        nameJa:"バックランク",         nameEn:"Back Rank Mate",    descJa:"相手のルークやクイーンが最終列（バックランク）に侵入してチェックメイトする手筋。", descEn:"Using a rook or queen to deliver checkmate on the opponent's back rank.", direct:true },
  { id:"discovered_attack",nameJa:"ディスカバードアタック",nameEn:"Discovered Attack", descJa:"駒を動かすことで、後ろに隠れていた駒の攻撃ラインを開放する手筋。", descEn:"Moving a piece to reveal an attack from a piece behind it.", direct:true },
  { id:"double_attack",    nameJa:"ダブルアタック",       nameEn:"Double Attack",     descJa:"1手で2か所を同時に攻撃する手筋。フォーク・ディスカバードアタックもこの一種。", descEn:"Attacking two targets simultaneously in one move. Forks and discovered attacks are types of double attacks.", direct:true },
  { id:"zwischenzug",      nameJa:"ツヴィッシェンツーク", nameEn:"Zwischenzug",       descJa:"相手の期待する応手を無視して、より価値の高い「間の手」を指す高度な手筋。", descEn:"An 'in-between move' that ignores the expected response and plays a stronger intermediate move.", direct:true },
  // Others shown via "more" button
  { id:"overloading",      nameJa:"オーバーロード",       nameEn:"Overloading",       descJa:"1つの駒が複数の防御任務を担っている状態を突く手筋。", descEn:"Exploiting a piece that is defending multiple targets at once.", direct:false },
  { id:"deflection",       nameJa:"そらし",               nameEn:"Deflection",        descJa:"重要な守備任務を持つ駒を別の場所に引きつけて守りを崩す手筋。", descEn:"Luring away a key defensive piece to expose another weakness.", direct:false },
  { id:"decoy",            nameJa:"おびき寄せ",           nameEn:"Decoy",             descJa:"相手の駒を不利な位置に誘い込んで攻撃する手筋。", descEn:"Enticing an opponent's piece to a disadvantageous square.", direct:false },
  { id:"zugzwang",         nameJa:"ツークツワング",       nameEn:"Zugzwang",          descJa:"どの手を指しても不利になる状態。主にエンドゲームで現れる。", descEn:"A position where any move worsens your position. Mainly appears in endgames.", direct:false },
  { id:"xray",             nameJa:"Xレイアタック",        nameEn:"X-ray Attack",      descJa:"駒越しに間接的に脅威を作る手筋。", descEn:"An indirect threat through an intervening piece.", direct:false },
];

export const SHOGI_TACTICS = [
  // Direct (important)
  { id:"s_tsume",        nameJa:"詰み（詰将棋）",  nameEn:"Checkmate (Tsume)",  descJa:"王将を逃げられない状態に追い込む基本。詰将棋で鍛える。", descEn:"Trapping the king with no escape. Practiced through tsume problems.", direct:true },
  { id:"s_ougi",         nameJa:"王手（チェック）", nameEn:"Check",             descJa:"王将に直接当たりをかける手。連続王手で詰みを狙う。", descEn:"Directly attacking the king. Aim for consecutive checks to achieve checkmate.", direct:true },
  { id:"s_bogin",        nameJa:"棒銀",            nameEn:"Bou-gin",           descJa:"銀将を縦一列に前進させて端や相手飛車筋を攻める代表的な攻め筋。", descEn:"Advancing silver in a straight line to attack the edge or rook file. A classic attacking pattern.", direct:true },
  { id:"s_hashi",        nameJa:"端攻め",          nameEn:"Edge Attack",       descJa:"1筋・9筋の端から香車・桂馬・歩で突破する手筋。", descEn:"Breaking through with lance, knight, and pawn from the edge (1st or 9th file).", direct:true },
  // Others via "more"
  { id:"s_uchifu_zume",  nameJa:"打ち歩詰め逃れ", nameEn:"Avoiding Pawn Drop Mate", descJa:"打ち歩詰めを相手に狙われた際の回避テクニック。", descEn:"Techniques to avoid being checkmated by a dropped pawn.", direct:false },
  { id:"s_narikin",      nameJa:"と金作り",        nameEn:"Tokin Formation",   descJa:"歩を成らせてと金を作り寄せの武器にする。", descEn:"Promoting a pawn to tokin (gold) to use as a powerful attacking piece.", direct:false },
  { id:"s_double_check", nameJa:"両王手",          nameEn:"Double Check",      descJa:"2枚の駒で同時に王手をかける決定的な手筋。合い駒ができない。", descEn:"Checking with two pieces simultaneously. Cannot be blocked.", direct:false },
  { id:"s_tanuki",       nameJa:"田楽刺し",        nameEn:"Skewer",            descJa:"飛車・角で2枚の駒を串刺しにして一方を取る手筋。", descEn:"Skewering two pieces with rook or bishop to capture one.", direct:false },
];

/* ── UCI文字列 → チェス history形式 ──────────────────────────────── */
export function uciMovesToChessHistory(moves) {
  return moves.map(mv => {
    const from = [8 - parseInt(mv[1]), mv.charCodeAt(0) - 97];
    const to   = [8 - parseInt(mv[3]), mv.charCodeAt(2) - 97];
    if (mv.length > 4) {
      return { from, to, notation: `${mv[2]}${mv[3]}=${mv[4].toUpperCase()}` };
    }
    return { from, to };
  });
}

/* ── USI文字列 → 将棋 history形式 ──────────────────────────────── */
export function usiMovesToShogiHistory(moves) {
  return moves.map(mv => {
    if (mv[1] === "*") {
      // 打ち駒: "P*3e"
      const to = [mv.charCodeAt(3) - 97, 9 - parseInt(mv[2])];
      return { drop: mv[0], to };
    }
    const from    = [mv.charCodeAt(1) - 97, 9 - parseInt(mv[0])];
    const to      = [mv.charCodeAt(3) - 97, 9 - parseInt(mv[2])];
    const promote = mv.length > 4 && mv[4] === "+";
    return { from, to, promote };
  });
}
