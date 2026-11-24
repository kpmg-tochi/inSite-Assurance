import crypto from "crypto";
import { DEVICE_SIGNATURE_ALGORITHM } from "@insite/shared";
import { prisma } from "../config/prisma";

/**
 * Redesign R1d: the mobile app's only way in is a provisioned account (decision P2, no join codes).
 * Seeds create field users the same way: a user whose main role is the mobile role, one registered
 * device (deterministic Ed25519 key derived from the device id) and one field session per project.
 */

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** A deterministic Ed25519 key pair for a seeded device. */
export function seedDeviceKey(deviceId: string): { publicKey: string; keyId: string; privateKey: crypto.KeyObject } {
  const seed = crypto.createHash("sha256").update(`seed-device:${deviceId}`).digest();
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" });
  const jwk = crypto.createPublicKey(privateKey).export({ format: "jwk" }) as { x: string };
  const raw = Buffer.from(jwk.x, "base64url");
  return {
    publicKey: raw.toString("base64"),
    keyId: crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16),
    privateKey,
  };
}

export async function seedFieldAccount(params: {
  tenantId: string;
  organizationId: string;
  email: string;
  fullName: string;
  phoneNumber?: string | null;
  role: { id: string; name: string; fieldPersonaType: string; assuranceWeight: number };
  projectIds: string[];
  deviceId: string;
  deviceModel?: string | null;
  deviceOs?: string | null;
  passwordHash: string;
  lastSyncAt?: Date;
}): Promise<{ userId: string; mobileDeviceId: string; sessionIds: Record<string, string> }> {
  const key = seedDeviceKey(params.deviceId);
  const user = await prisma.user.create({
    data: {
      tenantId: params.tenantId,
      email: params.email,
      passwordHash: params.passwordHash,
      fullName: params.fullName,
      roleId: params.role.id,
      organizationId: params.organizationId,
      phoneNumber: params.phoneNumber ?? null,
    },
  });
  const device = await prisma.mobileDevice.create({
    data: {
      userId: user.id,
      deviceId: params.deviceId,
      deviceModel: params.deviceModel ?? null,
      deviceOs: params.deviceOs ?? null,
      publicKey: key.publicKey,
      publicKeyAlg: DEVICE_SIGNATURE_ALGORITHM,
      publicKeyId: key.keyId,
      lastSeenAt: params.lastSyncAt ?? new Date(),
    },
  });
  if (params.projectIds.length) {
    await prisma.userProjectAssignment.createMany({
      data: params.projectIds.map((projectId) => ({ userId: user.id, projectId })),
      skipDuplicates: true,
    });
  }
  const sessionIds: Record<string, string> = {};
  for (const projectId of params.projectIds) {
    const session = await prisma.fieldAgentSession.create({
      data: {
        projectId,
        userId: user.id,
        mobileDeviceId: device.id,
        roleId: params.role.id,
        roleNameSnapshot: params.role.name,
        fieldPersonaType: params.role.fieldPersonaType as "INDEPENDENT_VERIFIER",
        assuranceWeight: params.role.assuranceWeight,
        agentFullName: params.fullName,
        agentPhoneNumber: params.phoneNumber ?? "",
        deviceId: params.deviceId,
        deviceModel: params.deviceModel ?? null,
        deviceOs: params.deviceOs ?? null,
        devicePublicKey: key.publicKey,
        devicePublicKeyAlg: DEVICE_SIGNATURE_ALGORITHM,
        devicePublicKeyId: key.keyId,
        devicePublicKeyAddedAt: new Date(),
        lastSyncAt: params.lastSyncAt ?? new Date(),
      },
    });
    sessionIds[projectId] = session.id;
  }
  return { userId: user.id, mobileDeviceId: device.id, sessionIds };
}
