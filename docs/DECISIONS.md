# Decisões de arquitetura (ADRs)

Formato: contexto → decisão → consequências. Decisões marcadas **(reversível)** podem mudar sem migração de dados.

## ADR-001 — Reescrever em vez de evoluir o v1.5
**Contexto:** auditoria (`AUDIT_LEGACY_v1.5.md`) encontrou falhas críticas de autenticação, XSS armazenado, estado de contrato forjável pela API, armazenamento JSON sem concorrência e código minificado sem testes.
**Decisão:** novo monorepo; do legado aproveitamos conteúdo de playbook e as salvaguardas do adaptador IXC. Dados legados entram pelo importador como `legacy_v1.5`, não verificados.

## ADR-002 — Monorepo pnpm com pacotes de domínio
`apps/web`, `apps/api`, `packages/domain` (regras puras: permissões, estados, temperatura de lead, formatação), `packages/shared` (schemas Zod/DTOs usados por web e API). Pacotes consumidos como fonte TypeScript (sem build intermediário) para simplificar o desenvolvimento local. **(reversível)**

## ADR-003 — Frontend: React + Vite (não Next.js)
**Contexto:** aplicação inteira atrás de login, sem necessidade de SEO/SSR; já existe API própria.
**Decisão:** React 18 + Vite + React Router + TanStack Query + Tailwind com tokens semânticos em CSS variables (`apps/web/src/styles/tokens.css`). Componentes próprios acessíveis (sem kit pesado), foco visível e navegação por teclado. **(reversível)**
**Consequência:** um único servidor de aplicação (a API); o web é estático e pode ir para CDN.

## ADR-004 — API: Fastify + Zod + Drizzle ORM + PostgreSQL
- Fastify: desempenho, hooks para auth/RBAC por rota, plugins maduros (cookie, rate-limit, helmet).
- Zod: validação de entrada compartilhada com o frontend; erros no formato `application/problem+json`.
- Drizzle: schema em TypeScript, SQL previsível, migrations SQL versionadas geradas pelo `drizzle-kit` e revisáveis.
- PostgreSQL 16 em Docker Compose (ou instância local).

## ADR-005 — Autenticação por sessão em cookie
Cookie `httpOnly`, `SameSite=Lax`, `Secure` em produção; token aleatório de 32 bytes, **armazenado apenas como hash SHA-256** na tabela `sessions`, com expiração e revogação (logout). Senhas com `scrypt` (Node nativo, sem dependência nativa). Proteção CSRF: toda requisição que altera estado exige `Origin` igual a `WEB_ORIGIN` **e** `Content-Type: application/json`. Rate limit global e mais estrito no login. MFA para admin fica para a Fase 7 (registrado em PROGRESS). OIDC pode substituir depois. **(reversível)**

## ADR-006 — Autorização: RBAC no backend, negação por padrão
Permissões granulares em `packages/domain/src/permissions.ts`; papéis no banco (`roles`, `role_permissions`, `user_roles`) com seed dos 6 papéis padrão. Cada rota declara a permissão exigida; escopo "próprios × todos" via `*.read_all`. O frontend só esconde o que não pode; a API sempre revalida.

## ADR-007 — Isolamento multiempresa por `tenant_id` em toda consulta
`tenant_id` vem **somente da sessão**, nunca do corpo/URL. Todo acesso por ID filtra por `(tenant_id, id)`; ID de outro tenant responde 404 (não 403, para não revelar existência). Testes de acesso cruzado obrigatórios. RLS no Postgres considerado para a Fase 7 como defesa em profundidade.

## ADR-008 — Estados separados e transições no servidor
`opportunity_stage`, `proposal_status`, `contract_request_status`, `coverage_status` são colunas distintas. Mudança de etapa só via `POST /opportunities/:id/transition`, com `row_version` (409 em conflito), validação (422) e evento append-only com ator, motivo e versão. Ganha/Perdida são terminais; reabrir exige `opportunity.reopen` e motivo. **Ganha ≠ contrato confirmado**: o contador de contratos usa exclusivamente `contract_request_status = 'confirmada'`, que nenhuma rota da Fase 1 consegue definir.

## ADR-009 — Dinheiro em centavos inteiros
Colunas `*_cents integer/bigint`; formatação BRL só na borda (UI/exportação).

## ADR-010 — Datas em UTC no banco, exibição no fuso do tenant
`timestamptz` em todas as colunas; `tenants.timezone` (padrão `America/Sao_Paulo`) usado na UI.

## ADR-011 — Seed 100% fictícia e determinística
Nomes, telefones e endereços gerados; nenhum dado real. A seed usa semente fixa para que testes e capturas sejam reproduzíveis.

## ADR-012 — Ambiente de desenvolvimento sem Docker disponível
Nesta sessão o daemon Docker não está acessível; foi usado o PostgreSQL 16 local com as mesmas credenciais do `docker-compose.yml`. O compose segue sendo o caminho documentado.

## ADR-013 — Paginação por offset nas tabelas da Fase 1
Tabelas com ordenação por várias colunas usam `page/pageSize` com total. Suficiente para milhares de registros; cursor entra onde o volume exigir (Fase 3+). **(reversível)**

