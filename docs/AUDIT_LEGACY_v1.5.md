# Fase 0 — Auditoria do legado BKT RevOps v1.5

**Data:** 2026-10-17 · **Fonte:** `isp-sprint-v1.5_1.zip` (10 arquivos, ~50 KB, 294 linhas, código minificado em linha única) · **Veredito:** legado experimental. **Nenhum código será reaproveitado diretamente**; reaproveitamos conhecimento de produto (roteiros, objeções, estratégias, salvaguardas do adaptador IXC) e criamos um migrador de dados que trata o legado como fonte **não verificada**.

## 1. Inventário

| Arquivo | Papel | Observação |
|---|---|---|
| `server.js` | HTTP puro (`node:http`), roteamento por `if` | 15 rotas, sem framework |
| `store.js` | SQLite (`node:sqlite`, experimental) | `opportunities`, `activity`, `sync_runs` |
| `intelligence.js` | Clientes/custos/eventos em `intelligence.json` | Read-modify-write sem lock |
| `engine.js` | Motor de recomendação determinístico | Sem versão, sem testes |
| `ixc.js` | Adaptador IXC `demo`/`live` | Boas salvaguardas, caminhos não verificados |
| `index.html` | Tela de atendimento (5 etapas) + painel de inteligência | JS inline, estado só em memória |
| `gestao.html` | Lista de oportunidades e indicadores | JS inline |
| `README.md`, `Dockerfile`, `package.json` | Documentação/execução | Node ≥ 22.13 |

### Rotas existentes

| Método | Rota | Função |
|---|---|---|
| GET | `/`, `/index.html`, `/gestao.html` | Páginas estáticas |
| GET/POST | `/api/leads` | Lista todos / grava lead (JSON **e** SQLite) |
| GET/POST | `/api/opportunities`, GET `/api/opportunities/:id` | Lista com filtro / histórico |
| GET | `/api/management/overview`, `/api/management/sync-runs` | Indicadores / execuções de sync |
| POST | `/api/engine/recommend` | Motor de regras |
| GET | `/api/ixc/status`; POST `/api/ixc/{coverage,plans,contract}` | Adaptador IXC |
| GET | `/api/intelligence/summary`, `/api/intelligence/history/:ixcId` | CAC/LTV indicativo, histórico |
| POST | `/api/intelligence/import`, `/api/intelligence/cost` | Importação de clientes e custos |

## 2. Funcionalidades reais (o que de fato funciona)

- Jornada de 5 etapas com motivos neutros (não pressupõe dor), prioridades, falas sugeridas e cronômetro.
- Motor determinístico com estratégia, pergunta, argumento, tratamento de objeção e pendências.
- Registro de desfechos: aceite pendente, retorno, oportunidade futura; aceite exige cobertura marcada como confirmada **na interface**.
- Persistência em SQLite com trilha de mudança de status (`activity`).
- Importação JSON de clientes com eventos de diff por `ixcId`; custos por mês/canal.
- Adaptador IXC que nunca confirma contratação, exige HTTPS e mesma origem, com timeout de 10 s.

## 3. Achados de segurança e integridade (por severidade)

### Críticos
1. **Sem autenticação por padrão.** `APP_TOKEN` é opcional e compartilhado; sem ele, toda a API (inclusive `GET /api/leads` com telefone e endereço) é pública. Token guardado via `prompt()` em `sessionStorage`.
2. **Contrato confirmado forjável pela API.** `POST /api/leads` aceita `status` livre; enviar `"Contratação confirmada"` faz o registro contar como contrato no `overview` e nos indicadores, **violando a regra "contrato só após confirmação externa"**. A restrição existe só no frontend.
3. **XSS armazenado.** O `id` do lead é definido pelo cliente (`d.id || uuid`). Em `index.html` ele é interpolado sem escape em `onclick="openLead('${x.id}')"`; em `gestao.html`, `encodeURIComponent` não escapa aspas simples. Um `id` malicioso executa script no navegador de quem abrir a fila.
4. **Sobrescrita arbitrária.** Qualquer chamador que conheça (ou chute) um `id` reescreve o registro; `createdAt` também vem do cliente.

