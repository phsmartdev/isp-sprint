# Progresso e pendências

Atualizado em 2026-10-20. Leia junto com `DECISIONS.md` e `AUDIT_LEGACY_v1.5.md` ao retomar.

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

## ABM — Fase 3: Conta 360 ✅ (2026-10-21)
- Nova página **Conta 360** (ABM → nome da conta), sobre os registros do CRM, sem cópias. Cabeçalho com natureza, segmento, status ABM, status comercial, prioridade, classificação estratégica (a existente), responsáveis (ABM e carteira), última interação, próxima ação (tarefa pendente mais próxima ou próximo passo) e objetivo principal.
- **Objetivos por conta** (abrir relacionamento, identificar decisores, criar oportunidade, expandir contratos, preparar renovação…) com responsável, prazo, critério de sucesso e situação; encerrar exige o resultado; histórico.
- **Dados da organização** completados aos poucos no mesmo cadastro do CRM (nome, CNPJ, natureza, segmento, cidade, telefone e e-mail institucionais); CNPJ de outra conta é recusado; contas vindas de integração mantêm nome/CNPJ da origem; auditoria.
- **Estrutura organizacional** (unidades, filiais, diretorias, secretarias, departamentos, setores, equipes, órgãos relacionados) com vínculo explícito ao superior, sem ciclos, desativar sem apagar. Pertence à organização (continua valendo fora do ABM) e não se confunde com influência.
- Abas de leads e oportunidades, contratos (versão vigente), projetos e tarefas (mesmos módulos) e **histórico unificado** (estratégia ABM, interações concluídas e movimentos das oportunidades, cada fato uma vez).
- Abas de stakeholders, mapa, plays, monitoramento, relacionamentos e indicadores entram nas próximas fases.
- Migração 0043. Testes: domínio (2), API (4), E2E (1, incluindo celular).

## Números dos indicadores sempre cabem no cartão ✅ (2026-10-21)
- Componente `FitText`: o valor começa no tamanho do estilo e diminui até caber na largura do cartão — nunca quebra linha nem passa da borda, em qualquer tela (recalcula ao redimensionar, ao trocar o valor e quando a fonte carrega). Aplicado em todos os cartões de indicadores (Início, Contratos, Atas, Sucesso do Cliente, Projetos, Campanhas, Comissões, Portas, Inteligência, Gestão de Times, Produto, Aprovações, Administração).
- Atas: cartões em 3 colunas até telas grandes (5 só em telas muito largas), para os valores ficarem maiores.

## ABM — Contas Estratégicas, Fase 2: cadastro único ✅ (2026-10-21)
- Diagnóstico (Fase 1): organização = registro de Contas (`contacts`), cliente = ficha ligada ao mesmo registro; vínculos "mesmo cliente / CNPJ raiz" e classificação estratégica reaproveitados; não existe cadastro de pessoas (stakeholders) — será criado na Fase 4. ABM fica dentro de Marketing, com as telas como abas (decisão do usuário).
- **Nova conta para prospectar**: só nome e motivo obrigatórios (CNPJ, natureza, segmento, cidade opcionais). Antes de criar, mostra possíveis duplicidades (mesmo CNPJ bloqueia; mesma raiz de CNPJ, nome parecido — inclusive abreviações — e mesma cidade pedem confirmação com justificativa, registrada no histórico). "Usar esta conta" leva a adicionar a existente.
- **Adicionar ao ABM** na ficha da conta e na página do ABM, reaproveitando oportunidades, contratos, atividades e histórico (sem novo cadastro).
- **Status ABM** (Candidata → Selecionada → Em planejamento → Ativa → Em acompanhamento; Pausada/Encerrada com motivo) com transições validadas; **prioridade** Crítica/Alta/Média/Baixa; origem e objetivo principal.
- **Status comercial derivado dos dados** (identificada, em prospecção, em relacionamento, com oportunidade, cliente ativo, cliente sem contrato ativo, ex-cliente) — nunca digitado.
- Natureza pública/privada na conta (governamental marcada como pública na migração; o resto fica em branco). Status antigos do ABM convertidos.
- Migração 0042. Testes: domínio (4), API (ABM), E2E (nova conta, duplicidade, adicionar existente).

