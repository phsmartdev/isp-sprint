/**
 * Cadastro ERP do contrato (aba "Cadastro ERP"): preenchimento, conferência independente, lançamento manual
 * no IXC com registro do código e conferência por LEITURA do IXC. Nada é gravado no IXC (token só leitura).
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  APPROVED_STATES, ERP_CYCLES, ERP_FIELD_MAP, ERP_STATUSES, ERP_STATUS_LABELS, canEdit, canTransition, compareWithIxc, criticalChanges, erpIssues,
  type ErpExtra, type ErpItem, type ErpStatus, type ProcessKind,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { addEvent, contractScope, createTask, loadContract, stepsOf, type ContractRow } from '../services/contracts';
import { buildErpSheet, effectiveAll, erpPermissions, erpView, hashSnapshot, inheritedFor, letterheadForBranch, mergeItems, type ErpRecordRow } from '../services/contractErp';
import { decryptSecret, encryptSecret } from '../services/email';
import { IxcError, ixcConfig, ixcList } from '../services/ixc';

const RecordParams = z.object({ id: z.string().uuid(), rid: z.string().uuid() });
const Item = z.object({
  description: z.string().max(500), qty: z.number(), unitCents: z.number().int(),
  ixcCode: z.string().trim().max(60).nullable(), unit: z.string().trim().max(40).nullable(), periodicity: z.string().trim().max(40).nullable(),
  location: z.string().trim().max(300).nullable(), notes: z.string().trim().max(1000).nullable(),
});
const Extra = z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().max(1000), ixc: z.string().trim().max(80).nullable() });

async function loadRecord(db: DbOrTx, c: ContractRow, rid: string) {
  const [r] = await db.select().from(s.contractErpRecords).where(and(eq(s.contractErpRecords.id, rid), eq(s.contractErpRecords.contractId, c.id))).limit(1);
  if (!r) throw notFound('Cadastro ERP não encontrado.');
  return r;
}

async function log(db: DbOrTx, auth: AuthContext, r: ErpRecordRow, action: string, from: string | null, to: string | null, note: string | null = null, data: Record<string, unknown> | null = null) {
  await db.insert(s.contractErpEvents).values({ tenantId: auth.tenantId, recordId: r.id, contractId: r.contractId, action, fromStatus: from, toStatus: to, actorId: auth.userId, note, data });
}

const bump = () => ({ updatedAt: new Date(), rowVersion: sql`${s.contractErpRecords.rowVersion} + 1` });

/** Conferido no IXC: conclui as etapas de ERP abertas nos processos do contrato (sem concluir nada além disso). */
async function closeErpSteps(db: DbOrTx, auth: AuthContext, c: ContractRow, r: ErpRecordRow) {
  const procs = await db.select().from(s.contractProcesses).where(and(eq(s.contractProcesses.contractId, c.id), eq(s.contractProcesses.status, 'aberto')));
  for (const p of procs) {
    const steps = { ...p.steps };
    let changed = false;
    for (const d of stepsOf(p.kind as ProcessKind, c.kind)) {
      if (d.requires !== 'erp' || steps[d.key]) continue;
      steps[d.key] = { doneAt: new Date().toISOString(), doneBy: auth.userId, doneByName: auth.name, note: `Cadastro ERP ${r.seq} conferido no IXC`, value: { ref: r.ixcContractId, erpRecordId: r.id } };
      changed = true;
    }
    if (changed) await db.update(s.contractProcesses).set({ steps }).where(eq(s.contractProcesses.id, p.id));
  }
}

