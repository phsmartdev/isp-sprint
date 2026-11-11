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

type Settings = { roles: { comunicacao: string[]; pessoasCultura: string[]; moderacao: string[] }; limits: { imageMb: number; videoMb: number; mediaPerPost: number; postChars: number }; celebrations: { dealWon: boolean; showClient: boolean; badges: boolean }; notifications: Record<string, { email: boolean; whatsapp: boolean }>; badgeBaselineAt?: string | null };
const EVENTS: [string, string][] = [['mencao', 'Menção'], ['comentario', 'Comentário na publicação'], ['resposta', 'Resposta a comentário'], ['reconhecimento', 'Reconhecimento recebido'], ['convite_comunidade', 'Convite para comunidade'], ['participacao_aprovada', 'Participação aprovada'], ['comunicado', 'Comunicado oficial'], ['comunicado_urgente', 'Comunicado urgente'], ['comunicado_pendente', 'Confirmação de leitura pendente'], ['moderacao', 'Atualização de moderação']];
type Delivery = { id: string; channel: string; status: string; detail: string | null; at: string; eventLabel: string; recipient: string };
const DST: Record<string, string> = { entregue: 'Entregue', enviado: 'Enviado', falhou: 'Falhou', nao_configurado: 'Canal não configurado', sem_contato: 'Sem contato', desativado: 'Desligado pela pessoa' };
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
        <p className="mb-3 text-sm text-muted">Marque os setores da empresa (definidos no cadastro de cada usuário) que exercem cada papel. Quem tem nível Total em Pessoas & Gestão (Configurações → Segurança) também administra. Nenhum papel dá acesso a conteúdo privado de comunidades.</p>
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
      <section className="card p-5" aria-label="Conquistas no feed">
        <h2 className="text-md font-bold text-ink">Conquistas no feed</h2>
        <p className="mb-3 text-sm text-muted">Celebrações automáticas ligadas à gamificação da ISP. Nunca mostram valores de venda: só a pessoa, os pontos e os badges.</p>
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.celebrations.dealWon} onChange={(e) => setF({ ...f, celebrations: { ...f.celebrations, dealWon: e.target.checked } })} />Publicar a conquista quando uma negociação é concluída (venda fechada)</label>
          <label className="ml-6 flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary" disabled={!f.celebrations.dealWon} checked={f.celebrations.showClient} onChange={(e) => setF({ ...f, celebrations: { ...f.celebrations, showClient: e.target.checked } })} />Mostrar o nome da conta (cliente)</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.celebrations.badges} onChange={(e) => setF({ ...f, celebrations: { ...f.celebrations, badges: e.target.checked } })} />Publicar uma celebração quando alguém conquista um badge (texto próprio de cada badge)</label>
        </div>
      </section>
      <section className="card p-5" aria-label="Canais de notificação">
        <h2 className="text-md font-bold text-ink">Canais de notificação</h2>
        <p className="mb-3 text-sm text-muted">O aviso no sistema é sempre enviado. Marque onde mais avisar por evento. E-mail e WhatsApp levam só o título e o link (nunca o conteúdo das publicações). GLPI e IXC não recebem avisos sociais. Cada pessoa pode desligar os canais dos avisos não obrigatórios.</p>
        <table className="w-full max-w-xl text-sm">
          <thead><tr className="text-left text-xs text-muted"><th className="py-1 font-semibold">Evento</th><th className="px-2 text-center font-semibold">E-mail</th><th className="px-2 text-center font-semibold">WhatsApp</th></tr></thead>
          <tbody>{EVENTS.map(([k, label]) => {
            const v = f.notifications?.[k] ?? { email: false, whatsapp: false };
            const set = (ch: 'email' | 'whatsapp', on: boolean) => setF({ ...f, notifications: { ...f.notifications, [k]: { ...v, [ch]: on } } });
            return (
              <tr key={k} className="border-t border-line"><td className="py-2 text-ink">{label}</td>
                <td className="px-2 text-center"><input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`${label}: e-mail`} checked={v.email} onChange={(e) => set('email', e.target.checked)} /></td>
                <td className="px-2 text-center"><input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`${label}: WhatsApp`} checked={v.whatsapp} onChange={(e) => set('whatsapp', e.target.checked)} /></td></tr>
            );
          })}</tbody>
        </table>
      </section>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {q.data?.updatedAt && <span className="text-xs text-muted">Última alteração: {fmtDateTime(q.data.updatedAt)}{q.data.updatedBy ? ` por ${q.data.updatedBy}` : ''}</span>}
        <Button type="submit" variant="primary" loading={save.isPending}>Salvar configurações</Button>
      </div>
      <Deliveries />
    </form>
  );
}

/** Rastreabilidade: evento, destinatário, canal, situação e resultado de cada aviso enviado. */
function Deliveries() {
  const [canal, setCanal] = useState('');
  const q = useQuery({ queryKey: ['pessoas', 'entregas', canal], queryFn: () => api<{ items: Delivery[] }>(`/pessoas/admin/entregas${canal ? `?canal=${canal}` : ''}`) });
  return (
    <section className="card p-5" aria-label="Entregas de avisos">
      <div className="mb-3 flex flex-wrap items-center gap-3"><h2 className="mr-auto text-md font-bold text-ink">Entregas de avisos</h2>
        <select aria-label="Canal" className="field-input h-9 w-40" value={canal} onChange={(e) => setCanal(e.target.value)}><option value="">Todos os canais</option><option value="interna">No sistema</option><option value="email">E-mail</option><option value="whatsapp">WhatsApp</option></select></div>
      {q.isLoading ? <LoadingRows rows={3} /> : !q.data?.items.length ? <p className="text-sm text-muted">Nenhum aviso enviado ainda.</p> : (
        <div className="scroll-thin max-h-80 overflow-auto"><table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted"><th className="py-1">Quando</th><th>Evento</th><th>Destinatário</th><th>Canal</th><th>Situação</th></tr></thead>
          <tbody>{q.data.items.map((d) => <tr key={d.id} className="border-t border-line"><td className="py-1.5 pr-2 text-muted">{fmtDateTime(d.at)}</td><td className="pr-2">{d.eventLabel}</td><td className="pr-2">{d.recipient}</td><td className="pr-2">{d.channel === 'interna' ? 'No sistema' : d.channel === 'email' ? 'E-mail' : 'WhatsApp'}</td><td title={d.detail ?? undefined} className={d.status === 'falhou' ? 'text-danger' : ''}>{DST[d.status] ?? d.status}</td></tr>)}</tbody>
        </table></div>
      )}
    </section>
  );
}