## ADR-014 — Autosave do workspace com rascunho local
Debounce de 900 ms, `PATCH` só dos campos alterados com `rowVersion`; rascunho em `localStorage` (mesma versão do servidor) recuperado após refresh com aviso; flush com `keepalive` ao sair; 409 mostra banner e nunca sobrescreve em silêncio.

## ADR-015 — E2E isolado
Playwright sobe API (:3334) e web (:5174) próprios contra `isp_sprint_test`, recriado no início. `PW_CHROMIUM_PATH` permite usar Chromium local quando o download é bloqueado.

## ADR-016 — Níveis de acesso por módulo e por perfil (substitui as 31 permissões)
Pedido do cliente (17/10): “no painel de configuração consiga setar níveis de segurança por módulo”. Modelo: 9 módulos × 4 níveis (`nenhum`, `proprio`, `equipe`, `total`), por **perfil** (Vendedor, Supervisão, Gerência) — não por pessoa. Padrão: Vendedor = Próprio (sem Campanhas, Inteligência, Configurações); Supervisão = Equipe; Gerência = Total, inclusive Configurações. Configurações só aceita Sem acesso/Total, e a Gerência não pode perder Configurações (evita trancar a empresa fora). “Equipe” = membros dos times que o usuário **lidera** (`team_memberships.is_lead`), somados, mais registros sem dono. Cada rota declara `module` + nível mínimo; o filtro de dono (`ownerScope`) é aplicado em SQL em toda consulta. A tela esconde o que a API já recusa.

## ADR-017 — Dados sensíveis e ranking
Decisão do cliente: o vendedor vê os dados de venda completos da própria carteira (sem máscara de telefone) e só os próprios números — o ranking do time aparece a partir do nível Equipe. Removida a máscara de PII por papel da Fase 1.

## ADR-018 — Valor da oportunidade vem do catálogo de planos
O vendedor escolhe o plano; o servidor grava `plan_id` e copia `price_cents` do catálogo (`plans`, origem `catalogo_manual` até a integração IXC). Não existe mais valor digitado. Preço mudou depois? A oportunidade guarda o valor do momento em que o plano foi escolhido.

## ADR-019 — Funil Yepnet e “Venda fechada”
Etapas: Novo lead → Qualificação → Cobertura → Proposta → Fechamento → Venda fechada / Perdido (migration 0002 mapeia as etapas antigas). “Venda fechada” é ganho comercial; contrato só conta como confirmado com validação externa (IXC). Receita nos relatórios = soma do valor mensal de catálogo das vendas fechadas, não faturamento — explicado no “Como é calculado” de cada indicador.

## ADR-020 — Imagens da marca no banco, sem SVG
12 espaços (`brand_assets`, por empresa) e fotos de usuário (`user_avatars`) em `bytea`, até 2 MB, tipo detectado pelos bytes (PNG/JPEG/WebP). SVG recusado (pode carregar script). Só a logo e o favicon têm rota pública (tela de login); os demais exigem sessão. Textos dos balões são fixos (decisão do cliente: “não edita os balões”).

## ADR-021 — Insights por regra fixa
“Principais insights” da Inteligência são frases geradas por regras sobre os números exibidos, com amostra mínima de 10 registros e o `n` visível. Mostram associação, não causa. Nada de modelo generativo aqui.

## ADR-022 — Modelo de instrução versionado (exportar → adaptar → prévia → ativar)
A “inteligência do negócio” é um JSON (`isp-sprint/instrucao@1`) com jornadas (etapas, exigências, membros por e-mail, campos, automações), roteiro do Sprint (perguntas e dicas por etapa), objeções, regras dos insights e modelos de e-mail. Upload valida, calcula a prévia (`diffInstruction`) e grava rascunho; só a ativação aplica. Versões antigas ficam (`business_instructions`, uma ativa por empresa) e podem ser reativadas. Estrutura (jornadas/etapas/campos/automações) vive nas tabelas — fonte de verdade, editável também pelo painel; o JSON ativo guarda roteiro, objeções, insights e e-mails, e o export junta os dois. Ativação é bloqueada se remover etapa com oportunidade aberta.

## ADR-023 — Várias jornadas, etapas livres e membros
`pipelines` por empresa; oportunidade tem `pipeline_id` e etapa por chave livre da jornada (sem CHECK fixo). `ganha` e `perdida` são chaves reservadas dos tipos venda fechada/perda: relatórios e regras de contrato continuam valendo. Jornada sem membros = todos; quem não é membro só vê as próprias oportunidades daquela jornada; gerência vê tudo. A jornada é escolhida pelo tipo do deal (segmento) ou à mão.

## ADR-024 — Exigências por etapa e proposta anexada
Cada etapa declara o que exige para entrar (plano, proposta anexada, próxima ação, perguntas obrigatórias). O servidor confere na transição; a janela de avanço permite anexar a proposta ali mesmo. Anexos em `bytea` (até 5 MB, tipos conferidos pelos bytes).

