/**
 * Integração Zenith (modelagem de contrato e cadastro de cliente). Regras puras: campos que o Zenith pede e que o
 * ISP Sprint ainda não tinha ficam no contrato como "cadastro Zenith" (obrigatórios); o resto sai do CRM.
 * O envio depende da API do Zenith (ainda não recebida): aqui só se monta e confere o que seria enviado.
 */
/** Serviço do contrato: só Telecom vai para o Zenith. */
export const CONTRACT_SERVICE_TYPES = ['telecom', 'cloud', 'energia', 'cidades_inteligentes', 'outro'] as const;
export type ContractServiceType = (typeof CONTRACT_SERVICE_TYPES)[number];
export const CONTRACT_SERVICE_LABELS: Record<ContractServiceType, string> = { telecom: 'Serviços de telecom', cloud: 'Cloud', energia: 'Energia', cidades_inteligentes: 'Cidades inteligentes', outro: 'Outros serviços' };
export const needsZenith = (t: string | null | undefined) => t === 'telecom';

export const ZENITH_MODALITIES = ['convencional', 'pseudowire_p2p'] as const;
export type ZenithModality = (typeof ZENITH_MODALITIES)[number];
export const ZENITH_MODALITY_LABELS: Record<ZenithModality, string> = { convencional: 'Circuitos convencionais', pseudowire_p2p: 'Enlaces Pseudowire P2P' };
export const ZENITH_MODALITY_HINTS: Record<ZenithModality, string> = {
  convencional: 'MPLS, Internet (CDI), AntiDDoS e Satelital. Tem gestão de saldos, IP público e rede gerenciada.',
  pseudowire_p2p: 'Transporte ponto a ponto entre dois ou mais locais. Sem controle de saldo e sem IP público.',
};
/** Empresa detentora do contrato = filial que vendeu (Configurações → Filiais), já preenchida pela oportunidade. */
/** Opção que o Zenith mostra por padrão no Tipo de SLA. As demais são cadastradas em Configurações → Contratos. */
export const ZENITH_NO_SLA = 'Nenhum SLA definido';

export type ZenithContact = { name: string; email: string | null; phone: string | null };
export type ZenithContract = {
  modality: ZenithModality;
  holderCompany: string;
  alias: string;
  /** Só circuitos convencionais (null no P2P). */
  managedNetwork: boolean | null;
  publicIp: boolean | null;
  unlimitedBalance: boolean;
  cdiUnits: number | null;
  cdmUnits: number | null;
  slaType: string;
  /** Metas digitadas no cadastro; ao salvar viram as metas de SLA do contrato (as mesmas da aba Execução). */
  availabilityPct: number | null;
  packetLossPct: number | null;
  techContact: ZenithContact;
  adminContact: ZenithContact;
};
export type ZenithLists = { holders: string[]; slaTypes: string[] };
export const DEFAULT_ZENITH_LISTS: ZenithLists = { holders: [], slaTypes: [ZENITH_NO_SLA] };

export const EMPTY_ZENITH: ZenithContract = {
  modality: 'convencional', holderCompany: '', alias: '', managedNetwork: null, publicIp: null, unlimitedBalance: false, cdiUnits: null, cdmUnits: null,
  slaType: '', availabilityPct: null, packetLossPct: null, techContact: { name: '', email: null, phone: null }, adminContact: { name: '', email: null, phone: null },
};

/** "Nenhum SLA definido" dispensa disponibilidade e perda de pacote. */
export const slaDefined = (t: string | null | undefined) => !!t?.trim() && t.trim().toLowerCase() !== ZENITH_NO_SLA.toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isUnits = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 1_000_000;

