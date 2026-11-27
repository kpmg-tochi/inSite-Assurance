-- Needs pipeline wave 5 (N8): result of the device signature check on a verification capture.
ALTER TABLE "needs_verification_captures" ADD COLUMN "signatureVerified" BOOLEAN;
