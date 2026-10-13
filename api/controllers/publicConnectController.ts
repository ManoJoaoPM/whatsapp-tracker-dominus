import { Request, Response } from 'express';
import Client from '../models/Client.js';
import ConnectionInvite from '../models/ConnectionInvite.js';
import type { IConnectionInvite } from '../models/ConnectionInvite.js';
import WhatsAppAccount from '../models/WhatsAppAccount.js';
import type { IWhatsAppAccount } from '../models/WhatsAppAccount.js';
import { connectInstance, getConnectionState, requestPairingCode } from '../services/evolutionService.js';
import {
  extractQrCode,
  mapEvolutionStateToStatus,
  provisionEvolutionAccount,
} from '../services/whatsappProvisioning.js';
import {
  canStartConnection,
  hashInviteToken,
  inviteView,
  isValidInviteTokenShape,
  sanitizePairingPhone,
} from '../services/connectionInvite.js';

/**
 * Endpoints behind the public link /conectar/:token. There is no login: the token is the only
 * credential, so these handlers expose the minimum (company name, status, QR code) and never
 * return ids, instance names or any other data of the company.
 */

/** WhatsApp rotates the QR code about every 20 seconds */
const QR_REFRESH_SECONDS = 25;
/** An instance that is still being created is considered abandoned after this long */
const PROVISION_LOCK_MS = 60_000;

const GENERIC_ERROR = 'Não foi possível concluir agora. Tente de novo em instantes.';

const findInvite = async (token: unknown): Promise<IConnectionInvite | null> => {
  if (!isValidInviteTokenShape(token)) return null;
  return ConnectionInvite.findOne({ tokenHash: hashInviteToken(token) });
};

const notFound = (res: Response) => res.status(404).json({ status: 'invalid' });

const markConnected = async (invite: IConnectionInvite, account: IWhatsAppAccount, io: any): Promise<void> => {
  if (account.status !== 'connected') {
    account.status = 'connected';
    if (!account.connectedAt) account.connectedAt = new Date();
    await account.save();
  }

  if (invite.status !== 'connected') {
    await ConnectionInvite.updateOne(
      { _id: invite._id },
      { $set: { status: 'connected', connectedAt: new Date() }, $unset: { provisioningAt: 1 } },
    );
    invite.status = 'connected';
    // lets the agency's panel update without a refresh
    io?.to(String(invite.clientId)).emit('connection_update', {
      whatsappAccountId: String(account._id),
      status: 'connected',
    });
  }
};

// `account` is always present when `busy` is false
type Ensured = { busy: boolean; account?: IWhatsAppAccount; qrCode?: string | null };

/**
 * Returns the WhatsApp account of the link, creating it the first time. Two simultaneous
 * requests never create two accounts: only the one that wins the lock provisions.
 */
const ensureAccount = async (invite: IConnectionInvite): Promise<Ensured> => {
  if (invite.whatsappAccountId) {
    const existing = await WhatsAppAccount.findById(invite.whatsappAccountId);
    if (existing) return { busy: false, account: existing, qrCode: null };
    // the agency deleted the number: start over
  }

  const lockCutoff = new Date(Date.now() - PROVISION_LOCK_MS);
  const claimed = await ConnectionInvite.findOneAndUpdate(
    { _id: invite._id, $or: [{ provisioningAt: { $exists: false } }, { provisioningAt: { $lt: lockCutoff } }] },
    { $set: { provisioningAt: new Date() } },
    { new: true },
  );
  if (!claimed) return { busy: true };

  try {
    // somebody may have finished between our read and our lock
    if (claimed.whatsappAccountId && claimed.whatsappAccountId.toString() !== invite.whatsappAccountId?.toString()) {
      const created = await WhatsAppAccount.findById(claimed.whatsappAccountId);
      if (created) {
        await ConnectionInvite.updateOne({ _id: invite._id }, { $unset: { provisioningAt: 1 } });
        return { busy: false, account: created, qrCode: null };
      }
    }

    const { account, qrCode } = await provisionEvolutionAccount({
      clientId: String(invite.clientId),
      displayName: invite.displayName || undefined,
    });

    await ConnectionInvite.updateOne(
      { _id: invite._id },
      {
        $set: { whatsappAccountId: account._id, status: 'started', ...(invite.startedAt ? {} : { startedAt: new Date() }) },
        $unset: { provisioningAt: 1 },
      },
    );
    invite.whatsappAccountId = account._id;
    return { busy: false, account, qrCode };
  } catch (error) {
    await ConnectionInvite.updateOne({ _id: invite._id }, { $unset: { provisioningAt: 1 } }).catch(() => undefined);
    throw error;
  }
};

