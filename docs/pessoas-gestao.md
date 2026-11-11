# Pessoas & Gestão — Desempenho, Desenvolvimento, Feedback, PDI e People Analytics

Diagnóstico técnico e plano de implementação (antes de qualquer alteração de código). Validar as decisões da seção 10
antes de começar a Fase A.

---

## 1. Diagnóstico da arquitetura existente (verificado no código)

| # | Item | O que existe hoje | Onde |
|---|---|---|---|
| 1 | Frontend | React 18 + Vite + TypeScript, React Router (rotas *lazy*), TanStack Query, Tailwind | `apps/web` |
| 2 | Backend | Fastify + TypeScript com `defineRoute` (Zod em body/query/params, `module`, `rateLimit`, `bodyLimit`) | `apps/api/src/http/route.ts` |
| 3 | Diretórios | Monorepo pnpm: `apps/api` (rotas, serviços, testes), `apps/web` (páginas, features, componentes), `packages/domain` (regras puras), `packages/shared` (contratos Zod) | — |
| 4 | Design system | Tokens Tailwind (`primary`, `navy`, `lime`, `surface`, `line`…), tema claro/escuro, fonte de títulos própria | `apps/web/src/components/ui/primitives.tsx`, `overlay.tsx`, `brand` |
| 5 | Componentes | `Button`, `Input`, `Select`, `Textarea`, `FormField`, `Chip`, `Avatar`, `EmptyState`, `ErrorState`, `LoadingRows`, `Modal`, `Drawer`, `ConfirmDialog`, `Toast`, `PageHeader`, `RichText`, `MentionInput` | idem |
| 6 | Autenticação | Sessão por cookie (hash do token), login por senha e Google (OAuth), recuperação de senha, bloqueio por IP | `routes/auth.ts`, `authRecovery.ts`, `ipAccess.ts` |
| 7 | Perfis e permissões | Perfis (`administrador`, `diretoria`, `gerencia`, `supervisor`, `operacao`) → matriz de acesso por **módulo técnico** com níveis `nenhum/proprio/equipe/total`; **módulos de negócio** liberáveis por empresa/time/pessoa (`tenant_modules`, `module_grants`); setores do usuário (`users.sectors`) usados como papéis funcionais | `packages/domain/src/access.ts`, `services/scope.ts`, `services/modules.ts` |
| 8 | Usuários | Cadastro único `users` (nome, e-mail, cargo, telefone, setores, metas), fotos em `user_avatars` | `db/schema.ts` |
| 9 | Hierarquia | `teams` (líder via `team_memberships.is_lead`, `managerIds`, líder substituto) → `org_units` (diretoria → área → unidade, responsável e substituto). **Não há vigência**: só o estado atual; mudanças ficam em `org_events` (log) | `routes/results.ts`, `services/scope.ts` |
| 10 | Multi-tenant | `tenant_id` em todas as tabelas; filtro por `auth.tenantId` nas rotas; testes cruzam empresas | todo o backend |
| 11 | Banco/ORM | PostgreSQL + Drizzle ORM; migrações versionadas (`0001…0141`), só aditivas | `apps/api/migrations` |
| 12 | APIs | ~110 arquivos de rotas REST em `/api/v1` | `apps/api/src/routes` |
| 13 | Notificações | Caixa genérica `user_notifications` + `notification_deliveries` + preferências (criada no Pessoas & Cultura); e-mail (SMTP, modelos editáveis), WhatsApp (Z-API); ícone "@" do topo | `services/people/notify.ts`, `services/email.ts`, `services/whatsapp.ts` |
| 14 | Integrações | `integrations` por tipo (`ixc`, `zapi`, `zapsign`, `glpi`, `whatsapp`, `meta`, `site`) com segredos cifrados (AES-256-GCM) e webhooks por código; Gmail por pessoa (`mailboxes`, OAuth Google); **sem** Microsoft 365, **sem** Google Calendar, **sem** provedor de IA | `routes/integrations.ts`, `services/integrations.ts`, `services/gmail.ts` |
| 15 | Auditoria | `audit_logs` (ação, entidade, metadados, ator, IP) + históricos *append-only* por domínio (`*_events`) | `services/audit.ts` |
| 16 | Armazenamento | Arquivos no banco (`bytea`), tipo validado pelos bytes, envio em partes por causa do limite de 4,5 MB da hospedagem | `services/people/media.ts`, anexos |
| 17 | Formulários | Componentes próprios + Zod compartilhado (`packages/shared`); erros `422` com `errors[]` por campo | — |
| 18 | Indicadores | **Já existe uma camada robusta**: `indicators` + `indicator_versions` (fórmula versionada), `objectives` (cascata), `goals` (metas por pessoa/time/unidade/empresa, com revisão por alçada), `result_closings` (apuração imutável), **`scorecards` por perfil/cargo/time com versões e pesos**, `indicator_entries`, KPIs da área, eventos de negócio (`business_events`) | `routes/indicators.ts`, `results.ts`, `kpis.ts`, `performance.ts` |
| 19 | Automação | Fila `automation_queue` (oportunidades), rotina diária `/cron/alerts` (Vercel Cron, 1×/dia), intervenções com escalonamento | `routes/settings.ts`, `services/automations.ts` |
| 20 | Testes/deploy | Vitest na API (435 testes, banco real), Playwright e2e (banco recriado por execução), deploy Vercel a partir da `main` (função de 30 s), migrações no build | `apps/api/test`, `tests/e2e`, `vercel.json` |

