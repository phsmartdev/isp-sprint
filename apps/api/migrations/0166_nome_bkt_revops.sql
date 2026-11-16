-- O nome da ferramenta passa a ser "BKT RevOps" (antes "ISP Sprint"): corrige nome, descrição e etiquetas dos projetos
-- criados com o nome antigo (ex.: "Implantação ISP Sprint — Frente X"). O histórico de eventos não é reescrito.
UPDATE "projects" SET
  "name" = replace(replace("name", 'ISP Sprint', 'BKT RevOps'), 'ISP-SPRINT', 'BKT RevOps'),
  "description" = replace(replace("description", 'ISP Sprint', 'BKT RevOps'), 'ISP-SPRINT', 'BKT RevOps'),
  "tags" = (SELECT coalesce(array_agg(replace(replace(t, 'ISP Sprint', 'BKT RevOps'), 'ISP-SPRINT', 'BKT RevOps')), '{}'::text[]) FROM unnest("tags") AS t)
WHERE "name" LIKE '%ISP Sprint%' OR "name" LIKE '%ISP-SPRINT%' OR "description" LIKE '%ISP Sprint%' OR "description" LIKE '%ISP-SPRINT%'
   OR EXISTS (SELECT 1 FROM unnest("tags") AS t WHERE t LIKE '%ISP Sprint%' OR t LIKE '%ISP-SPRINT%');
