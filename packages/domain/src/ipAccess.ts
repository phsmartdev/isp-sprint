/**
 * Acesso por IP liberado: quando ligado na empresa, só entra quem está num endereço ou faixa autorizada
 * (IPv4 ou IPv6, com ou sem máscara CIDR). Pessoas marcadas como "acesso de qualquer lugar" ficam fora da regra.
 */
export type IpRule = { cidr: string; label: string };
export type IpPolicy = { enabled: boolean; rules: IpRule[] };

function v4(ip: string): bigint | null {
  const p = ip.split('.');
  if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255)) return null;
  return p.reduce((t, x) => (t << 8n) + BigInt(Number(x)), 0n);
}
function v6(ip: string): bigint | null {
  let s = ip.toLowerCase().split('%')[0]!;
  // IPv4 no final (ex.: ::ffff:10.0.0.1)
  const m = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) { const n = v4(m[2]!); if (n === null) return null; s = `${m[1]}${((n >> 16n) & 0xffffn).toString(16)}:${(n & 0xffffn).toString(16)}`; }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const parts = [...head, ...Array(fill).fill('0'), ...tail];
  if (parts.length !== 8 || parts.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return null;
  return parts.reduce((t, x) => (t << 16n) + BigInt(parseInt(x, 16)), 0n);
}
/** Endereço normalizado: IPv4 mapeado em IPv6 (::ffff:1.2.3.4) vira IPv4. */
export function parseIp(raw: string): { family: 4 | 6; n: bigint } | null {
  const ip = raw.trim().replace(/^\[|\]$/g, '');
  const a = v4(ip);
  if (a !== null) return { family: 4, n: a };
  const b = v6(ip);
  if (b === null) return null;
  if (b >> 32n === 0xffffn) return { family: 4, n: b & 0xffffffffn };
  return { family: 6, n: b };
}
export function parseRule(cidr: string): { family: 4 | 6; n: bigint; bits: number } | null {
  const [addr, mask] = cidr.trim().split('/');
  const ip = parseIp(addr ?? '');
  if (!ip) return null;
  const max = ip.family === 4 ? 32 : 128;
  const bits = mask === undefined ? max : /^\d{1,3}$/.test(mask) ? Number(mask) : NaN;
  if (!(bits >= 0 && bits <= max)) return null;
  return { ...ip, bits };
}
export function ipInRule(ip: string, cidr: string) {
  const a = parseIp(ip), r = parseRule(cidr);
  if (!a || !r || a.family !== r.family) return false;
  const max = BigInt(a.family === 4 ? 32 : 128);
  const shift = max - BigInt(r.bits);
  return a.n >> shift === r.n >> shift;
}
export function ipAllowed(ip: string | null | undefined, policy: IpPolicy | null, bypass = false) {
  if (!policy?.enabled || bypass) return true;
  if (!ip) return false;
  return policy.rules.some((r) => ipInRule(ip, r.cidr));
}
export function validateIpPolicy(p: IpPolicy): string[] {
  const e: string[] = [];
  if (p.rules.length > 100) e.push('No máximo 100 endereços ou faixas.');
  for (const r of p.rules) {
    const x = parseRule(r.cidr);
    if (!x) e.push(`"${r.cidr}" não é um IP ou faixa válida (ex.: 200.150.10.20 ou 200.150.10.0/24).`);
    else if ((x.family === 4 && x.bits < 8) || (x.family === 6 && x.bits < 16)) e.push(`"${r.cidr}" libera uma faixa grande demais.`);
  }
  if (p.enabled && !p.rules.length) e.push('Inclua pelo menos um IP antes de ligar a restrição.');
  return e;
}
