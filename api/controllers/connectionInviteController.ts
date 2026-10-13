import { Response } from 'express';
import { ClientRequest } from '../middlewares/clientMiddleware.js';
import ConnectionInvite from '../models/ConnectionInvite.js';
import type { IConnectionInvite } from '../models/ConnectionInvite.js';
import WhatsAppAccount from '../models/WhatsAppAccount.js';
import { decryptFromStorage, encryptForStorage } from '../services/secretVault.js';
import {
  MAX_ACTIVE_INVITES,
  canStartConnection,
  generateInviteToken,
  hashInviteToken,
  inviteExpiry,
  inviteView,
} from '../services/connectionInvite.js';

const MAX_LABEL_CHARS = 60;

/** What the panel shows. The link is only included while it can still be used. */
const present = (invite: IConnectionInvite & { tokenEnc?: string }) => {
  const view = inviteView(invite);
  let path: string | undefined;
  if (canStartConnection(view) && invite.tokenEnc) {
    try {
      path = `/conectar/${decryptFromStorage(invite.tokenEnc)}`;
    } catch {
      path = undefined;
    }
  }
  return {
    id: String(invite._id),
    displayName: invite.displayName || null,
    status: view,
    path,
    whatsappAccountId: invite.whatsappAccountId ? String(invite.whatsappAccountId) : null,
    expiresAt: invite.expiresAt,
    createdAt: invite.createdAt,
    startedAt: invite.startedAt || null,
    connectedAt: invite.connectedAt || null,
  };
};

export const listConnectionInvites = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const invites = await ConnectionInvite.find({ clientId: req.currentClient._id })
      .select('+tokenEnc')
      .sort({ createdAt: -1 })
      .limit(50);

    // A link whose number is already connected must not keep saying "connecting"
    const open = invites.filter((i) => i.status === 'started' && i.whatsappAccountId);
    if (open.length > 0) {
      const connected = await WhatsAppAccount.find({
        _id: { $in: open.map((i) => i.whatsappAccountId) },
        status: 'connected',
      }).select('_id');
      const connectedIds = new Set(connected.map((a) => String(a._id)));
      const done = open.filter((i) => connectedIds.has(String(i.whatsappAccountId)));
      if (done.length > 0) {
        const now = new Date();
        await ConnectionInvite.updateMany(
          { _id: { $in: done.map((i) => i._id) } },
          { $set: { status: 'connected', connectedAt: now } },
        );
        for (const invite of done) {
          invite.status = 'connected';
          invite.connectedAt = now;
        }
      }
    }

    res.json(invites.map((invite) => present(invite)));
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const createConnectionInvite = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
    if (displayName.length > MAX_LABEL_CHARS) {
      res.status(400).json({ message: `displayName must have up to ${MAX_LABEL_CHARS} characters` });
      return;
    }

    const expiresAt = inviteExpiry(req.body?.expiresInDays);
    if (!expiresAt) {
      res.status(400).json({ message: 'expiresInDays must be an integer between 1 and 30' });
      return;
    }

    const active = await ConnectionInvite.countDocuments({
      clientId: req.currentClient._id,
      status: { $in: ['pending', 'started'] },
      expiresAt: { $gt: new Date() },
    });
    if (active >= MAX_ACTIVE_INVITES) {
      res.status(400).json({ message: `Limit of ${MAX_ACTIVE_INVITES} active links reached. Revoke an old one first.` });
      return;
    }

    const token = generateInviteToken();
    const invite = await ConnectionInvite.create({
      clientId: req.currentClient._id,
      createdBy: req.user?._id,
      tokenHash: hashInviteToken(token),
      tokenEnc: encryptForStorage(token),
      displayName: displayName || undefined,
      status: 'pending',
      expiresAt,
    });

    // the token is only in memory here, it is never logged
    res.status(201).json({ ...present(invite), path: `/conectar/${token}` });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Revokes a link that is still usable. Links that already ended (connected, expired, revoked)
 * are removed from the list instead; the connected WhatsApp number is not touched.
 */
export const deleteConnectionInvite = async (req: ClientRequest, res: Response): Promise<void> => {
  try {
    const invite = await ConnectionInvite.findOne({ _id: req.params.id, clientId: req.currentClient._id });
    if (!invite) {
      res.status(404).json({ message: 'Invite not found' });
      return;
    }

    if (canStartConnection(inviteView(invite))) {
      invite.status = 'revoked';
      await invite.save();
      res.json({ ok: true, revoked: true });
      return;
    }

    await ConnectionInvite.deleteOne({ _id: invite._id });
    res.json({ ok: true, revoked: false });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
