/** Configurações → Segurança: acesso por IP liberado (endereços e faixas autorizados, exceções por pessoa). */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { ipAllowed, validateIpPolicy } from '@isp/domain';
import { api } from '../../lib/api';
import { Button, FormField, Input, LoadingRows, Notice } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

type Rule = { cidr: string; label: string };
type Data = { enabled: boolean; rules: Rule[]; myIp: string | null; meBypass: boolean; bypassUsers: { id: string; name: string; email: string }[]; blocked7d: number };

export function IpAccessCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin', 'ip-access'], queryFn: () => api<Data>('/admin/ip-access') });
  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);
  const [cidr, setCidr] = useState('');
  const [label, setLabel] = useState('');
  useEffect(() => { if (q.data) { setEnabled(q.data.enabled); setRules(q.data.rules); } }, [q.data]);
  const save = useMutation({
    mutationFn: () => api('/admin/ip-access', { method: 'PUT', body: { enabled, rules } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin', 'ip-access'] }); toast({ tone: 'success', message: enabled ? 'Acesso por IP ligado' : 'Acesso por IP salvo (desligado)' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading || !q.data) return <div className="card"><LoadingRows rows={3} /></div>;
  const d = q.data;
  const errors = validateIpPolicy({ enabled, rules });
  const lockout = enabled && !d.meBypass && !ipAllowed(d.myIp, { enabled, rules });
  const dirty = enabled !== d.enabled || JSON.stringify(rules) !== JSON.stringify(d.rules);
  const add = (c: string, l: string) => { if (!c.trim()) return; setRules([...rules, { cidr: c.trim(), label: l.trim() }]); setCidr(''); setLabel(''); };
  return (
    <section className="card p-5" aria-label="Acesso por IP">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-lg font-bold text-ink">Acesso por IP liberado</h2>
          <p className="text-sm text-muted">Ligado, só entra no sistema quem está num endereço ou faixa da lista (ex.: a rede do escritório). Vale para o login com senha e com Google e para quem já está com o sistema aberto. Quem for marcado no cadastro do usuário pode entrar de qualquer lugar.</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold text-ink"><input type="checkbox" className="h-4 w-4 accent-primary" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Restringir o acesso aos IPs da lista</label>
      </div>
      <p className="mt-3 text-sm text-text">Seu IP agora: <b className="num">{d.myIp ?? 'desconhecido'}</b>{d.myIp && !rules.some((r) => r.cidr === d.myIp) && <button type="button" className="ml-2 text-sm font-semibold text-primary hover:underline" onClick={() => add(d.myIp!, 'Meu IP atual')}>Incluir na lista</button>}{d.meBypass && <span className="text-muted"> · você pode entrar de qualquer IP</span>}</p>
      <ul className="mt-3 divide-y divide-line border border-line">
        {rules.map((r, i) => (
          <li key={`${r.cidr}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span><b className="num text-ink">{r.cidr}</b>{r.label && <span className="text-muted"> · {r.label}</span>}</span>
            <button type="button" className="p-1 text-muted hover:text-danger" aria-label={`Tirar ${r.cidr}`} onClick={() => setRules(rules.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}
        {!rules.length && <li className="px-3 py-2 text-sm text-muted">Nenhum endereço na lista.</li>}
      </ul>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <FormField label="IP ou faixa" htmlFor="ip-cidr" hint="Ex.: 200.150.10.20 ou 200.150.10.0/24 (IPv6 também)"><Input id="ip-cidr" className="w-64" value={cidr} onChange={(e) => setCidr(e.target.value)} /></FormField>
        <FormField label="Descrição" htmlFor="ip-label"><Input id="ip-label" className="w-56" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="Escritório Aracaju" /></FormField>
        <Button icon={<Plus className="h-4 w-4" />} disabled={!cidr.trim()} onClick={() => add(cidr, label)}>Adicionar</Button>
      </div>
      {errors.length > 0 && <p role="alert" className="mt-3 text-sm text-danger">{errors[0]}</p>}
      {lockout && <div className="mt-3"><Notice tone="warning">Seu IP atual não está na lista: ao ligar, você perderia o acesso. Inclua seu IP ou marque seu usuário para entrar de qualquer lugar.</Notice></div>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-xs text-muted">
        <span>Podem entrar de qualquer IP: {d.bypassUsers.length ? d.bypassUsers.map((u) => u.name).join(', ') : 'ninguém'} · tentativas bloqueadas nos últimos 7 dias: <b className="num text-ink">{d.blocked7d}</b> (veja na auditoria)</span>
        <Button variant="primary" loading={save.isPending} disabled={!dirty || errors.length > 0 || lockout} onClick={() => save.mutate()}>Salvar acesso por IP</Button>
      </div>
    </section>
  );
}
