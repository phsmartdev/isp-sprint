/** Manual do sistema — capítulos de uso (parte 2): Sucesso do Cliente, Marketing, Gestão de Times, Projetos e Tarefas, Orçamento. */
import type { ManualChapter } from './types';

export const CH_SUCESSO: ManualChapter = {
  slug: 'sucesso-cliente', type: 'atendimento', title: 'Sucesso do Cliente',
  description: 'Carteira com Tier, IPC e saúde, cobertura e capacidade, jornadas e kickoff, trilha compartilhada, visitas, planos de ação e pesquisas por link.',
  keywords: ['sucesso do cliente', 'cs', 'csm', 'jornada', 'kickoff', 'nps', 'pesquisa', 'ipc', 'tier', 'saúde'],
  src: `
@ /sucesso Abrir Sucesso do Cliente
# Carteira
Cada conta tem **Tier** (pelo valor anual consolidado: recorrente ×12, medição, frequente e ganhas sem contrato), **Score IPC** (critérios objetivos calculados + qualitativos avaliados), classe, **saúde**, criticidade e o motivo. A tela mostra as prioridades de hoje e as contas críticas sem acompanhamento.

- **CSM da conta e do contrato:** a conta tem um CSM; um contrato pode ter outro (a jornada e as tarefas abertas do contrato passam para a pessoa nova).
- **Distribuir a carteira:** equilibra valor anual e quantidade entre os CSMs, com prévia antes de gravar.
- **Cobertura e capacidade:** simples e ponderada, agrupada por CSM, equipe, Tier, classe ou mês; scorecard por CSM no painel gerencial.
- **Configuração versionada:** cálculos antigos mantêm a versão da época.

# Jornada do cliente
A validação do contrato abre a jornada (ou inicie manualmente). A jornada tem **marcos** (concluir, reabrir, reprogramar), a **apresentação de kickoff** versionada (sem alterar os dados oficiais do contrato), modelos de apresentação reutilizáveis e link autorizado de 30 dias para o cliente ver.

## Trilha visual compartilhada
A trilha mostra as paradas da jornada com situação e histórico. Crie um **link externo** com destinatário, prazo e código opcional (o código aparece uma única vez); revogar corta o acesso na hora; tentativas erradas do código bloqueiam.

# Acompanhamento do dia a dia
- **Acompanhamentos** realizados (concluem o previsto ou entram como ação adicional).
- **Visitas:** agendar (vai para a agenda do CSM), registrar o resultado (resumo, demandas, riscos, oportunidades, próximos passos) e anexar arquivos.
- **Planos de ação e ocorrências:** com passos que viram tarefas; concluir ou cancelar.
- **Risco de cancelamento** e prioridade manual (a calculada fica à parte).

# Pesquisas por link
1) Construa a pesquisa :: NPS (0–10), satisfação (1–5), escala, escolha única ou múltipla, sim/não e texto. Mudar as perguntas cria nova versão.
2) Defina o destino de cada resposta :: Só guardar; NPS ou satisfação da conta; interesse, posicionamento, e-mail ou telefone da pessoa (estes sempre com revisão).
3) Convide :: Convite individual para a conta e, se mexe em dados de pessoa, para uma pessoa da conta; prazo de 7 a 60 dias; envio por e-mail ou link copiado.
4) Revise :: "Respostas que mudam o cadastro" mostra antes → depois; aplicar ou rejeitar com motivo.
:::atencao
O poder de influência de um stakeholder **nunca** é alterado por pesquisa.
:::
NPS e CSAT recebidos concluem o marco de pesquisa da jornada e viram o evento "Pesquisa respondida" para metas e indicadores.
`,
};

