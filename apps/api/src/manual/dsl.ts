/**
 * Texto do manual → blocos da Central de Playbooks.
 * Formato (uma linha por instrução; parágrafos separados por linha em branco):
 *   # Título de seção          ## Subtítulo
 *   :::dica Título              (ou atencao, importante, exemplo) … até a linha ":::"
 *   [[CHAVE]]                  (blocos gerados do sistema)
 *   1) Etapa :: explicação      (linhas seguidas viram um bloco de etapas)
 *   ?? Pergunta  /  => Resposta (pares seguidos viram um FAQ)
 *   @ /tela Rótulo              (atalho para uma tela do sistema)
 *   | a | b |                   (linhas seguidas viram tabela; a primeira é o cabeçalho)
 *   ---                         (divisor)
 * O resto é texto com **negrito**, *itálico*, [link](/tela) e listas com "- ".
 */
import type { Block, CalloutKind } from '@isp/domain';

export function parseManual(slug: string, src: string, gens: Record<string, (id: () => string) => Block[]> = {}): Block[] {
  const out: Block[] = [];
  let n = 0;
  const id = () => `${slug}-${(n++).toString(36)}`;
  const lines = src.replace(/\r/g, '').split('\n');
  let para: string[] = [];
  const flush = () => { const t = para.join('\n').trim(); if (t) out.push({ id: id(), type: 'text', text: t }); para = []; };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const l = raw.trim();
    if (!l) { flush(); continue; }
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^(#{1,2})\s+(.+)$/))) { flush(); out.push({ id: id(), type: 'heading', level: m[1]!.length as 1 | 2, text: m[2]!.trim() }); continue; }
    if ((m = l.match(/^\[\[([A-Z_]+)\]\]$/))) { flush(); const g = gens[m[1]!]; if (!g) throw new Error(`Bloco gerado desconhecido: ${m[1]}`); out.push(...g(id)); continue; }
    if (l === '---') { flush(); out.push({ id: id(), type: 'divider' }); continue; }
    if ((m = l.match(/^:::(atencao|importante|exemplo|dica)\s*(.*)$/))) {
      flush();
      const body: string[] = [];
      while (++i < lines.length && lines[i]!.trim() !== ':::') body.push(lines[i]!.trim());
      out.push({ id: id(), type: 'callout', kind: m[1] as CalloutKind, ...(m[2] ? { title: m[2].trim() } : {}), text: body.join('\n').trim() });
      continue;
    }
    if ((m = l.match(/^@\s+(\/\S*)\s+(.+)$/))) { flush(); out.push({ id: id(), type: 'feature', path: m[1]!, label: m[2]!.trim() }); continue; }
    if (/^\d+\)\s/.test(l)) {
      flush();
      const items: { title: string; text?: string }[] = [];
      for (; i < lines.length && /^\d+\)\s/.test(lines[i]!.trim()); i++) {
        const [t, x] = lines[i]!.trim().replace(/^\d+\)\s+/, '').split(/\s+::\s+/);
        items.push({ title: t!.trim(), ...(x ? { text: x.trim() } : {}) });
      }
      i--;
      out.push({ id: id(), type: 'steps', items });
      continue;
    }
    if (l.startsWith('??')) {
      flush();
      const items: { q: string; a: string }[] = [];
      for (; i < lines.length && lines[i]!.trim().startsWith('??'); i++) {
        const q = lines[i]!.trim().slice(2).trim();
        const a: string[] = [];
        while (i + 1 < lines.length && lines[i + 1]!.trim().startsWith('=> ')) a.push(lines[++i]!.trim().slice(3).trim());
        items.push({ q, a: a.join('\n') });
      }
      i--;
      out.push({ id: id(), type: 'faq', items });
      continue;
    }
    if (l.startsWith('|')) {
      flush();
      const rows: string[][] = [];
      for (; i < lines.length && lines[i]!.trim().startsWith('|'); i++) rows.push(lines[i]!.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      i--;
      out.push({ id: id(), type: 'table', header: true, rows });
      continue;
    }
    para.push(l);
  }
  flush();
  return out;
}
