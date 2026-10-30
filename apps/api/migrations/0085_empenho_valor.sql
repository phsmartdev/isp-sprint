ALTER TABLE "contract_commitment_moves" DROP CONSTRAINT "contract_commitment_moves_kind_ck";--> statement-breakpoint
ALTER TABLE "contract_commitment_moves" DROP CONSTRAINT "contract_commitment_moves_qty_ck";--> statement-breakpoint
ALTER TABLE "contract_adjustments" ADD COLUMN "reprice_open" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_commitment_items" ADD COLUMN "price4" bigint;--> statement-breakpoint
ALTER TABLE "contract_commitment_moves" ADD COLUMN "value4" bigint;--> statement-breakpoint
ALTER TABLE "contract_commitment_moves" ADD CONSTRAINT "contract_commitment_moves_kind_ck" CHECK (kind in ('reforco','anulacao','supressao','reforco_valor'));--> statement-breakpoint
ALTER TABLE "contract_commitment_moves" ADD CONSTRAINT "contract_commitment_moves_qty_ck" CHECK (qty4 > 0 or (kind = 'reforco_valor' and qty4 = 0 and value4 > 0));--> statement-breakpoint
UPDATE "contract_commitment_items" ci SET "price4" = coalesce(
  (SELECT lp."price4" FROM "contract_line_prices" lp WHERE lp."line_id" = ci."line_id" AND lp."from_competence" <= to_char(c."issued_on", 'YYYY-MM') ORDER BY lp."from_competence" DESC LIMIT 1),
  l."price4")
FROM "contract_commitments" c, "contract_lines" l
WHERE c."id" = ci."commitment_id" AND l."id" = ci."line_id" AND ci."price4" IS NULL;