export const CH_MARKETING: ManualChapter = {
  slug: 'marketing', type: 'procedimento', title: 'Marketing: leads, ABM, campanhas, quadro de tarefas e brindes',
  description: 'Leads e conversão, ABM com Conta 360, stakeholders, plays, sinais e cadências, campanhas com ROI, quadro de tarefas em Sprint e controle de brindes.',
  keywords: ['marketing', 'leads', 'abm', 'stakeholders', 'plays', 'sinais', 'campanha', 'sprint', 'fura-fila', 'brindes'],
  src: `
# Leads
@ /leads Abrir Leads
Indicadores e abas por situação; lista com busca, filtros e ordenação; atribuição em massa (exige nível Equipe, auditada); **converter em oportunidade** mantém o vínculo e o histórico. Leads também chegam sozinhos pelas integrações: formulário do site, WhatsApp (Z-API ou Cloud API) e Lead Ads do Facebook/Instagram.

# ABM — contas estratégicas
@ /abm Abrir ABM
- **Entrar no programa:** "Adicionar ao ABM" na ficha de uma conta (reaproveita tudo) ou nova organização, com checagem de duplicidade por CNPJ, raiz do CNPJ, nome parecido e cidade.
- **Status ABM** (transições; pausar e encerrar pedem motivo), prioridade, responsável, objetivo e próximo passo — tudo com histórico.
- **Conta 360:** classificação estratégica, responsáveis, objetivos (com critério de sucesso e resultado), estrutura da organização (unidades e secretarias), leads, oportunidades, contratos e histórico unificado de interações.

## Stakeholders e influência
Pessoas ligadas à conta com papéis (quem decide, aprova o gasto, avalia, usa, fiscaliza), classificações (interesse, posicionamento, relacionamento, acesso, participação, prioridade) e **poder de influência por contexto**, sempre manual e justificado. A empresa define quem vê e edita a influência e se a mudança exige aprovação. Mapa **influência × interesse**, relações entre stakeholders e mapa das relações entre contas.

## Cobertura de stakeholders
Nota de 0 a 100 explicada item a item (papéis-chave, influência avaliada, relacionamento com quem tem influência alta, defensor, departamentos). "Não avaliado" é lacuna, nunca estimativa.

## Plays, sinais e cadências
- **Plays:** biblioteca versionada; aplicar à conta ou a uma pessoa transforma cada etapa em tarefa com prazo; encerrar com resultado.
- **Sinais:** detectados nos dados (sem contato além do limite da prioridade, play atrasado, contrato vencendo, oportunidade parada, NPS detrator…) ou registrados pela equipe; estados novo → em análise → tratado/descartado; criar tarefa a partir do sinal.
- **Cadências:** contato a cada N dias por conta ou pessoa; a próxima tarefa nasce perto do prazo, sem duplicar.

## Inteligência do ABM
Prospecção, stakeholders, relacionamento, plays, comercial e NPS do período, com atalhos para as metas do ABM.

# Campanhas
@ /campaigns Abrir Plays/Campanhas
Campanha com concepção, orçamento, gastos lançados, leads, vendas atreladas e **ROI**.

# Quadro de tarefas do Marketing
@ /marketing/quadro Abrir o Quadro de tarefas
Funcionalidade **Quadro de tarefas do Marketing**. Segue os ritos de Sprint quinzenal:
- **Colunas:** Backlog, A fazer, Em execução, Em revisão e Concluído.
- **Cartão:** um responsável e observadores, briefing, prazo, prioridade, vertical (Arte, Ciência, Disciplina, Interno, Tráfego) e alocação (70% estratégia comercial, 20% apoio interdepartamental, 10% testes).
- **Limite de 3 tarefas em execução por pessoa.**
- **Resumo no topo:** andamento da Sprint, atrasadas, vencendo hoje e em breve, carga por pessoa e a divisão 70/20/10. Alertas de vencimento vão para o responsável.
- **Etiquetas** relacionam oportunidades, contas, leads, campanhas, contratos e tarefas às ações do marketing.
- **Orçamento e brindes** atrelados ao cartão (itens aprovados dos centros de custo).
1) Planejar a Sprint :: 15 dias, objetivo e entregas.
2) Abrir :: O escopo congela; o sistema monta a comunicação oficial de abertura para revisar e enviar.
3) Fura-fila :: Demanda nova dentro da Sprint aberta entra como fura-fila, com critério (receita, risco, obrigação, oportunidade); só a liderança aprova ou recusa.
4) Encerrar :: Pendentes voltam para A fazer; a comunicação de encerramento lista entregas, destaques e reprogramações.

# Brindes
@ /brindes Abrir Brindes
Itens com estoque, custo médio e fornecedor; kits com categoria e custo; entradas e ajustes; **envio** de kit ou itens para a conta e os stakeholders (baixa o estoque; cancelar devolve); consumo por item, kit, categoria e conta.
`,
};

