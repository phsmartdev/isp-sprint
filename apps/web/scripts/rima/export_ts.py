import json
import build_geo as G
g=json.load(open('geo.json')); n=json.load(open('net.json'))
LBL={'Rio Sergipe':(-37.047,-10.890),'Ponte Construtor João Alves':(-37.036,-10.904),'Barra dos Coqueiros':(-37.026,-10.915),
     'Orla de Atalaia':(-37.050,-11.000),'Oceano Atlântico':(-37.010,-10.995),'Rio Poxim':(-37.073,-10.950),'Centro':(-37.0505,-10.9085)}
labels=[{'t':k,'x':round(G.ll(*v)[0],1),'y':round(G.ll(*v)[1],1)} for k,v in LBL.items()]
aju=[round(v,1) for v in G.ll(-37.112,-10.950)]
for l in labels:
    if l['t']=='Oceano Atlântico': l['x'],l['y']=1105,596
J=lambda o: json.dumps(o, ensure_ascii=False, separators=(',',':'))
out=f'''/**
 * Aracaju em perspectiva isométrica para o slide RIMA (palco 1600 × 900, coordenadas já projetadas).
 * GERADO a partir do OpenStreetMap (© colaboradores do OpenStreetMap, licença ODbL): limite municipal, rios, mangues,
 * praças, ruas e avenidas, ponte Construtor João Alves e prédios com 6+ pavimentos (altura exagerada para leitura).
 * As unidades públicas (escolas e unidades de saúde municipais, órgãos, Guarda Municipal, SMTT, EMSURB, câmeras,
 * semáforos e praças) estão nas posições do OSM. A TOPOLOGIA é conceitual: POPs em equipamentos públicos, anel
 * calculado pelo caminho mais curto nas avenidas, acesso pelas ruas até o POP mais próximo e splitters nas bifurcações.
 * Não representa infraestrutura instalada.
 */
/* eslint-disable */
export const RIMA_PROJ = {J(n['proj'])};
export const RIMA_TILE: [number, number][] = {J([[round(x,1),round(y,1)] for x,y in g['tile']])};
export const RIMA_GEO = {J({k:g[k] for k in ['neigh','aju','wet','parks','beach','water','minor','major','bridge']})};
/** prédios: [paredes visíveis, topo, pavimentos] */
export const RIMA_BLDS: [string, string, number][] = {J(g['blds'])};
export const RIMA_LABELS: {{ t: string; x: number; y: number }}[] = {J(labels)};
export const RIMA_CITY_LABEL: [number, number] = {J(aju)};
export type RimaCat = 'adm' | 'edu' | 'sau' | 'seg' | 'mob' | 'urb';
export type RimaPoint = {{ name: string; cat: RimaCat; kind: string; ded: boolean; pop: number; x: number; y: number; d: string; len: number; prov: number; osm: string }};
export const RIMA_POPS: {{ name: string; site: string; x: number; y: number }}[] = {J(n['pops'])};
/** trechos do backbone: anel (a → b) e o ramal sem redundância (spur) */
export const RIMA_RING: {{ a: number; b: number; d: string; len: number; spur: boolean; mx: number; my: number }}[] = {J(n['ring'])};
export const RIMA_POINTS: RimaPoint[] = {J(n['points'])};
export const RIMA_SPLITTERS: {{ pop: number; x: number; y: number }}[] = {J(n['splitters'])};
'''
open(__import__('os').path.join(__import__('os').path.dirname(__file__), '../../src/features/playbooks/aracajuRima.ts'),'w').write(out)
print(len(out))
