/** Manual do sistema — capítulos de uso (parte 1): visão geral, CRM, licitações e atas, contratos. */
import type { ManualChapter } from './types';

export const CH_VISAO: ManualChapter = {
  slug: 'visao-geral', type: 'integracao', title: 'Manual do RevOps: visão geral e primeiros passos',
  description: 'O que é o RevOps, como entrar, como a tela é organizada, os conceitos que valem em todo o sistema e por onde começar em cada perfil.',
  keywords: ['manual', 'revops', 'início', 'primeiros passos', 'navegação', 'login'],
  src: `
:::importante Como usar este manual
O Manual do RevOps é um conjunto de playbooks da categoria **Manual do sistema**. Este é o ponto de partida; cada módulo tem o seu capítulo, e há capítulos técnicos para a **API** e para os **padrões de design**. Use a busca da Central de Playbooks para achar qualquer assunto.
:::

# O que é o RevOps
O RevOps (ISP Sprint) é a plataforma de receita da empresa: reúne num lugar só o funil comercial, as propostas e aprovações, os contratos e a sua execução, o pós-venda (Sucesso do Cliente), o marketing, a gestão do time, os projetos, o orçamento, a comunidade interna e esta wiki de playbooks.

Tudo funciona sobre o mesmo cadastro de contas e pessoas: a oportunidade vira contrato, o contrato abre a jornada do cliente, e cada ação gera eventos que alimentam metas, indicadores e a gamificação.

| Módulo | Para que serve |
| CRM | Oportunidades, negociação, propostas, aprovações, contas, atividades, Sucesso do Cliente, e-mail e chamados no GLPI |
| Marketing | Leads, ABM (contas estratégicas), campanhas, quadro de tarefas do Marketing e brindes |
| Produto | Catálogo de planos e produtos para consulta |
| Gestão de Times | Metas, indicadores, apuração, intervenções, rituais, férias, pedidos de apoio e gamificação |
| Contratos | Contratos, processos por setor, renovações, reajustes, ofícios, empenhos, medição, atas e modelos |
| Projetos | Projetos, marcos, quadro de tarefas e projetos de licitação |
| Relatórios | Relatórios e Inteligência (comercial e de contratos) |
| Recursos e Orçamento | Planejamento por centro de custo, gastos, Budget Guardião, ferramentas, softwares, contratos e compras |
| Pessoas & Gestão | Comunidade (feed, comunidades, reconhecimento, comunicados, mensagens) e Feedback |

Cada empresa liga ou desliga módulos e funcionalidades em **Configurações → Permissões → Módulos e liberação**. Se você não vê um menu, ou ele está desligado na empresa, ou o seu perfil não tem acesso.

# Entrar no sistema
1) Abra o endereço da empresa :: Use o navegador do computador ou do celular; a tela se adapta.
2) Entre com e-mail e senha ou com o Google :: O botão do Google só aparece quando a empresa configurou o login com Google; a conta precisa ter o mesmo e-mail do cadastro.
3) Esqueceu a senha? :: Clique em "Esqueci a senha". O link chega por e-mail, vale uma vez e, ao criar a senha nova, as outras sessões são encerradas.
4) Primeiro acesso :: Quem cadastra o usuário recebe uma senha temporária mostrada uma única vez. Troque em Meu perfil.

:::atencao Bloqueios de segurança
Muitas tentativas erradas bloqueiam o login por alguns minutos. Se a empresa ligou o **acesso por IP**, só entra quem está numa rede autorizada (ou quem tem exceção individual).
:::

# A tela
- **Menu lateral:** os módulos que você pode usar, agrupados (Comercial, Gestão de Contratos, Marketing, Gestão de Times, Projetos, Recursos e Orçamento…). Pode ser recolhido.
- **Busca global:** tecla **/** em qualquer tela.
- **Nova oportunidade:** tecla **N** ou o botão do topo.
- **Sino:** avisos (tarefas vencidas, menções, aprovações, impedimentos escalados).
- **Tema:** claro, escuro ou o do sistema, no menu do usuário.
- **Meu perfil:** nome, cargo, foto, senha e assinatura de e-mail.
- **Tour RevOps:** no fim do menu lateral; apresentação em tela cheia da jornada do cliente e de cada módulo, para apresentar à diretoria ou a quem chega (setas para navegar, F para tela cheia, I para o índice, Esc para sair).

@ / Abrir o Início
@ /settings/profile Abrir Meu perfil

# Conceitos que valem em todo o sistema
## Módulo, perfil e nível
Cada pessoa tem um **perfil** (Administrador, Diretoria, Gerência, Supervisão ou Operação). O perfil define o **nível** em cada módulo: **Próprio** (só a sua carteira), **Equipe** (os times que você lidera), **Total** (a empresa toda) ou **Sem acesso**. Detalhes no capítulo *Perfis, níveis e permissões*.

## Cargo no setor
Além do perfil, cada pessoa tem um **cargo no setor**: **Observador** (só acompanha), **Operador** (executa e conclui etapas) ou **Liderança / gestor** (executa e aprova). Só Liderança / gestor entra na lista de aprovadores.

## Histórico que não se apaga
Mudanças importantes (etapas, aprovações, versões de contrato, metas, lançamentos financeiros, decisões) são gravadas como **registros novos**. Corrigir não apaga o anterior: o histórico mostra quem fez, quando e por quê. Excluir, quando permitido, tira o registro das telas mas mantém a auditoria.

## Salvamento e conflitos
Muitas telas salvam sozinhas (indicador "Salvo"). Se outra pessoa salvou o mesmo registro antes, o sistema avisa o conflito em vez de sobrescrever; recarregue e refaça.

## Valores
Valores em R$ seguem o formato brasileiro. Quem não tem a permissão **Ver valores financeiros** vê "—" no lugar de qualquer valor, em qualquer tela, relatório ou planilha.

# Por onde começar
| Perfil | Comece por |
| Operação (vendas, CS, contratos, marketing) | Início, Oportunidades, Atividades e Tarefas; depois o capítulo do seu módulo |
| Supervisão | Painel de Gestão de Times, Aprovações, Acompanhamento do time e Rituais |
| Gerência | Aprovações, Central de atenção de contratos, Planejamento orçamentário e Configurações |
| Diretoria | Inteligência → Indicadores principais, aprovações finais (orçamento, playbooks, viabilidade) |
| Administrador | Configurações → Permissões, Integrações e Personalização |

??Não vejo um menu que meu colega vê. Por quê?
=> O módulo pode estar liberado só para algumas equipes ou pessoas, a funcionalidade pode estar desligada, ou o seu perfil tem nível "Sem acesso". Quem administra confere em Configurações → Permissões → Módulos e liberação (há uma prévia do acesso efetivo de cada usuário).
??Apaguei algo por engano. Dá para recuperar?
=> Quase tudo fica no histórico e na auditoria. Fale com a gerência: Configurações → Logs mostra quem fez o quê.
??Funciona no celular?
=> Sim. As telas se reorganizam em colunas ou abas em telas pequenas.
`,
};

