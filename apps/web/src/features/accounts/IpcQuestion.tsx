/**
 * Pergunta feita na hora de relacionar contas (ou vincular a uma estrutura): a conta assume o IPC da principal
 * (acompanhamento igual) ou mantém o próprio IPC (acompanhamento individualizado)? Sem resposta, não registra.
 */
import clsx from 'clsx';

export type IpcOption<T extends string> = { value: T; title: string; detail: string; disabled?: boolean; suggested?: boolean };

export function IpcQuestion<T extends string>({ value, onChange, options, name }: { value: T | null; onChange: (v: T) => void; options: IpcOption<T>[]; name: string }) {
  return (
    <fieldset className="border border-line p-3">
      <legend className="px-1 text-sm font-semibold text-ink">Score IPC com esta relação</legend>
      <p className="mb-2 text-sm text-muted">O nível de acompanhamento precisa ser igual ao da conta principal, ou esta conta tem o próprio IPC?</p>
      <div className="grid gap-2" role="radiogroup" aria-label="Score IPC com esta relação">
        {options.map((o) => (
          <label key={o.value} className={clsx('flex cursor-pointer items-start gap-2.5 border px-3 py-2', o.disabled ? 'cursor-not-allowed opacity-60' : value === o.value ? 'border-primary bg-primary-soft' : 'border-line hover:bg-surface-2')}>
            <input type="radio" name={name} className="mt-1" checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} />
            <span className="min-w-0"><span className="block text-sm font-semibold text-ink">{o.title}{o.suggested && <span className="ml-1.5 text-xs font-normal text-muted">(sugerido pelo tipo de relação)</span>}</span><span className="block text-xs text-muted">{o.detail}</span></span>
          </label>
        ))}
      </div>
      {value === null && <p className="mt-2 text-xs text-warning">Responda para registrar.</p>}
    </fieldset>
  );
}
