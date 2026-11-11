/** Pessoas & Gestão · Desempenho & Desenvolvimento — tipos e consultas. */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import type { PersonCard } from '../shared';

export type Modality = 'reconhecimento' | 'orientacao' | 'melhoria' | 'reforco' | 'desenvolvimento' | 'alinhamento';
export type DevContext = {
  reports: PersonCard[]; managers: PersonCard[]; hr: boolean; modalities: Record<Modality, string>;
  policy: { version: number; feedback: { modalities: Modality[]; ascendingModes: ('confidencial' | 'identificado')[]; minChars: number } };
};
export type Feedback = {
  id: string; direction: 'descendente' | 'ascendente'; modality: Modality; modalityLabel: string; mode: 'identificado' | 'confidencial';
  status: 'rascunho' | 'enviado' | 'ciente' | 'em_mediacao' | 'repassado' | 'tratado_sem_repasse';
  occurredOn: string; sentAt: string | null; createdAt: string; acknowledgedAt: string | null; response: string | null; respondedAt: string | null;
  myRole: 'remetente' | 'destinatario' | 'rh'; sender: PersonCard | null; recipient: PersonCard | null;
  situation: string | null; behavior: string | null; impact: string | null; guidance: string | null; nextSteps: string | null;
  synthesis: string | null; mediationNote: string | null; mediatedAt: string | null;
  history: { type: string; at: string; actor: string; note: string | null }[];
};
export const useDevContext = () => useQuery({ queryKey: ['pessoas', 'dev', 'contexto'], queryFn: () => api<DevContext>('/pessoas/desenvolvimento/contexto'), staleTime: 60_000 });

export const MODALITY_HINT: Record<Modality, string> = {
  reconhecimento: 'Valorizar algo que deu certo e deve continuar.',
  orientacao: 'Indicar um caminho melhor para uma situação.',
  melhoria: 'Apontar algo a ajustar, com exemplo concreto.',
  reforco: 'Reforçar um comportamento que já está no caminho.',
  desenvolvimento: 'Apoiar o crescimento numa competência.',
  alinhamento: 'Combinar expectativas sobre o trabalho.',
};
export const STATUS: Record<Feedback['status'], { label: string; tone: 'neutral' | 'blue' | 'green' | 'orange' | 'purple' }> = {
  rascunho: { label: 'Rascunho', tone: 'neutral' }, enviado: { label: 'Aguardando ciência', tone: 'orange' }, ciente: { label: 'Ciente', tone: 'green' },
  em_mediacao: { label: 'Com o RH', tone: 'purple' }, repassado: { label: 'Repassado pelo RH', tone: 'blue' }, tratado_sem_repasse: { label: 'Tratado pelo RH', tone: 'green' },
};
export const HISTORY: Record<string, string> = { criado: 'Criado', enviado: 'Enviado', enviado_ao_rh: 'Enviado ao RH (confidencial)', ciencia: 'Ciência registrada', manifestacao: 'Manifestação registrada', repassado: 'Síntese repassada à liderança', tratado_sem_repasse: 'Tratado pelo RH sem repasse' };

/** Quem vai ver: dito com todas as letras antes de enviar. */
export function whoSees(direction: 'descendente' | 'ascendente', mode: 'identificado' | 'confidencial', recipient: string) {
  if (direction === 'descendente') return `Só você e ${recipient}. Ninguém acima de você na estrutura, nem o RH, lê o conteúdo.`;
  if (mode === 'identificado') return `Só você e ${recipient}, que verá que foi você quem enviou. Ninguém acima na estrutura lê.`;
  return `Só o RH lê o que você escrever. ${recipient} recebe apenas uma síntese preparada pelo RH, sem saber quem enviou. Não gera avaliação automática.`;
}
/** AAAA-MM-DD → DD/MM/AAAA, sem fuso. */
export const day = (d: string) => d.split('-').reverse().join('/');
