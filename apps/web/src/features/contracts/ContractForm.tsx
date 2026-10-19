/** Formulário do contrato (cadastro e edição). Datas de assinatura, vigência, ativação e faturamento ficam separadas. */
import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { BILLING_TYPES, BILLING_TYPE_HINTS, BILLING_TYPE_LABELS, type BillingType, LEGAL_REFERENCE_MONTHS, LEGAL_REGIME_LABELS, LEGAL_REGIMES, addMonths, addDays, endFromTerm, toCents, type LegalRegime } from '@isp/domain';
import { useLookups } from '../../lib/hooks';
import { fmtBRL } from '../../lib/format';
import { Button, FormField, Input, Select, Textarea } from '../../components/ui/primitives';
import { dec, type ContractItem, type Guarantee, type PublicTerms, type Version } from './shared';

type ItemRow = { planId: string; description: string; qty: string; unit: string };
export type FormState = {
  kind: 'privado' | 'publico'; billingType: BillingType; initialBalance: string; legalRegime: LegalRegime; commercialOwnerId: string; operationalOwnerId: string; csmId: string; legalLimitAt: string; nextAction: string; nextActionAt: string;
  number: string; object: string; signedAt: string; startAt: string; termMonths: string; endAt: string; activationAt: string; billingStartAt: string; renewalAt: string;
  items: ItemRow[]; monthly: string; total: string; billingDay: string; billingTerms: string;
  hasGuarantee: boolean; gType: string; gAmount: string; gInsurer: string; gPolicy: string; gExpires: string; gRenewal: string;
  agency: string; processNumber: string; modality: string; commitmentNote: string; budgetLine: string; extensionMax: string;
  adjustmentIndex: string; adjustmentBaseDate: string; adjustmentRule: string; specialConditions: string; reason: string;
};

export function formFrom(h: Partial<{ kind: 'privado' | 'publico'; billingType: BillingType; legalRegime: LegalRegime; commercialOwnerId: string; operationalOwnerId: string | null; csmId: string | null; legalLimitAt: string | null; nextAction: string | null; nextActionAt: string | null }>, v: Partial<Version>): FormState {
  const g = v.guarantee, p = v.publicTerms;
  return {
    kind: h.kind ?? 'privado', billingType: h.billingType ?? 'recorrente', initialBalance: '', legalRegime: h.legalRegime ?? 'privado', commercialOwnerId: h.commercialOwnerId ?? '', operationalOwnerId: h.operationalOwnerId ?? '', csmId: h.csmId ?? '', legalLimitAt: h.legalLimitAt ?? '', nextAction: h.nextAction ?? '', nextActionAt: h.nextActionAt ?? '',
    number: v.number ?? '', object: v.object ?? '', signedAt: v.signedAt ?? '', startAt: v.startAt ?? '', termMonths: v.termMonths ? String(v.termMonths) : '', endAt: v.endAt ?? '', activationAt: v.activationAt ?? '', billingStartAt: v.billingStartAt ?? '', renewalAt: v.renewalAt ?? '',
    items: (v.items ?? []).map((i) => ({ planId: i.planId ?? '', description: i.description, qty: String(i.qty), unit: dec(i.unitCents) })),
    monthly: dec(v.monthlyCents ?? null), total: dec(v.totalCents ?? null), billingDay: v.billingDay ? String(v.billingDay) : '', billingTerms: v.billingTerms ?? '',
    hasGuarantee: !!g, gType: g?.type ?? '', gAmount: dec(g?.amountCents ?? null), gInsurer: g?.insurer ?? '', gPolicy: g?.policy ?? '', gExpires: g?.expiresAt ?? '', gRenewal: g?.renewalAt ?? '',
    agency: p?.agency ?? '', processNumber: p?.processNumber ?? '', modality: p?.modality ?? '', commitmentNote: p?.commitmentNote ?? '', budgetLine: p?.budgetLine ?? '', extensionMax: p?.extensionMaxMonths ? String(p.extensionMaxMonths) : '',
    adjustmentIndex: v.adjustmentIndex ?? '', adjustmentBaseDate: v.adjustmentBaseDate ?? '', adjustmentRule: v.adjustmentRule ?? '', specialConditions: v.specialConditions ?? '', reason: '',
  };
}

