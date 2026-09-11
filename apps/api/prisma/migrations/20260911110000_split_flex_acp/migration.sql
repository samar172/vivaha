-- Flex and ACP were one line, "Flex & ACP" (L3). They are bought by different
-- firms, priced differently and stocked differently, so they are separated here
-- into a line each. L3 keeps its id and its code so nothing referencing it
-- breaks; only its display name narrows to Flex. ACP becomes a line of its own.
--
-- Existing OrderLine rows keep the lineId they were written with, so order
-- history continues to read the way it did when the order was placed.

-- Job Work sits last; ACP takes the slot before it.
UPDATE "BusinessLine" SET "sortOrder" = 5 WHERE "id" = 'L4';

UPDATE "BusinessLine"
SET "name" = 'Flex', "nameHi" = 'फ़्लेक्स'
WHERE "id" = 'L3';

INSERT INTO "BusinessLine" (
  "id", "code", "name", "nameHi", "icon", "color", "bg", "uom", "packUoms",
  "minSetQty", "holdMins", "gstPct", "stockDims", "batchTracked",
  "pricingModel", "workflow", "facets", "sortOrder", "isActive"
) VALUES (
  'L5', 'acp', 'ACP', 'एसीपी', '▭', '#B45309', '#FEF6EC', 'SQ.FT', '["Sheet"]',
  32, 45, 18, '["lot"]', false,
  'AREA', 'FULFIL', '["material","thickness","finish"]', 4, true
) ON CONFLICT ("id") DO NOTHING;

-- Only items the catalogue already calls ACP move across; everything else stays
-- where it is rather than being guessed at.
UPDATE "Item" SET "lineId" = 'L5'
WHERE "lineId" = 'L3' AND "attrs"->>'material' = 'ACP';

-- A firm that dealt in the combined line dealt in both halves of it, so it must
-- keep seeing both. Appended only where it is not already present.
UPDATE "Customer"
SET "linesEnabled" = "linesEnabled" || '["L5"]'::jsonb
WHERE "linesEnabled" @> '["L3"]'::jsonb
  AND NOT ("linesEnabled" @> '["L5"]'::jsonb);
