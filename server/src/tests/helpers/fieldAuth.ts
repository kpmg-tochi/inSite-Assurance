/**
 * Redesign R1d test helpers: field sessions belong to provisioned accounts (join codes are gone).
 * `createFieldSession` makes an account, its device, the project assignment and the session; and
 * `fieldAuth` signs the mobile-account token that resolves to an existing session.
 */
import crypto from 'crypto';

type PrismaClientType = typeof import('../../config/prisma')['prisma'];

export interface TestDeviceKey {
  publicKey: string;
  keyId: string;
  sign: (message: string) => string;
}

/** A fresh Ed25519 device key in the format the app sends (base64 raw public key). */
export function makeTestDeviceKey(): TestDeviceKey {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x as string, 'base64url');
  return {
    publicKey: raw.toString('base64'),
    keyId: crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16),
    sign: (message: string) => crypto.sign(null, Buffer.from(message), privateKey).toString('base64'),
  };
}

/**
 * Creates a provisioned field account on `projectId` working under the mobile role `roleCode` (or
 * `roleId`), and its session. Returns the session id (plus the account and device ids).
 */
export async function createFieldSession(
  prisma: PrismaClientType,
  params: {
    projectId: string;
    roleCode?: string;
    roleId?: string;
    name?: string;
    phoneNumber?: string;
    key?: TestDeviceKey;
    organizationId?: string;
    /** Reuse an existing account (it gets a new device and is assigned to the project). */
    userId?: string;
    /** Physical device id; defaults to a fresh one. Two accounts may share a phone. */
    deviceId?: string;
  }
): Promise<{ sessionId: string; userId: string; mobileDeviceId: string; key: TestDeviceKey }> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: params.projectId }, select: { tenantId: true } });
  const role = params.roleId
    ? await prisma.role.findUniqueOrThrow({ where: { id: params.roleId } })
    : await prisma.role.findFirstOrThrow({ where: { tenantId: project.tenantId, code: params.roleCode ?? 'MONITOR_INSPECTOR' } });
  const organizationId =
    params.organizationId ??
    (await prisma.organization.findFirstOrThrow({ where: { tenantId: project.tenantId }, orderBy: { createdAt: 'asc' } })).id;
  const key = params.key ?? makeTestDeviceKey();
  const suffix = crypto.randomUUID().slice(0, 8);
  const name = params.name ?? 'Test field user';
  const phone = params.phoneNumber ?? '+23480' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  const user = params.userId
    ? await prisma.user.findUniqueOrThrow({ where: { id: params.userId } })
    : await prisma.user.create({
        data: {
          tenantId: project.tenantId,
          email: `field-${suffix}@insite.test`,
          passwordHash: 'not-used-in-tests',
          fullName: name,
          roleId: role.id,
          phoneNumber: phone,
          organizationId,
        },
      });
  const deviceId = params.deviceId ?? `TEST-DEVICE-${suffix}`;
  const device = await prisma.mobileDevice.create({
    data: { userId: user.id, deviceId, publicKey: key.publicKey, publicKeyAlg: 'ED25519', publicKeyId: key.keyId },
  });
  await prisma.userProjectAssignment.createMany({ data: [{ userId: user.id, projectId: params.projectId }], skipDuplicates: true });
  const session = await prisma.fieldAgentSession.create({
    data: {
      projectId: params.projectId,
      userId: user.id,
      mobileDeviceId: device.id,
      roleId: role.id,
      roleNameSnapshot: role.name,
      fieldPersonaType: role.fieldPersonaType,
      assuranceWeight: role.assuranceWeight,
      agentFullName: name,
      agentPhoneNumber: phone,
      deviceId,
      devicePublicKey: key.publicKey,
      devicePublicKeyAlg: 'ED25519',
      devicePublicKeyId: key.keyId,
      devicePublicKeyAddedAt: new Date(),
    },
  });
  return { sessionId: session.id, userId: user.id, mobileDeviceId: device.id, key };
}

/**
 * The Authorization header for an existing field session: the mobile-account token of the
 * session's user and device. The server resolves it back to this session for the URL project.
 */
export async function fieldAuth(prisma: PrismaClientType, sessionId: string): Promise<{ Authorization: string }> {
  const { signMobileUserToken } = await import('../../middleware/auth.middleware');
  const session = await prisma.fieldAgentSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { userId: true, mobileDeviceId: true, user: { select: { tenantId: true, tokenVersion: true } } },
  });
  if (!session.mobileDeviceId) throw new Error(`Session ${sessionId} has no mobile device`);
  const token = signMobileUserToken({
    userId: session.userId,
    tenantId: session.user.tenantId,
    deviceRowId: session.mobileDeviceId,
    tokenVersion: session.user.tokenVersion,
  });
  return { Authorization: `Bearer ${token}` };
}

/** The bare token for an existing field session (see fieldAuth). */
export async function fieldToken(prisma: PrismaClientType, sessionId: string): Promise<string> {
  return (await fieldAuth(prisma, sessionId)).Authorization.slice('Bearer '.length);
}