## ADR-025 — Automações depois do commit
Gatilhos: criada, entrou na etapa, venda fechada, perdida, parada há X dias (cron). Ações: criar tarefa, enviar e-mail, mover etapa, duplicar em outro funil (copia eventos, atividades, respostas e anexos, com `duplicated_from_id`), trocar responsável. Rodam após a gravação; falha não desfaz a mudança e fica em `automation_runs`. Profundidade máxima 3 para evitar laço. Perdida não pode “mover etapa” na mesma jornada: usa duplicar.

## ADR-026 — Viabilidade: caminho por metragem e banda, comissão, CAC, payback, LTV
Função pura em `packages/domain/viability.ts`, centavos e pontos-base. O caminho de entrega sai da primeira regra ativa que casa metros de cabo e Mbps do plano (senão o padrão). Margem = mensalidade − tributos − parceiros − custo mensal do caminho. CAC = comissão + cabo + instalação + equipamentos − taxa de ativação (mín. 0). Payback = CAC ÷ margem. Comissão em três formatos (% da mensalidade, nº de mensalidades, valor fixo) por tipo de venda e faixa de preço. LTV histórico: carteira quando a amostra ≥ mínimo; senão vida média ou 1/churn do parâmetro. O resultado fica gravado na oportunidade; na venda fechada vale o cálculo do dia (comissão não muda retroativamente). Relatório de comissões respeita o nível: vendedor vê só as próprias.

## ADR-027 — Área de atendimento: região → condomínio
Decisão do cliente (“90% da área é condomínio”): hierarquia de dois níveis, com blocos e endereço no condomínio. O cadastro escolhe condomínio, bloco e apartamento; CEP consulta ViaCEP com 4 s de limite e segue manual se falhar.

## ADR-028 — E-mail por SMTP da empresa
Senha cifrada com AES-256-GCM (chave de `APP_ENCRYPTION_KEY` ou `COOKIE_SECRET`), nunca devolvida à tela. Todo envio, inclusive falha, vai para `email_messages` (append-only). Usos: proposta e follow-up ao cliente, alertas ao time (resumo diário, lead atribuído, venda fechada) e acesso de usuários. Textos vêm dos modelos de e-mail da instrução.

## ADR-029 — Gestão de Contratos: cabeçalho + versões só por INSERT (19/10/2026)
`contracts` guarda identidade, etapa, responsáveis e marcadores; os dados contratuais ficam em `contract_versions`, **append-only** por trigger (cada alteração é um INSERT com motivo e `change_kind`). Linha do tempo em `contract_events`, também append-only. Um contrato por oportunidade.

## ADR-030 — Processos paralelos com roteiro fixo por tipo
Implantação, renovação (pública/privada), reajuste e encerramento são `contract_processes` independentes, com etapas e exigências em `packages/domain/src/contracts.ts`. Arquivar só ao concluir o encerramento, com validação de Sucesso do Cliente.

## ADR-031 — Alertas contratuais sem duplicidade
Rotina diária e “Verificar agora” gravam um alerta por contrato + tipo + ciclo (`contract_alerts_uq`). Nada é encerrado por vencimento: o sistema avisa, abre o processo e cria tarefas.

## ADR-032 — Setores dos usuários (independentes do perfil)
`users.sectors` define quem recebe tarefas/e-mails e quem conclui cada etapa; documentos podem ser restritos a setores.

## ADR-033 — ERP e receita faturada sem simulação
Nenhum endpoint de ERP inventado: etapas de ERP viram tarefa com código informado por pessoa. Faturado/recebido ficam “Aguardando ERP”. E-mail que não sai aparece como “não enviado”.

## ADR-034 — Tipos de contrato e saldo por medição; modelos no editor de propostas
Recorrente, Frequente e Medição; movimentos em `contract_ledger` (append-only: crédito, consumo, estorno, faturamento). Consumo da medição acontece ao fechar a oportunidade e é estornado ao reabrir. Modelos de contrato reutilizam `proposal_templates` (`purpose = 'contrato'`) com a arte timbrada; assinatura pela ZapSign.

## ADR-035 — Login com Google, redefinição por e-mail e recuperação pelo deploy (20/10/2026)
- **Google (OIDC, code flow no servidor):** `state` aleatório em cookie assinado (HMAC, 10 min). Exige `email_verified`; domínios opcionais (`GOOGLE_ALLOWED_DOMAINS`). Não cria usuário: só entra em conta existente e ativa com o mesmo e-mail. O `sub` é vinculado no primeiro acesso, e outro `sub` para o mesmo e-mail é recusado. Trocar o e-mail do usuário desfaz o vínculo. `next` só aceita caminho interno.
- **Esqueci minha senha:** resposta idêntica exista ou não a conta. Token de 32 bytes guardado só como hash (`password_resets`), 1 h, uso único; um pedido invalida os anteriores. Redefinir desbloqueia e revoga as sessões.
- **Recuperação pelo deploy:** `ADMIN_RESET_EMAIL`/`ADMIN_RESET_PASSWORD` aplicados pelo `vercel-setup` em produção. A senha nunca vai para o log. As variáveis devem ser removidas após o uso.