const nul = (s: string) => (s.trim() ? s.trim() : null);
const itemsOf = (rows: ItemRow[]): ContractItem[] => rows.filter((r) => r.description.trim()).map((r) => ({ planId: r.planId || null, description: r.description.trim(), qty: Math.max(1, Number(r.qty) || 1), unitCents: toCents(r.unit) ?? 0 }));

/** Monta o corpo para a API. Erros de digitação de valores voltam como mensagem. */
export function payloadOf(f: FormState) {
  const items = itemsOf(f.items);
  const itemsTotal = items.reduce((a, i) => a + i.qty * i.unitCents, 0);
  const monthlyCents = f.monthly.trim() ? toCents(f.monthly) : f.billingType === 'medicao' ? 0 : itemsTotal;
  if (monthlyCents === null) throw new Error('Valor mensal inválido. Use o formato 1.500,00.');
  const totalCents = f.total.trim() ? toCents(f.total) : null;
  if (f.total.trim() && totalCents === null) throw new Error('Valor global inválido.');
  const guarantee: Guarantee | null = f.hasGuarantee ? { type: f.gType.trim() || 'Seguro-garantia', amountCents: f.gAmount.trim() ? toCents(f.gAmount) : null, insurer: nul(f.gInsurer), policy: nul(f.gPolicy), expiresAt: nul(f.gExpires), renewalAt: nul(f.gRenewal) } : null;
  const publicTerms: PublicTerms | null = f.kind === 'publico' ? { agency: nul(f.agency), processNumber: nul(f.processNumber), modality: nul(f.modality), commitmentNote: nul(f.commitmentNote), budgetLine: nul(f.budgetLine), extensionMaxMonths: f.extensionMax ? Number(f.extensionMax) : null } : null;
  const initialBalanceCents = f.initialBalance.trim() ? toCents(f.initialBalance) : 0;
  if (initialBalanceCents === null) throw new Error('Saldo inicial inválido. Use o formato 100.000,00.');
  return {
    initialBalanceCents,
    header: { kind: f.kind, billingType: f.billingType, legalRegime: f.kind === 'privado' ? 'privado' : f.legalRegime, commercialOwnerId: f.commercialOwnerId, operationalOwnerId: f.operationalOwnerId || null, csmId: f.csmId || null, legalLimitAt: nul(f.legalLimitAt), nextAction: nul(f.nextAction), nextActionAt: nul(f.nextActionAt) },
    version: {
      number: f.number.trim(), object: f.object.trim(), signedAt: nul(f.signedAt), startAt: nul(f.startAt), endAt: nul(f.endAt), termMonths: f.termMonths ? Number(f.termMonths) : null,
      activationAt: nul(f.activationAt), billingStartAt: nul(f.billingStartAt), renewalAt: nul(f.renewalAt), monthlyCents, totalCents, billingDay: f.billingDay ? Number(f.billingDay) : null, billingTerms: nul(f.billingTerms),
      items, guarantee, publicTerms, adjustmentIndex: nul(f.adjustmentIndex), adjustmentBaseDate: nul(f.adjustmentBaseDate), adjustmentRule: nul(f.adjustmentRule), specialConditions: nul(f.specialConditions),
    },
  };
}

