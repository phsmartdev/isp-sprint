/**
 * Viabilidade técnica na oportunidade (Yepnet): o vendedor marca o cliente no mapa, traça o caminho a partir da CTO
 * (o primeiro clique "gruda" na CTO mais próxima do mapa da rede), informa a porta e a sobra, e salva.
 * Salvar gera a imagem do traçado (com metragem, porta e localização), guarda nos anexos e deixa o chamado de
 * viabilidade para a engenharia pronto para abrir no GLPI, com a imagem anexada.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import L from 'leaflet';
import { Crosshair, Download, Eraser, ImageIcon, LocateFixed, MapPin, Route as RouteIcon, Save, Search, Send, Undo2 } from 'lucide-react';
import { distanceM, fmtLatLng, fmtMeters, insideRing, nearestPoint, pathLengthM, routeTicketText, type LatLng, type NetFeature } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useAuth } from '../../auth/AuthProvider';
import type { Opportunity } from '../../lib/types';
import { Button, Chip, EmptyState, FormField, Input, LoadingRows, Notice, Textarea } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';
import { OpenTicketDialog } from '../GlpiTickets';
import { BRAND } from '../../brand';
import { COLORS, DEFAULT_CENTER, BASES, baseLayer, dot, geocode, networkBounds, networkLayer, reverseGeocode, type BaseKind } from './mapBase';
import { routeImage } from './exportImage';

type Point = Extract<NetFeature, { kind: 'ponto' }>;
type Study = {
  id: string; clientAt: LatLng; clientAddress: string | null; ctoName: string | null; ctoAt: LatLng | null; port: string | null; route: LatLng[];
  lengthM: number; slackM: number; totalM: number; notes: string | null; attachmentId: string | null; attachmentName: string | null; glpiTicketId: string | null; createdAt: string; createdByName: string | null;
};
type Mode = 'navegar' | 'cliente' | 'tracar';

/** Raio para o primeiro clique grudar numa CTO, e para o último grudar no cliente. */
const SNAP_CTO_M = 60;
const SNAP_CLIENT_M = 20;

const addressOf = (o: Opportunity) => [o.installStreet && `${o.installStreet}${o.installNumber ? `, ${o.installNumber}` : ''}`, o.installDistrict, o.installCity].filter(Boolean).join(' · ') || null;

