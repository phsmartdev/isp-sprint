/** Manual do sistema — capítulos de referência: perfis e permissões, API e padrões de design. */
import type { ManualChapter } from './types';

export const CH_ACESSOS: ManualChapter = {
  slug: 'acessos', type: 'politica', title: 'Perfis, níveis e permissões',
  description: 'Como o acesso é decidido: módulos de negócio, perfis, níveis por módulo, funcionalidades, ações sensíveis, cargo no setor e o que cada perfil faz no dia a dia. Tabelas geradas do sistema.',
  keywords: ['perfil', 'permissão', 'nível', 'acesso', 'módulo', 'funcionalidade', 'cargo', 'observador', 'operador', 'liderança', 'rbac'],
  src: `
# Como o acesso é decidido
O acesso efetivo é **o menor** entre quatro camadas, e o servidor é a única autoridade (a tela só esconde o que a API já recusa):
1) Módulo de negócio :: Ligado na empresa e liberado para a pessoa (todos os perfis com acesso, ou só equipes e pessoas liberadas).
2) Nível do perfil :: Próprio, Equipe, Total ou Sem acesso em cada módulo técnico (matriz de Segurança).
3) Funcionalidade :: Ligada na empresa (ex.: Atas, ABM, Cadastro ERP, Projeto de licitação).
4) Ação sensível :: Permitida ao perfil (ver valores, exportar, validar, arquivar…).
Uma pessoa com mais de um perfil fica com o **maior** nível de cada módulo e com a ação permitida se qualquer perfil permitir. A liberação individual só abre o módulo; o nível continua o do perfil.

| Nível | O que a pessoa vê |
| Próprio | Só a própria carteira e o que é dela |
| Equipe | Os times que lidera, somados (nunca outros times) |
| Total | 100% da empresa |
| Sem acesso | O módulo some do menu e a API recusa |

# Matriz padrão de níveis
Valores de fábrica; a empresa ajusta em Configurações → Permissões → Segurança.
[[MATRIZ]]

# Ações sensíveis
[[ACOES]]

# Cargo no setor
[[CARGOS]]

# Módulos e funcionalidades
[[FUNCIONALIDADES]]

# O que cada perfil faz
## Operação
Trabalha a própria carteira: leads, oportunidades, propostas, atividades e tarefas; pede aprovação de descontos; cadastra contratos das vendas fechadas; acompanha metas e pontos em Meus pontos; lê e dá ciência nos playbooks; usa a comunidade. Vê as negociações do time em leitura.
## Supervisão
Tudo da Operação no escopo dos times que lidera (precisa liderar ao menos um time); aprova dentro da sua alçada quando é Liderança / gestor; conduz rituais, intervenções e impedimentos; valida certificados do time; acompanha férias e pedidos de apoio; pode ser responsável pela execução de um centro de custo.
## Gerência
Visão total da empresa; administra Configurações; aprova descontos, viabilidades, planejamento orçamentário da liderança, Budget Guardião (pedido), playbooks (primeira alçada) e operações de atas; pode ser dona de centro de custo; trata a central de atenção de contratos.
## Diretoria
Visão total; aprovação final do orçamento, do Budget Guardião, da homologação de playbooks e das metas da empresa; indicadores principais; objetivos estratégicos.
## Administrador
Acesso total, inclusive a todas as configurações, integrações, personalização e auditoria. Não pode tirar o próprio acesso de administração.
`,
};