export const CH_CRM: ManualChapter = {
  slug: 'crm', type: 'comercial', title: 'CRM: oportunidades, negociação, propostas e aprovações',
  description: 'Funil, abertura por tipo de venda, tela da negociação, produtos e serviços, propostas em PDF, aprovações, viabilidade econômica, contas, atividades, chat e chamados no GLPI.',
  keywords: ['crm', 'oportunidade', 'negociação', 'funil', 'proposta', 'aprovação', 'viabilidade', 'contas', 'atividades', 'glpi'],
  src: `
# Oportunidades e funil
@ /opportunities Abrir Oportunidades
A tela **Oportunidades** mostra os indicadores da carteira que você vê e alterna entre **Kanban** (colunas por etapa, com contagem e valor) e **Lista** (tabela com filtros e paginação). Os filtros ficam no endereço da página: copie o link para compartilhar a mesma visão.

- **Mover de etapa:** arraste o cartão (mouse ou teclado) ou use "Mover para". O servidor confere as exigências da etapa; se faltar algo, a mensagem diz o quê.
- **Ver o time:** todos veem as negociações do time em leitura. Mudar o responsável só pode o próprio responsável, a supervisão, a gerência ou a diretoria; quem não pode editar vê o aviso de leitura.
- **Fechadas e perdidas** aparecem na etapa em que a ação aconteceu.

# Abrir uma negociação
1) Clique em Nova oportunidade (tecla N) :: A oportunidade é gravada na hora e abre a tela da negociação.
2) Escolha o tipo de venda :: Licitação, Adesão à Ata, Consumo de Contrato ou Venda Consultiva. Os campos e as etapas mudam conforme o tipo.
3) Informe a filial :: A filial define timbrado, numeração e documentos fiscais.
4) Cliente :: Da carteira (sem pedir CNPJ) ou novo (com CNPJ e endereço; CNPJ repetido é recusado).
5) Iniciar Negociação :: A partir daqui tudo salva sozinho.

:::dica Do e-mail para a negociação
Uma conversa do E-mail corporativo pode virar negociação: o e-mail vira anexo e a resposta ao cliente sai pela mesma conversa.
:::

# A tela da negociação
- **Esquerda — Deal e Conta:** nome, tipo, etapa, responsável, valor, datas; seções recolhíveis com botão Salvar; dados da conta e "Saiba mais sobre a conta" (oportunidades, contratos, projetos e interações da conta).
- **Centro — Acompanhamento:** abas Histórico (comentários, eventos e atividades em ordem), Produtos e serviços, Projetos, Tarefas, Anexos e Chamados GLPI.
- **Direita — Viabilidade e chat:** viabilidade da venda, engenharia (quando exigida) e o chat interno da negociação.
- **Faixa de etapas:** clicável; mostra quantos dias a negociação ficou em cada etapa (com "2×" quando voltou).
- **Celular:** abas "Deal e conta", "Acompanhamento" e "Viabilidade e chat".

## Produtos e serviços
Cada item tem produto/serviço, medida (Un, Km, R$, H), quantidade, valor, desconto, acréscimo e observação. Importe de planilha (Excel/CSV) ou cole do Excel; linhas recusadas voltam com o motivo. **O total vira o valor da oportunidade.** Na licitação, o lance pode ser por item ou global. **Venda fechada exige produtos lançados.**

## Contatos da oportunidade
Várias pessoas da conta, cada uma com o papel na negociação; a primeira é o contato principal. O mesmo e-mail aponta sempre para a mesma pessoa (sem duplicar). Retirar o contato não tira a pessoa da conta.

## Endereços de entrega
Um principal e outros adicionais; os produtos podem ser distribuídos entre eles.

## Pausar, excluir e cancelar
- **Pausar:** a negociação fica na etapa, sem cobrança de próxima ação, com motivo e data opcional para retomar.
- **Excluir:** some das listas, do funil e dos indicadores, mas fica na auditoria. Venda fechada não se exclui: reabra antes.
- **Cliente cancelou:** a supervisão ou a gerência libera a porta da CTO ocupada pela venda.

# Propostas
Ao entrar na etapa **Proposta**, o sistema gera a proposta em PDF sozinho pelo modelo padrão da filial (ou pelo único modelo ativo). Também dá para gerar manualmente: escolha o modelo, confira a **prévia exata** e gere; o PDF é anexado à oportunidade.

- **Modelos de proposta** (Configurações → Modelos → Propostas): arte exportada do Canva (PNG/JPG por página), campos posicionados e variáveis próprias. Cada modelo indica os tipos de deal e as filiais em que é padrão.
- **Enviar:** por e-mail (SMTP da empresa, com leitura registrada) ou pelo WhatsApp (API da empresa ou link seguro que expira).
- **Anexos:** PDF, Word, Excel, PowerPoint, PNG e JPG até 3 MB; arquivos grandes (até 50 MB) sobem em partes.

# Aprovações
@ /aprovacoes Abrir Aprovações
1) Pedir aprovação :: Na negociação, "Pedir aprovação" abre a Análise e aprovação: novo cliente × cliente da base, parecer de apoio à decisão, históricos e documentos.
2) Solicitar :: Informe o valor proposto e a justificativa. O sistema mostra a alçada (Supervisão, Gerência, Diretoria) pela tabela de descontos.
3) Decisão :: Quem tem a alçada aprova, reprova ou pede correção. Um novo pedido substitui o pendente e vira nova versão das condições.
4) Fila :: Aprovações mostra o que está na sua alçada e os seus pedidos; o menu Comercial mostra o contador.

:::importante Quem aprova
Só pessoas com cargo **Liderança / gestor** no setor aprovam, dentro da alçada do seu perfil. Ninguém decide o próprio pedido. As alçadas ficam em Configurações → Aprovações.
:::

# Viabilidade econômica
Funcionalidade **Viabilidade econômica** (CRM). O motor financeiro calcula no servidor, com os parâmetros vigentes, DRE, indicadores, custos, tributos e fluxo de caixa, e guarda uma **fotografia auditável** (com hash). Consultar não recalcula.
1) Lance os custos :: Do catálogo de custos (investimento e mensais) com o preço vigente.
2) Salve o cálculo :: O resultado fica gravado como foi calculado.
3) Envie para decisão :: Exige cálculo atualizado e 100% dos tributos parametrizados na filial.
4) Gestão ou diretoria decide :: Aprova ou devolve com motivo; ninguém decide o que enviou.
Exportação em CSV ou PDF. O **Financial Studio** (Configurações) mostra e governa as fórmulas do motor.

# Contas
@ /customers Abrir Contas
A ficha da conta reúne identidade (CNPJ/CPF auditado), campos personalizados, classificação estratégica (com histórico), oportunidades, contratos, interações, faturas e ordens de serviço do IXC (quando integrado), **ocorrências** (notificações, elogios, mudanças), **evolução do relacionamento** ao longo do tempo, **contas relacionadas** (mapa do grupo e sugestões pela raiz do CNPJ) e **estruturas** (programas, redes, consórcios, grupos econômicos) com o papel de cada conta.

# Atividades e agenda
@ /activities Abrir Atividades
Agenda por tipo, situação, responsável e período; calendário do mês, próximas e resumo da semana. Concluir, reabrir e reagendar em um clique. Cada tipo de tarefa pode ter um **roteiro** (Configurações → Modelos → Tipos de tarefa) mostrado ao agendar.

# Chat, comentários e menções
O chat da negociação é interno; **@menção** avisa a pessoa por e-mail/WhatsApp. Comentários formais vão para o histórico e não podem ser editados nem apagados. "Onde me mencionaram" reúne as menções não lidas.

# Chamados no GLPI
Funcionalidade **Chamados no GLPI**. Na aba Chamados GLPI da oportunidade: abrir chamado (entidade, categoria e grupo vindos do GLPI), acompanhar retornos, responder (público ou **privado**), aprovar ou recusar validações pedidas no GLPI e "Atualizar" para reler. Chamado solucionado gera a tarefa "Dar retorno ao cliente". Configuração no capítulo *Integrações*.

# Jornada e pontos da negociação
Cada etapa da jornada tem tarefas com peso; concluir no prazo dá pontos. A gerência pode qualificar a tarefa (aprovada dá bônus de aderência). A comemoração da venda fechada mostra quem vendeu e os pontos ganhos.

??Por que não consigo mover para a etapa seguinte?
=> A etapa tem exigências (por exemplo, produtos lançados para fechar). A mensagem diz o que falta.
??A proposta não foi gerada ao entrar em Proposta.
=> Confira se existe modelo ativo para o tipo de deal e se há um padrão para a filial (Configurações → Modelos → Propostas).
??Quem pode trocar o responsável?
=> O próprio responsável, a supervisão, a gerência ou a diretoria.
`,
};