**Já existe e será reaproveitado (não refazer):**
- **Gestão de Times** (`/times/pessoas`): performance por nível hierárquico, gamificação, intervenções com plano de ação e escalonamento, rituais de gestão (reuniões com pauta, ata e *snapshot*), decisões e impedimentos, férias.
- **Central de Playbooks (Wiki)** com provas e certificados (`training_certificates`) e certificados de cursos complementares validados pela liderança.
- **Pesquisas por link** (NPS/CSAT de clientes) — base para a futura Clima & Escuta, mas com segregação própria.
- **Pessoas & Cultura (Fase 1 – Fundação Social)**: perfil social, feed, comunidades, reconhecimentos, comunicados com ciência versionada, moderação, notificações, mensagens.

---

## 2. Mapa funcional definitivo

O módulo de negócio **`pessoas_cultura`** passa a se chamar **Pessoas & Gestão** na interface (a chave técnica fica,
para não quebrar liberações existentes) e ganha seções no mesmo menu lateral:

| Seção | Conteúdo | Situação |
|---|---|---|
| **Meu Espaço** | Jornada, próximos 1:1, feedbacks recebidos/pendentes, PDI, compromissos, treinamentos, comunicados, reconhecimentos | Existe (social) → ampliar |
| **Desempenho & Desenvolvimento** | Feedbacks (1:1 e situacional), Agenda de 1:1, Preparação/Dossiê, PDI, Competências, Minha Equipe, Minha Estrutura, Alertas | **Esta etapa** |
| **Cultura & Comunidade** | Feed, comunidades, reconhecimentos, comunicados, celebrações, mensagens | Existe |
| **Clima & Escuta** | Pesquisas internas, eNPS, pulsos, planos de ação | Ponto de extensão (dados segregados) |
| **Jornada do Colaborador** | Onboarding, movimentações, marcos, offboarding | Ponto de extensão (movimentações já alimentam a hierarquia com vigência) |
| **BK Conecta — Ouvidoria** | Manifestações, tratamento confidencial | Ponto de extensão, **base e permissões próprias**, fora do Canal de Confiança/CIEI |
| **People Analytics** | Indicadores de liderança, cobertura, IGDP, PDI, alertas | Base nesta etapa (Fase E) |
| **Administração** | Políticas de feedback, metas, competências, indicadores por cargo, Central de Integrações | Ampliar a Administração atual do módulo |

A **Gestão de Times** continua sendo o lugar de metas, gamificação, intervenções e rituais. Pessoas & Gestão **lê**
esses dados (dossiê, alertas) e **não duplica** cadastros. Intervenção pode gerar objetivo de PDI; ritual de equipe ≠ 1:1.

