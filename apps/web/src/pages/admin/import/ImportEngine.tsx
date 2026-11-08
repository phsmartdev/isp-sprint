/**
 * Configurações → Integrações e dados → Data Import Engine: Painel, Modelos, Nova importação, Conectores e Histórico.
 * Também as páginas do modelo (versões, comparação, edição do rascunho) e da execução.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Archive, ChevronLeft, Copy, FileUp, GitCompare, PlugZap, RotateCcw, ShieldCheck } from 'lucide-react';
import { IMPORT_SOURCE_LABELS, type ConfigChange, type ImportConfig } from '@isp/domain';
import { api } from '../../../lib/api';
import { fmtDateTime } from '../../../lib/format';
import { useUrlState } from '../../../lib/hooks';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Tabs, Textarea } from '../../../components/ui/primitives';
import { Modal, useToast } from '../../../components/ui/overlay';
import { errMsg } from '../../../features/contracts/shared';
import { MappingEditor } from '../../../features/dataImport/MappingEditor';
import { NewImport } from '../../../features/dataImport/NewImport';
import { RunPanel } from '../../../features/dataImport/RunPanel';
import { UploadFiles } from '../../../features/dataImport/UploadFiles';
import { Counters, ModeChip, RunStatusChip, scopeText, useConnectors, type Caps, type RunSummary } from '../../../features/dataImport/shared';

type Overview = { can: Caps; totals: { importacoes: number; andamento: number; concluidas: number; comErros: number; simulacoes: number; modelos: number }; records: { processados: number; criados: number; atualizados: number; ignorados: number; revisar: number; erros: number }; latest: RunSummary[] };
type TemplateRow = { id: string; name: string; description: string | null; source: string; connector: string | null; connectorId: string | null; archived: boolean; current: { id: string; number: string } | null; latest: { id: string; number: string; status: string } | null; versions: number; runs: number; lastRunAt: string | null; updatedAt: string };

function RunsTable({ runs }: { runs: RunSummary[] }) {
  if (!runs.length) return <p className="text-sm text-muted">Nenhuma execução ainda.</p>;
  return (
    <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm">
      <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2 font-medium">#</th><th className="px-3 py-2 font-medium">Tipo</th><th className="px-3 py-2 font-medium">Situação</th><th className="px-3 py-2 font-medium">Modelo</th><th className="px-3 py-2 font-medium">Escopo</th><th className="px-3 py-2 font-medium">Resultado</th><th className="px-3 py-2 font-medium">Quando</th></tr></thead>
      <tbody>{runs.map((r) => (
        <tr key={r.id} className="border-t border-line align-top">
          <td className="px-3 py-2"><Link className="link num font-semibold" to={`/settings/importacao/execucoes/${r.id}`}>#{r.code}</Link></td>
          <td className="px-3 py-2"><ModeChip m={r.mode} /></td><td className="px-3 py-2"><RunStatusChip s={r.status} /></td>
          <td className="px-3 py-2">{r.template ? `${r.template} v${r.version}` : 'Avulsa'}{r.temporaryChanges && <span className="block text-[11px] text-[#9A6B00]">alterações temporárias</span>}</td>
          <td className="max-w-xs px-3 py-2 text-xs text-text">{scopeText(r.scope)}</td>
          <td className="px-3 py-2"><Counters c={r.counters} compact /></td>
          <td className="px-3 py-2 text-xs text-muted">{fmtDateTime(r.createdAt)}<span className="block">{r.startedBy}</span></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

function Panel() {
  const q = useQuery({ queryKey: ['import', 'overview'], queryFn: () => api<Overview>('/admin/import/overview') });
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const box = (l: string, v: number, tone = 'text-ink') => <div key={l} className="rounded-md border border-line bg-surface p-3"><p className="text-xs text-muted">{l}</p><p className={`num text-2xl font-bold ${tone}`}>{v.toLocaleString('pt-BR')}</p></div>;
  return (
    <div className="space-y-6">
      <section aria-label="Importações" className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {box('Importações realizadas', d.totals.importacoes)}{box('Em andamento', d.totals.andamento, 'text-primary')}{box('Concluídas', d.totals.concluidas, 'text-[#15803D]')}{box('Com erros', d.totals.comErros, 'text-danger')}{box('Simulações', d.totals.simulacoes)}{box('Modelos cadastrados', d.totals.modelos)}
      </section>
      <section aria-label="Registros importados" className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {box('Registros processados', d.records.processados)}{box('Importados (criados)', d.records.criados, 'text-[#15803D]')}{box('Atualizados', d.records.atualizados, 'text-primary')}{box('Ignorados', d.records.ignorados, 'text-muted')}{box('Pendentes de revisão', d.records.revisar, 'text-[#9A6B00]')}{box('Com erro', d.records.erros, 'text-danger')}
      </section>
      <section aria-label="Últimas execuções" className="card p-4"><h2 className="mb-3 font-bold text-ink">Últimas execuções</h2><RunsTable runs={d.latest} /></section>
    </div>
  );
}

function Templates({ onUse }: { onUse: (id: string) => void }) {
  const [archived, setArchived] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['import', 'templates', archived], queryFn: () => api<{ items: TemplateRow[]; can: Caps }>(`/admin/import/templates?archived=${archived ? 1 : 0}`) });
  const [dup, setDup] = useState<TemplateRow | null>(null);
  const [name, setName] = useState('');
  const arch = useMutation({ mutationFn: (t: TemplateRow) => api(`/admin/import/templates/${t.id}`, { method: 'PATCH', body: { archived: !t.archived } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['import'] }), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const duplicate = useMutation({ mutationFn: () => api<{ id: string }>(`/admin/import/templates/${dup!.id}/duplicate`, { method: 'POST', body: { name } }), onSuccess: () => { setDup(null); void qc.invalidateQueries({ queryKey: ['import'] }); toast({ tone: 'success', message: 'Modelo duplicado' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (q.isLoading) return <LoadingRows rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const items = q.data!.items;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3"><p className="text-sm text-muted">Modelos são permanentes: cada execução usa um retrato imutável deles. Modelos usados não são apagados, só arquivados.</p><label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />Mostrar arquivados</label></div>
      {!items.length ? <EmptyState title="Nenhum modelo salvo" description="Crie o primeiro em Nova importação: monte o mapeamento, simule e salve como modelo." /> : (
        <ul className="grid gap-3 lg:grid-cols-2">{items.map((t) => (
          <li key={t.id} className={clsx('card space-y-2 p-4', t.archived && 'opacity-70')} aria-label={t.name}>
            <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><Link to={`/settings/importacao/modelos/${t.id}`} className="font-bold text-ink hover:text-primary">{t.name}</Link><p className="text-xs text-muted">{IMPORT_SOURCE_LABELS[t.source as keyof typeof IMPORT_SOURCE_LABELS] ?? t.source}{t.connector && ` · ${t.connector}`}</p></div>
              {t.current ? <Chip tone="green">v{t.current.number} aprovada</Chip> : <Chip tone="yellow">sem versão aprovada</Chip>}{t.latest && t.latest.status === 'rascunho' && <Chip tone="neutral">rascunho v{t.latest.number}</Chip>}{t.archived && <Chip>Arquivado</Chip>}</div>
            {t.description && <p className="text-sm text-text">{t.description}</p>}
            <p className="text-xs text-muted">{t.versions} versão(ões) · {t.runs} execução(ões){t.lastRunAt && ` · última em ${fmtDateTime(t.lastRunAt)}`}</p>
            <div className="flex flex-wrap gap-2">
              {!t.archived && <Button size="sm" variant="primary" onClick={() => onUse(t.id)}>Utilizar</Button>}
              <Link className="inline-flex h-8 items-center rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-surface-2" to={`/settings/importacao/modelos/${t.id}`}>Visualizar e editar</Link>
              {q.data!.can.modelos && <Button size="sm" variant="ghost" icon={<Copy className="h-4 w-4" />} onClick={() => { setDup(t); setName(`${t.name} (cópia)`); }}>Duplicar</Button>}
              {q.data!.can.modelos && <Button size="sm" variant="ghost" icon={<Archive className="h-4 w-4" />} onClick={() => arch.mutate(t)}>{t.archived ? 'Reativar' : 'Arquivar'}</Button>}
            </div>
          </li>
        ))}</ul>
      )}
      <Modal open={!!dup} onClose={() => setDup(null)} title="Duplicar modelo" footer={<><Button onClick={() => setDup(null)}>Cancelar</Button><Button variant="primary" loading={duplicate.isPending} disabled={name.trim().length < 3} onClick={() => duplicate.mutate()}>Duplicar</Button></>}>
        <FormField label="Nome do novo modelo" htmlFor="dup-n"><Input id="dup-n" value={name} onChange={(e) => setName(e.target.value)} /></FormField>
      </Modal>
    </div>
  );
}

function Connectors() {
  const q = useConnectors();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<{ kind: 'rdstation_crm' | 'csv'; name: string; token: string } | null>(null);
  const [upload, setUpload] = useState<string | null>(null);
  const [tokenFor, setTokenFor] = useState<{ id: string; token: string } | null>(null);
  const inv = () => qc.invalidateQueries({ queryKey: ['import'] });
  const create = useMutation({ mutationFn: () => api('/admin/import/connectors', { method: 'POST', body: { kind: form!.kind, name: form!.name, token: form!.kind === 'rdstation_crm' ? form!.token : undefined } }), onSuccess: () => { setForm(null); void inv(); toast({ tone: 'success', message: 'Conector criado. Teste a conexão.' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const test = useMutation({ mutationFn: (id: string) => api<{ ok: boolean; detail: string }>(`/admin/import/connectors/${id}/test`, { method: 'POST' }), onSuccess: (r) => { void inv(); toast({ tone: r.ok ? 'success' : 'error', message: r.detail }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api(`/admin/import/connectors/${id}`, { method: 'PATCH', body }), onSuccess: () => { setTokenFor(null); void inv(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const can = q.data!.can.conectores;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><p className="text-sm text-muted">Credenciais ficam cifradas no conector, nunca nos modelos, e não voltam para a tela.</p>{can && <Button className="ml-auto" variant="primary" icon={<PlugZap className="h-4 w-4" />} onClick={() => setForm({ kind: 'rdstation_crm', name: 'RD Station CRM', token: '' })}>Novo conector</Button>}</div>
      {!can && <Notice>Gerenciar conectores é da Diretoria e da Administração.</Notice>}
      {!q.data!.items.length ? <EmptyState title="Nenhum conector" description="Cadastre o RD Station CRM (com o token da conta) ou um conector de arquivos CSV." /> : (
        <ul className="grid gap-3 lg:grid-cols-2">{q.data!.items.map((c) => (
          <li key={c.id} className={clsx('card space-y-2 p-4', c.archived && 'opacity-60')} aria-label={c.name}>
            <div className="flex items-center gap-2"><b className="text-ink">{c.name}</b><Chip tone="neutral">{IMPORT_SOURCE_LABELS[c.kind]}</Chip><Chip tone={c.status === 'ok' ? 'green' : c.status === 'falhou' ? 'red' : 'yellow'}>{c.status === 'ok' ? 'Conexão ok' : c.status === 'falhou' ? 'Falhou' : 'Não testado'}</Chip>{c.archived && <Chip>Arquivado</Chip>}</div>
            {c.lastTestResult && <p className="text-xs text-muted">{fmtDateTime(c.lastTestAt!)} · {c.lastTestResult}</p>}
            {c.kind === 'rdstation_crm' && <p className="text-xs text-text">Token: {c.hasToken ? 'cadastrado (cifrado)' : 'falta'}. API v1 oficial, 120 requisições/min.</p>}
            {c.kind === 'csv' && <ul className="text-xs text-text">{c.files.map((f) => <li key={f.id}>{f.entity}: {f.name} · {f.rows} linhas · ID: {f.idColumn ?? 'número da linha'}</li>)}{!c.files.length && <li className="text-muted">Nenhum arquivo ainda.</li>}</ul>}
            {can && <div className="flex flex-wrap gap-2">
              <Button size="sm" loading={test.isPending && test.variables === c.id} onClick={() => test.mutate(c.id)}>Testar conexão</Button>
              {c.kind === 'rdstation_crm' && <Button size="sm" variant="ghost" onClick={() => setTokenFor({ id: c.id, token: '' })}>Trocar token</Button>}
              {c.kind === 'csv' && <Button size="sm" variant="ghost" icon={<FileUp className="h-4 w-4" />} onClick={() => setUpload(c.id)}>Enviar arquivo (CSV ou Excel)</Button>}
              <Button size="sm" variant="ghost" onClick={() => patch.mutate({ id: c.id, body: { archived: !c.archived } })}>{c.archived ? 'Reativar' : 'Arquivar'}</Button>
            </div>}
          </li>
        ))}</ul>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title="Novo conector" footer={<><Button onClick={() => setForm(null)}>Cancelar</Button><Button variant="primary" loading={create.isPending} disabled={!form || form.name.trim().length < 2 || (form.kind === 'rdstation_crm' && form.token.trim().length < 10)} onClick={() => create.mutate()}>Criar</Button></>}>
        {form && <div className="space-y-3">
          <FormField label="Origem" htmlFor="cn-k"><Select id="cn-k" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'csv', name: e.target.value === 'csv' ? 'Planilhas' : 'RD Station CRM' })}><option value="rdstation_crm">RD Station CRM (API)</option><option value="csv">Arquivos (CSV ou Excel)</option></Select></FormField>
          <FormField label="Nome" htmlFor="cn-n"><Input id="cn-n" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
          {form.kind === 'rdstation_crm' && <FormField label="Token da API do RD Station CRM" htmlFor="cn-t" hint="No RD Station CRM: Perfil → Integrações → Token. Fica cifrado e não aparece de novo."><Input id="cn-t" type="password" autoComplete="off" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} /></FormField>}
        </div>}
      </Modal>
      <Modal open={!!tokenFor} onClose={() => setTokenFor(null)} title="Trocar token" footer={<><Button onClick={() => setTokenFor(null)}>Cancelar</Button><Button variant="primary" disabled={(tokenFor?.token.trim().length ?? 0) < 10} loading={patch.isPending} onClick={() => patch.mutate({ id: tokenFor!.id, body: { token: tokenFor!.token } })}>Salvar</Button></>}>
        {tokenFor && <FormField label="Novo token" htmlFor="tk"><Input id="tk" type="password" autoComplete="off" value={tokenFor.token} onChange={(e) => setTokenFor({ ...tokenFor, token: e.target.value })} /></FormField>}
      </Modal>
      {upload && <UploadFiles connectorId={upload} onClose={() => setUpload(null)} onDone={() => { setUpload(null); void inv(); }} />}
    </div>
  );
}

function History() {
  const [f, set] = useUrlState({ modo: '', situacao: '' });
  const q = useQuery({ queryKey: ['import', 'runs', f.modo, f.situacao], queryFn: () => api<{ items: RunSummary[] }>(`/admin/import/runs?${f.modo ? `mode=${f.modo}&` : ''}${f.situacao ? `status=${f.situacao}` : ''}`) });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select aria-label="Tipo" className="w-44" value={f.modo} onChange={(e) => set({ modo: e.target.value })}><option value="">Simulações e importações</option><option value="simulacao">Simulações</option><option value="importacao">Importações</option></Select>
        <Select aria-label="Situação" className="w-56" value={f.situacao} onChange={(e) => set({ situacao: e.target.value })}><option value="">Todas as situações</option><option value="em_andamento">Em andamento</option><option value="pausada">Pausadas</option><option value="concluida">Concluídas</option><option value="concluida_com_pendencias">Com pendências</option><option value="falhou">Interrompidas</option><option value="cancelada">Canceladas</option></Select>
      </div>
      {q.isLoading ? <LoadingRows rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <div className="card p-4"><RunsTable runs={q.data!.items} /></div>}
      <TraceBox />
    </div>
  );
}

/** Identifica a origem de qualquer registro importado. */
function TraceBox() {
  const [entity, setEntity] = useState('oportunidade');
  const [id, setId] = useState('');
  const [go, setGo] = useState('');
  const q = useQuery({ queryKey: ['import', 'trace', entity, go], enabled: /^[0-9a-f-]{36}$/.test(go), queryFn: () => api<{ links: { source: string; sourceEntity: string; sourceId: string; legacy: Record<string, unknown>; importedAt: string; lastWrittenAt: string }[]; history: { run: number; at: string; action: string; original: unknown; values: Record<string, unknown>; converted: string[] }[] }>(`/admin/import/trace?entity=${entity}&targetId=${go}`) });
  return (
    <section aria-label="Rastrear registro" className="card space-y-2 p-4">
      <h2 className="font-bold text-ink">De onde veio este registro?</h2>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setGo(id.trim()); }}>
        <Select aria-label="Entidade" className="w-44" value={entity} onChange={(e) => setEntity(e.target.value)}><option value="conta">Conta</option><option value="pessoa">Pessoa</option><option value="oportunidade">Oportunidade</option><option value="tarefa">Tarefa</option><option value="anotacao">Anotação</option></Select>
        <Input aria-label="ID no ISP Sprint" className="w-96" placeholder="ID do registro no ISP Sprint" value={id} onChange={(e) => setId(e.target.value)} /><Button type="submit">Rastrear</Button>
      </form>
      {q.data && (!q.data.links.length ? <p className="text-sm text-muted">Este registro não veio de importação.</p> : (
        <div className="space-y-2 text-sm">{q.data.links.map((l) => <p key={l.sourceId}>Origem: <b>{IMPORT_SOURCE_LABELS[l.source as keyof typeof IMPORT_SOURCE_LABELS] ?? l.source}</b> · {l.sourceEntity} {l.sourceId} · importado em {fmtDateTime(l.importedAt)}</p>)}
          {q.data.history.map((h, i) => <details key={i} className="rounded-md border border-line p-2"><summary className="cursor-pointer">Execução #{h.run} · {fmtDateTime(h.at)} · {h.action}</summary><div className="mt-2 grid gap-2 md:grid-cols-2"><pre className="max-h-64 overflow-auto bg-surface-2 p-2 text-[11px]">{JSON.stringify(h.original, null, 2)}</pre><pre className="max-h-64 overflow-auto bg-surface-2 p-2 text-[11px]">{JSON.stringify(h.values, null, 2)}</pre></div></details>)}
        </div>
      ))}
    </section>
  );
}

