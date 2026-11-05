/**
 * Responsabilidades (Playbook Comercial PCOM 01.01), só consulta: matriz RACI, quem ocupa cada papel, SLA e avisos.
 * A parametrização fica no cadastro do usuário (papéis) e em Configurações → Responsabilidades de contratos.
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { NOTIFY_EVENTS, NOTIFY_EVENT_LABELS, PLAYBOOK_ROLE_LABELS, type NotifyRules, type PlaybookRole } from '@isp/domain';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthProvider';
import { ErrorState, LoadingRows, Notice } from '../../components/ui/primitives';

type Row = { key: string; phase: string; label: string; R: PlaybookRole[]; A: PlaybookRole; C: PlaybookRole[]; I: PlaybookRole[]; slaHours: number | null };
type Data = { roles: { key: PlaybookRole; label: string; users: { id: string; name: string }[]; actors: { id: string; name: string }[] }[]; phases: { key: string; label: string }[]; matrix: Row[]; rules: NotifyRules; canManage: boolean };

export function RaciPanel() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['contract-playbook'], queryFn: () => api<Data>('/contract-playbook') });
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const who = new Map(d.roles.map((r) => [r.key, [...r.users.map((u) => u.name), ...r.actors.map((a) => `${a.name} (externo)`)]]));
  const Code = ({ r, strong }: { r: PlaybookRole; strong?: boolean }) => {
    const names = who.get(r) ?? [];
    return <span title={`${PLAYBOOK_ROLE_LABELS[r]}: ${names.join(', ') || 'em aberto'}`} className={clsx('mr-1 inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold', strong ? 'bg-primary text-white' : 'bg-surface-2 text-ink', !names.length && 'outline outline-1 outline-dashed outline-line-strong')}>{r.replace('_', ' ')}</span>;
  };
  return (
    <div className="space-y-4">
      <Notice>
        Matriz do Playbook Comercial (PCOM 01.01). R executa, A responde pelo resultado (um por atividade), C é consultado, I é informado. Papel com borda tracejada está em aberto.
        {' '}Os papéis de cada pessoa são definidos no cadastro do usuário; atores externos, avisos e prazos em {can('configuracoes', 'total') ? <Link className="link" to="/settings/contratos-responsabilidades">Configurações → Responsabilidades de contratos</Link> : 'Configurações → Responsabilidades de contratos (administração)'}.
      </Notice>

      <section className="card p-5" aria-label="Quem ocupa cada papel">
        <h2 className="mb-3 font-bold text-ink">Quem ocupa cada papel</h2>
        <dl className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">{d.roles.map((r) => (
          <div key={r.key} className="min-w-0 border border-line p-3 text-sm">
            <dt className="font-semibold text-ink"><Code r={r.key} />{r.label}</dt>
            <dd className={clsx('mt-1', !(who.get(r.key) ?? []).length && 'text-muted')}>{(who.get(r.key) ?? []).join(', ') || 'Em aberto'}</dd>
          </div>
        ))}</dl>
      </section>

      <section className="card p-5" aria-label="Avisos por nível">
        <h2 className="mb-2 font-bold text-ink">Quem é avisado</h2>
        <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
          {NOTIFY_EVENTS.map((ev) => <li key={ev}><span className="text-muted">{NOTIFY_EVENT_LABELS[ev]}:</span> <strong className="text-ink">{d.rules.events[ev].join(', ') || 'ninguém'}</strong></li>)}
          <li><span className="text-muted">Perto de vencer:</span> <strong className="text-ink">{d.rules.dueSoonHours ? `${d.rules.dueSoonHours} h antes` : 'desligado'}</strong></li>
          <li><span className="text-muted">Escalonamento:</span> <strong className="text-ink">{d.rules.escalation.map((e) => `${e.afterHours} h → ${PLAYBOOK_ROLE_LABELS[e.role]}`).join(' · ') || 'em aberto'}</strong></li>
        </ul>
      </section>

      {d.phases.map((p) => (
        <section key={p.key} className="card p-5" aria-label={p.label}>
          <h2 className="mb-3 font-bold text-ink">{p.label}</h2>
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2 font-medium">Atividade</th><th className="px-3 py-2 font-medium">R</th><th className="px-3 py-2 font-medium">A</th><th className="px-3 py-2 font-medium">C</th><th className="px-3 py-2 font-medium">I</th><th className="px-3 py-2 font-medium">SLA</th></tr></thead>
            <tbody>{d.matrix.filter((x) => x.phase === p.key).map((x) => (
              <tr key={x.key} className="border-t border-line">
                <td className="px-3 py-2 text-ink">{x.label}</td>
                <td className="px-3 py-2">{x.R.map((r) => <Code key={r} r={r} />)}</td>
                <td className="px-3 py-2"><Code r={x.A} strong /></td>
                <td className="px-3 py-2">{x.C.length ? x.C.map((r) => <Code key={r} r={r} />) : <span className="text-muted">—</span>}</td>
                <td className="px-3 py-2">{x.I.length ? x.I.map((r) => <Code key={r} r={r} />) : <span className="text-muted">—</span>}</td>
                <td className="px-3 py-2 text-xs">{x.slaHours ? `${x.slaHours} h` : <span className="text-muted">em aberto</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      ))}
    </div>
  );
}
