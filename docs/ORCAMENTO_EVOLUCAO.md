# Evolução do Orçamento — prompt master (fases)

## Fase 1 — Auditoria (12/11/2026)
- **Já existia (preservado):** plano de contas hierárquico (`budget_accounts`, DRE com natureza despesa/receita), centros de custo (dono, execução, time), planejamento trimestral (`budget_plans`/`budget_lines`) com aprovação Gerência → Diretoria, Budget Guardião por centro/conta (`budget_adjustments`, regra de 15% da Política de Orçamento — Anexo I), remanejamento, gastos com comprovante (`budget_expenses`), revisão mensal com desvio de 15%, faixas de execução 50/90/100%, histórico (`budget_events`), recursos (ativos, softwares, contratos, compras, fornecedores), brindes (`gift_*`), quadro do Marketing com orçamento e brindes no cartão.
- **Política fornecida:** Anexo I (Planejamento e Execução Orçamentária) já aplicado no domínio (`budget.ts`). Não há percentual de alerta/bloqueio nem valor de reserva do Guardião na política: ficam **parametrizáveis e vazios** até a Diretoria definir.
- **Integração financeira:** não existe integração de contas a pagar (o IXC integrado é de faturamento de clientes). Pagamentos ficam com **registro manual autorizado pelo setor Financeiro**, com identificador externo e chave de idempotência prontos para uma integração futura.

## Fases 2 a 4 — entregues
- **Lançamento único** (`budget_lines` evoluída, migração 0153): código `ORC-AAAA-NNNN`, quantidade × valor unitário (inteiros), responsável, justificativa, objetivo, projeto, campanha, prioridade, tipo, recorrência; estados independentes de **aprovação** (9), **execução** (6) e **financeiro** (calculado).
- **Cálculo central** em `packages/domain/src/budgetLedger.ts` (planejado, aprovado, reservado, comprometido, realizado, pago, saldo, desvio, economia, excedente, projeção; situação de pagamento combinada).
- **Governança:** questionamentos (obrigatórios travam a aprovação), decisões integral/parcial/com condições, **valor-alvo e valor-limite**, rejeição, revisão, lote com decisão individual; quem pede não decide; Administrador não aprova só por ser administrador; só cargo Liderança/gestor aprova.
- **Budget Guardião no lançamento:** pedido com justificativa, decisão da Diretoria, reserva global/por centro/híbrida consumida com trava (sem consumo duplicado).
- **Execução e financeiro:** fornecedor, cotação, negociado, contratado (vira comprometido), pedido de compra, entrega, despesa reconhecida, documentos; títulos e parcelas (Financeiro), pagamentos parciais, juros, multa, desconto, estorno e conciliação, idempotentes.
- **Tela única:** Recursos e Orçamento → Planejamento orçamentário → **Central do orçamento** (indicadores, filtros, evolução em linhas com clique no mês, tabela em DRE com colunas escolhidas e exportação, painel lateral com 6 seções, aprovação em lote).

## Fase 5 — Integrações (entregue)
- **Brindes = lançamento do orçamento** (sem controle paralelo): planejar o brinde cria o lançamento (`gift_item_id`, destinação) no centro de custo; a aprovação parcial aparece como restrição no planejamento; a compra registra o comprometido e a economia, e acima do autorizado pede o Budget Guardião; o recebimento entra no estoque ligado ao lançamento (`gift_movements.line_id`) e não gera despesa nova (migração 0154).
- **Distribuição com destinação:** relacionamento, conta ABM, oportunidade, campanha, evento ou ação institucional (conta opcional nos três últimos); investimento em relacionamento por ação e por campanha no Consumo.
- **Projetos e campanhas** mostram o orçamento ligado (planejado, aprovado, comprometido, realizado, pago, saldo).
- Contratos de recursos já se ligam ao lançamento na execução; metas e planos de ação ficam na Fase 6/14 (Inteligência e Gestão de Resultados).

## Próximas fases
- **6 — Inteligência:** Eficiência Orçamentária em Relatórios e Inteligência (custo por resultado, por área).
- **7 — Fechamento mensal e e-mail:** estados do fechamento, demonstrativos, relatório HTML por destinatário com permissões.
- **8 — Homologação** final dos critérios de aceite restantes.