## Gestão de Times — Fase 8: rituais, atas, decisões e impedimentos ✅ (2026-10-21)
- **Rituais** (Gestão de Times → Rituais): reuniões de gestão recorrentes por perspectiva (Diretoria, Gestão, Liderança), escopo (empresa, unidade ou time), cadência (diária em dias úteis, semanal, quinzenal, mensal), horário, duração, quem conduz, participantes e pauta fixa. Modelos prontos por perspectiva. As duas próximas reuniões entram sozinhas na agenda de quem participa (atividade tipo reunião).
- **Reunião**: pauta automática do escopo — semáforo e metas fora da faixa, intervenções abertas, ações de plano atrasadas, impedimentos abertos e decisões das reuniões anteriores a acompanhar; presença, anotações por item de pauta e ata, salvando enquanto se escreve. **Encerrar a ata** fotografa a pauta, trava a edição, conclui o compromisso na agenda e avisa os participantes. Cancelar exige motivo.
- **Decisões** (na reunião, na intervenção ou avulsas no escopo): motivo, vigência, tarefa de acompanhamento opcional; revogação só com motivo, histórico mantido.
- **Impedimentos**: o que trava, quem remove, gravidade e prazo; aviso no sino para o responsável; encerrar (removido/aceito) exige dizer como; **escalar** passa para o próximo responsável acima na estrutura.
- Página **Decisões e impedimentos** com filtros, contadores (abertos, vencidos, alta gravidade, comigo) e ficha com histórico.
- Avisos no sino de Menções. Histórico append-only (`governance_events`).
- Migração 0040. Testes: domínio (5), API (5), E2E (1).

## Gestão de Times — intervenção aberta manualmente ✅ (2026-10-21)
- Botão **"Nova intervenção"** em Gestão de Times → Intervenções: escolhe o **indicador** (opcional), descreve o problema ou oportunidade e o motivo, define sobre quem (pessoa, time, unidade ou empresa — esta só pela Diretoria), o responsável e o prazo do plano.
- Mesmo roteiro das automáticas: análise de causa obrigatória, plano 5W2H com tarefas, conclusão, escalonamento por atraso e avisos. A ficha mostra a evolução do indicador nos últimos 6 meses no escopo escolhido.
- Não depende de meta fora da faixa nem é dispensada pela sincronização; quem abriu também pode conduzir.
- Migração 0041 (meta e série passam a ser opcionais; `title`, `reason`, `indicator_id`, `created_by`). Testes: API (2) e E2E.

## Gestão de Times — Fase 7: plano 5W2H integrado a tarefas e projetos ✅ (2026-10-21)
- O plano de ação passa a ser uma lista de **ações 5W2H** (o quê, por quê — com as causas raiz da análise como sugestão —, onde, quando, quem, como, quanto custa).
- **Cada ação nasce como tarefa** para quem executa (prioridade alta, categoria "Plano de ação", com as sete respostas na descrição; o responsável pela intervenção entra como participante). Quem executa recebe o aviso de tarefa no sino. Quem/quando/situação vêm da tarefa — fonte única.
- **Projeto opcional:** ligar um projeto existente ou criar um a partir do plano; as novas ações entram como tarefas do projeto (na primeira etapa aberta do quadro).
- Registrar o plano exige ≥1 ação; o prazo do plano é o informado ou o da última ação. **Concluir a intervenção exige todas as ações concluídas ou canceladas** (cancelar exige motivo e cancela a tarefa; ação já executada não cancela) e pelo menos uma executada.
- Ficha mostra andamento (barra), ações atrasadas e custo previsto total.
- Migração 0039 (`intervention_actions`, `interventions.project_id`). Testes: domínio (3), API (3 novos + ajustes das Fases 5 e 6), E2E com ação 5W2H.

