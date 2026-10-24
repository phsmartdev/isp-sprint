/**
 * Painel da sala da diretoria: só os indicadores, em tela inteira, ligado o dia todo.
 * Atualiza os dados a cada minuto, mantém a tela acesa, esconde o cursor parado e recarrega a página
 * de madrugada (pega versões novas do sistema sem ninguém mexer).
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { KpiBoard, useKpis } from '../features/kpis/KpiBoard';

export function KpiBoardPage() {
  const nav = useNavigate();
  const q = useKpis(undefined, 60_000);
  const [idle, setIdle] = useState(false);
  const timer = useRef<number>();
  useEffect(() => {
    document.title = 'Resultados da área · RevOps';
    const wake = async () => { try { await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<unknown> } }).wakeLock?.request('screen'); } catch { /* sem suporte: segue */ } };
    void wake();
    const vis = () => { if (document.visibilityState === 'visible') void wake(); };
    document.addEventListener('visibilitychange', vis);
    const move = () => { setIdle(false); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setIdle(true), 4000); };
    window.addEventListener('mousemove', move);
    move();
    // recarrega uma vez por dia, às 4h
    const reload = window.setInterval(() => { const n = new Date(); if (n.getHours() === 4 && n.getMinutes() < 2) window.location.reload(); }, 60_000);
    return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('mousemove', move); window.clearInterval(reload); window.clearTimeout(timer.current); };
  }, []);
  if (!q.data) {
    return <div className="kb kb-tv kb-scale" style={{ display: 'grid', placeItems: 'center' }}><p style={{ color: '#A9B4BE', fontSize: '1.4em' }}>{q.isError ? 'Não foi possível carregar os indicadores. Tentando de novo…' : 'Carregando indicadores…'}</p></div>;
  }
  return <KpiBoard d={q.data} updatedAt={q.dataUpdatedAt} error={q.isError} tv className={clsx(idle && 'kb-idle')} onExit={() => nav('/intelligence')} />;
}