## ADR-036 — Análise de aprovação sem base financeira paralela (20/10/2026)
A análise é calculada na hora a partir de cadastro, contratos, vendas e viabilidade (`services/approvals.ts`, regras puras em `packages/domain/src/approvals.ts`). Receita atual = contratos recorrentes ativos + vendas sem contrato (a venda com contrato conta só pelo contrato) + plano do cadastro quando não há nada. Custo atribuível = custo estimado na viabilidade da venda; se o valor atual diverge mais de 20% do vendido, o custo é tratado como desconhecido. Pagamentos, inadimplência, pontualidade, LTV realizado e rentabilidade realizada ficam “Aguardando IXC” (decisão do cliente: não importar planilha por enquanto).

## ADR-037 — Pedido = versão; decisão separada e append-only
`approval_requests` (imutável, versão por oportunidade, resumo financeiro e impressão digital) e `approval_decisions` (uma por pedido: aprovada, reprovada, correção, substituída). Alçada do usuário: setor Diretoria > perfil. Política configurável por alçada (desconto máximo e margem mínima opcional); acima da Diretoria = excepcional. Quem pede não decide. Mudança material (valor, preço de tabela, investimento, margem do novo serviço, receita atual, contratos ativos, classificação, situação, proposta anexada) exige confirmação explícita para aprovar e fica gravada na decisão.

## ADR-038 — Classificação, identidade e chat append-only
`contact_classifications` (vigente = mais recente), `contact_identity_links` (decisão humana “mesmo/diferente”; nada é consolidado sozinho) e `negotiation_messages` (chat interno; não entra no histórico do relacionamento). Avisos por WhatsApp/e-mail levam só o resumo seguro; o modelo recusa variáveis financeiras.

## ADR-039 — Atas de registro de preços dentro de Gestão de Contratos (20/10/2026)
- **Lugar:** aba “Atas de registro de preços” em Gestão de Contratos e ficha `/contracts/atas/:id`. Não é um módulo à parte: usa o mesmo nível de acesso de Contratos, mais os setores Comercial, Jurídico e Administração.
- **Saldo só pelo livro:** `arp_ledger` é append-only, com chave de idempotência única por tenant. O saldo é sempre recalculado (`computeBalances`), com a ata travada (`SELECT … FOR UPDATE`) em toda gravação. Correções entram como lançamentos compensatórios.
- **Reservar ≠ consumir:** a oportunidade reserva; a venda fechada não consome e gera tarefa de formalização. O consumo só acontece com empenho, contrato ou ordem de serviço anexado. Oportunidade de ata nunca gera negócio no Sucesso do Cliente; a perda libera a reserva.
- **Limites legais:** Lei 14.133/2021, art. 86, §§ 4º e 5º (50% por órgão e 200% no total, por item) são tetos fixos (`LEGAL_CAPS`). A configuração por regime só pode ser mais restritiva e é versionada; cada decisão guarda a versão usada. Acima do limite, só com exceção validada por alguém do setor Jurídico, com fundamento e parecer.
- **Operações entre itens** (conversão, remanejamento, correção, alteração de preço, cancelamento): simular → pedir → aprovar (outra pessoa) → efetivar com documento. Na efetivação o saldo é conferido de novo.
- **Importação em massa:** o arquivo (.xlsx ou .csv) é lido no navegador (`read-excel-file`, sem a biblioteca `xlsx` por causa de vulnerabilidades conhecidas). Só as linhas mapeadas vão ao servidor, que valida de novo. A prévia mostra o que entra, completa, corrige ou é bloqueado. Aplicar grava tudo ou nada. Ata vigente não aceita item, quantidade ou preço novos por planilha.

## ADR-040 — Identidade visual BKT (20/10/2026)
O visual segue o Brand Book BKT (GUIA_BKT_v4):
- **Cores e fontes:** azul #2F5986 e grafite #2D3339; Orbitron nos títulos e Work Sans no texto.
- **Grafismo:** hexágonos como elemento gráfico; o degradê grafite→azul aparece só em fundos.
- **Logo:** arquivos oficiais extraídos do guia, em `public/brand`; não é redesenhado.
- **Sem slogan e sem mascotes.** A Personalização deixou de aceitar imagens: a identidade é fixa para não ser alterada por engano.
- **Funil:** as cores padrão antigas das etapas são trocadas na exibição pela paleta da marca; cores escolhidas pelo admin são mantidas.

## ADR-041 — Ata atrelada pela própria oportunidade (20/10/2026)
- **Onde:** na oportunidade, quem edita a negociação pode atrelá-la a uma ata vigente sem precisar de acesso a Gestão de Contratos.
- **Usar saldo existente:**
  - cota do gerenciador ou de um participante;
  - ou adesão já autorizada de um não participante (consome só a quantidade aderida, dentro do prazo).
  - Refazer a escolha libera a reserva anterior e reserva a nova na mesma transação.
- **Pedir nova adesão:**
  - para órgão ou instituição não participante, já cadastrado ou novo;
  - o pedido fica ligado à oportunidade; quando o gerenciador autoriza, a quantidade autorizada é reservada para ela automaticamente (idempotente; só se a oportunidade estiver aberta e sem outra reserva).