export const CH_API: ManualChapter = {
  slug: 'api', type: 'integracao', title: 'Referência da API do RevOps',
  description: 'Convenções da API REST (autenticação, erros, paginação, concorrência, permissões) e a lista completa de rotas, gerada do servidor, com o que cada uma faz e o acesso exigido.',
  keywords: ['api', 'rest', 'endpoints', 'rotas', 'openapi', 'integração', 'desenvolvedor', 'webhook'],
  src: `
:::importante Fonte da verdade
A lista de rotas abaixo é **gerada do próprio servidor** quando o manual é atualizado. O documento OpenAPI 3.1 completo, com os esquemas de entrada, fica em **/api/v1/openapi.json**.
:::

# Convenções
| Item | Regra |
| Base | /api/v1 (JSON em UTF-8) |
| Autenticação | Sessão em cookie httpOnly assinado, criado por POST /api/v1/auth/login (ou login com Google) e encerrado por POST /api/v1/auth/logout |
| Proteção CSRF | Requisições que alteram dados precisam vir de uma origem autorizada (cabeçalho Origin) |
| Empresa | A empresa e o usuário vêm sempre da sessão; nunca do corpo ou da URL |
| Permissão | Toda rota declara módulo e nível mínimo; rota sem política impede o servidor de subir |
| Escopo | Próprio/Equipe/Total é aplicado na consulta: registro fora do escopo responde 404 |
| Funcionalidade desligada | 403 com o motivo e onde ligar |
| Erros | application/problem+json com title, detail, errors (campo a campo) e requestId |
| Validação | 422 com a lista de campos recusados |
| Concorrência | Registros com rowVersion: versão antiga responde 409 (recarregue e refaça) |
| Paginação | page (desde 1) e pageSize (1 a 100, padrão 25) |
| Rastreio | Cabeçalho x-request-id em toda resposta |
| Limite | 600 requisições por minuto por cliente, e limite próprio no login |
| Dinheiro | Valores em centavos (inteiros); sem a permissão de ver valores, campos financeiros voltam ocultos |
| Datas | Datas em AAAA-MM-DD; instantes em ISO 8601 |
| Histórico | Tabelas de histórico são só de inclusão: corrigir grava um registro novo |
| Webhooks | /api/v1/hooks/… com endereço por empresa (regenerável) e conferência de assinatura quando o fornecedor oferece |
| Rotina diária | /api/v1/cron/alerts com Authorization: Bearer CRON_SECRET |

# Exemplo de erro
| Campo | Exemplo |
| status | 422 |
| title | Dados inválidos |
| detail | Confira os dados informados. |
| errors | [{ "path": "leadTeamIds", "message": "Escolha os times que ele supervisiona" }] |
| requestId | identificador para procurar no log |

# Rotas por assunto
Coluna Acesso: módulo e nível mínimo exigidos; "Sessão" = qualquer usuário logado; "Pública" = sem sessão (links públicos, webhooks); a funcionalidade aparece entre parênteses quando a rota depende dela. A regra de negócio de cada rota (alçadas, dono do registro, liderança) vale além do nível.
[[API]]
`,
};

