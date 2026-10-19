/** Configurações → Campos personalizados: ficha do cliente e negociações (por jornada). */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import type { LookupField } from '../../lib/types';
import { ErrorState, FormField, LoadingRows, Select, Tabs } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { FieldDefsEditor, type FieldDef } from '../../features/FieldDefsEditor';
import { FieldsTab, useJourneys } from './Journeys';

const errMsg = (e: unknown) => (e instanceof ApiError ? [e.problem.detail ?? e.message, ...(e.problem.errors ?? []).map((x) => x.message)].filter((v, i, a) => a.indexOf(v) === i).join(' ') : (e as Error).message);
const toDef = (f: LookupField): FieldDef => ({ chave: f.key, rotulo: f.label, tipo: f.type, opcoes: f.options, obrigatorio: f.required });

function CustomerFields() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['customer-fields'], queryFn: () => api<{ items: LookupField[] }>('/customer-fields') });
  const save = useMutation({
    mutationFn: (fields: FieldDef[]) => api<{ items: LookupField[] }>('/admin/customer-fields', { method: 'PUT', body: { fields } }),
    onSuccess: (r) => { qc.setQueryData(['customer-fields'], r); qc.invalidateQueries({ queryKey: ['admin', 'import-columns'] }); toast({ tone: 'success', message: 'Campos de cliente salvos' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-muted">Aparecem na ficha de todos os clientes e viram colunas na planilha de importação (campo_…). Remover um campo esconde o campo; o valor já preenchido continua guardado.</p>
      <FieldDefsEditor key={q.data!.items.map((f) => f.key).join()} initial={q.data!.items.map(toDef)} idPrefix="cuf" saving={save.isPending} onSave={(f) => save.mutate(f)} emptyHint="Exemplos: melhor horário para contato, quantidade de pontos, data de aniversário." />
    </div>
  );
}

function DealFields() {
  const q = useJourneys();
  const [id, setId] = useState('');
  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const all = q.data!.items;
  const j = all.find((x) => x.id === id) ?? all.find((x) => x.isDefault) ?? all[0];
  if (!j) return <p className="text-sm text-muted">Crie uma jornada primeiro em Jornadas.</p>;
  return (
    <div className="space-y-3">
      <FormField label="Jornada" htmlFor="cf-journey" className="max-w-sm">
        <Select id="cf-journey" value={j.id} onChange={(e) => setId(e.target.value)}>{all.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.fields.length} campo{x.fields.length === 1 ? '' : 's'})</option>)}</Select>
      </FormField>
      <FieldsTab journey={j} all={all} />
    </div>
  );
}

export function AdminCustomFields() {
  const [tab, setTab] = useState<'clientes' | 'negociacoes'>('clientes');
  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold text-ink">Campos personalizados</h2>
      <p className="mb-3 text-sm text-muted">Crie os campos que sua operação precisa registrar, além dos campos padrão do CRM.</p>
      <Tabs label="Onde o campo aparece" value={tab} onChange={setTab} className="mb-4" tabs={[{ key: 'clientes', label: 'Clientes' }, { key: 'negociacoes', label: 'Negociações' }]} />
      {tab === 'clientes' ? <CustomerFields /> : <DealFields />}
    </section>
  );
}
