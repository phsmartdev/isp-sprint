/**
 * Licitação: empresas participantes do pregão, lances por lote, ranking (menor lance) e vencedor(es).
 * Mais de um vencedor só quando há mais de um lote. Base do histórico de concorrentes.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Trophy } from 'lucide-react';
import { normalizeLot, parseMoney, PARTICIPANT_STATUSES, PARTICIPANT_STATUS_LABELS, participantsError, rankParticipants, type ParticipantStatus } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtBRL } from '../../lib/format';
import { Button, Input, Select } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

type Saved = { id: string; company: string; document: string | null; lot: string; bidCents: number | null; status: ParticipantStatus; winner: boolean; isUs: boolean; notes: string | null; rank: number | null };
type Data = { bid: boolean; rowVersion: number; items: Saved[] };
type Row = { key: string; company: string; document: string; lot: string; bid: string; status: ParticipantStatus; winner: boolean; isUs: boolean };

let seq = 0;
const money = (c: number | null) => (c == null ? '' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const cnpj = (d: string | null) => (d && d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d ?? '');
const blank = (lot = ''): Row => ({ key: `p${++seq}`, company: '', document: '', lot, bid: '', status: 'ativo', winner: false, isUs: false });
const toInput = (r: Row) => ({ company: r.company.trim(), document: r.document.trim() || null, lot: r.lot.trim() || null, bidCents: r.bid.trim() ? parseMoney(r.bid) : null, status: r.status, winner: r.winner, isUs: r.isUs });

export function BidParticipants({ oppId, editable = true, full = false }: { oppId: string; editable?: boolean; /** aba Pregão: ranking completo por lote */ full?: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['bid-participants', oppId], queryFn: () => api<Data>(`/opportunities/${oppId}/bid-participants`) });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // quantidade de lotes do pregão: 1 = lote único (sem escolha de lote); mais de um = cada empresa indica o lote e o lote vencido
  const [lotCount, setLotCount] = useState(1);
  const openEditor = async () => {
    const fresh = await q.refetch();
    const items = fresh.data?.items ?? [];
    const named = [...new Set(items.map((i) => i.lot).filter((l) => l !== 'Único'))];
    const n = Math.max(1, named.length, ...named.map((l) => (/^\d+$/.test(l) ? Number(l) : 0)));
    setLotCount(n);
    setRows(items.length ? items.map((i) => ({ key: `p${++seq}`, company: i.company, document: cnpj(i.document), lot: n === 1 ? '' : i.lot === 'Único' ? '1' : i.lot, bid: money(i.bidCents), status: i.status, winner: i.winner, isUs: i.isUs })) : [blank(), blank(), blank()]);
    setErr(null);
  };
  const changeLots = (n: number) => {
    const v = Math.min(50, Math.max(1, Math.floor(n) || 1));
    setLotCount(v);
    setRows((rs) => rs!.map((r) => ({ ...r, lot: v === 1 ? '' : r.lot && (!/^\d+$/.test(r.lot) || Number(r.lot) <= v) ? r.lot : '1' })));
  };
  const lotOptions = [...new Set([...Array.from({ length: lotCount }, (_, i) => String(i + 1)), ...(rows ?? []).map((r) => r.lot).filter(Boolean)])];
  const addRow = () => setRows([...(rows ?? []), blank(lotCount > 1 ? rows?.[rows.length - 1]?.lot || '1' : '')]);
  const save = useMutation({
    mutationFn: () => api<Data>(`/opportunities/${oppId}/bid-participants`, { method: 'PUT', body: { rowVersion: q.data!.rowVersion, items: rows!.filter((r) => r.company.trim() || r.bid.trim()).map(toInput) } }),
    onSuccess: (d) => {
      qc.setQueryData(['bid-participants', oppId], d);
      void qc.invalidateQueries({ queryKey: ['opportunity', oppId] });
      void qc.invalidateQueries({ queryKey: ['timeline', oppId] });
      setRows(null);
      toast({ tone: 'success', message: 'Participantes salvos' });
    },
    onError: (e) => setErr(errMsg(e)),
  });

  const saved = q.data?.items ?? [];
  const lots = [...new Set(saved.map((s) => s.lot))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  const winners = saved.filter((s) => s.winner);
  const draft = rows?.map(toInput) ?? [];
  const ranks = rankParticipants(draft.map((d) => ({ lot: normalizeLot(d.lot), bidCents: d.bidCents ?? null, status: d.status })));
  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs!.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const submit = () => {
    const list = draft.filter((d) => d.company || d.bidCents !== null).map((d) => ({ ...d, lot: normalizeLot(d.lot), bidCents: d.bidCents ?? null }));
    if (list.some((d) => d.bidCents === null && rows!.find((r) => r.company.trim() === d.company)?.bid.trim())) { setErr('Lance no formato 1.500,00'); return; }
    const e = participantsError(list);
    if (e) { setErr(e); return; }
    save.mutate();
  };

  return (
    <section aria-label={full ? 'Ranking do pregão' : 'Participantes do pregão'} className={full ? undefined : 'border-t border-line pt-3'}>
      <div className="flex items-center justify-between gap-2">
        {full ? <h3 className="flex items-center gap-2 text-md font-bold text-ink"><Trophy className="h-5 w-5 text-primary" aria-hidden />Ranking do pregão</h3>
          : <span className="flex items-center gap-2 text-sm font-semibold text-ink"><Trophy className="h-4 w-4 text-primary" aria-hidden />Participantes do pregão</span>}
        {editable && <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => void openEditor()}>{saved.length ? 'Editar' : 'Registrar participantes'}</button>}
      </div>
      {full && saved.length ? (
        <div className="mt-3 space-y-4">
          {lots.map((lot) => {
            const inLot = saved.filter((x) => x.lot === lot).sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
            return (
              <div key={lot} className="overflow-x-auto">
                {lots.length > 1 && <p className="mb-1 text-sm font-semibold text-ink">Lote {lot}</p>}
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="text-xs text-muted"><tr>{['Pos.', 'Empresa', 'CNPJ', 'Lance', 'Situação', ''].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
                  <tbody>
                    {inLot.map((x) => (
                      <tr key={x.id} className={x.isUs ? 'border-t border-line bg-primary-soft' : 'border-t border-line'}>
                        <td className="num px-2 py-1.5 font-bold text-ink">{x.rank ? `${x.rank}º` : '—'}</td>
                        <td className="px-2 py-1.5 text-text">{x.company}{x.isUs ? ' (nós)' : ''}</td>
                        <td className="num px-2 py-1.5 text-muted">{cnpj(x.document) || '—'}</td>
                        <td className="num px-2 py-1.5 text-text">{x.bidCents === null ? '—' : fmtBRL(x.bidCents)}</td>
                        <td className="px-2 py-1.5 text-muted">{PARTICIPANT_STATUS_LABELS[x.status]}</td>
                        <td className="px-2 py-1.5">{x.winner && <span className="bg-success-soft px-2 py-0.5 text-xs font-bold text-[#15803D]">Vencedora</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      ) : saved.length ? (
        <dl className="mt-2 space-y-1.5 text-sm">
          <div className="flex gap-3"><dt className="w-24 shrink-0 text-muted">Empresas</dt><dd className="text-text">{new Set(saved.map((s) => s.document || s.company)).size} em {lots.length} lote(s)</dd></div>
          {lots.map((lot) => {
            const w = winners.find((x) => x.lot === lot);
            return <div key={lot} className="flex gap-3"><dt className="w-24 shrink-0 text-muted">{lots.length > 1 ? `Lote ${lot}` : 'Vencedora'}</dt><dd className="min-w-0 break-words text-text">{w ? <>{w.company}{w.isUs ? ' (nós)' : ''} · <span className="num">{fmtBRL(w.bidCents)}</span></> : 'Não definida'}</dd></div>;
          })}
        </dl>
      ) : <p className="mt-1 text-xs text-muted">Nenhuma empresa registrada.</p>}

      <Modal open={!!rows} onClose={() => setRows(null)} title="Participantes do pregão" size="xl" footer={<><Button onClick={() => setRows(null)}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Salvar participantes</Button></>}>
        <p className="mb-3 text-sm text-muted">Adicione todas as empresas que participaram, com o lance final. O ranking sai do menor lance em cada lote. Com mais de um lote, indique ao lado da vencedora o lote; cada lote tem a sua vencedora. Uma empresa que disputou vários lotes entra uma vez por lote.</p>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-ink" htmlFor="bp-lots">Quantidade de lotes
            <Input id="bp-lots" type="number" min={1} max={50} className="num w-[90px]" value={lotCount} onChange={(e) => changeLots(Number(e.target.value))} />
            <span className="font-normal text-muted">{lotCount === 1 ? 'lote único' : `${lotCount} lotes`}</span>
          </label>
          <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={addRow}>Adicionar empresa</Button>
        </div>
        {err && <p role="alert" className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="text-xs text-muted"><tr>{['Pos.', 'Empresa', 'CNPJ', 'Lance (R$)', 'Situação', 'Nós', lotCount > 1 ? 'Vencedora · lote' : 'Vencedora', ''].map((h) => <th key={h} className="px-1.5 py-1.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {rows?.map((r, i) => (
                <tr key={r.key} className="border-t border-line">
                  <td className="num px-1.5 py-1.5 font-bold text-ink">{ranks[i] ? `${ranks[i]}º` : '—'}</td>
                  <td className="px-1.5 py-1.5"><Input aria-label={`Empresa ${i + 1}`} value={r.company} onChange={(e) => set(r.key, { company: e.target.value })} /></td>
                  <td className="px-1.5 py-1.5"><Input aria-label={`CNPJ ${i + 1}`} className="w-[170px]" value={r.document} placeholder="00.000.000/0000-00" onChange={(e) => set(r.key, { document: e.target.value })} /></td>
                  <td className="px-1.5 py-1.5"><Input aria-label={`Lance ${i + 1}`} className="num w-[140px]" inputMode="decimal" value={r.bid} placeholder="0,00" onChange={(e) => set(r.key, { bid: e.target.value })} /></td>
                  <td className="px-1.5 py-1.5"><Select aria-label={`Situação ${i + 1}`} className="w-[150px]" value={r.status} onChange={(e) => set(r.key, { status: e.target.value as ParticipantStatus, ...(e.target.value !== 'ativo' ? { winner: false } : {}) })}>{PARTICIPANT_STATUSES.map((st) => <option key={st} value={st}>{PARTICIPANT_STATUS_LABELS[st]}</option>)}</Select></td>
                  <td className="px-1.5 py-1.5 text-center"><input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`Nossa empresa ${i + 1}`} checked={r.isUs} onChange={(e) => set(r.key, { isUs: e.target.checked })} /></td>
                  <td className="px-1.5 py-1.5">
                    <span className="flex items-center gap-2">
                      <input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`Vencedora ${i + 1}`} checked={r.winner} disabled={r.status !== 'ativo'} onChange={(e) => set(r.key, { winner: e.target.checked })} />
                      {lotCount > 1 && (
                        <Select aria-label={`Lote ${i + 1}`} className="w-[110px]" value={r.lot || '1'} onChange={(e) => set(r.key, { lot: e.target.value })}>
                          {lotOptions.map((l) => <option key={l} value={l}>Lote {l}</option>)}
                        </Select>
                      )}
                    </span>
                  </td>
                  <td className="px-1.5 py-1.5"><button type="button" className="p-1 text-muted hover:text-danger" aria-label={`Remover participante ${i + 1}`} onClick={() => setRows(rows.filter((x) => x.key !== r.key))}><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={addRow}>Adicionar empresa</Button>
          <Button size="sm" variant="outline" onClick={() => {
            // marca como vencedora a melhor colocada de cada lote
            const best = new Map<string, number>();
            ranks.forEach((rk, i) => { if (rk === 1 && !best.has(normalizeLot(rows![i]!.lot))) best.set(normalizeLot(rows![i]!.lot), i); });
            setRows(rows!.map((r, i) => ({ ...r, winner: [...best.values()].includes(i) })));
          }}>Vencedora = 1º de cada lote</Button>
        </div>
      </Modal>
    </section>
  );
}
