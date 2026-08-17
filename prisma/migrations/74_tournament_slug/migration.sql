-- Tournament.slug — a readable public URL (/tournaments/sayans-and-friends)
-- instead of the cuid the public page used to require.
--
-- The backfill runs HERE, in the migration itself, rather than as a
-- separate one-off script run by hand afterwards. Migration 69
-- (Sale.businessDate) took the other route — its schema comment promised
-- "a one-off script backfills every existing row once", that script was
-- never committed, and whether it actually ran could only be established
-- later by querying production directly. Doing it inline means the column
-- can be NOT NULL the moment this migration finishes, and there is no
-- second step anyone can forget.

-- 1. Add nullable so existing rows can be populated before the constraint.
ALTER TABLE "Tournament" ADD COLUMN "slug" TEXT;

-- 2. Slugify the name: lowercase, every run of non-alphanumerics becomes a
--    single dash, leading/trailing dashes trimmed. Mirrors
--    slugifyTournamentName in services/tournaments/tournament-slug.ts —
--    the two must agree, so a row created before this migration and one
--    created after get the same shape of slug.
UPDATE "Tournament"
SET "slug" = trim(both '-' from regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g'));

-- 3. A name made entirely of punctuation slugifies to an empty string —
--    fall back to a stable, id-derived value rather than leaving it null.
UPDATE "Tournament"
SET "slug" = 'tournament-' || substr("id", 1, 8)
WHERE "slug" IS NULL OR "slug" = '';

-- 4. De-duplicate. Two tournaments legitimately share a name across years
--    ("Summer Open"); oldest keeps the bare slug, the rest get -2, -3, ...
--    ordered by createdAt so the numbering is stable and not arbitrary.
WITH ranked AS (
  SELECT "id", "slug", row_number() OVER (PARTITION BY "slug" ORDER BY "createdAt", "id") AS rn
  FROM "Tournament"
)
UPDATE "Tournament" t
SET "slug" = t."slug" || '-' || ranked.rn
FROM ranked
WHERE t."id" = ranked."id" AND ranked.rn > 1;

-- 5. Lock it in. If step 4 somehow still collided (a pre-existing name that
--    already looked like "summer-open-2" colliding with the generated
--    suffix for "Summer Open"), this index creation fails and the whole
--    migration rolls back — a loud, recoverable failure rather than a
--    silently wrong public URL.
ALTER TABLE "Tournament" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "Tournament_slug_key" ON "Tournament"("slug");
