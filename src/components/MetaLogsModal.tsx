import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { X, RefreshCcw, Send } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';

interface MetaLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type EventStatus = 'pending' | 'sending' | 'sent' | 'failed';

type MetaEvent = {
  _id: string;
  conversationId: string;
  eventName: string;
  eventId: string;
  status: EventStatus;
  attempts: number;
  manualRetries?: number;
  nextAttemptAt?: string;
  sentAt?: string;
  lastError?: string;
  lastHttpStatus?: number;
  eventsReceived?: number;
  event?: any;
  requestBody?: any;
  responseBody?: any;
  createdAt: string;
};

const STATUS_LABEL: Record<EventStatus, string> = {
  pending: 'Na fila',
  sending: 'Enviando',
  sent: 'Enviado',
  failed: 'Falhou',
};

const STATUS_CLASS: Record<EventStatus, string> = {
  pending: 'bg-amber-50 text-amber-700',
  sending: 'bg-blue-50 text-blue-700',
  sent: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-red-50 text-red-700',
};

const RETRY_ERRORS: Record<string, string> = {
  event_too_old: 'O evento tem mais de 7 dias e o Meta não aceita mais.',
  not_failed: 'Só eventos com falha podem ser reenviados.',
  not_found: 'Evento não encontrado.',
};