export const CH_TIMES: ManualChapter = {
  slug: 'gestao-times', type: 'procedimento', title: 'Gestão de Times, desempenho e gamificação',
  description: 'Estrutura organizacional, eventos de negócio, indicadores, metas em cascata, apuração, intervenções com análise e 5W2H, rituais, férias, pedidos de apoio, gamificação, badges e certificados.',
  keywords: ['metas', 'indicadores', 'intervenção', 'rituais', 'ata', 'impedimento', 'férias', 'apoio', 'gamificação', 'badge', 'pontos', 'certificado'],
  src: `
@ /times Abrir o Painel de Gestão de Times
# Estrutura e perspectivas
A **estrutura organizacional** (diretoria, áreas e unidades) liga os times às lideranças, gestores e substitutos; o centro de custo do time acompanha. As perspectivas **Diretoria, Gestão e Liderança** mostram as metas do escopo de cada um com semáforo.

# Eventos de negócio
Tudo o que acontece (venda fechada, tarefa concluída no prazo, e-mail respondido, play encerrado, pesquisa respondida…) vira **evento de negócio** com crédito para as pessoas. Eventos podem ser validados ou invalidados com motivo; quem recebeu o crédito não valida o próprio evento. O catálogo mostra a origem de cada evento.

# Indicadores, objetivos e metas
- **Indicadores** são definidos no construtor (sem código), versionados, com sugestões prontas; teste antes de salvar e veja o detalhamento dos eventos que compõem o resultado.
- **Objetivos** estratégicos, táticos e operacionais.
- **Metas** individuais, de equipe, de área ou da empresa, desdobradas em cascata, com realizado, ritmo e semáforo. Depois do início, mudar o alvo exige motivo e autorização de quem lidera; o original fica guardado. Quem não tem alçada pede revisão.
- **Scorecards por função**, com pesos e composição para quem tem mais de uma função.
- **Apuração:** cada competência é apurada e validada (quem é avaliado não valida o próprio resultado); retificar gera nova versão.

@ /times/metas Abrir Metas e indicadores

# Intervenções
Meta fora da faixa abre **intervenção** automaticamente (ou manualmente sobre um indicador). O primeiro amarelo pede uma revisão simples; depois vem a **jornada de análise** (problema, Pareto com dados reais, Ishikawa, 5 Porquês) e o **plano 5W2H**, cujas ações nascem como tarefas (ou num projeto ligado). Dispensar exige justificativa de quem está acima.

# Rituais, decisões e impedimentos
- **Rituais** com pauta, presença e anotações; a pauta automática traz as metas e pendências do escopo; ao **encerrar a ata** a pauta é fotografada e os participantes são avisados.
- **Decisões** registradas na reunião, na intervenção ou avulsas, com tarefa de acompanhamento; revogar mantém o histórico.
- **Impedimentos** com responsável por remover, prazo e **escalonamento** para o próximo nível da estrutura.

# Férias
Admissão, períodos aquisitivos e saldo; **sugestão automática** de blocos sem choque no time; programar, confirmar, alterar ou cancelar (tudo com histórico); regras de férias versionadas.

# Pedidos de apoio
Qualquer pessoa pede ajuda ao time ou a um colega, ligada ou não ao item em que está. O colega assume e atende; **os pontos só entram quando quem pediu confirma**.

# Gamificação
Colaborativa, sem ranking. Cada nível tem a sua meta; parte da nota vem da média do time. **Meus pontos** mostra a nota do mês e do ano e a origem de cada ponto (nunca a de colegas). A regra é proposta e aprovada (quem propõe não aprova). A regra vigente:

[[REGRA_GAMIFICACAO]]

## Badges
Reconhecimento por badges, cada uma com faixas que todos podem alcançar. A maior nota do ano recebe o **Badge Ouro**.

[[BADGES]]

## Certificados de cursos complementares
Envie o certificado de um curso da sua área (PDF, PNG ou JPG até 3 MB); a liderança do time valida (nunca o próprio). Aprovado, soma pontos na Badge Crescimento.

# Performance por nível
Atividade e metas (individual, time, área, empresa) com os pesos do nível hierárquico: a sua, a do time que lidera ou a da área.
`,
};

