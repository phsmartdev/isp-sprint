/**
 * Configurações → Mapa da rede (só Yepnet): envio do KMZ/KML exportado do Google Earth, OZmap, GeoGrid etc.
 * O arquivo é lido aqui no navegador (CTOs, cabos e áreas); a prévia mostra o que foi entendido antes de ativar.
 * Cada envio é uma versão; a ativa é a que aparece no traçado das oportunidades.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import L from 'leaflet';
import { CheckCircle2, FileUp, MapPinned, Trash2 } from 'lucide-react';
import type { NetFeature } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { chunkFeatures, readNetworkFile, type KmlResult } from '../../lib/kml';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import { DEFAULT_CENTER, baseLayer, networkBounds, networkLayer } from '../../features/route/mapBase';

type Version = { id: string; name: string; filename: string; points: number; lines: number; areas: number; active: boolean; createdAt: string; uploadedByName: string | null };

function Preview({ features }: { features: NetFeature[] }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const map = L.map(el.current, { preferCanvas: true, zoomControl: true, attributionControl: true }).setView(DEFAULT_CENTER, 13);
    baseLayer('ruas').addTo(map);
    const r = L.canvas({ padding: 0.5 });
    networkLayer(features, r).addTo(map);
    const b = networkBounds(features);
    if (b) map.fitBounds(b, { padding: [20, 20], maxZoom: 17 });
    return () => { map.remove(); };
  }, [features]);
  return <div ref={el} className="h-[380px] w-full overflow-hidden rounded-lg border border-line" aria-label="Prévia do mapa da rede" />;
}

export function AdminNetworkMaps() {
  const toast = useToast();
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<{ file: File; result: KmlResult } | null>(null);
  const [name, setName] = useState('');
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['admin', 'network-maps'], queryFn: () => api<{ items: Version[] }>('/admin/network-maps') });

  const read = async (f: File) => {
    setReading(true);
    try {
      const result = await readNetworkFile(f);
      if (!result.features.length) throw new Error('Nenhuma CTO, cabo ou área encontrada no arquivo.');
      setPicked({ file: f, result });
      setName(f.name.replace(/\.(kmz|kml)$/i, ''));
    } catch (e) {
      toast({ tone: 'error', message: (e as Error).message });
    } finally { setReading(false); }
  };

  const send = useMutation({
    mutationFn: async () => {
      const parts = chunkFeatures(picked!.result.features);
      setProgress(`Enviando parte 1 de ${parts.length}…`);
      const { id } = await api<{ id: string }>('/admin/network-maps', { method: 'POST', body: { name: name.trim(), filename: picked!.file.name, features: parts[0] } });
      for (let k = 1; k < parts.length; k++) {
        setProgress(`Enviando parte ${k + 1} de ${parts.length}…`);
        await api(`/admin/network-maps/${id}/features`, { method: 'POST', body: { features: parts[k] } });
      }
      setProgress('Ativando…');
      await api(`/admin/network-maps/${id}/activate`, { method: 'POST' });
    },
    onSuccess: () => {
      toast({ tone: 'success', message: 'Mapa da rede ativado. Os traçados das oportunidades já usam esta versão.' });
      setPicked(null); setName(''); setProgress(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'network-maps'] });
      void qc.invalidateQueries({ queryKey: ['network-map'] });
    },
    onError: (e) => { setProgress(null); toast({ tone: 'error', message: errMsg(e) }); },
  });
  const activate = useMutation({
    mutationFn: (id: string) => api(`/admin/network-maps/${id}/activate`, { method: 'POST' }),
    onSuccess: () => { toast({ tone: 'success', message: 'Versão ativada.' }); void qc.invalidateQueries({ queryKey: ['admin', 'network-maps'] }); void qc.invalidateQueries({ queryKey: ['network-map'] }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/admin/network-maps/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast({ tone: 'success', message: 'Versão removida.' }); void qc.invalidateQueries({ queryKey: ['admin', 'network-maps'] }); void qc.invalidateQueries({ queryKey: ['network-map'] }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });

  const r = picked?.result;
  const count = (k: NetFeature['kind']) => r?.features.filter((f) => f.kind === k).length ?? 0;
  return (
    <div className="space-y-4">
      <section className="card space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-bold text-ink"><MapPinned className="h-5 w-5 text-primary" />Mapa da rede</h2>
            <p className="text-sm text-muted">Envie o KMZ ou KML da rede (Google Earth, OZmap, GeoGrid…). As CTOs, os cabos e as áreas de cobertura aparecem no mapa da oportunidade, onde o vendedor faz o traçado até o cliente.</p>
          </div>
          <Button variant="primary" icon={<FileUp className="h-4 w-4" />} loading={reading} onClick={() => file.current?.click()}>Escolher KMZ/KML</Button>
          <input ref={file} type="file" accept=".kmz,.kml,application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml" className="hidden" aria-label="Arquivo KMZ ou KML da rede" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ''; }} />
        </div>

        {r && (
          <div className="space-y-4 border-t border-line pt-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-ink">{picked!.file.name}</span>
              <Chip tone="green">{count('ponto').toLocaleString('pt-BR')} pontos (CTOs, caixas)</Chip>
              <Chip tone="orange">{count('linha').toLocaleString('pt-BR')} cabos</Chip>
              <Chip tone="sky">{count('area').toLocaleString('pt-BR')} áreas</Chip>
              {r.skipped > 0 && <Chip>{r.skipped} sem geometria (ignorados)</Chip>}
            </div>
            {r.folders.length > 0 && <p className="text-xs text-muted">Pastas: {r.folders.slice(0, 12).join(' · ')}{r.folders.length > 12 ? ` e mais ${r.folders.length - 12}` : ''}</p>}
            <Preview features={r.features} />
            <div className="flex flex-wrap items-end gap-3">
              <FormField label="Nome desta versão" htmlFor="nm-name"><Input id="nm-name" value={name} onChange={(e) => setName(e.target.value)} className="w-72" /></FormField>
              <Button variant="primary" icon={<CheckCircle2 className="h-4 w-4" />} disabled={name.trim().length < 2} loading={send.isPending} onClick={() => send.mutate()}>Enviar e ativar</Button>
              <Button variant="ghost" disabled={send.isPending} onClick={() => setPicked(null)}>Cancelar</Button>
              {progress && <span className="text-sm text-muted" aria-live="polite">{progress}</span>}
            </div>
          </div>
        )}
        {!r && <Notice>Dica: no Google Earth, clique com o botão direito na pasta da rede → Salvar lugar como → KMZ. Envie só a rede de acesso (CTOs, cabos e áreas): fotos e camadas de outros assuntos ficam de fora.</Notice>}
      </section>

      <section className="card overflow-hidden">
        <h3 className="border-b border-line px-5 py-3 text-md font-bold text-ink">Versões enviadas</h3>
        {list.isLoading ? <LoadingRows rows={3} /> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !list.data?.items.length ? (
          <EmptyState title="Nenhum mapa enviado" description="Sem o mapa, o vendedor ainda consegue traçar no satélite, mas sem as CTOs para começar." />
        ) : (
          <ul className="divide-y divide-line">
            {list.data.items.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{v.name} {v.active && <Chip tone="green" className="ml-1">Ativa</Chip>}</p>
                  <p className="text-xs text-muted">{v.filename} · {v.points.toLocaleString('pt-BR')} pontos · {v.lines.toLocaleString('pt-BR')} cabos · {v.areas.toLocaleString('pt-BR')} áreas · {fmtDateTime(v.createdAt)}{v.uploadedByName ? ` por ${v.uploadedByName}` : ''}</p>
                </div>
                {!v.active && <Button size="sm" variant="outline" loading={activate.isPending && activate.variables === v.id} onClick={() => activate.mutate(v.id)}>Ativar</Button>}
                <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} loading={remove.isPending && remove.variables === v.id} onClick={() => { if (window.confirm(`Remover a versão "${v.name}"? Traçados já salvos não mudam.`)) remove.mutate(v.id); }}>Remover</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
