/**
 * Jornada Viva do Cliente — visualização 3D (protótipo). Camada de CONSULTA sobre os dados existentes do Sucesso do
 * Cliente: não grava nada, não muda etapa, marco ou tarefa. Textos e números ficam nos painéis HTML; a cena 3D só
 * representa visualmente a jornada. Tour automático (~30 s) que para ao interagir e volta após 15 s.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Crosshair, Minus, Pause, Play, Plus, RotateCcw, RotateCw, X } from 'lucide-react';
import { DEFAULT_CS_CONFIG } from '@isp/domain';
import { fmtDate } from '../../../lib/format';
import { EXP_TEXT, HEALTH_TEXT, MACRO, MICRO, healthState, stateAt, type JEvent, type JModel } from './model';
import { ENV_CX, HEALTH_COLOR, JourneyScene, ST, type Cam, type Pick } from './Scene';

const HOME: Cam = { cx: 54, zoom: 0.86, yaw: 26 };
const LIM = { cx: [0, 110], zoom: [0.7, 2.2], yaw: [6, 50] } as const;
const clamp = (v: number, [a, b]: readonly [number, number]) => Math.max(a, Math.min(b, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const IDLE = 15000;
const NA = 'Dado não disponível';
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const EVENT_COLOR: Record<JEvent['kind'], string> = { inicio: '#E6FBFF', etapa: '#60D3FF', marco: '#34D399', reuniao: '#A78BFA', visita: '#A78BFA', contato: '#818CF8', feedback: '#F472B6', saude: '#FBBF24', ocorrencia: '#F87171', renovacao: '#FBBF24', expansao: '#2DD4BF', contrato: '#94A3B8' };
const EVENT_LABEL: Record<JEvent['kind'], string> = { inicio: 'Início', etapa: 'Etapa', marco: 'Marco', reuniao: 'Reunião', visita: 'Visita', contato: 'Contato', feedback: 'Feedback', saude: 'Saúde', ocorrencia: 'Ocorrência', renovacao: 'Renovação', expansao: 'Expansão', contrato: 'Contrato' };

/** roteiro do tour: visão geral → onboarding → marcos → ongoing → situação atual → expansão → visão geral */
function tourKeys(cur: number | null): { t: number; c: Cam }[] {
  const curX = cur === null ? 63 : ST[cur]![0];
  return [
    { t: 0, c: HOME }, { t: 4, c: { cx: 14, zoom: 1.45, yaw: 20 } }, { t: 9, c: { cx: 33, zoom: 1.45, yaw: 34 } }, { t: 13.5, c: { cx: 60, zoom: 1.3, yaw: 28 } },
    { t: 18.5, c: { cx: curX, zoom: 1.7, yaw: 22 } }, { t: 22.5, c: { cx: curX, zoom: 1.6, yaw: 36 } }, { t: 27, c: { cx: 97, zoom: 1.45, yaw: 30 } }, { t: 32, c: HOME },
  ];
}
function camAt(keys: { t: number; c: Cam }[], t: number): Cam {
  const T = keys[keys.length - 1]!.t, x = t % T;
  const i = Math.max(0, keys.findIndex((k, n) => n < keys.length - 1 && x >= k.t && x < keys[n + 1]!.t));
  const a = keys[i]!, b = keys[i + 1] ?? a, k = ease((x - a.t) / Math.max(0.001, b.t - a.t));
  return { cx: a.c.cx + (b.c.cx - a.c.cx) * k, zoom: a.c.zoom + (b.c.zoom - a.c.zoom) * k, yaw: a.c.yaw + (b.c.yaw - a.c.yaw) * k };
}