---

## 3. Arquitetura de integração (definida já na Fase A)

```
 Telas ─► Rotas de Pessoas & Gestão ─► Serviços de domínio ─► Banco (tenant)
                                     │
                                     ├─► Outbox de eventos (domain_events) ─► Despachante
                                     │        ├─► assinantes internos (alertas, notificações, gamificação)
                                     │        └─► webhooks de saída / conectores
                                     └─► Camada de conectores (interface única)
                                              ├─ agenda: Google Calendar · Microsoft 365 (planejado)
                                              ├─ indicadores: internos (indicators/result_closings) · externos (IXC, GLPI, ERP, CSV)
                                              ├─ notificações: interna · e-mail · WhatsApp (já existem)
                                              ├─ IA: provedor configurável (planejado até haver credencial)
                                              └─ BI: visões analíticas somente leitura, sem texto de feedback
```

- **Central de Integrações**: amplia a tela atual de integrações com um **registro de conectores** que distingue
  `implementado` (código existe) / `configurado` (parâmetros salvos) / `conectado` (credencial válida e teste ok) /
  `desativado` / `planejado` (sem código; aparece como roadmap, **nunca como operacional**). Segredos continuam cifrados
  e nunca voltam à tela nem aos logs.
- **Contrato de conector** (`packages/domain`): `capabilities()`, `test()`, `sync(scope)`, `push(event)`; cada execução
  grava `integration_runs` (início, fim, resultado, contagens, erro resumido) com *retry* exponencial e limite.
- **Eventos internos (outbox)** `domain_events`: `id`, `tenant`, `type` (ex.: `feedback.scheduled`,
  `feedback.completed`, `feedback.action_created`, `pdi.created`, `pdi.action_completed`, `pdi.checkpoint_due`,
  `competency.updated`, `development.alert_created`, `employee.manager_changed`), `entity`, `version`, `occurredAt`,
  `source`, `correlationId`, `payload` mínimo (ids, nunca texto de feedback), `status`, `attempts`, chave de
  idempotência. Gravado **na mesma transação** da alteração; o despachante roda na rotina e sob demanda.
  `business_events` (gamificação) continua para créditos e não é misturado.
- **Indicadores**: o catálogo por cargo **reaproveita `scorecards`** (perfil/cargo/time, pesos, versões) e
  `indicators/indicator_versions`/`result_closings` (fonte, fórmula, periodicidade, vigência). Indicador externo entra
  como `indicator_entries` vindo de conector, com origem e data de atualização. O dossiê só mostra indicadores do
  scorecard vigente da pessoa.
- **Agenda**: o login Google e o Gmail já usam OAuth do Google; o Calendar exige **consentimento adicional por pessoa**
  (escopo de eventos). Sem conexão válida, nenhum evento externo é criado — o 1:1 funciona só no sistema. O id do
  evento externo fica no agendamento para reagendar/cancelar.
- **Falha de integração nunca corrompe dado interno**: o registro interno é a fonte; o conector só replica e registra
  o resultado.

---

## 4. Modelo de dados proposto (novas tabelas, todas com `tenant_id`; nada duplicado)

**Hierarquia com vigência**
- `reporting_lines` (pessoa, liderança, origem `time|unidade|manual`, `valid_from`, `valid_to`, motivo): derivada
  das mudanças em times/unidades (não é cadastro paralelo); base para "quem é a liderança de quem **naquela data**".
  Mudança de liderança não abre registros antigos para a nova liderança.

**Políticas e metas (RH)**
- `dev_policies` (versões imutáveis: frequência do 1:1, prazos de agendamento/realização/registro, tolerância,
  elementos mínimos para concluir, regras de visibilidade do feedback ascendente, meta de situacionais, pesos do IGDP,
  vigência) + `dev_policy_scopes` (empresa/unidade/área/cargo/nível/tipo de liderança) + `dev_policy_exceptions`.

