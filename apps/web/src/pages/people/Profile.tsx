/**
 * Perfil social. Nome, foto, cargo, times, área e unidade vêm do cadastro oficial (não se editam aqui);
 * a pessoa escolhe a bio, os interesses, as competências que quer compartilhar e se mostra e-mail/telefone.
 */
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Mail, Pencil, Phone, Send } from 'lucide-react';
import { useStartConversation } from './FeedHome';
import { api } from '../../lib/api';
import { Avatar, Button, Chip, ErrorState, FormField, Input, LoadingRows, Textarea } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { Hexagons } from '../../components/brand';
import { errMsg } from '../../features/contracts/shared';
import { orgLine, usePeopleMe, type PeopleProfile } from './shared';
import { Feed } from './feed/Feed';
import { RecognitionList } from './Recognition';

const list = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter((x) => x.length >= 2);

export function ProfilePage() {
  const { userId = 'eu' } = useParams();
  const meQ = usePeopleMe();
  const talk = useStartConversation();
  const id = userId === 'eu' ? meQ.data?.me.id : userId;
  const q = useQuery({ queryKey: ['pessoas', 'perfil', id], enabled: !!id, queryFn: () => api<PeopleProfile>(`/pessoas/perfis/${id}`) });
  const [params, setParams] = useSearchParams();
  const editing = params.get('editar') === '1' && !!q.data?.self;
  if (meQ.isLoading || q.isLoading) return <div className="card"><LoadingRows rows={6} /></div>;
  if (q.isError || !q.data) return <ErrorState error={q.error ?? meQ.error} onRetry={() => q.refetch()} />;
  const p = q.data;
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <section className="card overflow-hidden" aria-label={`Perfil de ${p.name}`}>
        <div className="relative h-28 bg-gradient-to-br from-navy to-primary sm:h-36"><Hexagons className="absolute inset-y-0 right-0 h-full w-[60%]" /></div>
        <div className="px-5 pb-5 sm:px-6">
          <div className="relative z-10 -mt-12 flex flex-wrap items-end justify-between gap-3">
            <Avatar name={p.name} userId={p.id} hasPhoto={p.hasPhoto} size={96} className="ring-4 ring-surface" />
            {p.self && !editing && <Button size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => setParams({ editar: '1' })}>Editar perfil</Button>}
            {!p.self && <Button size="sm" variant="primary" icon={<Send className="h-4 w-4" />} loading={talk.isPending} onClick={() => talk.mutate(p.id)}>Mensagem</Button>}
          </div>
          <h2 className="mt-3 font-display text-2xl font-bold tracking-wide text-ink">{p.name}</h2>
          {orgLine(p) && <p className="text-md text-text">{orgLine(p)}</p>}
          {p.teams.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{p.teams.map((t) => <Chip key={t} tone="blue">{t}</Chip>)}</div>}
          {(p.contact.email || p.contact.phone) && (
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {p.contact.email && <a className="link inline-flex items-center gap-1.5" href={`mailto:${p.contact.email}`}><Mail className="h-4 w-4" aria-hidden />{p.contact.email}</a>}
              {p.contact.phone && <span className="inline-flex items-center gap-1.5 text-text"><Phone className="h-4 w-4" aria-hidden />{p.contact.phone}</span>}
            </div>
          )}
          {p.self && <p className="mt-3 text-xs text-muted">Nome, foto, cargo, times, área e unidade vêm do cadastro oficial da empresa. Para corrigir, fale com a administração.</p>}
        </div>
      </section>

      {editing ? <EditProfile p={p} onDone={() => setParams({})} /> : (
        <section className="card space-y-4 p-5" aria-label="Sobre">
          <div>
            <h3 className="mb-1 text-md font-bold text-ink">Sobre</h3>
            {p.bio ? <p className="whitespace-pre-wrap text-sm text-text">{p.bio}</p> : <p className="text-sm text-muted">{p.self ? 'Você ainda não escreveu sua bio.' : 'Ainda sem bio.'}</p>}
          </div>
          <Tags title="Interesses profissionais" items={p.interests} empty={p.self ? 'Adicione seus interesses para colegas com os mesmos assuntos te encontrarem.' : 'Nenhum interesse informado.'} />
          <Tags title="Competências" items={p.skills} empty={p.self ? 'Compartilhe no que você pode ajudar.' : 'Nenhuma competência informada.'} />
          <div>
            <h3 className="mb-1.5 text-md font-bold text-ink">Comunidades</h3>
            {p.communities.length ? <div className="flex flex-wrap gap-1.5">{p.communities.map((c) => <Link key={c.id} to={`/pessoas/comunidades/${c.id}`}><Chip tone={c.role === 'membro' ? 'neutral' : 'blue'}>{c.name}{c.role !== 'membro' ? (c.role === 'responsavel' ? ' · responsável' : ' · moderação') : ''}</Chip></Link>)}</div>
              : <p className="text-sm text-muted">{p.self ? <>Você ainda não participa de comunidades. <Link className="link" to="/pessoas/comunidades">Ver comunidades</Link></> : 'Nenhuma comunidade em comum para mostrar.'}</p>}
          </div>
        </section>
      )}
      {!editing && (
        <section className="space-y-2" aria-label="Reconhecimentos recebidos">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-md font-bold text-ink">Reconhecimentos recebidos</h2>{!p.self && <Link to={`/pessoas/reconhecimento?para=${p.id}`} className="inline-flex h-8 items-center gap-1.5 bg-primary px-3 text-sm font-semibold text-white hover:bg-primary-hover"><Award className="h-4 w-4" aria-hidden />Reconhecer {p.name.split(' ')[0]}</Link>}</div>
          <RecognitionList tipo="recebidos" pessoa={p.id} compact />
        </section>
      )}
      {!editing && <Feed filter={{ autor: p.id }} orderable={false} title="Publicações" emptyTitle="Nenhuma publicação ainda" emptyText={p.self ? 'Suas publicações aparecem aqui.' : `${p.name.split(' ')[0]} ainda não publicou.`} />}
    </div>
  );
}

