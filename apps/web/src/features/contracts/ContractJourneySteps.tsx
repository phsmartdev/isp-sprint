/**
 * Jornada do contrato em etapas (simples para o time): onde o contrato está, o que já passou e o que fazer agora.
 * Cadastro e validação → Implantação → Vigência → Renovação ou reajuste → Encerramento.
 */
import clsx from 'clsx';
import { Check } from 'lucide-react';
import type { ContractStage } from '@isp/domain';

const STEPS: { key: string; label: string; stages: ContractStage[]; todo: string }[] = [
  { key: 'cadastro', label: 'Cadastro e validação', stages: ['cadastro_validacao'], todo: 'Confira os dados e clique em "Validar cadastro". A validação dispara ERP, provisionamento e implantação.' },
  { key: 'implantacao', label: 'Implantação', stages: ['implantacao'], todo: 'Siga a aba Processos: cadastro no ERP, provisionamento do faturamento, contrato assinado, ativação técnica e início do faturamento.' },
  { key: 'vigencia', label: 'Vigência', stages: ['vigente'], todo: 'Contrato em execução: acompanhe pendências, relatórios, empenhos e aditivos. A renovação e o reajuste abrem sozinhos antes do prazo.' },
  { key: 'renovacao', label: 'Renovação ou reajuste', stages: ['renovacao', 'reajuste'], todo: 'Há um processo aberto (aba Processos): conclua cada etapa. Ao terminar, o contrato volta para Vigência.' },
  { key: 'encerramento', label: 'Encerramento', stages: ['encerramento', 'arquivado'], todo: 'Conclua o roteiro de encerramento (desmobilização, financeiro, sistemas) e arquive o contrato.' },
];

export function ContractJourneySteps({ stage, nextAction }: { stage: ContractStage; nextAction?: string | null }) {
  const at = Math.max(0, STEPS.findIndex((s) => s.stages.includes(stage)));
  const done = stage === 'arquivado';
  const cur = STEPS[at]!;
  return (
    <section aria-label="Jornada do contrato" className="card mb-4 p-4">
      <ol className="flex flex-wrap items-center gap-y-2">
        {STEPS.map((s, i) => {
          const state = done || i < at ? 'feito' : i === at ? 'atual' : 'depois';
          return (
            <li key={s.key} className="flex min-w-0 items-center" aria-current={state === 'atual' ? 'step' : undefined}>
              <span className={clsx('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold', state === 'feito' ? 'bg-success text-white' : state === 'atual' ? 'bg-primary text-white ring-4 ring-primary-soft' : 'bg-surface-2 text-muted')}>
                {state === 'feito' ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
              </span>
              <span className={clsx('ml-2 text-sm', state === 'atual' ? 'font-bold text-ink' : state === 'feito' ? 'text-text' : 'text-muted')}>{s.label}</span>
              {i < STEPS.length - 1 && <span className={clsx('mx-3 h-0.5 w-6 sm:w-10', i < at || done ? 'bg-success' : 'bg-line')} aria-hidden />}
            </li>
          );
        })}
      </ol>
      {!done && (
        <p className="mt-3 rounded-md bg-primary-soft/60 px-3 py-2 text-sm text-ink">
          <b>Agora:</b> {cur.todo}{nextAction ? <> <span className="text-muted">Próxima ação registrada:</span> {nextAction}.</> : null}
        </p>
      )}
    </section>
  );
}
