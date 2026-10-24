/**
 * Fichas dos indicadores principais (formulário de criação de KPI da área) e resultados FICTÍCIOS de
 * demonstração, para o painel não nascer vazio. Os resultados de demonstração ficam marcados
 * (source = 'demonstracao'), aparecem com aviso no painel e saem com um clique; os nomes das pessoas
 * responsáveis não vêm aqui (entram quando a ficha real for importada).
 */
import { and, eq, isNull, like } from 'drizzle-orm';
import type { IndicatorDef } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

export const KPI_SHEETS: { key: string; def: IndicatorDef }[] = [
 {
  "key": "kpi_booking_de_contratos",
  "def": {
   "name": "Booking de Contratos",
   "description": "Este indicador soma o valor anualizado (ou o valor total contratado) de todos os novos contratos e expansões fechados no período analisado. Ele permite acompanhar o crescimento das vendas e entender a origem da receita, identificando o tipo de cliente atendido, como municipal, estadual, federal ou privado. Dessa forma, o KPI ajuda a avaliar o desempenho comercial e a planejar melhor as ações futuras.",
   "category": "comercial",
   "calc": "informado",
   "unit": "percentual",
   "direction": "maior",
   "period": "mes",
   "target": 45,
   "sheet": {
    "area": "Comercial",
    "objective": "Mostrar quanto de receita a empresa está garantindo com novos contratos e ampliações de contratos existentes no período.",
    "formulaText": "ACV = (ACV Fechado no período / Meta de ACV do período) ​× 100",
    "sourceSystem": "IXC",
    "owner": null,
    "collector": null,
    "tool": "BI",
    "measureFreq": "mes",
    "reviewFreq": "Semanal",
    "audience": "Diretoria Comercial e Executiva",
    "strategicObjective": "Crescimento de receita",
    "process": "Licitação/Venda Consultiva",
    "impact": "Crescimento saudável de receita",
    "related": "Mix Receita por Esfera",
    "startDate": "2026-02-02",
    "notes": "- O indicador considera exclusivamente contratos novos e expansões contratuais formalmente assinados no período de apuração.\n- Os valores são apurados de forma anualizada, conforme critérios internos vigentes, independentemente da vigência total do contrato.\n- A segmentação do mix por esfera (municipal, estadual, federal, privado etc.) é definida com base no enquadramneto cadastral do cliente no momento do fechamento do contrato.\n- A meta de ACV e os limites máximos de concentração por esfera são definidos pela diretoria e podem ser revisados se necessário para a estratégia.\n- As informações utilizadas no cálculo do indicador têm como fonte os sistemas oficiais de gestão comercial e contratos da organização.",
    "quarterTargets": [
     35,
     60,
     50,
     35
    ],
    "minAcceptable": null,
    "minOfTarget": 0.8,
    "maxDesirable": null,
    "aggregation": "media",
    "featured": true,
    "paused": false,
    "main": true
   }
  }
 },
 {
  "key": "kpi_win_rate",
  "def": {
   "name": "Win Rate",
   "description": "O indicador mede a proporção de processos licitatórios, adesões ou certames em geral vencidos pela empresa em relação ao total de processos dos quais participou em determinado período. O resultado é acompanhado de forma consolidada e segmentada por tipo de modalidade (ex.: edital, ARP, adesão), apoiando a análise de desempenho e a definição de estratégias comerciais.",
   "category": "comercial",
   "calc": "informado",
   "unit": "percentual",
   "direction": "maior",
   "period": "trimestre",
   "target": 35,
   "sheet": {
    "area": "Comercial",
    "objective": "Avaliar a eficiência da empresa em vencer licitações, atas de registro de preços (ARP) e adesões das quais participou, permitindo acompanhar o desempenho comercial por modalidade de contratação.",
    "formulaText": "WR = Nº Ganhos / Nº Participados",
    "sourceSystem": "RD Station",
    "owner": null,
    "collector": null,
    "tool": "BI",
    "measureFreq": "trimestre",
    "reviewFreq": "Mensal",
    "audience": "Diretoria Comercial e Executiva",
    "strategicObjective": "Entender padrão de licitações para um planejamento estratégico",
    "process": "Licitação/Venda Consultiva",
    "impact": "Aumento de receita e market share",
    "related": "Mix Receita por Esfera",
    "startDate": "2026-02-02",
    "notes": "- São considerados apenas processos efetivamente participados pela empresa, devidamente registrados no CRM.\n- O status de “ganho” deve estar formalmente registrado e validado conforme os critérios internos de encerramento de oportunidades.\n- O indicador não considera o valor financeiro dos contratos, apenas a quantidade de processos vencidos.\n- Processos cancelados, suspensos ou descontinuados sem resultado final não devem ser contabilizados no cálculo.\n- A classificação por modalidade segue o enquadramento definido no momento do registro do processo no CRM.\n- As informações utilizadas no cálculo do indicador têm como fonte os sistemas oficiais de gestão comercial",
    "quarterTargets": [
     35,
     35,
     35,
     35
    ],
    "minAcceptable": 25,
    "minOfTarget": null,
    "maxDesirable": 35,
    "aggregation": "media",
    "featured": true,
    "paused": false
   }
  }
 },
 {
  "key": "kpi_taxa_de_concentracao_de_receita",
  "def": {
   "name": "Taxa de Concentração de Receita (TCR)",
   "description": "O indicador mede o percentual da receita total que está concentrada em um único cliente dentro do grupo de maiores clientes (Top 7). Ele permite acompanhar o risco de concentração da carteira, apoiar decisões de diversificação de receita e monitorar a evolução desse risco ao longo do tempo.",
   "category": "comercial",
   "calc": "informado",
   "unit": "percentual",
   "direction": "menor",
   "period": "trimestre",
   "target": 15,
   "sheet": {
    "area": "Comercial",
    "objective": "Avaliar o nível de concentração da receita da empresa em determinados clientes, identificando riscos relacionados à dependência excessiva de uma carteira restrita.",
    "formulaText": "TCR = (Receita do cliente  ou grupo de clientes / Receita Total Mensal) x 100",
    "sourceSystem": "IXC",
    "owner": null,
    "collector": null,
    "tool": "BI",
    "measureFreq": "trimestre",
    "reviewFreq": "Quinzenal",
    "audience": "Diretoria Comercial e Executiva",
    "strategicObjective": "Redução de concentração de receita. No futuro aprofundar indicador com analise das receitas avulsas",
    "process": "Licitação/Venda Consultiva",
    "impact": "Crescimento saudável de receita",
    "related": "Taxa de Conversão",
    "startDate": "2026-02-02",
    "notes": "- O indicador é calculado com base no MR (Monthly Revenue) efetivamente reconhecido no período, conforme registros dos sistemas oficiais (IXC e CRM).\n- Para contratos com modelo de medição ou consumo variável, considera-se exclusivamente o valor faturado no período de apuração.\n- Contratos que não apresentarem consumo ou faturamento no período terão MR igual a zero para fins de cálculo do indicador.\n- O ranking de clientes (ex.: Top 5) é definido com base no MR do período analisado, podendo variar mês a mês em função do consumo.\n- O indicador não utiliza valores contratados, estimativas ou projeções futuras, limitando-se à receita recorrente efetivamente realizada.\n- Eventuais oscilações relevantes decorrentes de sazonalidade, contratos atípicos ou variações de consumo devem ser analisadas de forma contextualizada na análise trimestral.\n- As premissas e critérios de apuração do MR seguem as políticas internas de reconhecimento de receita",
    "quarterTargets": [
     15,
     15,
     15,
     15
    ],
    "minAcceptable": 80,
    "minOfTarget": null,
    "maxDesirable": 30,
    "aggregation": "media",
    "featured": true,
    "paused": false
   }
  }
 },
 {
  "key": "kpi_taxa_de_conversao",
  "def": {
   "name": "Taxa de Conversão",
   "description": "O indicador mede a proporção de oportunidades comerciais que resultaram em contratos fechados em relação ao total de oportunidades abertas no período analisado. Ele permite avaliar a qualidade do funil de vendas, a efetividade das estratégias comerciais e o desempenho por tipo de oportunidade, como consumo dentro de contrato, esfera pública e privada.",
   "category": "comercial",
   "calc": "informado",
   "unit": "percentual",
   "direction": "maior",
   "period": "trimestre",
   "target": 35,
   "sheet": {
    "area": "Comercial",
    "objective": "Avaliar a eficiência do funil comercial em transformar oportunidades em contratos efetivamente fechados dentro de um determinado período.",
    "formulaText": "Taxa de Conversão  = (Número de oportunidades ganhas no período / Número de oportunidades abertas período) ​× 100",
    "sourceSystem": "RD Station",
    "owner": null,
    "collector": null,
    "tool": "BI",
    "measureFreq": "trimestre",
    "reviewFreq": "Mensal",
    "audience": "Diretoria Comercial e Executiva",
    "strategicObjective": "Garantir crescimento previsível e uso eficiente do esforço comercial.",
    "process": "Licitação/Venda Consultiva",
    "impact": "Performance do departamento e eficiência de produto",
    "related": "Ciclo de Venda",
    "startDate": "2026-02-02",
    "notes": "- São consideradas apenas oportunidades devidamente registradas no CRM no período de apuração.\n- Uma oportunidade é considerada convertida quando há formalização do contrato ou aceite equivalente, conforme critérios internos.\n- O indicador não considera valores financeiros, apenas a quantidade de oportunidades convertidas.\n- O cálculo considera oportunidades abertas no período, independentemente da data de fechamento.\n- O acompanhamento semanal tem caráter gerencial e está sujeito a ajustes no fechamento mensal.\n- As metas poderão ser revistas após a consolidação de histórico suficiente para análise.",
    "quarterTargets": [
     35,
     35,
     35,
     35
    ],
    "minAcceptable": 30,
    "minOfTarget": null,
    "maxDesirable": 40,
    "aggregation": "media",
    "featured": true,
    "paused": false
   }
  }
 },
 {
  "key": "kpi_mix_receita_produto",
  "def": {
   "name": "Mix Receita Produto (MRP)",
   "description": "O indicador mede o percentual da receita total que está concentrada nos cinco produtos com maior faturamento no período analisado. Ele permite acompanhar a diversificação do portfólio de produtos, identificar riscos de concentração e apoiar decisões estratégicas relacionadas a desenvolvimento, precificação e priorização comercial.",
   "category": "comercial",
   "calc": "informado",
   "unit": "percentual",
   "direction": "menor",
   "period": "trimestre",
   "target": 30,
   "sheet": {
    "area": "Comercial",
    "objective": "Avaliar o nível de concentração da receita da empresa por produto, identificando riscos de dependência excessiva de um único produto ou de um grupo restrito de produtos.",
    "formulaText": "MRP  = (Receita Top 5 Produtos Período / Receita total Período) ​× 100",
    "sourceSystem": "IXC",
    "owner": null,
    "collector": null,
    "tool": "BI",
    "measureFreq": "trimestre",
    "reviewFreq": "Mensal",
    "audience": "Diretoria Comercial e Executiva",
    "strategicObjective": "Garantir equilíbrio do portfólio e reduzir a dependência de poucos produtos.",
    "process": "Venda Consultiva/Produto",
    "impact": "Reduzir o risco de receita em caso de descontinuidade de produtos pelo mercado.",
    "related": "TCR",
    "startDate": "2026-02-02",
    "notes": "- A receita considerada corresponde aos valores efetivamente faturados no período, conforme registros do sistema IXC.\n- O ranking dos Top 5 produtos é definido com base no faturamento do próprio período de apuração.\n- O indicador não considera receitas projetadas ou contratadas, apenas valores realizados.\n- Produtos com faturamento eventual ou sazonal podem gerar variações pontuais no indicador, devendo ser analisados de forma contextualizada.\n- A classificação e o agrupamento de produtos seguem o cadastro vigente no sistema no momento do faturamento.\n- As metas e limites de concentração por produto podem ser revisados mediante deliberação formal da gestão.",
    "quarterTargets": [
     30,
     30,
     30,
     30
    ],
    "minAcceptable": 25,
    "minOfTarget": null,
    "maxDesirable": 40,
    "aggregation": "media",
    "featured": true,
    "paused": true
   }
  }
 },
 {
  "key": "kpi_health_score",
  "def": {
   "name": "Health Score",
   "description": "O indicador mede a distribuição percentual da carteira de clientes entre as faixas de saúde definidas (Saudável, Alerta e Risco). A classificação considera múltiplos fatores, como nível de uso dos serviços, volume e recorrência de tickets, indicadores de satisfação (NPS) e situação financeira. O objetivo é antecipar riscos de churn, orientar ações de retenção e apoiar a priorização de atendimentos e estratégias de relacionamento.",
   "category": "sucesso_cliente",
   "calc": "informado",
   "unit": "percentual",
   "direction": "maior",
   "period": "trimestre",
   "target": 70,
   "sheet": {
    "area": "Sucesso do Cliente",
    "objective": "Avaliar a saúde da carteira de clientes, classificando as contas em níveis de risco (Saudável, Alerta e Risco), com base em critérios operacionais, financeiros e de satisfação.",
    "formulaText": "Health Score  = (Nº de Contas Saudáveis / Total de Contas Ativas) ​× 100",
    "sourceSystem": "RD Station",
    "owner": null,
    "collector": null,
    "tool": "BI",
    "measureFreq": "trimestre",
    "reviewFreq": "Mensal",
    "audience": "Diretoria Comercial e Executiva",
    "strategicObjective": "Preservar valor da carteira e fortalecer relações de longo prazo.",
    "process": "Venda Consultiva/Produto",
    "impact": "Aumentar a retenção de clientes, reduzir riscos na carteira e apoiar ações preventivas por meio do acompanhamento contínuo da saúde dos clientes.",
    "related": "NPS, Consumo de Contrato, % Inadimplência, Nº de Chamados",
    "startDate": "2026-02-02",
    "notes": "- A classificação das contas em faixas de saúde segue metodologia interna formalmente definida e aprovada pela gestão.\n- Os critérios e pesos utilizados no cálculo do Health Score podem incluir, entre outros: uso do serviço, tickets de suporte, NPS e situação financeira.\n- O indicador considera apenas contas ativas no período de apuração.\n- Atualizações cadastrais, atrasos de integração entre sistemas ou ausência de respostas em pesquisas de satisfação podem impactar temporariamente o resultado.\n- O acompanhamento semanal tem caráter gerencial, enquanto o resultado mensal é considerado oficial para fins de report.\n- A metodologia, os limites de classificação e as metas podem ser revisados mediante deliberação formal.",
    "quarterTargets": [
     60,
     60,
     60,
     60
    ],
    "minAcceptable": 60,
    "minOfTarget": null,
    "maxDesirable": 80,
    "aggregation": "media",
    "featured": true,
    "paused": false
   }
  }
 },
 {
  "key": "kpi_taxa_de_conversao_sql",
  "def": {
   "name": "Taxa de Conversão SQL",
   "description": "O indicador mede o percentual de leads ou demandas que, após passarem pelo processo de qualificação, foram convertidos em oportunidades comerciais registradas no CRM. Ele permite avaliar a qualidade da qualificação, a efetividade dos canais de entrada e o alinhamento entre as etapas iniciais do funil comercial.",
   "category": "comercial",
   "calc": "informado",
   "unit": "percentual",
   "direction": "maior",
   "period": "trimestre",
   "target": 35,
   "sheet": {
    "area": "Pré vendas",
    "objective": "Avaliar a eficiência do processo comercial em transformar leads/prospects ou demandas qualificadas ou não em oportunidades ativas no CRM.",
    "formulaText": "Taxa de Conversão SQL = (Nº de deals qualificados / Número total de leads) ×100",
    "sourceSystem": "RD Station",
    "owner": null,
    "collector": null,
    "tool": "BI",
    "measureFreq": "trimestre",
    "reviewFreq": "Mensal",
    "audience": "Diretoria Comercial e Executiva",
    "strategicObjective": "Aumentar a eficiência do crescimento ao levar ao comercial apenas oportunidades qualificadas.",
    "process": "Venda Consultiva/Produto",
    "impact": "Aumentar a retenção de clientes, reduzir riscos na carteira e apoiar ações preventivas por meio do acompanhamento contínuo da saúde dos clientes.",
    "related": "NPS, Consumo de Contrato, % Inadimplência, Nº de Chamados",
    "startDate": "2026-02-02",
    "notes": "- São considerados apenas leads ou demandas formalmente qualificados e registrados no CRM no período de apuração.\n- Uma oportunidade é considerada criada quando há registro ativo no CRM com responsável definido.\n- O indicador não avalia o resultado final da oportunidade, apenas sua criação.\n- Diferenças de desempenho entre canais devem ser analisadas de forma segregada.\n- Eventuais ajustes de classificação ou requalificação retroativa podem impactar o resultado do período.\n- As regras de qualificação seguem critérios internos definidos pela gestão comercial.",
    "quarterTargets": [
     20,
     20,
     20,
     20
    ],
    "minAcceptable": 20,
    "minOfTarget": null,
    "maxDesirable": 50,
    "aggregation": "media",
    "featured": true,
    "paused": true
   }
  }
 },
 {
  "key": "kpi_lead_time_viabilidade",
  "def": {
   "name": "Lead Time Viabilidade",
   "description": "O indicador mede o tempo decorrido entre a data em que a demanda é considerada qualificada e a data em que a viabilidade técnica e os insumos necessários para a proposta estão concluídos. O acompanhamento do lead time permite avaliar a eficiência do time de pré-vendas, identificar gargalos operacionais e garantir o cumprimento de prazos comerciais, incluindo exigências específicas de licitações.",
   "category": "comercial",
   "calc": "informado",
   "unit": "dias",
   "direction": "menor",
   "period": "mes",
   "target": 2,
   "sheet": {
    "area": "Pré vendas",
    "objective": "Medir o tempo necessário para que uma demanda qualificada seja transformada em viabilidade técnica concluída e insumos completos para elaboração de proposta.",
    "formulaText": "Lead Time Viabilidade = data viabilidade concluída - data de recebimento",
    "sourceSystem": "RD Station / iTop",
    "owner": null,
    "collector": null,
    "tool": "BI",
    "measureFreq": "mes",
    "reviewFreq": "Semanal",
    "audience": "Diretoria Comercial e Executiva",
    "strategicObjective": "Aumentar a velocidade de resposta comercial para sustentar competitividade e previsibilidade de fechamento.",
    "process": "Pré vendas",
    "impact": "Reduzir o tempo de resposta do pré-vendas, aumentar a agilidade na elaboração de propostas e garantir o cumprimento de prazos comerciais e de licitação.",
    "related": "Ciclo de vendas",
    "startDate": "2026-02-02",
    "notes": "- Consideram-se apenas demandas formalmente qualificadas e registradas no CRM.\n- A data de “viabilidade pronta” corresponde ao momento em que todos os insumos necessários para a proposta estão concluídos e registrados no sistema.\n- O uso da mediana reduz o impacto de casos atípicos no cálculo do indicador.\n- Demandas suspensas, canceladas ou devolvidas por inconsistência não devem ser consideradas no cálculo.\n- O acompanhamento semanal tem caráter operacional, enquanto o resultado mensal é utilizado para reporte e avaliação de desempenho\n- SLAs específicos para licitações devem ser tratados de forma segregada, conforme critérios definidos em edital.",
    "quarterTargets": [
     2,
     2,
     2,
     2
    ],
    "minAcceptable": 1,
    "minOfTarget": null,
    "maxDesirable": 5,
    "aggregation": "media",
    "featured": true,
    "paused": false
   }
  }
 },
 {
  "key": "kpi_ativacao_de_contas_alvo",
  "def": {
   "name": "Ativação de Contas-Alvo",
   "description": "O indicador mede o percentual de contas-alvo que apresentaram ao menos uma interação qualificada no período analisado. São consideradas interações qualificadas ações relevantes como reuniões realizadas, respostas a contatos, consumo de ativos-chave, participação em eventos ou outras interações definidas pela estratégia de ABM (Account-Based Marketing). O objetivo é acompanhar a efetividade das ações de engajamento e a ativação da carteira estratégica.",
   "category": "abm",
   "calc": "informado",
   "unit": "percentual",
   "direction": "maior",
   "period": "mes",
   "target": 80,
   "sheet": {
    "area": "Marketing",
    "objective": "Avaliar o nível de engajamento das contas-alvo priorizadas, verificando se houve interação qualificada ao longo do período.",
    "formulaText": "Ativação de Contas-Alvo =Total de contas-alvo Número de contas-alvo engajadas ​× 100",
    "sourceSystem": "RD Station",
    "owner": null,
    "collector": null,
    "tool": "BI",
    "measureFreq": "mes",
    "reviewFreq": "Semanal",
    "audience": "Diretoria Comercial e Executiva",
    "strategicObjective": "Garantir foco e tração nas contas estratégicas para sustentar crescimento previsível e expansão de receita.",
    "process": "ABM",
    "impact": "Aumentar o engajamento das contas estratégicas, melhorar a efetividade das ações de ABM e gerar mais oportunidades qualificadas a partir da carteira de contas-alvo.",
    "related": "Ciclo de vendas",
    "startDate": "2026-02-02",
    "notes": "- Consideram-se apenas contas previamente classificadas como contas-alvo, conforme definição estratégica vigente.\n- Uma conta é considerada engajada quando registra ao menos uma interação qualificada devidamente registrada no CRM.\n- A definição de “interação qualificada” segue critérios internos e pode incluir reuniões, respostas formais, consumo de conteúdo estratégico, participação em eventos ou ações equivalentes.\n- O indicador não mede conversão em oportunidades ou contratos, apenas engajamento.\n- O acompanhamento semanal tem caráter gerencial, enquanto o resultado mensal é utilizado para reporte e avaliação.\n- As metas e critérios de engajamento podem ser revisados mediante deliberação formal da gestão.",
    "quarterTargets": [
     60,
     80,
     90,
     90
    ],
    "minAcceptable": 70,
    "minOfTarget": null,
    "maxDesirable": 100,
    "aggregation": "media",
    "featured": true,
    "paused": false
   }
  }
 }
];

