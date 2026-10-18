# Progresso e pendências

Atualizado em 2026-10-18. Leia junto com `DECISIONS.md` e `AUDIT_LEGACY_v1.5.md` ao retomar.

## Fase 0 — Auditoria ✅
- Legado v1.5 auditado (`AUDIT_LEGACY_v1.5.md`): 4 achados críticos (API aberta sem token, contrato confirmado forjável, XSS armazenado via `id`, sobrescrita arbitrária). Decisão: reescrever; portar só conteúdo de playbook e salvaguardas do adaptador IXC; migrar dados como `legacy_v1.5` não verificado (Fase 3).

## Fase 1 — Fundação CRM ✅

### Implementado
- **Monorepo** pnpm: `apps/api`, `apps/web`, `packages/domain`, `packages/shared`.
- **Banco**: 21 tabelas com `tenant_id`, `row_version`, CHECKs de estados, índices por tenant; migration custom com triggers append-only em `opportunity_events`, `activity_events`, `audit_logs`. Seed determinística e fictícia com 2 empresas.
- **Auth/RBAC/tenant**: sessão em cookie assinado, scrypt, lockout, rate limit no login, CSRF por Origin, 6 papéis padrão e 31 permissões; toda rota declara política (rota sem política impede o boot).
- **API /api/v1** (20 rotas, OpenAPI gerado dos schemas): `me`, `auth/login|logout`, `meta/lookups`, `audit`, `dashboard`, `leads` (lista/detalhe/criar/editar/atribuir em massa/converter), `opportunities` (lista/criar/detalhe/editar/transição/timeline), `pipeline`, `activities` (lista/criar idempotente/editar), `contacts` (busca/criar/ficha), `customers`. Erros `application/problem+json` com `requestId`.
- **Web**: AppShell com sidebar recolhível e menu por permissão, busca global (`/`), CTA “Nova oportunidade” (`N`), sino de vencidas, tema claro/escuro; Dashboard com KPIs que declaram fórmula, fonte e tipo (período × posição atual) e fila de próximas ações; Leads (filtros na URL, colunas configuráveis, seleção e atribuição em massa com confirmação, temperatura explicada, SLA, conversão); Pipeline Kanban (arrastar com mouse ou teclado, menu “Mover para” como alternativa, UI otimista com rollback, confirmação para ganhar/perder/reabrir); Oportunidades em tabela (alterna com Kanban mantendo filtros); **workspace Sprint** (criação mínima, régua de 7 min que não para, 3 painéis ≥1280 / 2 + gaveta 900–1279 / abas ≤899, autosave com debounce, rascunho local recuperado após refresh, flush ao sair, banner de conflito 409, pendências por regra fixa); Clientes e ficha (aviso de dados desatualizados, abas futuras sem dados inventados); Atividades (minhas/equipe, vencidas/hoje, concluir em um clique); Configurações (leitura + auditoria).

### Testes executados (2026-10-17, todos passando)
| Suíte | Resultado |
|---|---|
| `packages/domain` (Vitest) | 15/15 |
| `apps/web` (Vitest) | 5/5 |
| `apps/api` integração com Postgres real | 28/28 — auth, lockout, 429, CSRF, isolamento entre empresas (ler/editar/mover/vincular), RBAC, máscara de PII, 409, regras de ganha/perdida/reabrir, ganha não conta contrato, append-only, idempotência de atividade e conversão, OpenAPI |
| E2E Playwright (Chromium 1194 local) | 14/14 — login, redirect, atalhos, autosave + refresh sem zerar tempo, ganha ≠ contrato, mover pelo menu, conflito entre abas, isolamento por URL, menus por papel, lead→oportunidade, retorno sem duplicar, sem overflow horizontal em 390/768/1280 |
| `typecheck` e `build` dos 4 pacotes | OK |

