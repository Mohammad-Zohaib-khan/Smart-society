import type { Types } from 'mongoose';
import { ROLE_LABELS, type CreatedInvite, type SocietyRole } from '@smart-society/shared';
import { Invite, Society } from '../models/index.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { runtime } from './runtime.js';

const INVITE_TTL_DAYS = 7;

export async function createInvite(args: {
  societyId: Types.ObjectId;
  email: string;
  name: string;
  role: SocietyRole;
  unitId: Types.ObjectId | null;
  createdBy: Types.ObjectId;
}): Promise<CreatedInvite> {
  const { now, env, email: provider, logger } = runtime();
  // Only the newest invitation for an address stays usable.
  await Invite.updateMany(
    { societyId: args.societyId, email: args.email, acceptedAt: null, revokedAt: null },
    { $set: { revokedAt: now() } },
  );
  const token = randomToken(32);
  const expiresAt = new Date(now().getTime() + INVITE_TTL_DAYS * 86_400_000);
  const invite = await Invite.create({ ...args, tokenHash: sha256(token), expiresAt });
  const acceptUrl = `${env.APP_URL}/accept-invite?token=${token}`;
  const society = await Society.findById(args.societyId, { name: 1 }).lean();

  let emailDelivered = false;
  if (provider.kind === 'smtp') {
    try {
      emailDelivered = await provider.send({
        to: args.email,
        subject: `You're invited to ${society?.name ?? 'Smart Society'}`,
        text: `Hello ${args.name},\n\nYou have been invited to join ${society?.name ?? 'your society'} on Smart Society as ${ROLE_LABELS[args.role]}.\nAccept within ${INVITE_TTL_DAYS} days: ${acceptUrl}`,
      });
    } catch (err) {
      logger.warn({ err }, 'Invite email failed; returning link to the inviter instead');
    }
  } else if (provider.kind === 'console') {
    await provider.send({ to: args.email, subject: 'Invitation', text: acceptUrl });
  }
  return {
    inviteId: String(invite._id),
    // Without confirmed delivery the inviter must share the link through their own channel.
    acceptUrl: emailDelivered ? null : acceptUrl,
    emailDelivered,
    expiresAt: expiresAt.toISOString(),
  };
}