- **Desatrelar:** libera as reservas; não é permitido se já houve consumo formalizado.
- **Formalizar** continua na ficha da ata, com documento e perfil de Contratos, Jurídico ou Administração.

## ADR-042 — Sucesso do Cliente integrado (jornada, inteligência da conta, cadência e cobertura) (21/10/2026)
- **Sem módulo paralelo.** Reaproveita o funil Sucesso do Cliente (ganhou a etapa *Planejamento*), contratos, clientes, oportunidades, atividades e a classificação estratégica existente (classes iniciais: Reputação, Potencial, Expansão, Aposta Estratégica; só Comercial ou Diretoria alteram).
- **Configuração versionada** (`cs_settings`, append-only, JSON validado no domínio): gatilho (funil, etapa, tipo de cliente e contrato, CSM padrão), modelos de jornada, faixas de Tier, pontos do IPC, pesos de saúde e criticidade, precedência da prioridade manual, cadências, pesos de cobertura, alertas, capacidade e scorecard. Cálculos e apurações guardam a versão usada.
- **Gatilho idempotente:**
  - Contrato validado vira negociação no funil Sucesso do Cliente, uma por contrato.
  - Ao entrar na etapa configurada, nasce a jornada, uma por contrato (chave única `contrato:<id>`), com marcos, tarefas, CSM, kickoff v1, avisos e histórico. Voltar à etapa não duplica.
  - Contratos de ata ficam fora (ADR-039).
- **Marcos e kickoff:**
  - Marcos de renovação ancorados na data real de fim da vigência.
  - Tarefas dos marcos nascem quando faltam 30 dias.
  - O kickoff é uma sequência de slides web com dados reais. O que falta entra como *pendente*, nada é inventado.
  - Cada edição gera uma versão nova (`cs_presentations`, append-only) e não altera o contrato.
  - Exporta PDF pelo navegador; link autorizado com token aleatório (só o hash é guardado), 30 dias, somente leitura.
- **Fotografia da conta** (`cs_accounts.snapshot`), recalculada diariamente e após cada ação:
  - **ACV/Tier:** consolidado por CNPJ raiz e vínculos "mesmo cliente", sem dupla contagem.
  - **IPC:** 7 critérios, 20 a 100. Tamanho e tempo são calculados; os demais são humanos. Incompleto não tem total.
  - **Saúde:** média ponderada só dos fatores com dado; inadimplência fica indisponível até o IXC.
  - **Criticidade:** explicada por motivos; a prioridade manual é separada, com prazo de revisão.
  - **Histórico:** mudanças de Tier, saúde, criticidade, prioridade manual, IPC e CSM ficam em `cs_assessments` (append-only).
- **Cadência e cobertura:**
  - Acompanhamentos são atividades com `cs_kind`, data prevista imutável (`cs_planned_at`), chave idempotente e o peso da criticidade da época.
  - Só conta o realizado *com resultado registrado* até a data prevista mais a tolerância. Reagendar não conta; extras ficam à parte; o resultado é limitado a 100%.
  - Recalcular remove só previstos futuros em aberto.
- **Alertas** (`cs_alerts`): um por chave e conta. Resolvem sozinhos quando o motivo some. E-mail ao CSM nos de nível alto; escalonamento configurável. Nunca usam dado ausente como confirmado.
- **Gestão:**
  - A carga de cada CSM considera frequência × esforço por interação, não só o número de contas.
  - O scorecard separa operacional, comercial, qualidade e risco.
  - A gamificação pontua só o realizado e comprovado.

## ADR-043 — Datas de eficácia, versão de item e conversão com parecer (21/10/2026)
- **Decisão:** toda movimentação guarda duas datas: `occurred_at` (sistema, imutável) e `effective_on` (quando vale juridicamente). Item de ata tem `version`; qualquer mudança em item já movimentado passa pela operação `alteracao_item` com aprovação de outra pessoa. Conversão entre itens exige critério escrito e, por regra versionada, parecer jurídico anexado na efetivação.
- **Por quê:** adesões e aditivos chegam com data anterior ao registro; auditoria precisa distinguir quando foi lançado de quando passou a valer. Alterar item movimentado sem trilha muda retroativamente o significado do saldo.
- **Consequência:** relatórios por período podem filtrar por qualquer das duas datas; a consolidação das atas lê o livro, não o item.

## ADR-044 — Tarefas de projeto são atividades do CRM (21/10/2026)
- **Decisão:** não existe tabela de tarefas separada. `activities` ganhou `project_id`, `project_stage_id`, `milestone_id`, `start_on` e `position`. Projeto, etapas, marcos, equipe, modelos e histórico têm tabelas próprias; vínculos com cliente/oportunidade/contrato/ata são colunas sem FK, validadas por empresa na API.
- **Por quê:** a pessoa tem uma agenda só; indicadores e o motor de eventos (Etapa 5) leem um lugar só. Vínculos sem FK não travam a limpeza da base.
- **Consequência:** concluir pela agenda move a tarefa no quadro (e o contrário). Responsável de tarefa precisa estar na equipe (observador não). Etapa 4 estende a mesma tabela (subtarefas, checklist, dependências, recorrência, tempo).

