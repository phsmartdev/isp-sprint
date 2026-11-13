# Mapa do slide RIMA (Aracaju)

Gera `src/features/playbooks/aracajuRima.ts` a partir do OpenStreetMap (© colaboradores do OpenStreetMap, ODbL).

1. Baixe as camadas com a Overpass API para `raw/` (bbox `-11.06,-37.13,-10.85,-37.00`):
   `boundary` (limite de Aracaju), `neigh` (Barra dos Coqueiros, São Cristóvão, N. S. do Socorro), `water`,
   `wet` (mangue/praia), `parks`, `roads` (motorway…secondary), `minor` (tertiary/residential/unclassified),
   `bridge`, `tall` (prédios com `building:levels`) e `pois` (órgãos, escolas, saúde, polícia, semáforos, câmeras).
2. `pip install shapely numpy` e, nesta pasta: `python3 export_ts.py` (roda `build_geo` e lê `net.json`;
   rode antes `python3 build_net.py`).

A topologia (POPs, anel, acesso, splitters) é conceitual: calculada pelo caminho mais curto nas vias reais.
