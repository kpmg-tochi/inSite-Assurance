-- Redesign: a workspace default radius for radial site boundaries (projects keep their own radius
-- in their geofence), and linear corridors removed (sites are radial or perimeter), with the
-- chainage columns that only corridors filled.
-- Hand edits: the data clean-up below (so this applies on a database with data).

-- Data clean-up
-- A corridor project becomes a perimeter: the corridor's bounding box widened by its half-width.
-- Redraw the boundary on the Site step if the box is too coarse.
UPDATE "Project" p SET
  "geofenceMode" = 'PERIMETER',
  "geofenceGeoJson" = jsonb_build_object(
    'mode', 'PERIMETER',
    'perimeterCoordinates', jsonb_build_array(
      jsonb_build_array(b.minx, b.miny), jsonb_build_array(b.maxx, b.miny),
      jsonb_build_array(b.maxx, b.maxy), jsonb_build_array(b.minx, b.maxy),
      jsonb_build_array(b.minx, b.miny)),
    'siteLabel', left(coalesce(p."geofenceGeoJson"->>'corridorLabel', p."name"), 120))
FROM (
  SELECT x."id",
    min(x.lon) - max(x.w) / (111320 * cos(radians(avg(x.lat)))) AS minx,
    max(x.lon) + max(x.w) / (111320 * cos(radians(avg(x.lat)))) AS maxx,
    min(x.lat) - max(x.w) / 111320 AS miny,
    max(x.lat) + max(x.w) / 111320 AS maxy
  FROM (
    SELECT pr."id", (c->>0)::float8 AS lon, (c->>1)::float8 AS lat,
      coalesce((pr."geofenceGeoJson"->>'corridorHalfWidthMeters')::float8, 100) AS w
    FROM "Project" pr, jsonb_array_elements(pr."geofenceGeoJson"->'centerlineCoordinates') c
    WHERE pr."geofenceMode" = 'LINEAR_CORRIDOR'
  ) x
  GROUP BY x."id"
) b
WHERE p."id" = b."id";
UPDATE "Project" SET "geofenceMode" = NULL WHERE "geofenceMode" = 'LINEAR_CORRIDOR';
UPDATE "tenants" SET "enabledGeofenceModes" = array_remove("enabledGeofenceModes", 'LINEAR_CORRIDOR'::"GeofenceMode");
UPDATE "tenants" SET "enabledGeofenceModes" = ARRAY['RADIAL', 'PERIMETER']::"GeofenceMode"[] WHERE cardinality("enabledGeofenceModes") = 0;

-- AlterEnum
BEGIN;
CREATE TYPE "GeofenceMode_new" AS ENUM ('RADIAL', 'PERIMETER');
ALTER TABLE "public"."tenants" ALTER COLUMN "enabledGeofenceModes" DROP DEFAULT;
ALTER TABLE "tenants" ALTER COLUMN "enabledGeofenceModes" TYPE "GeofenceMode_new"[] USING ("enabledGeofenceModes"::text::"GeofenceMode_new"[]);
ALTER TABLE "Project" ALTER COLUMN "geofenceMode" TYPE "GeofenceMode_new" USING ("geofenceMode"::text::"GeofenceMode_new");
ALTER TYPE "GeofenceMode" RENAME TO "GeofenceMode_old";
ALTER TYPE "GeofenceMode_new" RENAME TO "GeofenceMode";
DROP TYPE "public"."GeofenceMode_old";
ALTER TABLE "tenants" ALTER COLUMN "enabledGeofenceModes" SET DEFAULT ARRAY['RADIAL', 'PERIMETER']::"GeofenceMode"[];
COMMIT;

-- AlterTable
ALTER TABLE "FieldEvidenceLog" DROP COLUMN "chainageKm",
DROP COLUMN "chainageLabel",
DROP COLUMN "corridorOffsetMeters";

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "defaultGeofenceRadiusMeters" INTEGER NOT NULL DEFAULT 150,
ALTER COLUMN "enabledGeofenceModes" SET DEFAULT ARRAY['RADIAL', 'PERIMETER']::"GeofenceMode"[];

-- AlterTable
ALTER TABLE "wbs_chat_messages" DROP COLUMN "chainageLabel";
