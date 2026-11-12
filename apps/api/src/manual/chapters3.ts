/** Manual do sistema — capítulos de uso (parte 3): Pessoas, Inteligência, E-mail, Playbooks, Configurações e Integrações. */
import type { ManualChapter } from './types';

export const CH_PESSOAS: ManualChapter = {
  slug: 'pessoas', type: 'integracao', title: 'Pessoas & Gestão: comunidade e feedback',
  description: 'Meu Espaço, feed, comunidades, reconhecimento, comunicados, mensagens, moderação, avisos e o fluxo de feedback com mediação do RH.',
  keywords: ['pessoas', 'comunidade', 'feed', 'reconhecimento', 'comunicados', 'mensagens', 'feedback', 'rh', 'moderação'],
  src: `
@ /pessoas Abrir Pessoas & Gestão
O módulo começa liberado só para quem a empresa escolher.

# Comunidade
- **Meu Espaço e perfil social:** cargo, área e unidade vêm do cadastro oficial; o resto a pessoa escolhe mostrar.
- **Feed:** publicações com texto, mídias (vídeo em partes) e menções; reagir, comentar, salvar, compartilhar por mensagem; publicação institucional só com o papel de Comunicação. A fileira do topo mostra quem publicou nas últimas 48 horas.
- **Comunidades:** públicas, institucionais ou privadas (pedido e convite), com responsáveis e moderadores, publicação fixada e arquivamento.
- **Reconhecimento:** público (vai para o feed) ou privado, por categorias definidas por Pessoas e Cultura.
- **Comunicados:** público por unidade, time ou cargo; prioridade; **confirmação de leitura** (mudar o texto de um publicado pede nova confirmação); alcance e quem ainda não confirmou.
- **Mensagens:** conversas diretas e grupos.
- **Avisos:** preferências por evento e canal (o aviso interno de evento obrigatório não desliga).

# Moderação
Denúncia de publicação, comentário ou reconhecimento; fila de triagem, decisão com justificativa e medida; pedido de revisão; ação direta da moderação. Quem denunciou nunca é revelado ao autor.

# Feedback
1) Registrar :: Para liderado ou para a liderança, como rascunho ou enviado.
2) Ciência :: O destinatário dá ciência (não é concordância) e pode se manifestar.
3) Mediação do RH :: Feedback para a liderança pode ir ao RH, que repassa uma síntese sem identificar quem enviou, ou trata sem repasse.
4) Ficha do colaborador :: Liderança vê os liderados diretos; RH vê todos com o módulo.
A **política de desenvolvimento** é publicada pelo RH em versões.
`,
};

export const CH_INTELIGENCIA: ManualChapter = {
  slug: 'inteligencia', type: 'procedimento', title: 'Relatórios, Inteligência e indicadores principais',
  description: 'Relatórios comerciais, comissões, Inteligência comercial e de contratos, conversão e tempo por etapa, mapa de calor, concorrentes, fluxo de caixa e o painel de indicadores principais da diretoria.',
  keywords: ['relatórios', 'inteligência', 'kpi', 'indicadores', 'comissões', 'conversão', 'booking', 'mapa de calor'],
  src: `
# Relatórios
@ /reports Abrir Relatórios
Visão do período (vendas, leads, funil, planos, equipe), **comissões** das vendas fechadas (vendedor vê as suas, supervisão a equipe, gerência todas), ocupação das portas da CTO e exportação CSV no escopo de cada um (exige a permissão Exportar).

# Inteligência
@ /intelligence Abrir Inteligência
- **Comercial:** desempenho, origem, conversão, planos, regiões, equipe e insights.
- **Conversão e tempo por etapa:** por funil, coorte criada no período — chegaram, avançaram, perdidas, paradas, tempo médio e mediana, etapa com maior queda.
- **Geral:** base, faturamento, inadimplência, portas, motivos, leads, perdas e cohort.
- **Mapa de calor** da base pelo endereço.
- **Contratos:** indicadores contratuais com filtros e receita da base por mês (recorrente + medição + frequente) contra o ano anterior sem o reajuste.
- **Concorrentes** e histórico de preços por item nas licitações.
- **Fluxo de caixa consolidado** das oportunidades com viabilidade salva.
- **Projetos:** o painel das frentes em leitura.

# Indicadores principais
@ /painel/indicadores Abrir o modo TV dos indicadores
Painel da diretoria com os KPIs, metas desdobradas por trimestre e farol de atingimento. Resultados **informados** (corrigir grava novo lançamento) ou **calculados do CRM** (Booking de contratos, win rate em licitação, conversão geral, health score do CS, lead time de viabilidade, ativação de contas-alvo), com parâmetros ajustáveis em nova versão da ficha. As fichas podem ser importadas do formulário .xlsx (uma aba por indicador) com prévia.
`,
};