/** Pendências do cadastro Zenith no contrato (vazio = completo). No P2P não há saldo, IP público nem rede gerenciada. */
export function zenithErrors(z: Partial<ZenithContract> | null | undefined): { path: string; message: string }[] {
  const e: { path: string; message: string }[] = [];
  const add = (path: string, message: string) => e.push({ path, message });
  if (!z) return [{ path: 'zenith', message: 'Preencha o cadastro Zenith' }];
  if (!z.modality || !ZENITH_MODALITIES.includes(z.modality)) add('modality', 'Modalidade do contrato');
  if (!z.holderCompany?.trim()) add('holderCompany', 'Empresa detentora do contrato');
  if (!z.alias?.trim()) add('alias', 'Alias (apelido)');
  if (z.modality === 'convencional') {
    if (typeof z.managedNetwork !== 'boolean') add('managedNetwork', 'Contrato de rede gerenciada (sim ou não)');
    if (typeof z.publicIp !== 'boolean') add('publicIp', 'Possuirá IP público (sim ou não)');
    if (!z.unlimitedBalance) {
      if (!isUnits(z.cdiUnits)) add('cdiUnits', 'Saldo de unidades Internet (CDI)');
      if (!isUnits(z.cdmUnits)) add('cdmUnits', 'Saldo de unidades MPLS (CDM)');
    }
  }
  if (!z.slaType?.trim()) add('slaType', 'Tipo de SLA');
  else if (slaDefined(z.slaType)) {
    const pct = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;
    if (!pct(z.availabilityPct)) add('availabilityPct', 'Disponibilidade mensal mínima (%)');
    if (!pct(z.packetLossPct)) add('packetLossPct', 'Perda de pacote máxima admitida (%)');
  }
  for (const [k, label] of [['techContact', 'técnico'], ['adminContact', 'administrativo']] as const) {
    const c = z[k];
    if (!c?.name?.trim()) add(`${k}.name`, `Nome do contato ${label}`);
    if (c?.email && !EMAIL.test(c.email)) add(`${k}.email`, `E-mail do contato ${label} inválido`);
  }
  return e;
}

/** Normaliza para gravar: P2P não guarda saldo, IP nem rede gerenciada; ilimitado não guarda unidades. */
export function normalizeZenith(z: ZenithContract): ZenithContract {
  const t = (s: string) => s.trim();
  const c = (x: ZenithContact): ZenithContact => ({ name: t(x.name), email: x.email?.trim() || null, phone: x.phone?.trim() || null });
  const p2p = z.modality === 'pseudowire_p2p';
  return {
    ...z, holderCompany: t(z.holderCompany), alias: t(z.alias), slaType: t(z.slaType),
    managedNetwork: p2p ? null : z.managedNetwork, publicIp: p2p ? null : z.publicIp,
    unlimitedBalance: p2p ? false : z.unlimitedBalance,
    availabilityPct: slaDefined(z.slaType) ? z.availabilityPct ?? null : null, packetLossPct: slaDefined(z.slaType) ? z.packetLossPct ?? null : null,
    cdiUnits: p2p || z.unlimitedBalance ? null : z.cdiUnits, cdmUnits: p2p || z.unlimitedBalance ? null : z.cdmUnits,
    techContact: c(z.techContact), adminContact: c(z.adminContact),
  };
}

export type ZenithSource = 'crm' | 'cadastro_zenith';
export type ZenithField = { group: 'cliente' | 'contrato' | 'sla' | 'contatos'; label: string; value: string | null; source: ZenithSource; from: string; missing: boolean; hint?: string };
export type ZenithInput = {
  client: { name: string; document: string | null; ipc: number | null; subclients: { name: string; document: string | null }[] };
  contract: { number: string | null; zenith: ZenithContract | null };
  /** SLAs vigentes do contrato (aba SLA). */
  slas: { availabilityPct: number | null; packetLossPct: number | null };
};

const yn = (b: boolean | null | undefined) => (b === true ? 'Sim' : b === false ? 'Não' : null);
const digits = (s: string | null) => (s ?? '').replace(/\D/g, '');

/**
 * Espelho das telas do Zenith (Novo Cliente e Assistente de Modelagem de Contrato), campo a campo, com a origem
 * de cada valor e o que falta. O ICP do Zenith sai do Score IPC da conta (Sucesso do Cliente).
 */
