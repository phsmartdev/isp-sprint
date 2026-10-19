/** Gerar proposta pelo modelo: o vendedor revisa as variáveis, vê a prévia e gera o PDF anexado. */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { Button, EmptyState, FormField, Input, LoadingRows, Select, Textarea } from '../components/ui/primitives';
import { Modal, useToast } from '../components/ui/overlay';
import { ProposalCanvas, type PField, type PPage } from './ProposalCanvas';

type Tpl = { id: string; name: string; matches: boolean; variables: { key: string; label: string; type: 'texto' | 'texto_longo' | 'moeda'; default: string }[]; fields: PField[]; pages: PPage[] };

export function ProposalGenerator({ oppId, open, onClose }: { oppId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['proposal-templates', oppId], enabled: open, queryFn: () => api<{ items: Tpl[]; system: Record<string, string> }>(`/opportunities/${oppId}/proposal-templates`) });
  const [tplId, setTplId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const tpl = q.data?.items.find((t) => t.id === tplId) ?? q.data?.items[0];
  useEffect(() => { if (tpl) setValues(Object.fromEntries(tpl.variables.map((v) => [v.key, v.default]))); }, [tpl?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const gen = useMutation({
    mutationFn: () => api<{ filename: string }>(`/opportunities/${oppId}/proposal`, { method: 'POST', body: { templateId: tpl!.id, values } }),
    onSuccess: (r) => { for (const k of ['attachments', 'opportunity', 'timeline']) qc.invalidateQueries({ queryKey: [k] }); toast({ tone: 'success', message: `Proposta gerada e anexada: ${r.filename}` }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: e instanceof ApiError ? e.problem.detail ?? e.message : (e as Error).message }),
  });
  const all = { ...(q.data?.system ?? {}), ...values };
  return (
    <Modal open={open} onClose={onClose} title="Gerar proposta" size="xl" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={gen.isPending} disabled={!tpl} onClick={() => gen.mutate()}>Gerar PDF e anexar</Button></>}>
      {q.isLoading ? <LoadingRows rows={5} /> : !tpl ? (
        <EmptyState title="Nenhum modelo de proposta pronto" description="A gerência cadastra o modelo (com a arte do Canva) em Configurações → Modelos de proposta." />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-3">
            {q.data!.items.length > 1 && (
              <FormField label="Modelo" htmlFor="pg-tpl">
                <Select id="pg-tpl" value={tpl.id} onChange={(e) => setTplId(e.target.value)}>{q.data!.items.map((t) => <option key={t.id} value={t.id}>{t.name}{t.matches ? '' : ' (outro tipo de deal)'}</option>)}</Select>
              </FormField>
            )}
            <p className="text-xs text-muted">Cliente, CNPJ, plano, valor e taxa de ativação vêm da oportunidade. Revise os campos abaixo.</p>
            {tpl.variables.map((v) => (
              <FormField key={v.key} label={v.label} htmlFor={`pg-${v.key}`}>
                {v.type === 'texto_longo'
                  ? <Textarea id={`pg-${v.key}`} value={values[v.key] ?? ''} onChange={(e) => setValues({ ...values, [v.key]: e.target.value })} />
                  : <Input id={`pg-${v.key}`} inputMode={v.type === 'moeda' ? 'decimal' : undefined} value={values[v.key] ?? ''} onChange={(e) => setValues({ ...values, [v.key]: e.target.value })} />}
              </FormField>
            ))}
            {!q.data!.system['cliente.documento'] && <p className="rounded-md bg-warning-soft px-3 py-2 text-xs text-[#9A5B00]">O CNPJ do cliente não está cadastrado; o campo sai em branco.</p>}
          </div>
          <div className="min-w-0 space-y-3">
            {tpl.pages.map((p, i) => (
              <div key={p.id} className="mx-auto max-w-[520px] overflow-hidden rounded-md border border-line shadow-sm">
                <ProposalCanvas templateId={tpl.id} page={p} index={i} fields={tpl.fields} values={all} />
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
