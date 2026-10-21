/** Tarefas e projetos de um registro do CRM (cliente, oportunidade, contrato, ata): um bloco só, sem duplicar registros. */
import { useState } from 'react';
import { LinkedProjects, type LinkPrefill } from '../projects/shared';
import { LinkedTasks } from './shared';
import { TaskDrawer } from './TaskDrawer';

export function WorkLinks({ prefill }: { prefill: LinkPrefill }) {
  const [task, setTask] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <LinkedTasks prefill={prefill} onOpen={setTask} />
      <LinkedProjects prefill={prefill} />
      <TaskDrawer id={task} onClose={() => setTask(null)} onOpen={setTask} />
    </div>
  );
}