## ADR-045 — Regras de conclusão da tarefa num ponto só (21/10/2026)
- **Decisão:** toda conclusão passa por `applyStatus` (agenda, tela de tarefas, quadro do projeto): confere dependências e subtarefas, desvia para aprovação quando exigida, cria a próxima ocorrência da recorrência (chave `série:data`, idempotente) e move a tarefa no quadro do projeto. Um gatilho no banco mantém `status = 'concluida'` ⇔ `completed_at` preenchido.
- **Checklist** tem endpoint por item (incluir, marcar, renomear, retirar) com bloqueio de linha, sem `rowVersion`, para várias pessoas marcarem ao mesmo tempo sem conflito.
- **Avisos** reaproveitam o ícone de Menções (consulta única que une negociação e tarefas), sem criar um segundo sistema de notificação.
- **Por quê:** o mesmo registro aparece em várias telas; regra espalhada vira divergência.

## ADR-046 — Eventos de negócio por projeção, não por gancho em cada tela (21/10/2026)
- **Decisão:** os eventos são derivados das tabelas de origem por um projetor idempotente (`INSERT … ON CONFLICT DO NOTHING` pela chave), executado antes das telas de desempenho (se a última execução tiver mais de 1 minuto), na rotina diária e sob demanda. A mesma rotina faz a carga histórica.
- **Por quê:** um gancho em cada tela esquece caminhos (automação, importação, agenda, quadro) e duplica fatos; a projeção lê o estado gravado, que é a verdade. Reabrir a origem invalida o evento, em vez de apagar.
- **Atribuição:** créditos fixados na criação com a versão da regra; "Resultado" soma 100% (o arredondamento fica com o responsável); "Participação" e "Gestão" reconhecem sem somar no individual.
- **Imutabilidade:** gatilho permite mudar só a validação do evento; créditos, revisões e configuração são append-only.

## ADR-047 — Indicadores sobre eventos, fórmula interpretada e base para a Gestão de Resultados (21/10/2026)
- **Decisão:** indicadores leem só `business_events` válidos e créditos; campos e filtros vêm de listas fechadas no domínio e todo valor é parametrizado. Fórmulas usam um analisador próprio (sem `eval`/`Function`).
- **Metas** guardam alvo original, versão e consolidação; mudanças após o início exigem motivo e autorização. Resultado do período é fechado em `goal_results` (append-only) — é a "apuração oficial" que a Gestão de Resultados usará para as intervenções (vermelho; dois amarelos seguidos).
- **Objetivos** em três níveis, encadeados (substituíram o desenho inicial de OKR simples: OKR = objetivo + metas como resultados-chave).
- **Ordem combinada com o usuário:** Etapa 6 → fases da Gestão de Resultados → Etapas 7–10.


## ADR-048 — Menu em grupos, Gestão de Times, ABM e Produto (21/10/2026)
- **Decisão:** o menu segue a hierarquia definida pelo usuário, em grupos recolhíveis; módulos de permissão não mudaram — só rótulos e posição (ABM usa o nível de Contas; Produto é consulta para qualquer usuário autenticado e a edição continua em Configuração).
- **Renome:** "Gestão de Resultados" → **Gestão de Times** (rota `/times`, antiga redireciona); "Clientes" → **Contas**. Identificadores internos (`resultados`, `clientes`) ficam como estão para não quebrar perfis, auditoria e integrações.
- **ABM** reaproveita contas, oportunidades, tarefas e projetos existentes; só acrescenta a camada de "conta-alvo" (tier, situação, motivo, próximo passo) com histórico append-only. Uma conta só pode estar uma vez na lista.
- **Projetos** e **Gestão de Times** viraram grupos (Projetos/Tarefas; Visão geral/Objetivos e metas), conforme escolhido pelo usuário.

## ADR-049 — Intervenções por projeção da apuração oficial (21/10/2026)
- **Decisão:** intervenções são derivadas de `result_closings` (versão vigente por competência) por uma projeção idempotente, como os eventos de negócio (ADR-046). Avalia só as duas últimas competências de cada série — suficiente para "dois amarelos seguidos" e para retificação do mês anterior, sem reabrir histórico antigo.
- **Unicidade:** índice único parcial (uma intervenção aberta por série). Reincidência acrescenta competência; revisão que piora vira plano.
- **Responsabilidade:** dono e cadeia de escalonamento vêm da estrutura organizacional (líder → responsável da unidade → acima → Diretoria), fixados na abertura. Escalonar só aumenta o nível; todos os acionados continuam vendo.
- **Separação de papéis:** o avaliado não registra nem dispensa; dispensar exige alguém acima do responsável, com justificativa. Tudo fica em `intervention_events` (append-only).
- **Avisos** reaproveitam o sino de Menções (mesmo padrão de ADR-045), com leitura por intervenção.