function Tags({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <h3 className="mb-1.5 text-md font-bold text-ink">{title}</h3>
      {items.length ? <div className="flex flex-wrap gap-1.5">{items.map((x) => <Chip key={x}>{x}</Chip>)}</div> : <p className="text-sm text-muted">{empty}</p>}
    </div>
  );
}

function EditProfile({ p, onDone }: { p: PeopleProfile; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [bio, setBio] = useState(p.bio ?? '');
  const [interests, setInterests] = useState(p.interests.join(', '));
  const [skills, setSkills] = useState(p.skills.join(', '));
  const [showEmail, setShowEmail] = useState(p.privacy?.showEmail ?? false);
  const [showPhone, setShowPhone] = useState(p.privacy?.showPhone ?? false);
  useEffect(() => { window.scrollTo({ top: 0 }); }, []);
  const save = useMutation({
    mutationFn: () => api('/pessoas/perfil', { method: 'PUT', body: { bio: bio.trim() || null, interests: list(interests), skills: list(skills), showEmail, showPhone } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pessoas'] }); toast({ tone: 'success', message: 'Perfil atualizado' }); onDone(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <form className="card space-y-4 p-5" aria-label="Editar perfil" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <FormField label="Bio" htmlFor="pp-bio" hint={`${bio.length}/600 · o que você faz, no que trabalha, o que gosta de compartilhar`}>
        <Textarea id="pp-bio" rows={4} maxLength={600} value={bio} onChange={(e) => setBio(e.target.value)} />
      </FormField>
      <FormField label="Interesses profissionais" htmlFor="pp-int" hint="Separe por vírgula (até 15). Ex.: redes, atendimento, dados">
        <Input id="pp-int" value={interests} onChange={(e) => setInterests(e.target.value)} />
      </FormField>
      <FormField label="Competências que você compartilha" htmlFor="pp-sk" hint="Separe por vírgula (até 20). Ex.: negociação, Excel avançado, fibra óptica">
        <Input id="pp-sk" value={skills} onChange={(e) => setSkills(e.target.value)} />
      </FormField>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-ink">Contato visível para colegas</legend>
        <label className="flex items-center gap-2 text-sm text-text"><input type="checkbox" className="h-4 w-4 accent-primary" checked={showEmail} onChange={(e) => setShowEmail(e.target.checked)} />Mostrar meu e-mail corporativo</label>
        <label className="flex items-center gap-2 text-sm text-text"><input type="checkbox" className="h-4 w-4 accent-primary" checked={showPhone} onChange={(e) => setShowPhone(e.target.checked)} />Mostrar meu telefone</label>
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Cancelar</Button>
        <Button type="submit" variant="primary" loading={save.isPending}>Salvar perfil</Button>
      </div>
    </form>
  );
}
