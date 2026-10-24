/**
 * Conta na tela da oportunidade: resumo na lateral e "Saiba mais sobre a conta" com o histórico autorizado.
 * Só lê o que já existe (ficha do cliente, contratos, projetos, tarefas, interações e pessoas). Nada é duplicado.
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronDown, Mail, Phone } from 'lucide-react';
import clsx from 'clsx';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate, fmtDateTime } from '../../lib/format';
import type { Activity, Opportunity, Paged } from '../../lib/types';
import { useAuth } from '../../auth/AuthProvider';
import { Button, EmptyState, LoadingRows } from '../../components/ui/primitives';
import { Drawer } from '../../components/ui/overlay';
import { LifecycleChip, StageChip, productLabel } from '../../components/badges';
import { LinkedProjects } from '../projects/shared';
import { ActivityRow } from '../ActivityRow';
import { EntityPeoplePanel } from '../abm/EntityPeoplePanel';
import { StageChip as ContractStageChip, type ContractRow } from '../contracts/shared';

/** Seção recolhível da lateral: o título sempre visível, com um resumo quando fechada. */
export function SideSection({ id, title, summary, defaultOpen = false, open: forced, children }: { id: string; title: string; summary?: ReactNode; defaultOpen?: boolean; open?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = forced || open;
  return (
    <div className="border-t border-line pt-3">
      <button type="button" className="flex w-full items-center gap-2 text-left" aria-expanded={isOpen} aria-controls={`ss-${id}`} onClick={() => setOpen(!isOpen)}>
        <ChevronDown className={clsx('h-4 w-4 shrink-0 text-muted transition-transform', !isOpen && '-rotate-90')} aria-hidden />
        <span className="text-sm font-semibold text-ink">{title}</span>
      </button>
      {!isOpen && summary && <div className="ml-6 mt-1 text-xs text-muted">{summary}</div>}
      {isOpen && <div id={`ss-${id}`} className="mt-3">{children}</div>}
    </div>
  );
}

type ContactDetail = { id: string; name: string; phone: string | null; email: string | null; city: string | null; lifecycle: string; planName: string | null; contractStart: string | null; ownerName: string | null; createdAt: string; opportunities: Opportunity[] };

/** Bloco da conta na lateral esquerda: dados essenciais, pessoas e o acesso ao histórico completo. */
export function AccountPanel({ opp, openMore, extra }: { opp: Opportunity; openMore?: boolean; extra?: ReactNode }) {
  const { can } = useAuth();
  // ?aba=pessoas (links antigos) abre direto a visão da conta, onde ficam Pessoas e ABM
  const [more, setMore] = useState(!!openMore);
  const c = useQuery({ queryKey: ['contact', opp.contactId], enabled: can('clientes'), queryFn: () => api<ContactDetail>(`/contacts/${opp.contactId}`), staleTime: 60_000 });
  const others = (c.data?.opportunities ?? []).filter((o) => o.id !== opp.id);
  const won = others.filter((o) => o.stage === 'ganha');
  const open = others.filter((o) => o.stage !== 'ganha' && o.stage !== 'perdida');
  return (
    <section className="card p-5" aria-label="Conta">
      <h2 className="mb-2 flex items-center gap-2 text-md font-bold text-ink"><Building2 className="h-5 w-5 text-primary" aria-hidden />Conta</h2>
      <p className="text-md font-bold text-ink">{opp.contactName}</p>
      <p className="text-sm text-muted">{productLabel(opp.contactSegment)}{opp.contactCity ? ` · ${opp.contactCity}` : ''}</p>
      <div className="mt-2 space-y-1 text-sm text-text">
        {opp.contactPhone && <p className="num flex items-center gap-2"><Phone className="h-4 w-4 text-success" aria-hidden />{opp.contactPhone}</p>}
        {opp.contactEmail && <p className="flex items-center gap-2 break-all"><Mail className="h-4 w-4 text-primary" aria-hidden />{opp.contactEmail}</p>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <LifecycleChip s={opp.customerLifecycle ?? 'prospect'} />
        {opp.contactProvisional && <span className="text-xs text-muted">Contato provisório</span>}
      </div>
      {c.data && (
        <p className="mt-2 text-xs text-muted" aria-label="Resumo do relacionamento">
          {others.length ? `${others.length} outra(s) oportunidade(s): ${open.length} em andamento, ${won.length} ganha(s)` : 'Primeira oportunidade com esta conta'}
          {c.data.planName ? ` · plano atual ${c.data.planName}` : ''}{c.data.contractStart ? ` · cliente desde ${fmtDate(c.data.contractStart)}` : ''}
        </p>
      )}
      {opp.pipelineKey === 'sucesso_cliente' && <AccountContracts contactId={opp.contactId} />}
      {extra}
      <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => setMore(true)}>Saiba mais sobre a conta</Button>
      <AccountDrawer open={more} onClose={() => setMore(false)} opp={opp} detail={c.data} />
    </section>
  );
}

function AccountDrawer({ open, onClose, opp, detail }: { open: boolean; onClose: () => void; opp: Opportunity; detail: ContactDetail | undefined }) {
  const { can, feature } = useAuth();
  const contracts = useQuery({ queryKey: ['contracts', 'by-contact', opp.contactId], enabled: open && can('contratos'), queryFn: () => api<{ items: ContractRow[]; total: number }>(`/contracts${qs({ contactId: opp.contactId, pageSize: 20 })}`) });
  const acts = useQuery({ queryKey: ['activities', 'contact', opp.contactId], enabled: open && can('atividades'), queryFn: () => api<Paged<Activity>>(`/activities${qs({ contactId: opp.contactId, status: 'todas', scope: can('atividades', 'equipe') ? 'equipe' : 'minhas', pageSize: 10 })}`) });
  const opps = detail?.opportunities ?? [];
  const wonCents = opps.filter((o) => o.stage === 'ganha').reduce((t, o) => t + (o.valueCents ?? 0), 0);
  const activeContracts = (contracts.data?.items ?? []).filter((x) => x.stage !== 'arquivado');
  return (
    <Drawer open={open} onClose={onClose} title={`Conta: ${opp.contactName}`} width="lg">
      <div className="space-y-6">
        <section aria-label="Relevância da conta">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Oportunidades" value={can('clientes') ? String(opps.length) : '—'} />
            <Stat label="Ganhas" value={can('clientes') ? String(opps.filter((o) => o.stage === 'ganha').length) : '—'} />
            <Stat label="Valor ganho (mensal)" value={can('clientes') ? fmtBRL(wonCents) : '—'} />
            <Stat label="Contratos ativos" value={can('contratos') ? (contracts.isLoading ? '…' : String(activeContracts.length)) : '—'} />
          </dl>
          {detail && <p className="mt-2 text-xs text-muted">Conta criada em {fmtDate(detail.createdAt)}{detail.ownerName ? ` · responsável ${detail.ownerName}` : ''}.</p>}
        </section>

        {can('clientes') && (
          <Block title="Oportunidades">
            {!detail ? <LoadingRows rows={2} /> : !opps.length ? <EmptyState title="Nenhuma oportunidade visível" /> : (
              <ul className="divide-y divide-line">
                {opps.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <Link to={`/opportunities/${o.id}`} onClick={onClose} className="link font-semibold">OP-{o.code}</Link>
                    <span className="min-w-0 flex-1 truncate">{o.title}</span>
                    <StageChip stage={o.stage} name={o.stageName} />
                    <span className="num whitespace-nowrap text-muted">{fmtBRL(o.valueCents)}</span>
                    {o.id === opp.id && <span className="text-xs text-muted">(esta)</span>}
                  </li>
                ))}
              </ul>
            )}
          </Block>
        )}

        {can('contratos') && (
          <Block title="Contratos">
            {contracts.isLoading ? <LoadingRows rows={2} /> : !contracts.data?.items.length ? <EmptyState title="Nenhum contrato desta conta" /> : (
              <ul className="divide-y divide-line">
                {contracts.data.items.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <Link to={`/contracts/${k.id}`} onClick={onClose} className="link font-semibold">CT-{k.code}</Link>
                    <span className="min-w-0 flex-1 truncate">{k.number} · {k.object}</span>
                    <ContractStageChip stage={k.stage} />
                    <span className="num whitespace-nowrap text-muted">{k.endAt ? `até ${fmtDate(k.endAt)}` : 'sem fim'}</span>
                  </li>
                ))}
              </ul>
            )}
          </Block>
        )}

        {feature('marketing.abm') && (
          <div><h3 className="mb-2 text-sm font-bold text-ink">Pessoas e ABM</h3><EntityPeoplePanel entity="oportunidade" entityId={opp.id} compact /></div>
        )}

        {can('projetos') && <LinkedProjects prefill={{ contactId: opp.contactId, label: opp.contactName, kind: 'implantacao', name: `Implantação ${opp.contactName}` }} title="Projetos da conta" />}

        {can('atividades') && (
          <Block title="Interações recentes">
            {acts.isLoading ? <LoadingRows rows={2} /> : !acts.data?.items.length ? <EmptyState title="Nenhuma interação registrada" /> : <ul className="divide-y divide-line">{acts.data.items.map((x) => <ActivityRow key={x.id} a={x} showOwner compact />)}</ul>}
          </Block>
        )}

        {can('clientes') && <Link to={`/customers/${opp.contactId}`} className="link inline-block text-sm font-semibold">Abrir ficha completa do cliente</Link>}
        {detail?.createdAt && <p className="text-xs text-muted">Atualizado em {fmtDateTime(new Date().toISOString())}. Só aparecem os registros que o seu perfil pode ver.</p>}
      </div>
    </Drawer>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md border border-line p-3"><dt className="text-xs text-muted">{label}</dt><dd className="num whitespace-nowrap text-lg font-bold text-ink">{value}</dd></div>
);
const Block = ({ title, children }: { title: string; children: ReactNode }) => (
  <section aria-label={title}><h3 className="mb-2 text-sm font-bold text-ink">{title}</h3>{children}</section>
);

