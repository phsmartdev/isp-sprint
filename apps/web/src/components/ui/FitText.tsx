/**
 * Número/valor de indicador que nunca quebra linha nem passa da borda: começa no tamanho da classe (máximo)
 * e diminui até caber na largura disponível. Recalcula quando o cartão muda de tamanho e quando a fonte carrega.
 * `width: 0; min-width: 100%` impede o texto de alargar a coluna do grid — quem manda é o cartão.
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import clsx from 'clsx';

export function FitText({ children, className, min = 12, as = 'p', title }: { children: ReactNode; className?: string; min?: number; as?: 'p' | 'span' | 'div' | 'dd'; title?: string }) {
  const ref = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = '';
      const max = parseFloat(getComputedStyle(el).fontSize) || 16;
      let size = max;
      // reduz até caber; para no mínimo legível
      for (let i = 0; i < 40 && el.scrollWidth > el.clientWidth + 0.5 && size > min; i++) { size = Math.max(min, size - Math.max(0.5, size * 0.06)); el.style.fontSize = `${size}px`; }
    };
    fit();
    // observa só a largura do contêiner (mudar a fonte não pode disparar outro ajuste em laço)
    let lastW = -1;
    const ro = new ResizeObserver((es) => { const w = Math.round(es[0]!.contentRect.width); if (w !== lastW) { lastW = w; fit(); } });
    ro.observe(el.parentElement ?? el);
    // o texto pode mudar sem mudar o tamanho da caixa (valor atualizado, ocultar valores)
    const mo = new MutationObserver(() => fit());
    mo.observe(el, { childList: true, characterData: true, subtree: true });
    void document.fonts?.ready.then(fit);
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [children, min]);
  const Tag = as as 'p';
  return (
    <Tag ref={ref as React.Ref<HTMLParagraphElement>} className={clsx('block overflow-hidden whitespace-nowrap', className)} style={{ width: 0, minWidth: '100%' }} title={title ?? (typeof children === 'string' || typeof children === 'number' ? String(children) : undefined)}>
      {children}
    </Tag>
  );
}
