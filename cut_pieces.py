from PIL import Image
import os

SRC = r"C:\Users\hhona\OneDrive\デスクトップ\iCloud写真\HP素材\C643FC3C-5690-4B28-A0B0-6950723879A9.PNG"
OUT = r"C:\Users\hhona\family-chess\public\pieces"

# 上段左から：白ポーン・白ビショップ・白ルーク・白ナイト・白クイーン・白キング
# 下段左から：黒ポーン・黒ビショップ・黒ルーク・黒クイーン・黒ナイト・黒キング
PIECES = [
    ["wP","wB","wR","wN","wQ","wK"],
    ["bP","bB","bR","bQ","bN","bK"],
]

COL_W  = 1672 // 6   # 278px
ROW_H  = [470, 471]  # 上段470, 下段471

img = Image.open(SRC).convert("RGBA")
print(f"元画像サイズ: {img.size}")

for row_i, row_names in enumerate(PIECES):
    y0 = sum(ROW_H[:row_i])
    y1 = y0 + ROW_H[row_i]
    for col_i, name in enumerate(row_names):
        x0 = col_i * COL_W
        x1 = x0 + COL_W
        cell = img.crop((x0, y0, x1, y1)).convert("RGBA")

        # 白っぽい背景（RGB各値215以上）を透明化
        px = cell.load()
        for y in range(cell.height):
            for x in range(cell.width):
                r, g, b, a = px[x, y]
                if r >= 215 and g >= 215 and b >= 215:
                    px[x, y] = (r, g, b, 0)

        # トリミング（透明余白除去）
        bbox = cell.getbbox()
        if bbox:
            cell = cell.crop(bbox)

        out_path = os.path.join(OUT, f"{name}.webp")
        cell.save(out_path, "WEBP", quality=90)
        print(f"  {name}.webp -> {cell.size}")

print("完了")