## ADR-050 — Análise de causa como etapa obrigatória antes do plano (21/10/2026)
- **Decisão:** a análise (problema, Pareto, Ishikawa, 5 Porquês) é um documento por intervenção (`intervention_analyses`, conteúdo JSON validado no domínio e na API). Ações relevantes (iniciar, concluir, reabrir) ficam em `intervention_events`.
- **Regra de completude no domínio** (`analysisGaps`): problema descrito e dimensionado; Pareto com ≥2 itens; Ishikawa com ≥3 causas e ≥1 escolhida; ≥3 porquês e causa raiz por causa escolhida; ≥1 causa raiz confirmada com evidência.
- **Plano bloqueado sem análise concluída** por padrão (`interventions.requireAnalysis`), para evitar plano que trata sintoma. A empresa pode desligar.
- **Pareto com dado real** só onde o dado existe hoje: negociações perdidas (evento válido) por motivo no período da meta, das pessoas da meta. Outros recortes ficam manuais até haver fonte confiável.
- **Categorias do Ishikawa** são os 6M renomeados para o contexto comercial (Pessoas, Ferramentas, Oferta, Mercado…), fixas no domínio.

## ADR-051 — Ação do plano é tarefa (5W2H) (21/10/2026)
- **Decisão:** cada ação 5W2H cria uma tarefa em `activities`; `intervention_actions` guarda só o que a tarefa não tem (por quê, causa raiz, onde, como, custo, motivo de cancelamento) e aponta para ela. Responsável, prazo e situação são lidos da tarefa — sem cópia que diverge.
- **Por quê:** a execução acontece onde o time já trabalha (Tarefas, quadro do projeto, avisos, recorrência, aprovação); a intervenção só acompanha.
- **Conclusão** da intervenção depende das tarefas (`planConclusionBlockers`). Cancelar uma ação cancela a tarefa pelo mesmo caminho de status das tarefas (ADR-045).
- **Projeto** é opcional e ligado à intervenção; novas ações entram nele, respeitando a regra de equipe do projeto.

## ADR-052 — Intervenção manual sobre um indicador (21/10/2026)
- **Decisão (pedido do usuário):** além das intervenções disparadas pela apuração, qualquer pessoa com acesso à Gestão de Times abre uma intervenção por iniciativa própria (gatilho `manual`), escolhendo o indicador acompanhado e o escopo. Meta e série ficam opcionais; restrições no banco garantem título e motivo na manual e meta/série nas automáticas.
- Escopo limitado ao alcance de quem abre (pessoa/time/unidade); empresa toda só pela Diretoria. A cadeia de escalonamento vem da estrutura do escopo (ou do time de quem abre).
- A projeção das intervenções automáticas não dispensa a manual (ela não cobre competências).

## ADR-053 — Rituais com pauta automática e ata fotografada (21/10/2026)
- **Decisão:** ritual é a regra (cadência, escopo, pauta fixa); cada data vira uma reunião materializada sob demanda (as duas próximas, chave única ritual+data) e um compromisso na agenda. A pauta automática é calculada ao vivo enquanto a reunião está aberta e **fotografada** ao encerrar — a ata mostra o que se sabia naquele momento.
- **Decisões e impedimentos** herdam o escopo da reunião ou da intervenção de origem; visibilidade segue a estrutura (ADR da Fase 2) mais quem registrou e quem responde. Revogar/encerrar sempre com motivo; nada é apagado (`governance_events` append-only).
- **Escalonar impedimento** usa a mesma cadeia da estrutura das intervenções (líder → unidade → acima → Diretoria).

## ADR-054 — ABM como camada sobre o cadastro único (21/10/2026)
- **Decisão:** a organização continua sendo o registro de Contas; o ABM guarda só a estratégia (status ABM, prioridade, objetivo, origem, motivo) e aponta para a conta. Nova conta cria o registro de Contas normal (o mesmo que o CRM usa) e já a inclui no ABM.
- **Deduplicação** antes de criar: CNPJ igual bloqueia; raiz de CNPJ, nome parecido (normalizado, abreviações) e cidade geram aviso; seguir exige justificativa, guardada no histórico. Busca é na empresa toda (não só na carteira), mas dados de contas de outra carteira não são expostos.
- **Status comercial é derivado** (cliente, contratos ativos/encerrados, oportunidades abertas, última interação, prospecção registrada); o status ABM é independente e pode continuar ativo depois que a conta vira cliente.
- Fusão de cadastros duplicados fica para fase própria (exige confirmação humana e migração de referências).

## ADR-055 — Valores de indicador se ajustam ao cartão (21/10/2026)
- **Decisão (pedido do usuário):** número de indicador nunca quebra linha; reduz a fonte até caber (componente `FitText`, com `width:0; min-width:100%` para não alargar a grade). Ajuste por medição real, não por quantidade de caracteres.