### Limitações conhecidas (não verificado ou não feito)
- Docker não estava disponível nesta sessão: o `docker-compose.yml` foi escrito mas **não executado**; os testes usaram Postgres 16 local com as mesmas credenciais.
- Sem lint (ESLint) configurado ainda.
- Cronômetro: usa `sprint_started_at` da criação; pausa/retomada e acúmulo de sessões (`sprint_elapsed_seconds`) entram na Fase 2. Uma oportunidade reaberta depois de 12 h mostra só o tempo registrado.
- Paginação por offset nas tabelas (adequada a milhares de linhas; cursor quando houver volume maior).
- “Vistas salvas” = filtros na URL (link compartilhável); vistas nomeadas no servidor pendentes.
- Exportação CSV ainda não exposta na UI (`csvSafe` já existe e é testado).
- Fonte IBM Plex via Google Fonts; sem rede cai para a fonte do sistema.
- E-mail de login é único globalmente (usuário multiempresa adiado).

## Fase 1.5 — Telas Yepnet + níveis de segurança ✅ (2026-10-17)

### Implementado
- **8 telas refeitas fiéis aos designs Yepnet** (paleta navy/lime, Plus Jakarta Sans, mascote com balão fixo): Início (KPIs, destaque “Uma venda mais fácil…”, Meta do mês, atividades de hoje, pipeline, Meu desempenho, recentes), Leads (abas, KPIs, Kanban/Lista, filtros, ações em massa), Oportunidades (5 KPIs, Kanban por etapa com valor, menu “mover”), Clientes (KPIs, filtros, seleção + CSV), Atividades (abas por tipo, agenda por dia, calendário do mês, próximas, resumo da semana), Relatórios (período, evolução, origem, status, vendas por plano, desempenho da equipe, últimas vendas, exportar CSV), Inteligência (desempenho comercial, origem, conversão por etapa, vendas por plano, mapa de calor de Sergipe com malha do IBGE, atividades da equipe, insights), Administração (visão geral, usuários e times, planos, etapas, origens, integrações, notificações, **Segurança**, **Personalização**, logs).
- Workspace Sprint, Nova oportunidade, ficha do cliente, Meu perfil (foto, senha) e login no visual novo.
- **Matriz de segurança editável** (ADR-016/017) aplicada no servidor em todas as rotas.
- Catálogo de planos (ADR-018), funil Yepnet (ADR-019), Personalização com 12 espaços de imagem (ADR-020).
- Seed fictícia Yepnet (5 usuários, 3 times, ~150 leads, ~100 oportunidades, ~300 clientes `seed_ficticio`).

### Corrigido durante a verificação
- Ranking de vendas e “Atividades da equipe” mostravam 0 para todos: a subconsulta por usuário saía sem qualificar a coluna (`"id"` ligava à tabela errada). Agora usa `"users"."id"`; há teste que compara a soma por pessoa com o total.
- Rolagem horizontal em 390 px (tabela acessível dos gráficos) e cartões de KPI cortando valores.

### Testes executados (2026-10-17, todos passando)
| Suíte | Resultado |
|---|---|
| `packages/domain` | 17/17 |
| `apps/api` integração (Postgres real) | 42/42 — inclui níveis Próprio/Equipe/Total, supervisora não vê time que não lidera, mudança na matriz vale na hora e vai para o log, trava da Gerência em Configurações, imagens (PNG ok, SVG recusado, só gerência envia), plano define valor, ranking oculto para vendedor, CSV no escopo |
| E2E Playwright | 17/17 — menus por nível, matriz → efeito imediato, upload de imagem, autosave, plano/valor, venda fechada ≠ contrato, mover/perder, conflito, isolamento por time e por empresa, lead → oportunidade, retorno sem duplicar, sem rolagem horizontal em 390/768/1280/1440 |
| `typecheck` e `build` | OK |

### Limitações conhecidas
- Nenhuma imagem da marca vem no código: até a gerência enviar em Personalização, mascotes, banner e card ficam vazios e a logo aparece em texto.
- Fidelidade conferida por captura de tela a 1440 px contra os designs; ajustes finos de pixel podem pedir mais uma rodada com o cliente.
- Integrações e Notificações são telas honestas de “não conectado”; Campanhas é só lista de rótulos.
- “Meta do mês” da gerência/supervisão soma as metas das pessoas visíveis.

## Fase 2a — Jornadas, viabilidade, instrução e e-mail ✅ (2026-10-18)

