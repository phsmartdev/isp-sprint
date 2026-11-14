/**
 * Ícones oficiais dos ODS (ONU Brasil, versão em português, em /public/ods) usados de forma informativa.
 * Cada ícone abre uma frase curta sobre a contribuição POTENCIAL da solução; não indica certificação nem endosso da ONU.
 */
import { useState } from 'react';
import clsx from 'clsx';

export type OdsItem = { n: number; title: string; text: string };

/** Visão institucional da BKT (slide "A BKT em Sergipe"): os mesmos ODS das soluções, em frases gerais. */
export const ODS_BKT: OdsItem[] = [
  { n: 7, title: 'Energia limpa e acessível', text: 'Redes ópticas passivas reduzem a necessidade de energia na distribuição.' },
  { n: 9, title: 'Indústria, inovação e infraestrutura', text: 'Infraestrutura de fibra óptica para Sergipe evoluir.' },
  { n: 11, title: 'Cidades e comunidades sustentáveis', text: 'Conectividade para cidades mais bem planejadas e cuidadas.' },
  { n: 12, title: 'Consumo e produção responsáveis', text: 'Menos equipamentos e materiais para fazer mais.' },
  { n: 16, title: 'Paz, justiça e instituições eficazes', text: 'Instituições públicas integradas e mais ágeis.' },
  { n: 17, title: 'Parcerias e meios de implementação', text: 'Parcerias entre o poder público e quem opera a rede.' },
];

/** Fileira discreta de ícones; o painel explicativo abre ao passar o mouse ou clicar. */
export function OdsBar({ items, show, delay = 0, size = 52, drop = 'up', align = 'left', className, onTouch }: { items: OdsItem[]; show: boolean; delay?: number; size?: number; drop?: 'up' | 'down'; align?: 'left' | 'right'; className?: string; onTouch?: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const cur = items.find((o) => o.n === open);
  return (
    <div className={clsx('absolute transition-[opacity,transform] duration-700 motion-reduce:transition-none', show ? 'opacity-100' : 'pointer-events-none translate-y-1 opacity-0', className)} style={{ transitionDelay: show ? `${delay}s` : '0s' }} onPointerLeave={() => setOpen(null)}>
      <p className={clsx('mb-1.5 text-[10.5px] font-semibold tracking-[0.18em] text-white/50', align === 'right' && 'text-right')}>ODS · CONTRIBUIÇÃO POTENCIAL</p>
      <ul className={clsx('flex gap-1.5', align === 'right' && 'justify-end')} aria-label="Objetivos de Desenvolvimento Sustentável relacionados">
        {items.map((o, k) => (
          <li key={o.n}>
            <button type="button" aria-expanded={open === o.n} aria-label={`ODS ${o.n} · ${o.title}`} onPointerEnter={() => setOpen(o.n)} onClick={() => { setOpen(open === o.n ? null : o.n); onTouch?.(); }}
              className={clsx('block transition-[transform,opacity,box-shadow] duration-500 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white', show ? 'opacity-100' : 'opacity-0', open === o.n ? 'shadow-[0_0_0_2px_#fff]' : open !== null && 'opacity-60')}
              style={{ width: size, height: size, transitionDelay: show && open === null ? `${delay + 0.15 * k}s` : '0s' }}>
              <img src={`/ods/ods-${o.n}.svg`} alt="" width={size} height={size} draggable={false} className="h-full w-full" />
            </button>
          </li>
        ))}
      </ul>
      {cur && (
        <div role="tooltip" className={clsx('absolute z-20 w-[300px] border border-white/15 bg-[#07101A]/95 px-4 py-3 shadow-[0_14px_36px_rgba(0,0,0,0.55)] backdrop-blur-md', drop === 'up' ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]', align === 'right' ? 'right-0' : 'left-0')}>
          <p className="text-[12px] font-semibold tracking-[0.08em] text-white">ODS {cur.n} · {cur.title}</p>
          <p className="mt-1 text-[13px] leading-snug text-white/75">{cur.text}</p>
          <p className="mt-2 text-[10px] text-white/40">Ícones oficiais da ONU, uso informativo; não indica certificação nem endosso.</p>
        </div>
      )}
    </div>
  );
}