## Gestão de Times — Fase 6: jornada de análise ✅ (2026-10-21)
- Cada intervenção tem uma **análise de causa** em cinco etapas, numa página própria (Intervenções → ficha → Análise): **Problema** (o quê, onde, quando, quanto) → **Pareto** (gráfico com acumulado e corte de 80%; à mão ou com as negociações perdidas do período da meta por motivo, em quantidade ou valor) → **Ishikawa** (espinha com 6 categorias adaptadas ao comercial: Método, Pessoas, Ferramentas, Oferta, Medição, Mercado; marca as causas a investigar) → **5 Porquês** (mínimo de 3 por causa escolhida, causa raiz e evidência) → **Conclusão** (diagnóstico montado das etapas, editável).
- Pendências por etapa aparecem nas abas; só conclui com tudo resolvido. Salva sozinho enquanto a pessoa escreve (com controle de versão contra edição simultânea).
- **Plano de ação só depois da análise concluída** (configurável em Configuração → Desempenho → Indicadores); o diagnóstico da análise já entra no plano. Análise concluída fica travada; reabrir exige motivo e fica no histórico.
- Quem conduz: o responsável pela intervenção ou quem está acima dele; o avaliado acompanha em modo leitura.
- Migração 0038 (`intervention_analyses`). Testes: domínio (5), API (3 + ajuste da Fase 5), E2E percorrendo a jornada inteira.

## Gestão de Times — Fase 5: intervenções ✅ (2026-10-21)
- Regras pela **apuração oficial** (versão vigente de cada competência): vermelho → plano de ação obrigatório; dois amarelos em competências seguidas → plano obrigatório; primeiro amarelo → revisão simplificada (causa provável + decisão de manter ou abrir plano).
- **Sem duplicidade:** uma intervenção aberta por série de meta; nova competência ruim entra como reincidência; revisão que piora é promovida a plano; competência já tratada não reabre; retificação que tira a meta da faixa dispensa a intervenção automaticamente.
- **Responsável e escalonamento pela estrutura** (não pelo cargo): individual → líder do time; time → líder; unidade/empresa → responsável da unidade acima. Prazo vencido sobe um nível a cada N dias de atraso, até a Diretoria. Prazos configuráveis em Configuração → Desempenho → Indicadores.
- Quem é avaliado acompanha, mas não registra nem dispensa; dispensar exige alguém acima do responsável, com justificativa.
- **Avisos no sino de Menções** (abertura, promoção, reincidência, escalonamento, plano, conclusão); faixa "Intervenções necessárias" na Visão geral; página Gestão de Times → Intervenções com resumo, filtros e ficha (apurações da série, cadeia, plano, histórico).
- Rotina diária recalcula; validação/retificação recalcula a série na hora; telas recalculam se a última execução tiver mais de 1 minuto.
- Migração 0037 (`interventions`, `intervention_events` append-only, `intervention_reads`). Testes: domínio (5), API (4), E2E (1).
- Próximas fases ligam a intervenção à jornada de análise (Fase 6) e ao 5W2H com tarefas e projetos (Fase 7); por ora o plano é texto com prazo.

## Menu reorganizado, Gestão de Times, ABM e Produto ✅ (2026-10-21)
- Menu lateral em grupos (sem números): Início · Comercial (Oportunidades, Contas, Aprovações, Atividades) · Gestão de Contratos · Sucesso do Cliente · Marketing (Leads, ABM, Plays/Campanhas) · Produto · Gestão de Times (Visão geral, Objetivos e metas) · Projetos (Projetos, Tarefas) · Relatórios · Inteligência · Configuração. Grupo recolhido mostra a soma dos contadores; abre sozinho quando a página atual está dentro dele; o estado fica no navegador.
- "Gestão de Resultados" passa a se chamar **Gestão de Times** (rota `/times`; `/resultados` redireciona). "Clientes" passa a **Contas** nas telas.
- **ABM** (Marketing): contas-alvo escolhidas entre as contas existentes (clientes e prospects) com tier 1:1 / 1:poucos / 1:muitos, situação, prioridade, responsável, motivo, próximo passo e prazo; mostra oportunidades abertas, pendências e último contato; ficha com oportunidades, tarefas/projetos ligados e histórico (`abm_accounts`, `abm_events` append-only). Escopo segue o nível do módulo Contas.
- **Produto**: catálogo de planos e produtos para consulta de toda a equipe (`GET /catalog/plans`, sem custos de parceiro nem comissão); quem administra tem atalho para editar o catálogo.
- Migração 0036. Testes: API `abm.test.ts`; E2E do menu agrupado, ABM e Produto.

