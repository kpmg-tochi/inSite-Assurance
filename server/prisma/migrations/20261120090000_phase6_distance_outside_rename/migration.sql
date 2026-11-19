-- Phase 6 follow-up: the stored value is the distance OUTSIDE the boundary (0 when inside), not the
-- distance to the boundary. Rename it to say so.
ALTER TABLE "FieldEvidenceLog" RENAME COLUMN "distanceToBoundaryMeters" TO "distanceOutsideMeters";
ALTER TABLE "site_telemetry_pings" RENAME COLUMN "distanceToBoundaryMeters" TO "distanceOutsideMeters";

-- Same key inside stored report geotags.
UPDATE "workday_reports"
SET "submissionGeotag" = ("submissionGeotag" - 'distanceToBoundaryMeters')
  || jsonb_build_object('distanceOutsideMeters', "submissionGeotag" -> 'distanceToBoundaryMeters')
WHERE "submissionGeotag" IS NOT NULL AND "submissionGeotag" ? 'distanceToBoundaryMeters';
