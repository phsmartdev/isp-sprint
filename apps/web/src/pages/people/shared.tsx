/** Pessoas & Cultura: tipos e consultas compartilhadas pelas telas do módulo. */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

export type PeopleCaps = { member: boolean; communicate: boolean; administer: boolean; moderate: boolean; configure: boolean };
export type PersonCard = { id: string; name: string; jobTitle: string | null; hasPhoto: boolean; area: string | null; unit: string | null };
export type PeopleMe = { me: PersonCard & { firstName: string }; caps: PeopleCaps; communityModerator?: boolean; profileComplete: boolean; limits: { imageMb: number; videoMb: number; mediaPerPost: number; postChars: number } };
export type PeopleProfile = PersonCard & {
  teams: string[]; bio: string | null; interests: string[]; skills: string[];
  contact: { email: string | null; phone: string | null }; privacy?: { showEmail: boolean; showPhone: boolean }; self: boolean;
  communities: { id: string; name: string; kind: string; role: string }[];
};

export const usePeopleMe = () => useQuery({ queryKey: ['pessoas', 'me'], queryFn: () => api<PeopleMe>('/pessoas/me'), staleTime: 60_000 });
export const orgLine = (p: Pick<PersonCard, 'jobTitle' | 'area' | 'unit'>) => [p.jobTitle, p.area, p.unit].filter(Boolean).join(' · ');