## ADR-056 — Poder de influência é avaliação humana, nunca calculada (21/10/2026)
- **Contexto:** o mapa de influência do ABM orienta onde investir relacionamento. Se uma automação, importação ou pesquisa mudasse a influência, a equipe perderia o controle sobre uma avaliação política e subjetiva.
- **Decisão:** a influência só é gravada por uma função (`applyInfluence`) chamada a partir de uma avaliação manual com justificativa; o domínio recusa qualquer origem que não seja "manual"; a edição comum do stakeholder rejeita o campo. Avaliação por contexto (conta, departamento, processo). Histórico append-only. Quem vê/avalia e se exige aprovação são configuráveis e versionados; quem pede não aprova. O sistema pode recomendar ações, nunca alterar a avaliação.
- **Consequência:** "Não avaliado" é um estado legítimo e fica fora da matriz; posicionamento e interesse são dimensões independentes da influência.

## ADR-057 — Plays do ABM são roteiros que geram tarefas, sugeridos sem alterar avaliações (21/10/2026)
- **Contexto:** plays precisam virar trabalho real e acompanhável, e as recomendações não podem mexer em avaliações humanas (ADR-056). Já existe "Plays/Campanhas" para campanhas de marketing em massa.
- **Decisão:** plays do ABM ficam no ABM (por conta e por pessoa), separados das campanhas. Cada etapa vira uma tarefa do módulo de Tarefas (fonte única de situação, prazo e responsável). Definição versionada (append-only); execução guarda a versão. Sugestões são calculadas na hora a partir de critérios explícitos e mostram os motivos; leem influência/posicionamento só como entrada e nunca os gravam. Modelos copiados por empresa na primeira consulta (idempotente).
- **Consequência:** o resultado de um play é declarado por quem encerra (atingiu ou não o critério); métricas de efetividade por play saem dessas execuções (Fase 7).

## ADR-058 — Trilha da jornada lê os marcos; links externos são individuais, com código e registro (21/10/2026)
- **Contexto:** a jornada já tinha marcos, linha do tempo e um link único (kickoff). A trilha precisa ser apresentável ao cliente sem expor dados internos e sem criar uma segunda fonte de verdade.
- **Decisão:** a trilha é só uma visualização dos `cs_milestones` (situação calculada no domínio). Links da trilha ficam numa tabela própria (vários por jornada), com token e código guardados como hash (código com scrypt, mostrado uma vez), prazo, revogação com motivo, bloqueio após 5 códigos errados e registro append-only de cada uso. A página pública mostra marcos, fases e datas; observações só se o link permitir; responsáveis internos nunca. O histórico dos marcos passa a ser gravado em toda mudança (append-only); conclusões anteriores foram reconstituídas e sinalizadas.
- **Consequência:** o link de kickoff existente não mudou; a revogação e o prazo valem por link.

## ADR-059 — Vínculos de pessoas por registro, sem duplicar cadastro (21/10/2026)
- **Contexto:** a Fase 8 do ABM liga o mapa de pessoas ao trabalho comercial (oportunidades, contratos, leads) sem criar CRM paralelo.
- **Decisão:** uma tabela de vínculos (`stakeholder_links`) liga o stakeholder (pessoa na conta) a um registro existente, com papel válido para o tipo de registro; só pessoas da mesma conta; remover é marcar com motivo (histórico na pessoa). A influência por oportunidade usa o contexto "oportunidade" da avaliação manual existente. Plays podem apontar para uma oportunidade e suas tarefas recebem o vínculo. Códigos externos (origem do cadastro, IDs do cliente) são só exibidos.
- **Consequência:** relatórios de cobertura (Fase 7) podem medir quem decide em cada oportunidade a partir dos vínculos.

## ADR-060 — Pesquisas: destinos explícitos, revisão para dados sensíveis, influência fora (21/10/2026)
- **Contexto:** pesquisas por link podem atualizar o cadastro, mas não podem virar um caminho automático para mudar avaliações humanas.
- **Decisão:** cada pergunta declara um destino de uma lista fechada; influência não existe na lista e qualquer tentativa é recusada. Posicionamento, e-mail e telefone sempre passam por revisão; interesse e NPS/CSAT podem ser automáticos. NPS/CSAT gravam no registro de pesquisas existente do Sucesso do Cliente (sem tabela paralela de saúde). Convites são individuais, com token em hash, prazo e uso único; respostas e versões são append-only. A resposta vira evento de negócio para os indicadores.
- **Consequência:** o histórico da pessoa mostra o que mudou "via pesquisa"; a liderança decide o que é sensível.

## ADR-061 — Sinais calculados com chave estável, resolução automática e supressão (22/10/2026)
- **Contexto:** acompanhar contas estratégicas pede alertas acionáveis sem virar ruído nem duplicar.
- **Decisão:** regras puras no domínio geram candidatos com chave estável por conta (ex.: `pessoa:<id>`); a sincronização abre (um aberto por chave), atualiza, resolve sozinha quando a condição some e respeita supressão após tratado (7 dias) ou descartado (30 dias). Sinais registrados pela equipe só fecham por ação humana. Cadências geram tarefas reais (idempotentes por cadência e data). Interações reaproveitam atividades, e-mails, respostas de pesquisa e visitas; a atividade ganhou a lista de pessoas da conta envolvidas.
- **Consequência:** a inteligência (Fase 7) e futuros indicadores podem contar sinais tratados e tempo de resposta.

