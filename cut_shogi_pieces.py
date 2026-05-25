from PIL import Image
import os

SRC = r"C:\Users\hhona\OneDrive\デスクトップ\iCloud写真\HP素材\9EF6B932-93E1-4EB3-8E4F-7E8BDE7EE0EE.jpeg"
OUT = r"C:\Users\hhona\family-chess\public\shogi"

# 行順・左から右の順に対応するファイル名
NAMES = [
    ["ou", "gyoku", "hisha", "kaku"],           # 行1: 王将・玉将・飛車・角行
    ["kin", "gin", "keima", "kyosha", "fuhyo"],  # 行2: 金将・銀将・桂馬・香車・歩兵
    ["ryuou", "ryuma", "narikin", "tokin"],      # 行3: 竜王・竜馬・成金・と金
]

os.makedirs(OUT, exist_ok=True)
img = Image.open(SRC).convert("RGBA")
W, H = img.size
print(f"元画像サイズ: {W} x {H}")

px = img.load()

def is_white(r, g, b, threshold=225):
    return r >= threshold and g >= threshold and b >= threshold

# 各行・列に「駒らしいピクセルがあるか」を判定
row_has = [False] * H
col_has = [False] * W

for y in range(H):
    for x in range(W):
        r, g, b, a = px[x, y]
        if not is_white(r, g, b):
            row_has[y] = True
            col_has[x] = True

def find_groups(mask, min_gap=8):
    """True が連続している区間を検出。min_gap より短い False 間隔はマージ"""
    groups = []
    in_g = False
    start = 0
    for i, v in enumerate(mask):
        if v and not in_g:
            start = i
            in_g = True
        elif not v and in_g:
            groups.append([start, i])
            in_g = False
    if in_g:
        groups.append([start, len(mask)])

    # 近接グループをマージ
    merged = []
    for g in groups:
        if merged and g[0] - merged[-1][1] <= min_gap:
            merged[-1][1] = g[1]
        else:
            merged.append(g)
    # 小さすぎるグループ（ノイズ）を除外
    return [g for g in merged if g[1] - g[0] > 20]

row_groups = find_groups(row_has, min_gap=15)
print(f"行グループ ({len(row_groups)}行): {row_groups}")

for row_i, (ry0, ry1) in enumerate(row_groups):
    if row_i >= len(NAMES):
        break

    # この行の範囲内で列グループを検出
    row_col_has = [False] * W
    for y in range(ry0, ry1):
        for x in range(W):
            r, g, b, a = px[x, y]
            if not is_white(r, g, b):
                row_col_has[x] = True

    col_groups = find_groups(row_col_has, min_gap=10)
    print(f"  行{row_i+1} 列グループ ({len(col_groups)}個): {col_groups}")

    for col_i, (cx0, cx1) in enumerate(col_groups):
        if col_i >= len(NAMES[row_i]):
            break
        name = NAMES[row_i][col_i]

        # パディングを少し追加してクロップ
        pad = 6
        x0 = max(0, cx0 - pad)
        y0 = max(0, ry0 - pad)
        x1 = min(W, cx1 + pad)
        y1 = min(H, ry1 + pad)

        cell = img.crop((x0, y0, x1, y1)).convert("RGBA")

        # 白背景を透明化
        cpx = cell.load()
        for cy in range(cell.height):
            for cx in range(cell.width):
                r, g, b, a = cpx[cx, cy]
                if is_white(r, g, b, threshold=220):
                    cpx[cx, cy] = (r, g, b, 0)

        # 透明余白をトリム
        bbox = cell.getbbox()
        if bbox:
            cell = cell.crop(bbox)

        out_path = os.path.join(OUT, f"{name}.png")
        cell.save(out_path, "PNG")
        print(f"    {name}.png -> {cell.size}")

print("\n完了")