/** Editor do traçado (página cheia, mapa largo). */
export function RouteStudio({ opp }: { opp: Opportunity }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { me } = useAuth();
  const net = useQuery({ queryKey: ['network-map'], staleTime: 10 * 60_000, queryFn: () => api<{ id: string | null; name: string | null; createdAt: string | null; features: NetFeature[] }>('/network-map') });
  const studies = useQuery({ queryKey: ['route-studies', opp.id], queryFn: () => api<{ items: Study[] }>(`/opportunities/${opp.id}/route-studies`) });

  const [mode, setMode] = useState<Mode>('navegar');
  const [base, setBase] = useState<BaseKind>('satelite');
  const [client, setClient] = useState<LatLng | null>(null);
  const [route, setRoute] = useState<LatLng[]>([]);
  const [cto, setCto] = useState<{ name: string; at: LatLng } | null>(null);
  const [ctoName, setCtoName] = useState('');
  const [port, setPort] = useState('');
  const [slack, setSlack] = useState('0');
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState(addressOf(opp) ?? '');
  const [searching, setSearching] = useState(false);
  const loadedFrom = useRef<string | null>(null);

  const points = useMemo(() => (net.data?.features ?? []).filter((f): f is Point => f.kind === 'ponto'), [net.data]);
  const areas = useMemo(() => (net.data?.features ?? []).filter((f) => f.kind === 'area') as Extract<NetFeature, { kind: 'area' }>[], [net.data]);
  const lengthM = useMemo(() => Math.round(pathLengthM(route)), [route]);
  const slackM = Math.max(0, Math.round(Number(slack.replace(',', '.')) || 0));
  const nearest = useMemo(() => (client ? nearestPoint(points, client) : null), [client, points]);
  const inArea = useMemo(() => (client ? areas.filter((a) => insideRing(client, a.ring)).map((a) => a.name) : []), [client, areas]);

  // último traçado salvo vem para o mapa ao abrir
  const [params] = useSearchParams();
  const wanted = params.get('v');
  const latest = studies.data?.items.find((x) => x.id === wanted) ?? studies.data?.items[0] ?? null;
  useEffect(() => {
    if (!latest || loadedFrom.current) return;
    loadedFrom.current = latest.id;
    load(latest);
  }, [latest]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = (s: Study) => {
    setClient(s.clientAt); setRoute(s.route); setCto(s.ctoAt ? { name: s.ctoName ?? 'CTO', at: s.ctoAt } : null); setCtoName(s.ctoName ?? '');
    setPort(s.port ?? ''); setSlack(String(s.slackM)); setNotes(s.notes ?? ''); if (s.clientAddress) setAddress(s.clientAddress);
    setMode('navegar');
    mapRef.current?.fitBounds(L.latLngBounds([...s.route, s.clientAt]), { padding: [40, 40], maxZoom: 19 });
  };

  // ------------------------------------------------------------------ mapa
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseRef = useRef<L.LayerGroup | null>(null);
  const netRef = useRef<L.LayerGroup | null>(null);
  const drawRef = useRef<L.LayerGroup | null>(null);
  const routeRenderer = useRef<L.Renderer | null>(null);
  const handlers = useRef<{ click: (at: LatLng) => void; point: (p: Point) => void }>({ click: () => {}, point: () => {} });

  useEffect(() => {
    if (!el.current) return;
    const map = L.map(el.current, { preferCanvas: true, doubleClickZoom: false, maxZoom: 21 }).setView(DEFAULT_CENTER, 14);
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __routeMap?: L.Map }).__routeMap = map; // testes de tela em desenvolvimento
    // o traçado fica numa camada própria, acima da rede (overlayPane = 400) e abaixo dos marcadores (600)
    map.createPane('tracado').style.zIndex = '450';
    routeRenderer.current = L.svg({ pane: 'tracado' });
    drawRef.current = L.layerGroup().addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => handlers.current.click([e.latlng.lat, e.latlng.lng]));
    return () => { map.remove(); mapRef.current = null; };
  }, []);
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    baseRef.current?.remove();
    baseRef.current = baseLayer(base).addTo(map);
    baseRef.current.eachLayer((l) => (l as L.TileLayer).bringToBack?.());
  }, [base]);
  useEffect(() => {
    const map = mapRef.current; if (!map || !net.data) return;
    netRef.current?.remove();
    netRef.current = networkLayer(net.data.features, L.canvas({ padding: 0.5 }), (p) => handlers.current.point(p)).addTo(map);
    if (!loadedFrom.current && !client) {
      const b = networkBounds(net.data.features);
      if (b) map.fitBounds(b, { padding: [20, 20], maxZoom: 17 });
    }
  }, [net.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // cliente marcado no mapa: sem endereço preenchido, o ArcGIS sugere o endereço do ponto
  const placeClient = (at: LatLng) => {
    setClient(at);
    if (!address.trim()) void reverseGeocode(at).then((a) => { if (a) setAddress((cur) => cur.trim() ? cur : a); }).catch(() => undefined);
  };

  // cliques conforme o modo
  handlers.current.click = (at) => {
    if (mode === 'cliente') { placeClient(at); setMode(route.length ? 'navegar' : 'tracar'); return; }
    if (mode !== 'tracar') return;
    if (!route.length) {
      const near = nearestPoint(points, at, SNAP_CTO_M);
      if (near) { setRoute([near.point.at]); setCto({ name: near.point.name, at: near.point.at }); setCtoName(near.point.name); return; }
      setRoute([at]); setCto(null); return;
    }
    if (client && distanceM(at, client) <= SNAP_CLIENT_M) { setRoute((r) => [...r, client]); setMode('navegar'); return; }
    setRoute((r) => [...r, at]);
  };
  handlers.current.point = (p) => {
    if (mode === 'tracar' && !route.length) { setRoute([p.at]); setCto({ name: p.name, at: p.at }); setCtoName(p.name); }
    else if (mode === 'tracar') setRoute((r) => [...r, p.at]);
  };

  // desenho do traçado, do cliente e da CTO de origem
  useEffect(() => {
    const g = drawRef.current; const map = mapRef.current; if (!g || !map) return;
    g.clearLayers();
    if (route.length > 1) {
      const renderer = routeRenderer.current ?? undefined;
      L.polyline(route, { renderer, color: COLORS.routeEdge, weight: 9, opacity: 0.9, interactive: false }).addTo(g);
      L.polyline(route, { renderer, color: COLORS.route, weight: 5, interactive: false }).addTo(g);
      route.slice(1).forEach((p, k) => {
        const a = route[k]!; const m = distanceM(a, p);
        if (m >= 8) L.marker([(a[0] + p[0]) / 2, (a[1] + p[1]) / 2], { interactive: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<span style="position:absolute;transform:translate(-50%,-50%);white-space:nowrap;padding:1px 7px;border-radius:999px;background:rgba(10,26,79,.92);color:#FACC15;font:700 12px system-ui">${Math.round(m)} m</span>` }) }).addTo(g);
      });
    }
    // vértices arrastáveis (o primeiro fica na CTO)
    route.forEach((p, k) => {
      const v = L.marker(p, { draggable: mode !== 'cliente', icon: dot('#FFFFFF', COLORS.routeEdge, 12) }).addTo(g);
      v.bindTooltip(k === 0 ? 'Início do traçado' : `Ponto ${k + 1} · arraste para ajustar · clique duplo remove`, { direction: 'top' });
      v.on('dragend', () => { const ll = v.getLatLng(); setRoute((r) => r.map((x, i) => (i === k ? [ll.lat, ll.lng] as LatLng : x))); });
      v.on('dblclick', (e) => { L.DomEvent.stopPropagation(e); setRoute((r) => r.filter((_, i) => i !== k)); if (k === 0) setCto(null); });
    });
    if (cto) L.marker(cto.at, { icon: dot(COLORS.cto, COLORS.ctoEdge, 20, cto.name), interactive: false, zIndexOffset: 500 }).addTo(g);
    if (client) {
      const m = L.marker(client, { draggable: true, icon: dot(COLORS.client, COLORS.clientEdge, 22, 'Cliente'), zIndexOffset: 1000 }).addTo(g);
      m.bindTooltip('Arraste para a casa do cliente', { direction: 'top', offset: [0, -10] });
      m.on('dragend', () => { const ll = m.getLatLng(); placeClient([ll.lat, ll.lng]); });
      // no modo traçar, clicar no pino do cliente termina o traçado nele
      m.on('click', (e) => { L.DomEvent.stopPropagation(e); if (mode === 'tracar' && route.length) { setRoute((r) => [...r, client]); setMode('navegar'); } });
    }
  }, [route, client, cto, mode]);

  useEffect(() => { el.current?.style.setProperty('cursor', mode === 'navegar' ? '' : 'crosshair'); }, [mode]);

  const findAddress = async () => {
    if (!address.trim()) return;
    setSearching(true);
    try {
      const at = await geocode(address.replace(/·/g, ','));
      if (!at) { toast({ tone: 'error', message: 'Endereço não encontrado. Clique em "Marcar cliente" e clique na casa no mapa.' }); return; }
      setClient(at); mapRef.current?.setView(at, 18);
      toast({ tone: 'success', message: 'Pino colocado pelo endereço. Confira no satélite e arraste se precisar.' });
    } catch (e) { toast({ tone: 'error', message: `A busca de endereço não respondeu${e instanceof Error && e.message ? ` (${e.message})` : ''}. Marque o cliente clicando no mapa.` }); }
    finally { setSearching(false); }
  };

  // ------------------------------------------------------------------ imagem e salvar
  const ready = !!client && route.length >= 2;
  const title = `Viabilidade técnica — OP-${opp.code} · ${opp.contactName}`;
  const makeImage = () => routeImage({
    base, route, client: client!, cto: { name: ctoName.trim() || cto?.name || null, at: cto?.at ?? route[0] ?? null }, network: net.data?.features ?? [],
    info: { title, address: address.trim() || null, port: port.trim() || null, lengthM, slackM, notes: notes.trim() || null, author: me?.user.name ?? 'usuário', app: `${BRAND.app} · ${BRAND.company}` },
  });
  const download = useMutation({
    mutationFn: makeImage,
    onSuccess: ({ dataUrl, withMap }) => {
      const a = document.createElement('a'); a.href = dataUrl; a.download = `Viabilidade OP-${opp.code}.png`; a.click();
      if (!withMap) toast({ tone: 'error', message: 'O fundo do mapa não carregou; a imagem saiu só com o traçado e o quadro.' });
    },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const save = useMutation({
    mutationFn: async () => {
      const img = await makeImage();
      const s = await api<Study>(`/opportunities/${opp.id}/route-studies`, {
        method: 'POST',
        body: { clientAt: client, clientAddress: address.trim() || null, ctoName: ctoName.trim() || cto?.name || null, ctoAt: cto?.at ?? null, port: port.trim() || null, route, slackM, notes: notes.trim() || null, image: img.dataUrl },
      });
      return { s, withMap: img.withMap };
    },
    onSuccess: ({ s, withMap }) => {
      loadedFrom.current = s.id;
      void qc.invalidateQueries({ queryKey: ['route-studies', opp.id] });
      void qc.invalidateQueries({ queryKey: ['attachments', opp.id] });
      void qc.invalidateQueries({ queryKey: ['opportunity', opp.id] });
      toast({ tone: 'success', message: withMap ? 'Traçado salvo. A imagem está nos anexos.' : 'Traçado salvo, mas o fundo do mapa não carregou na imagem.' });
    },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });


  const tool = (m: Mode, icon: React.ReactNode, label: string, hint: string) => (
    <button type="button" title={hint} aria-pressed={mode === m} onClick={() => setMode(mode === m ? 'navegar' : m)}
      className={clsx('inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold shadow-card', mode === m ? 'bg-primary text-white' : 'bg-surface text-ink hover:bg-surface-2')}>{icon}{label}</button>
  );

  return (
    <div className="space-y-4">
      {net.isSuccess && !net.data.id && <Notice tone="warning">O mapa da rede ainda não foi enviado (Configurações → Mapa da rede). Dá para traçar no satélite, mas sem as CTOs para começar o traçado.</Notice>}
      <div className="grid grid-cols-1 gap-4 ws3:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {tool('cliente', <MapPin className="h-4 w-4" />, 'Marcar cliente', 'Clique na casa do cliente no mapa')}
            {tool('tracar', <RouteIcon className="h-4 w-4" />, route.length ? 'Continuar traçado' : 'Traçar', 'Comece clicando na CTO; cada clique é um ponto; clique no cliente para terminar')}
            <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-surface px-3 text-sm font-semibold text-ink shadow-card hover:bg-surface-2 disabled:opacity-50" disabled={!route.length} onClick={() => setRoute((r) => { const n = r.slice(0, -1); if (!n.length) setCto(null); return n; })}><Undo2 className="h-4 w-4" />Desfazer</button>
            <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-surface px-3 text-sm font-semibold text-ink shadow-card hover:bg-surface-2 disabled:opacity-50" disabled={!route.length} onClick={() => { setRoute([]); setCto(null); setCtoName(''); }}><Eraser className="h-4 w-4" />Limpar</button>
            <div className="ml-auto flex overflow-hidden rounded-md shadow-card" role="group" aria-label="Fundo do mapa">
              {(Object.keys(BASES) as BaseKind[]).map((k) => <button key={k} type="button" aria-pressed={base === k} onClick={() => setBase(k)} className={clsx('h-9 px-3 text-sm font-semibold', base === k ? 'bg-navy text-white' : 'bg-surface text-ink hover:bg-surface-2')}>{BASES[k].label}</button>)}
            </div>
          </div>
          <div className="relative">
            <div ref={el} className="h-[560px] w-full overflow-hidden rounded-lg border border-line" aria-label="Mapa para o traçado de viabilidade" />
            {mode !== 'navegar' && (
              <p className="pointer-events-none absolute left-1/2 top-3 z-[500] -translate-x-1/2 rounded-full bg-navy/90 px-4 py-1.5 text-sm font-semibold text-white shadow-overlay">
                {mode === 'cliente' ? 'Clique na casa do cliente' : !route.length ? 'Clique na CTO de origem (ou no ponto de partida)' : 'Clique para cada ponto do caminho · clique no cliente para terminar'}
              </p>
            )}
          </div>
          <p className="text-xs text-muted">Arraste os pontos para ajustar; clique duplo num ponto remove. A metragem é medida pelo caminho traçado, ponto a ponto.</p>
        </div>

        <aside className="space-y-4">
          <section className="card space-y-3 p-4">
            <h3 className="text-md font-bold text-ink">Cliente</h3>
            <FormField label="Endereço" htmlFor="rs-addr">
              <div className="flex gap-2">
                <Input id="rs-addr" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua, número, bairro, cidade" />
                <Button variant="outline" icon={<Search className="h-4 w-4" />} loading={searching} onClick={findAddress} aria-label="Buscar endereço no mapa" />
              </div>
            </FormField>
            {client ? (
              <div className="space-y-1 text-sm">
                <p className="flex items-center justify-between gap-2"><span className="num text-text">{fmtLatLng(client)}</span><button type="button" className="text-primary hover:underline" onClick={() => mapRef.current?.setView(client, 19)}><LocateFixed className="inline h-4 w-4" /> ver</button></p>
                {nearest && <p className="text-muted">CTO mais próxima em linha reta: <b className="text-ink">{nearest.point.name}</b> a {fmtMeters(nearest.distanceM)}</p>}
                {areas.length > 0 && <p className={inArea.length ? 'text-[#15803D]' : 'text-[#C2610C]'}>{inArea.length ? `Dentro da área: ${inArea.join(', ')}` : 'Fora das áreas de cobertura do mapa'}</p>}
              </div>
            ) : <p className="text-sm text-muted">Busque pelo endereço ou use <b>Marcar cliente</b> e clique na casa.</p>}
          </section>

          <section className="card space-y-3 p-4">
            <h3 className="text-md font-bold text-ink">Traçado</h3>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md bg-surface-2 p-2"><p className="text-xs text-muted">Traçado</p><p className="num text-lg font-extrabold text-ink">{fmtMeters(lengthM)}</p></div>
              <div className="rounded-md bg-surface-2 p-2"><p className="text-xs text-muted">Sobra</p><p className="num text-lg font-extrabold text-ink">{fmtMeters(slackM)}</p></div>
              <div className="rounded-md bg-primary-soft p-2"><p className="text-xs text-muted">Total</p><p className="num text-lg font-extrabold text-primary">{fmtMeters(lengthM + slackM)}</p></div>
            </div>
            <p className="text-xs text-muted">{route.length ? `${route.length} pontos` : 'Nenhum ponto ainda'}{client && route.length && distanceM(route[route.length - 1]!, client) > SNAP_CLIENT_M ? ' · ainda não chegou no cliente' : ''}</p>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="CTO de origem" htmlFor="rs-cto"><Input id="rs-cto" value={ctoName} onChange={(e) => setCtoName(e.target.value)} placeholder="Ex.: CTO-07" /></FormField>
              <FormField label="Porta" htmlFor="rs-port"><Input id="rs-port" value={port} onChange={(e) => setPort(e.target.value)} placeholder="Ex.: 5" /></FormField>
            </div>
            <FormField label="Sobra técnica (m)" htmlFor="rs-slack" hint="Reserva de cabo na CTO e na casa">
              <div className="flex gap-2">
                <Input id="rs-slack" inputMode="numeric" value={slack} onChange={(e) => setSlack(e.target.value.replace(/[^\d,.]/g, ''))} className="w-24" />
                {[10, 20, 30].map((m) => <Button key={m} size="sm" variant="ghost" onClick={() => setSlack(String(m))}>{m} m</Button>)}
              </div>
            </FormField>
            <FormField label="Observações para a engenharia" htmlFor="rs-notes"><Textarea id="rs-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: atravessa a avenida; poste sem identificação no ponto 3" /></FormField>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={<Save className="h-4 w-4" />} disabled={!ready} loading={save.isPending} onClick={() => save.mutate()}>Salvar traçado</Button>
              <Button variant="outline" icon={<Download className="h-4 w-4" />} disabled={!ready} loading={download.isPending} onClick={() => download.mutate()}>Baixar imagem</Button>
            </div>
            {!ready && <p className="text-xs text-muted">Para salvar: marque o cliente e trace pelo menos dois pontos.</p>}
          </section>
        </aside>
      </div>

      <StudiesList opp={opp} onShow={load} />
    </div>
  );
}

/**
 * Traçados salvos da oportunidade, com a imagem e o pedido de viabilidade no GLPI (imagem anexada).
 * Aparece na aba "Viabilidade técnica" e embaixo do mapa.
 */
export function StudiesList({ opp, onShow, action }: { opp: Opportunity; onShow?: (s: Study) => void; action?: React.ReactNode }) {
  const qc = useQueryClient();
  const { feature } = useAuth();
  const studies = useQuery({ queryKey: ['route-studies', opp.id], queryFn: () => api<{ items: Study[] }>(`/opportunities/${opp.id}/route-studies`) });
  const [ticketFor, setTicketFor] = useState<Study | null>(null);
  const link = useMutation({ mutationFn: ({ sid, ticketId }: { sid: string; ticketId: string }) => api(`/opportunities/${opp.id}/route-studies/${sid}/ticket`, { method: 'POST', body: { ticketId } }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['route-studies', opp.id] }) });
  const canTicket = feature('crm.chamados');
  const ticketText = (s: Study) => routeTicketText({ code: opp.code, client: opp.contactName, address: s.clientAddress, clientAt: s.clientAt, ctoName: s.ctoName, ctoAt: s.ctoAt, port: s.port, lengthM: s.lengthM, slackM: s.slackM, notes: s.notes, vertices: s.route.length });
  return (
    <>
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3"><h3 className="flex flex-1 items-center gap-2 text-md font-bold text-ink"><ImageIcon className="h-5 w-5 text-primary" />Traçados salvos</h3>{action}</div>
        {studies.isLoading ? <LoadingRows rows={2} /> : !studies.data?.items.length ? (
          <EmptyState icon={<Crosshair className="h-6 w-6" />} title="Nenhum traçado salvo" description="Salve o traçado para gerar a imagem e pedir a viabilidade à engenharia." />
        ) : (
          <ul className="divide-y divide-line">
            {studies.data.items.map((s, n) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{fmtMeters(s.totalM)} de cabo <span className="font-normal text-muted">({fmtMeters(s.lengthM)} + {fmtMeters(s.slackM)} de sobra)</span>{n === 0 && <Chip tone="blue" className="ml-2">Mais recente</Chip>}{s.glpiTicketId && <Chip tone="green" className="ml-2">Chamado aberto</Chip>}</p>
                  <p className="text-xs text-muted">{s.ctoName ?? 'CTO não identificada'}{s.port ? ` · porta ${s.port}` : ''} · {fmtDateTime(s.createdAt)}{s.createdByName ? ` por ${s.createdByName}` : ''}</p>
                </div>
                {onShow ? <Button size="sm" variant="ghost" onClick={() => onShow(s)}>Ver no mapa</Button> : <Link className="inline-flex h-8 items-center rounded-md px-2 text-sm font-semibold text-primary hover:bg-primary-soft" to={`/opportunities/${opp.id}/tracado?v=${s.id}`}>Ver no mapa</Link>}
                {s.attachmentId && <a className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm font-semibold text-primary hover:bg-primary-soft" href={`/api/v1/opportunities/${opp.id}/attachments/${s.attachmentId}/download`}><Download className="h-4 w-4" />Imagem</a>}
                {canTicket && <Button size="sm" variant={s.glpiTicketId ? 'outline' : 'primary'} icon={<Send className="h-4 w-4" />} onClick={() => setTicketFor(s)}>{s.glpiTicketId ? 'Abrir outro chamado' : 'Pedir viabilidade (GLPI)'}</Button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {ticketFor && (
        <OpenTicketDialog open onClose={() => setTicketFor(null)} oppId={opp.id} contactName={opp.contactName} hasCustomer={!!opp.customerId}
          prefill={{ title: `Viabilidade técnica — OP-${opp.code} · ${opp.contactName}`.slice(0, 250), content: ticketText(ticketFor) }}
          attachments={ticketFor.attachmentId && ticketFor.attachmentName ? [{ id: ticketFor.attachmentId, filename: ticketFor.attachmentName }] : []}
          onCreated={(ticketId) => link.mutate({ sid: ticketFor.id, ticketId })} />
      )}
    </>
  );
}