**Feedback e 1:1**
- `one_on_ones` (colaborador, liderança, política/versão, período, datas prevista/agendada/realizada, status, id do
  evento externo, *row version*), `one_on_one_events` (histórico de estados com justificativa),
  `one_on_one_records` (pauta, preparação do colaborador e da liderança, registros, reconhecimentos, oportunidades,
  próximos passos), `one_on_one_acks` (ciência por parte, comentário/divergência — ciência ≠ concordância).
- `feedbacks` (situacional: remetente, destinatário, direção `descendente|ascendente`, modalidade, SBI — situação,
  comportamento, impacto, orientação —, competência, data do fato, visibilidade, modo `identificado|confidencial`,
  mediação pelo RH, status), `feedback_acks` (ciência e manifestação).
- `dev_commitments` (compromissos de 1:1/feedback: responsável, prazo, status, revisão no 1:1 seguinte, vínculo com
  ação de PDI).
- `prep_dossiers` (*snapshot* versionado do dossiê: período, fontes, dados usados, resumo e marcação fato/interpretação,
  revisão humana).

**Desenvolvimento**
- `competencies` (+ `competency_versions`): nome, descrição, categoria, comportamentos observáveis, níveis
  configuráveis, critérios, cargos relacionados, status. `competency_levels` por empresa.
- `pdis` (colaborador, liderança, ciclo, datas, objetivo geral, status, aprovações), `pdi_goals` (objetivo específico,
  competência, nível atual/desejado, origem — 1:1, situacional, autoavaliação, carreira, organização, liderança, RH,
  iniciativa própria —, critérios de sucesso), `pdi_actions` (tipo prática/social/formal, responsável, prazo, status,
  vínculo com playbook/prova/certificado), `pdi_checkpoints` (progresso, obstáculos, apoio, ajustes),
  `pdi_evidences` (documento/link/certificado/entrega/indicador, com acesso e histórico), `pdi_events` (histórico),
  `competency_assessments` (evolução observada, separada da conclusão das ações).

**Gestão**
- `dev_alerts` (tipo, regra de origem, pessoa/equipe, responsável, prioridade `informativo|atenção|crítico`, prazo,
  status, ação recomendada, resolução) + `dev_alert_events`.
- `leadership_snapshots` (indicadores de gestão por liderança e período — cobertura, pontualidade, continuidade, PDI,
  IGDP e componentes ausentes —, para tendência e BI).

**Integrações**
- `integration_connectors` (registro e status do ciclo de vida, responsável técnico/funcional, finalidade, dados
  autorizados, base legal, retenção), `integration_runs`, `integration_mappings`, `domain_events`, `webhook_deliveries`.
  A tabela `integrations` atual continua guardando credenciais dos tipos existentes.

---

## 5. Matriz de permissões (sem sistema paralelo)

Base: matriz de acesso existente (novo módulo técnico **`desenvolvimento`**, níveis `proprio/equipe/total`) +
liberação do módulo de negócio + **papéis funcionais por setor** nas Configurações do módulo (RH, Diretoria de Pessoas).
Toda checagem no backend. **Visibilidade de indicador ≠ acesso a conteúdo.**

| Recurso | Colaborador | Líder imediato (vigente) | Gestor de gestores | Diretoria | RH (setor) | Administrador |
|---|---|---|---|---|---|---|
| Status e prazos do 1:1 | próprios | liderados | estrutura | estrutura | todos | — |
| Conteúdo do 1:1 / feedback descendente | próprio | os que conduziu/recebeu | **não** (só com autorização explícita) | **não** | mediação quando acionado | **não** |
| Feedback ascendente identificado | o que enviou | o que recebeu (conforme política) | **não** | **não** | conforme política | **não** |
| Feedback ascendente confidencial | o que enviou | **só a síntese liberada pelo RH** | não | não | sim (mediação) | não |
| Compromissos | próprios | liderados | contagem | contagem | todos | — |
| PDI (conteúdo) | próprio, edita | liderados, valida ações | status e indicadores | indicadores | todos | — |
| Indicadores de gestão / IGDP | — | próprio | estrutura | estrutura | todos | — |
| Políticas, metas, competências | ver vigente | ver vigente | ver | ver | **edita** | — |
| Central de Integrações | — | — | — | — | ver status | **edita** |