export const CH_EMAIL: ManualChapter = {
  slug: 'email', type: 'procedimento', title: 'E-mail corporativo',
  description: 'Caixas pessoais e compartilhadas, conexão com o Gmail, pastas e regras, filas com prazo de primeira resposta, vínculo com contas e oportunidades e assinatura.',
  keywords: ['email', 'gmail', 'caixa compartilhada', 'fila', 'regras', 'assinatura', 'smtp'],
  src: `
@ /email Abrir E-mail
# Caixas
- **Pessoal:** só a dona vê (nem a gerência).
- **Compartilhada:** cadastrada por quem tem Configurações total; vista por quem está nas filas dela, por quem tem E-mail total e pela liderança dos times.
- **Conectar:** pelo Google (OAuth, Gmail API) ou, na caixa pessoal, pela **senha de app** do Gmail (IMAP/SMTP). Acesso cifrado no servidor; desconectar revoga o acesso e mantém as conversas.

# Trabalhar as conversas
Visões Minhas, Sem responsável, Aguardando 1ª resposta e Todas; filtros por fila, caixa e situação. Situação (nova, em atendimento, aguardando cliente, resolvida, arquivada), responsável, prioridade, etiquetas e **vínculo com conta e oportunidade** (automático quando os endereços apontam para uma conta só). Responder sai pelo próprio Gmail, na mesma conversa; e-mail novo abre conversa nova. A conversa pode virar negociação.

# Organizar
- **Pastas** com regra de armazenamento (pode aplicar às conversas já na Entrada).
- **Regras de entrada** por remetente, domínio, destinatário, assunto e texto → fila, prioridade, etiqueta ou arquivar; a primeira que casa vale; teste sem gravar.
- **Filas:** direcionamento manual, rodízio ou dono da conta; prazo de 1ª resposta em horas; números da fila.
- **Assinatura** em Meu perfil (vai no fim dos e-mails novos e das respostas).

:::dica E-mails do sistema
Propostas, ofícios, pesquisas, relatórios de medição e alertas saem pelo **SMTP da empresa** (Configurações → E-mail e alertas), não pelas caixas pessoais.
:::
`,
};

export const CH_PLAYBOOKS: ManualChapter = {
  slug: 'playbooks', type: 'treinamento', title: 'Central de Playbooks: wiki, aprovação, provas e certificados',
  description: 'Como ler, criar, aprovar e manter playbooks; blocos disponíveis; ciência, sugestões, revisões, provas de treinamento e certificados.',
  keywords: ['playbook', 'wiki', 'treinamento', 'prova', 'certificado', 'aprovação', 'versão', 'ciência'],
  src: `
@ /playbooks Abrir a Central de Playbooks
# Ler
A biblioteca mostra só o que você pode ler (corporativo, compartilhado com seu time/centro/perfil ou restrito a você), com busca por título, descrição, palavras-chave e texto. Na página: índice, progresso de leitura, favorito, **ciência** da versão vigente (ação explícita; abrir não conta) e **sugerir melhoria** (vai para quem mantém, sem mudar o vigente).

# Criar e manter
1) Criar :: Liderança, Gerência e Diretoria criam; código automático pela categoria (ex.: COM-PB-001); a partir de modelo, de outro playbook ou de PDF importado.
2) Escrever :: Blocos de título, texto, destaque, etapas, checklist, tabela, perguntas frequentes, imagem, vídeo (YouTube/Vimeo), PDF, arquivo, link, atalho para tela do sistema, fluxograma, árvore de decisão e blocos da gamificação. Salva sozinho.
3) Enviar :: A alçada vem da categoria e da criticidade: Gerência e/ou Diretoria. O autor não decide a própria versão.
4) Publicar :: A Diretoria homologa com data de vigência. A versão anterior fica no histórico; compare versões bloco a bloco.
5) Revisar :: Periodicidade (mensal a anual ou personalizada) com alertas antes do vencimento.

:::atencao Suspensão
Gerência e Diretoria podem suspender um playbook por risco operacional, normativo ou de segurança, e pedir de novo a ciência de todos.
:::

# Provas e certificados de treinamento
Quem mantém o playbook cria a **prova** (tentativas e certificados já emitidos não mudam). Quem faz recebe as perguntas sem as respostas; aprovado, o **certificado em PDF** é emitido com código de verificação, conferível por qualquer pessoa da empresa. Cursos internos contam na Badge Crescimento.

# Gestão
Painel de aprovação, meus playbooks e da área, revisões, sugestões (em análise, aceita, rejeitada, incorporada) e indicadores de disseminação por time e centro de custo.

# Sobre este manual
Os capítulos do **Manual do sistema** são instalados e atualizados pelo próprio sistema (botão "Manual do sistema" na Central, para Gerência, Diretoria e Administrador). As partes de referência — perfis e níveis, funcionalidades, telas e a lista completa da API — são geradas a partir do sistema no momento da atualização. Uma atualização nunca passa por cima de uma versão em edição.
`,
};

