-- One phone can hold a provisioned account and several join-code sessions, so a push token is unique
-- per owner rather than globally.
DROP INDEX "push_tokens_deviceToken_key";

ALTER TABLE "push_tokens" ADD COLUMN "ownerKey" TEXT;
UPDATE "push_tokens" SET "ownerKey" = CASE
  WHEN "sessionId" IS NOT NULL THEN 'session:' || "sessionId"::text
  WHEN "userId" IS NOT NULL THEN 'web:' || "userId"::text
  ELSE 'unowned:' || "id"::text
END;
ALTER TABLE "push_tokens" ALTER COLUMN "ownerKey" SET NOT NULL;

CREATE UNIQUE INDEX "push_tokens_deviceToken_ownerKey_key" ON "push_tokens"("deviceToken", "ownerKey");