export function zenithFields(i: ZenithInput): { fields: ZenithField[]; missing: string[] } {
  const z = i.contract.zenith;
  const conv = z?.modality !== 'pseudowire_p2p';
  const errs = new Set(zenithErrors(z).map((x) => x.path));
  const f: ZenithField[] = [];
  const crm = (group: ZenithField['group'], label: string, value: string | null, from: string, required = true, hint?: string) => f.push({ group, label, value, source: 'crm', from, missing: required && !value, hint });
  const zen = (group: ZenithField['group'], label: string, value: string | null, path: string) => f.push({ group, label, value, source: 'cadastro_zenith', from: 'Contrato · cadastro Zenith', missing: errs.has(path) || (!z && path !== '') });
  // Novo Cliente
  crm('cliente', 'Nome / razão social', i.client.name || null, 'Conta · nome');
  const doc = digits(i.client.document);
  crm('cliente', 'CNPJ', i.client.document, 'Conta · CPF/CNPJ', true, doc && doc.length !== 14 ? 'O Zenith pede CNPJ (14 dígitos)' : undefined);
  if (doc && doc.length !== 14) f[f.length - 1]!.missing = true;
  crm('cliente', 'ICP (Ideal Customer Profile)', i.client.ipc != null ? String(i.client.ipc) : null, 'Sucesso do Cliente · Score IPC', true, i.client.ipc == null ? 'Avalie o IPC da conta em Sucesso do Cliente' : undefined);
  crm('cliente', 'Subclientes', i.client.subclients.length ? i.client.subclients.map((s) => s.name).join(', ') : null, 'Conta · relações (matriz de)', false);
  // Modelagem do contrato
  zen('contrato', 'Modalidade', z ? ZENITH_MODALITY_LABELS[z.modality] : null, 'modality');
  crm('contrato', 'Cliente vinculado', i.client.name || null, 'Contrato · cliente');
  crm('contrato', 'Empresa detentora do contrato', z?.holderCompany || null, 'Oportunidade · filial');
  crm('contrato', 'Número do contrato', i.contract.number, 'Contrato · número');
  zen('contrato', 'Alias / apelido', z?.alias || null, 'alias');
  if (conv) {
    zen('contrato', 'Contrato de rede gerenciada', yn(z?.managedNetwork), 'managedNetwork');
    zen('contrato', 'Possuirá IP público', yn(z?.publicIp), 'publicIp');
    if (z?.unlimitedBalance) zen('contrato', 'Gestão de saldos', 'Ilimitado', '');
    else {
      zen('contrato', 'Saldo Internet (CDI)', z?.cdiUnits != null ? String(z.cdiUnits) : null, 'cdiUnits');
      zen('contrato', 'Saldo MPLS (CDM)', z?.cdmUnits != null ? String(z.cdmUnits) : null, 'cdmUnits');
    }
  }
  zen('sla', 'Tipo de SLA', z?.slaType || null, 'slaType');
  if (slaDefined(z?.slaType)) {
    // metas de SLA do contrato (gravadas a partir do cadastro ou ajustadas na aba Execução)
    const av = i.slas.availabilityPct ?? z?.availabilityPct ?? null, pl = i.slas.packetLossPct ?? z?.packetLossPct ?? null;
    crm('sla', 'Disponibilidade mensal mínima (%)', av != null ? String(av) : null, 'Contrato · metas de SLA');
    crm('sla', 'Perda de pacote máxima admitida (%)', pl != null ? String(pl) : null, 'Contrato · metas de SLA');
  }
  const contact = (k: 'techContact' | 'adminContact', label: string) => {
    const c = z?.[k];
    zen('contatos', `Contato ${label} · nome`, c?.name || null, `${k}.name`);
    f.push({ group: 'contatos', label: `Contato ${label} · e-mail`, value: c?.email ?? null, source: 'cadastro_zenith', from: 'Contrato · cadastro Zenith', missing: errs.has(`${k}.email`) });
    f.push({ group: 'contatos', label: `Contato ${label} · telefone`, value: c?.phone ?? null, source: 'cadastro_zenith', from: 'Contrato · cadastro Zenith', missing: false });
  };
  contact('techContact', 'técnico');
  contact('adminContact', 'administrativo');
  return { fields: f, missing: f.filter((x) => x.missing).map((x) => x.label) };
}