function Fieldset({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <fieldset className="rounded-md border border-line p-4">
      <legend className="px-1 text-md font-bold text-ink">{title}</legend>
      {hint && <p className="-mt-1 mb-3 text-sm text-muted">{hint}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );
}

export function ContractForm({ value, onChange, editing, validated }: { value: FormState; onChange: (patch: Partial<FormState>) => void; editing?: boolean; validated?: boolean }) {
  const lookups = useLookups();
  const f = value;
  const users = lookups.data?.users ?? [];
  const plans = lookups.data?.plans ?? [];
  const itemsTotal = useMemo(() => itemsOf(f.items).reduce((a, i) => a + i.qty * i.unitCents, 0), [f.items]);
  const setItem = (i: number, p: Partial<ItemRow>) => onChange({ items: f.items.map((r, j) => (j === i ? { ...r, ...p } : r)) });
  const setStart = (startAt: string) => { const patch: Partial<FormState> = { startAt }; if (startAt && f.termMonths) { patch.endAt = endFromTerm(startAt, Number(f.termMonths)); patch.renewalAt = addDays(patch.endAt, 1); } onChange(patch); };
  const setTerm = (termMonths: string) => { const patch: Partial<FormState> = { termMonths }; if (f.startAt && termMonths) { patch.endAt = endFromTerm(f.startAt, Number(termMonths)); patch.renewalAt = addDays(patch.endAt, 1); } onChange(patch); };
  const suggestLimit = () => { const m = LEGAL_REFERENCE_MONTHS[f.legalRegime]; if (m && f.startAt) onChange({ legalLimitAt: addDays(addMonths(f.startAt, m), -1) }); };
  const u = (id: string, label: string, key: 'commercialOwnerId' | 'operationalOwnerId' | 'csmId', required = false) => (
    <FormField label={label} htmlFor={id} required={required}>
      <Select id={id} value={f[key]} onChange={(e) => onChange({ [key]: e.target.value })}>
        <option value="">{required ? 'Escolha' : 'Ninguém'}</option>
        {users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </Select>
    </FormField>
  );
  return (
    <div className="space-y-4">
      <Fieldset title="Contrato">
        <FormField label="Número do contrato" htmlFor="cf-number" required><Input id="cf-number" value={f.number} onChange={(e) => onChange({ number: e.target.value })} placeholder="Ex.: 045/2025" /></FormField>
        <FormField label="Tipo de contrato" htmlFor="cf-btype" hint={BILLING_TYPE_HINTS[f.billingType]}>
          <Select id="cf-btype" value={f.billingType} onChange={(e) => onChange({ billingType: e.target.value as BillingType })}>{BILLING_TYPES.map((t) => <option key={t} value={t}>{BILLING_TYPE_LABELS[t]}</option>)}</Select>
        </FormField>
        <FormField label="Público ou privado" htmlFor="cf-kind">
          <Select id="cf-kind" value={f.kind} onChange={(e) => onChange({ kind: e.target.value as FormState['kind'], legalRegime: e.target.value === 'privado' ? 'privado' : f.legalRegime === 'privado' ? 'lei_14133' : f.legalRegime })}>
            <option value="privado">Privado</option><option value="publico">Público</option>
          </Select>
        </FormField>
        {f.kind === 'publico' && (
          <FormField label="Regime jurídico" htmlFor="cf-regime" hint="Informativo: a elegibilidade é validada por uma pessoa responsável.">
            <Select id="cf-regime" value={f.legalRegime} onChange={(e) => onChange({ legalRegime: e.target.value as LegalRegime })}>{LEGAL_REGIMES.filter((r) => r !== 'privado').map((r) => <option key={r} value={r}>{LEGAL_REGIME_LABELS[r]}</option>)}</Select>
          </FormField>
        )}
        <FormField label="Objeto" htmlFor="cf-object" required className="sm:col-span-2 lg:col-span-3"><Textarea id="cf-object" className="min-h-[64px]" value={f.object} onChange={(e) => onChange({ object: e.target.value })} /></FormField>
      </Fieldset>

      <Fieldset title="Datas" hint="Assinatura, vigência, ativação técnica e início do faturamento são datas diferentes. O término sai do prazo; a renovação prevista é o dia seguinte ao término.">
        <FormField label="Assinatura" htmlFor="cf-signed" required><Input id="cf-signed" type="date" value={f.signedAt} onChange={(e) => onChange({ signedAt: e.target.value })} /></FormField>
        <FormField label="Início da vigência" htmlFor="cf-start" required><Input id="cf-start" type="date" value={f.startAt} onChange={(e) => setStart(e.target.value)} /></FormField>
        <FormField label="Prazo (meses)" htmlFor="cf-term"><Input id="cf-term" inputMode="numeric" value={f.termMonths} onChange={(e) => setTerm(e.target.value.replace(/\D/g, ''))} /></FormField>
        <FormField label="Término da vigência" htmlFor="cf-end" required><Input id="cf-end" type="date" value={f.endAt} onChange={(e) => onChange({ endAt: e.target.value, renewalAt: e.target.value ? addDays(e.target.value, 1) : '' })} /></FormField>
        <FormField label="Renovação prevista" htmlFor="cf-renewal"><Input id="cf-renewal" type="date" value={f.renewalAt} onChange={(e) => onChange({ renewalAt: e.target.value })} /></FormField>
        <FormField label="Ativação técnica" htmlFor="cf-activation" hint="Deixe em branco: a implantação registra."><Input id="cf-activation" type="date" value={f.activationAt} onChange={(e) => onChange({ activationAt: e.target.value })} /></FormField>
        <FormField label="Início do faturamento" htmlFor="cf-billing" hint="Deixe em branco: o Financeiro registra."><Input id="cf-billing" type="date" value={f.billingStartAt} onChange={(e) => onChange({ billingStartAt: e.target.value })} /></FormField>
        {f.kind === 'publico' && (
          <FormField label="Limite total de vigência" htmlFor="cf-limit" hint="Informe o limite validado. A sugestão usa o prazo de referência do regime.">
            <div className="flex gap-2"><Input id="cf-limit" type="date" value={f.legalLimitAt} onChange={(e) => onChange({ legalLimitAt: e.target.value })} /><Button type="button" onClick={suggestLimit} disabled={!f.startAt || !LEGAL_REFERENCE_MONTHS[f.legalRegime]}>Sugerir</Button></div>
          </FormField>
        )}
      </Fieldset>

      <fieldset className="rounded-md border border-line p-4">
        <legend className="px-1 text-md font-bold text-ink">Produtos e serviços</legend>
        <ul className="space-y-2">
          {f.items.map((r, i) => (
            <li key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[180px_minmax(0,1fr)_80px_130px_auto] sm:items-end">
              <FormField label="Plano" htmlFor={`cf-ip-${i}`}>
                <Select id={`cf-ip-${i}`} value={r.planId} onChange={(e) => { const p = plans.find((x) => x.id === e.target.value); setItem(i, { planId: e.target.value, ...(p && !r.description ? { description: p.name, unit: dec(p.priceCents) } : {}) }); }}>
                  <option value="">Sem plano</option>
                  {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </FormField>
              <FormField label="Descrição" htmlFor={`cf-id-${i}`}><Input id={`cf-id-${i}`} value={r.description} onChange={(e) => setItem(i, { description: e.target.value })} /></FormField>
              <FormField label="Qtd." htmlFor={`cf-iq-${i}`}><Input id={`cf-iq-${i}`} inputMode="numeric" value={r.qty} onChange={(e) => setItem(i, { qty: e.target.value.replace(/\D/g, '') })} /></FormField>
              <FormField label="Valor unitário (R$)" htmlFor={`cf-iu-${i}`}><Input id={`cf-iu-${i}`} inputMode="decimal" value={r.unit} onChange={(e) => setItem(i, { unit: e.target.value })} /></FormField>
              <Button variant="ghost" aria-label={`Remover ${r.description || 'item'}`} onClick={() => onChange({ items: f.items.filter((_, j) => j !== i) })} icon={<Trash2 className="h-4 w-4 text-danger" />} />
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => onChange({ items: [...f.items, { planId: '', description: '', qty: '1', unit: '' }] })}>Adicionar item</Button>
          <p className="text-sm text-muted">Soma dos itens: <span className="num font-semibold text-ink">{fmtBRL(itemsTotal)}</span>/mês</p>
        </div>
      </fieldset>

      <Fieldset title="Valores e faturamento">
        {f.billingType === 'medicao' && !editing && <FormField label="Saldo contratado (R$)" htmlFor="cf-balance" required hint="Crédito inicial do contrato; as oportunidades consomem esse saldo."><Input id="cf-balance" inputMode="decimal" value={f.initialBalance} onChange={(e) => onChange({ initialBalance: e.target.value })} placeholder="100.000,00" /></FormField>}
        <FormField label={f.billingType === 'recorrente' ? 'Valor mensal (R$)' : 'Valor mensal estimado (R$)'} htmlFor="cf-monthly" hint={f.billingType === 'recorrente' ? 'Em branco usa a soma dos itens.' : 'Opcional: referência para a carteira.'}><Input id="cf-monthly" inputMode="decimal" value={f.monthly} onChange={(e) => onChange({ monthly: e.target.value })} placeholder={dec(itemsTotal)} /></FormField>
        <FormField label="Valor global (R$)" htmlFor="cf-total"><Input id="cf-total" inputMode="decimal" value={f.total} onChange={(e) => onChange({ total: e.target.value })} /></FormField>
        <FormField label="Dia de faturamento" htmlFor="cf-bday"><Input id="cf-bday" inputMode="numeric" value={f.billingDay} onChange={(e) => onChange({ billingDay: e.target.value.replace(/\D/g, '').slice(0, 2) })} /></FormField>
        <FormField label="Condições de faturamento" htmlFor="cf-bterms" className="sm:col-span-2 lg:col-span-3"><Textarea id="cf-bterms" className="min-h-[60px]" value={f.billingTerms} onChange={(e) => onChange({ billingTerms: e.target.value })} placeholder="Ex.: fatura mensal, vencimento em 30 dias, medição até o dia 5" /></FormField>
      </Fieldset>

      <Fieldset title="Reajuste" hint="Regra própria deste contrato. Reajuste é diferente de repactuação e revisão.">
        <FormField label="Índice" htmlFor="cf-idx"><Input id="cf-idx" value={f.adjustmentIndex} onChange={(e) => onChange({ adjustmentIndex: e.target.value })} placeholder="IPCA, IGP-M, IST..." /></FormField>
        <FormField label="Data-base" htmlFor="cf-base"><Input id="cf-base" type="date" value={f.adjustmentBaseDate} onChange={(e) => onChange({ adjustmentBaseDate: e.target.value })} /></FormField>
        <FormField label="Regra" htmlFor="cf-rule" className="sm:col-span-2 lg:col-span-1"><Input id="cf-rule" value={f.adjustmentRule} onChange={(e) => onChange({ adjustmentRule: e.target.value })} placeholder="Ex.: anual, 12 meses da proposta" /></FormField>
      </Fieldset>

      <Fieldset title="Responsáveis">
        {u('cf-owner', 'Responsável comercial', 'commercialOwnerId', true)}
        {u('cf-ops', 'Responsável operacional', 'operationalOwnerId')}
        {u('cf-csm', 'Sucesso do Cliente (CSM)', 'csmId')}
        <FormField label="Próxima ação" htmlFor="cf-next" className="sm:col-span-2"><Input id="cf-next" value={f.nextAction} onChange={(e) => onChange({ nextAction: e.target.value })} /></FormField>
        <FormField label="Data da próxima ação" htmlFor="cf-next-at"><Input id="cf-next-at" type="date" value={f.nextActionAt} onChange={(e) => onChange({ nextActionAt: e.target.value })} /></FormField>
      </Fieldset>

      <fieldset className="rounded-md border border-line p-4">
        <legend className="px-1 text-md font-bold text-ink">Seguro/garantia</legend>
        <label className="mb-3 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={f.hasGuarantee} onChange={(e) => onChange({ hasGuarantee: e.target.checked })} />Este contrato tem garantia</label>
        {f.hasGuarantee && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <FormField label="Modalidade" htmlFor="cf-gtype"><Input id="cf-gtype" value={f.gType} onChange={(e) => onChange({ gType: e.target.value })} placeholder="Seguro-garantia, caução, fiança" /></FormField>
            <FormField label="Valor (R$)" htmlFor="cf-gamount"><Input id="cf-gamount" inputMode="decimal" value={f.gAmount} onChange={(e) => onChange({ gAmount: e.target.value })} /></FormField>
            <FormField label="Seguradora/banco" htmlFor="cf-gins"><Input id="cf-gins" value={f.gInsurer} onChange={(e) => onChange({ gInsurer: e.target.value })} /></FormField>
            <FormField label="Apólice/número" htmlFor="cf-gpol"><Input id="cf-gpol" value={f.gPolicy} onChange={(e) => onChange({ gPolicy: e.target.value })} /></FormField>
            <FormField label="Vencimento" htmlFor="cf-gexp"><Input id="cf-gexp" type="date" value={f.gExpires} onChange={(e) => onChange({ gExpires: e.target.value })} /></FormField>
            <FormField label="Renovação da garantia" htmlFor="cf-gren"><Input id="cf-gren" type="date" value={f.gRenewal} onChange={(e) => onChange({ gRenewal: e.target.value })} /></FormField>
          </div>
        )}
      </fieldset>

      {f.kind === 'publico' && (
        <Fieldset title="Contrato público">
          <FormField label="Órgão contratante" htmlFor="cf-agency" required><Input id="cf-agency" value={f.agency} onChange={(e) => onChange({ agency: e.target.value })} /></FormField>
          <FormField label="Processo administrativo" htmlFor="cf-proc"><Input id="cf-proc" value={f.processNumber} onChange={(e) => onChange({ processNumber: e.target.value })} /></FormField>
          <FormField label="Modalidade" htmlFor="cf-mod"><Input id="cf-mod" value={f.modality} onChange={(e) => onChange({ modality: e.target.value })} placeholder="Pregão eletrônico, dispensa..." /></FormField>
          <FormField label="Nota de empenho" htmlFor="cf-emp"><Input id="cf-emp" value={f.commitmentNote} onChange={(e) => onChange({ commitmentNote: e.target.value })} /></FormField>
          <FormField label="Dotação orçamentária" htmlFor="cf-dot"><Input id="cf-dot" value={f.budgetLine} onChange={(e) => onChange({ budgetLine: e.target.value })} /></FormField>
          <FormField label="Prorrogação máxima prevista (meses)" htmlFor="cf-ext"><Input id="cf-ext" inputMode="numeric" value={f.extensionMax} onChange={(e) => onChange({ extensionMax: e.target.value.replace(/\D/g, '') })} /></FormField>
        </Fieldset>
      )}

      <fieldset className="rounded-md border border-line p-4">
        <legend className="px-1 text-md font-bold text-ink">Condições específicas</legend>
        <Textarea aria-label="Condições específicas" className="min-h-[80px]" value={f.specialConditions} onChange={(e) => onChange({ specialConditions: e.target.value })} placeholder="SLA, multas, cláusulas de rescisão, exigências do edital..." />
      </fieldset>

      {editing && validated && (
        <FormField label="Motivo da alteração" htmlFor="cf-reason" required hint="Contrato validado: a alteração gera uma nova versão e a anterior fica no histórico.">
          <Input id="cf-reason" value={f.reason} onChange={(e) => onChange({ reason: e.target.value })} placeholder="Ex.: correção do dia de faturamento" />
        </FormField>
      )}
    </div>
  );
}