/** Sucesso do Cliente trabalha por conta: todos os contratos vigentes da conta, cada um levando à ficha. */
function AccountContracts({ contactId }: { contactId: string }) {
  const q = useQuery({ queryKey: ['contracts', 'account', contactId], queryFn: () => api<{ items: ContractRow[] }>(`/contracts${qs({ contactId, status: 'ativos', pageSize: 100 })}`) });
  const items = q.data?.items ?? [];
  return (
    <div className="mt-3 border-t border-line pt-3" aria-label="Contratos da conta">
      <p className="mb-1.5 text-sm font-semibold text-ink">Contratos da conta {q.data ? <span className="font-normal text-muted">({items.length})</span> : null}</p>
      {q.isLoading ? <LoadingRows rows={2} /> : !items.length ? <p className="text-xs text-muted">Nenhum contrato vigente.</p> : (
        <ul className="space-y-1.5">
          {items.map((c) => (
            <li key={c.id}>
              <Link to={`/contracts/${c.id}`} className="block hover:text-primary">
                <span className="flex items-baseline justify-between gap-2 text-sm"><span className="truncate font-semibold text-ink">{c.number}</span><span className="num shrink-0 text-xs text-muted">{c.billingType === 'recorrente' ? `${fmtBRL(c.monthlyCents)}/mês` : c.billingType === 'medicao' ? 'medição' : 'frequente'}</span></span>
                <span className="block truncate text-xs text-muted" title={c.object}>{c.object}{c.endAt ? ` · até ${fmtDate(c.endAt)}` : ''}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
