/** Configurações → Filiais da venda: lista usada na abertura da oportunidade (ex.: BKT Soluções, UPNET). */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { Button, ErrorState, Input, LoadingRows } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

type Row = { id: string | null; name: string; active: boolean };

export function AdminSalesBranches() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'sales-branches'], queryFn: () => api<{ items: Row[] }>('/admin/sales-branches') });
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { if (q.data) setRows(q.data.items.map((r) => ({ id: r.id, name: r.name, active: r.active }))); }, [q.data]);
  const save = useMutation({
    mutationFn: () => api('/admin/sales-branches', { method: 'PUT', body: { items: rows.filter((r) => r.name.trim()) } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin', 'sales-branches'] }); void qc.invalidateQueries({ queryKey: ['lookups'] }); toast({ tone: 'success', message: 'Filiais salvas' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-ink">Filiais da venda</h1><p className="text-sm text-muted">A filial que vende é escolhida ao abrir cada oportunidade. Desativar uma filial a tira da escolha, mas mantém o histórico das oportunidades dela.</p></div>
      <section className="card p-5" aria-label="Filiais">
        {q.isLoading ? <LoadingRows rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <>
            <ul className="space-y-2">
              {rows.map((r, i) => (
                <li key={r.id ?? `novo-${i}`} className="flex flex-wrap items-center gap-3">
                  <Input aria-label={`Nome da filial ${i + 1}`} className="max-w-sm flex-1" value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={r.active} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)))} />Ativa</label>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap justify-between gap-2">
              <Button variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setRows([...rows, { id: null, name: '', active: true }])}>Adicionar filial</Button>
              <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar filiais</Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
