/**
 * Assistente de importação: modelo → origem → escopo → registros → mapeamento → validação → simulação → revisão →
 * aprovação → execução → conferência. Voltar entre etapas não perde nada. O modelo salvo nunca muda sem uma ação
 * explícita (salvar como novo modelo ou criar nova versão); mudanças só desta execução ficam registradas como temporárias.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Search } from 'lucide-react';
import { DEFAULT_EXECUTION, SCOPE_LABELS, IMPORT_SOURCE_LABELS, type ImportConfig, type ImportScope, type Issue } from '@isp/domain';
import { api } from '../../lib/api';
import { Button, Chip, FormField, Input, LoadingRows, Notice, Select } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';
import { MappingEditor } from './MappingEditor';
import { RunPanel, type RunDetail } from './RunPanel';
import { scopeText, useConnectors, useImportSchema, type RefOpt } from './shared';

type TemplateItem = { id: string; name: string; source: string; connectorId: string | null; current: { id: string; number: string } | null; latest: { id: string; number: string; status: string } | null; archived: boolean };
type TemplateFull = { template: { id: string; name: string; connectorId: string | null; currentVersionId: string | null }; versions: { id: string; number: string; status: string; config: ImportConfig }[] };
const STEPS = ['Modelo', 'Origem', 'Escopo', 'Registros', 'Mapeamento', 'Validação', 'Simulação', 'Revisão', 'Aprovação', 'Execução', 'Conferência'];
const EMPTY_PERSONAL: Extract<ImportScope, { mode: 'personalizado' }> = { mode: 'personalizado', accountIds: [], opportunityIds: [], ownerIds: [], pipelineIds: [], stageIds: [], status: [], createdFrom: null, createdTo: null, closedFrom: null, closedTo: null, imported: 'todos' };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function Picker({ connectorId, kind, accountId, label, onPick, picked }: { connectorId: string; kind: 'conta' | 'oportunidade'; accountId?: string; label: string; onPick: (o: RefOpt & { importedAs?: string | null }) => void; picked: string[] }) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const r = useQuery({ queryKey: ['import', 'search', connectorId, kind, accountId, term], queryFn: () => api<{ items: (RefOpt & { importedAs: string | null })[] }>(`/admin/import/connectors/${connectorId}/search?kind=${kind}&q=${encodeURIComponent(term)}${accountId ? `&accountId=${accountId}` : ''}`), retry: false });
  return (
    <div className="space-y-2">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setTerm(q); }}><Input aria-label={label} placeholder={label} value={q} onChange={(e) => setQ(e.target.value)} /><Button type="submit" icon={<Search className="h-4 w-4" />}>Buscar</Button></form>
      {r.isLoading ? <LoadingRows rows={3} /> : r.isError ? <p className="text-sm text-danger">{errMsg(r.error)}</p> : (
        <ul className="max-h-64 overflow-auto rounded-md border border-line bg-surface text-sm" aria-label={`Resultados: ${label}`}>
          {!r.data!.items.length && <li className="px-3 py-2 text-muted">Nada encontrado.</li>}
          {r.data!.items.map((o) => (
            <li key={o.id}><button type="button" onClick={() => onPick(o)} aria-pressed={picked.includes(o.id)} className={clsx('flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left', picked.includes(o.id) ? 'bg-primary-soft' : 'hover:bg-surface-2')}>
              {picked.includes(o.id) && <Check className="h-4 w-4 text-primary" aria-hidden />}<span className="flex-1">{o.label}{o.sub && <span className="ml-2 text-xs text-muted">{o.sub}</span>}</span>
              {o.importedAs && <Chip tone="green">Já importado</Chip>}<span className="text-[11px] text-muted">{o.id}</span>
            </button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NewImport({ initialTemplateId, initialConnectorId }: { initialTemplateId?: string; initialConnectorId?: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const schema = useImportSchema();
  const conns = useConnectors();
  const tpls = useQuery({ queryKey: ['import', 'templates'], queryFn: () => api<{ items: TemplateItem[] }>('/admin/import/templates') });
  const [step, setStep] = useState(initialConnectorId ? 2 : 0);
  const [useSaved, setUseSaved] = useState(!initialConnectorId);
  const [templateId, setTemplateId] = useState(initialTemplateId ?? '');
  const [versionId, setVersionId] = useState('');
  const full = useQuery({ queryKey: ['import', 'template', templateId], enabled: !!templateId && useSaved, queryFn: () => api<TemplateFull>(`/admin/import/templates/${templateId}`) });
  const [connectorId, setConnectorId] = useState(initialConnectorId ?? '');
  const [scope, setScope] = useState<ImportScope>({ mode: 'uma_oportunidade', accountId: '', opportunityId: '' });
  const [config, setConfig] = useState<ImportConfig | null>(null);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [simId, setSimId] = useState<string | null>(null);
  const [impId, setImpId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [acceptErrors, setAcceptErrors] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [justif, setJustif] = useState('');
  const version = full.data?.versions.find((v) => v.id === versionId);
  useEffect(() => { if (full.data && !versionId) { const v = full.data.versions.find((x) => x.id === full.data!.template.currentVersionId) ?? full.data.versions[0]; if (v) { setVersionId(v.id); setConfig(structuredClone(v.config)); } if (full.data.template.connectorId && !connectorId) setConnectorId(full.data.template.connectorId); } }, [full.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const conn = conns.data?.items.find((c) => c.id === connectorId);
  // começou pelo envio de uma planilha: o modelo sugerido (ex.: exportação do RD) já vem montado
  const auto = useQuery({ queryKey: ['import', 'auto-suggest', initialConnectorId], enabled: !!initialConnectorId, queryFn: () => api<ImportConfig>('/admin/import/templates/suggest', { method: 'POST', body: { connectorId: initialConnectorId } }), staleTime: Infinity, retry: false });
  useEffect(() => { if (auto.data && !config) { setConfig(auto.data); setScope({ mode: 'base_completa' }); } }, [auto.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = !!config && (!version || !same(config, version.config));
  const sim = useQuery({ queryKey: ['import', 'run', simId], enabled: !!simId, queryFn: () => api<RunDetail>(`/admin/import/runs/${simId}`), refetchInterval: (q) => (q.state.data && ['na_fila', 'em_andamento'].includes(q.state.data.run.status) ? 2000 : false) });
  const simDone = !!sim.data && ['concluida', 'concluida_com_pendencias'].includes(sim.data.run.status);
  // qualquer mudança de configuração ou escopo invalida a simulação
  const simKey = useMemo(() => JSON.stringify({ config, scope, connectorId, versionId }), [config, scope, connectorId, versionId]);
  const [simFor, setSimFor] = useState('');
  useEffect(() => { if (simId && simFor && simFor !== simKey) { setSimId(null); setIssues(null); } }, [simKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const check = useMutation({ mutationFn: () => api<{ issues: Issue[]; checkedSource: boolean }>('/admin/import/check', { method: 'POST', body: { config, connectorId } }), onSuccess: (r) => setIssues(r.issues), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const startSim = useMutation({ mutationFn: () => api<{ id: string }>('/admin/import/runs', { method: 'POST', body: { mode: 'simulacao', connectorId, scope, templateVersionId: useSaved ? versionId || null : null, config: changed || !useSaved ? config : null } }), onSuccess: (r) => { setSimId(r.id); setSimFor(simKey); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const startImp = useMutation({ mutationFn: () => api<{ id: string }>('/admin/import/runs', { method: 'POST', body: { mode: 'importacao', connectorId, scope, templateVersionId: useSaved ? versionId || null : null, config: changed || !useSaved ? config : null, simulationRunId: simId, confirm, acceptErrors } }), onSuccess: (r) => { setImpId(r.id); setStep(9); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const saveNew = useMutation({ mutationFn: () => api<{ id: string; versionId: string }>('/admin/import/templates', { method: 'POST', body: { name: saveName, connectorId, config, justification: justif || 'Mapeamento inicial' } }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['import'] }); toast({ tone: 'success', message: 'Modelo salvo (versão 1.0 em rascunho, aguardando aprovação)' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const saveVersion = useMutation({ mutationFn: () => api<{ id: string; number: string }>(`/admin/import/templates/${templateId}/versions`, { method: 'POST', body: { config, justification: justif, basedOnVersionId: versionId || null } }), onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['import'] }); toast({ tone: 'success', message: `Versão ${r.number} criada; vale para importações depois de aprovada` }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });

  if (schema.isLoading || conns.isLoading || tpls.isLoading || (initialConnectorId && auto.isLoading)) return <LoadingRows rows={6} />;
  const can = schema.data!.can;
  const errors = issues?.filter((i) => i.level === 'erro') ?? [];
  const scopeOk = scope.mode === 'base_completa' || (scope.mode === 'uma_conta' && !!scope.accountId) || (scope.mode === 'uma_oportunidade' && !!scope.accountId && !!scope.opportunityId) || scope.mode === 'personalizado';
  const ready = [
    useSaved ? !!versionId && !!config : !!config,
    !!connectorId && (!config || conn?.kind === config.source),
    true, scopeOk, !!config && config.entities.some((e) => e.enabled), !!issues && !errors.length, simDone, simDone, true, !!impId, !!impId,
  ];
  const go = (i: number) => { if (i <= step || ready.slice(0, i).every(Boolean)) setStep(i); };
  return (
    <div className="space-y-5">
      <ol className="scroll-thin flex gap-1 overflow-x-auto pb-1" aria-label="Etapas da importação">
        {STEPS.map((s, i) => (
          <li key={s}><button type="button" onClick={() => go(i)} aria-current={step === i ? 'step' : undefined} className={clsx('flex items-center gap-1.5 whitespace-nowrap rounded-sm border px-2.5 py-1.5 text-xs font-semibold', step === i ? 'border-primary bg-primary text-white' : i < step && ready[i] ? 'border-primary/30 bg-primary-soft text-primary' : 'border-line text-muted')}>
            <span className="num">{i + 1}</span>{s}
          </button></li>
        ))}
      </ol>

      {step === 0 && (
        <section aria-label="Modelo" className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Como começar">
            {[[true, 'Utilizar modelo salvo', 'Carrega todas as regras do modelo; dá para ajustar só esta execução.'], [false, 'Criar nova configuração', 'Começa do zero (com sugestões lidas da origem).']].map(([v, l, d]) => (
              <label key={String(v)} className={clsx('flex cursor-pointer gap-3 rounded-md border p-4', useSaved === v ? 'border-primary bg-primary-soft' : 'border-line bg-surface')}><input type="radio" name="start" className="mt-1 accent-primary" checked={useSaved === v} onChange={() => { setUseSaved(v as boolean); setConfig(v ? (version ? structuredClone(version.config) : null) : { source: conn?.kind ?? 'rdstation_crm', timezone: 'America/Sao_Paulo', entities: [], tables: [], execution: DEFAULT_EXECUTION }); }} /><span><b className="block text-ink">{l as string}</b><span className="text-sm text-muted">{d as string}</span></span></label>
            ))}
          </div>
          {useSaved && (
            <div className="grid gap-3 md:grid-cols-2">
              <FormField label="Modelo" htmlFor="ni-t"><Select id="ni-t" value={templateId} onChange={(e) => { setTemplateId(e.target.value); setVersionId(''); setConfig(null); }}><option value="">Escolha</option>{tpls.data!.items.filter((t) => !t.archived).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></FormField>
              {full.data && <FormField label="Versão" htmlFor="ni-v" hint={version?.status !== 'aprovada' ? 'Versão não aprovada: simula, mas só importa como alteração temporária.' : undefined}><Select id="ni-v" value={versionId} onChange={(e) => { setVersionId(e.target.value); const v = full.data!.versions.find((x) => x.id === e.target.value); if (v) setConfig(structuredClone(v.config)); }}>{full.data.versions.map((v) => <option key={v.id} value={v.id}>v{v.number} · {v.status}</option>)}</Select></FormField>}
              {!tpls.data!.items.length && <Notice>Nenhum modelo salvo ainda. Crie uma nova configuração.</Notice>}
            </div>
          )}
        </section>
      )}

      {step === 1 && (
        <section aria-label="Origem" className="space-y-3">
          <FormField label="Conector" htmlFor="ni-c"><Select id="ni-c" value={connectorId} onChange={(e) => { setConnectorId(e.target.value); const c = conns.data!.items.find((x) => x.id === e.target.value); if (c && config && !useSaved && !config.entities.length) setConfig({ ...config, source: c.kind }); }}><option value="">Escolha</option>{conns.data!.items.filter((c) => !c.archived && (!config || !config.entities.length || c.kind === config.source)).map((c) => <option key={c.id} value={c.id}>{c.name} ({IMPORT_SOURCE_LABELS[c.kind]})</option>)}</Select></FormField>
          {conn && <p className="text-sm text-text">Situação: {conn.status === 'ok' ? 'conexão testada' : conn.status === 'falhou' ? `último teste falhou (${conn.lastTestResult})` : 'ainda não testada'}. Credenciais ficam só no conector.</p>}
          {!conns.data!.items.length && <Notice>Cadastre um conector na aba Conectores.</Notice>}
        </section>
      )}

      {step === 2 && (
        <section aria-label="Escopo" className="grid gap-3 md:grid-cols-2" role="radiogroup">
          {(Object.keys(SCOPE_LABELS) as ImportScope['mode'][]).map((m) => (
            <label key={m} className={clsx('flex cursor-pointer gap-3 rounded-md border p-4', scope.mode === m ? 'border-primary bg-primary-soft' : 'border-line bg-surface')}>
              <input type="radio" name="scope" className="mt-1 accent-primary" checked={scope.mode === m} onChange={() => setScope(m === 'uma_oportunidade' ? { mode: m, accountId: '', opportunityId: '' } : m === 'uma_conta' ? { mode: m, accountId: '' } : m === 'base_completa' ? { mode: m } : EMPTY_PERSONAL)} />
              <span><b className="block text-ink">{SCOPE_LABELS[m]}</b><span className="text-sm text-muted">{{ uma_oportunidade: 'A empresa, a oportunidade escolhida e o que ela precisa (contatos, tarefas, anotações). Nenhuma outra oportunidade.', uma_conta: 'A empresa, todas as oportunidades dela e os históricos.', base_completa: 'Toda a base, em lotes. Acima do limite de grande volume pede autorização.', personalizado: 'Filtros combinados: contas, oportunidades, responsáveis, funis, etapas, situação, datas e o que já foi importado.' }[m]}</span></span>
            </label>
          ))}
        </section>
      )}

      {step === 3 && conn && (
        <section aria-label="Registros" className="space-y-4">
          {(scope.mode === 'uma_oportunidade' || scope.mode === 'uma_conta') && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div><p className="mb-1 text-sm font-semibold">Empresa {scope.accountId && <Chip tone="blue">{scope.accountId}</Chip>}</p><Picker connectorId={conn.id} kind="conta" label="Buscar empresa na origem" picked={[scope.accountId]} onPick={(o) => setScope(scope.mode === 'uma_oportunidade' ? { ...scope, accountId: o.id, opportunityId: '' } : { ...scope, accountId: o.id })} /></div>
              {scope.mode === 'uma_oportunidade' && scope.accountId && <div><p className="mb-1 text-sm font-semibold">Oportunidade {scope.opportunityId && <Chip tone="blue">{scope.opportunityId}</Chip>}</p><Picker connectorId={conn.id} kind="oportunidade" accountId={scope.accountId} label="Oportunidades desta empresa" picked={[scope.opportunityId]} onPick={(o) => setScope({ ...scope, opportunityId: o.id })} /></div>}
            </div>
          )}
          {scope.mode === 'base_completa' && <Notice>Toda a base da origem. As negociações são buscadas etapa por etapa (a API do RD Station lista só 10 mil por filtro). A conferência exata da seleção sai na simulação.</Notice>}
          {scope.mode === 'personalizado' && <PersonalScope connectorId={conn.id} scope={scope} set={setScope} />}
          <p className="rounded-md border border-line bg-surface p-3 text-sm"><b>Conferência:</b> {scopeText(scope)}. Dependências (empresa, contatos, tarefas e anotações das oportunidades) entram automaticamente e aparecem, com o motivo, na simulação.</p>
        </section>
      )}

      {step === 4 && config && (
        <section aria-label="Mapeamento" className="space-y-3">
          {useSaved && changed && <Notice tone="warning">Você mudou o modelo nesta execução. Na aprovação, escolha: executar com as alterações temporárias, salvar como novo modelo ou criar uma nova versão.</Notice>}
          <MappingEditor config={config} onChange={setConfig} connectorId={connectorId || null} readOnly={!can.modelos && !can.simular} />
        </section>
      )}

      {step === 5 && (
        <section aria-label="Validação" className="space-y-3">
          <Button loading={check.isPending} onClick={() => check.mutate()}>Validar correspondências</Button>
          {issues && (issues.length ? <ul className="space-y-1 text-sm">{issues.map((i, k) => <li key={k} className={clsx('rounded-sm px-2 py-1', i.level === 'erro' ? 'bg-danger-soft text-danger' : 'bg-[#FFF6D6] text-[#9A6B00]')}>{i.level === 'erro' ? 'Erro' : 'Revisar'}: {i.message}</li>)}</ul> : <Notice>Sem pendências: destino e origem conferidos.</Notice>)}
          {!!errors.length && <p className="text-sm text-muted">Corrija os erros no mapeamento para simular.</p>}
        </section>
      )}

      {step === 6 && (
        <section aria-label="Simulação" className="space-y-3">
          {!simId ? <><p className="text-sm text-text">A simulação busca os registros reais, aplica o modelo e mostra o que seria criado, atualizado, ignorado ou revisado. Ela não grava nada no CRM.</p><Button variant="primary" disabled={!can.simular} loading={startSim.isPending} onClick={() => startSim.mutate()}>Simular</Button></> : <RunPanel runId={simId} />}
        </section>
      )}

      {step === 7 && simId && (
        <section aria-label="Revisão" className="space-y-3">
          <p className="text-sm text-text">Filtre por <b>Revisar</b> e <b>Erro</b>. Para cada registro em revisão, decida (importar assim mesmo, vincular ao existente, sobrescrever ou não importar). Erros nunca são gravados: corrija o mapeamento e simule de novo, ou deixe-os de fora.</p>
          <RunPanel runId={simId} autoDrive={false} />
        </section>
      )}

      {step === 8 && sim.data && (
        <section aria-label="Aprovação" className="space-y-4">
          <div className="rounded-md border border-line bg-surface p-4 text-sm">
            <p><b>Escopo:</b> {scopeText(scope)}</p>
            <p><b>Modelo:</b> {useSaved && version ? `${full.data?.template.name} v${version.number}${changed ? ' com alterações temporárias' : ''}` : 'Configuração nova (ainda não salva)'}</p>
            <p><b>Simulação #{sim.data.run.code}:</b> {sim.data.run.counters.criados} a criar, {sim.data.run.counters.atualizados} a atualizar, {sim.data.run.counters.ignorados} ignorados, {sim.data.run.counters.revisar} em revisão, {sim.data.run.counters.erros} com erro.</p>
          </div>
          {(changed || !useSaved) && can.modelos && (
            <div className="space-y-2 rounded-md border border-line p-4">
              <p className="text-sm font-semibold text-ink">Guardar estas regras (opcional)</p>
              <div className="grid gap-2 md:grid-cols-2">
                <FormField label="Justificativa" htmlFor="ap-j"><Input id="ap-j" value={justif} onChange={(e) => setJustif(e.target.value)} placeholder="O que mudou e por quê" /></FormField>
                <FormField label="Nome do novo modelo" htmlFor="ap-n"><Input id="ap-n" value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="RD Station → ISP Sprint | …" /></FormField>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={saveName.trim().length < 3} loading={saveNew.isPending} onClick={() => saveNew.mutate()}>Salvar como novo modelo</Button>
                {useSaved && templateId && <Button disabled={justif.trim().length < 5} loading={saveVersion.isPending} onClick={() => saveVersion.mutate()}>Criar nova versão do modelo</Button>}
              </div>
              <p className="text-xs text-muted">Salvar não muda esta execução: ela continua com as regras simuladas, registradas como alterações temporárias.</p>
            </div>
          )}
          {!can.executar ? <Notice tone="warning">A gravação definitiva é feita pela Diretoria ou pela Administração. A simulação #{sim.data.run.code} fica no histórico para eles executarem.</Notice> : (
            <div className="space-y-2 rounded-md border border-primary/40 bg-primary-soft/40 p-4">
              {sim.data.run.counters.identificados > (config?.execution.largeVolume ?? 500) && <p className="text-sm font-semibold text-[#9A4B07]">Grande volume ({sim.data.run.counters.identificados} registros): sua autorização fica registrada.</p>}
              {sim.data.run.counters.erros > 0 && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={acceptErrors} onChange={(e) => setAcceptErrors(e.target.checked)} />Entendo que os {sim.data.run.counters.erros} registro(s) com erro impeditivo ficam de fora (não são gravados).</label>}
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />Confirmo a gravação definitiva no ISP Sprint conforme a simulação.</label>
              <Button variant="primary" disabled={!confirm || (sim.data.run.counters.erros > 0 && !acceptErrors)} loading={startImp.isPending} onClick={() => startImp.mutate()}>Aprovar e executar</Button>
            </div>
          )}
        </section>
      )}

      {step >= 9 && impId && (
        <section aria-label={step === 9 ? 'Execução' : 'Conferência'} className="space-y-3">
          <RunPanel runId={impId} />
          <Link className="link text-sm" to={`/settings/importacao/execucoes/${impId}`}>Abrir a página desta execução</Link>
        </section>
      )}

      <div className="flex justify-between border-t border-line pt-4">
        <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>Voltar</Button>
        {step < 8 && <Button variant="primary" disabled={!ready[step]} onClick={() => setStep(step + 1)}>Continuar</Button>}
        {step === 9 && <Button variant="primary" disabled={!ready[9]} onClick={() => setStep(10)}>Conferir resultados</Button>}
      </div>
    </div>
  );
}

function PersonalScope({ connectorId, scope, set }: { connectorId: string; scope: Extract<ImportScope, { mode: 'personalizado' }>; set: (s: ImportScope) => void }) {
  const refs = useQuery({ queryKey: ['import', 'refs', connectorId], queryFn: async () => ({ usuario: (await api<{ items: RefOpt[] }>(`/admin/import/connectors/${connectorId}/references?kind=usuario`).catch(() => ({ items: [] }))).items, etapa: (await api<{ items: RefOpt[] }>(`/admin/import/connectors/${connectorId}/references?kind=etapa`).catch(() => ({ items: [] }))).items }), staleTime: 300_000 });
  const toggle = (k: 'accountIds' | 'opportunityIds' | 'ownerIds' | 'stageIds', id: string) => set({ ...scope, [k]: scope[k].includes(id) ? scope[k].filter((x) => x !== id) : [...scope[k], id] });
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div><p className="mb-1 text-sm font-semibold">Empresas ({scope.accountIds.length})</p><Picker connectorId={connectorId} kind="conta" label="Buscar empresas" picked={scope.accountIds} onPick={(o) => toggle('accountIds', o.id)} /></div>
        <div><p className="mb-1 text-sm font-semibold">Oportunidades ({scope.opportunityIds.length})</p><Picker connectorId={connectorId} kind="oportunidade" label="Buscar oportunidades" picked={scope.opportunityIds} onPick={(o) => toggle('opportunityIds', o.id)} /></div>
      </div>
      <p className="text-xs text-muted">Com empresas ou oportunidades escolhidas, os filtros abaixo de responsável, funil e etapa não se aplicam (a busca é pelos itens escolhidos).</p>
      {refs.isLoading ? <LoadingRows rows={2} /> : (
        <div className="grid gap-4 md:grid-cols-2">
          <fieldset><legend className="mb-1 text-sm font-semibold">Responsáveis</legend><div className="flex max-h-40 flex-wrap gap-1.5 overflow-auto">{refs.data!.usuario.map((u) => <button key={u.id} type="button" aria-pressed={scope.ownerIds.includes(u.id)} onClick={() => toggle('ownerIds', u.id)} className={clsx('border px-2 py-1 text-xs', scope.ownerIds.includes(u.id) ? 'border-primary bg-primary text-white' : 'border-line')}>{u.label}</button>)}</div></fieldset>
          <fieldset><legend className="mb-1 text-sm font-semibold">Etapas (funis)</legend><div className="flex max-h-40 flex-wrap gap-1.5 overflow-auto">{refs.data!.etapa.map((u) => <button key={u.id} type="button" aria-pressed={scope.stageIds.includes(u.id)} onClick={() => toggle('stageIds', u.id)} className={clsx('border px-2 py-1 text-xs', scope.stageIds.includes(u.id) ? 'border-primary bg-primary text-white' : 'border-line')}>{u.label}{u.sub ? ` · ${u.sub}` : ''}</button>)}</div></fieldset>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <fieldset><legend className="mb-1 text-sm font-semibold">Situação</legend><div className="flex gap-2">{(['aberta', 'ganha', 'perdida'] as const).map((st) => <label key={st} className="flex items-center gap-1 text-sm"><input type="checkbox" className="accent-primary" checked={scope.status.includes(st)} onChange={() => set({ ...scope, status: scope.status.includes(st) ? scope.status.filter((x) => x !== st) : [...scope.status, st] })} />{st}</label>)}</div></fieldset>
        <FormField label="Criadas de / até" htmlFor="ps-c"><div className="flex gap-1"><Input id="ps-c" type="date" value={scope.createdFrom ?? ''} onChange={(e) => set({ ...scope, createdFrom: e.target.value || null })} /><Input aria-label="Criadas até" type="date" value={scope.createdTo ?? ''} onChange={(e) => set({ ...scope, createdTo: e.target.value || null })} /></div></FormField>
        <FormField label="Fechadas de / até" htmlFor="ps-f"><div className="flex gap-1"><Input id="ps-f" type="date" value={scope.closedFrom ?? ''} onChange={(e) => set({ ...scope, closedFrom: e.target.value || null })} /><Input aria-label="Fechadas até" type="date" value={scope.closedTo ?? ''} onChange={(e) => set({ ...scope, closedTo: e.target.value || null })} /></div></FormField>
        <FormField label="Já importados" htmlFor="ps-i"><Select id="ps-i" value={scope.imported} onChange={(e) => set({ ...scope, imported: e.target.value as 'todos' })}><option value="todos">Todos</option><option value="nao_importados">Só os ainda não importados</option><option value="importados">Só os já importados</option></Select></FormField>
      </div>
    </div>
  );
}