## Gestão de Times (ex-Gestão de Resultados) — Fases 3–4: planejamento e apuração oficial ✅ (2026-10-21)
- Metas também por **área/unidade**; desdobramento empresa → área → equipe → pessoa.
- Metas da empresa e de área nascem **propostas** e são aprovadas pela instância acima (Diretoria / unidade superior); quem propõe não aprova; proposta não é apurada nem gera intervenção.
- **Pedido de revisão** para quem não tem alçada (justificativa ≥ 10 caracteres); a liderança acima decide; aprovado vira nova versão e o alvo original fica guardado. Um pedido pendente por meta.
- **Metas mensais recorrentes** formam uma série (competências consecutivas): a rotina diária cria a meta do mês, sem duplicar.
- **Apuração oficial versionada e imutável** por competência: v1 consolidado (fechamento automático), validado (gestor confirma) e retificado (recalcula pela origem ou valor informado, com motivo). Quem é avaliado não valida nem retifica o próprio resultado. Parcial nunca vira fechamento; sem dado de origem não recebe cor.
- **Qualidade dos dados** no fechamento (ok, amostra pequena, sem dado, manual) e botão "Conferir dados de origem" (avisa se mudaram depois do fechamento, sem alterar nada).
- Histórico da série com **tendência** (melhorando/piorando/estável), **variação** contra o mês anterior e todas as versões.
- Aba **Aprovações e revisões** em Objetivos e metas.
- Migração 0035. Testes: domínio 92, API 165, E2E 43.

## Gestão de Times (ex-Gestão de Resultados) — Fase 2: estrutura, escopos e perspectivas ✅ (2026-10-21)
- Menu **GESTÃO DE RESULTADOS** (módulo `resultados` na matriz: Próprio/Equipe/Total).
- **Estrutura organizacional configurável**: diretoria → área → unidade → times; responsável, substituto e alçada (R$) por unidade; líder substituto por time; sem ciclos; histórico append-only.
- **Perspectiva por responsabilidade explícita, não por cargo**: responsável/substituto de diretoria → Diretoria; de área/unidade → Gestão; líder/substituto de time → Liderança. Nível Total na matriz vê as três. Escopo = unidades sob responsabilidade (com as filhas) + times liderados.
- Tela com as três perspectivas (pergunta central de cada uma), filtro por unidade/time, semáforo das metas do período e lista com atingimento e ritmo.
- Configuração → **Gestão de Times**: árvore da estrutura, vínculo dos times, substitutos e alçadas.
- Migração 0034. Testes: domínio 90, API 160, E2E 42.

## Evolução integrada — Etapa 6: Indicadores, objetivos, metas e scorecards ✅ (2026-10-21)
- **Construtor de indicadores** (Configurações → Gestão de desempenho → Indicadores e semáforo): contagem, soma, média, percentual, taxa, tempo, valor, razão e fórmula. Origem nos eventos de negócio válidos; filtros e campos de lista fechada; crédito ponderado (uma venda dividida 50/50 conta 0,5 para cada e 1 para a equipe). Fórmula com interpretador próprio (números, variáveis declaradas, + − × ÷, parênteses, min/max/abs/round) — nenhum código é executado. Definição versionada; botão "Testar". 12 sugestões prontas.
- Resultado nunca inventado: sem nenhum evento do tipo → **indisponível**; denominador zero → **sem base**; amostra abaixo do mínimo → **incompleto**. Detalhamento até os eventos com o peso de cada um.
- **Semáforo configurável** (padrão verde ≥ 90%, amarelo ≥ 85%); "menor é melhor" com cálculo próprio; período aberto colorido pelo ritmo e marcado como parcial — só o fechamento é oficial.
- **Objetivos** estratégicos, táticos e operacionais encadeados (estratégico só com visão total), com patrocinador e prioridade.
- **Metas** individuais, de equipe e da empresa; semanal, mensal, trimestral, anual ou personalizada; por indicador (automática) ou manual com apontamentos; **desdobramento em cascata** com peso e consolidação (recalcular pelo indicador, soma, média ponderada, média simples, não agregável); ritmo (esperado até hoje); fechamento do período gravado e imutável.
- **Governança**: depois do início, mudar o alvo exige motivo, não pode ser feito pela própria pessoa, gera nova versão e preserva o alvo original; histórico append-only.
- **Scorecards por função** (perfil, cargo ou equipe): indicadores, pesos normalizados, meta (da pessoa → do scorecard → padrão), teto por indicador; indicador sem dado sai da nota com pesos redistribuídos; composição explícita para quem tem mais de uma função; versionado.
- Tela **Objetivos e metas** (menu) com árvore de metas, desdobrar, revisão e objetivos.
- Migração 0033. Testes: domínio 90, API 158, E2E 41.

