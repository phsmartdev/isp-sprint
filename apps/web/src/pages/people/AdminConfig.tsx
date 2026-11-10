/**
 * Configurações do módulo: quais setores da empresa exercem cada papel (sem novo cadastro de permissões)
 * e os limites de envio. Nível "Total" no módulo (Segurança) também administra.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useSectors } from '../../lib/hooks';
import { Button, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import { usePeopleMe } from './shared';

type Settings = { roles: { comunicacao: string[]; pessoasCultura: string[]; moderacao: string[] }; limits: { imageMb: number; videoMb: number; mediaPerPost: number; postChars: number } };
const ROLES: { key: keyof Settings['roles']; label: string; desc: string }[] = [
  { key: 'pessoasCultura', label: 'Pessoas e Cultura', desc: 'Categorias de reconhecimento, comunidades institucionais, indicadores agregados e estes parâmetros.' },
  { key: 'comunicacao', label: 'Comunicação Interna', desc: 'Comunicados oficiais e publicações em nome da empresa.' },
  { key: 'moderacao', label: 'Moderação', desc: 'Análise e decisão sobre denúncias.' },
];

export function PeopleConfigPage() {
  const me = usePeopleMe();
  const q = useQuery({ queryKey: ['pessoas', 'config'], enabled: !!me.data?.caps.configure, queryFn: () => api<{ settings: Settings; updatedAt: string | null; updatedBy: string | null }>('/pessoas/config') });
  const sectors = useSectors();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<Settings | null>(null);
  useEffect(() => { if (q.data && !f) setF(q.data.settings); }, [q.data, f]);
  const save = useMutation({
    mutationFn: () => api('/pessoas/config', { method: 'PUT', body: f }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pessoas'] }); toast({ tone: 'success', message: 'Configurações salvas' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (me.data && !me.data.caps.configure) return <div className="card"><EmptyState title="Sem acesso" description="Só a administração do módulo ou do sistema altera estas configurações." /></div>;
  if (q.isLoading || me.isLoading || !f) return q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <div className="card"><LoadingRows rows={6} /></div>;
  const toggle = (role: keyof Settings['roles'], key: string) => setF({ ...f, roles: { ...f.roles, [role]: f.roles[role].includes(key) ? f.roles[role].filter((x) => x !== key) : [...f.roles[role], key] } });
  const lim = (k: keyof Settings['limits'], v: string) => setF({ ...f, limits: { ...f.limits, [k]: Number(v) || 0 } });
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <section className="card p-5" aria-label="Papéis do módulo">
        <h2 className="text-md font-bold text-ink">Papéis do módulo</h2>
        <p className="mb-3 text-sm text-muted">Marque os setores da empresa (definidos no cadastro de cada usuário) que exercem cada papel. Quem tem nível Total em Pessoas & Cultura (Configurações → Segurança) também administra. Nenhum papel dá acesso a conteúdo privado de comunidades.</p>
        {!sectors.items.length ? <Notice tone="warning">Nenhum setor cadastrado. Crie os setores em Configurações e associe às pessoas.</Notice> : (
          <div className="grid gap-4 lg:grid-cols-3">
            {ROLES.map((r) => (
              <fieldset key={r.key} className="border border-line p-3">
                <legend className="px-1 text-sm font-semibold text-ink">{r.label}</legend>
                <p className="mb-2 text-xs text-muted">{r.desc}</p>
                <div className="space-y-1">{sectors.items.map((s) => (
                  <label key={s.key} className="flex items-center gap-2 text-sm text-text"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.roles[r.key].includes(s.key)} onChange={() => toggle(r.key, s.key)} />{s.label}</label>
                ))}</div>
              </fieldset>
            ))}
          </div>
        )}
      </section>
      <section className="card p-5" aria-label="Limites de envio">
        <h2 className="mb-3 text-md font-bold text-ink">Limites de publicações</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="Imagem (MB)" htmlFor="pl-img" hint="1 a 10"><Input id="pl-img" type="number" min={1} max={10} value={f.limits.imageMb} onChange={(e) => lim('imageMb', e.target.value)} /></FormField>
          <FormField label="Vídeo (MB)" htmlFor="pl-vid" hint="1 a 50"><Input id="pl-vid" type="number" min={1} max={50} value={f.limits.videoMb} onChange={(e) => lim('videoMb', e.target.value)} /></FormField>
          <FormField label="Mídias por publicação" htmlFor="pl-n" hint="1 a 10"><Input id="pl-n" type="number" min={1} max={10} value={f.limits.mediaPerPost} onChange={(e) => lim('mediaPerPost', e.target.value)} /></FormField>
          <FormField label="Caracteres por publicação" htmlFor="pl-c" hint="100 a 5.000"><Input id="pl-c" type="number" min={100} max={5000} value={f.limits.postChars} onChange={(e) => lim('postChars', e.target.value)} /></FormField>
        </div>
      </section>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {q.data?.updatedAt && <span className="text-xs text-muted">Última alteração: {fmtDateTime(q.data.updatedAt)}{q.data.updatedBy ? ` por ${q.data.updatedBy}` : ''}</span>}
        <Button type="submit" variant="primary" loading={save.isPending}>Salvar configurações</Button>
      </div>
    </form>
  );
}