export const CH_LICITACOES: ManualChapter = {
  slug: 'licitacoes', type: 'procedimento', title: 'Licitações e Atas de Registro de Preço',
  description: 'Projeto de licitação em 9 etapas, prazos pelo edital, áreas e aprovações, pregão e concorrentes, e a gestão completa das atas de registro de preço.',
  keywords: ['licitação', 'pregão', 'edital', 'ata', 'arp', 'adesão', 'lance', 'concorrentes'],
  src: `
# Licitação no CRM
Licitação é um **tipo de venda** do funil Corporativo. Os campos aparecem conforme o tipo (modalidade, tipo de disputa, datas do edital).

## Pregão e concorrentes
- **Participantes:** empresa, CNPJ, lote, lance, situação, "nós" e vencedora; ranking por lote, um vencedor por lote.
- **Nosso lance:** lotes que vamos disputar e o lance de cada um.
- **Linha do tempo do pregão:** lances, recursos, impugnações de cada empresa.
- **Resultado por item:** nosso preço final e o da vencedora (vale mesmo depois do encerramento).
- **Inteligência → Concorrentes:** por CNPJ, disputas juntos, vitórias, lances médio e mínimo; histórico de preços por item.

# Projeto de licitação
Funcionalidade **Projeto de licitação** (precisa do módulo Projetos ligado). O projeto segue o rito padrão de 9 etapas, cada uma com macrotarefas, tarefas, áreas e entregáveis:

[[ETAPAS_LICITACAO]]

1) Marcos do edital :: O analista valida as datas oficiais (sessão, envio da proposta, esclarecimentos…) e a margem de segurança. Sessão e envio gravam também na oportunidade.
2) Prazos pelo edital :: O sistema calcula os prazos das tarefas a partir das datas; confira a prévia e aplique nas tarefas escolhidas.
3) Planejamento :: Tabela de etapas, macrotarefas e tarefas, dependências (sem ciclos), edição em linha ou em lote (deslocar N dias) e Gantt.
4) Áreas :: Titular, substituto e gestor por área (Comercial, Engenharia, Operações, Jurídico, Financeiro, Fiscal, Compras, Diretoria); atribuir as macrotarefas ao titular de cada área.
5) Aprovações :: Plano, Go/No-Go, proposta, alteração crítica e contratação, cada uma com o aprovador da matriz.
6) Coordenador :: Pode ser trocado por qualquer pessoa ativa da empresa.

:::dica Modelo do projeto
O modelo é versionado: rascunho → aprovação → publicado. Os projetos novos usam a versão publicada; os antigos não mudam. Se a oportunidade deixar de ser licitação, escolha continuar o projeto ou arquivá-lo (o histórico fica).
:::

# Atas de Registro de Preço
@ /contracts?t=atas Abrir Atas de Registro de Preço
Funcionalidade **Atas** (Contratos).
- **Cadastro:** a ata com o órgão gerenciador; órgãos participantes e não participantes; itens à mão ou por **importação** (prévia que valida o que entra, completa, corrige ou é bloqueado; aplicar grava tudo ou nada; modelos de mapeamento de colunas salvos).
- **Saldos por item e órgão**, alertas e a regra aplicada por regime (versionada, nunca acima dos tetos legais).
- **Oportunidades da ata:** criar oportunidade a partir da ata ou atrelar uma existente, reservando saldo; ajustar ou liberar reservas; **formalizar a contratação** (empenho, contrato ou ordem de serviço) converte a reserva em consumo.
- **Adesões:** pedido de órgão não participante (limites conferidos na hora), aceite do fornecedor, autorização do gerenciador; exceção só com validação do Jurídico; recusa, cancelamento e expiração devolvem a cota.
- **Operações entre itens:** conversão, remanejamento, correção, alteração de preço e cancelamento — simular, solicitar, aprovar (quem pediu não decide) e efetivar com documento.
- **Livro de movimentações**, documentos, histórico, relatórios com CSV e painel (valores, saldos, adesões, evolução e potencial remanescente).
`,
};

