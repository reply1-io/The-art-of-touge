# Makes the pixel-art glowing button frames in src/styles.css (--pxbtn, --pxbtn-on). Run: python3 scripts/pixel-frame.py
import math, urllib.parse
# A 9-slice pixel-art frame: N x N cells; the frame line sits G cells in from the edge so the glow
# can spill outside the button. Corners rounded to radius R cells, in whole pixels.
G = 3      # glow rings outside the frame
R = 5      # corner radius at the frame, in cells
C = G + R + 1   # corner slice size
N = C * 2 + 1
def sd(x, y):
    # signed distance from the frame's rounded rectangle (inside negative), cell centres
    half = (N - 2 * G) / 2
    px, py = abs(x + 0.5 - N / 2), abs(y + 0.5 - N / 2)
    qx, qy = px - (half - R), py - (half - R)
    out = math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - R
    return out
def svg(frame, glow, inner, fill):
    rects = []
    for y in range(N):
        run = None
        cells = []
        for x in range(N):
            d = sd(x, y)
            col = None
            if -1 <= d < 0: col = frame
            elif 0 <= d < 1: col = glow[0]
            elif 1 <= d < 2: col = glow[1]
            elif 2 <= d < 3: col = glow[2]
            elif -2 <= d < -1: col = inner[0]
            elif -3 <= d < -2: col = inner[1]
            elif d < -3: col = fill
            cells.append(col)
        # Runs of the same colour along the row, as one rectangle each.
        x = 0
        while x < N:
            col = cells[x]
            w = 1
            while x + w < N and cells[x + w] == col:
                w += 1
            if col:
                rects.append(f'<rect x="{x}" y="{y}" width="{w}" height="1" fill="{col}"/>')
            x += w
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{N}" height="{N}" viewBox="0 0 {N} {N}" shape-rendering="crispEdges">{"".join(rects)}</svg>'
def uri(s):
    return 'url("data:image/svg+xml,' + urllib.parse.quote(s, safe=' /=:<>"-,.') .replace('"', "'") + '")'
normal = svg('#ffa04a', ['rgba(255,140,26,0.55)', 'rgba(255,140,26,0.3)', 'rgba(255,140,26,0.13)'], ['rgba(255,150,50,0.35)', 'rgba(255,140,26,0.16)'], 'rgba(10,7,5,0.62)')
on = svg('#ffd2a0', ['rgba(255,150,40,0.85)', 'rgba(255,140,26,0.5)', 'rgba(255,140,26,0.24)'], ['rgba(255,190,120,0.75)', 'rgba(255,150,50,0.55)'], 'rgba(255,120,20,0.42)')
print('C', C, 'N', N, 'G', G)
print('--pxbtn:', uri(normal))
print('--pxbtn-on:', uri(on))