export const CH_DESIGN: ManualChapter = {
  slug: 'design', type: 'procedimento', title: 'Padrões de design (marca BKT) para replicar em outras ferramentas',
  description: 'Tokens de cor, tipografia, cantos, espaçamento, componentes, padrões de tela, gráficos, acessibilidade e escrita, para que outras ferramentas tenham a mesma cara do RevOps.',
  keywords: ['design', 'marca', 'bkt', 'cores', 'tipografia', 'componentes', 'tokens', 'acessibilidade', 'ui'],
  src: `
:::importante Princípio
Interface sóbria de trabalho: **grafite e azul BKT**, **cantos retos** em tudo, texto claro e direto. Cor só onde tem significado (situação, alerta, ação principal). Não use verde-limão nem cores fora desta paleta.
:::

# Cores (tema claro)
| Token | Hex | Uso |
| bg | #F2F4F6 | Fundo das páginas |
| surface | #FFFFFF | Cartões, tabelas, diálogos |
| surface-2 | #F6F7F9 | Cabeçalho de tabela e áreas internas |
| line | #E1E5EA | Bordas |
| line-strong | #C9CFD6 | Bordas em destaque e hover |
| ink | #2D3339 | Títulos e texto forte (grafite BKT) |
| text | #3A424A | Texto corrido |
| muted | #5F6B76 | Texto secundário (contraste AA) |
| faint | #7D8791 | Legendas pequenas |
| navy | #2D3339 | Menu lateral (gradiente até #23282D) |
| navy-active / primary | #2F5986 | Azul BKT: item ativo, botões e links |
| primary-hover | #25486E | Hover do botão principal |
| primary-soft | #E8EEF5 | Fundos suaves e seleção |
| sky | #3885D3 | Azul secundário; anel de foco |
| destaque no escuro | #4FBBFF | Destaque sobre fundo grafite |
| success | #16A34A (fundo #E3F6E9) | Concluído, ganho, no prazo |
| warning | #EA7A12 (fundo #FFF0DE) | Atenção, vencendo |
| danger | #D23434 (fundo #FEE6E6) | Erro, atraso, perda |
| neutro terciário | #677680 (fundo #ECEFF1) | Etiquetas neutras |

# Cores (tema escuro)
| Token | Hex |
| bg | #14171B |
| surface | #1E2228 |
| surface-2 | #262B32 |
| line | #343A42 |
| line-strong | #4A515A |
| ink | #ECEFF2 |
| text | #D3D8DE |
| muted | #A0A9B3 |
| faint | #868F99 |
| navy (menu) | um tom abaixo do fundo (#101317) |
| primary | #2F5986 (o mesmo azul) |
Implemente os tokens como variáveis CSS em canais RGB (ex.: --primary: 47 89 134) para permitir transparência, e troque só os valores no tema escuro. Ofereça claro, escuro e "seguir o sistema".

# Gráficos
Entradas em azul #3885D3 e saídas em laranja #D4752C (par seguro para daltonismo). Séries em tons de azul e grafite; vermelho e verde só para sentido (ruim/bom). Todo gráfico tem tabela acessível equivalente.

# Tipografia
| Papel | Fonte | Peso |
| Títulos de página (h1) | Orbitron | 700–800, espaçamento 0,02em |
| Todo o resto | Work Sans | 400 texto, 500 rótulos, 600 subtítulos, 700 números |
| Números grandes de indicador | Work Sans | 700 (evite fontes em que o zero vira caixa riscada) |
Escala (rem / altura de linha): 2xs 0,6875/1 · xs 0,75/1,05 · sm 0,8125/1,25 · **base 0,875/1,375** · md 1/1,5 · lg 1,125/1,5 · xl 1,5/1,9 · 2xl 2,25/2,6. Fonte da página: 16 px.

# Forma, sombra e espaço
- **Cantos retos (raio 0) em tudo**: botões, campos, cartões, diálogos, etiquetas. Só fotos de pessoa e pontos de situação são redondos.
- Sombra de cartão: 0 1px 2px e 0 2px 8px em grafite a 5%. Sombra de sobreposição (diálogo, gaveta): 0 16px 40px a 22%.
- Espaçamento em múltiplos de 4 px; cartões com 16–24 px de respiro.
- Pontos de quebra do espaço de trabalho: 1 coluna até 899 px, 2 painéis de 900 a 1279 px, 3 painéis a partir de 1280 px. Nada de rolagem horizontal da página em 390 px.

# Componentes
| Componente | Padrão |
| Botão principal | Fundo #2F5986, texto branco, hover #25486E; um por área |
| Botão contorno | Fundo branco, texto azul, borda azul a 60% |
| Botão secundário | Fundo branco, texto grafite, borda #E1E5EA |
| Botão fantasma | Sem fundo nem borda; hover em surface-2 |
| Botão de perigo | Fundo #D23434, texto branco; sempre com confirmação |
| Tamanhos de botão | 32 px (sm), 40 px (md, padrão), 48 px (lg) |
| Campo | Rótulo acima, dica e erro abaixo; borda vermelha e mensagem quando inválido |
| Etiqueta (chip) | Tons neutro, azul, verde, laranja, vermelho; texto curto |
| Indicador (KPI) | Ícone, valor grande, rótulo, variação contra o período anterior com seta e cor pelo sentido (menor pode ser melhor) |
| Abas | Com contador opcional; contador zerado não aparece |
| Diálogo | Título próprio; Esc fecha só o de cima; rodapé com ações à direita |
| Gaveta lateral | Para detalhes sem perder a lista |
| Aviso (toast) | Curto, no canto, diz o que aconteceu ("Produtos e serviços salvos") |
| Estado vazio | Diz o que falta e oferece a ação |
| Estado de erro | Diz o que deu errado e oferece "Tentar de novo" |
| Carregamento | Esqueleto das linhas, não spinner de página inteira |
| Salvamento | "Salvando…", "Salvo", "Não salvou — tentar de novo" com o campo recusado |
| Paginação | Total, página e tamanho (8, 10, 25, 50) |

# Padrões de tela
- **Menu lateral grafite** com grupos recolhíveis, item ativo em azul, recolhível; topo com busca (/), ação principal e sino.
- **Listas**: indicadores no topo, filtros guardados no endereço, alternância Kanban/Lista quando houver etapas.
- **Ficha de registro**: três áreas (dados à esquerda, acompanhamento no centro, apoio à direita) que viram abas no celular.
- **Seções recolhíveis**: abertas quando falta informação, fechadas com resumo quando preenchidas.
- **Confirmação** para ações que não voltam atrás; motivo obrigatório para cancelar, recusar, excluir ou retificar.
- **Comemoração** discreta em vitória (confete) respeitando "reduzir movimento".

# Acessibilidade
- Contraste mínimo AA (o cinza secundário #5F6B76 já atende).
- Foco visível: contorno de 2 px em #3885D3 com afastamento de 2 px.
- Tudo funciona pelo teclado (inclusive arrastar no Kanban, com "Mover para" como alternativa).
- Rótulos reais nos campos e nomes acessíveis nos botões de ícone.
- Respeitar "reduzir movimento".

# Escrita na interface
- Português claro, frases curtas, voz ativa, sem jargão técnico.
- Botão diz exatamente o que acontece ("Iniciar Negociação", "Enviar para aprovação"), e o aviso usa o mesmo verbo ("Enviado para aprovação").
- Erros dizem o que aconteceu e como resolver, sem pedir desculpas.
- Datas no formato brasileiro (dd/mm/aaaa) e valores em R$ 1.234,56.
`,
};
