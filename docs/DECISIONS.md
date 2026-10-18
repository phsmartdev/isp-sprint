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

