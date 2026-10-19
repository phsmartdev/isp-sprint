/** Relatório completo de contratos: filtros, resumo, tabela detalhada, planilha e impressão. */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { BILLING_TYPES, BILLING_TYPE_LABELS, CONTRACT_STAGES, CONTRACT_STAGE_LABELS, LEGAL_REGIME_LABELS, SEGMENT_LABELS, type BillingType, type LegalRegime, type Segment } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate } from '../../lib/format';
import { useLookups, useUrlState } from '../../lib/hooks';
import { useAuth } from '../../auth/AuthProvider';
import { ErrorState, LoadingRows, Select } from '../../components/ui/primitives';
import { DateRange } from '../../components/ui/DateRange';
import { KIND_LABEL, TypeChip, StageChip, type ContractRow } from './shared';

type Row = ContractRow & {
  document: string | null; operationalOwnerName: string; csmName: string; renewalAt: string | null; legalLimitAt: string | null; closureReason: string | null;
  signedAt: string | null; activationAt: string | null; billingStartAt: string | null; adjustmentIndex: string | null; adjustmentBaseDate: string | null; version: number;
  guarantee: { type: string; expiresAt: string | null } | null; billedCents: number; balance: { credited: number; consumed: number; available: number } | null; openProcesses: string[]; opportunityCode: number | null;
};
type Report = {
  period: { from: string; to: string };
  summary: { contracts: number; active: number; archived: number; monthlyCents: number; globalCents: number; billedCents: number; byType: { type: BillingType; label: string; n: number; monthlyCents: number; billedCents: number }[]; byStage: { stage: string; label: string; n: number }[]; measurement: { credited: number; consumed: number; available: number }; pendencies: { alerts: number; overdue: number } };
  items: Row[];
};

