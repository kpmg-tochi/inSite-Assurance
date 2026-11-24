-- CreateEnum
CREATE TYPE "VisitDateChangeKind" AS ENUM ('MANAGER_MOVE', 'OFFICER_MOVE', 'OFFICER_PROPOSAL');

-- CreateEnum
CREATE TYPE "VisitDateChangeStatus" AS ENUM ('APPLIED', 'PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "visit_date_changes" (
    "id" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "kind" "VisitDateChangeKind" NOT NULL,
    "status" "VisitDateChangeStatus" NOT NULL,
    "fromDate" TEXT NOT NULL,
    "toDate" TEXT NOT NULL,
    "comment" TEXT,
    "byUserId" UUID,
    "byName" TEXT NOT NULL,
    "clientActionId" UUID,
    "decidedByUserId" UUID,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_date_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visit_date_changes_clientActionId_key" ON "visit_date_changes"("clientActionId");

-- CreateIndex
CREATE INDEX "visit_date_changes_visitId_createdAt_idx" ON "visit_date_changes"("visitId", "createdAt");

-- AddForeignKey
ALTER TABLE "visit_date_changes" ADD CONSTRAINT "visit_date_changes_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written (D-R4.4): at most one pending date proposal per visit.
CREATE UNIQUE INDEX "visit_date_changes_one_pending_per_visit" ON "visit_date_changes" ("visitId") WHERE "status" = 'PENDING';

-- Officer responses (idempotent on clientActionId).
-- CreateEnum
CREATE TYPE "VisitResponseAction" AS ENUM ('CONFIRM', 'MOVE', 'PROPOSE', 'DECLINE');

-- CreateTable
CREATE TABLE "visit_responses" (
    "id" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "clientActionId" UUID NOT NULL,
    "action" "VisitResponseAction" NOT NULL,
    "userId" UUID NOT NULL,
    "userName" TEXT NOT NULL,
    "date" TEXT,
    "comment" TEXT,
    "dateChangeId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visit_responses_clientActionId_key" ON "visit_responses"("clientActionId");

-- CreateIndex
CREATE INDEX "visit_responses_visitId_createdAt_idx" ON "visit_responses"("visitId", "createdAt");

-- AddForeignKey
ALTER TABLE "visit_responses" ADD CONSTRAINT "visit_responses_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
