/**
 * Configurações → Viabilidade: tributos, parceiros, equipamentos, caminhos de entrega,
 * regras de metragem e banda, comissão e LTV. Tudo que entra no CAC, na margem e no payback.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Calculator, Plus, Trash2 } from 'lucide-react';
import { COMMISSION_KINDS, COMMISSION_KIND_LABELS, SALE_TYPES, SALE_TYPE_LABELS, toCents, type ViabilityResult } from '@isp/domain';
import { api, ApiError } from '../../lib/api';
import { fmtBRL, fmtInt } from '../../lib/format';
import { useDebounced, useLookups } from '../../lib/hooks';
import { Button, ErrorState, FormField, Input, LoadingRows, Notice, Select } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { ViabilityInputs, ViabilityPanel, viabilityPayload, type ViabilityValue } from '../../features/DealFields';

type Deduction = { id?: string; name: string; kind: 'percent' | 'fixed' | 'per_plan'; percentBp: number; amountCents: number; routeIds: string[]; baseExcludeIds?: string[]; notes: string | null };
type Equip = { id?: string; name: string; costCents: number };
type Route = { id?: string; name: string; description: string | null; cablePerMeterCents: number; installCostCents: number; monthlyCostCents: number; requiresApproval: boolean; appliesTo?: 'condominio' | 'rua' | null; kit: { equipmentId: string; qty: number }[] };
type Rule = { id?: string; name: string; minMeters: number | null; maxMeters: number | null; minMbps: number | null; maxMbps: number | null; routeId: string };
type Commission = { id?: string; name: string; saleType: 'ativa' | 'receptiva' | 'qualquer'; minPriceCents: number | null; maxPriceCents: number | null; kind: 'percent' | 'mensalidades' | 'fixo'; percentBp: number; multiplierX100: number; amountCents: number };
type Settings = { defaultRouteId: string | null; ltvLifetimeMonths: number | null; monthlyChurnBp: number | null; ltvMinSample: number; maxPaybackMonths: number | null; defaultActivationFeeCents: number | null; autonomyMaxMeters?: number | null; autonomyMaxMbps?: number | null };
type Data = { taxes: Deduction[]; partners: Deduction[]; equipments: Equip[]; routes: Route[]; rules: Rule[]; commissions: Commission[]; settings: Settings; base: { customers: number; avgLifetimeMonths: number | null; avgMarginCents: number | null } };

/** Centavos e pontos-base usam a mesma escala de 2 casas: "6,5" → 650. */
const dec = (n: number | null | undefined) => (n === null || n === undefined ? '' : (n / 100).toFixed(2).replace('.', ',').replace(/,00$/, ''));
const num = (s: string) => { const v = toCents(s); return v === null ? 0 : v; };
const numOrNull = (s: string) => (s.trim() === '' ? null : toCents(s));
const intOrNull = (s: string) => (s.trim() === '' ? null : Math.max(0, Math.round(Number(s))));
const errMsg = (e: unknown) => (e instanceof ApiError ? [e.problem.detail ?? e.message, ...(e.problem.errors ?? []).map((x) => `${x.path}: ${x.message}`)].join(' ') : (e as Error).message);

function Block({ title, desc, children, onAdd, addLabel = 'Adicionar', onSave, saving, dirty }: { title: string; desc: string; children: ReactNode; onAdd?: () => void; addLabel?: string; onSave: () => void; saving: boolean; dirty: boolean }) {
  return (
    <section className="card p-5">
      <h3 className="text-md font-bold text-ink">{title}</h3>
      <p className="mb-3 max-w-3xl text-sm text-muted">{desc}</p>
      {children}
      <div className="mt-3 flex flex-wrap justify-between gap-2">
        {onAdd ? <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={onAdd}>{addLabel}</Button> : <span />}
        <Button size="sm" variant="primary" loading={saving} disabled={!dirty} onClick={onSave}>Salvar</Button>
      </div>
    </section>
  );
}

