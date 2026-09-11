-- Invoice numbering moves from one shared series to a series per business line.
-- The shared counter must carry over to the line that has been using it, or the
-- cards series would restart from its configured start number and re-issue
-- invoice numbers that already exist on real documents.
--
-- The old name is "INV-<fy>"; the new one is "INV-<lineId>-<fy>". Copy the
-- value across for every financial year the old series was used in, to whichever
-- line those invoices actually belong to (cards, in practice).
INSERT INTO "Sequence" ("name", "value")
SELECT 'INV-' || bl."id" || '-' || substring(s."name" from 5), s."value"
FROM "Sequence" s
CROSS JOIN LATERAL (
  SELECT i."lineId" AS "id"
  FROM "Invoice" i
  WHERE i."lineId" IS NOT NULL
  GROUP BY i."lineId"
  ORDER BY COUNT(*) DESC
  LIMIT 1
) bl
WHERE s."name" LIKE 'INV-%'
  AND s."name" NOT LIKE 'INV-L%'
ON CONFLICT ("name") DO UPDATE SET "value" = GREATEST("Sequence"."value", EXCLUDED."value");