### Altos
5. **Escrita dupla não transacional** (JSON + SQLite) em `POST /api/leads`: falha entre as duas gera divergência sem reconciliação.
6. **Auditoria forjável:** `actor` da trilha é `d.seller`, enviado pelo cliente.
7. **Sem multiempresa, usuários, RBAC, rate limit ou CSRF.** CSP permite `unsafe-inline`.
8. **Perda de dados no atendimento:** estado só em memória; refresh apaga o atendimento e **zera o cronômetro**.
9. **`intelligence.json` com read-modify-write sem lock:** importações/custos concorrentes perdem atualizações.
10. **Histórico incompleto:** a importação ignora campos que ficam vazios (ex.: `cancelledAt` removido numa reativação não gera evento); só existe o relógio de ingestão, sem `occurred_at`.
11. **CSV sem proteção contra formula injection** (valores iniciados por `=`, `+`, `-`, `@`).

### Métricas (corretude)
12. **CAC** = todo o custo já registrado ÷ todos os clientes com `acquiredAt` (sem janela/coorte); se não houver, cai para contagem de leads "confirmados" — mistura fontes.
13. **Segmentos/ICP** só sobre clientes adquiridos (viés de sobrevivência); retenção por `status.includes('ativ')`.
14. **Conversão** = confirmados ÷ total de leads de qualquer período, sem coorte.
15. Dinheiro em `float`; valores inválidos viram 0 silenciosamente (`safeNum`).

### Menores
16. `sync_runs`: funções criadas e importadas, **nunca chamadas**.
17. `GET /api/opportunities/:id` responde 200 com `{error}` quando não encontra.
18. Status único em texto livre misturando etapa, proposta, contrato e cobertura.
19. Cobertura é autodeclarada pelo vendedor (select "Sim, confirmada").
20. `node:sqlite` experimental; mensagens de erro internas devolvidas ao cliente.

## 4. Decisão de reaproveitamento

| Item do legado | Decisão |
|---|---|
| Código de servidor, store, frontend | **Descartar.** Reescrita na stack nova (ver `DECISIONS.md`). |
| Textos de perguntas por motivo, prioridades, falas de objeção, estratégias do `engine.js` | **Portar como conteúdo** para tabelas de regras versionadas do playbook (Fase 2), com testes. |
| Salvaguardas do `ixc.js` (HTTPS, mesma origem, timeout, nunca auto-confirmar, retorno "não verificado") | **Manter o princípio** no `ixc-adapter` (Fase 4). Caminhos `IXC_*_PATH` continuam não verificados. |
| Semântica "Proposta aceita — validação pendente" ≠ contrato | **Manter**, agora imposta no servidor por estados separados. |
| Dados (`leads.json`, `sprint.sqlite`, `intelligence.json`) | **Migrar via importador** (Fase 3), ver abaixo. |

## 5. Plano de migração de dados (Fase 3)

1. Exportar os três arquivos do volume `/app/data` do legado (somente leitura).
2. Importar pelo wizard com `source_system = 'legacy_v1.5'`, dry-run obrigatório e relatório por linha.
3. Unificar `leads.json` e `opportunities` por `id`; em divergência, prevalece o `updated_at` mais recente e o conflito fica registrado.
4. **Mapeamento de status** (o legado nunca teve prova externa):
   - `Em atendimento` → etapa `descoberta`
   - `Proposta aceita — validação pendente` → etapa `negociacao`, proposta `aceita`
   - `Retorno agendado` → etapa `retorno` + atividade de retorno em `follow_up_at`
   - `Oportunidade futura` → etapa `retorno`, motivo "oportunidade futura"
   - `Perdida` → etapa `perdida`
   - `Contratação confirmada` → etapa `negociacao`, proposta `aceita`, **pedido de contrato `pendente` com marcação `legado_nao_verificado`** — não entra em "contratos confirmados" até conciliação com o IXC.
5. `activity` vira `opportunity_events` com `actor = 'legado (não verificado)'`.
6. Clientes e eventos de `intelligence.json` viram `customers` + eventos com `observed_at` = data do evento legado e `occurred_at` desconhecido. Custos viram `acquisition_costs` em centavos.
7. IDs legados guardados em `customer_external_ids`/`external_id`; reimportação idempotente.

## 6. Riscos remanescentes

- Dados reais já gravados no legado podem conter XSS em `id`/campos: o novo frontend renderiza tudo como texto (React), e o importador rejeita IDs fora do padrão.
- Se o legado esteve exposto sem `APP_TOKEN`, tratar os dados como potencialmente adulterados.
