/**
 * Playbook institucional "Diretriz de Gamificação" (Governança e Compliance), criado uma vez por empresa.
 * O texto explica princípios e responsabilidades; os números vêm dos blocos interativos, que leem a regra
 * aprovada no momento da leitura (não envelhecem quando a regra muda). Novas versões seguem a aprovação normal.
 */
import { and, eq, sql } from 'drizzle-orm';
import { contentText, nextReview, playbookCode, type Block, type PlaybookContent } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { todayIn } from './vacations';

export const GUIDELINE_CONTEXT = 'sistema:diretriz_gamificacao';

let n = 0;
const id = () => `g${(n++).toString(36)}`;
const H = (text: string, level: 1 | 2 = 1): Block => ({ id: id(), type: 'heading', level, text });
const T = (text: string): Block => ({ id: id(), type: 'text', text });
const C = (kind: 'atencao' | 'importante' | 'exemplo' | 'dica', title: string, text: string): Block => ({ id: id(), type: 'callout', kind, title, text });

export function guidelineContent(): PlaybookContent {
  n = 0;
  return { blocks: [
    C('importante', 'Para que serve', 'A gamificação reforça o jeito certo de trabalhar: seguir a jornada de cada venda, cumprir prazos, ajudar colegas e fechar negócios juntos. Ela **não** serve para expor ninguém nem para criar disputa entre colegas.'),
    H('Princípios'),
    T('- **Colaborativa, não competitiva.** Não existe ranking, placar público nem pódio.\n- **Proporcional à responsabilidade.** Cada nível de competência tem a sua meta; ninguém é comparado com quem tem outro papel.\n- **O coletivo pesa.** Parte da nota de todos vem da média do time; quanto mais alto o nível, mais pesa o time e a área.\n- **Time nivelado é sinal de boa liderança.** A dispersão do time entra na nota de quem lidera.\n- **Pedir e dar ajuda vale ponto.** Pedir apoio cedo é comportamento desejado.\n- **Uma regra só, aprovada e conhecida.** Nada é decidido caso a caso.\n- **Só o primeiro lugar do ano é reconhecido**, com o Selo BK de Qualidade.'),
    H('A regra vigente'),
    T('Os números abaixo são lidos da regra aprovada **agora**. Se a regra mudar, este bloco muda junto. Navegue pelas abas: níveis, como pontuar, simulador de nota e indicadores da liderança.'),
    { id: id(), type: 'gamification_rule', title: 'Regra vigente da gamificação' },
    H('Calculadora de meta'),
    T('Quer chegar a um número de pontos? Escolha a tarefa e veja quantas vezes precisa fazer, ou monte um plano com várias tarefas.'),
    { id: id(), type: 'gamification_calc', title: 'Quantas tarefas faltam para a minha meta?' },
    C('dica', 'Pontos mais rápidos', 'Concluir **no prazo** e com qualidade (tarefa qualificada pela gerência) rende mais do que fazer mais tarefas atrasadas.'),
    H('Pedido de Apoio'),
    T('Qualquer pessoa pode pedir ajuda ao time ou a um colega, de qualquer tela. Os pontos só entram quando **quem pediu confirma** que foi atendido.'),
    { id: id(), type: 'flow', title: 'Do pedido aos pontos', nodes: [
      { id: 'a', kind: 'inicio', label: 'Pedido aberto', guidance: 'Para o time ou para um colega, ligado ou não a uma tarefa.', x: 0, y: 0 },
      { id: 'b', kind: 'etapa', label: 'Colega assume', guidance: 'Quem vai ajudar assume o pedido.', x: 0, y: 100 },
      { id: 'c', kind: 'etapa', label: 'Colega atende', guidance: 'Ajuda dada; o pedido aguarda confirmação.', x: 0, y: 200 },
      { id: 'd', kind: 'decisao', label: 'Quem pediu confirma?', guidance: 'Só quem pediu pode confirmar.', x: 0, y: 300 },
      { id: 'e', kind: 'fim', label: 'Pontos para os dois', guidance: 'Quem ajudou e quem pediu pontuam, até o teto mensal.', x: 0, y: 400 },
    ], edges: [{ id: 'e1', from: 'a', to: 'b' }, { id: 'e2', from: 'b', to: 'c' }, { id: 'e3', from: 'c', to: 'd' }, { id: 'e4', from: 'd', to: 'e', label: 'Sim' }, { id: 'e5', from: 'd', to: 'c', label: 'Ainda não' }] },
    H('Reconhecimento'),
    T('O único reconhecimento individual é o **Selo BK de Qualidade**, para a maior nota do ano (empate: todos os empatados). Não há segundo nem terceiro lugar. O restante do time é reconhecido pelas faixas do ano, que todos podem alcançar.'),
    C('atencao', 'Não monte rankings por fora', 'Planilhas, apresentações ou mensagens comparando pessoas desfazem o princípio da ferramenta e não são permitidas.'),
    H('Responsabilidades da gestão'),
    { id: id(), type: 'checklist', mode: 'operacional', title: 'Rotina da liderança', items: [
      { id: 'r1', text: 'Manter o nível de competência de cada pessoa correto' },
      { id: 'r2', text: 'Manter as jornadas de cada funil alinhadas ao processo de venda real' },
      { id: 'r3', text: 'Qualificar tarefas da jornada quando quiser reconhecer aderência ao processo' },
      { id: 'r4', text: 'Acompanhar a dispersão do time e agir quando sair do verde' },
      { id: 'r5', text: 'Usar a nota em conversas individuais, nunca em comparações públicas' },
      { id: 'r6', text: 'Revisar a regra pelo menos uma vez por ano ou quando o processo comercial mudar' },
    ] },
    H('Governança da regra'),
    { id: id(), type: 'steps', items: [
      { title: 'Proposta', text: 'Quem administra o sistema ou a área de resultados propõe uma nova versão (metas, pesos, bônus, jornadas). Uma proposta por vez.' },
      { title: 'Aprovação por outra pessoa', text: 'Quem propõe nunca aprova a própria proposta. Recusa precisa de motivo.' },
      { title: 'Vigência', text: 'A versão aprovada vale a partir da aprovação; enquanto nenhuma estiver aprovada, não há notas.' },
      { title: 'Histórico', text: 'Todas as versões ficam guardadas: quem propôs, quem decidiu, quando e por quê.' },
    ] },
    { id: id(), type: 'feature', path: '/times/pessoas?aba=gamificacao', label: 'Abrir Gestão de Times → Gamificação' },
    H('Transparência e contestação'),
    T('A nota é calculada a partir do que está no CRM: tarefas concluídas, prazos, negócios ganhos e apoios confirmados. Não existe lançamento manual de pontos.'),
    { id: id(), type: 'decision', title: 'Minha nota não está como eu esperava', start: 'q1', nodes: [
      { id: 'q1', question: 'A tarefa está concluída no CRM, com você como responsável?', options: [{ label: 'Não', next: null, result: 'Conclua a tarefa ou peça para corrigir o responsável. A nota se ajusta sozinha.' }, { label: 'Sim', next: 'q2' }] },
      { id: 'q2', question: 'Ela faz parte da jornada do funil da oportunidade?', options: [{ label: 'Não sei / não', next: null, result: 'Só tarefas da jornada pontuam. Confira a jornada na aba "Como pontuar" da regra vigente.' }, { label: 'Sim', next: 'q3' }] },
      { id: 'q3', question: 'O pedido de apoio foi confirmado por quem pediu?', options: [{ label: 'Não é apoio', next: null, result: 'Procure a sua liderança: ela confere o registro no CRM. Se o registro estiver certo e a discordância for com a regra, o caminho é propor uma mudança da regra.' }, { label: 'Não foi confirmado', next: null, result: 'Peça a confirmação: apoio só pontua depois dela.' }] },
    ] },
    H('Perguntas frequentes'),
    { id: id(), type: 'faq', items: [
      { q: 'Posso ver a nota dos meus colegas?', a: 'Não. Cada pessoa vê a própria nota. A liderança vê o time que lidera, para apoiar.' },
      { q: 'Por que a minha meta é diferente da de um colega?', a: 'Porque a meta depende do nível de competência: cada um é medido contra o que se espera do próprio papel.' },
      { q: 'Se o time vai mal, a minha nota cai?', a: 'Em parte, sim. A média do time compõe a nota de todos; é assim que a regra incentiva a colaboração.' },
      { q: 'Fiz trabalho de um nível acima do meu. Ganho mais?', a: 'Sim, como crédito extra, com bônus por nível acima e um teto mensal.' },
      { q: 'Pedir ajuda me prejudica?', a: 'Não. Quem pede também pontua quando o apoio é confirmado.' },
      { q: 'Quem muda as regras?', a: 'A administração, por proposta e aprovação de pessoas diferentes, com histórico de tudo.' },
    ] },
  ] };
}

