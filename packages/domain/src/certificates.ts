/**
 * Certificados de cursos complementares na área da pessoa: pontos extras na gamificação depois de validados
 * pela liderança. Pontos = fixo por certificado + por hora (até um limite de horas), com teto mensal por pessoa.
 * Conta no mês da validação. Valores vêm da regra aprovada.
 */
export type CertificateSettings = {
  pointsPerCertificate: number;
  /** pontos por hora de curso, em décimos (5 = 0,5 ponto por hora) */
  pointsPerHourTenths: number;
  maxHoursCounted: number;
  monthlyCapPoints: number;
};

export const DEFAULT_CERTIFICATE_SETTINGS: CertificateSettings = { pointsPerCertificate: 10, pointsPerHourTenths: 5, maxHoursCounted: 40, monthlyCapPoints: 40 };

export function certificateSettingsErrors(x: CertificateSettings | undefined): string[] {
  if (!x) return [];
  const e: string[] = [];
  const int = (v: number, max: number) => Number.isInteger(v) && v >= 0 && v <= max;
  if (!int(x.pointsPerCertificate, 1000)) e.push('Pontos por certificado inválidos.');
  if (!int(x.pointsPerHourTenths, 1000)) e.push('Pontos por hora de curso inválidos.');
  if (!int(x.maxHoursCounted, 2000)) e.push('Limite de horas contadas inválido.');
  if (!int(x.monthlyCapPoints, 100_000)) e.push('Teto mensal de pontos de certificados inválido.');
  return e;
}

/** Pontos de um certificado antes do teto do mês. */
export const certificateRawPoints = (hours: number, st: CertificateSettings) =>
  Math.round((st.pointsPerCertificate + (Math.min(Math.max(0, hours), st.maxHoursCounted) * st.pointsPerHourTenths) / 10) * 10) / 10;

export type ApprovedCertificate = { id: string; userId: string; hours: number; approvedOn: string };
export type CertificateCredit = { certificateId: string; userId: string; points: number; capped: boolean };

/** Créditos com o teto mensal por pessoa (mês da validação), na ordem em que foram validados. */
export function certificateCredits(rows: ApprovedCertificate[], st: CertificateSettings | undefined): CertificateCredit[] {
  if (!st) return [];
  const used = new Map<string, number>();
  return [...rows].sort((a, b) => a.approvedOn.localeCompare(b.approvedOn) || a.id.localeCompare(b.id)).map((r) => {
    const k = `${r.userId}|${r.approvedOn.slice(0, 7)}`;
    const raw = certificateRawPoints(r.hours, st);
    const pts = Math.round(Math.min(raw, Math.max(0, st.monthlyCapPoints - (used.get(k) ?? 0))) * 10) / 10;
    used.set(k, (used.get(k) ?? 0) + pts);
    return { certificateId: r.id, userId: r.userId, points: pts, capped: pts < raw };
  });
}
