import { describe, expect, it } from 'vitest';
import { structurePdf, type PdfLine } from './playbookImport';
import { contentErrors } from './playbooks';

const L = (page: number, y: number, text: string, size = 11, bold = false): PdfLine => ({ page, y, text, size, bold });
describe('importação de playbook em PDF', () => {
  it('títulos, parágrafos unidos, listas e passos; sem cabeçalho/rodapé e número de página', () => {
    const lines: PdfLine[] = [];
    for (const p of [1, 2, 3]) { lines.push(L(p, 820, 'Empresa Fictícia — Manual interno', 8)); lines.push(L(p, 20, `Página ${p} de 3`, 8)); }
    lines.push(
      L(1, 760, 'Playbook de Atendimento Fictício', 24, true),
      L(1, 700, '1. Objetivo', 16, true),
      L(1, 680, 'Este playbook orienta o time no primeiro', 11),
      L(1, 666, 'contato com o cliente.', 11),
      L(1, 640, 'Pontos de atenção', 11, true),
      L(1, 620, '• Confirmar o CNPJ', 11),
      L(1, 606, '• Registrar o contato no CRM com o', 11),
      L(1, 592, 'motivo da ligação', 11),
      L(2, 760, '2. Passo a passo', 16, true),
      L(2, 740, '1. Atender em até 2 toques', 11),
      L(2, 726, '2. Identificar a necessidade', 11),
      L(2, 712, 'com perguntas abertas', 11),
      L(2, 698, '3. Encerrar com resumo', 11),
      L(3, 760, 'Texto final de encerramento.', 11),
    );
    const r = structurePdf(lines);
    expect(r.title).toBe('Playbook de Atendimento Fictício');
    const b = r.content.blocks;
    expect(b.map((x) => x.type)).toEqual(['heading', 'text', 'heading', 'text', 'heading', 'steps', 'text']);
    expect(b[0]).toMatchObject({ type: 'heading', level: 1, text: 'Objetivo' });
    expect(b[1]).toMatchObject({ text: 'Este playbook orienta o time no primeiro contato com o cliente.' });
    expect(b[3]).toMatchObject({ text: '- Confirmar o CNPJ\n- Registrar o contato no CRM com o motivo da ligação' });
    expect((b[5] as { items: unknown[] }).items).toEqual([{ title: 'Atender em até 2 toques' }, { title: 'Identificar a necessidade', text: 'com perguntas abertas' }, { title: 'Encerrar com resumo' }]);
    expect(JSON.stringify(b)).not.toMatch(/Página|Manual interno/);
    expect(contentErrors(r.content)).toEqual([]);
  });
});
