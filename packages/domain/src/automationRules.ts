/**
 * Exceções das automações das jornadas: a automação NÃO roda quando a oportunidade bate com qualquer exceção.
 * Ex.: "Venda fechada → duplicar no Sucesso do Cliente", exceto tipo de venda = Consumo de Contrato
 * (fica só no histórico da conta).
 */
export type ExceptionRule = { campo: 'tipo_venda' | 'segmento' | 'natureza' | 'filial' | 'valor_ate' | 'valor_acima'; valores?: string[]; valor?: number | null };
export type ExceptionSubject = { saleKind: string | null; segment: string | null; nature: string | null; branchId: string | null; valueCents: number | null };

const LABEL: Record<ExceptionRule['campo'], string> = { tipo_venda: 'tipo de venda', segmento: 'segmento', natureza: 'natureza da conta', filial: 'filial', valor_ate: 'valor até', valor_acima: 'valor acima de' };

/** Primeira exceção que bate (texto do motivo) ou null. */
export function exceptionHit(rules: ExceptionRule[] | undefined | null, o: ExceptionSubject): string | null {
  for (const r of rules ?? []) {
    const v = r.valores ?? [];
    const val = (o.valueCents ?? 0) / 100;
    switch (r.campo) {
      case 'tipo_venda': if (o.saleKind && v.includes(o.saleKind)) return `exceção: ${LABEL[r.campo]} = ${o.saleKind}`; break;
      case 'segmento': if (o.segment && v.includes(o.segment)) return `exceção: ${LABEL[r.campo]} = ${o.segment}`; break;
      case 'natureza': if (o.nature && v.includes(o.nature)) return `exceção: ${LABEL[r.campo]} = ${o.nature}`; break;
      case 'filial': if (o.branchId && v.includes(o.branchId)) return `exceção: ${LABEL[r.campo]}`; break;
      case 'valor_ate': if (r.valor != null && val <= r.valor) return `exceção: ${LABEL[r.campo]} R$ ${r.valor}`; break;
      case 'valor_acima': if (r.valor != null && val > r.valor) return `exceção: ${LABEL[r.campo]} R$ ${r.valor}`; break;
    }
  }
  return null;
}