Regras: vínculo pela **liderança vigente na data** do registro; troca de liderança não expõe histórico; a posição
hierárquica sozinha nunca abre texto de feedback; exportações auditadas.

---

## 6. Fluxos

**1:1 programado** — a política gera as previsões do período (`previsto`) → `aguardando_agendamento` → `agendado`
(com evento externo se houver agenda conectada) → `em_preparacao` (dossiê, pautas das duas partes) → `realizado` →
`aguardando_registro` → `aguardando_ciencia` → `concluido` (só com os elementos mínimos da política).
Desvios: `reagendado` (justificativa), `cancelado` (justificativa), `nao_realizado` (justificativa e motivo de ausência).
Transições validadas no backend; cada mudança gera histórico e evento.

**Feedback situacional** — rascunho → enviado → ciência do destinatário (com manifestação opcional) → arquivado.
Ascendente confidencial: enviado ao **RH** → mediação → síntese liberada à liderança (ou tratamento sem repasse).

**Feedback ↔ PDI** — do feedback/1:1: criar objetivo, vincular a objetivo existente, criar ação, prazo, responsável,
checkpoint. Do PDI para o 1:1: objetivos ativos, ações pendentes, evidências, checkpoints e compromissos entram no dossiê.
Nem todo feedback gera PDI.

**PDI** — assistente (competência → por quê → situação atual → resultado desejado → como observar → experiências
70-20-10 → quem apoia → prazo → acompanhamento) → aprovação (liderança; RH quando a política exigir) → ações e
checkpoints → evidências → conclusão das ações **separada** da evolução da competência (avaliação observada).

---

## 7. Estrutura das telas (menu lateral do módulo, design system atual)

Desempenho & Desenvolvimento: **Meus Feedbacks** (recebidos, enviados, pendentes de ciência) · **Novo Feedback**
(formulário SBI) · **Agenda de 1:1** (mês, previstos/agendados, sugestão de horário) · **Preparação do 1:1** (dossiê)
· **Registro do 1:1** · **Histórico** · **Meus PDIs** · **Criar PDI** (assistente) · **Detalhes do PDI** (objetivos,
ações, evidências, checkpoints) · **Minha Equipe** (líder) · **Minha Estrutura** (gestor de gestores, diretoria) ·
**Indicadores da Liderança** · **Alertas**.
Administração: **Políticas** · **Metas** · **Competências** · **Indicadores por cargo** (scorecards) ·
**Central de Integrações** · **People Analytics**.

---

## 8. Plano de implementação — por funcionalidade

Cada funcionalidade sai **completa** (migração aditiva, API com autorização no backend, telas, notificações, testes de
API e e2e) e pode ser publicada sozinha. A fundação necessária entra junto da primeira funcionalidade que precisa dela;
os contratos de integração (eventos, conectores) nascem na F1 para não serem refeitos depois.

