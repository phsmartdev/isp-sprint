# Pessoas & Cultura — Ambiente Digital de Experiência do Colaborador (Fase 1: Fundação Social)

Módulo da ISP-SPRINT, não uma aplicação à parte: usa a mesma API (Fastify), o mesmo front (React + Vite),
a mesma autenticação por sessão, a mesma matriz de acesso, a mesma liberação de módulos por equipe/pessoa,
o mesmo isolamento por empresa (`tenant_id`) e o mesmo design system.

## 1. Diagnóstico técnico

### Arquitetura encontrada
| Camada | O que existe | Como o módulo usa |
|---|---|---|
| Front | React 18 + Vite + React Router + TanStack Query + Tailwind (tokens próprios), ícones `lucide-react`, telas carregadas sob demanda | Telas em `apps/web/src/pages/people`, rotas sob `/pessoas`, mesmo `AppShell` |
| Back | Fastify + Zod (`defineRoute`: valida corpo/consulta/parâmetros, exige módulo e funcionalidade, limita requisições) | Rotas em `apps/api/src/routes/people.ts`, serviços em `apps/api/src/services/people/` |
| Banco | PostgreSQL + Drizzle ORM, migrações em `apps/api/migrations` (aplicadas no build da Vercel) | Tabelas `people_*` com `tenant_id` |
| Autenticação | Sessão por cookie assinado (`sessions`), CSRF por origem | Nenhuma mudança |
| Permissões | Matriz por perfil (`roles` + `access_policies`, níveis Nenhum/Próprio/Equipe/Total), módulos de negócio por empresa com liberação por equipe/pessoa (`tenant_modules` + `module_grants`), funcionalidades, ações sensíveis, setores do usuário | Novo módulo técnico `pessoas` e módulo de negócio `pessoas_cultura` |
| Multiempresa | `tenant_id` em todas as tabelas; o contexto da sessão carrega a empresa | Toda consulta filtra pela empresa da sessão |
| Estrutura organizacional | `users` (cargo, setores), `teams` → `org_units` (diretoria/área/unidade) | Cargo, área e unidade são **lidos**, nunca copiados |
| Arquivos | Guardados no banco (`bytea`), validação do tipo pelos bytes, envio grande em partes (até 50 MB) | Mídias do feed (Etapa 2) |
| Auditoria | `audit_logs` via `audit(...)` (ator, ação, entidade, IP, requisição) | Toda operação administrativa e de moderação |
| Notificações | Sino (atividades), menções (`@`), e-mail (`email_messages`), WhatsApp (Z-API, `integration_logs`) | Etapa 5: notificação interna nova + canais existentes |
| Testes | Vitest (domínio, web, API contra Postgres real) e Playwright (e2e) | Testes por etapa |

### Reaproveitado
Autenticação, sessão, matriz de acesso, liberação de módulos (piloto do RH sem mexer no resto da empresa),
setores da empresa (papéis do módulo), cadastro de usuários e foto, times e unidades organizacionais,
auditoria, limites de requisição, componentes (`PageHeader`, `Avatar`, `Button`, `Chip`, `FormField`,
`Input`, `Textarea`, `EmptyState`, `ErrorState`, `LoadingRows`, `useToast`), grafismo de hexágonos,
envio de arquivos em partes, e-mail e WhatsApp.

### Novo
Módulo técnico `pessoas`, módulo de negócio `pessoas_cultura`, perfil social (só campos opcionais),
parâmetros do módulo e, nas próximas etapas, publicações, mídias, comentários, reações, salvos, comunidades,
reconhecimentos, comunicados, leituras, denúncias, moderação e a caixa de notificações internas.

### Decisões de arquitetura (para validação)
1. **Papéis sem permissão paralela.** Colaborador = nível Próprio no módulo; Gestor = Equipe; administração do
   módulo = Total. Comunicação Interna, Pessoas e Cultura e Moderação = **setores da empresa** marcados nas
   Configurações do módulo. A administração do sistema (Configurações = Total) só configura parâmetros.
   **Nenhum papel abre conteúdo privado de comunidade**: isso depende só de ser membro.
2. **Piloto.** O módulo nasce **ligado só para quem for liberado** (Configurações → Módulos → Pessoas & Cultura → liberar a equipe do RH).
3. **Mídias no banco** (padrão atual): imagens reduzidas no navegador (limite configurável, padrão 5 MB) e vídeos
   em partes (padrão 50 MB). Para volume alto de vídeo, a evolução natural é um armazenamento de objetos
   (ex.: Supabase Storage) atrás da mesma rota — decisão a tomar antes de abrir para a empresa toda.
4. **Notificações internas**: hoje não existe uma caixa de notificações genérica (o sino lista atividades). A Etapa 5 cria
   `user_notifications` genérica, reutilizável pelos outros módulos, e usa e-mail/WhatsApp existentes conforme a
   configuração por evento. GLPI e IXC não recebem conteúdo social (não é a finalidade deles).

### Riscos
- Volume de mídia no banco (custo e tamanho) — ver decisão 3.
- Moderação de conteúdo privado: moderadores veem **só o item denunciado**, não a comunidade inteira.
- LGPD: o módulo lê só nome, foto, cargo, times e unidades; contatos só com autorização da pessoa; sem
  rankings individuais nem métricas de produtividade por interação.
- Desempenho do feed: paginação por cursor e índices desde a primeira tabela.

## 2. Plano por etapas
| Etapa | Escopo | Situação |
|---|---|---|
| 1. Fundação | Módulo, navegação, permissões, perfil social, parâmetros | **Entregue** |
| 2. Feed | Publicações, mídias, comentários e respostas, reações, salvos, rascunho, paginação por cursor | Próxima |
| 3. Comunidades | Pública/privada/institucional, pedidos, convites, moderadores, fixar, arquivar | — |
| 4. Cultura e Comunicação | Reconhecimentos e categorias, comunicados segmentados, confirmação de leitura versionada | — |
| 5. Governança | Denúncias e moderação, notificações internas e por canal, painel administrativo | — |
| 6. Consolidação | Indicadores agregados, testes de permissão e isolamento, responsividade, documentação | — |

## 3. Etapa 1 — entrega

**Funcionalidades:** entrada "Pessoas & Cultura" no menu (só para quem tem o módulo liberado e nível no módulo);
Meu Espaço (saudação, foto, cargo/área/unidade, atalho para o perfil, convite para completar o perfil, busca de colegas);
perfil social (institucional do cadastro + bio, interesses, competências e contatos autorizados); edição só dos
campos opcionais; Configurações do módulo (setores por papel, limites de publicação) com auditoria.

**Migração `0135_pessoas_cultura_fundacao`** (não destrutiva): tabelas `people_profiles` e `people_settings`;
`pessoas` e `pessoas_cultura` incluídos nas restrições de módulos; nível padrão no módulo para os perfis existentes
(Administrador = Total, Operação = Próprio, demais = Equipe); módulo registrado em cada empresa como "só liberados".

**APIs:** `GET /pessoas/me`, `GET /pessoas/perfis/:userId`, `PUT /pessoas/perfil`, `GET /pessoas/colaboradores`,
`GET|PUT /pessoas/config`.

**Testes:** `apps/api/test/people.test.ts` (piloto por equipe/pessoa, papéis por setor, perfil e privacidade,
campos oficiais não editáveis, isolamento entre empresas) e `tests/e2e/pessoas-fundacao.spec.ts`
(menu, Meu Espaço, perfil de colega, edição, configurações, celular e bloqueio de quem não foi liberado).