function Kpi({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return <div className="min-w-0 border-l border-white/10 px-3 py-2 first:border-l-0"><p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/45">{label}</p><p className={clsx('mt-0.5 truncate text-[13.5px] font-semibold', tone ?? 'text-white')}>{value}</p></div>;
}
function Row({ k, v }: { k: string; v: ReactNode }) { return <div className="flex justify-between gap-3 border-b border-white/5 py-1.5 text-[12.5px]"><span className="text-white/50">{k}</span><span className="text-right text-white/90">{v}</span></div>; }

export function Journey3D({ model, onExit }: { model: JModel; onExit?: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [cam, setCam] = useState<Cam>(HOME);
  const [touring, setTouring] = useState(!reduced);
  const [sel, setSel] = useState<Pick | null>(null);
  const [date, setDate] = useState<string | null>(null);   // null = presente
  const last = useRef(0), t0 = useRef(performance.now()), wrap = useRef<HTMLDivElement>(null), visible = useRef(true);
  const known = stateAt(model, date);
  const keys = useMemo(() => tourKeys(known.micro), [known.micro]);
  const touch = useCallback(() => { last.current = Date.now(); setTouring(false); }, []);

  // tour: anima a câmera; suspende quando a cena sai da tela ou a aba fica oculta
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => { visible.current = !!e?.isIntersecting; });
    if (wrap.current) io.observe(wrap.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!touring || reduced) return;
    let raf = 0;
    const loop = (now: number) => { if (visible.current && !document.hidden) setCam(camAt(keys, (now - t0.current) / 1000)); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [touring, keys, reduced]);
  // depois de 15 s sem interação, o tour volta suavemente da visão geral
  useEffect(() => {
    if (touring || reduced) return;
    const id = setInterval(() => { if (last.current && Date.now() - last.current > IDLE && !sel) { t0.current = performance.now(); setTouring(true); } }, 1000);
    return () => clearInterval(id);
  }, [touring, sel, reduced]);

  const move = (f: (c: Cam) => Cam) => { touch(); setCam((c) => { const n = f(c); return { cx: clamp(n.cx, LIM.cx), zoom: clamp(n.zoom, LIM.zoom), yaw: clamp(n.yaw, LIM.yaw) }; }); };
  const center = () => { touch(); setSel(null); setCam(HOME); };
  const pick = (p: Pick) => { touch(); setSel(p); if (p.t === 'micro') setCam((c) => ({ ...c, cx: ST[p.i]![0], zoom: Math.max(c.zoom, 1.5) })); };
  // arrastar = mover pela jornada (horizontal) e girar (vertical); roda = zoom
  const drag = useRef<{ x: number; y: number; c: Cam } | null>(null);
  const onDown = (e: React.PointerEvent) => { if ((e.target as Element).closest('[role="button"]')) return; drag.current = { x: e.clientX, y: e.clientY, c: cam }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); touch(); };
  const onMove = (e: React.PointerEvent) => { const d = drag.current; if (!d) return; const k = 1 / (9.2 * d.c.zoom) * (1200 / (wrap.current?.clientWidth || 1200)); setCam({ cx: clamp(d.c.cx - (e.clientX - d.x) * k, LIM.cx), zoom: d.c.zoom, yaw: clamp(d.c.yaw + (e.clientY - d.y) * 0.12, LIM.yaw) }); };
  const onUp = () => { drag.current = null; };
  const onWheel = (e: React.WheelEvent) => { move((c) => ({ ...c, zoom: c.zoom * (e.deltaY > 0 ? 0.92 : 1.08) })); };

  const microNow = known.micro;
  const hScore = known.healthScore, hs = healthState(hScore);
  const risksOpen = date ? [] : model.risks;
  const riskLevel = risksOpen.some((r) => r.level === 'risco') ? 'risco' : risksOpen.length ? 'atencao' : null;
  const nextM = model.milestones.filter((m) => !m.doneAt && m.plannedAt && m.plannedAt >= today).sort((a, b) => a.plannedAt!.localeCompare(b.plannedAt!))[0];
  const renewalNear = model.account.daysToEnd !== null && model.account.daysToEnd >= 0 && model.account.daysToEnd <= DEFAULT_CS_CONFIG.alerts.renewalDays;
  const expansionAt = date ? model.expansion.filter((x) => x.at && x.at <= date) : model.expansion;
  const pending = model.tasks.length, late = model.tasks.filter((t) => t.late).length;
  // indicadores sempre no presente; a cena pode mostrar uma data passada
  const macroNow = model.stage.micro === null ? null : MICRO[model.stage.micro]!.macro;
  const macroScene = microNow === null ? null : MICRO[microNow]!.macro;

  // linha do tempo
  const t0d = model.events[0]?.at ?? model.account.since ?? today;
  const span = Math.max(1, days(t0d, today));
  const pos = (d: string) => Math.max(0, Math.min(1, days(t0d, d) / span));
  const dayFromPos = (p: number) => { const d = new Date(t0d + 'T12:00:00'); d.setDate(d.getDate() + Math.round(p * span)); return d.toISOString().slice(0, 10); };

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#060B12] text-white" ref={wrap}>
      {model.demo && <p className="bg-[#FBBF24] px-4 py-1.5 text-center text-[12px] font-bold tracking-[0.18em] text-[#1A1206]">AMBIENTE DEMONSTRATIVO — DADOS FICTÍCIOS</p>}
      {/* visão operacional do CSM */}
      <div className="grid grid-cols-2 border-b border-white/10 bg-[#0A121C] sm:grid-cols-4 lg:grid-cols-7">
        <Kpi label="Cliente" value={model.account.name} />
        <Kpi label="CSM" value={model.account.csm ?? NA} tone={model.account.csm ? undefined : 'text-white/45'} />
        <Kpi label="Etapa atual" value={model.stage.name ? `${macroNow !== null ? MACRO[macroNow]!.name + ' · ' : ''}${model.stage.name}` : NA} tone={model.stage.name ? 'text-[#BFE8FF]' : 'text-white/45'} />
        <Kpi label="Relacionamento" value={model.account.relationshipMonths !== null ? `${model.account.relationshipMonths} meses` : model.account.since ? `desde ${fmtDate(model.account.since)}` : NA} />
        <Kpi label="Health Score" value={<span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: HEALTH_COLOR[healthState(model.health.score)] }} />{model.health.score ?? NA}</span>} />
        <Kpi label="NPS" value={model.nps ? `${model.nps.score}/${model.nps.scale}` : NA} tone={model.nps ? undefined : 'text-white/45'} />
        <Kpi label="Renovação" value={model.account.renewalAt ? `${fmtDate(model.account.renewalAt)}${model.account.daysToEnd !== null ? ` · ${model.account.daysToEnd} d` : ''}` : NA} tone={renewalNear ? 'text-[#FDE68A]' : model.account.renewalAt ? undefined : 'text-white/45'} />
        <Kpi label="Contratos" value={model.account.contracts.length ? model.account.contracts.map((c) => c.number).join(', ') : NA} />
        <Kpi label="Próxima interação" value={model.nextInteraction ? `${fmtDate(model.nextInteraction.at)} · ${model.nextInteraction.title}` : NA} />
        <Kpi label="Tarefas pendentes" value={`${pending}${late ? ` · ${late} atrasada${late > 1 ? 's' : ''}` : ''}`} tone={late ? 'text-[#FDE68A]' : undefined} />
        <Kpi label="Riscos abertos" value={model.risks.length} tone={model.risks.length ? (model.risks.some((r) => r.level === 'risco') ? 'text-[#FCA5A5]' : 'text-[#FDE68A]') : undefined} />
        <Kpi label="Adoção" value={model.adoption?.text ?? NA} tone={model.adoption ? undefined : 'text-white/45'} />
        <Kpi label="Macroetapa" value={macroNow !== null ? `${MACRO[macroNow]!.name} · ${MACRO[macroNow]!.ref}` : NA} />
        <Kpi label="Atualizado" value={model.health.at ? fmtDate(model.health.at) : NA} />
      </div>
      {model.stage.unmatched && <p className="border-b border-white/10 bg-[#1A1206] px-4 py-2 text-[12.5px] text-[#FDE68A]">A etapa registrada no funil (“{model.stage.name}”) não corresponde a nenhuma das 7 microetapas do playbook; a cena não posiciona a conta em uma microetapa.</p>}

      <div className="relative h-[560px] select-none touch-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
        <JourneyScene cam={cam} reduced={reduced} sel={sel} onPick={pick}
          st={{ micro: microNow, healthScore: hScore, doneIds: known.doneIds, milestones: model.milestones, riskLevel, renewalNear: renewalNear && !date, expansion: expansionAt, nextMilestoneId: nextM?.id ?? null, today: date ?? today, historical: !!date }} />
        {/* controles de câmera */}
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" className="j3-btn" onClick={() => { if (touring) touch(); else { t0.current = performance.now(); setTouring(true); } }} aria-pressed={touring} disabled={reduced}>{touring ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}{touring ? 'Pausar tour' : 'Tour'}</button>
          <button type="button" className="j3-btn" onClick={center}><Crosshair className="h-3.5 w-3.5" aria-hidden />CENTRALIZAR JORNADA</button>
          {MACRO.map((m, i) => <button key={m.key} type="button" className={clsx('j3-btn', macroScene === i && 'border-[#60D3FF]/60')} onClick={() => move((c) => ({ ...c, cx: ENV_CX[i]!, zoom: 1.35 }))}>{m.name}</button>)}
          <button type="button" className="j3-btn" aria-label="Aproximar" onClick={() => move((c) => ({ ...c, zoom: c.zoom * 1.15 }))}><Plus className="h-3.5 w-3.5" /></button>
          <button type="button" className="j3-btn" aria-label="Afastar" onClick={() => move((c) => ({ ...c, zoom: c.zoom / 1.15 }))}><Minus className="h-3.5 w-3.5" /></button>
          <button type="button" className="j3-btn" aria-label="Girar para a esquerda" onClick={() => move((c) => ({ ...c, yaw: c.yaw - 6 }))}><RotateCcw className="h-3.5 w-3.5" /></button>
          <button type="button" className="j3-btn" aria-label="Girar para a direita" onClick={() => move((c) => ({ ...c, yaw: c.yaw + 6 }))}><RotateCw className="h-3.5 w-3.5" /></button>
          {onExit && <button type="button" className="j3-btn" onClick={onExit}>Visualização tradicional</button>}
        </div>
        <ul className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/55" aria-label="Legenda">
          <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#34D399]" />Concluído / saudável</li>
          <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#FBBF24]" />Atenção / atrasado</li>
          <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#F87171]" />Risco</li>
          <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-dashed border-[#8FE3FF]" />Possibilidade</li>
          <li>Arraste para mover e girar · roda para zoom</li>
        </ul>
        {date && <p className="absolute right-3 top-3 rounded-md border border-[#FBBF24]/50 bg-[#1A1206]/90 px-3 py-1.5 text-[12px] text-[#FDE68A]">Estado registrado em {fmtDate(date)}{known.knownStage ? ` · etapa ${known.knownStage}` : ' · sem registro de etapa até esta data'}</p>}

        {/* painel de detalhes */}
        {sel && (
          <aside className="absolute bottom-3 right-3 top-3 w-[350px] overflow-y-auto rounded-lg border border-white/15 bg-[#07101A]/95 p-4 shadow-[0_18px_40px_rgba(0,0,0,0.55)] backdrop-blur-md" onPointerDown={(e) => e.stopPropagation()} aria-label="Detalhes">
            <button type="button" onClick={() => setSel(null)} className="absolute right-2 top-2 p-1 text-white/60 hover:text-white" aria-label="Fechar"><X className="h-4 w-4" /></button>
            <Detail sel={sel} model={model} today={today} microNow={microNow} />
          </aside>
        )}
      </div>

      {/* linha do tempo */}
      <div className="border-t border-white/10 bg-[#0A121C] px-4 pb-3 pt-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Linha do tempo · {model.events.length ? `${model.events.length} eventos registrados` : 'sem eventos registrados'}</p>
          <button type="button" className={clsx('j3-btn', !date && 'opacity-40')} disabled={!date} onClick={() => { setDate(null); touch(); }}>VOLTAR AO PRESENTE</button>
        </div>
        <div className="relative h-9">
          <div className="absolute inset-x-0 top-4 h-px bg-white/15" />
          {MACRO.map((m, i) => { const first = model.stageHistory.find((h) => h.micro !== null && MICRO[h.micro]!.macro === i); return first ? <span key={m.key} className="absolute top-0 -translate-x-1/2 text-[9.5px] font-semibold tracking-[0.1em] text-white/40" style={{ left: `${Math.min(94, Math.max(4, pos(first.at) * 100))}%` }}>{m.name.toUpperCase()}</span> : null; })}
          {model.events.map((e, i) => <button key={i} type="button" title={`${fmtDate(e.at)} · ${EVENT_LABEL[e.kind]}: ${e.title}`} aria-label={`${fmtDate(e.at)} · ${e.title}`} onClick={() => { touch(); setDate(e.at); }} className="absolute top-[11px] h-2.5 w-2.5 -translate-x-1/2 rounded-full border border-black/40 hover:scale-150" style={{ left: `${pos(e.at) * 100}%`, background: EVENT_COLOR[e.kind] }} />)}
          {date && <span className="absolute top-1 h-7 w-0.5 -translate-x-1/2 bg-[#FBBF24]" style={{ left: `${pos(date) * 100}%` }} />}
        </div>
        <input type="range" min={0} max={1000} value={Math.round(pos(date ?? today) * 1000)} onChange={(e) => { touch(); const d = dayFromPos(+e.target.value / 1000); setDate(d >= today ? null : d); }} className="w-full accent-[#60D3FF]" aria-label="Data na linha do tempo" />
        <div className="flex justify-between text-[11px] text-white/45"><span>{fmtDate(t0d)}</span><span>{date ? fmtDate(date) : 'Hoje'}</span><span>{fmtDate(today)}</span></div>
      </div>
    </div>
  );
}