export const CH_CONFIG: ManualChapter = {
  slug: 'configuracoes', type: 'procedimento', title: 'Configurações e administração',
  description: 'Usuários e times, permissões e módulos, segurança e acesso por IP, jornadas e automações, modelos, filiais e fiscal, viabilidade e Financial Studio, importação de dados, personalização e auditoria.',
  keywords: ['configurações', 'administração', 'usuários', 'permissões', 'módulos', 'jornadas', 'automações', 'filiais', 'importação', 'auditoria'],
  src: `
@ /settings Abrir Configurações
Configurações exige o nível **Total** no módulo Configurações (Administrador, Diretoria e Gerência por padrão).

# Usuários e times
1) Cadastrar usuário :: Nome, e-mail, perfil, times, times que lidera (Supervisão precisa liderar ao menos um), metas e **cargo no setor**. A senha temporária aparece uma única vez.
2) Cargo no setor :: Observador, Operador ou Liderança / gestor; vem sugerido pelo perfil e pode ser trocado.
3) Redefinir senha :: Gera nova senha temporária e encerra as sessões.
4) Times :: Criar, renomear, inativar ou excluir (sai das escolhas e do orçamento; o histórico continua).
A gerência não consegue tirar o próprio acesso de administração.

# Permissões
- **Módulos e liberação:** ligar/desligar cada módulo na empresa; entregar a todos os perfis com acesso ou só a equipes e pessoas liberadas; liberar ou bloquear com motivo e validade (bloqueio vence liberação; regra da pessoa vence a da equipe); desligar funcionalidades.
- **Segurança:** a matriz de níveis por perfil e módulo (efeito imediato, auditado).
- **Ações sensíveis:** ver valores financeiros, exportar, validar contrato, alterar valores de contrato, arquivar e aprovar viabilidade, por perfil.
- **Prévia do acesso efetivo** de qualquer usuário, com o motivo de cada módulo.
- **Acesso por IP:** IPv4, IPv6 ou faixas; exceção por usuário; o sistema não deixa você se trancar fora.

# Comercial
- **Jornadas e automações:** funis com etapas (ordem, cor, tipo, exigências), membros, campos personalizados (copiáveis entre jornadas) e automações (gatilho + ações) com registro das execuções.
- **Aprovações:** alçadas de desconto, opções da classificação e aviso.
- **Planos, origens de lead e canais.**
- **Área de atendimento:** regiões e condomínios; CEP pelo ViaCEP.
- **Modelo de instrução:** roteiro, objeções, insights e e-mails em versões (baixar JSON, enviar, ativar, descartar).
- **Modelos:** contratos (.docx), propostas (arte + campos), e-mails, instrução e roteiros dos tipos de tarefa.

# Filiais e fiscal
Filiais da venda com **timbrado** (PNG, JPG ou PDF A4) e margens da área de texto; documentos fiscais por tipo (venda, prestação de serviço, aluguel); DRE com a alíquota efetiva e retenções do ano.

# Viabilidade e Financial Studio
Parâmetros do motor financeiro e catálogo de custos com vigência (hoje ou futura). O **Financial Studio** mostra as fórmulas reais do motor; nova versão de fórmula passa por simulação numa oportunidade real e na carteira, validação, aprovação e publicação com vigência.

# Contratos, Sucesso do Cliente, ABM e desempenho
Parâmetros dos alertas e do ofício, abas por perfil e Painel; responsabilidades (RACI) e comunicação; setores; configuração do Sucesso do Cliente, do ABM (influência) e de desempenho (atribuição e validação) — todas versionadas.

# Dados
- **Base de dados:** modelo de planilha de clientes com explicação das colunas, importação com prévia (dryRun) e **Limpar base** (só gerência, com a própria senha e frase de confirmação).
- **Data Import Engine:** conectores (ex.: RD Station) com token cifrado, descoberta dos campos reais, modelos versionados de mapeamento e equivalências, **simulação** antes da importação, lotes com pausa e retomada, revisão em lote e a origem de cada registro importado.

# Personalização, notificações e logs
Espaços de imagem da marca (PNG, JPG, WebP até 3 MB; SVG não é aceito), e-mail e alertas (SMTP com teste, alertas liga/desliga, registro de envios) e **Logs** (trilha de auditoria de tudo o que foi feito).
`,
};