/** Série fictícia por mês (1 a 12) ou trimestre (1 a 4). */
const DEMO: Record<string, number[]> = {
  kpi_booking_de_contratos: [24, 28, 36, 52, 64, 58, 44, 51, 55, 38, 41, 47],
  kpi_lead_time_viabilidade: [3.9, 3.6, 3.1, 2.6, 2.3, 2, 1.9, 2.2, 1.8, 2.4, 2.1, 2],
  kpi_ativacao_de_contas_alvo: [40, 48, 61, 70, 78, 83, 86, 89, 92, 84, 88, 91],
  kpi_win_rate: [29, 33, 37, 31],
  kpi_taxa_de_concentracao_de_receita: [19, 17, 14, 16],
  kpi_taxa_de_conversao: [31, 36, 38, 28],
  kpi_mix_receita_produto: [34, 32, 29, 31],
  kpi_health_score: [55, 61, 66, 63],
  kpi_taxa_de_conversao_sql: [18, 22, 24, 21],
};
export const DEMO_NOTE = 'Dado fictício de demonstração';

/**
 * Cria as fichas que faltam e lança os resultados fictícios do ano até o período atual,
 * só onde ainda não há lançamento. Nunca mexe em resultado real.
 */
export async function loadKpiDemo(db: DbOrTx, tenantId: string, today: string, actorId: string | null = null) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const quarter = Math.floor((month - 1) / 3) + 1;
  let created = 0, entries = 0;
  for (const k of KPI_SHEETS) {
    let [ind] = await db.select({ id: s.indicators.id }).from(s.indicators).where(and(eq(s.indicators.tenantId, tenantId), eq(s.indicators.key, k.key))).limit(1);
    if (!ind) {
      [ind] = await db.insert(s.indicators).values({ tenantId, key: k.key, createdBy: actorId }).returning({ id: s.indicators.id });
      await db.insert(s.indicatorVersions).values({ tenantId, indicatorId: ind!.id, version: 1, def: k.def, note: 'Ficha do KPI (formulário da área)', createdBy: actorId });
      created++;
    }
    const series = DEMO[k.key];
    if (!series) continue;
    const have = new Set((await db.select({ period: s.indicatorEntries.period }).from(s.indicatorEntries).where(and(eq(s.indicatorEntries.indicatorId, ind!.id), isNull(s.indicatorEntries.supersededAt)))).map((r) => r.period));
    const periods = k.def.period === 'mes'
      ? Array.from({ length: month }, (_, i) => ({ period: `${year}-${String(i + 1).padStart(2, '0')}`, start: `${year}-${String(i + 1).padStart(2, '0')}-01`, value: series[i]! }))
      : Array.from({ length: quarter }, (_, i) => ({ period: `${year}-T${i + 1}`, start: `${year}-${String(i * 3 + 1).padStart(2, '0')}-01`, value: series[i]! }));
    for (const p of periods) {
      if (have.has(p.period) || p.value === undefined) continue;
      await db.insert(s.indicatorEntries).values({ tenantId, indicatorId: ind!.id, period: p.period, periodStart: p.start, value: p.value, note: DEMO_NOTE, source: 'demonstracao', createdBy: actorId });
      entries++;
    }
  }
  return { created, entries };
}

/** Tira os resultados de demonstração (ficam no histórico como substituídos; nada é apagado). */
export async function clearKpiDemo(db: DbOrTx, tenantId: string) {
  const r = await db.update(s.indicatorEntries).set({ supersededAt: new Date() }).where(and(eq(s.indicatorEntries.tenantId, tenantId), eq(s.indicatorEntries.source, 'demonstracao'), isNull(s.indicatorEntries.supersededAt))).returning({ id: s.indicatorEntries.id });
  return { cleared: r.length };
}

/** Empresas que ainda não têm nenhuma ficha de KPI. */
export async function tenantsWithoutKpis(db: DbOrTx) {
  const tenants = await db.select({ id: s.tenants.id }).from(s.tenants);
  const out: string[] = [];
  for (const t of tenants) {
    const [k] = await db.select({ id: s.indicators.id }).from(s.indicators).where(and(eq(s.indicators.tenantId, t.id), like(s.indicators.key, 'kpi_%'))).limit(1);
    if (!k) out.push(t.id);
  }
  return out;
}
