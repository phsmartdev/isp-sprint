/**
 * Certificados de cursos complementares: envio pela própria pessoa (curso da sua área) e validação pela liderança.
 * Validado, vira pontos extras na gamificação pela regra aprovada (fixo + por hora, com teto mensal).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, FileText } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { Button, Chip, EmptyState, FormField, Input, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

type Rule = { pointsPerCertificate: number; pointsPerHourTenths: number; maxHoursCounted: number; monthlyCapPoints: number };
type Cert = { id: string; userName: string; title: string; institution: string; area: string; hours: number; completedOn: string; fileName: string; status: 'pendente' | 'aprovado' | 'recusado'; decidedBy: string | null; approvedOn: string | null; decisionNote: string | null; points: number | null };
type Resp = { rule: Rule | null; areas: string[]; canValidate: boolean; mine: Cert[]; toValidate: Cert[] };
const n1 = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const TONE = { pendente: 'yellow', aprovado: 'green', recusado: 'red' } as const;
const LABEL = { pendente: 'Aguardando validação', aprovado: 'Validado', recusado: 'Recusado' } as const;
const fileUrl = (id: string) => `/api/v1/times/certificados/${id}/arquivo`;

export function CertificatesPanel() {
  const q = useQuery({ queryKey: ['certificados'], queryFn: () => api<Resp>('/times/certificados') });
  const [open, setOpen] = useState(false);
  const d = q.data;
  if (!d) return null;
  return (
    <section aria-label="Certificados de cursos" className="card space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-bold text-ink"><Award className="h-5 w-5 text-primary" aria-hidden />Certificados de cursos complementares</h2>
          <p className="text-sm text-muted">{d.rule ? `Curso da sua área validado pela liderança vale ${n1(d.rule.pointsPerCertificate)} pts + ${n1(d.rule.pointsPerHourTenths / 10)} pt por hora (até ${d.rule.maxHoursCounted} h), com teto de ${n1(d.rule.monthlyCapPoints)} pts por mês.` : 'A regra aprovada ainda não dá pontos por certificado.'}</p>
        </div>
        {d.rule && <Button variant="primary" onClick={() => setOpen(true)}>Enviar certificado</Button>}
      </div>
      {d.mine.length ? (
        <ul aria-label="Meus certificados" className="divide-y divide-line border border-line">
          {d.mine.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
              <a href={fileUrl(c.id)} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 font-semibold text-ink hover:text-primary"><FileText className="h-4 w-4" aria-hidden />{c.title}</a>
              <span className="text-muted">{c.institution} · {c.area} · {c.hours} h · {fmtDate(c.completedOn)}</span>
              <Chip tone={TONE[c.status]}>{LABEL[c.status]}</Chip>
              {c.status === 'aprovado' && <span className="num font-semibold text-[#15803D]">+{n1(c.points ?? 0)} pts</span>}
              {c.status === 'recusado' && c.decisionNote && <span className="text-xs text-danger">{c.decisionNote}</span>}
            </li>
          ))}
        </ul>
      ) : d.rule ? <p className="text-sm text-muted">Você ainda não enviou certificados.</p> : null}
      {d.canValidate && <Validate items={d.toValidate} />}
      {open && d.rule && <SubmitModal rule={d.rule} areas={d.areas} onClose={() => setOpen(false)} />}
    </section>
  );
}

function SubmitModal({ rule, areas, onClose }: { rule: Rule; areas: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ title: '', institution: '', area: areas[0] ?? '', hours: '', completedOn: '' });
  const [file, setFile] = useState<File | null>(null);
  const hours = Number(f.hours) || 0;
  const pts = rule.pointsPerCertificate + (Math.min(hours, rule.maxHoursCounted) * rule.pointsPerHourTenths) / 10;
  const m = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Anexe o certificado.');
      if (file.size > 3 * 1024 * 1024) throw new Error('Certificado acima de 3 MB.');
      const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = rej; r.readAsDataURL(file); });
      return api('/times/certificados', { method: 'POST', body: { ...f, hours, fileName: file.name, data } });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['certificados'] }); toast({ tone: 'success', message: 'Certificado enviado para validação' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} title="Enviar certificado" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={!f.title || !f.institution || !f.area || !hours || !f.completedOn || !file} onClick={() => m.mutate()}>Enviar para validação</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Curso" htmlFor="ce-t" required className="sm:col-span-2"><Input id="ce-t" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></FormField>
        <FormField label="Instituição" htmlFor="ce-i" required><Input id="ce-i" value={f.institution} onChange={(e) => setF({ ...f, institution: e.target.value })} /></FormField>
        <FormField label="Área" htmlFor="ce-a" required hint="setores e times do seu cadastro"><Select id="ce-a" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })}>{areas.map((a) => <option key={a} value={a}>{a}</option>)}</Select></FormField>
        <FormField label="Carga horária (h)" htmlFor="ce-h" required><Input id="ce-h" type="number" min={1} max={2000} value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></FormField>
        <FormField label="Concluído em" htmlFor="ce-d" required><Input id="ce-d" type="date" value={f.completedOn} onChange={(e) => setF({ ...f, completedOn: e.target.value })} /></FormField>
        <FormField label="Certificado (PDF, PNG ou JPG até 3 MB)" htmlFor="ce-f" required className="sm:col-span-2"><input id="ce-f" type="file" accept="application/pdf,image/png,image/jpeg" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></FormField>
      </div>
      {!areas.length && <p className="mt-3 text-sm text-danger">Seu cadastro não tem setor nem time. Peça à administração para completar.</p>}
      <p className="mt-3 border-l-4 border-lime bg-surface-2 px-3 py-2 text-sm">Validado, este certificado vale <strong className="num">{n1(pts)} pts</strong> (respeitando o teto de {n1(rule.monthlyCapPoints)} pts no mês).</p>
    </Modal>
  );
}

function Validate({ items }: { items: Cert[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [refuse, setRefuse] = useState<Cert | null>(null);
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: (x: { id: string; approve: boolean; note?: string }) => api(`/times/certificados/${x.id}/decisao`, { method: 'POST', body: { approve: x.approve, note: x.note ?? null } }),
    onSuccess: (_r, x) => { void qc.invalidateQueries({ queryKey: ['certificados'] }); void qc.invalidateQueries({ queryKey: ['gamification'] }); toast({ tone: 'success', message: x.approve ? 'Certificado validado' : 'Certificado recusado' }); setRefuse(null); setNote(''); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <h3 className="text-sm font-semibold text-ink">Para validar ({items.length})</h3>
      {!items.length ? <EmptyState title="Nada para validar" description="Os certificados enviados pelo seu time aparecem aqui." /> : (
        <ul aria-label="Certificados para validar" className="divide-y divide-line border border-line">
          {items.map((c) => (
            <li key={c.id} aria-label={`Certificado ${c.title}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
              <span className="font-semibold text-ink">{c.userName}</span>
              <a href={fileUrl(c.id)} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-primary hover:underline"><FileText className="h-4 w-4" aria-hidden />{c.title}</a>
              <span className="text-muted">{c.institution} · {c.area} · {c.hours} h · {fmtDate(c.completedOn)}</span>
              {c.points != null && <span className="num text-muted">vale {n1(c.points)} pts</span>}
              <span className="ml-auto flex gap-2"><Button size="sm" onClick={() => setRefuse(c)}>Recusar</Button><Button size="sm" variant="primary" loading={m.isPending} onClick={() => m.mutate({ id: c.id, approve: true })}>Validar</Button></span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">Confira se o curso é da área da pessoa e se o certificado é legítimo. Ninguém valida o próprio certificado.</p>
      {refuse && (
        <Modal open onClose={() => setRefuse(null)} title="Recusar certificado" footer={<><Button onClick={() => setRefuse(null)}>Cancelar</Button><Button variant="danger" disabled={!note.trim()} loading={m.isPending} onClick={() => m.mutate({ id: refuse.id, approve: false, note })}>Recusar</Button></>}>
          <FormField label="Motivo" htmlFor="ce-n" required hint="a pessoa vê o motivo"><Textarea id="ce-n" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
        </Modal>
      )}
    </div>
  );
}