export const CH_CONTRATOS: ManualChapter = {
  slug: 'contratos', type: 'procedimento', title: 'Gestão de Contratos',
  description: 'Cadastro e versões, painel, central de atenção, processos por setor, renovação e reajuste com ofícios, aditivos, empenhos e medição, Cadastro ERP no IXC, assinatura, comunicações e execução.',
  keywords: ['contrato', 'renovação', 'reajuste', 'ofício', 'aditivo', 'empenho', 'medição', 'erp', 'ixc', 'zapsign', 'sla'],
  src: `
# As abas da Gestão de Contratos
| Aba | O que mostra |
| Painel | Faturamento por tipo, carteira estratificada, saldo de medição, vencimentos, risco e alertas |
| Central de atenção | Fila única por gravidade, prazo e valor: notificações, processos atrasados, validações e execução |
| Lista de contratos | Pesquisa com vigência, valor, dias restantes, pendências e próxima ação |
| Comunicações | Esteiras e templates de comunicação, aprovações de envio |
| Funil | Contratos por etapa; mover abre renovação, reajuste ou encerramento |
| Atestados | Acervo de atestados de capacidade técnica |
| Atas de Registro de Preço | Ver o capítulo Licitações e Atas |
| Controle de Empenhos | Carteira de contratos públicos ou por medição com os quatro saldos |
| Calendário | Término, renovação, reajuste, garantias, prazos de processos, alertas e tarefas |
| Relatórios | Vencimentos do mês e relatório completo, com CSV |
As abas visíveis podem ser limitadas por perfil (Configurações → Contratos).

@ /contracts?t=painel Abrir o Painel de contratos

# Cadastrar um contrato
1) Venda fechada :: Na negociação ganha, o botão azul "Cadastrar contrato" traz os dados herdados da oportunidade: filial, tipo de serviço, responsáveis do último contrato do cliente, itens dos produtos lançados e os termos de medição.
2) Ou a partir do cliente :: Lista de contratos → novo contrato.
3) Confira e salve :: Nasce a versão 1. Mudança em dado contratual gera **nova versão** com motivo; a anterior fica preservada.
4) Validar o cadastro :: Abre a implantação, pede ERP e provisionamento ao Financeiro, avisa a entrega e passa a conta para o Sucesso do Cliente.

:::importante Tipos de venda e caixas
As caixas de **medição** e de **itens do contrato** aparecem na oportunidade só quando o tipo de venda é Consumo de Contrato (ou quando a oportunidade já está ligada a um contrato por medição).
:::

# Processos por setor
Renovação, reajuste, implantação e encerramento são **processos com etapas por setor**. Cada etapa tem exigências (ERP, documento, data, decisão ou valores). Abrir manualmente, concluir etapa, cancelar com motivo. A matriz **RACI** define quem é Responsável, Aprovador, Consultado e Informado em cada atividade, com SLA em horas, regras de aviso e escalonamento; atores externos recebem aviso com link de confirmação.

# Renovação e reajuste com ofício
- **Reajuste sugerido:** acumulado do índice do contrato nos 12 meses antes do aniversário, consultado no Banco Central.
- **Ofícios:** modelos por filial (assinatura e numeração anual), prévia exata, emissão com número sequencial e PDF guardado, envio por e-mail ao cliente.
- **Aplicar:** reajuste (valores dos itens) ou renovação (nova vigência) direto do ofício, no período e uma vez; em seguida a **conferência** confirma que o contrato ficou como o ofício ou registra a divergência.

# Aditivos
Termo com uma ou mais finalidades (acréscimo, supressão, prorrogação, reajuste, reequilíbrio, itens), gerando nova versão. O sistema acompanha o **limite legal** de acréscimo e supressão (25%, ou 50% em reforma).

# Valores, extrato e medição
- **Valor mensal por ano:** para comparar a receita sem o efeito do reajuste.
- **Extrato:** saldo do contrato por medição e lançamentos (crédito, consumo manual, estorno, faturamento frequente).
- **Indicador de consumo:** ritmo × tempo, esgotamento previsto e consumo mensal.
- **Relatório de Medição** mensal: configuração por conta (dia, destinatários, textos), prévia ao vivo, rascunho, ajustes e envio com as propostas anexadas.

# Controle de Empenhos
Para contratos públicos ou por medição: itens com saldos **contratado, empenhado, executado, faturado e a empenhar**; notas de empenho com os itens; fontes de receita e proporção entre elas; medições (reserva saldo e baixa FIFO ou rateio); envio ao órgão, atesto e faturamento; reforço e anulação; virada de exercício guiada; simulação e registro de reajuste com retroativo em NF complementar; importação da planilha de controle.

# Cadastro ERP (IXC)
Funcionalidade **Cadastro ERP** (pode ser desligada). Ciclos por implantação, aditivo, reajuste ou renovação: campos herdados do contrato ou manuais, produtos, evidências, fluxo de enviar → aprovar → liberar → registrar lançamento → **conferir no IXC** (leitura) e ficha de lançamento em PDF com o timbrado da filial. A senha da Central do assinante só aparece para quem lança, e fica registrado.

# Documentos, modelos e assinatura
- **Documentos:** nome no padrão AAMMDD - TIPO - CLIENTE - RESUMO, versões, pastas Ativos/Encerrados, restrição por setor, marcação de assinado; cada download fica na auditoria.
- **Modelos de contrato** (.docx com campos {{variável}}): gerar o documento preenchido e anexar.
- **Assinatura eletrônica (ZapSign):** cada signatário recebe o link por e-mail; o PDF assinado volta sozinho.

# Execução do contrato
SLA contratado × realizado por mês; ocorrências e penalidades (advertência, multa, glosa) com defesa e situação; gestor, fiscais e preposto (com histórico); cláusulas críticas com prazo e aviso; atestados de capacidade técnica (pedido, recebimento, recusa).

# Habilitação
Certidões e alvarás por filial, com versões anteriores e os contratos públicos que dependem de cada um.

# Comunicações
Templates de e-mail/WhatsApp com rascunho e versões publicadas, cabeçalho e rodapé em imagem; **esteiras** (gatilho e passos) com aprovação antes do envio quando configurado.

# Linha do tempo e monitoramento
A **linha do tempo única** reúne tudo o que aconteceu no contrato por assunto, com os críticos em destaque e os próximos prazos. A rotina diária monitora vigências, gera notificações e envia o resumo da central de atenção.
`,
};