/** Atalho principal: enviar uma planilha (Excel ou CSV). Usa (ou cria) o conector "Planilhas" e abre o assistente já com o modelo sugerido. */
function SheetImportButton({ onDone }: { onDone: (connectorId: string) => void }) {
  const conns = useConnectors();
  const toast = useToast();
  const [target, setTarget] = useState<string | null>(null);
  const prep = useMutation({
    mutationFn: async () => {
      const existing = conns.data?.items.find((c) => c.kind === 'csv' && !c.archived);
      if (existing) return existing.id;
      return (await api<{ id: string }>('/admin/import/connectors', { method: 'POST', body: { kind: 'csv', name: 'Planilhas' } })).id;
    },
    onSuccess: (id) => setTarget(id), onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (!conns.data) return null;
  if (!conns.data.can.conectores) return <p className="text-sm text-muted">Enviar planilhas é feito pela Diretoria ou pela Administração.</p>;
  return (<>
    <Button variant="primary" icon={<FileUp className="h-4 w-4" />} loading={prep.isPending} onClick={() => prep.mutate()}>Importar planilha (Excel ou CSV)</Button>
    {target && <UploadFiles connectorId={target} onClose={() => setTarget(null)} onDone={() => { const id = target; setTarget(null); onDone(id); }} />}
  </>);
}

export function ImportEnginePage() {
  const [s, set] = useUrlState({ aba: 'painel', modelo: '', conector: '' });
  const tabs = [{ key: 'painel', label: 'Painel geral' }, { key: 'modelos', label: 'Modelos de importação' }, { key: 'nova', label: 'Nova importação' }, { key: 'conectores', label: 'Conectores' }, { key: 'historico', label: 'Histórico e auditoria' }] as const;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="max-w-3xl flex-1 text-sm text-muted">Importa dados de outros sistemas (planilhas exportadas do RD Station, CSV ou a API do RD) com modelos salvos e versionados. Nada é gravado sem simulação, e cada registro importado aponta para o original.</p>
        <SheetImportButton onDone={(id) => set({ aba: 'nova', modelo: '', conector: id })} />
      </div>
      <Tabs label="Data Import Engine" tabs={[...tabs]} value={s.aba as (typeof tabs)[number]['key']} onChange={(k) => set({ aba: k, modelo: '', conector: '' })} />
      {s.aba === 'painel' && <Panel />}
      {s.aba === 'modelos' && <Templates onUse={(id) => set({ aba: 'nova', modelo: id })} />}
      {s.aba === 'nova' && <NewImport key={`${s.modelo}|${s.conector}`} initialTemplateId={s.modelo || undefined} initialConnectorId={s.conector || undefined} />}
      {s.aba === 'conectores' && <Connectors />}
      {s.aba === 'historico' && <History />}
    </div>
  );
}

// ------------------------------------------------------------------ modelo
type TemplateFull = { can: Caps; template: { id: string; name: string; description: string | null; source: string; connectorId: string | null; currentVersionId: string | null; archived: boolean }; versions: { id: string; number: string; status: 'rascunho' | 'aprovada' | 'substituida'; justification: string; author: string | null; createdAt: string; approvedBy: string | null; approvedAt: string | null; locked: boolean; rowVersion: number; config: ImportConfig; mine: boolean }[]; runs: RunSummary[] };

export function ImportTemplatePage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['import', 'template', id], queryFn: () => api<TemplateFull>(`/admin/import/templates/${id}`) });
  const [sel, setSel] = useState<string | null>(null);
  const [cmp, setCmp] = useState<{ a: string; b: string } | null>(null);
  const [draft, setDraft] = useState<ImportConfig | null>(null);
  const [newVer, setNewVer] = useState<{ base: string; config: ImportConfig; justification: string; major: boolean } | null>(null);
  const diff = useQuery({ queryKey: ['import', 'compare', cmp?.a, cmp?.b], enabled: !!cmp, queryFn: () => api<{ before: { number: string }; after: { number: string }; changes: ConfigChange[] }>(`/admin/import/versions/${cmp!.b}/compare?with=${cmp!.a}`) });
  const inv = () => qc.invalidateQueries({ queryKey: ['import'] });
  const approve = useMutation({ mutationFn: (vid: string) => api(`/admin/import/versions/${vid}/approve`, { method: 'POST' }), onSuccess: () => { void inv(); toast({ tone: 'success', message: 'Versão aprovada: é a atual do modelo' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const saveDraft = useMutation({ mutationFn: (v: TemplateFull['versions'][number]) => api(`/admin/import/versions/${v.id}`, { method: 'PUT', body: { config: draft, justification: v.justification, rowVersion: v.rowVersion } }), onSuccess: () => { setDraft(null); void inv(); toast({ tone: 'success', message: 'Rascunho salvo' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const createVer = useMutation({ mutationFn: () => api<{ number: string }>(`/admin/import/templates/${id}/versions`, { method: 'POST', body: { config: newVer!.config, justification: newVer!.justification, major: newVer!.major, basedOnVersionId: newVer!.base } }), onSuccess: (r) => { setNewVer(null); void inv(); toast({ tone: 'success', message: `Versão ${r.number} criada` }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const v = d.versions.find((x) => x.id === (sel ?? d.template.currentVersionId)) ?? d.versions[0]!;
  const editable = v.status === 'rascunho' && !v.locked && d.can.modelos;
  return (
    <div className="space-y-5">
      <Link to="/settings/importacao?aba=modelos" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ChevronLeft className="h-4 w-4" />Modelos</Link>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1"><h2 className="text-2xl font-bold text-ink">{d.template.name}</h2>{d.template.description && <p className="text-sm text-text">{d.template.description}</p>}</div>
        {!d.template.archived && <Button variant="primary" onClick={() => nav(`/settings/importacao?aba=nova&modelo=${id}`)}>Utilizar</Button>}
      </div>
      <section aria-label="Versões" className="card p-4">
        <h3 className="mb-2 font-bold text-ink">Versões</h3>
        <table className="w-full text-left text-sm"><thead className="text-xs text-muted"><tr><th className="py-1 font-medium">Versão</th><th className="font-medium">Situação</th><th className="font-medium">Justificativa</th><th className="font-medium">Autor</th><th className="font-medium">Aprovação</th><th /></tr></thead>
          <tbody>{d.versions.map((x, i) => (
            <tr key={x.id} className={clsx('border-t border-line align-top', x.id === v.id && 'bg-primary-soft/40')}>
              <td className="py-2"><button type="button" className="link num font-semibold" onClick={() => { setSel(x.id); setDraft(null); }}>v{x.number}</button>{x.id === d.template.currentVersionId && <Chip tone="green" className="ml-1">atual</Chip>}</td>
              <td>{x.status}{x.locked && <span className="block text-[11px] text-muted">usada em execução (travada)</span>}</td>
              <td className="max-w-xs text-xs">{x.justification}</td><td className="text-xs">{x.author}<span className="block text-muted">{fmtDateTime(x.createdAt)}</span></td>
              <td className="text-xs">{x.approvedBy ? `${x.approvedBy} · ${fmtDateTime(x.approvedAt!)}` : '—'}</td>
              <td className="space-x-1 whitespace-nowrap text-right">
                {x.status === 'rascunho' && d.can.aprovar_versao && <Button size="sm" icon={<ShieldCheck className="h-4 w-4" />} loading={approve.isPending && approve.variables === x.id} onClick={() => approve.mutate(x.id)}>Aprovar</Button>}
                {d.versions[i + 1] && <Button size="sm" variant="ghost" icon={<GitCompare className="h-4 w-4" />} onClick={() => setCmp({ a: d.versions[i + 1]!.id, b: x.id })}>Comparar com v{d.versions[i + 1]!.number}</Button>}
                {d.can.modelos && <Button size="sm" variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setNewVer({ base: x.id, config: structuredClone(x.config), justification: i === 0 ? '' : `Restaura a configuração da v${x.number}`, major: false })}>{i === 0 ? 'Nova versão' : 'Restaurar como nova versão'}</Button>}
              </td>
            </tr>
          ))}</tbody></table>
      </section>
      {cmp && (
        <section aria-label="Comparação" className="card p-4">
          <div className="mb-2 flex items-center gap-2"><h3 className="font-bold text-ink">Comparação {diff.data ? `v${diff.data.before.number} → v${diff.data.after.number}` : ''}</h3><button type="button" className="ml-auto text-sm text-muted" onClick={() => setCmp(null)}>Fechar</button></div>
          {diff.isLoading ? <LoadingRows rows={3} /> : !diff.data?.changes.length ? <p className="text-sm text-muted">Sem diferenças.</p> : <ul className="space-y-1 text-sm">{diff.data.changes.map((c, i) => <li key={i} className="rounded-sm border border-line p-2"><b>{c.path}</b> <Chip tone={c.kind === 'adicionado' ? 'green' : c.kind === 'removido' ? 'red' : 'yellow'}>{c.kind}</Chip>{c.before && <pre className="mt-1 whitespace-pre-wrap break-all bg-danger-soft/40 p-1 text-[11px]">{c.before}</pre>}{c.after && <pre className="mt-1 whitespace-pre-wrap break-all bg-success-soft/40 p-1 text-[11px]">{c.after}</pre>}</li>)}</ul>}
        </section>
      )}
      <section aria-label={`Configuração v${v.number}`} className="card space-y-3 p-4">
        <div className="flex items-center gap-2"><h3 className="font-bold text-ink">Configuração da v{v.number}</h3>
          {editable && !draft && <Button size="sm" className="ml-auto" onClick={() => setDraft(structuredClone(v.config))}>Editar rascunho</Button>}
          {draft && <span className="ml-auto flex gap-2"><Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Descartar</Button><Button size="sm" variant="primary" loading={saveDraft.isPending} onClick={() => saveDraft.mutate(v)}>Salvar rascunho</Button></span>}
        </div>
        {!editable && <p className="text-xs text-muted">Versão {v.status === 'rascunho' ? 'travada' : v.status}: para mudar, crie uma nova versão.</p>}
        <MappingEditor config={draft ?? v.config} onChange={setDraft} connectorId={d.template.connectorId} readOnly={!draft} />
      </section>
      <section aria-label="Execuções do modelo" className="card p-4"><h3 className="mb-2 font-bold text-ink">Execuções</h3><RunsTable runs={d.runs} /></section>
      <Modal open={!!newVer} onClose={() => setNewVer(null)} size="lg" title="Nova versão do modelo" footer={<><Button onClick={() => setNewVer(null)}>Cancelar</Button><Button variant="primary" loading={createVer.isPending} disabled={(newVer?.justification.trim().length ?? 0) < 5} onClick={() => createVer.mutate()}>Criar versão</Button></>}>
        {newVer && <div className="space-y-3">
          <FormField label="Justificativa" htmlFor="nv-j" required><Textarea id="nv-j" rows={2} value={newVer.justification} onChange={(e) => setNewVer({ ...newVer, justification: e.target.value })} /></FormField>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={newVer.major} onChange={(e) => setNewVer({ ...newVer, major: e.target.checked })} />Reestruturação (sobe a versão principal, ex.: 1.2 → 2.0)</label>
          <p className="text-xs text-muted">A versão nasce em rascunho; você pode ajustar o mapeamento depois em "Editar rascunho". Só versões aprovadas valem para importar (sem alterações temporárias).</p>
        </div>}
      </Modal>
    </div>
  );
}

export function ImportRunPage() {
  const { id = '' } = useParams();
  return (
    <div className="space-y-4">
      <Link to="/settings/importacao?aba=historico" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ChevronLeft className="h-4 w-4" />Histórico</Link>
      <RunPanel runId={id} />
    </div>
  );
}