function Detail({ sel, model, today, microNow }: { sel: Pick; model: JModel; today: string; microNow: number | null }) {
  if (sel.t === 'micro') {
    const m = MICRO[sel.i]!, entries = model.stageHistory.filter((h) => h.micro === sel.i);
    const status = microNow === null ? 'Sem registro de etapa' : sel.i < microNow ? 'Concluída' : sel.i === microNow ? 'Etapa atual' : 'Ainda não iniciada';
    const ms = model.milestones.filter((x) => x.micro === sel.i);
    const entered = sel.i === microNow ? model.stage.enteredAt ?? entries[entries.length - 1]?.at ?? null : entries[entries.length - 1]?.at ?? null;
    const owners = [...new Set(ms.map((x) => x.owner).filter(Boolean))];
    const nextActs = model.tasks.filter((t) => t.micro === sel.i && !t.late).slice(0, 4);
    return (
      <div>
        <p className="text-[11px] font-semibold tracking-[0.16em] text-[#60D3FF]">{MACRO[m.macro]!.name.toUpperCase()} · MICROETAPA {sel.i + 1}</p>
        <p className="mt-1 text-[18px] font-bold">{m.name}</p>
        <p className="mt-1 text-[12.5px] text-white/65">{m.goal}</p>
        <div className="mt-3"><Row k="Situação" v={status} /><Row k="Data de entrada" v={entered ? fmtDate(entered) : NA} /><Row k="Tempo na etapa" v={sel.i === microNow && entered ? `${days(entered, today)} dias` : sel.i === microNow ? NA : '—'} /><Row k="Responsáveis" v={owners.length ? owners.join(', ') : NA} /></div>
        <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">Marcos relacionados</p>
        {ms.length ? <ul className="mt-1 space-y-1 text-[12.5px]">{ms.map((x) => <li key={x.id} className="flex justify-between gap-2"><span className={x.doneAt ? 'text-[#86EFAC]' : x.plannedAt && x.plannedAt < today ? 'text-[#FDE68A]' : 'text-white/85'}>{x.doneAt ? '✓ ' : ''}{x.title}</span><span className="flex-none text-white/45">{x.doneAt ? fmtDate(x.doneAt) : x.plannedAt ? fmtDate(x.plannedAt) : '—'}</span></li>)}</ul> : <p className="text-[12.5px] text-white/45">{NA}</p>}
        <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">Próximas ações</p>
        {nextActs.length ? <ul className="mt-1 space-y-1 text-[12.5px] text-white/85">{nextActs.map((t, i) => <li key={i}>{t.title}{t.at ? ` · ${fmtDate(t.at)}` : ''}</li>)}</ul> : <p className="text-[12.5px] text-white/45">{NA}</p>}
        <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">Riscos associados</p>
        {sel.i === microNow && model.risks.length ? <ul className="mt-1 space-y-1 text-[12.5px]">{model.risks.map((r, i) => <li key={i} className={r.level === 'risco' ? 'text-[#FCA5A5]' : 'text-[#FDE68A]'}>{r.title}</li>)}</ul> : <p className="text-[12.5px] text-white/45">Nenhum risco aberto ligado a esta etapa.</p>}
        <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">Histórico</p>
        {entries.length ? <ul className="mt-1 space-y-1 text-[12px] text-white/70">{entries.map((h, i) => <li key={i}>{fmtDate(h.at)} · entrada na etapa{h.who ? ` · ${h.who}` : ''}</li>)}</ul> : <p className="text-[12.5px] text-white/45">Sem registro de entrada nesta etapa.</p>}
      </div>
    );
  }
  if (sel.t === 'milestone') {
    const m = model.milestones.find((x) => x.id === sel.id);
    if (!m) return null;
    const status = m.doneAt ? 'Concluído' : m.plannedAt && m.plannedAt < today ? 'Atrasado' : 'Previsto';
    return (
      <div>
        <p className="text-[11px] font-semibold tracking-[0.16em] text-[#60D3FF]">MARCO DA JORNADA · {MICRO[m.micro]!.name.toUpperCase()}</p>
        <p className="mt-1 text-[17px] font-bold">{m.title}</p>
        <div className="mt-3"><Row k="Tipo de evento" v="Marco do modelo de jornada" /><Row k="Status" v={status} /><Row k="Data" v={m.doneAt ? `Realizado em ${fmtDate(m.doneAt)}` : m.plannedAt ? `Previsto para ${fmtDate(m.plannedAt)}` : NA} /><Row k="Responsável" v={m.owner ?? NA} /><Row k="Contrato" v={m.contract ?? NA} /><Row k="Evidências" v={NA} /><Row k="Tarefas relacionadas" v={NA} /></div>
        <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">Descrição</p>
        <p className="mt-1 text-[12.5px] text-white/80">{m.notes ?? NA}</p>
        <p className="mt-3 text-[11px] text-white/40">Consulta: concluir ou reprogramar o marco continua sendo feito na visualização tradicional.</p>
      </div>
    );
  }
  if (sel.t === 'health') {
    const hs = healthState(model.health.score);
    return (
      <div>
        <p className="text-[11px] font-semibold tracking-[0.16em] text-[#60D3FF]">SAÚDE DA CONTA</p>
        <p className="mt-1 flex items-center gap-2 text-[22px] font-bold"><span className="h-3 w-3 rounded-full" style={{ background: HEALTH_COLOR[hs] }} />{model.health.score ?? '—'} <span className="text-[14px] font-semibold text-white/70">{HEALTH_TEXT[hs]}</span></p>
        <div className="mt-3"><Row k="Última avaliação" v={model.health.at ? fmtDate(model.health.at) : NA} /><Row k="NPS" v={model.nps ? `${model.nps.score}/${model.nps.scale} · ${fmtDate(model.nps.at)}` : NA} /><Row k="Nível de adoção" v={model.adoption?.text ?? NA} /><Row k="Origem dos dados" v={model.demo ? 'Demonstração (fictício)' : 'Health Score do Sucesso do Cliente (pesos da configuração)'} /></div>
        <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">Evolução registrada</p>
        {model.health.history.length ? (
          <svg viewBox="0 0 300 60" className="mt-1 w-full" aria-label="Evolução do Health Score">
            <polyline fill="none" stroke="#60D3FF" strokeWidth="2" points={model.health.history.map((h, i) => `${(i / Math.max(1, model.health.history.length - 1)) * 290 + 5},${55 - ((h.score ?? 0) / 100) * 50}`).join(' ')} />
            {model.health.history.map((h, i) => <circle key={i} cx={(i / Math.max(1, model.health.history.length - 1)) * 290 + 5} cy={55 - ((h.score ?? 0) / 100) * 50} r="2.5" fill="#E6FBFF"><title>{`${fmtDate(h.at)} · ${h.score ?? '—'}`}</title></circle>)}
          </svg>
        ) : <p className="text-[12.5px] text-white/45">{NA}</p>}
        <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">Fatores</p>
        {model.health.parts.length ? <ul className="mt-1 space-y-1 text-[12.5px]">{model.health.parts.map((p) => <li key={p.key} className="flex justify-between"><span className="text-white/70">{p.key}</span><span className={p.value === null ? 'text-white/40' : p.value >= 75 ? 'text-[#86EFAC]' : p.value >= 50 ? 'text-[#FDE68A]' : 'text-[#FCA5A5]'}>{p.value ?? 'sem dado'}</span></li>)}</ul> : <p className="text-[12.5px] text-white/45">{NA}</p>}
        <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">Sinais de risco</p>
        {model.risks.length ? <ul className="mt-1 space-y-1 text-[12.5px]">{model.risks.map((r, i) => <li key={i} className={r.level === 'risco' ? 'text-[#FCA5A5]' : 'text-[#FDE68A]'}>{r.title} <span className="text-white/40">· {r.source}</span></li>)}</ul> : <p className="text-[12.5px] text-white/45">Nenhum sinal de risco aberto.</p>}
      </div>
    );
  }
  if (sel.t === 'risks') return (
    <div>
      <p className="text-[11px] font-semibold tracking-[0.16em] text-[#FCA5A5]">RISCOS ABERTOS</p>
      <ul className="mt-2 space-y-2">{model.risks.map((r, i) => <li key={i} className="rounded-md border border-white/10 p-2.5 text-[12.5px]"><p className={clsx('font-semibold', r.level === 'risco' ? 'text-[#FCA5A5]' : 'text-[#FDE68A]')}>{r.title}</p><p className="mt-0.5 text-white/50">{r.source}{r.since ? ` · desde ${fmtDate(r.since)}` : ''}</p></li>)}</ul>
      <p className="mt-3 text-[11px] text-white/40">Riscos vêm dos alertas e das ocorrências/planos abertos do Sucesso do Cliente. Tratamento continua com as equipes responsáveis (suporte, engenharia, financeiro…).</p>
    </div>
  );
  if (sel.t === 'renewal') return (
    <div>
      <p className="text-[11px] font-semibold tracking-[0.16em] text-[#FDE68A]">RENOVAÇÃO</p>
      <div className="mt-2"><Row k="Próximo fim de vigência" v={model.account.renewalAt ? fmtDate(model.account.renewalAt) : NA} /><Row k="Dias até o fim" v={model.account.daysToEnd ?? NA} /><Row k="Janela de alerta" v={`${DEFAULT_CS_CONFIG.alerts.renewalDays} dias (configuração padrão)`} /></div>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">Contratos</p>
      {model.account.contracts.length ? <ul className="mt-1 space-y-1 text-[12.5px] text-white/80">{model.account.contracts.map((c) => <li key={c.number}>{c.number}{c.endAt ? ` · até ${fmtDate(c.endAt)}` : ''}</li>)}</ul> : <p className="text-[12.5px] text-white/45">{NA}</p>}
      {model.expansion.filter((x) => x.state === 'renovacao').map((x, i) => <p key={i} className="mt-2 text-[12.5px] text-[#FDE68A]">{EXP_TEXT[x.state]} · {x.title}</p>)}
    </div>
  );
  const e = model.expansion[sel.i];
  return e ? (
    <div>
      <p className="text-[11px] font-semibold tracking-[0.16em] text-[#2DD4BF]">EXPANSÃO</p>
      <p className="mt-1 text-[17px] font-bold">{e.title}</p>
      <div className="mt-2"><Row k="Situação" v={EXP_TEXT[e.state]} /><Row k="Data" v={e.at ? fmtDate(e.at) : NA} /><Row k="Valor" v={e.valueCents ? (e.valueCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : NA} /></div>
      <p className="mt-3 text-[11px] text-white/40">{e.state === 'contratada' || e.state === 'novo_ciclo' ? 'Resultado registrado no CRM.' : 'Possibilidade: oportunidade comercial, não é resultado confirmado.'}</p>
    </div>
  ) : null;
}