/** Cria o playbook uma vez (na categoria de Governança e Compliance, se existir e estiver ativa). */
export async function ensureGamificationGuideline(db: DbOrTx, tenantId: string, tz = 'America/Sao_Paulo') {
  const done = await db.execute(sql`select 1 from playbook_versions where tenant_id = ${tenantId} and meta->'contexts' ? ${GUIDELINE_CONTEXT} limit 1`);
  if (done.rows.length) return null;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pb-guideline:${tenantId}`}))`);
    const again = await tx.execute(sql`select 1 from playbook_versions where tenant_id = ${tenantId} and meta->'contexts' ? ${GUIDELINE_CONTEXT} limit 1`);
    if (again.rows.length) return null;
    const [cat] = await tx.select().from(s.playbookCategories).where(and(eq(s.playbookCategories.tenantId, tenantId), eq(s.playbookCategories.prefix, 'GOV'), eq(s.playbookCategories.active, true))).limit(1);
    if (!cat) return null;
    const [st] = await tx.select().from(s.playbookSettings).where(eq(s.playbookSettings.tenantId, tenantId));
    const count = (await tx.select({ n: sql<number>`count(*)::int` }).from(s.playbooks).where(and(eq(s.playbooks.tenantId, tenantId), eq(s.playbooks.categoryId, cat.id))))[0]!.n;
    let seq = count + 1, code = playbookCode(st?.codePattern ?? '{CAT}-PB-{NUM}', cat.prefix, seq);
    while ((await tx.select({ id: s.playbooks.id }).from(s.playbooks).where(and(eq(s.playbooks.tenantId, tenantId), eq(s.playbooks.code, code)))).length) code = playbookCode(st?.codePattern ?? '{CAT}-PB-{NUM}', cat.prefix, ++seq);
    const today = todayIn(tz);
    const content = guidelineContent();
    const meta = { title: 'Diretriz de Gamificação', description: 'Como a gamificação do time funciona: princípios, regra vigente, calculadora de meta, Pedido de Apoio, reconhecimento e governança.', keywords: ['gamificação', 'pontos', 'meta', 'nota', 'selo', 'apoio'], type: 'politica', criticality: 'media', ownerTeamId: null, costCenterId: null, maintainerId: null, visibility: 'corporativo', teamIds: [], costCenterIds: [], profiles: [], userIds: [], reviewPeriod: 'anual', reviewCustomDays: null, nextReviewOn: null, requiresAck: true, contexts: [GUIDELINE_CONTEXT] };
    const next = nextReview(today, 'anual', null);
    const [p] = await tx.insert(s.playbooks).values({ tenantId, code, categoryId: cat.id, title: meta.title, description: meta.description, visibility: 'corporativo', reviewPeriod: 'anual', lastReviewOn: today, nextReviewOn: next, requiresAck: true }).returning();
    const [v] = await tx.insert(s.playbookVersions).values({ tenantId, playbookId: p!.id, number: '1.0', status: 'vigente', meta, content: content as unknown as { blocks: unknown[] }, searchText: contentText(content), changeSummary: 'Versão inicial criada pelo sistema a partir da regra de gamificação.', relevant: true, publishedAt: new Date(), effectiveFrom: today }).returning();
    await tx.update(s.playbooks).set({ currentVersionId: v!.id }).where(eq(s.playbooks.id, p!.id));
    await tx.insert(s.playbookEvents).values({ tenantId, playbookId: p!.id, versionId: v!.id, type: 'publicada', note: 'Versão 1.0 publicada pelo sistema: documentação da gamificação (a regra em si é aprovada em Gestão de Times). Novas versões seguem a aprovação normal.', actorId: null });
    return p!.id;
  });
}