## Evolução integrada — Etapa 5: Motor de eventos de negócio ✅ (2026-10-21)
- Novo módulo **Desempenho** (`desempenho`) na matriz: Próprio vê os eventos em que tem crédito; Equipe, os do time que lidera; Total, todos.
- 17 eventos derivados das tabelas de origem por um **projetor idempotente** (chave tipo + registro + instante): lead qualificado, oportunidade criada, proposta enviada (1 por oportunidade), negociação ganha/perdida, aprovação concluída, venda validada, contrato assinado, contrato renovado, processo de contrato concluído, movimentação e adesão de ata, tarefa concluída, entrega aprovada, marco atingido, projeto concluído e acompanhamento de cliente com resultado.
- Cada evento: ID, tipo, módulo, registro de origem, responsável, participantes, time, ocorrência, registro, resultado, valor, validação, contexto (no prazo, criada pela própria pessoa, minutos até concluir…) e histórico de validação.
- **Origem desfeita invalida o evento** automaticamente (reabrir oportunidade, tarefa, marco ou projeto), com motivo; acontecendo de novo, nasce outro evento.
- **Atribuição versionada** por tipo: parte do responsável (o restante dividido entre participantes; créditos de resultado somam sempre 100% — sem dupla contagem), reconhecimento de participação e crédito de gestão para líderes; tipos que exigem validação nascem "Aguardando validação".
- Evento é imutável no banco (só a validação muda); créditos, histórico e configuração são append-only.
- Validação manual por liderança com motivo; ninguém valida o próprio resultado.
- Carga histórica = mesmo projetor (botão "Reprocessar histórico"); roda sozinho antes das telas de desempenho e na rotina diária.
- Fatos sem fonte confiável (cliente reativado, cadastro validado, pendência resolvida) aparecem como **indisponíveis**, nada estimado.
- Telas: Configurações → **Gestão de desempenho** (catálogo, regras, versões) e **Explorar eventos** (filtros, créditos, origem, validação).
- Migração 0032. Testes: domínio 80, API 150, E2E 40.

## Evolução integrada — Etapa 4: Gestão de tarefas ✅ (2026-10-21)
- **Tarefa independente do CRM**: avulsa ou vinculada a cliente, oportunidade, contrato, ata ou projeto (mesmo registro, sem duplicar). Menu "Tarefas".
- Campos: situação (A fazer, Em andamento, Aguardando terceiros com "aguardando quem", Em aprovação, Concluída, Cancelada), responsável, criador, participantes, prioridade, início, prazo, estimativa, tempo registrado, categoria, etiquetas, checklist, subtarefas (1 nível), dependências, anexos, comentários e vínculos.
- Regras: concluir exige dependências e subtarefas concluídas (vale também pela agenda e pelo quadro do projeto); ciclo de dependência recusado; entrega com aprovação vai para o aprovador (não pode ser o responsável), que aprova ou devolve com motivo; recorrência diária (opção só dias úteis), semanal (dias da semana) ou mensal, com fim opcional — concluir cria a próxima, idempotente; tempo append-only com estorno; checklist item a item sem conflito entre pessoas.
- Situação e conclusão sempre coerentes no banco (gatilho), qualquer que seja o caminho de gravação.
- Visões: **Minhas tarefas** (Hoje, Próximas, Atrasadas, Sem prazo, Aguardando terceiros, Delegadas, Concluídas, com tarefa rápida), **Equipe** (agrupar por responsável, projeto, prazo, prioridade ou situação), **Quadro** (colunas por situação, prioridade ou responsável; arrastar muda o campo), **Calendário** (dia, semana, mês) e **Lista** (ordenação, agrupamento e filtros).
- Detalhe em painel lateral com tudo; delegar, reagendar e editar com histórico.
- Avisos no ícone de Menções (sem fluxo paralelo): menção em comentário, tarefa pedida a você, entrega para aprovar e entrega devolvida. Mencionado passa a acompanhar.
- Integração com o CRM: aba **Tarefas e projetos** em cliente, oportunidade, contrato e ata — criar, vincular existente, pendências e responsáveis.
- Pendências da Etapa 3 entregues: projeto com objetivo, categoria, etiquetas, vínculo com campanha, documentos e visão **Por responsável**; cartões do projeto abrem o mesmo detalhe de tarefa.
- Modelos de tarefa (checklist, estimativa, etiquetas, categoria, aprovação).
- Migração 0031. Testes: domínio 76, API 145, E2E 39.