### Implementado
- **Telas em largura total.**
- **Cadastro da oportunidade** com os campos pedidos: nome do deal, cliente (novo ou da carteira), telefone, e-mail, endereço (CEP com ViaCEP, logradouro, condomínio, bloco, apartamento), tipo do deal (Residencial/Corporativo), canal de entrada, responsável, jornada, plano, tipo de venda (ativa/receptiva), metragem de cabo, taxa de ativação e campos personalizados da jornada; prévia da viabilidade ao vivo.
- **Workspace**: autosave dos novos campos, troca de jornada, etapa pelas etapas da jornada com exigências, painel de viabilidade (comissão, CAC, margem, payback, LTV desta venda × histórico, alertas), roteiro do Sprint com respostas, objeções, abas Atividades/Anexos/Histórico, enviar proposta e follow-up por e-mail.
- **Oportunidades**: abas por jornada, colunas e cores dinâmicas. **Relatórios**: status por jornada e aba Comissões (detalhe e CSV, escopo pelo nível).
- **Configurações**: Jornadas e automações (criar funil, etapas, exigências, membros, campos, automações, execuções), Área de atendimento, Viabilidade (tributos, parceiros, equipamentos, caminhos com kit, regras de metragem/banda, comissão, LTV, simulador), Modelo de instrução (exportar, enviar, prévia, ativar, versões), E-mail e alertas (SMTP com teste, alertas liga/desliga, registro), plano com velocidade (Mbps), Canais de entrada.
- **Agendamento** Vercel Cron diário (`/api/v1/cron/alerts`, exige `CRON_SECRET`).
- Migrations 0004 e 0005 (aplicadas no deploy de produção; jornada “residencial” criada para dados existentes).

### Testes executados (2026-10-18, todos passando)
| Suíte | Resultado |
|---|---|
| `packages/domain` | 24/24 (inclui 7 de viabilidade) |
| `apps/api` integração | 42/42 (ajustados às exigências de etapa: venda fechada exige plano) |
| E2E Playwright | 19/19 — os 17 anteriores + cadastro com condomínio/metragem/venda ativa mostrando comissão, CAC e LTV; telas novas de Configurações abrem para a gerência e são bloqueadas para o vendedor |
| `typecheck` e `build` | OK |

### Limitações conhecidas
- Testes de API específicos para automações, anexos, SMTP (com servidor falso) e upload de instrução ainda não escritos; o caminho foi conferido manualmente (duplicar na perda gerou cópia na Recuperação com registro em `automation_runs`).
- Sem `CRON_SECRET`, o resumo diário e o gatilho “parada há X dias” não rodam.
- LTV histórico conta clientes ativos até hoje: tende a subestimar a vida média.
- Equipamentos por oportunidade usam o kit do caminho; a troca manual existe na API, sem tela ainda.

## Próxima etapa — Fase 2b (Sprint completo)
1. Tabelas `playbooks`, `playbook_versions`, `opportunity_answers`, `recommendations`, `offers`/`plans`/`plan_versions` (catálogo), `coverage_checks`, `proposals`, `objections`.
2. Motor determinístico versionado em `packages/playbook` com testes por cenário; portar perguntas e objeções do `engine.js` legado.
3. Ramo “interesse em oferta” completo (perguntas condicionais, comparação “situação atual × proposta” com origem de cada dado, objeções, desfechos).
4. Cobertura via adaptador mock rotulado; proposta com validade; pedido de contratação só com aceite registrado.
5. Cronômetro com sessões, pausa e retomada.
6. E2E da jornada “oferta” do cenário de aceite da spec §14.

## Backlog posterior
- Fase 3: wizard CSV/JSON com dry-run, snapshots SCD2, migração do legado v1.5.
- Fase 4: matriz de endpoints IXC verificados na documentação e na instância; conector mock/sandbox/live.
- Fase 5: custos, atribuição versionada, CAC/LTV/churn/ICP com amostra e incerteza.
- Fase 6: contratação IXC idempotente e reconciliada.
- Fase 7: MFA, RLS no Postgres, backups testados, observabilidade, CI/CD, mapa LGPD por categoria.
