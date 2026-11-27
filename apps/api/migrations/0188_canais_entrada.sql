-- Canais de entrada a mais (27/11/2026): os mesmos canais que as campanhas já usam. Só inclui o que falta em cada empresa.
INSERT INTO "lead_sources" ("tenant_id", "name")
SELECT t.id, n.name
FROM "tenants" t
CROSS JOIN (VALUES ('E-mail marketing'), ('Facebook'), ('Google'), ('Rádio'), ('Panfleto'), ('Outdoor'), ('Porta a porta')) AS n(name)
WHERE NOT EXISTS (SELECT 1 FROM "lead_sources" s WHERE s.tenant_id = t.id AND lower(s.name) = lower(n.name));
