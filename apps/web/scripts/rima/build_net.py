"""Topologia CONCEITUAL da RIMA sobre ruas reais (OSM): anel de backbone por avenidas, POPs em equipamentos públicos,
acesso óptico pelas ruas até cada unidade, splitters nas bifurcações. Saída em coordenadas de tela (net.json)."""
import json, re, heapq, math, hashlib
import numpy as np
from shapely.geometry import Point, Polygon, LineString
from shapely.ops import unary_union
import build_geo as G
from load import *

TILE = G.TILE
aju = G.AJU
inb = lambda x, y: TILE.contains(Point(x, y)) and aju.buffer(80).contains(Point(x, y))

# ---------------- grafo viário ----------------
nodes = {}; coords = []; adj = []
def nid(p):
    k = (round(p[0], 1), round(p[1], 1))
    if k not in nodes: nodes[k] = len(coords); coords.append(p); adj.append([])
    return nodes[k]
def add_ways(name, major):
    for e in els(name):
        hw = e['tags'].get('highway', '')
        pts = way_pts(e)
        for a, b in zip(pts, pts[1:]):
            if not (TILE.buffer(400).contains(Point(*a))): continue
            i, j = nid(a), nid(b); L = math.dist(a, b)
            adj[i].append((j, L, major)); adj[j].append((i, L, major))
add_ways('roads', True); add_ways('minor', False)
C = np.array(coords)
print('grafo', len(coords))

def nearest(x, y, major_only=False):
    dd = (C[:, 0] - x) ** 2 + (C[:, 1] - y) ** 2
    if major_only:
        mask = np.array([any(m for _, _, m in adj[i]) for i in range(len(coords))])
        dd = np.where(mask, dd, np.inf)
    return int(np.argmin(dd))
MAJOR = np.array([any(m for _, _, m in a) for a in adj])

def dijkstra(srcs, wf):
    dist = {s: 0 for s in srcs}; par = {s: None for s in srcs}; root = {s: s for s in srcs}
    h = [(0, s) for s in srcs]
    while h:
        d, u = heapq.heappop(h)
        if d > dist[u]: continue
        for v, L, m in adj[u]:
            nd = d + wf(u, v, L, m)
            if nd < dist.get(v, 1e18): dist[v] = nd; par[v] = u; root[v] = root[u]; heapq.heappush(h, (nd, v))
    return dist, par, root
def trace(par, t):
    out = []
    while t is not None: out.append(t); t = par[t]
    return out[::-1]

# ---------------- POIs ----------------
pois = els('pois')
def pos(e): return (e['lon'], e['lat']) if 'lon' in e else (e['center']['lon'], e['center']['lat'])
def pick(f):
    out, seen = [], set()
    for e in pois:
        t = e['tags']; nm = t.get('name', '')
        x, y = xy(*pos(e))
        if not inb(x, y) or not f(t, nm): continue
        key = re.sub(r'\W', '', nm.lower())
        if nm and key in seen: continue
        seen.add(key); out.append({'name': nm, 'x': x, 'y': y, 'osm': f"{e['type']}/{e['id']}"})
    return out
def spread(items, n):
    """amostragem pelo ponto mais distante (cobre a cidade sem aglomerar)."""
    if len(items) <= n: return items
    sel = [items[0]]
    while len(sel) < n:
        best = max(items, key=lambda a: min(math.dist((a['x'], a['y']), (b['x'], b['y'])) for b in sel))
        sel.append(best)
    return sel

R = re.compile
pts = []
def add(cat, items, kind, dedicated=False):
    for it in items: pts.append({**it, 'cat': cat, 'kind': kind, 'ded': dedicated})