export const getInviteInfo = async (req: Request, res: Response): Promise<void> => {
  try {
    const invite = await findInvite(req.params.token);
    if (!invite) return void notFound(res);

    const client = await Client.findById(invite.clientId).select('name');
    res.json({
      status: inviteView(invite),
      companyName: client?.name || '',
      label: invite.displayName || null,
    });
  } catch {
    res.status(500).json({ message: GENERIC_ERROR });
  }
};

export const startConnection = async (req: Request, res: Response): Promise<void> => {
  try {
    const invite = await findInvite(req.params.token);
    if (!invite) return void notFound(res);

    const view = inviteView(invite);
    if (view === 'connected') {
      res.json({ status: 'connected' });
      return;
    }
    if (!canStartConnection(view)) {
      res.status(410).json({ status: view });
      return;
    }

    const ensured = await ensureAccount(invite);
    if (ensured.busy) {
      res.status(202).json({ status: 'starting' });
      return;
    }

    const account = ensured.account as IWhatsAppAccount;
    if (account.status === 'connected') {
      await markConnected(invite, account, req.app.get('io'));
      res.json({ status: 'connected' });
      return;
    }

    let qrCode = ensured.qrCode ?? null;
    if (!qrCode && account.instanceId) {
      try {
        qrCode = extractQrCode(await connectInstance(account.instanceId));
      } catch {
        qrCode = null;
      }
    }

    if (!qrCode) {
      // the number may have been paired a moment ago
      const state = account.instanceId ? await getConnectionState(account.instanceId) : null;
      if (mapEvolutionStateToStatus(state) === 'connected') {
        await markConnected(invite, account, req.app.get('io'));
        res.json({ status: 'connected' });
        return;
      }
      res.status(502).json({ message: 'O código ainda não ficou pronto. Tente de novo em instantes.' });
      return;
    }

    res.json({ status: 'waiting', qrCode, refreshAfterSeconds: QR_REFRESH_SECONDS });
  } catch (error: any) {
    console.error('[public-connect] start failed:', error?.message || error);
    res.status(502).json({ message: GENERIC_ERROR });
  }
};

/** Alternative to the QR code for people opening the link on the same phone that runs WhatsApp */
export const requestPairing = async (req: Request, res: Response): Promise<void> => {
  try {
    const invite = await findInvite(req.params.token);
    if (!invite) return void notFound(res);

    const view = inviteView(invite);
    if (view === 'connected') {
      res.json({ status: 'connected' });
      return;
    }
    if (!canStartConnection(view)) {
      res.status(410).json({ status: view });
      return;
    }

    const phone = sanitizePairingPhone(req.body?.phone);
    if (!phone) {
      res.status(400).json({ message: 'Digite o número do WhatsApp com DDD, por exemplo (11) 91234-5678.' });
      return;
    }

    const ensured = await ensureAccount(invite);
    if (ensured.busy) {
      res.status(202).json({ status: 'starting' });
      return;
    }
    const instanceId = ensured.account?.instanceId;
    if (!instanceId) {
      res.status(502).json({ message: GENERIC_ERROR });
      return;
    }

    const pairingCode = await requestPairingCode(instanceId, phone);
    if (!pairingCode) {
      res.status(502).json({
        message: 'Não foi possível gerar o código. Abra este link em um computador e escaneie o QR code.',
      });
      return;
    }

    res.json({ status: 'waiting', pairingCode });
  } catch (error: any) {
    console.error('[public-connect] pairing failed:', error?.message || error);
    res.status(502).json({ message: GENERIC_ERROR });
  }
};

export const getConnectionStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const invite = await findInvite(req.params.token);
    if (!invite) return void notFound(res);

    const io = req.app.get('io');
    const view = inviteView(invite);

    if (view === 'connected') {
      res.json({ status: 'connected' });
      return;
    }
    if (view === 'revoked') {
      res.json({ status: 'revoked' });
      return;
    }

    const account = invite.whatsappAccountId ? await WhatsAppAccount.findById(invite.whatsappAccountId) : null;

    // The webhook may have connected the number even after the link expired: do not tell
    // someone who just scanned the code that the link is no longer valid
    if (account?.status === 'connected') {
      await markConnected(invite, account, io);
      res.json({ status: 'connected' });
      return;
    }

    if (view === 'expired') {
      res.json({ status: 'expired' });
      return;
    }

    if (!account?.instanceId) {
      res.json({ status: 'ready' });
      return;
    }

    const state = await getConnectionState(account.instanceId);
    if (mapEvolutionStateToStatus(state) === 'connected') {
      await markConnected(invite, account, io);
      res.json({ status: 'connected' });
      return;
    }

    res.json({ status: 'waiting' });
  } catch {
    res.status(500).json({ message: GENERIC_ERROR });
  }
};
