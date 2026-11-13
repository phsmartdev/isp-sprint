"""Mapa-base isométrico de Aracaju (OpenStreetMap) em coordenadas de tela do palco 1600x900."""
import json, math, sys
from shapely.geometry import Polygon, LineString, MultiPolygon, MultiLineString, box, Point
from shapely.ops import unary_union
from load import *

PHI = math.radians(62)
SQ = 0.6                      # achatamento isométrico
TILE = box(-6600, -10300, 3300, 5600)   # recorte do mapa (m)
REGION = (500, 70, 1595, 800)  # área da tela para o mapa

def rot(x, y): return (math.cos(PHI) * x - math.sin(PHI) * y, (math.sin(PHI) * x + math.cos(PHI) * y) * SQ)
cs = [rot(*c) for c in TILE.exterior.coords]
minx, maxx = min(c[0] for c in cs), max(c[0] for c in cs); miny, maxy = min(c[1] for c in cs), max(c[1] for c in cs)
SC = min((REGION[2] - REGION[0]) / (maxx - minx), (REGION[3] - REGION[1] - 30) / (maxy - miny))
OX = REGION[0] + ((REGION[2] - REGION[0]) - (maxx - minx) * SC) / 2 - minx * SC
OY = REGION[1] + ((REGION[3] - REGION[1] - 30) - (maxy - miny) * SC) / 2 - miny * SC
def S(x, y):
    a, b = rot(x, y); return (OX + a * SC, OY + b * SC)
def ll(lon, lat): return S(*xy(lon, lat))
PXM = SC  # px por metro (horizontal)

def fmt(pts): return ' L'.join(f'{x:.1f} {y:.1f}' for x, y in pts)
def d_line(g):
    if g.is_empty: return ''
    gs = g.geoms if hasattr(g, 'geoms') else [g]
    out = []
    for l in gs:
        if l.geom_type != 'LineString' or len(l.coords) < 2: continue
        out.append('M' + fmt([S(*c) for c in l.coords]))
    return ''.join(out)
def d_poly(g):
    if g.is_empty: return ''
    gs = g.geoms if hasattr(g, 'geoms') else [g]
    out = []
    for p in gs:
        if p.geom_type != 'Polygon': continue
        for r in [p.exterior, *p.interiors]: out.append('M' + fmt([S(*c) for c in r.coords]) + 'Z')
    return ''.join(out)
def poly_of(e):
    if e['type'] == 'way':
        pts = way_pts(e)
        return Polygon(pts).buffer(0) if len(pts) > 3 else None
    rs = [r for r in rel_rings(e) if len(r) > 3 and r[0] == r[-1]]
    return unary_union([Polygon(r).buffer(0) for r in rs]) if rs else None

geo = {'phi': math.degrees(PHI), 'sc': SC}
geo['tile'] = [S(*c) for c in TILE.exterior.coords][:-1]

aju = unary_union([Polygon(r).buffer(0) for r in rel_rings(els('boundary')[0]) if r[0] == r[-1]])
AJU = aju
geo['aju'] = d_poly(aju.intersection(TILE).simplify(15))
nb = unary_union([poly_of(e) for e in els('neigh') if poly_of(e)])
geo['neigh'] = d_poly(nb.difference(aju).intersection(TILE).simplify(20))
land = unary_union([aju, nb]).intersection(TILE)

water = [poly_of(e) for e in els('water') if e['tags'].get('natural') == 'water']
water = unary_union([w for w in water if w and not w.is_empty]).intersection(land)
geo['water'] = d_poly(water.simplify(12).buffer(0))
wet = [poly_of(e) for e in els('wet') if e['tags'].get('natural') == 'wetland' or e['tags'].get('landuse') == 'forest']
wet = unary_union([w for w in wet if w and not w.is_empty]).intersection(land).difference(water)
geo['wet'] = d_poly(wet.simplify(20).buffer(0))
beach = [poly_of(e) for e in els('wet') if e['tags'].get('natural') in ('beach', 'sand')]
geo['beach'] = d_poly(unary_union([w for w in beach if w and not w.is_empty]).intersection(land).simplify(10).buffer(0))
parks = [poly_of(e) for e in els('parks')]
geo['parks'] = d_poly(unary_union([w for w in parks if w and not w.is_empty]).intersection(land).simplify(8).buffer(0))

def lines(name, flt=None, tol=6):
    ls = []
    for e in els(name):
        if flt and not flt(e): continue
        p = way_pts(e)
        if len(p) > 1: ls.append(LineString(p))
    return unary_union(ls).intersection(TILE).simplify(tol)
geo["minor"] = d_line(lines("minor", tol=11))
geo['major'] = d_line(lines('roads', lambda e: not e['tags'].get('highway', '').endswith('_link'), tol=6))
geo['bridge'] = d_line(lines('bridge', lambda e: e['tags'].get('bridge') == 'yes', tol=2))

# prédios altos extrudados (altura exagerada para leitura)
blds = []
for e in els('tall'):
    t = e['tags']
    try: lv = float(t.get('building:levels', '0').split(';')[0])
    except ValueError: continue
    if lv < 6: continue
    pts = way_pts(e)
    if len(pts) < 4: continue
    p = Polygon(pts).buffer(0)
    if p.is_empty or p.geom_type != 'Polygon' or not TILE.contains(p) or p.area < 120: continue
    p = p.simplify(3)
    ring = [S(*c) for c in p.exterior.coords][:-1]
    if len(ring) < 3: continue
    h = min(lv, 30) * 3 * PXM * 5.0
    blds.append((sum(y for _, y in ring) / len(ring), ring, h, lv))
blds.sort(key=lambda b: b[0])
out = []
for _, ring, h, lv in blds:
    a = sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring)))
    walls = []
    for i in range(len(ring)):
        p, q = ring[i], ring[(i + 1) % len(ring)]
        nx, ny = (q[1] - p[1], -(q[0] - p[0])) if a > 0 else (-(q[1] - p[1]), q[0] - p[0])
        if ny <= 0: continue   # só as paredes voltadas para a câmera
        walls.append(f'M{p[0]:.1f} {p[1]:.1f}L{q[0]:.1f} {q[1]:.1f}L{q[0]:.1f} {q[1]-h:.1f}L{p[0]:.1f} {p[1]-h:.1f}Z')
    top = 'M' + fmt([(x, y - h) for x, y in ring]) + 'Z'
    out.append([''.join(walls), top, round(lv)])
geo['blds'] = out

# rótulos geográficos (ponto em lon/lat)
LBL = {'Rio Sergipe': (-37.0505, -10.900), 'Orla de Atalaia': (-37.035, -10.992), 'Centro': (-37.0530, -10.9115),
       'Ponte Construtor João Alves': (-37.0425, -10.8990), 'Oceano Atlântico': (-37.005, -10.985), 'Rio Poxim': (-37.072, -10.948),
       'Barra dos Coqueiros': (-37.030, -10.895)}
geo['labels'] = {k: ll(*v) for k, v in LBL.items()}
c = aju.intersection(TILE).representative_point()
geo['ajuLabel'] = ll(-37.075, -10.925)
json.dump(geo, open('geo.json', 'w'))
print('blds', len(out), 'sizes', {k: len(v) for k, v in geo.items() if isinstance(v, str)})