export const CH_INTEGRACOES: ManualChapter = {
  slug: 'integracoes', type: 'procedimento', title: 'Integrações',
  description: 'Todas as integrações do RevOps: o que cada uma faz, onde configurar e os cuidados de segurança.',
  keywords: ['integrações', 'ixc', 'glpi', 'gmail', 'google', 'whatsapp', 'z-api', 'meta', 'zapsign', 'rd station', 'banco central', 'viacep', 'webhook'],
  src: `
@ /settings/integrations Abrir Integrações
:::importante Regras de segurança de todas as integrações
- Segredos (senhas, tokens, chaves) ficam **cifrados no servidor** e nunca voltam para a tela. Em branco mantém o atual.
- Webhooks têm endereço próprio por empresa, que pode ser regenerado (o antigo para de funcionar), e conferem assinatura quando o fornecedor oferece.
- Em produção, endereços de sistemas da empresa precisam ser https e acessíveis pela internet; endereços internos são recusados.
:::

| Integração | O que faz | Onde configurar |
| IXC (ERP) | Faturas e ordens de serviço do cliente; conferência do Cadastro ERP por consulta de leitura | Configurações → Integrações (endereço, usuário e token; botão Testar) |
| GLPI 11 | Abrir chamado da negociação, acompanhamentos públicos e privados, validações, retorno por webhook assinado (HMAC-SHA256) | Configurações → Integrações → GLPI (OAuth, usuário de integração, segredo do webhook) |
| Google (login) | Entrar com a conta Google do mesmo e-mail | Variáveis do servidor (cliente OAuth) |
| Gmail | Caixas pessoais e compartilhadas pela Gmail API, ou senha de app (IMAP/SMTP) | Configurações → E-mail corporativo (domínios e janela) e E-mail → Caixas |
| SMTP da empresa | Propostas, ofícios, pesquisas, relatórios de medição, alertas e redefinição de senha | Configurações → E-mail e alertas |
| WhatsApp (Z-API) | Nova conversa vira lead; envio de anexos pela API da empresa | Configurações → Integrações |
| WhatsApp Cloud API (Meta) | Nova conversa vira lead | Configurações → Integrações (verificação do webhook) |
| Lead Ads (Facebook/Instagram) | Busca o lead na Graph API e cria o lead | Configurações → Integrações |
| Formulário do site | Nome, telefone, e-mail, mensagem e interesse viram lead | Endereço de recebimento em Integrações |
| ZapSign | Envio de contratos para assinatura e retorno do PDF assinado | Configurações → Integrações |
| Banco Central (SGS) | Índices oficiais para reajuste e ofícios | Automático |
| ViaCEP | Preenche o endereço pelo CEP (sem resposta em 4 s, segue manual) | Automático |
| IBGE (malha) | Mapa de calor da base | Automático |
| RD Station (Data Import Engine) | Importação de contas, oportunidades e histórico | Configurações → Importação |
| Zenith | Espelho do cadastro do contrato: cada campo com o valor e a origem (CRM ou cadastro Zenith) e as pendências | Gestão de Contratos (listas do cadastro Zenith) |
| Rotina diária (cron) | Alertas, automações paradas, monitoramento de contratos, sinais do ABM, chamados do GLPI, alertas do Marketing | Agendamento do servidor com CRON_SECRET |

# GLPI: o que precisa existir
1) GLPI 11 acessível pela internet.
2) Cliente OAuth com escopo "api" e concessão "Senha".
3) Usuário de integração com permissão de criar e ver chamados nas entidades dos clientes.
4) Webhook para Chamado, Acompanhamento, Solução e Tarefa de chamado, com o segredo.
Validações do GLPI precisam ser pedidas ao usuário de integração (ou a um grupo dele); senão o GLPI recusa e o RevOps explica o motivo.

# Gmail pela Gmail API
1) No Google Cloud, ative a Gmail API.
2) Na tela de consentimento, inclua os escopos gmail.modify e gmail.send (com openid e email) e marque o app como Interno.
3) Cadastre o retorno https://<domínio>/api/v1/mail/oauth/callback.
4) Em Configurações → E-mail corporativo, informe os domínios da empresa.
`,
};