## Evolução integrada — Etapa 3: Projetos ✅ (2026-10-21)
- Novo módulo **Projetos e tarefas** (`projetos`) na matriz de segurança: Vendedor próprio, Supervisor equipe, Gerência total. Menu "Projetos".
- Projeto com tipo, situação (transições válidas; cancelar/reabrir com motivo), prioridade, responsável, início/prazo, descrição e vínculos com cliente, oportunidade, contrato e ata.
- Etapas do quadro configuráveis (ordem, concluída, limite por coluna; remover etapa com tarefas pede destino), marcos com data (só atingidos com as tarefas ligadas concluídas), equipe com papéis (gerente, membro, observador).
- Tarefas do projeto são **as mesmas atividades do CRM**: aparecem na agenda do responsável; concluir lá move para a etapa concluída e vice-versa. Primeira tarefa concluída tira o projeto de Planejamento.
- Visões: Quadro (arrastar e soltar, com reordenação), Lista (ordenável, concluir com um clique), Calendário mensal (tarefas e marcos), Linha do tempo (barras início→prazo, marcos e hoje), Marcos, Equipe e Histórico append-only.
- Modelos: 3 padrões (implantação corporativa, execução de ata, projeto interno) e modelos da empresa salvos a partir de um projeto (datas viram dias relativos ao início).
- Saúde do projeto (em dia, atenção, atrasado, concluído) com o motivo; progresso por tarefas.
- Aba "Projetos" na ficha do cliente, no contrato e na ata, com criação já vinculada.
- Migração 0030. Testes: domínio 71, API 138, E2E 38.

## Evolução integrada — Etapa 2: Atas (participação, datas, alteração e conversão) ✅ (2026-10-21)
- Ata nasce com gerenciador e participantes originários (CNPJ, data de ingresso, início de eficácia); órgãos editáveis com motivo e evento antes/depois; distribuição dos quantitativos por participante enquanto a ata está em rascunho.
- Adesões posteriores com data de autorização (pode ser retroativa, nunca futura) e início da execução; prazo de execução conta da autorização.
- **Alterar item**: sem movimentação, edição direta; com movimentação, vira operação `alteracao_item` (simulada, aprovada por outra pessoa, efetivada com documento). Item ganha versão e classificação; histórico de alterações por versão.
- **Conversão de saldo entre itens**: exige critério de equivalência, alerta de unidades diferentes, data de eficácia e parecer jurídico na efetivação (regra `conversionNeedsLegalOpinion`, padrão sim).
- Livro com coluna de eficácia (`effective_on`) separada da data de registro. Migração 0029. Testes: domínio 65, API 133, E2E 37.

## Sucesso do Cliente — jornada, inteligência da conta e gestão preditiva ✅ (2026-10-21)
- **Jornada automática:** contrato validado vai para o funil Sucesso do Cliente; ao entrar em *Planejamento* (configurável), nasce a jornada.
  - Onboarding, adoção e renovação.
  - Marcos com datas reais e tarefas.
  - Linha do tempo visual na ficha do cliente, no contrato e no módulo.
- **Kickoff web:** 18 slides com dados do CRM e pendências sinalizadas.
  - Editor (texto, tabela, layout, ordem, ocultar, novo slide) e versões.
  - Modelos reutilizáveis, apresentação em tela cheia, PDF e link autorizado.
  - Registro da reunião.
- **Inteligência da conta:** Tier por ACV consolidado, Score IPC (7 critérios), Classe Estratégica (independente), saúde, criticidade explicada e prioridade manual com revisão.
- **Cadência e cobertura:** políticas por criticidade, Tier, classe e outros critérios; acompanhamentos gerados sem duplicar.
  - Cobertura simples e ponderada por CSM, equipe, Tier, classe, criticidade, conta e mês.
  - Contas sem acompanhamento.