export const contractErpRoutes = [
  defineRoute({
    method: 'GET',
    url: '/contracts/:id/erp',
    summary: 'Cadastro ERP do contrato: ciclos e o cadastro atual com campos (herdado/manual), pendências, histórico e permissões',
    tag: 'Contratos',
    module: 'contratos',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const c = await loadContract(app.db, auth, params.id);
      const rows = await app.db.select().from(s.contractErpRecords).where(eq(s.contractErpRecords.contractId, c.id)).orderBy(desc(s.contractErpRecords.seq));
      const current = rows[0] ?? null;
      const can = await erpPermissions(app.db, auth, current);
      return {
        cycles: rows.map((r) => ({ id: r.id, seq: r.seq, cycle: r.cycle, status: r.status, statusLabel: ERP_STATUS_LABELS[r.status as ErpStatus], createdAt: r.createdAt, checkedAt: r.checkedAt })),
        current: current ? await erpView(app.db, auth, c, current) : null,
        legacyRef: c.erpRef,
        canStart: can.fill && (!current || current.status === 'conferido_ixc'),
      };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/contracts/:id/erp',
    summary: 'Abre um ciclo de Cadastro ERP (implantação, aditivo, reajuste ou renovação); só um aberto por vez',
    tag: 'Contratos',
    module: 'contratos',
    params: IdParams,
    body: z.object({ cycle: z.enum(ERP_CYCLES).default('implantacao') }),
    handler: async ({ app, auth, params, body, reply }) => app.db.transaction(async (tx) => {
      const c = await loadContract(tx, auth, params.id);
      if (c.stage === 'arquivado') throw unprocessable('Contrato arquivado.');
      if (!(await erpPermissions(tx, auth, null)).fill) throw forbidden('Seu perfil não preenche o Cadastro ERP.');
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`erp:${c.id}`}))`);
      const [last] = await tx.select().from(s.contractErpRecords).where(eq(s.contractErpRecords.contractId, c.id)).orderBy(desc(s.contractErpRecords.seq)).limit(1);
      if (last && last.status !== 'conferido_ixc') throw unprocessable(`Já existe um Cadastro ERP em andamento (${ERP_STATUS_LABELS[last.status as ErpStatus]}). Conclua-o antes de abrir outro ciclo.`);
      const [r] = await tx.insert(s.contractErpRecords).values({ tenantId: auth.tenantId, contractId: c.id, seq: (last?.seq ?? 0) + 1, cycle: body.cycle, createdBy: auth.userId,
        // novo ciclo parte do último aprovado (cliente e códigos), para não redigitar
        values: last?.approvedSnapshot ? Object.fromEntries(Object.entries(last.values)) : {}, extras: last?.extras ?? [], items: last?.items ?? null, secretEnc: last?.secretEnc ?? null,
        ixcClientId: last?.ixcClientId ?? null, ixcContractId: last?.ixcContractId ?? null,
      }).returning();
      await log(tx, auth, r!, 'aberto', null, 'nao_iniciado', null, { cycle: body.cycle });
      await addEvent(tx, auth.tenantId, c.id, auth.userId, 'erp_cadastro', `Cadastro ERP ${r!.seq} aberto (${body.cycle})`);
      reply.code(201);
      return { id: r!.id };
    }),
  }),

  defineRoute({
    method: 'PUT',
    url: '/contracts/:id/erp/:rid',
    summary: 'Salva o Cadastro ERP: valores manuais (vazio = volta ao herdado), produtos, campos extras, senha e evidências; campo crítico alterado depois da aprovação exige nova conferência',
    tag: 'Contratos',
    module: 'contratos',
    params: RecordParams,
    bodyLimit: 400_000,
    body: z.object({
      rowVersion: z.number().int(),
      values: z.record(z.string().max(60), z.string().max(4000).nullable()).default({}),
      items: z.array(Item).max(200).optional(),
      extras: z.array(Extra).max(50).optional(),
      secret: z.string().max(200).nullable().optional(),
      evidenceDocIds: z.array(z.string().uuid()).max(50).optional(),
    }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const c = await loadContract(tx, auth, params.id);
      const r = await loadRecord(tx, c, params.rid);
      if (r.rowVersion !== body.rowVersion) throw conflict(r.rowVersion);
      if (!(await erpPermissions(tx, auth, r)).fill) throw forbidden('Seu perfil não preenche o Cadastro ERP.');
      const st = r.status as ErpStatus;
      if (!canEdit(st)) throw unprocessable('O cadastro está em conferência: aguarde a aprovação ou a devolução para alterar.');
      for (const k of Object.keys(body.values)) {
        const def = ERP_FIELD_MAP.get(k);
        if (!def || def.type === 'secret') throw unprocessable(`Campo desconhecido: ${k}.`, [{ path: `values.${k}`, message: 'Fora do catálogo' }]);
      }
      if (body.evidenceDocIds?.length) {
        const ok = await tx.select({ id: s.contractDocuments.id }).from(s.contractDocuments).where(and(eq(s.contractDocuments.contractId, c.id), inArray(s.contractDocuments.id, body.evidenceDocIds)));
        if (ok.length !== new Set(body.evidenceDocIds).size) throw unprocessable('Evidência fora dos documentos do contrato.');
      }
      const { inherited, baseItems } = await inheritedFor(tx, c);
      const values = { ...r.values };
      for (const [k, v] of Object.entries(body.values)) { if (v == null || v.trim() === '') delete values[k]; else values[k] = v.trim(); }
      const before = effectiveAll(r, inherited), after = effectiveAll({ values }, inherited);
      const itemsBefore = mergeItems(baseItems, r.items);
      const items: ErpItem[] | null = body.items ? mergeItems(baseItems, body.items as ErpItem[]) : r.items;
      const itemsAfter = mergeItems(baseItems, items);
      const changedKeys = Object.keys(after).filter((k) => before[k] !== after[k]);
      const secretChanged = body.secret !== undefined;
      const extras: ErpExtra[] = body.extras ?? r.extras;
      // Depois da aprovação: comparar com a FOTOGRAFIA aprovada; campo crítico diferente invalida a aprovação
      const snap = r.approvedSnapshot;
      const crit = APPROVED_STATES.includes(st) && snap ? criticalChanges(snap.values, after, snap.items, itemsAfter) : [];
      let to: ErpStatus = st === 'nao_iniciado' ? 'em_preenchimento' : st;
      const patch: Partial<typeof s.contractErpRecords.$inferInsert> = {};
      if (crit.length) {
        to = 'em_preenchimento';
        Object.assign(patch, { approvedBy: null, approvedAt: null, launchedBy: null, launchedAt: null, checkedBy: null, checkedAt: null, lastCompare: null, submittedBy: null, submittedAt: null });
      }
      const touched = changedKeys.length || secretChanged || body.items || body.extras || body.evidenceDocIds;
      const editors = touched && !r.editors.includes(auth.userId) ? [...r.editors, auth.userId] : r.editors;
      const [u] = await tx.update(s.contractErpRecords).set({
        ...patch, status: to, values, items, extras, editors,
        secretEnc: secretChanged ? (body.secret ? encryptSecret(body.secret) : null) : undefined,
        evidenceDocIds: body.evidenceDocIds ?? undefined, ...bump(),
      }).where(eq(s.contractErpRecords.id, r.id)).returning();
      if (touched) await log(tx, auth, r, crit.length ? 'aprovacao_invalidada' : 'salvo', st, to, null, { fields: changedKeys, secret: secretChanged || undefined, items: !!body.items || undefined, critical: crit.length ? crit : undefined });
      return { rowVersion: u!.rowVersion, status: to, invalidated: crit };
    }),
  }),

  defineRoute({
    method: 'POST',
    url: '/contracts/:id/erp/:rid/actions',
    summary: 'Ações do fluxo: enviar, aprovar, devolver, liberar, registrar lançamento, conferir no IXC (leitura) e reabrir',
    tag: 'Contratos',
    module: 'contratos',
    params: RecordParams,
    body: z.object({
      action: z.enum(['submit', 'approve', 'return', 'release', 'launch', 'check', 'reopen']),
      rowVersion: z.number().int(),
      note: z.string().trim().max(2000).optional(),
      launcherId: z.string().uuid().nullable().optional(),
      ixcClientId: z.string().trim().regex(/^\d{1,12}$/, 'Código numérico').optional(),
      ixcContractId: z.string().trim().regex(/^\d{1,12}$/, 'Código numérico').optional(),
      /** campos que a leitura não trouxe e a pessoa conferiu na tela do IXC */
      manualOk: z.array(z.string().max(60)).max(200).default([]),
      /** campos que a pessoa encontrou diferentes na tela do IXC */
      manualDivergent: z.array(z.string().max(60)).max(200).default([]),
    }),
    handler: async ({ app, auth, params, body }) => {
      // a leitura do IXC acontece fora da transação (rede); o resultado é aplicado com trava de versão
      let ixcRead: { cliente: Record<string, unknown> | null; contrato: Record<string, unknown> | null; error: string | null } | null = null;
      if (body.action === 'check') {
        const c0 = await loadContract(app.db, auth, params.id);
        const r0 = await loadRecord(app.db, c0, params.rid);
        ixcRead = { cliente: null, contrato: null, error: null };
        const cfg = await ixcConfig(app.db, auth.tenantId, { requireEnabled: true }).catch(() => null);
        if (!cfg) ixcRead.error = 'Integração IXC não configurada: confira os campos na tela do IXC.';
        else if (r0.ixcClientId && r0.ixcContractId) {
          try {
            const [cl, ct] = await Promise.all([ixcList(cfg, 'cliente', { qtype: 'cliente.id', query: r0.ixcClientId, rp: 1 }), ixcList(cfg, 'cliente_contrato', { qtype: 'cliente_contrato.id', query: r0.ixcContractId, rp: 1 })]);
            ixcRead.cliente = cl.registros[0] ?? null; ixcRead.contrato = ct.registros[0] ?? null;
            if (!ixcRead.cliente) ixcRead.error = `Cliente ${r0.ixcClientId} não encontrado no IXC.`;
            else if (!ixcRead.contrato) ixcRead.error = `Contrato ${r0.ixcContractId} não encontrado no IXC.`;
          } catch (e) { ixcRead.error = e instanceof IxcError ? e.message : 'Falha ao ler o IXC.'; }
        }
      }
      return app.db.transaction(async (tx) => {
        const c = await loadContract(tx, auth, params.id);
        const r = await loadRecord(tx, c, params.rid);
        if (r.rowVersion !== body.rowVersion) throw conflict(r.rowVersion);
        const st = r.status as ErpStatus;
        const a = body.action;
        if (!canTransition(st, a)) throw unprocessable(`Ação indisponível em "${ERP_STATUS_LABELS[st]}".`);
        const can = await erpPermissions(tx, auth, r);
        const { inherited, baseItems } = await inheritedFor(tx, c);
        const values = effectiveAll(r, inherited);
        const items = mergeItems(baseItems, r.items);
        const note = body.note?.trim() || null;
        const go = async (to: ErpStatus, extra: Partial<typeof s.contractErpRecords.$inferInsert> = {}, data: Record<string, unknown> | null = null) => {
          const [u] = await tx.update(s.contractErpRecords).set({ status: to, ...extra, ...bump() }).where(eq(s.contractErpRecords.id, r.id)).returning();
          await log(tx, auth, r, a, st, to, note, data);
          await addEvent(tx, auth.tenantId, c.id, auth.userId, 'erp_cadastro', `Cadastro ERP ${r.seq}: ${ERP_STATUS_LABELS[st]} → ${ERP_STATUS_LABELS[to]}${note ? ` · ${note}` : ''}`);
          return u!;
        };
        const blockIfIssues = () => {
          const issues = erpIssues(values, items, !!r.secretEnc);
          if (issues.length) throw unprocessable(`Há ${issues.length} pendência(s) no cadastro: ${issues.slice(0, 5).map((i) => `${i.label} (${i.message})`).join('; ')}${issues.length > 5 ? '…' : ''}`, issues.map((i) => ({ path: i.key, message: i.message })));
        };
        switch (a) {
          case 'submit': {
            if (!can.fill) throw forbidden('Seu perfil não preenche o Cadastro ERP.');
            blockIfIssues();
            const u = await go('aguardando_conferencia', { submittedBy: auth.userId, submittedAt: new Date(), editors: r.editors.includes(auth.userId) ? r.editors : [...r.editors, auth.userId] });
            return { status: u.status, rowVersion: u.rowVersion };
          }
          case 'approve':
          case 'return': {
            if (!can.review) throw forbidden(can.reviewBlockedReason ?? 'Você não confere este cadastro.');
            if (a === 'return') {
              if (!note || note.length < 5) throw unprocessable('Justifique a devolução (mínimo 5 caracteres).', [{ path: 'note', message: 'Obrigatório para devolver' }]);
              const u = await go('devolvido', { firstPass: false });
              return { status: u.status, rowVersion: u.rowVersion };
            }
            blockIfIssues();
            const snapshot = { values, items, extras: r.extras };
            const u = await go('aprovado', { approvedBy: auth.userId, approvedAt: new Date(), approvedSnapshot: snapshot, approvedHash: hashSnapshot(values, items), firstPass: r.firstPass ?? true, editors: [] }, { hash: hashSnapshot(values, items) });
            return { status: u.status, rowVersion: u.rowVersion };
          }
          case 'release': {
            if (!can.launch) throw forbidden('Seu perfil não lança no IXC.');
            if (body.launcherId) {
              const [p] = await tx.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.id, body.launcherId), eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true))).limit(1);
              if (!p) throw unprocessable('Responsável pelo lançamento inválido.', [{ path: 'launcherId', message: 'Usuário inativo ou de outra empresa' }]);
            }
            const u = await go('aguardando_lancamento', { launcherId: body.launcherId ?? auth.userId });
            return { status: u.status, rowVersion: u.rowVersion };
          }
          case 'launch': {
            if (!can.launch) throw forbidden('Seu perfil não lança no IXC.');
            const cli = body.ixcClientId ?? r.ixcClientId, ctr = body.ixcContractId ?? r.ixcContractId;
            if (!cli || !ctr) throw unprocessable('Informe o código do cliente e o código do contrato gerados no IXC.', [...(!cli ? [{ path: 'ixcClientId', message: 'Obrigatório' }] : []), ...(!ctr ? [{ path: 'ixcContractId', message: 'Obrigatório' }] : [])]);
            const u = await go('lancado', { launchedBy: auth.userId, launchedAt: new Date(), ixcClientId: cli, ixcContractId: ctr, lastCompare: null }, { ixcClientId: cli, ixcContractId: ctr });
            await tx.update(s.contracts).set({ erpRef: `IXC cliente ${cli} · contrato ${ctr}`, updatedAt: new Date() }).where(eq(s.contracts.id, c.id));
            return { status: u.status, rowVersion: u.rowVersion };
          }
          case 'check': {
            if (!can.check) throw forbidden(can.checkBlockedReason ?? 'Você não confere este lançamento.');
            const compare = compareWithIxc(r.approvedSnapshot?.values ?? values, { cliente: ixcRead?.cliente ?? null, contrato: ixcRead?.contrato ?? null })
              .map((x) => (x.status === 'nao_lido' && body.manualDivergent.includes(x.key) ? { ...x, status: 'divergente' as const, found: 'diferente na tela do IXC' } : x.status === 'nao_lido' && body.manualOk.includes(x.key) ? { ...x, status: 'ok' as const, found: 'conferido na tela do IXC' } : x));
            // campos sem correspondência de leitura também passam pela pessoa (ex.: produtos do contrato)
            const pendingManual = compare.filter((x) => x.status === 'nao_lido');
            const divergent = compare.filter((x) => x.status === 'divergente');
            if (divergent.length) {
              const u = await go('divergente', { checkedBy: auth.userId, checkedAt: new Date(), lastCompare: compare }, { divergent: divergent.map((d) => d.key), ixcError: ixcRead?.error ?? undefined });
              // divergência gera pendência de correção para quem lançou
              await createTask(tx, c, r.launchedBy ?? auth.userId, `Corrigir divergência do Cadastro ERP no IXC — CT-${c.code}`,
                `Campos divergentes entre o cadastro aprovado e o IXC:\n${divergent.map((d) => `• ${d.label}: aprovado "${d.expected}", IXC "${d.found}"`).join('\n')}\n\nCorrija no IXC (ou reabra o cadastro se o erro for do cadastro) e confira de novo.`,
                new Date(Date.now() + 86_400_000), auth.userId, 'alta');
              return { status: u.status, rowVersion: u.rowVersion, compare, ixcError: ixcRead?.error ?? null };
            }
            if (pendingManual.length) {
              const [u] = await tx.update(s.contractErpRecords).set({ lastCompare: compare, ...bump() }).where(eq(s.contractErpRecords.id, r.id)).returning();
              await log(tx, auth, r, 'leitura_ixc', st, st, null, { pendingManual: pendingManual.map((p) => p.key), ixcError: ixcRead?.error ?? undefined });
              return { status: st, rowVersion: u!.rowVersion, compare, pendingManual: pendingManual.map((p) => p.key), ixcError: ixcRead?.error ?? null };
            }
            const u = await go('conferido_ixc', { checkedBy: auth.userId, checkedAt: new Date(), lastCompare: compare }, { ok: compare.length });
            await closeErpSteps(tx, auth, c, u);
            return { status: u.status, rowVersion: u.rowVersion, compare, ixcError: ixcRead?.error ?? null };
          }
          case 'reopen': {
            if (!can.fill) throw forbidden('Seu perfil não preenche o Cadastro ERP.');
            if (!note || note.length < 5) throw unprocessable('Explique o que será corrigido no cadastro (mínimo 5 caracteres).', [{ path: 'note', message: 'Obrigatório' }]);
            const u = await go('em_preenchimento', { approvedBy: null, approvedAt: null, launchedBy: null, launchedAt: null, checkedBy: null, checkedAt: null, submittedBy: null, submittedAt: null });
            return { status: u.status, rowVersion: u.rowVersion };
          }
        }
      });
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/contracts/:id/erp/:rid/secret',
    summary: 'Mostra a senha da Central do assinante a quem lança no IXC (fica registrado no histórico)',
    tag: 'Contratos',
    module: 'contratos',
    params: RecordParams,
    handler: async ({ app, auth, params }) => {
      const c = await loadContract(app.db, auth, params.id);
      const r = await loadRecord(app.db, c, params.rid);
      if (!(await erpPermissions(app.db, auth, r)).launch) throw forbidden('Só quem lança no IXC vê a senha.');
      if (!r.secretEnc) throw notFound('Senha não informada.');
      await log(app.db, auth, r, 'senha_visualizada', r.status, r.status);
      return { secret: decryptSecret(r.secretEnc) };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/contracts/:id/erp/:rid/sheet.pdf',
    summary: 'Ficha de lançamento no IXC (PDF com o timbrado da filial) com os valores aprovados',
    tag: 'Contratos',
    module: 'contratos',
    params: RecordParams,
    handler: async ({ app, auth, params, reply }) => {
      const c = await loadContract(app.db, auth, params.id);
      const r = await loadRecord(app.db, c, params.rid);
      if (!r.approvedSnapshot || !APPROVED_STATES.includes(r.status as ErpStatus)) throw unprocessable('A ficha sai só depois da aprovação na conferência interna.');
      const { branchId } = await inheritedFor(app.db, c);
      const [contact] = await app.db.select({ name: s.contacts.name }).from(s.contacts).where(eq(s.contacts.id, c.contactId)).limit(1);
      const pdf = await buildErpSheet({ contractCode: c.code, contractNumber: r.approvedSnapshot.values.b_numero ?? '', clientName: contact?.name ?? '', record: r, letterhead: await letterheadForBranch(app.db, auth.tenantId, branchId), generatedBy: auth.name });
      await log(app.db, auth, r, 'ficha_gerada', r.status, r.status);
      reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="Ficha-IXC-CT-${c.code}-${r.seq}.pdf"`);
      return reply.send(pdf);
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/contracts/erp/summary',
    summary: 'Painel do Cadastro ERP: cadastros por situação (o ciclo mais recente de cada contrato), tempo médio e aprovação na primeira conferência',
    tag: 'Contratos',
    module: 'contratos',
    handler: async ({ app, auth }) => {
      const scope = contractScope(auth);
      const rows = await app.db.execute<{ status: string; n: number }>(sql`
        select r.status, count(*)::int as n from contract_erp_records r
        join contracts on contracts.id = r.contract_id
        where ${scope} and r.seq = (select max(seq) from contract_erp_records x where x.contract_id = r.contract_id)
        group by r.status`);
      const [k] = (await app.db.execute<{ avg_hours: number | null; first: number; decided: number }>(sql`
        select avg(extract(epoch from (r.checked_at - r.created_at)) / 3600) filter (where r.status = 'conferido_ixc') as avg_hours,
               count(*) filter (where r.first_pass is true and r.approved_at is not null)::int as first,
               count(*) filter (where r.first_pass is not null)::int as decided
        from contract_erp_records r join contracts on contracts.id = r.contract_id where ${scope}`)).rows;
      const by = Object.fromEntries(ERP_STATUSES.map((st) => [st, rows.rows.find((x) => x.status === st)?.n ?? 0]));
      const [{ without } = { without: 0 }] = (await app.db.execute<{ without: number }>(sql`
        select count(*)::int as without from contracts where ${scope} and contracts.validated_at is not null and contracts.stage <> 'arquivado'
        and not exists (select 1 from contract_erp_records r where r.contract_id = contracts.id)`)).rows;
      return {
        byStatus: by, withoutRecord: without,
        avgHours: k?.avg_hours == null ? null : Math.round(Number(k.avg_hours) * 10) / 10,
        firstPassRate: k && k.decided ? Math.round((k.first / k.decided) * 1000) / 10 : null,
      };
    },
  }),
];

