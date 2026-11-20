"""Ajan Merkezi kısayolu için uygulama simgesi (ajan-merkezi.ico) üretir."""
from pathlib import Path

from PIL import Image, ImageDraw

S = 256
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# teal -> mor çapraz geçişli arka plan
grad = Image.new("RGBA", (S, S))
px = grad.load()
a, b = (15, 118, 110), (109, 40, 217)
for y in range(S):
    for x in range(S):
        t = (x + y) / (2 * (S - 1))
        px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([8, 8, S - 8, S - 8], radius=58, fill=255)
img.paste(grad, (0, 0), mask)

d = ImageDraw.Draw(img)
pts = [(52, 182), (106, 122), (146, 154), (206, 74)]
d.line(pts, fill=(236, 254, 255, 255), width=24, joint="curve")
for x, y in pts:
    d.ellipse([x - 12, y - 12, x + 12, y + 12], fill=(236, 254, 255, 255))
d.ellipse([194, 62, 218, 86], fill=(52, 211, 153, 255))

out = Path(__file__).with_name("ajan-merkezi.ico")
img.save(out, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(out)
