/**
 * Conteúdo do Tour RevOps. Tudo o que está aqui existe no sistema e está descrito no Manual do sistema
 * (Central de Playbooks → Manual do sistema). Ao mudar um módulo, atualize o capítulo do manual e este texto.
 */

/** As paradas da jornada do cliente, na ordem em que a receita acontece. */
export const STATIONS = [
  { key: 'atracao', label: 'Atração', hint: 'Leads, ABM e campanhas' },
  { key: 'oportunidade', label: 'Oportunidade', hint: 'Funil e negociação' },
  { key: 'proposta', label: 'Proposta e aprovação', hint: 'Proposta, alçadas e viabilidade' },
  { key: 'licitacao', label: 'Licitação', hint: 'Pregão e atas (setor público)' },
  { key: 'contrato', label: 'Contrato', hint: 'Cadastro, documentos e assinatura' },
  { key: 'implantacao', label: 'Implantação', hint: 'Kickoff, marcos e projetos' },
  { key: 'sucesso', label: 'Sucesso do cliente', hint: 'Saúde, visitas e pesquisas' },
  { key: 'renovacao', label: 'Renovação', hint: 'Reajuste, ofício e renovação' },
] as const;
export type StationKey = (typeof STATIONS)[number]['key'];

export type Highlight = { t: string; d: string };
export type ModuleSlide = {
  kind: 'module';
  key: string;
  /** grupo do menu onde o módulo fica */
  area: string;
  title: string;
  /** uma frase: o problema que o módulo resolve */
  purpose: string;
  who: string[];
  /** paradas da jornada em que o módulo atua; vazio = atravessa a jornada inteira */
  stations: StationKey[];
  highlights: Highlight[];
  /** a frase para a diretoria guardar */
  takeaway: string;
  link: { to: string; label: string };
};
export type Slide =
  | { kind: 'cover'; key: string }
  | { kind: 'journey'; key: string }
  | { kind: 'foundation'; key: string }
  | { kind: 'layer'; key: string }
  | ModuleSlide
  | { kind: 'start'; key: string };

const m = (x: Omit<ModuleSlide, 'kind'>): ModuleSlide => ({ kind: 'module', ...x });