function useList<T>(initial: T[], url: string, toItem: (t: T) => unknown) {
  const qc = useQueryClient();
  const toast = useToast();
  const [items, setItems] = useState(initial);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setItems(initial); setDirty(false); }, [initial]);
  const m = useMutation({
    mutationFn: () => api(url, { method: 'PUT', body: { items: items.map(toItem) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'viability'] }); qc.invalidateQueries({ queryKey: ['viability-meta'] }); toast({ tone: 'success', message: 'Parâmetros salvos' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return {
    items,
    set: (i: number, v: Partial<T>) => { setItems((x) => x.map((it, j) => (j === i ? { ...it, ...v } : it))); setDirty(true); },
    add: (v: T) => { setItems((x) => [...x, v]); setDirty(true); },
    remove: (i: number) => { setItems((x) => x.filter((_, j) => j !== i)); setDirty(true); },
    move: (i: number, d: number) => { setItems((x) => { const y = [...x]; const [it] = y.splice(i, 1); y.splice(i + d, 0, it!); return y; }); setDirty(true); },
    save: () => m.mutate(),
    saving: m.isPending,
    dirty,
  };
}

/** Campo de número digitado livremente (string local) e convertido ao sair. */
function NumInput({ value, onChange, label, suffix, prefix, int, className }: { value: number | null; onChange: (v: number | null) => void; label: string; suffix?: string; prefix?: string; int?: boolean; className?: string }) {
  const show = (v: number | null) => (v === null ? '' : int ? String(v) : dec(v));
  const [s, setS] = useState(show(value));
  useEffect(() => setS(show(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span className={className ?? 'flex items-center gap-1'}>
      {prefix && <span className="text-xs text-muted">{prefix}</span>}
      <Input aria-label={label} inputMode="decimal" className="w-24" value={s} onChange={(e) => setS(e.target.value)} onBlur={() => onChange(int ? intOrNull(s) : numOrNull(s))} />
      {suffix && <span className="text-xs text-muted">{suffix}</span>}
    </span>
  );
}

const del = (onClick: () => void) => <Button size="sm" variant="ghost" aria-label="Remover" onClick={onClick} icon={<Trash2 className="h-4 w-4 text-danger" />} />;

function Deductions({ title, desc, url, initial, routes, partners }: { title: string; desc: string; url: string; initial: Deduction[]; routes: Route[]; partners?: Deduction[] }) {
  const l = useList(initial, url, ({ id, name, kind, percentBp, amountCents, routeIds, baseExcludeIds, notes }: Deduction) => ({ id, name, kind, percentBp, amountCents, routeIds, baseExcludeIds: baseExcludeIds ?? [], notes }));
  const savedPartners = (partners ?? []).filter((x) => x.id);
  return (
    <Block title={title} desc={desc} onAdd={() => l.add({ name: '', kind: 'percent', percentBp: 0, amountCents: 0, routeIds: [], notes: null })} onSave={l.save} saving={l.saving} dirty={l.dirty}>
      {!l.items.length ? <p className="text-sm text-muted">Nada cadastrado.</p> : (
        <ul className="space-y-2">
          {l.items.map((d, i) => (
            <li key={d.id ?? `n${i}`} className="flex flex-wrap items-center gap-2 rounded-md border border-line p-2">
              <Input aria-label="Nome" className="min-w-[180px] flex-1" value={d.name} onChange={(e) => l.set(i, { name: e.target.value })} placeholder="Ex.: Simples Nacional" />
              <Select aria-label="Forma" className="w-auto" value={d.kind} onChange={(e) => l.set(i, { kind: e.target.value as Deduction['kind'] })}>
                <option value="percent">% da mensalidade</option><option value="fixed">R$ por mês</option>{url.endsWith('partners') && <option value="per_plan">Pelos produtos do plano</option>}
              </Select>
              {d.kind === 'per_plan' ? <span className="text-xs text-muted">Custo vem dos produtos de cada plano ligados a este parceiro (Planos e produtos)</span> : d.kind === 'percent' ? <NumInput label="Percentual" value={d.percentBp} suffix="%" onChange={(v) => l.set(i, { percentBp: v ?? 0 })} /> : <NumInput label="Valor" prefix="R$" value={d.amountCents} onChange={(v) => l.set(i, { amountCents: v ?? 0 })} />}
              {routes.length > 0 && (
                <Select aria-label="Vale para" className="w-auto" value={d.routeIds[0] ?? ''} onChange={(e) => l.set(i, { routeIds: e.target.value ? [e.target.value] : [] })}>
                  <option value="">Todos os caminhos</option>
                  {routes.filter((r) => r.id).map((r) => <option key={r.id} value={r.id}>Só {r.name}</option>)}
                </Select>
              )}
              {del(() => l.remove(i))}
              {d.kind === 'percent' && savedPartners.length > 0 && (
                <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 pl-1 text-xs text-text">
                  <span className="text-muted">Calcular sobre a mensalidade menos:</span>
                  {savedPartners.map((pt) => (
                    <label key={pt.id} className="flex items-center gap-1">
                      <input type="checkbox" checked={!!d.baseExcludeIds?.includes(pt.id!)} onChange={(e) => l.set(i, { baseExcludeIds: e.target.checked ? [...(d.baseExcludeIds ?? []), pt.id!] : (d.baseExcludeIds ?? []).filter((x) => x !== pt.id) })} />
                      {pt.name}
                    </label>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}

function Equipments({ initial }: { initial: Equip[] }) {
  const l = useList(initial, '/admin/viability/equipments', ({ id, name, costCents }: Equip) => ({ id, name, costCents }));
  return (
    <Block title="Equipamentos" desc="Custo de cada equipamento entregue ao cliente. Entram no CAC pelo kit do caminho (ou o que o vendedor escolher)." onAdd={() => l.add({ name: '', costCents: 0 })} onSave={l.save} saving={l.saving} dirty={l.dirty}>
      <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {l.items.map((e, i) => (
          <li key={e.id ?? `n${i}`} className="flex items-center gap-2 rounded-md border border-line p-2">
            <Input aria-label="Equipamento" className="flex-1" value={e.name} onChange={(ev) => l.set(i, { name: ev.target.value })} placeholder="Ex.: ONU" />
            <NumInput label="Custo" prefix="R$" value={e.costCents} onChange={(v) => l.set(i, { costCents: v ?? 0 })} />
            {del(() => l.remove(i))}
          </li>
        ))}
      </ul>
    </Block>
  );
}

function Routes({ initial, equipments }: { initial: Route[]; equipments: Equip[] }) {
  const l = useList(initial, '/admin/viability/routes', ({ id, name, description, cablePerMeterCents, installCostCents, monthlyCostCents, requiresApproval, appliesTo, kit }: Route) => ({ id, name, description, cablePerMeterCents, installCostCents, monthlyCostCents, requiresApproval, appliesTo: appliesTo ?? null, kit: kit.filter((k) => k.qty > 0) }));
  return (
    <Block title="Caminhos de entrega" desc="Dois padrões: Condomínio e Rua. O sistema escolhe pelo endereço da oportunidade (com condomínio ou na rua). Cada caminho tem custo de cabo por metro, instalação, custo mensal e o kit de equipamentos." addLabel="Adicionar caminho" onAdd={() => l.add({ name: l.items.some((x) => x.appliesTo === 'condominio') ? 'Rua' : 'Condomínio', description: null, cablePerMeterCents: 0, installCostCents: 0, monthlyCostCents: 0, requiresApproval: false, appliesTo: l.items.some((x) => x.appliesTo === 'condominio') ? 'rua' : 'condominio', kit: [] })} onSave={l.save} saving={l.saving} dirty={l.dirty}>
      <ul className="space-y-2">
        {l.items.map((r, i) => (
          <li key={r.id ?? `n${i}`} className="rounded-md border border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input aria-label="Caminho" className="min-w-[180px] flex-1" value={r.name} onChange={(e) => l.set(i, { name: e.target.value })} placeholder="Ex.: FTTH condomínio" />
              <NumInput label="Cabo por metro" prefix="Cabo R$" suffix="/m" value={r.cablePerMeterCents} onChange={(v) => l.set(i, { cablePerMeterCents: v ?? 0 })} />
              <NumInput label="Instalação" prefix="Instalação R$" value={r.installCostCents} onChange={(v) => l.set(i, { installCostCents: v ?? 0 })} />
              <NumInput label="Custo mensal" prefix="Mensal R$" value={r.monthlyCostCents} onChange={(v) => l.set(i, { monthlyCostCents: v ?? 0 })} />
              <Select aria-label="Usar para" className="h-9 w-auto" value={r.appliesTo ?? ''} onChange={(e) => l.set(i, { appliesTo: (e.target.value || null) as Route['appliesTo'] })}>
                <option value="">Usar para: —</option><option value="condominio">Usar para: Condomínio</option><option value="rua">Usar para: Rua</option>
              </Select>
              {del(() => l.remove(i))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted">Kit:</span>
              {equipments.filter((e) => e.id).map((e) => {
                const qty = r.kit.find((k) => k.equipmentId === e.id)?.qty ?? 0;
                return (
                  <label key={e.id} className="flex items-center gap-1">
                    <Input aria-label={`Quantidade de ${e.name}`} type="number" min={0} className="h-8 w-20" value={qty} onChange={(ev) => { const q = Math.max(0, Number(ev.target.value || 0)); l.set(i, { kit: [...r.kit.filter((k) => k.equipmentId !== e.id), ...(q ? [{ equipmentId: e.id!, qty: q }] : [])] }); }} />
                    {e.name}
                  </label>
                );
              })}
              {!equipments.some((e) => e.id) && <span className="text-muted">salve os equipamentos primeiro</span>}
            </div>
          </li>
        ))}
      </ul>
    </Block>
  );
}

function Rules({ initial, routes }: { initial: Rule[]; routes: Route[] }) {
  const saved = routes.filter((r) => r.id);
  const l = useList(initial, '/admin/viability/rules', ({ id, name, minMeters, maxMeters, minMbps, maxMbps, routeId }: Rule) => ({ id, name, minMeters, maxMeters, minMbps, maxMbps, routeId }));
  return (
    <Block title="Regras de metragem e banda" desc="Quantos metros de cabo vou lançar e quantos Mbps vou vender decidem o caminho. A primeira regra que casar vale; sem regra, usa o caminho padrão. Faixa em branco = qualquer valor." addLabel="Adicionar regra" onAdd={() => saved[0] && l.add({ name: '', minMeters: null, maxMeters: null, minMbps: null, maxMbps: null, routeId: saved[0].id! })} onSave={l.save} saving={l.saving} dirty={l.dirty}>
      {!saved.length ? <Notice tone="warning">Cadastre e salve os caminhos antes das regras.</Notice> : (
        <ol className="space-y-2">
          {l.items.map((r, i) => (
            <li key={r.id ?? `n${i}`} className="flex flex-wrap items-center gap-2 rounded-md border border-line p-2">
              <span className="num w-6 text-center text-sm font-bold text-primary">{i + 1}</span>
              <Input aria-label="Nome da regra" className="min-w-[150px] flex-1" value={r.name} onChange={(e) => l.set(i, { name: e.target.value })} placeholder="Ex.: Até 150 m" />
              <NumInput int label="Metros mínimo" prefix="de" value={r.minMeters} onChange={(v) => l.set(i, { minMeters: v })} />
              <NumInput int label="Metros máximo" prefix="até" suffix="m" value={r.maxMeters} onChange={(v) => l.set(i, { maxMeters: v })} />
              <NumInput int label="Mbps mínimo" prefix="de" value={r.minMbps} onChange={(v) => l.set(i, { minMbps: v })} />
              <NumInput int label="Mbps máximo" prefix="até" suffix="Mbps" value={r.maxMbps} onChange={(v) => l.set(i, { maxMbps: v })} />
              <span className="text-xs text-muted">→</span>
              <Select aria-label="Caminho" className="w-auto" value={r.routeId} onChange={(e) => l.set(i, { routeId: e.target.value })}>{saved.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
              <Button size="sm" variant="ghost" aria-label="Subir" disabled={i === 0} onClick={() => l.move(i, -1)} icon={<ArrowUp className="h-4 w-4" />} />
              <Button size="sm" variant="ghost" aria-label="Descer" disabled={i === l.items.length - 1} onClick={() => l.move(i, 1)} icon={<ArrowDown className="h-4 w-4" />} />
              {del(() => l.remove(i))}
            </li>
          ))}
        </ol>
      )}
    </Block>
  );
}

function Commissions({ initial }: { initial: Commission[] }) {
  const l = useList(initial, '/admin/viability/commissions', ({ id, name, saleType, minPriceCents, maxPriceCents, kind, percentBp, multiplierX100, amountCents }: Commission) => ({ id, name, saleType, minPriceCents, maxPriceCents, kind, percentBp, multiplierX100, amountCents }));
  return (
    <Block title="Comissão" desc="Pela venda ativa ou receptiva e pela faixa de mensalidade. Pode ser % da mensalidade, número de mensalidades ou valor fixo. A primeira regra que casar vale." addLabel="Adicionar regra" onAdd={() => l.add({ name: '', saleType: 'qualquer', minPriceCents: null, maxPriceCents: null, kind: 'percent', percentBp: 0, multiplierX100: 0, amountCents: 0 })} onSave={l.save} saving={l.saving} dirty={l.dirty}>
      <ol className="space-y-2">
        {l.items.map((c, i) => (
          <li key={c.id ?? `n${i}`} className="flex flex-wrap items-center gap-2 rounded-md border border-line p-2">
            <span className="num w-6 text-center text-sm font-bold text-primary">{i + 1}</span>
            <Input aria-label="Nome" className="min-w-[150px] flex-1" value={c.name} onChange={(e) => l.set(i, { name: e.target.value })} placeholder="Ex.: Ativa padrão" />
            <Select aria-label="Tipo de venda" className="w-auto" value={c.saleType} onChange={(e) => l.set(i, { saleType: e.target.value as Commission['saleType'] })}>
              <option value="qualquer">Ativa ou receptiva</option>
              {SALE_TYPES.map((t) => <option key={t} value={t}>{SALE_TYPE_LABELS[t]}</option>)}
            </Select>
            <NumInput label="Mensalidade mínima" prefix="de R$" value={c.minPriceCents} onChange={(v) => l.set(i, { minPriceCents: v })} />
            <NumInput label="Mensalidade máxima" prefix="até R$" value={c.maxPriceCents} onChange={(v) => l.set(i, { maxPriceCents: v })} />
            <Select aria-label="Forma" className="w-auto" value={c.kind} onChange={(e) => l.set(i, { kind: e.target.value as Commission['kind'] })}>
              {COMMISSION_KINDS.map((k) => <option key={k} value={k}>{COMMISSION_KIND_LABELS[k]}</option>)}
            </Select>
            {c.kind === 'percent' && <NumInput label="Percentual" value={c.percentBp} suffix="%" onChange={(v) => l.set(i, { percentBp: v ?? 0 })} />}
            {c.kind === 'mensalidades' && <NumInput label="Mensalidades" value={c.multiplierX100} suffix="× mensalidade" onChange={(v) => l.set(i, { multiplierX100: v ?? 0 })} />}
            {c.kind === 'fixo' && <NumInput label="Valor" prefix="R$" value={c.amountCents} onChange={(v) => l.set(i, { amountCents: v ?? 0 })} />}
            <Button size="sm" variant="ghost" aria-label="Subir" disabled={i === 0} onClick={() => l.move(i, -1)} icon={<ArrowUp className="h-4 w-4" />} />
            <Button size="sm" variant="ghost" aria-label="Descer" disabled={i === l.items.length - 1} onClick={() => l.move(i, 1)} icon={<ArrowDown className="h-4 w-4" />} />
            {del(() => l.remove(i))}
          </li>
        ))}
      </ol>
    </Block>
  );
}

function SettingsForm({ initial, routes, base }: { initial: Settings; routes: Route[]; base: Data['base'] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [s, setS] = useState(initial);
  useEffect(() => setS(initial), [initial]);
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);
  const m = useMutation({
    mutationFn: () => api('/admin/viability/settings', { method: 'PUT', body: s }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'viability'] }); qc.invalidateQueries({ queryKey: ['viability-meta'] }); toast({ tone: 'success', message: 'Parâmetros salvos' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const useBase = base.customers >= s.ltvMinSample && base.avgLifetimeMonths !== null;
  return (
    <section className="card p-5">
      <div className="mb-5 rounded-md border border-warning/30 bg-warning-soft/40 p-4">
        <h3 className="text-md font-bold text-ink">Limite de autonomia da operação</h3>
        <p className="mb-3 text-sm text-muted">Até estes limites o vendedor fecha sozinho. Acima de qualquer um deles, a oportunidade precisa da viabilidade da engenharia aprovada para virar venda fechada e, depois do fechamento, de um chamado de projeto executivo. Em branco = sem limite.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Metragem máxima de cabo (m)" htmlFor="vs-am"><Input id="vs-am" type="number" min={0} value={s.autonomyMaxMeters ?? ''} onChange={(e) => setS({ ...s, autonomyMaxMeters: intOrNull(e.target.value) })} /></FormField>
          <FormField label="Velocidade máxima (Mbps)" htmlFor="vs-ab"><Input id="vs-ab" type="number" min={0} value={s.autonomyMaxMbps ?? ''} onChange={(e) => setS({ ...s, autonomyMaxMbps: intOrNull(e.target.value) })} /></FormField>
        </div>
      </div>
      <h3 className="text-md font-bold text-ink">LTV, payback e padrões</h3>
      <p className="mb-3 max-w-3xl text-sm text-muted">O LTV histórico usa a carteira quando há clientes suficientes; senão usa a vida média informada aqui (ou 1 ÷ churn mensal).</p>
      <div className="mb-4 grid grid-cols-1 gap-3 rounded-md bg-surface-2 p-3 text-sm sm:grid-cols-3">
        <p><span className="block text-muted">Clientes na base</span><span className="num text-lg font-bold text-ink">{fmtInt(base.customers)}</span></p>
        <p><span className="block text-muted">Vida média na base</span><span className="num text-lg font-bold text-ink">{base.avgLifetimeMonths === null ? 'N/D' : `${base.avgLifetimeMonths.toLocaleString('pt-BR')} meses`}</span></p>
        <p><span className="block text-muted">Margem média mensal</span><span className="num text-lg font-bold text-ink">{fmtBRL(base.avgMarginCents)}</span></p>
        <p className="sm:col-span-3 text-xs text-muted">{useBase ? 'O LTV histórico está vindo da carteira.' : `Amostra abaixo de ${s.ltvMinSample} clientes: o LTV usa o parâmetro abaixo.`} Clientes ainda ativos contam até hoje, então a vida média da base tende a ser conservadora.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <FormField label="Vida média do cliente (meses)" htmlFor="vs-life" hint="Usada quando a base é pequena"><Input id="vs-life" type="number" min={1} value={s.ltvLifetimeMonths ?? ''} onChange={(e) => setS({ ...s, ltvLifetimeMonths: intOrNull(e.target.value) })} /></FormField>
        <FormField label="Ou churn mensal (%)" htmlFor="vs-churn" hint="Se não houver vida média"><Input id="vs-churn" inputMode="decimal" defaultValue={dec(s.monthlyChurnBp)} key={`ch${initial.monthlyChurnBp}`} onBlur={(e) => setS({ ...s, monthlyChurnBp: numOrNull(e.target.value) })} /></FormField>
        <FormField label="Amostra mínima da base" htmlFor="vs-min"><Input id="vs-min" type="number" min={1} value={s.ltvMinSample} onChange={(e) => setS({ ...s, ltvMinSample: Math.max(1, Number(e.target.value || 1)) })} /></FormField>
        <FormField label="Payback máximo (meses)" htmlFor="vs-pb" hint="Acima disso o vendedor vê alerta"><Input id="vs-pb" type="number" min={1} value={s.maxPaybackMonths ?? ''} onChange={(e) => setS({ ...s, maxPaybackMonths: intOrNull(e.target.value) })} /></FormField>
        <FormField label="Taxa de ativação padrão (R$)" htmlFor="vs-fee"><Input id="vs-fee" inputMode="decimal" defaultValue={dec(s.defaultActivationFeeCents)} key={`fee${initial.defaultActivationFeeCents}`} onBlur={(e) => setS({ ...s, defaultActivationFeeCents: numOrNull(e.target.value) })} /></FormField>
        <FormField label="Caminho padrão" htmlFor="vs-route" hint="Quando nenhuma regra casar">
          <Select id="vs-route" value={s.defaultRouteId ?? ''} onChange={(e) => setS({ ...s, defaultRouteId: e.target.value || null })}>
            <option value="">Primeiro caminho ativo</option>
            {routes.filter((r) => r.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </FormField>
      </div>
      <div className="mt-3 flex justify-end"><Button size="sm" variant="primary" loading={m.isPending} disabled={!dirty} onClick={() => m.mutate()}>Salvar</Button></div>
    </section>
  );
}

function Simulator() {
  const lookups = useLookups();
  const [planId, setPlanId] = useState('');
  const [vb, setVb] = useState<ViabilityValue>({ saleType: 'ativa', cableMeters: '80', activationFee: '' });
  const input = useDebounced(JSON.stringify({ planId: planId || null, ...viabilityPayload(vb) }), 300);
  const sim = useQuery({ queryKey: ['admin-simulate', input], queryFn: () => api<ViabilityResult>('/viability/simulate', { method: 'POST', body: JSON.parse(input) }), placeholderData: (p) => p });
  return (
    <section className="card p-5">
      <h3 className="mb-1 flex items-center gap-2 text-md font-bold text-ink"><Calculator className="h-5 w-5 text-primary" />Simular uma venda</h3>
      <p className="mb-3 text-sm text-muted">Confira o efeito dos parâmetros salvos antes de o time usar.</p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-3">
          <FormField label="Plano" htmlFor="sim-plan">
            <Select id="sim-plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">Escolha um plano</option>
              {lookups.data?.plans.map((p) => <option key={p.id} value={p.id}>{p.name}{p.speedMbps ? ` (${p.speedMbps} Mbps)` : ''} — {fmtBRL(p.priceCents)}</option>)}
            </Select>
          </FormField>
          <ViabilityInputs value={vb} onChange={(v) => setVb((x) => ({ ...x, ...v }))} idPrefix="sim" />
        </div>
        <ViabilityPanel v={sim.data} loading={sim.isFetching} title="Resultado" />
      </div>
    </section>
  );
}

export function AdminViability() {
  const q = useQuery({ queryKey: ['admin', 'viability'], queryFn: () => api<Data>('/admin/viability') });
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <div className="space-y-4">
      <section className="card p-5">
        <h2 className="text-lg font-bold text-ink">Viabilidade da venda</h2>
        <p className="max-w-3xl text-sm text-muted">Margem mensal = mensalidade − tributos − parceiros − custo mensal do caminho. CAC = comissão + cabo + instalação + equipamentos − taxa de ativação. Payback = CAC ÷ margem mensal. O vendedor vê tudo isso na negociação, comparado com o LTV histórico. Vendas fechadas guardam o cálculo do dia do fechamento.</p>
      </section>
      <Simulator />
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        <Deductions title="Tributos" desc="Impostos sobre a mensalidade, em % ou valor fixo por mês. Um tributo em % pode ser calculado sobre o que sobra depois de tirar um parceiro (ex.: ISS sobre a mensalidade menos a UPNET)." url="/admin/viability/taxes" initial={d.taxes} routes={d.routes} partners={d.partners} />
        <Deductions title="Parceiros e fornecedores" desc="Custos mensais de terceiros: trânsito IP, suporte, aluguel de rede, em % ou valor fixo." url="/admin/viability/partners" initial={d.partners} routes={d.routes} />
      </div>
      <Equipments initial={d.equipments} />
      <Routes initial={d.routes} equipments={d.equipments} />
      <Commissions initial={d.commissions} />
      <SettingsForm initial={d.settings} routes={d.routes} base={d.base} />
    </div>
  );
}