| # | Funcionalidade | Inclui | Depende de |
|---|---|---|---|
| **F1** | **Feedback situacional** (SBI) | Fundação mínima: hierarquia com vigência (`reporting_lines`), módulo técnico `desenvolvimento`, papel RH por setor, política de visibilidade; feedback descendente e ascendente (identificado e confidencial com mediação do RH), ciência e manifestação, histórico, avisos sem conteúdo; outbox de eventos (`feedback.*`) | — |
| **F2** | **1:1 programado** | Política de recorrência (mensal padrão) com escopos e exceções, previsões do período, agenda interna (agendar, reagendar, cancelar, presença), máquina de estados, pautas das duas partes, registro com elementos mínimos, ciência com divergência, compromissos | F1 |
| **F3** | **Biblioteca de competências** | Catálogo versionado, categorias, comportamentos observáveis, níveis configuráveis, vínculo com cargos; competência no feedback | F1 |
| **F4** | **PDI** | Assistente (GROW/SMART, 70-20-10), objetivos, ações (vínculo com Playbooks, provas e certificados), evidências, checkpoints, aprovação, conclusão ≠ evolução; Feedback/1:1 → PDI | F2, F3 |
| **F5** | **Dossiê de preparação do 1:1** | Indicadores do scorecard vigente (metas, apurações, eventos), compromissos, PDI, feedbacks autorizados, perguntas sugeridas por regra, *snapshot* versionado com fontes e período | F2, F4 |
| **F6** | **Minha Equipe / Minha Estrutura e metas do RH** | Visões do líder, gestor de gestores, diretoria e RH; metas por escopo; cobertura, pontualidade, continuidade, PDI e **IGDP** configurável (sem fonte = "sem dados") | F2, F4 |
| **F7** | **Alertas de desenvolvimento** | Motor configurável (1:1 não agendado/vencido, ciência pendente, compromisso vencido, PDI parado, liderança abaixo da meta…), prioridades, responsável, resolução | F2, F4, F6 |
| **F8** | **Central de Integrações + Google Calendar** | Registro de conectores com status reais, execuções e erros, *retry*, webhooks de saída; agenda Google por consentimento da pessoa; Microsoft 365 como planejado | F2 |
| **F9** | **People Analytics** | Tendências por período/área/cargo/liderança, tabelas, exportação auditada, visões para BI sem texto de feedback | F6, F7 |
| **F10** | **Resumo do dossiê por IA** | Só com provedor e credencial cadastrados; fontes, período, fato × interpretação, revisão humana | F5, F8 |

Ao fim de cada funcionalidade: relatório (o que foi feito, arquivos, migração, APIs, testes, pendências) e
publicação **somente com autorização**.

## 9. Riscos e dependências

- **Hierarquia hoje sem vigência**: a Fase A precisa reconstruir o histórico a partir de `org_events` quando houver;
  antes disso, a vigência começa na data de implantação (registrado no documento).
- **Rotina diária única (Vercel Cron 1×/dia, função de 30 s)**: previsões, alertas e despacho de eventos precisam ser
  incrementais e idempotentes; lembretes "em tempo real" exigem eventos no momento da ação ou outro agendador.
- **IA**: não há provedor configurado. O dossiê funciona sem IA (regras e dados). O resumo por IA depende de
  credencial, aceite de política de dados e envio só de dados autorizados — fica desligado até isso existir.
- **Microsoft 365**: exige registro de aplicativo no Azure AD da empresa e consentimento do administrador.
- **Google Calendar**: exige incluir o escopo de agenda no cliente OAuth atual (tela de consentimento do Google).
- **Indicadores externos**: dependem do mapeamento pessoa ↔ usuário nos sistemas de origem (IXC, GLPI, ERP).
- **LGPD**: conteúdo de feedback é dado pessoal sensível no contexto de trabalho — notificações sem conteúdo,
  datasets de BI sem texto, retenção definida pelo RH, exportação auditada.
- **Ouvidoria e Clima**: precisam de base e permissões segregadas; não entram nos alertas individuais nem no dossiê.

---

## 10. Decisões para validação antes da Fase A

1. **Nome e lugar**: transformar "Pessoas & Cultura" em **"Pessoas & Gestão"** (mesmo módulo e menu, nova seção
   Desempenho & Desenvolvimento), mantendo a Gestão de Times como está e lida pelo novo módulo.
2. **Hierarquia**: liderança imediata = líder do time (com substituto), gestor de gestores = responsável da unidade
   acima; vigência registrada a partir de agora em `reporting_lines`.
3. **RH**: papel definido por **setor** nas Configurações do módulo (como Comunicação/Moderação hoje).
4. **Feedback ascendente**: padrão **confidencial com mediação do RH**; modo identificado liberável por política.
5. **IA**: resumo por IA **desligado** até a empresa definir o provedor e cadastrar a credencial na Central de Integrações.
6. **Agenda**: começar pelo **Google Calendar** (já há OAuth do Google); Microsoft 365 como planejado.