export const CH_PROJETOS: ManualChapter = {
  slug: 'projetos-tarefas', type: 'procedimento', title: 'Projetos e tarefas',
  description: 'Projetos com quadro, marcos e homologação, riscos e impedimentos, frentes de implantação, e a gestão de tarefas com subtarefas, dependências, checklist, tempo e aprovação.',
  keywords: ['projetos', 'tarefas', 'marcos', 'homologação', 'riscos', 'kanban', 'checklist', 'dependência'],
  src: `
# Tarefas
@ /tarefas Abrir Tarefas
As tarefas são do cadastro compartilhado: funcionam mesmo sem o módulo Projetos.
- **Minhas:** Hoje, Próximas, Atrasadas, Aguardando, Delegadas e Concluídas; também Equipe e as ligadas a um registro.
- **Criar:** avulsa, ligada a cliente, oportunidade, contrato, ata ou projeto, ou subtarefa; a partir de modelo.
- **Dentro da tarefa:** subtarefas, **dependências** (bloqueiam a conclusão; ciclos são recusados), checklist item a item, comentários com @menção, **tempo trabalhado** (estorno por lançamento negativo), arquivos e histórico.
- **Aprovação:** tarefa com aprovador só conclui quando ele aceita a entrega (ou devolve com o que falta).
- **Demanda transferida:** quem recebe aceita ou devolve com motivo.
- **Recorrência** e reagendamento; delegar = reatribuir.

# Projetos
@ /projetos Abrir Projetos
1) Criar :: Em branco ou de um modelo (etapas, marcos e tarefas com datas relativas ao início).
2) Equipe :: Gerente, membro ou observador; o responsável é sempre gerente.
3) Quadro :: Etapas com limite; mover para etapa concluída conclui a tarefa. As tarefas do projeto viram atividades do responsável.
4) Marcos :: Com critério de aceite e, quando exigido, **homologação** — por quem não executou tarefas do marco, com nota obrigatória; reprovar reabre o marco.
5) Riscos e impedimentos :: Probabilidade × impacto define o nível; alto ou crítico exige mitigação. Impedimentos aparecem também nos rituais.
6) Encerrar :: Transições válidas; reabrir exige motivo.

:::importante Progresso real
Progresso = marcos homologados ÷ marcos que exigem homologação. Marco concluído e não homologado não conta.
:::
O **painel das frentes** mostra, por frente de uma iniciativa, o progresso real, o marco atual, a próxima ação, impedimentos e riscos. "Criar frentes da implantação" gera um projeto por frente a partir do modelo "Implantação de módulo".
`,
};

export const CH_ORCAMENTO: ManualChapter = {
  slug: 'orcamento', type: 'procedimento', title: 'Recursos e Orçamento',
  description: 'Plano de contas e centros de custo, planejamento trimestral com aprovação em duas alçadas, Budget Guardião, gastos com comprovante, revisão mensal, ferramentas, softwares, contratos e compras.',
  keywords: ['orçamento', 'centro de custo', 'budget guardião', 'gasto', 'compras', 'fornecedores', 'softwares', 'equipamentos'],
  src: `
@ /orcamento Abrir Planejamento orçamentário
# Papéis por centro de custo
| Papel | Quem pode ser | O que faz |
| Dono do orçamento | Gerência, Diretoria ou Administrador (mais de um permitido) | Planeja e responde pelo centro |
| Responsável pela execução | Supervisão ou gestor | Lança os gastos dentro do aprovado |
Tudo é ligado pelo **centro de custo**; cada time tem o seu.

# Ciclo do trimestre
1) Plano de contas :: Categorias e subcategorias com código hierárquico; o sistema sugere o plano e os centros pela política.
2) Planejar itens :: O quê, como, quando, conta e valor. Softwares, licenças, contratos e assinaturas ativos do centro podem ser trazidos com o valor recorrente.
3) Enviar :: O planejamento da liderança vai à Gerência; o da Gerência, à Diretoria.
4) Aprovar :: Gerência aprova (segue à Diretoria) ou devolve; Diretoria dá a aprovação final.
5) Executar :: Lançar gasto com comprovante exige checagem prévia com o Financeiro e saldo aprovado.
6) Revisão mensal :: Planejado × realizado por categoria; desvio acima de 15% pede justificativa.

:::atencao Budget Guardião
Acima do saldo, só com **Budget Guardião**: a Gerência pede ajuste no total do centro com justificativa e a Diretoria decide. Remanejar saldo entre contas do mesmo centro é da Gerência e não muda o total.
:::

# Recursos
- **Ferramentas e equipamentos:** responsável, situação (em uso, estoque, manutenção, baixado) e valor contábil com depreciação linear.
- **Softwares e licenças / Contratos e assinaturas:** custo mensal, cotação, forma de pagamento, revisão — **sem credenciais** (use o cofre da empresa).
- **Compras e fornecedores:** pedido com especificação completa e o que a política exige (Financeiro, cotação, Jurídico, Diretoria), cotações e fornecedor escolhido.
- **Custos e indicadores:** orçado × realizado por centro, categoria e mês; recorrentes, ativos e Guardião.
`,
};