export function FullReport() {
  const { can } = useAuth();
  const lookups = useLookups();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useUrlState({ rfrom: `${today.slice(0, 4)}-01-01`, rto: today, rstatus: 'todos', rtype: '', rkind: '', rstage: '', rowner: '' });
  const params = { from: f.rfrom, to: f.rto, status: f.rstatus, billingType: f.rtype, kind: f.rkind, stage: f.rstage, ownerId: f.rowner };
  const q = useQuery({ queryKey: ['contracts', 'full-report', params], queryFn: () => api<Report>(`/contracts/reports/full${qs(params)}`) });
  return (
    <section className="card p-5 print:shadow-none" aria-labelledby="fr-h">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div><h2 id="fr-h" className="text-lg font-bold text-ink">Relatório completo de contratos</h2><p className="text-sm text-muted">Cadastro, datas, valores, faturamento no período, saldo de medição, reajuste, garantia, processos e pendências.</p></div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <a className="inline-flex h-10 items-center gap-2 rounded-md border border-primary/60 bg-surface px-4 font-semibold text-primary hover:bg-primary-soft" href={`/api/v1/contracts/reports/full${qs({ ...params, format: 'csv' })}`} download><Download className="h-4 w-4" />Planilha (CSV)</a>
          <button className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-4 font-semibold text-ink hover:bg-surface-2" onClick={() => window.print()}><Printer className="h-4 w-4" />Imprimir / PDF</button>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden" role="search" aria-label="Filtros do relatório">
        <DateRange from={f.rfrom} to={f.rto} onChange={(r) => setF({ rfrom: r.from, rto: r.to })} />
        <Select aria-label="Situação" className="w-auto" value={f.rstatus} onChange={(e) => setF({ rstatus: e.target.value })}><option value="todos">Todos</option><option value="ativos">Ativos</option><option value="encerrados">Arquivados</option></Select>
        <Select aria-label="Tipo de contrato" className="w-auto" value={f.rtype} onChange={(e) => setF({ rtype: e.target.value })}><option value="">Todos os tipos</option>{BILLING_TYPES.map((t) => <option key={t} value={t}>{BILLING_TYPE_LABELS[t]}</option>)}</Select>
        <Select aria-label="Público ou privado" className="w-auto" value={f.rkind} onChange={(e) => setF({ rkind: e.target.value })}><option value="">Público e privado</option><option value="publico">Público</option><option value="privado">Privado</option></Select>
        <Select aria-label="Etapa" className="w-auto" value={f.rstage} onChange={(e) => setF({ rstage: e.target.value })}><option value="">Todas as etapas</option>{CONTRACT_STAGES.map((s) => <option key={s} value={s}>{CONTRACT_STAGE_LABELS[s]}</option>)}</Select>
        {can('contratos', 'equipe') && <Select aria-label="Responsável" className="w-auto" value={f.rowner} onChange={(e) => setF({ rowner: e.target.value })}><option value="">Todos os responsáveis</option>{lookups.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}
      </div>
      {q.isLoading ? <LoadingRows rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (() => {
        const r = q.data!;
        const s = r.summary;
        return (
          <>
            <p className="mb-2 hidden text-sm print:block">Período: {fmtDate(r.period.from)} a {fmtDate(r.period.to)} · emitido em {fmtDate(today)}</p>
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[['Contratos', `${s.contracts} (${s.active} ativos, ${s.archived} arquivados)`], ['Receita mensal contratada', fmtBRL(s.monthlyCents)], ['Valor global contratado', fmtBRL(s.globalCents)], ['Faturado no período', fmtBRL(s.billedCents)]].map(([l, v]) => <div key={l} className="rounded-md border border-line p-3"><p className="text-xs text-muted">{l}</p><p className="num font-extrabold text-ink">{v}</p></div>)}
            </div>
            <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
              <div className="rounded-md border border-line p-3"><p className="mb-1 text-sm font-semibold text-ink">Por tipo</p><table className="w-full text-sm"><tbody>{s.byType.map((t) => <tr key={t.type}><td className="py-0.5">{t.label} ({t.n})</td><td className="num py-0.5 text-right">{fmtBRL(t.monthlyCents)}/mês</td><td className="num py-0.5 text-right font-semibold">{fmtBRL(t.billedCents)}</td></tr>)}</tbody></table></div>
              <div className="rounded-md border border-line p-3"><p className="mb-1 text-sm font-semibold text-ink">Por etapa</p><p className="text-sm text-text">{s.byStage.map((x) => `${x.label}: ${x.n}`).join(' · ') || '—'}</p></div>
              <div className="rounded-md border border-line p-3"><p className="mb-1 text-sm font-semibold text-ink">Medição e pendências</p><p className="text-sm text-text">Saldo {fmtBRL(s.measurement.credited)} · consumido {fmtBRL(s.measurement.consumed)} · disponível {fmtBRL(s.measurement.available)}</p><p className="text-sm text-text">{s.pendencies.alerts} notificação(ões) aberta(s), {s.pendencies.overdue} atrasada(s)</p></div>
            </div>
            {!r.items.length ? <p className="py-6 text-center text-sm text-muted">Nenhum contrato com estes filtros.</p> : (
              <div className="overflow-x-auto rounded-md border border-line print:overflow-visible">
                <table className="w-full min-w-[1500px] text-left text-xs print:min-w-0">
                  <thead className="bg-surface-2 text-muted"><tr>{['Contrato', 'Cliente', 'Tipo', 'Etapa', 'Responsáveis', 'Assinatura', 'Vigência', 'Ativação / faturamento', 'Mensal', 'Global', 'Faturado no período', 'Saldo (medição)', 'Reajuste', 'Garantia', 'ERP', 'Processos e pendências', 'Próxima ação'].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
                  <tbody>
                    {r.items.map((x) => (
                      <tr key={x.id} className="border-t border-line align-top">
                        <td className="px-2 py-2"><Link className="font-semibold text-ink hover:underline" to={`/contracts/${x.id}`}>{x.number}</Link><span className="block text-muted">CT-{x.code} · v{x.version}{x.opportunityCode ? ` · OP-${x.opportunityCode}` : ''}</span></td>
                        <td className="px-2 py-2">{x.clientName}<span className="block text-muted">{x.document ?? ''} {SEGMENT_LABELS[x.segment as Segment] ?? ''}</span></td>
                        <td className="px-2 py-2"><TypeChip type={x.billingType} /><span className="mt-1 block text-muted">{KIND_LABEL[x.kind]}{x.kind === 'publico' ? ` · ${LEGAL_REGIME_LABELS[x.legalRegime as LegalRegime]}` : ''}</span></td>
                        <td className="px-2 py-2"><StageChip stage={x.stage} />{x.renewed && <span className="mt-1 block text-success">Renovado</span>}{x.closureExpected && <span className="mt-1 block text-danger">Encerra {fmtDate(x.closureAt)}</span>}</td>
                        <td className="px-2 py-2">{x.ownerName}<span className="block text-muted">{[x.operationalOwnerName, x.csmName].filter(Boolean).join(' · ')}</span></td>
                        <td className="num px-2 py-2">{fmtDate(x.signedAt)}</td>
                        <td className="num px-2 py-2">{fmtDate(x.startAt)} a {fmtDate(x.endAt)}<span className="block text-muted">{x.termMonths ? `${x.termMonths} meses` : ''}{x.stage !== 'arquivado' && x.daysLeft !== null ? ` · ${x.daysLeft} d` : ''}</span></td>
                        <td className="num px-2 py-2">{fmtDate(x.activationAt)}<span className="block text-muted">{fmtDate(x.billingStartAt)}</span></td>
                        <td className="num px-2 py-2">{fmtBRL(x.monthlyCents)}</td>
                        <td className="num px-2 py-2">{fmtBRL(x.totalCents)}</td>
                        <td className="num px-2 py-2 font-semibold">{fmtBRL(x.billedCents)}</td>
                        <td className="num px-2 py-2">{x.balance ? <>{fmtBRL(x.balance.available)}<span className="block text-muted">de {fmtBRL(x.balance.credited)}</span></> : '—'}</td>
                        <td className="px-2 py-2">{x.adjustmentIndex ?? '—'}<span className="block text-muted">{x.adjustmentBaseDate ? fmtDate(x.adjustmentBaseDate) : ''}</span></td>
                        <td className="px-2 py-2">{x.guarantee ? <>{x.guarantee.type}<span className="block text-muted">{fmtDate(x.guarantee.expiresAt)}</span></> : '—'}</td>
                        <td className="px-2 py-2">{x.erpRef ?? <span className="text-[#C2610C]">Pendente</span>}</td>
                        <td className="px-2 py-2">{x.openProcesses.length ? x.openProcesses.join(', ') : '—'}<span className="block text-muted">{x.pendencies.alerts ? `${x.pendencies.alerts} alerta(s)${x.pendencies.overdue ? `, ${x.pendencies.overdue} atrasado(s)` : ''}` : ''}</span></td>
                        <td className="px-2 py-2">{x.nextAction ?? '—'}<span className="block text-muted">{x.nextActionAt ? fmtDate(x.nextActionAt) : ''}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        );
      })()}
    </section>
  );
}
