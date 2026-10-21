import { describe, expect, it } from 'vitest';
import { PLAY_TEMPLATES, accountGaps, planSteps, runProgress, suggestPlays, validatePlay, type AccountCtx, type SuggestablePlay } from './abmPlays';

const plays: SuggestablePlay[] = PLAY_TEMPLATES.map((t) => ({ id: t.key, name: t.name, category: t.category, audience: t.audience, active: true }));
const base: AccountCtx = { commercial: 'prospeccao', nature: 'publica', nextContractEndDays: null, influenceVisible: true, running: new Set(), stakeholders: [] };
const person = (o: Partial<AccountCtx['stakeholders'][number]>): AccountCtx['stakeholders'][number] => ({ id: 'p', name: 'Pessoa', roles: [], stance: 'desconhecido', influence: 'nao_avaliado', relationship: 'nao_avaliado', active: true, ...o });

describe('plays do ABM', () => {
  it('os 9 modelos são válidos', () => {
    expect(PLAY_TEMPLATES).toHaveLength(9);
    for (const t of PLAY_TEMPLATES) expect(validatePlay(t), t.key).toEqual([]);
  });
  it('construtor recusa play incoerente', () => {
    const e = validatePlay({ name: 'X', steps: [{ key: 'a', title: 'ok', type: 'tarefa', dayOffset: -1, assignee: 'responsavel_relacionamento', instructions: '' }], successCriteria: '', audience: { target: 'conta', roles: ['decisor'] } });
    expect(e.join(' ')).toMatch(/nome/);
    expect(e.join(' ')).toMatch(/0 a 365/);
    expect(e.join(' ')).toMatch(/só vale em play para uma pessoa/);
    expect(e.join(' ')).toMatch(/critério de sucesso/);
    expect(e.join(' ')).toMatch(/Critérios de pessoa/);
  });
  it('sugere com motivos; influência não avaliada nunca conta como alta', () => {
    const ctx: AccountCtx = { ...base, stakeholders: [
      person({ id: 'a', name: 'Ana', roles: ['decisor'], influence: 'muito_alto', relationship: 'fraco' }),
      person({ id: 'b', name: 'Beto', roles: ['decisor'], influence: 'nao_avaliado', relationship: 'fraco' }),
      person({ id: 'c', name: 'Caio', stance: 'opositor', influence: 'alto' }),
    ] };
    const s = suggestPlays(plays, ctx);
    const keys = s.map((x) => `${x.playId}:${x.stakeholderName ?? ''}`);
    expect(keys).toContain('abertura_conta:');
    expect(keys).toContain('relacionamento_institucional:');
    expect(keys).toContain('aproximacao_decisor:Ana');
    expect(keys).not.toContain('aproximacao_decisor:Beto');
    expect(keys).toContain('conversao_resistente:Caio');
    expect(keys).toContain('mapeamento_decisores:');
    expect(s.find((x) => x.playId === 'mapeamento_decisores')!.reasons.join(' ')).toMatch(/1 pessoa\(s\) sem influência avaliada/);
    expect(s.find((x) => x.stakeholderName === 'Ana')!.reasons.join(' ')).toMatch(/avaliada pela equipe/);
    expect(s.some((x) => x.playId === 'preparacao_renovacao')).toBe(false);
  });
  it('sem permissão de ver influência, nada é sugerido por influência; play em andamento não é sugerido de novo', () => {
    const ctx: AccountCtx = { ...base, influenceVisible: false, stakeholders: [person({ id: 'a', name: 'Ana', roles: ['decisor'], influence: null, relationship: 'fraco' })] };
    expect(suggestPlays(plays, ctx).some((x) => x.playId === 'aproximacao_decisor')).toBe(false);
    expect(accountGaps(ctx)).not.toContain('sem_avaliacao');
    const running = suggestPlays(plays, { ...base, running: new Set(['abertura_conta:']) });
    expect(running.some((x) => x.playId === 'abertura_conta')).toBe(false);
  });
  it('renovação pelo vencimento; datas e andamento', () => {
    expect(suggestPlays(plays, { ...base, commercial: 'cliente_ativo', nextContractEndDays: 90 }).find((x) => x.playId === 'preparacao_renovacao')!.reasons).toEqual(['Contrato vence em 90 dia(s)']);
    expect(suggestPlays(plays, { ...base, nextContractEndDays: 200 }).some((x) => x.playId === 'preparacao_renovacao')).toBe(false);
    expect(planSteps(PLAY_TEMPLATES[0]!.steps, '2026-10-21').map((x) => x.dueOn)).toEqual(['2026-10-21', '2026-10-23', '2026-10-25', '2026-10-31', '2026-11-02']);
    const p = runProgress([{ status: 'concluida', dueOn: '2026-10-01' }, { status: 'pendente', dueOn: '2026-10-02' }, { status: 'cancelada', dueOn: '2026-10-03' }], '2026-10-21');
    expect(p).toMatchObject({ done: 1, open: 1, late: 1, pct: 50, canConclude: false });
  });
});
