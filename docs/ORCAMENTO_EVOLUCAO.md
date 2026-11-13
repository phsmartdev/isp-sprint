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

## Fase 6 — Inteligência de Eficiência Orçamentária (entregue)
- **Onde:** Inteligência → Eficiência orçamentária (quem tem Recursos e Orçamento e Inteligência nível Equipe ou Total).
- **Fórmulas** no domínio (`budgetEfficiency.ts`): custo por resultado, resultado por real, variação de eficiência, desvio e desvio %; denominador zero ou sem custo = "—" (nunca zero inventado); índice base 100 para comparar unidades diferentes.
- **Atribuição explícita:** direta (centro ligado a time → vendas do time; campanha → leads e vendas convertidas deles), influenciada (brindes × vendas da conta em até 180 dias) e correlação (total da empresa). Receita da conta inteira nunca é atribuída a uma campanha.
- **Análise gerencial:** custo sobe e resultado cai, custo cai e resultado sobe, resultado cresce mais que o custo, custo cresce mais que o resultado, economia com perda de resultado (não é eficiência), orçamento ocioso (<50%), alto investimento e baixo retorno (mediana).
- **Gráficos:** custos × resultados (R$ ou índice), aprovado × realizado × resultado, custo por venda, tendência de eficiência e eficiência por centro.
- **Limites honestos:** Sucesso do Cliente (retenção, churn, receita preservada) e Produto (adoção, payback) ainda não têm fonte de resultado confiável no sistema; ficam para quando houver dado (pagamentos do IXC "Aguardando IXC").

## Fase 7 — Fechamento mensal, relatório por e-mail e avisos (entregue)
- **Fechamento por competência** (Planejamento orçamentário → Fechamento mensal): aberto → em conferência → aguardando validação → fechado; reabertura excepcional só pela Diretoria com justificativa. Quem envia para validação não valida. Ao fechar, a fotografia (por centro e consolidado: original, revisado, aprovado, comprometido, realizado, pago, saldo, desvio, excedentes, Guardião consumido, vencidos, pagos com atraso, juros e multas, economia, resultado e eficiência) fica gravada (migração 0155).
- **Período travado:** com a competência fechada, nada retroativo entra (planejamento da competência, despesa, pagamento ou estorno com data no mês, gasto avulso).
- **Relatório por e-mail:** um por destinatário com o escopo dele (responsável, gestor, Diretoria consolidada, Financeiro), HTML em tabelas com CSS inline (Gmail e Outlook), gráfico de barras em tabela, valores e datas em pt-BR, link para o sistema (pede login). Pré-visualização, aprovação antes do envio (configurável), envio manual ou automático pela rotina diária, reenvio, tentativas e histórico; falha de SMTP fica registrada.
- **Avisos no sino (sem duplicar):** nova solicitação, recomendação da Gerência, questionamento, resposta, aprovado/rejeitado/revisão, Budget Guardião pedido e decidido, limite de alerta e de bloqueio do centro, pagamento a vencer e vencido (rotina diária), pagamento registrado, fechamento aguardando validação e disponível, relatório enviado.
- **Política do orçamento** (Diretoria): % de alerta e bloqueio, reserva do Guardião (global, por centro, híbrida), relatório automático e aprovação antes do envio.

## Próximas fases
- **8 — Homologação** final dos critérios de aceite restantes.
