import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { fmtDuration } from '../lib/format';

const GOAL_MIN = 7;

/** Régua de 7 minutos (sete barras de sinal). Depois da meta segue contando, em âmbar; nunca encerra o atendimento. */
export function SprintTimer({ startedAt, baseSeconds, running }: { startedAt: string | null; baseSeconds: number; running: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const live = running && startedAt ? Math.max(0, (now - new Date(startedAt).getTime()) / 1000) : 0;
  const elapsed = baseSeconds + live;
  const minutes = elapsed / 60;
  const over = minutes >= GOAL_MIN;
  return (
    <div className="card flex items-center gap-3 px-4 py-2.5" role="timer" aria-live="off" aria-label={`Tempo de atendimento ${fmtDuration(elapsed)}, meta de ${GOAL_MIN} minutos`}>
      <div className="flex h-8 items-end gap-[3px]" aria-hidden>
        {Array.from({ length: GOAL_MIN }).map((_, i) => {
          const fill = Math.min(1, Math.max(0, minutes - i));
          return (
            <div key={i} className="relative w-[7px] overflow-hidden rounded-none bg-[#E5EAF3]" style={{ height: `${11 + i * 3}px` }}>
              <div className={clsx('absolute inset-x-0 bottom-0', over ? 'bg-warning' : 'bg-lime')} style={{ height: `${fill * 100}%` }} />
            </div>
          );
        })}
      </div>
      <div className="leading-tight">
        <p className={clsx('num text-lg font-extrabold', over ? 'text-warning' : 'text-ink')}>{fmtDuration(elapsed)}</p>
        <p className="text-xs text-muted">{running ? (over ? 'Meta de 7 min ultrapassada — siga no seu ritmo' : 'Meta de decisão: 7 min') : 'Tempo registrado'}</p>
      </div>
    </div>
  );
}
