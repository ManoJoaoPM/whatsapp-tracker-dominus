import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Copy, ExternalLink, Link2, Trash2 } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';

type InviteStatus = 'ready' | 'in_progress' | 'connected' | 'expired' | 'revoked';

type Invite = {
  id: string;
  displayName: string | null;
  status: InviteStatus;
  path?: string;
  expiresAt: string;
  createdAt: string;
  connectedAt: string | null;
};

const STATUS_LABEL: Record<InviteStatus, string> = {
  ready: 'Aguardando o cliente',
  in_progress: 'Cliente conectando',
  connected: 'Conectado',
  expired: 'Expirado',
  revoked: 'Cancelado',
};

const STATUS_CLASS: Record<InviteStatus, string> = {
  ready: 'bg-amber-50 text-amber-700',
  in_progress: 'bg-blue-50 text-blue-700',
  connected: 'bg-emerald-50 text-emerald-700',
  expired: 'bg-zinc-100 text-zinc-600',
  revoked: 'bg-zinc-100 text-zinc-600',
};

const VALIDITY_OPTIONS = [
  { days: 1, label: '1 dia' },
  { days: 3, label: '3 dias' },
  { days: 7, label: '7 dias' },
  { days: 14, label: '14 dias' },
  { days: 30, label: '30 dias' },
];

const fullUrl = (path: string) => `${window.location.origin}${path}`;

const formatDate = (iso: string) => format(new Date(iso), "dd/MM 'às' HH:mm", { locale: ptBR });

const ConnectionInvitesCard: React.FC<{ onAccountsChanged?: () => void }> = ({ onAccountsChanged }) => {
  const { user, selectedClientId } = useAuthStore();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [days, setDays] = useState(7);
  const [notice, setNotice] = useState<string | null>(null);

  const previousStatuses = useRef<Record<string, InviteStatus>>({});

  const config = useMemo(
    () => ({ headers: { Authorization: `Bearer ${user?.token}`, 'x-client-id': selectedClientId } }),
    [user?.token, selectedClientId],
  );

  const load = useCallback(
    async (silent = false) => {
      if (!user || !selectedClientId) return;
      if (!silent) setLoading(true);
      try {
        const { data } = await axios.get('/api/connection-invites', config);
        const list: Invite[] = Array.isArray(data) ? data : [];

        // a link that just turned into a connected number: refresh the list of numbers too
        const justConnected = list.some(
          (i) => i.status === 'connected' && previousStatuses.current[i.id] && previousStatuses.current[i.id] !== 'connected',
        );
        previousStatuses.current = Object.fromEntries(list.map((i) => [i.id, i.status]));
        if (justConnected) onAccountsChanged?.();

        setInvites(list);
      } catch (e: any) {
        if (!silent) setNotice(e?.response?.data?.message || 'Não foi possível carregar os links.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [user, selectedClientId, config, onAccountsChanged],
  );

  useEffect(() => {
    previousStatuses.current = {};
    void load();
  }, [load]);

  // while someone may be scanning a code, keep the statuses fresh
  useEffect(() => {
    const timer = window.setInterval(() => void load(true), 8000);
    return () => window.clearInterval(timer);
  }, [load]);

  const copy = async (path: string) => {
    const url = fullUrl(path);
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Link copiado. Agora é só enviar ao cliente.');
    } catch {
      window.prompt('Copie o link abaixo:', url);
    }
  };

  const create = async () => {
    setCreating(true);
    setNotice(null);
    try {
      const { data } = await axios.post(
        '/api/connection-invites',
        { displayName: label.trim() || undefined, expiresInDays: days },
        config,
      );
      setLabel('');
      await load(true);
      if (data?.path) await copy(data.path);
    } catch (e: any) {
      setNotice(e?.response?.data?.message || 'Não foi possível gerar o link.');
    } finally {
      setCreating(false);
    }
  };

  const remove = async (invite: Invite) => {
    const usable = invite.status === 'ready' || invite.status === 'in_progress';
    const question = usable
      ? 'Cancelar este link? Quem tentar abri-lo verá que ele foi cancelado.'
      : 'Remover este link da lista? O número conectado não é afetado.';
    if (!window.confirm(question)) return;

    try {
      await axios.delete(`/api/connection-invites/${invite.id}`, config);
      setNotice(usable ? 'Link cancelado.' : 'Link removido da lista.');
      await load(true);
    } catch (e: any) {
      setNotice(e?.response?.data?.message || 'Não foi possível concluir.');
    }
  };

  if (!user || !selectedClientId) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-zinc-100 overflow-hidden">
      <div className="p-6 border-b border-zinc-100">
        <div className="flex items-center gap-2 text-lg font-semibold text-zinc-900">
          <Link2 size={18} className="text-primary" />
          Link de conexão para o cliente
        </div>
        <div className="text-sm text-zinc-500 mt-1">
          Envie o link ao cliente: ele abre, toca em Conectar e segue o passo a passo para ligar o WhatsApp, sem precisar de login.
          Cada link serve para conectar um número e deixa de gerar códigos assim que o número conecta.
        </div>
      </div>

      <div className="p-6 space-y-5">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-zinc-700 mb-2">Nome do número (opcional)</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value.slice(0, 60))}
              placeholder="Ex.: Comercial"
              disabled={creating}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-2">Validade</label>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              disabled={creating}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              {VALIDITY_OPTIONS.map((o) => (
                <option key={o.days} value={o.days}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={create}
            disabled={creating}
            className="px-3 py-2 rounded-lg bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 disabled:opacity-50"
          >
            {creating ? 'Gerando…' : 'Gerar link'}
          </button>
        </div>

        {notice && <div className="text-xs text-zinc-700 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">{notice}</div>}

        {loading ? (
          <div className="text-sm text-zinc-500">Carregando…</div>
        ) : invites.length === 0 ? (
          <div className="text-sm text-zinc-500">Nenhum link gerado ainda.</div>
        ) : (
          <ul className="divide-y divide-zinc-100 border border-zinc-100 rounded-lg">
            {invites.map((invite) => {
              const usable = invite.status === 'ready' || invite.status === 'in_progress';
              return (
                <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-900 truncate">{invite.displayName || 'Sem nome'}</span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_CLASS[invite.status]}`}>
                        {STATUS_LABEL[invite.status]}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {invite.status === 'connected' && invite.connectedAt
                        ? `Conectado em ${formatDate(invite.connectedAt)}`
                        : usable
                          ? `Vale até ${formatDate(invite.expiresAt)}`
                          : `Criado em ${formatDate(invite.createdAt)}`}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {usable && invite.path && (
                      <>
                        <button
                          type="button"
                          onClick={() => void copy(invite.path as string)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-zinc-700 border border-zinc-200 rounded-lg hover:bg-zinc-50"
                        >
                          <Copy size={12} />
                          Copiar link
                        </button>
                        <a
                          href={invite.path}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-zinc-700 border border-zinc-200 rounded-lg hover:bg-zinc-50"
                        >
                          <ExternalLink size={12} />
                          Abrir
                        </a>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => void remove(invite)}
                      title={usable ? 'Cancelar link' : 'Remover da lista'}
                      className="p-1.5 text-zinc-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default ConnectionInvitesCard;
