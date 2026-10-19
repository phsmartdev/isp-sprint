/** Configurações → Base de dados: planilha modelo, importação de clientes e limpeza da base. */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, Upload } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { fmtInt } from '../../lib/format';
import { useAuth } from '../../auth/AuthProvider';
import { Button, FormField, Input, Notice } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';

type Preview = { total: number; valid: number; errors: { line: number; message: string }[]; errorCount: number; imported: { created: number; updated: number } | null };
const SCOPES = [
  { key: 'clientes', label: 'Base de clientes', desc: 'Clientes, endereços, códigos externos e os contratos deles.' },
  { key: 'comercial', label: 'Comercial', desc: 'Leads, oportunidades, contratos, atividades, anexos e o histórico deles.' },
] as const;
const CONFIRM = 'LIMPAR BASE';

function ImportCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const cols = useQuery({ queryKey: ['admin', 'import-columns'], queryFn: () => api<{ columns: { key: string; hint: string; example: string }[] }>('/admin/customers/template/columns') });
  const run = useMutation({
    mutationFn: (dryRun: boolean) => api<Preview>('/admin/customers/import', { method: 'POST', body: { csv, dryRun } }),
    onSuccess: (r) => {
      setPreview(r);
      if (r.imported) { toast({ tone: 'success', message: `${r.imported.created} clientes criados e ${r.imported.updated} atualizados` }); for (const k of ['customers', 'intelligence-general', 'intelligence-heat', 'home']) qc.invalidateQueries({ queryKey: [k] }); }
    },
    onError: (e) => toast({ tone: 'error', message: e instanceof ApiError ? e.problem.detail ?? e.message : (e as Error).message }),
  });
  const onFile = async (f: File) => {
    if (f.size > 12_000_000) { toast({ tone: 'error', message: 'Arquivo grande demais (máx. 12 MB). Divida a planilha.' }); return; }
    const buf = await f.arrayBuffer();
    // Excel salva CSV em UTF-8 ou em Windows-1252; tenta UTF-8 e cai para 1252 se houver caractere inválido
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
    setCsv(text); setFileName(f.name); setPreview(null);
    run.mutate(true);
  };
  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold text-ink">Importar clientes por planilha</h2>
      <p className="mb-4 max-w-3xl text-sm text-muted">Baixe o modelo com os campos do CRM, preencha no Excel (uma linha por cliente) e salve como CSV. O sistema confere tudo antes de gravar. Se o código do cliente já existir, a linha atualiza o cadastro.</p>
      <div className="mb-4 flex flex-wrap gap-2">
        <a className="inline-flex h-10 items-center gap-2 rounded-md border border-primary/60 bg-surface px-4 font-semibold text-primary hover:bg-primary-soft" href="/api/v1/admin/customers/template" download><Download className="h-4 w-4" aria-hidden />Baixar modelo (CSV para Excel)</a>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" id="imp-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
        <Button variant="primary" icon={<Upload className="h-4 w-4" />} loading={run.isPending && !preview} onClick={() => fileRef.current?.click()}>Enviar planilha preenchida</Button>
      </div>
      {preview && (
        <div className="mb-4 rounded-md border border-line p-4">
          <p className="text-sm text-ink"><strong>{fileName}</strong>: {fmtInt(preview.total)} linha(s) · <span className="text-success">{fmtInt(preview.valid)} pronta(s)</span>{preview.errorCount ? <> · <span className="text-danger">{fmtInt(preview.errorCount)} com erro (não entram)</span></> : null}</p>
          {preview.errors.length > 0 && (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">
              {preview.errors.map((e) => <li key={e.line} className="rounded bg-danger-soft px-2 py-1 text-danger">Linha {e.line}: {e.message}</li>)}
            </ul>
          )}
          {preview.imported ? (
            <p className="mt-2 text-sm font-semibold text-success">Importado: {preview.imported.created} criados, {preview.imported.updated} atualizados.</p>
          ) : preview.valid > 0 && (
            <Button className="mt-3" variant="primary" loading={run.isPending} onClick={() => run.mutate(false)}>Importar {fmtInt(preview.valid)} cliente(s)</Button>
          )}
        </div>
      )}
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-primary">Ver o que vai em cada coluna</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-1.5 font-medium">Coluna</th><th className="px-3 py-1.5 font-medium">O que preencher</th><th className="px-3 py-1.5 font-medium">Exemplo</th></tr></thead>
            <tbody>{cols.data?.columns.map((c) => <tr key={c.key} className="border-t border-line"><td className="px-3 py-1.5 font-mono text-xs text-ink">{c.key}</td><td className="px-3 py-1.5 text-text">{c.hint || '—'}</td><td className="px-3 py-1.5 text-muted">{c.example || '—'}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function ClearCard() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [scopes, setScopes] = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isAdmin = me?.profiles.includes('gerencia');
  const clear = useMutation({
    mutationFn: () => api<{ counts: Record<string, number> }>('/admin/clear-base', { method: 'POST', body: { password, confirm, scopes } }),
    onSuccess: (r) => {
      setOpen(false); setPassword(''); setConfirm(''); setScopes([]);
      qc.invalidateQueries();
      const c = r.counts;
      toast({ tone: 'success', message: `Base limpa: ${[c.clientes != null && `${c.clientes} clientes`, c.oportunidades != null && `${c.oportunidades} oportunidades`, c.leads != null && `${c.leads} leads`].filter(Boolean).join(', ')}.` });
    },
    onError: (e) => setError(e instanceof ApiError ? e.problem.detail ?? e.message : (e as Error).message),
  });
  return (
    <section className="card border border-danger/30 p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold text-danger"><AlertTriangle className="h-5 w-5" />Limpar base</h2>
      <p className="mb-3 max-w-3xl text-sm text-muted">Apaga de vez os dados escolhidos desta empresa, por exemplo os dados de demonstração antes de começar a usar de verdade. Usuários, planos, jornadas e configurações ficam. A auditoria registra quem limpou e quando. Não há como desfazer.</p>
      {!isAdmin ? <Notice tone="warning">Só a gerência pode limpar a base.</Notice> : <Button variant="danger" onClick={() => { setError(null); setOpen(true); }}>Limpar base…</Button>}
      <Modal open={open} onClose={() => setOpen(false)} title="Limpar base" size="sm" footer={<><Button onClick={() => setOpen(false)}>Cancelar</Button><Button variant="danger" loading={clear.isPending} disabled={!scopes.length || !password || confirm.trim().toUpperCase() !== CONFIRM} onClick={() => { setError(null); clear.mutate(); }}>Apagar definitivamente</Button></>}>
        <div className="space-y-4">
          {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <fieldset>
            <legend className="mb-1 text-sm font-semibold text-ink">O que apagar</legend>
            {SCOPES.map((sc) => (
              <label key={sc.key} className="mb-1 flex items-start gap-2 rounded-sm border border-line px-3 py-2 text-sm">
                <input type="checkbox" className="mt-1" checked={scopes.includes(sc.key)} onChange={(e) => setScopes(e.target.checked ? [...scopes, sc.key] : scopes.filter((x) => x !== sc.key))} />
                <span><span className="block font-semibold text-ink">{sc.label}</span><span className="text-muted">{sc.desc}</span></span>
              </label>
            ))}
          </fieldset>
          <FormField label="Sua senha" htmlFor="cl-pass" required><Input id="cl-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></FormField>
          <FormField label={`Digite ${CONFIRM} para confirmar`} htmlFor="cl-confirm" required><Input id="cl-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={CONFIRM} autoComplete="off" /></FormField>
        </div>
      </Modal>
    </section>
  );
}

export function AdminData() {
  return (
    <div className="space-y-4">
      <ImportCard />
      <ClearCard />
    </div>
  );
}