adm = pick(lambda t, n: (t.get('office') == 'government' or t.get('amenity') == 'townhall') and R(r'(?i)(Municipal|Município|Aracaju|SEMDE|SEMA|CRAS)').search(n) and not R(r'(?i)sindicato|cart[óo]rio|educa|SMTT|EMSURB').search(n))
pref = [a for a in adm if 'Prefeitura' in a['name']]
add('adm', pref, 'Prefeitura · Centro Administrativo', True)
add('adm', [a for a in adm if a not in pref and 'centro administrativo de aracaju' not in a['name'].lower() and 'SEMDE Aracaju' != a['name'] and 'EMURB - ' not in a['name']], 'Órgão municipal')
semed = pick(lambda t, n: t.get('office') == 'government' and R(r'(?i)Secretaria Municipal de Educa').search(n))[:1]
add('edu', semed, 'Secretaria Municipal de Educação')
add('edu', pick(lambda t, n: t.get('amenity') == 'school' and R(r'(?i)municipal|EMEF|EMEI|E\.M\.').search(n)), 'Escola municipal')
add('sau', pick(lambda t, n: (t.get('amenity') in ('clinic', 'hospital', 'doctors') or 'healthcare' in t) and R(r'(?i)unidade (b[áa]sica|de sa[úu]de)|^UBS|^USF|pronto atendimento').search(n)), 'Unidade de saúde')
guard = pick(lambda t, n: t.get('amenity') == 'police' and 'Guarda Municipal' in n)
add('seg', guard, 'Guarda Municipal · central de monitoramento', True)
cams = pick(lambda t, n: t.get('man_made') == 'surveillance')
add('seg', [{**c, 'name': 'Câmera de videomonitoramento'} for c in spread(cams, 14)], 'Câmera')
smtt = pick(lambda t, n: 'Superintendência Municipal de Transportes' in n)
add('mob', smtt, 'Central de mobilidade (SMTT)', True)
sig = pick(lambda t, n: t.get('highway') == 'traffic_signals')
add('mob', [{**s, 'name': 'Semáforo'} for s in spread(sig, 18)], 'Semáforo')
emsurb = pick(lambda t, n: 'EMSURB' in n)
add('urb', emsurb, 'Serviços urbanos (EMSURB)')
parks = []
for e in els('parks'):
    nm = e['tags'].get('name')
    if not nm or not nm.startswith('Praça') and not nm.startswith('Parque'): continue
    p = G.poly_of(e)
    if not p or p.is_empty: continue
    c = p.representative_point()
    if inb(c.x, c.y): parks.append({'name': nm, 'x': c.x, 'y': c.y, 'osm': f"{e['type']}/{e['id']}", 'area': p.area})
parks.sort(key=lambda p: -p['area'])
add('urb', spread(parks[:40], 8), 'Praça · Wi-Fi público e sensores')
print({c: sum(1 for p in pts if p['cat'] == c) for c in ['adm', 'edu', 'sau', 'seg', 'mob', 'urb']})

# ---------------- POPs reais da RIMA (endereços informados pela BK Telecom, posições do OSM) ----------------
POPDEF = [('POP SMTT', 'Sede da SMTT · R. Roberto Fonseca, 200 · Inácio Barbosa', (-37.071135, -10.9514195)),
          ('POP SEPLOG', 'Prefeitura de Aracaju (SEPLOG) · R. Frei Luiz Canolo de Noronha, 42 · Ponto Novo', (-37.0776269, -10.9283175)),
          ('POP UPA Sul', 'Hospital Municipal Des. Fernando Franco · Av. Dr. Tarcísio Daniel dos Santos, 1 · Farolândia', (-37.0744772, -10.9749578)),
          ('POP UPA Norte', 'Hospital Nestor Piva · Av. Maranhão, s/n · 18 do Forte', (-37.0672697, -10.904883))]
pops = []
for nm, site, (lon, lat) in POPDEF:
    x, y = xy(lon, lat); pops.append({'name': nm, 'site': site, 'x': x, 'y': y})
RING = [3, 1, 0, 2]   # Norte → SEPLOG → SMTT → UPA Sul → (volta pelo leste) → Norte
BKT = xy(-37.060375, -10.928156)   # sede BK Telecom · R. Pedro Paes Mendonça (Suíssa)
for p in pops: p['node'] = nearest(p['x'], p['y'], True)

# anel pelas avenidas (penaliza arestas já usadas para formar rotas distintas)
used = set()
def w_bb(u, v, L, m):
    f = 1 if m else 4
    return L * f * (30 if (min(u, v), max(u, v)) in used else 1)
ring = []
# o retorno UPA Sul → UPA Norte passa pelo corredor leste (Av. Beira Mar / Treze de Julho), fechando o anel
WAY = {(2, 3): [nearest(*xy(-37.0465, -10.9400), True)]}
for a, b in zip(RING, RING[1:] + RING[:1]):
    stops = [pops[a]['node'], *WAY.get((a, b), []), pops[b]['node']]
    path = []
    for u0, v0 in zip(stops, stops[1:]):
        dist, par, _ = dijkstra([u0], w_bb)
        seg_ = trace(par, v0); path += seg_ if not path else seg_[1:]
    for u, v in zip(path, path[1:]): used.add((min(u, v), max(u, v)))
    ring.append({'a': a, 'b': b, 'nodes': path})

# acesso: cada ponto ao POP mais próximo pela malha viária
src = [p['node'] for p in pops]
dist, par, root = dijkstra(src, lambda u, v, L, m: L * (1 if m else 1.15))
popOf = {p['node']: i for i, p in enumerate(pops)}
for p in pts:
    n = nearest(p['x'], p['y'])
    p['pop'] = popOf[root[n]]
    p['path'] = trace(par, n)