export const MODULES: ModuleSlide[] = [
  m({
    key: 'marketing', area: 'Marketing', title: 'Leads, ABM e campanhas', stations: ['atracao'],
    purpose: 'Transformar contatos em demanda qualificada e cuidar das contas estratégicas antes mesmo da venda.',
    who: ['Marketing', 'Comercial', 'Gestão'],
    highlights: [
      { t: 'Leads de todos os canais', d: 'Formulário do site, WhatsApp, Lead Ads (Facebook e Instagram) e cadastro manual entram como lead, com origem e responsável.' },
      { t: 'ABM: Conta 360', d: 'Contas estratégicas com objetivos, estrutura da organização, oportunidades, contratos e histórico unificado.' },
      { t: 'Stakeholders e influência', d: 'Mapa de pessoas da conta com classificação IA, INA, NIA e NINA e cobertura de relacionamento.' },
      { t: 'Plays, sinais e cadências', d: 'Plays viram tarefas com prazo; sinais detectados nos dados (contrato vencendo, NPS detrator…) avisam a equipe.' },
      { t: 'Quadro de tarefas do Marketing', d: 'Sprint com Backlog → Concluído, limite de 3 tarefas em execução por pessoa e divisão 70/20/10.' },
      { t: 'Brindes', d: 'Estoque, kits e envios para a conta e os stakeholders, com o consumo por conta.' },
    ],
    takeaway: 'Toda ação de marketing fica ligada a uma conta, a uma oportunidade ou a uma campanha: o retorno pode ser medido.',
    link: { to: '/leads', label: 'Abrir Leads' },
  }),
  m({
    key: 'crm', area: 'Comercial', title: 'Oportunidades e negociação', stations: ['oportunidade'],
    purpose: 'Conduzir cada venda por um funil com exigências claras por etapa, sem perder histórico.',
    who: ['Vendas', 'Supervisão', 'Gerência'],
    highlights: [
      { t: 'Kanban e lista', d: 'Indicadores da carteira, colunas por etapa com quantidade e valor, filtros que viram link compartilhável.' },
      { t: 'Etapas com exigências', d: 'O servidor confere o que cada etapa pede; se faltar algo, a mensagem diz exatamente o quê.' },
      { t: 'Tela da negociação', d: 'Deal e conta, histórico, produtos e serviços, tarefas, anexos, chamados no GLPI e chat interno numa tela só.' },
      { t: 'Tempo em cada etapa', d: 'A faixa de etapas mostra quantos dias a negociação ficou em cada uma, inclusive quando voltou.' },
      { t: 'Contas e atividades', d: 'Ficha da conta com contratos, faturas e ordens do IXC, ocorrências e agenda de atividades com roteiro.' },
      { t: 'Jornada com pontos', d: 'Tarefas da etapa concluídas no prazo geram pontos; a venda fechada é comemorada com o time.' },
    ],
    takeaway: 'O funil mostra o que realmente está andando: cada etapa tem regra, cada mudança tem dono e data.',
    link: { to: '/opportunities', label: 'Abrir Oportunidades' },
  }),
  m({
    key: 'aprovacoes', area: 'Comercial', title: 'Propostas, aprovações e viabilidade', stations: ['proposta'],
    purpose: 'Dar velocidade à proposta sem abrir mão do controle de preço, desconto e margem.',
    who: ['Vendas', 'Liderança', 'Diretoria'],
    highlights: [
      { t: 'Propostas em PDF', d: 'Modelos com a arte da marca e campos posicionados; envio por e-mail com leitura registrada ou por WhatsApp.' },
      { t: 'Alçadas de desconto', d: 'O sistema indica quem decide (Supervisão, Gerência ou Diretoria) pela tabela de descontos.' },
      { t: 'Ninguém aprova o próprio pedido', d: 'Só quem tem cargo de liderança decide, dentro da alçada do seu perfil.' },
      { t: 'Viabilidade econômica', d: 'DRE, custos, tributos e fluxo de caixa calculados no servidor e guardados como fotografia auditável.' },
      { t: 'Financial Studio', d: 'As fórmulas do motor financeiro ficam visíveis e governadas em Configurações.' },
    ],
    takeaway: 'Cada desconto e cada margem aprovada tem fundamento, alçada e registro: dá para explicar qualquer preço depois.',
    link: { to: '/aprovacoes', label: 'Abrir Aprovações' },
  }),
  m({
    key: 'licitacoes', area: 'Comercial e Contratos', title: 'Licitações e Atas de Registro de Preço', stations: ['licitacao'],
    purpose: 'Disputar e administrar o mercado público com inteligência de preço e controle de saldo.',
    who: ['Licitações', 'Comercial', 'Jurídico', 'Gerência'],
    highlights: [
      { t: 'Pregão e concorrentes', d: 'Participantes por lote, nosso lance, linha do tempo de lances, recursos e impugnações.' },
      { t: 'Resultado por item', d: 'Nosso preço final e o da vencedora, mesmo depois do encerramento.' },
      { t: 'Inteligência de concorrentes', d: 'Por CNPJ: disputas, vitórias, lances médio e mínimo e histórico de preços por item.' },
      { t: 'Atas com saldo por órgão', d: 'Itens, órgãos participantes, reservas por oportunidade e alertas de saldo.' },
      { t: 'Adesões e operações', d: 'Pedidos de adesão com limites conferidos na hora; conversões e remanejamentos simulados e aprovados.' },
    ],
    takeaway: 'O histórico de preços dos concorrentes vira vantagem no próximo pregão.',
    link: { to: '/contracts?t=atas', label: 'Abrir Atas' },
  }),
  m({
    key: 'contratos', area: 'Gestão de Contratos', title: 'Gestão de Contratos', stations: ['contrato', 'renovacao'],
    purpose: 'Garantir que cada contrato seja cumprido, medido, reajustado e renovado no tempo certo.',
    who: ['Contratos', 'Financeiro', 'Jurídico', 'Gerência'],
    highlights: [
      { t: 'Painel e Central de atenção', d: 'Faturamento por tipo, carteira, vencimentos e risco; uma fila única por gravidade, prazo e valor.' },
      { t: 'Processos por setor', d: 'Cada setor conclui suas etapas; atrasos e validações aparecem na Central de atenção.' },
      { t: 'Reajuste e renovação com ofício', d: 'Índice do Banco Central, ofício numerado em PDF e aplicação com conferência do resultado.' },
      { t: 'Medição e empenhos', d: 'Extrato do saldo, indicador de consumo, relatório de medição mensal e controle de empenhos.' },
      { t: 'Documentos e assinatura', d: 'Versões, modelos .docx com variáveis e assinatura eletrônica pela ZapSign.' },
      { t: 'Calendário e relatórios', d: 'Término, renovação, reajuste e garantias num calendário; vencimentos do mês com CSV.' },
    ],
    takeaway: 'Nenhum vencimento, reajuste ou saldo de medição passa sem alguém responsável e um prazo.',
    link: { to: '/contracts?t=painel', label: 'Abrir Contratos' },
  }),
  m({
    key: 'implantacao', area: 'Sucesso do Cliente e Projetos', title: 'Implantação e projetos', stations: ['implantacao'],
    purpose: 'Começar a relação com o cliente com um plano claro, marcos visíveis e tarefas com dono.',
    who: ['CS', 'Projetos', 'Operação'],
    highlights: [
      { t: 'Jornada aberta pelo contrato', d: 'A validação do contrato abre a jornada do cliente com marcos para concluir, reabrir ou reprogramar.' },
      { t: 'Kickoff versionado', d: 'Apresentação de kickoff a partir de modelos, com link autorizado para o cliente acompanhar.' },
      { t: 'Trilha compartilhada', d: 'Link externo com prazo e código opcional; revogar corta o acesso na hora.' },
      { t: 'Projetos e marcos', d: 'Projetos com marcos e quadro de tarefas, incluindo os projetos de licitação.' },
      { t: 'Tarefas que não se perdem', d: 'Subtarefas, dependências, checklist, tempo trabalhado, aprovação da entrega e recorrência.' },
    ],
    takeaway: 'O cliente enxerga o próprio andamento; a empresa enxerga quem está devendo o próximo passo.',
    link: { to: '/projetos', label: 'Abrir Projetos' },
  }),
  m({
    key: 'sucesso', area: 'Sucesso do Cliente', title: 'Sucesso do Cliente', stations: ['sucesso'],
    purpose: 'Manter a base saudável, perceber o risco de cancelamento cedo e crescer dentro da carteira.',
    who: ['CSM', 'Gestão de CS', 'Diretoria'],
    highlights: [
      { t: 'Tier, IPC e saúde', d: 'Tier pelo valor anual consolidado; score IPC com critérios objetivos e qualitativos; criticidade com motivo.' },
      { t: 'Carteira equilibrada', d: 'Distribuição entre CSMs por valor e quantidade, com cobertura e capacidade por equipe.' },
      { t: 'Visitas e acompanhamentos', d: 'Agenda, resumo, demandas, riscos, oportunidades e próximos passos de cada visita.' },
      { t: 'Planos de ação', d: 'Passos que viram tarefas, risco de cancelamento e prioridade manual separada da calculada.' },
      { t: 'Pesquisas por link', d: 'NPS, satisfação e escalas; respostas que mudam o cadastro passam por revisão antes de valer.' },
    ],
    takeaway: 'As prioridades do dia mostram quais contas críticas estão sem ação; nada depende de memória.',
    link: { to: '/sucesso', label: 'Abrir Sucesso do Cliente' },
  }),
  m({
    key: 'times', area: 'Gestão de Times', title: 'Gestão de Times', stations: [],
    purpose: 'Transformar metas em rotina: cada pessoa sabe o que se espera dela e a liderança age antes do fim do mês.',
    who: ['Liderança', 'Gerência', 'Todos'],
    highlights: [
      { t: 'Indicadores sem código', d: 'Construídos sobre os eventos de negócio, versionados e testados antes de salvar.' },
      { t: 'Metas em cascata', d: 'Individual, de equipe, de área e da empresa, com realizado, ritmo e semáforo.' },
      { t: 'Apuração validada', d: 'Quem é avaliado não valida o próprio resultado; retificar gera nova versão.' },
      { t: 'Intervenções e rituais', d: 'Meta fora da faixa pede plano de ação; rituais com pauta automática, decisões e impedimentos escalados.' },
      { t: 'Gamificação colaborativa', d: 'Sem ranking: cada nível tem sua meta, parte da nota vem do time; badges que todos podem alcançar.' },
      { t: 'Férias e pedidos de apoio', d: 'Sugestão de férias sem choque no time; ajuda entre colegas com pontos confirmados por quem pediu.' },
    ],
    takeaway: 'O painel mostra performance, metas, equilíbrio do time, intervenções e férias de cada time num olhar.',
    link: { to: '/times', label: 'Abrir Gestão de Times' },
  }),
  m({
    key: 'orcamento', area: 'Recursos e Orçamento', title: 'Recursos e Orçamento', stations: [],
    purpose: 'Planejar e executar o gasto por centro de custo, com governança do pedido até o pagamento.',
    who: ['Donos do orçamento', 'Financeiro', 'Diretoria'],
    highlights: [
      { t: 'Central do orçamento', d: 'Planejado, aprovado, reservado, comprometido, realizado e pago, com filtros e evolução mês a mês.' },
      { t: 'Aprovação por etapa', d: 'Gerência e Diretoria decidem em lote, item a item; quem pede não decide.' },
      { t: 'Budget Guardião', d: 'Excedente só com justificativa formal e aprovação da Diretoria, contra a reserva do centro.' },
      { t: 'Fechamento e revisões', d: 'Fechamento mensal validado, revisões numeradas e projeção até o fim do ano.' },
      { t: 'Ferramentas, softwares e contratos', d: 'Custo recorrente, renovação e pendências numa tabela, sem guardar senhas.' },
      { t: 'Eficiência', d: 'Custo × resultado em Inteligência, com a fonte de cada número.' },
    ],
    takeaway: 'Nenhum real sai do planejado sem aprovação registrada; o excedente tem dono e justificativa.',
    link: { to: '/orcamento', label: 'Abrir o Orçamento' },
  }),
  m({
    key: 'inteligencia', area: 'Relatórios e Inteligência', title: 'Relatórios e Inteligência', stations: [],
    purpose: 'Responder às perguntas da diretoria com números que vêm direto da operação.',
    who: ['Diretoria', 'Gerência', 'Supervisão'],
    highlights: [
      { t: 'Indicadores principais', d: 'Painel da diretoria com KPIs, metas por trimestre e farol de atingimento, também em modo TV.' },
      { t: 'Conversão e tempo por etapa', d: 'Por funil e coorte: quem chegou, avançou, perdeu ou parou e onde está a maior queda.' },
      { t: 'Receita da base', d: 'Recorrente, medição e frequente por mês contra o ano anterior sem o efeito do reajuste.' },
      { t: 'Mapa de calor', d: 'A base de clientes pelo endereço, sobre a malha do IBGE.' },
      { t: 'Fluxo de caixa consolidado', d: 'Das oportunidades com viabilidade salva.' },
      { t: 'Relatórios com CSV', d: 'Exportação controlada por permissão; quem não vê valores vê "—".' },
    ],
    takeaway: 'Os números da reunião são os mesmos da operação: ninguém monta planilha paralela.',
    link: { to: '/intelligence', label: 'Abrir Inteligência' },
  }),
  m({
    key: 'pessoas', area: 'Pessoas & Gestão', title: 'Pessoas & Gestão', stations: [],
    purpose: 'Aproximar as pessoas, reconhecer o bom trabalho e garantir que a comunicação oficial chegue.',
    who: ['Todos', 'Pessoas e Cultura', 'Liderança'],
    highlights: [
      { t: 'Feed e comunidades', d: 'Publicações, menções e comunidades públicas, institucionais ou privadas, com moderação.' },
      { t: 'Reconhecimento', d: 'Público ou privado, por categorias definidas por Pessoas e Cultura.' },
      { t: 'Comunicados com ciência', d: 'Público por unidade, time ou cargo, com confirmação de leitura e quem ainda não confirmou.' },
      { t: 'Feedback', d: 'Feedback entre pessoas, com ciência e mediação confidencial quando necessário.' },
      { t: 'Mensagens', d: 'Conversas diretas e grupos, sem sair do sistema.' },
    ],
    takeaway: 'Comunicado importante tem alcance medido: a liderança sabe quem leu.',
    link: { to: '/pessoas', label: 'Abrir Pessoas & Gestão' },
  }),
  m({
    key: 'playbooks', area: 'Central de Playbooks', title: 'Playbooks, treinamento e manual', stations: [],
    purpose: 'Registrar como a empresa trabalha, treinar com prova e manter tudo atualizado e aprovado.',
    who: ['Todos', 'Liderança', 'Diretoria'],
    highlights: [
      { t: 'Wiki com aprovação', d: 'Gerência e Diretoria aprovam; a Diretoria homologa com data de vigência. O autor não decide a própria versão.' },
      { t: 'Ciência da versão vigente', d: 'Cada pessoa confirma que leu; mudança relevante pede ciência de novo.' },
      { t: 'Provas e certificados', d: 'Certificado em PDF com código de verificação; cursos contam na gamificação.' },
      { t: 'Revisão periódica', d: 'Alertas antes do vencimento e indicadores de disseminação por time.' },
      { t: 'Manual do sistema', d: 'Todos os módulos, perfis, integrações, a API e os padrões de design, gerados a partir do próprio sistema.' },
    ],
    takeaway: 'O jeito certo de fazer está escrito, aprovado e com a ciência de quem precisa saber.',
    link: { to: '/playbooks', label: 'Abrir a Central de Playbooks' },
  }),
  m({
    key: 'email', area: 'E-mail', title: 'E-mail corporativo', stations: [],
    purpose: 'Atender o cliente pelo e-mail sem sair do contexto da conta e sem perder prazo de resposta.',
    who: ['Comercial', 'CS', 'Contratos'],
    highlights: [
      { t: 'Caixas pessoais e compartilhadas', d: 'Gmail pela API do Google ou senha de app; a pessoal só a dona vê.' },
      { t: 'Filas com prazo', d: 'Direcionamento manual, rodízio ou dono da conta, com prazo de primeira resposta.' },
      { t: 'Regras de entrada', d: 'Remetente, domínio, assunto e texto levam a fila, prioridade, etiqueta ou arquivo.' },
      { t: 'Assinatura padronizada', d: 'Configurada no perfil, vai em todos os e-mails novos e respostas.' },
    ],
    takeaway: 'Nenhum e-mail de cliente fica sem dono: a fila mostra o que está vencendo.',
    link: { to: '/email', label: 'Abrir E-mail' },
  }),
  m({
    key: 'configuracao', area: 'Configuração', title: 'Configuração, segurança e integrações', stations: [],
    purpose: 'Deixar o sistema do jeito da empresa, com acesso controlado e os sistemas conversando.',
    who: ['Administração', 'Gerência', 'Diretoria'],
    highlights: [
      { t: 'Perfis e níveis', d: 'Próprio, Equipe ou Total por módulo; cargo no setor define quem aprova.' },
      { t: 'Módulos e liberação', d: 'Ligar, desligar e liberar por equipe ou pessoa, com prévia do acesso efetivo.' },
      { t: 'Ações sensíveis e acesso por IP', d: 'Ver valores, exportar e validar contrato por perfil; acesso só de redes autorizadas.' },
      { t: 'Jornadas e automações', d: 'Funis, etapas com exigências, campos personalizados e automações com registro.' },
      { t: 'Integrações', d: 'IXC, GLPI, Gmail, WhatsApp, Lead Ads, ZapSign, Banco Central, ViaCEP e RD Station.' },
      { t: 'Histórico que não se apaga', d: 'Logs e auditoria de quem fez o quê, quando e por quê.' },
    ],
    takeaway: 'Cada pessoa vê o que precisa ver, e cada mudança importante deixa rastro.',
    link: { to: '/settings', label: 'Abrir Configuração' },
  }),
];