- **Alertas preventivos** (relacionamento, contrato, comercial, saúde e dados desatualizados) e contas que precisam de atenção, com motivo e ações rápidas.
- **Visão 360° da conta:** visitas com resumo obrigatório e próximos passos, pesquisas (NPS/CSAT), planos de ação e ocorrências, consumo contratual com projeção de esgotamento.
- **Minha Carteira** com prioridades de hoje.
- **Gestão:** carga × capacidade por CSM, scorecard, gamificação e contas críticas sem acompanhamento no prazo.
- **Configurações → Sucesso do Cliente:** todas as regras, versionadas.
- **Rotina diária** (cron existente): recálculo, tarefas de marcos, cadência, alertas, escalonamento e revisão do IPC.
- **Pendências externas:** faturas do IXC (inadimplência e faturado real) e o material de kickoff de referência, para alinhar a terminologia dos slides.
- **Testes:** domínio 63, API 130, E2E 37.

## Atas de registro de preços ✅ (2026-10-20)
- **Gestão de Contratos → aba Atas:** painel (registrado, contratado, reservado, saldo, adesões, consumo mensal, órgãos, limites), lista, nova ata, relatórios e regras legais versionadas.
- **Ficha da ata:**
  - Itens e saldos por item e órgão.
  - Importação de planilha (.xlsx/.csv) com mapeamento automático, modelos salvos, prévia validada e aplicação tudo-ou-nada.
  - Oportunidades: criar, vincular, ajustar, liberar e formalizar com documento.
  - Órgãos e adesões, com limites legais na hora e exceção só pelo Jurídico.
  - Movimentações (livro imutável, execução e faturamento).
  - Conversões e remanejamentos (simular, pedir, aprovar, efetivar).
  - Documentos, relatórios (9 tipos + CSV) e histórico.
- **Inteligência → Atas de registro de preços**, com período.
- **Na oportunidade:** painel “Ata de registro de preços” para atrelar ao saldo (cota ou adesão já autorizada) ou pedir nova adesão de órgão/instituição. A adesão autorizada reserva sozinha para a oportunidade; desatrelar libera o saldo.
- **Testes:** API 13 testes de atas; E2E da ata (cadastro → importação com erro → vigente → oportunidade reserva → remanejamento simulado e pedido → relatórios).

## Identidade visual BKT ✅ (2026-10-20)
- **Marca:** logo oficial, azul e grafite da marca, Orbitron e Work Sans, hexágonos no menu, login e Início.
- **Removido:** slogan e mascotes.
- **Funil e gráficos** na paleta da marca.

## Análise e aprovação da negociação ✅ (2026-10-20)
- **Tela de análise** (`/opportunities/:id/aprovacao`) que se adapta: **novo cliente** (dados, origem do lead, perfil comercial, produto, condições, investimento, CAC, margem prevista, receita projetada, payback, viabilidade técnica e financeira) × **cliente da base** (seção **Inteligência do Cliente**: relacionamento, receita contratada, serviços que a compõem, CAC histórico, LTV projetado, faturamento lançado; pagamentos, inadimplência, pontualidade e LTV realizado aparecem como **Aguardando IXC**).
- Cliente da base = qualquer relacionamento (cadastro não-prospect, contrato, venda anterior ou importação do ERP); cancelado continua da base. Cadastros parecidos (CPF/CNPJ, telefone, e-mail) são listados; só entram na análise os marcados “mesmo cliente” (decisão registrada, append-only).
- **Contratos e serviços** com vigência, itens, reajustes, renovações, encerramento e pendências, cada um abrindo o contrato.
- **Classificação estratégica** no cadastro do cliente (classe, categoria, perfil, perfil pagador, potencial, risco, observações, data e responsável), append-only, com opções configuráveis; “Não classificado” + tarefa de atualização cadastral.
- **Margem e capacidade de negociação**: atual × incremento × depois, custo atribuível (estimado na venda; desconhecido se o valor mudou >20%), investimento, payback incremental, desconto × alçadas, aprovação excepcional. Nunca usa total pago como margem; avisa quando não dá para calcular.
- **Resumo executivo** no topo e **parecer de apoio à decisão** por regras (favoráveis, atenção, financeiro, estratégico, pendências, alçada), cada item com a origem.
- **Pedido de aprovação** = versão da proposta (imutável, com resumo financeiro e impressão digital dos dados); nova versão substitui a pendente. **Decisão** (aprovar, reprovar, pedir correção) por quem tem alçada, nunca o próprio solicitante; grava aprovador, alçada, data, comentário, resumo considerado, versão dos dados e condições aprovadas. Mudança material entre pedido e decisão exige confirmação.
- **Chat da negociação** (interno, append-only) com mensagens de sistema (pedido, avisos, decisão); fora do histórico do relacionamento.
- **Histórico consolidado** em duas abas: desta negociação × do relacionamento.
- **Avisos** por e-mail e WhatsApp (Z-API, número no cadastro do usuário) só com resumo seguro; modelo configurável em Configurações → Aprovações e alçadas.
- **Fila de Aprovações** no menu com contador do que aguarda a minha alçada.
- **Relatórios em tela cheia (modo TV)** com relógio, atualização a cada 5 min e alternância de abas; **olhinho** que oculta valores em R$ (Relatórios, Inteligência, Contratos e telas abertas).
- Testes: domínio 47/47, API 98/98, E2E 32/32.