# splitters: nós onde a árvore de cada POP se divide (com ≥ 2 unidades em pelo menos 2 ramos)
splitters = []
for i in range(len(pops)):
    tree = {}
    for p in pts:
        if p['pop'] != i or p['ded']: continue
        for u, v in zip(p['path'], p['path'][1:]): tree.setdefault(u, set()).add(v)
    cnt = {}
    for p in pts:
        if p['pop'] != i or p['ded']: continue
        for u in p['path']: cnt[u] = cnt.get(u, 0) + 1
    for u, ch in tree.items():
        big = [c for c in ch if cnt.get(c, 0) >= 2]
        if len(ch) >= 2 and len(big) >= 1 and cnt[u] >= 3 and u != pops[i]['node']:
            splitters.append({'pop': i, 'node': u, 'n': cnt[u]})
# poda: mantém splitters não muito próximos
keep = []
for s in sorted(splitters, key=lambda s: -s['n']):
    if all(math.dist(coords[s['node']], coords[k['node']]) > 450 for k in keep): keep.append(s)
splitters = keep
for s_ in splitters: s_['units'] = [k for k, p in enumerate(pts) if not p['ded'] and s_['node'] in p['path']]

# ---------------- saída em tela ----------------
def scr(nodes_, tol=0.7):
    P = [G.S(*coords[n]) for n in nodes_]
    if len(P) > 2: P = list(LineString(P).simplify(tol).coords)
    return P
def dstr(P): return 'M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in P)
def plen(P): return sum(math.dist(a, b) for a, b in zip(P, P[1:]))
out = {'pops': [], 'ring': [], 'points': [], 'splitters': []}
for p in pops:
    sx, sy = G.S(p['x'], p['y']); out['pops'].append({'name': p['name'], 'site': p['site'], 'x': round(sx, 1), 'y': round(sy, 1)})
for r in ring:
    P = scr(r['nodes']); m = LineString(P).interpolate(0.5, normalized=True)
    out['ring'].append({'a': r['a'], 'b': r['b'], 'd': dstr(P), 'len': round(plen(P)), 'spur': False, 'mx': round(m.x, 1), 'my': round(m.y, 1)})
for p in pts:
    P = scr(p['path'][::-1] if False else p['path'])   # do POP até a unidade
    sx, sy = G.S(p['x'], p['y'])
    if math.dist(P[-1], (sx, sy)) > 0.5: P.append((sx, sy))
    h = int(hashlib.md5(p['name'].encode()).hexdigest(), 16)
    out['points'].append({'name': p['name'], 'cat': p['cat'], 'kind': p['kind'], 'ded': p['ded'], 'pop': p['pop'], 'x': round(sx, 1), 'y': round(sy, 1),
                          'd': dstr(P), 'len': round(plen(P)), 'prov': h % 4, 'osm': p['osm'],
                          'atPop': min(math.dist((p['x'], p['y']), (q['x'], q['y'])) for q in pops) < 60})
for s in splitters:
    if not TILE.buffer(-150).contains(Point(*coords[s['node']])): continue
    sx, sy = G.S(*coords[s['node']]); out['splitters'].append({'pop': s['pop'], 'x': round(sx, 1), 'y': round(sy, 1)})
inside = [s_ for s_ in splitters if TILE.buffer(-150).contains(Point(*coords[s_['node']])) and 4 <= len(s_['units']) <= 8]
cut = sorted(inside, key=lambda s_: len(s_['units']))[len(inside) // 2]
cs = G.S(*coords[cut['node']])
out['cut'] = {'x': round(cs[0], 1), 'y': round(cs[1], 1), 'pop': cut['pop'], 'units': cut['units'],
              'd': [dstr(scr(pts[k]['path'][pts[k]['path'].index(cut['node']):]) + [G.S(pts[k]['x'], pts[k]['y'])]) for k in cut['units']]}
bs = G.S(*BKT); out['bkt'] = [round(bs[0], 1), round(bs[1], 1)]
out['proj'] = {'phi': 62, 'sq': G.SQ, 'sc': G.SC, 'ox': G.OX, 'oy': G.OY, 'lat0': LAT0, 'kx': KX, 'ky': KY}
json.dump(out, open('net.json', 'w'), ensure_ascii=False)
print('pops', [(p['name'], p['site']) for p in out['pops']])
print('ring', [r['len'] for r in out['ring']], 'points', len(out['points']), 'splitters', len(out['splitters']))
print('per pop', [sum(1 for p in out['points'] if p['pop'] == i) for i in range(len(pops))])