const MetaLogsModal: React.FC<MetaLogsModalProps> = ({ isOpen, onClose }) => {
  const { user, selectedClientId } = useAuthStore();
  const [tab, setTab] = useState<'events' | 'leads'>('events');
  const [logs, setLogs] = useState<any[]>([]);
  const [events, setEvents] = useState<MetaEvent[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<'' | EventStatus>('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestConfig = useCallback(
    () => ({
      headers: {
        Authorization: `Bearer ${user?.token}`,
        'x-client-id': selectedClientId,
      },
    }),
    [user?.token, selectedClientId],
  );

  const fetchData = useCallback(async () => {
    if (!user || !selectedClientId) return;
    setLoading(true);
    setError(null);
    try {
      if (tab === 'events') {
        const params = statusFilter ? `?status=${statusFilter}` : '';
        const { data } = await axios.get(`/api/integrations/meta/events${params}`, requestConfig());
        setEvents(Array.isArray(data?.events) ? data.events : []);
        setCounts(data?.counts || {});
      } else {
        const { data } = await axios.get('/api/integrations/meta/logs', requestConfig());
        setLogs(Array.isArray(data) ? data : []);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Erro ao carregar logs');
    } finally {
      setLoading(false);
    }
  }, [user, selectedClientId, tab, statusFilter, requestConfig]);

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen, fetchData]);

  const retry = async (id: string) => {
    setRetryingId(id);
    setNotice(null);
    try {
      await axios.post(`/api/integrations/meta/events/${id}/retry`, {}, requestConfig());
      setNotice('Reenvio iniciado.');
      // the attempt runs in the background; give it a moment before refreshing
      window.setTimeout(fetchData, 1500);
    } catch (err: any) {
      const reason = err.response?.data?.reason as string | undefined;
      setNotice((reason && RETRY_ERRORS[reason]) || err.response?.data?.message || 'Não foi possível reenviar.');
    } finally {
      setRetryingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-zinc-100">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Logs (Meta Ads)</h2>
            <p className="text-sm text-zinc-500">
              {tab === 'events'
                ? 'Eventos enviados à Conversions API, com tentativas e erros.'
                : 'Payloads crus de leads que chegaram via Meta.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchData}
              disabled={loading}
              className="p-2 text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 rounded-lg disabled:opacity-50 transition-colors"
              title="Atualizar"
            >
              <RefreshCcw size={18} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 rounded-lg transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="px-4 pt-3 flex items-center justify-between gap-3 border-b border-zinc-100">
          <div className="flex gap-1">
            {(['events', 'leads'] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  setNotice(null);
                }}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === t ? 'border-primary text-primary' : 'border-transparent text-zinc-500 hover:text-zinc-800'
                }`}
              >
                {t === 'events' ? 'Eventos enviados' : 'Leads capturados'}
              </button>
            ))}
          </div>

          {tab === 'events' && (
            <div className="flex items-center gap-2 pb-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as '' | EventStatus)}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs outline-none"
              >
                <option value="">Todos</option>
                {(Object.keys(STATUS_LABEL) as EventStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]} ({counts[s] ?? 0})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="p-4 flex-1 overflow-auto bg-zinc-50">
          {notice && (
            <div className="mb-3 text-xs text-zinc-700 bg-white border border-zinc-200 rounded-lg px-3 py-2">{notice}</div>
          )}

          {loading ? (
            <div className="text-center py-10 text-zinc-500 text-sm">Carregando logs...</div>
          ) : error ? (
            <div className="text-center py-10 text-red-500 text-sm">{error}</div>
          ) : tab === 'events' ? (
            events.length === 0 ? (
              <div className="text-center py-10 text-zinc-500 text-sm">Nenhum evento encontrado.</div>
            ) : (
              <div className="space-y-3">
                {events.map((ev) => (
                  <div key={ev._id} className="bg-white border border-zinc-200 rounded-lg overflow-hidden shadow-sm">
                    <div className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-zinc-800">{ev.eventName}</span>
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_CLASS[ev.status]}`}>
                            {STATUS_LABEL[ev.status]}
                          </span>
                        </div>
                        <div className="text-xs text-zinc-500 mt-1">
                          {new Date(ev.createdAt).toLocaleString('pt-BR')} · {ev.attempts} tentativa{ev.attempts === 1 ? '' : 's'}
                          {ev.status === 'pending' && ev.nextAttemptAt && ev.attempts > 0
                            ? ` · próxima em ${new Date(ev.nextAttemptAt).toLocaleString('pt-BR')}`
                            : ''}
                          {ev.status === 'sent' && ev.sentAt ? ` · enviado em ${new Date(ev.sentAt).toLocaleString('pt-BR')}` : ''}
                        </div>
                        {ev.lastError && ev.status !== 'sent' && (
                          <div className="text-xs text-red-600 mt-1 break-words">{ev.lastError}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setExpanded(expanded === ev._id ? null : ev._id)}
                          className="px-2 py-1 text-xs text-zinc-600 border border-zinc-200 rounded-lg hover:bg-zinc-50"
                        >
                          {expanded === ev._id ? 'Ocultar' : 'Detalhes'}
                        </button>
                        {ev.status === 'failed' && (
                          <button
                            onClick={() => retry(ev._id)}
                            disabled={retryingId === ev._id}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 disabled:opacity-50"
                          >
                            <Send size={12} />
                            Reenviar
                          </button>
                        )}
                      </div>
                    </div>
                    {expanded === ev._id && (
                      <div className="border-t border-zinc-100 bg-zinc-50 p-4 overflow-x-auto">
                        <pre className="text-xs text-zinc-800 font-mono">
                          {JSON.stringify(
                            { enviado: ev.requestBody ?? ev.event, resposta: ev.responseBody, httpStatus: ev.lastHttpStatus },
                            null,
                            2,
                          )}
                        </pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : logs.length === 0 ? (
            <div className="text-center py-10 text-zinc-500 text-sm">Nenhum log encontrado.</div>
          ) : (
            <div className="space-y-4">
              {logs.map((log) => (
                <div key={log._id} className="bg-white border border-zinc-200 rounded-lg overflow-hidden shadow-sm">
                  <div className="bg-zinc-100 px-4 py-2 border-b border-zinc-200 flex items-center justify-between">
                    <span className="text-sm font-medium text-zinc-700">Telefone: {log.contactPhone}</span>
                    <span className="text-xs text-zinc-500">{new Date(log.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="p-4 overflow-x-auto">
                    <pre className="text-xs text-zinc-800 font-mono">
                      {JSON.stringify(log.rawPayload, null, 2)}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MetaLogsModal;
