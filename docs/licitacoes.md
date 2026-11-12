# Gestão de Licitações — diagnóstico e plano de implantação

O prompt pede, antes de desenvolver, inspecionar a arquitetura e definir o menor conjunto de mudanças.
Este documento faz isso: o que já existe e será reaproveitado, o que falta, as decisões a validar e a ordem
de implantação por feature, cada uma testada e publicada só com autorização.

## 1. O que já existe (reaproveitar, não duplicar)

| Necessidade do prompt | O que o ISP Sprint já tem | Uso |
|---|---|---|
| Oportunidade do tipo Licitação | `opportunities.sale_kind = 'licitacao'`, `bid_mode`, lances (`bid_participants`) e linha do tempo do pregão (`bid_actions`), campos do formulário do funil (`custom`: órgão, processo etc.) | É o gatilho da criação e a fonte dos dados herdados. Nenhum campo novo onde já existe equivalente. |
| Projeto | `projects` (com `opportunity_id`, `contract_id`, `kind`, dono, prazos), `project_stages` (colunas do quadro), `project_milestones` (com critério de aceite e homologação), `project_members`, `project_events` (histórico), `project_risks` | O projeto de licitação é um projeto comum, `kind = 'licitacao'` (novo valor), vinculado à oportunidade. Aparece no módulo Projetos sem tela paralela. |
| Tarefas, subtarefas e dependências | `activities` com `project_id`, `project_stage_id`, `milestone_id`, `parent_id` (subtarefa) e `activity_dependencies` | Etapas → macrotarefas → tarefas → subtarefas viram estágios/marcos + tarefas e subtarefas existentes. |
| Modelos de projeto | `project_templates` (def em JSON: estágios, marcos, tarefas com deslocamento em dias) e modelos embutidos | Base do motor de modelos. Falta: versões, estados (rascunho → em aprovação → publicado → arquivado), hierarquia completa, RACI, entregáveis e prazos relativos aos marcos do edital. |
| RACI | `raci_settings` (R/A/C/I por atividade, usuários ou papéis) usado pelo motor de eventos de desempenho | Mesma forma de atribuição (usuário ou papel/setor), aplicada por tarefa do modelo e do projeto. |
| Aprovações | `approval_requests`/`approval_decisions` — hoje específicas de preço/desconto da oportunidade | Precisam de uma aprovação genérica por objeto (plano, Go/No-Go, proposta, exceção, alteração crítica, contratação) com alçada. |
| Áreas e pessoas | setores dos usuários, times, linhas de reporte (`reporting_lines`) | Resolve responsável, substituto e gestor por área. |
| E-mail corporativo | `sendEmail` (SMTP da empresa, anexos, registro em `email_messages`), modelos de comunicação com versões e moldura institucional (`comm_templates`/`comm_template_versions`) | Templates por área = modelos de comunicação. Falta fila com tentativas para os disparos da licitação. |
| Documentos | anexos da oportunidade (`opportunity_attachments`, em partes), documentos do contrato | Os documentos do projeto ficam nos anexos da oportunidade, com categoria e versão (edital, TR, retificação…). |
| Contrato a partir da oportunidade | cadastro do contrato com os dados do CRM, Processos do contrato | Etapa 10 usa o fluxo que já existe. |

## 2. O que falta (o menor conjunto)

1. **Modelo versionado** de projeto: tabela de versões do modelo (cada publicação congela uma cópia), estados e autor; o projeto guarda a versão de origem.
2. **Hierarquia e atributos por item** do modelo e da tarefa: área, RACI (um único A), obrigatória/opcional, entregáveis, critério de aceite, documentos exigidos, prazo relativo a um marco do edital, template de notificação.
3. **Marcos oficiais da licitação** (publicação, esclarecimentos, impugnações, proposta, sessão, recursos, resultado, contratação), informados/validados pelo analista a partir do edital, e cálculo retroativo dos prazos internos com margem.
4. **Entregáveis** com estados (pendente → … → aprovado / devolvido / bloqueado / atrasado), versões e evidências.
5. **Aprovação genérica** com alçada pela matriz RACI e estados (em elaboração, aguardando, aprovado, devolvido, rejeitado, cancelado). Resposta por e-mail não vale como aprovação.
6. **Disparo por área**: tela de conferência (destinatários, entregáveis, prazos, prévia, anexos), bloqueio sem plano aprovado, edital anexado, fila com tentativas e chave única por evento.
7. **Telas**: aba "Projeto de Licitação" na oportunidade, planejamento em tabela editável (edição em linha e em lote), Gantt/dependências, entregáveis por área, matriz RACI, aprovações, documentos, notificações, histórico, painel do analista.
8. **Indicadores** de licitação na Gestão de Resultados.

## 3. Decisões validadas

1. **O projeto de licitação é um projeto dentro da oportunidade** (aba "Projeto de Licitação"), usando o motor de Projetos (`kind = 'licitacao'`). As tarefas ficam no projeto e não lotam a lista de tarefas da negociação.
2. **1:N:** o primeiro projeto nasce sozinho quando a oportunidade é de licitação (no máximo um automático: índice único parcial); outros podem ser criados à mão (lotes, frentes). Se o tipo mudar depois, o projeto não é apagado: aparece a decisão "continuar" ou "arquivar".
3. **Coordenador:** começa com o responsável comercial e pode ser qualquer pessoa ativa da empresa.
4. **Marcos do edital são informados pelo analista** (a partir do edital) e ficam marcados como "validado". O sistema não presume datas legais.
5. **Aprovações dentro do sistema**, com um único Accountable por decisão; a alçada segue a matriz RACI e, para preço/margem, as alçadas comerciais que já existem.
6. **E-mails saem pelo SMTP da empresa** já configurado. Anexo acima do limite vira link seguro com acesso controlado e a exceção fica registrada. Sem SMTP configurado, o envio aparece como "não configurado"; nada é simulado.
7. **Preços e margens** do projeto só para quem já vê valores financeiros hoje.

## 4. Ordem de implantação (por feature)

| # | Feature | Fase do prompt | Critérios de aceite cobertos |
|---|---|---|---|
| L1 ✅ | Modelo de projeto versionado + modelo padrão do rito (11 etapas) + criação automática idempotente a partir da oportunidade + aba "Projeto de Licitação" | 1 | 1, 7 |
| L2 ✅ | Planejamento: tabela editável (área, responsável, entregável, aceite, datas, dependência, aprovador, anexos, notificação), marcos do edital e prazos retroativos, edição do projeto sem afetar o modelo | 1–2 | 2, 8 |
| L3 | Matriz RACI por tarefa e aprovação genérica (plano, Go/No-Go, proposta, exceções, alterações críticas, contratação) | 2 | 3 |
| L4 | Templates de e-mail por área, conferência antes do disparo, edital anexado, fila com tentativas, notificações posteriores | 3 | 4 |
| L5 | Execução pelas áreas: ciência, evidências, entregáveis com estados e validação | 4 | 5 |
| L6 | Acompanhamento: painel do analista, alertas de prazo, Gantt, caminho crítico | 4 | 6 |
| L7 | Documentos por categoria com versões, retificação do edital com áreas impactadas | 4 | 9 |
| L8 | Encerramento: resultado na oportunidade e no projeto, transição para Contratos e implantação, lições aprendidas | 5 | 10 |
| L9 | Indicadores de licitação na Gestão de Resultados | 5 | — |

Cada feature: migração não destrutiva, testes de API e de tela executados, publicação só com autorização.