## Acesso / login ✅ (2026-10-20)
- **Entrar com Google** (OAuth/OpenID): só entra em usuário já cadastrado, ativo, com o mesmo e-mail verificado; vincula o `sub` do Google no primeiro acesso; domínios permitidos opcionais. Variáveis: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ALLOWED_DOMAINS` (opcional). Redirect URI: `https://<domínio>/api/v1/auth/google/callback`.
- **Esqueci minha senha**: link por e-mail (SMTP da empresa), 1 hora, uso único; encerra as sessões. Página `/redefinir-senha`.
- **Mostrar senha** e aviso de Caps Lock no login.
- **Recuperação pelo deploy**: `ADMIN_RESET_EMAIL` + `ADMIN_RESET_PASSWORD` (mín. 10) na Vercel → no próximo deploy de produção a senha é definida, a conta é desbloqueada e reativada (cria Gerência se o e-mail não existir e houver uma empresa só). Remover as variáveis depois.
- Gerência pode **corrigir o e-mail** do usuário (desfaz o vínculo Google).
- Testes: API 88/88, E2E 28/28.

## Gestão de Contratos ✅ (2026-10-19)
- Menu e abas: painel, lista, funil, calendário, renovações, reajustes, encerramentos, notificações, modelos e relatórios.
- Cadastro a partir da oportunidade fechada; validação dispara tarefa de ERP, provisionamento (Financeiro), implantação e Sucesso do Cliente.
- Versões por INSERT, processos paralelos com roteiros (renovação pública com ofício e cópia para contratos@bktele.com.br, privada, reajuste, encerramento), documentos com nome padrão e restrição por setor, alertas diários sem duplicidade.
- **Modelos de contrato no mesmo editor dos modelos de proposta**, com o timbrado da empresa; geração do PDF pela ficha; alternativa em Word (.docx com `{{campos}}`).
- **Assinatura ZapSign** (token, produção/sandbox, webhook); PDF assinado volta como nova versão.
- **Tipos**: Recorrente, Frequente e Medição; extrato append-only (`contract_ledger`). Medição: saldo consumido pelas oportunidades ao fechar a venda; reabrir estorna.
- **Sucesso do Cliente**: oportunidade de cliente da base pergunta se aciona; “sim” duplica no funil Sucesso do Cliente.
- Painel com faturamento por tipo e estratificações; relatório completo (filtros, tabela, CSV com 45 colunas, impressão/PDF).
- Pendências externas: ERP/IXC (faturado real), SMTP, setores dos usuários, `CRON_SECRET`, token e webhook da ZapSign.

## Entregas entre 18 e 19/10
Sprint, viabilidade, portas de CTO, campanhas, integrações (IXC credenciais, Z-API com envio/webhook/teste, Meta, site), Inteligência geral, base de dados, propostas PJ, envio da proposta por WhatsApp e campos personalizados de clientes e negociações.

## Próxima etapa (histórico) — Fase 2b (Sprint completo)
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
