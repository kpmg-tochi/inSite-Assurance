-- CreateTable
CREATE TABLE "visit_form_snapshots" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "visitKind" "VisitKind" NOT NULL,
    "visitDate" TEXT NOT NULL,
    "sprintId" UUID,
    "templateId" UUID NOT NULL,
    "sectionIds" UUID[],
    "subFormIds" UUID[],
    "snapshotJson" JSONB NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "builtAt" TIMESTAMP(3) NOT NULL,
    "builtByUserId" UUID,

    CONSTRAINT "visit_form_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visit_form_snapshots_projectId_idx" ON "visit_form_snapshots"("projectId");

-- CreateIndex
CREATE INDEX "visit_form_snapshots_templateId_idx" ON "visit_form_snapshots"("templateId");

-- AddForeignKey
ALTER TABLE "visit_form_snapshots" ADD CONSTRAINT "visit_form_snapshots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_form_snapshots" ADD CONSTRAINT "visit_form_snapshots_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_form_snapshots" ADD CONSTRAINT "visit_form_snapshots_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "project_sprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_form_snapshots" ADD CONSTRAINT "visit_form_snapshots_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "visit_form_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