export const SLIDES: Slide[] = [
  { kind: 'cover', key: 'capa' },
  { kind: 'journey', key: 'jornada' },
  { kind: 'foundation', key: 'fundamentos' },
  ...MODULES.filter((x) => x.stations.length),
  { kind: 'layer', key: 'camada' },
  ...MODULES.filter((x) => !x.stations.length),
  { kind: 'start', key: 'comecar' },
];

export const FOUNDATION: Highlight[] = [
  { t: 'Um cadastro só', d: 'Contas e pessoas são as mesmas em todos os módulos: a oportunidade vira contrato e o contrato abre a jornada.' },
  { t: 'Cada ação vira evento', d: 'Os eventos de negócio alimentam metas, indicadores e a gamificação sem digitação dupla.' },
  { t: 'Quem pede não decide', d: 'Aprovações por alçada e cargo de liderança em descontos, viabilidade, orçamento, metas e playbooks.' },
  { t: 'Histórico que não se apaga', d: 'Correções viram registros novos: fica claro quem fez, quando e por quê.' },
  { t: 'Valores protegidos', d: 'Quem não tem a permissão de ver valores financeiros vê "—" em qualquer tela ou planilha.' },
  { t: 'Funciona no celular', d: 'As telas se reorganizam em colunas ou abas em telas pequenas.' },
];

export const START_BY_PROFILE: [string, string][] = [
  ['Operação', 'Início, Oportunidades, Atividades e Tarefas; depois o capítulo do seu módulo no manual'],
  ['Supervisão', 'Painel de Gestão de Times, Aprovações, Acompanhamento do time e Rituais'],
  ['Gerência', 'Aprovações, Central de atenção de contratos, Planejamento orçamentário e Configurações'],
  ['Diretoria', 'Inteligência → Indicadores principais e as aprovações finais (orçamento, playbooks, viabilidade)'],
  ['Administração', 'Configurações → Permissões, Integrações e Personalização'],
];
