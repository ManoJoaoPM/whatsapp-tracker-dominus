import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Search, Filter, MessageSquare, Send, Check, CheckCheck } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';

interface Conversation {
  _id: string;
  contactPhone: string;
  contactName: string;
  origin: string;
  funnelStage: string;
  lastMessageAt: string;
  lastMessageContent?: string;
  lastInboundMessageAt?: string;
  lastOutboundMessageAt?: string;
  unreadCount: number;
  mqlScore?: number;
  mqlLevel?: 'cold' | 'warm' | 'hot';
  mqlSummary?: string;
  mqlSignals?: string[];
  mqlUpdatedAt?: string;
}

interface Message {
  _id: string;
  direction: 'inbound' | 'outbound';
  content: string;
  mediaType: 'text' | 'image' | 'audio' | 'document' | 'null';
  mediaUrl?: string;
  timestamp: string;
}

const STAGES = {
  first_contact: 'Primeiro contato',
  replied: 'Respondeu',
  qualified: 'Qualificado',
  proposal: 'Proposta enviada',
  scheduled: 'Agendamento',
  closed: 'Venda concluída',
  lost: 'Perdido'
};

const getAlertFlag = (conv: Conversation) => {
  if (conv.funnelStage === 'closed' || conv.funnelStage === 'lost') return null;

  const now = new Date();
  const lastInbound = conv.lastInboundMessageAt ? new Date(conv.lastInboundMessageAt) : null;
  const lastOutbound = conv.lastOutboundMessageAt ? new Date(conv.lastOutboundMessageAt) : null;

  // "Necessário Responder": company hasn't responded in > 1 day
  if (lastInbound) {
    const isLeadLast = !lastOutbound || lastInbound > lastOutbound;
    if (isLeadLast) {
      const diffDays = (now.getTime() - lastInbound.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > 1) {
        return { type: 'needs_reply', label: 'Necessário Responder', color: 'bg-red-100 text-red-700 border-red-300' };
      }
    }
  }

  // "Necessário Follow Up": company sent a message > 3 days ago, and lead hasn't responded
  if (lastOutbound) {
    const isCompanyLast = !lastInbound || lastOutbound > lastInbound;
    if (isCompanyLast) {
      const diffDays = (now.getTime() - lastOutbound.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > 3) {
        return { type: 'needs_followup', label: 'Necessário Follow Up', color: 'bg-amber-100 text-amber-700 border-amber-300' };
      }
    }
  }

  return null;
};

const Conversations = () => {
  const { user, selectedClientId } = useAuthStore();
  const location = useLocation();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [socketJoined, setSocketJoined] = useState(false);
  const [socketRoom, setSocketRoom] = useState<string | null>(null);
  const [socketEventsCount, setSocketEventsCount] = useState(0);
  const [lastSocketEventAt, setLastSocketEventAt] = useState<string | null>(null);
  const [mqlLoading, setMqlLoading] = useState(false);
  const [mqlDetailsOpen, setMqlDetailsOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Filters
  const [filterOrigin, setFilterOrigin] = useState('');
  const [filterStage, setFilterStage] = useState('');

  const requestedConversationId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('conversationId') || '';
  }, [location.search]);

  const openedRequestedRef = useRef<string>('');

  const getHeaders = () => ({
    headers: { 
      Authorization: `Bearer ${user?.token}`,
      'x-client-id': selectedClientId
    }
  });

  useEffect(() => {
    if (!user || !selectedClientId) return;

    const fetchConversations = async () => {
      try {
        let url = '/api/conversations';
        const params = new URLSearchParams();
        if (filterOrigin) params.append('origin', filterOrigin);
        if (filterStage) params.append('stage', filterStage);
        params.append('_t', String(Date.now()));
        if (params.toString()) url += `?${params.toString()}`;

        const { data } = await axios.get(url, {
          headers: { 
            Authorization: `Bearer ${user.token}`, 
            'x-client-id': selectedClientId,
            'Cache-Control': 'no-cache' 
          }
        });
        setConversations(data);
      } catch (error) {
        console.error('Error fetching conversations', error);
      }
    };

    fetchConversations();
  }, [user, selectedClientId, filterOrigin, filterStage]);

  useEffect(() => {
    if (!requestedConversationId) return;
    if (!user || !selectedClientId) return;
    if (openedRequestedRef.current === requestedConversationId) return;

    const fromList = conversations.find((c) => c._id === requestedConversationId);
    if (fromList) {
      setActiveConv(fromList);
      openedRequestedRef.current = requestedConversationId;
      return;
    }

    const run = async () => {
      try {
        const { data } = await axios.get(`/api/conversations/${requestedConversationId}?_t=${Date.now()}`, {
          headers: {
            Authorization: `Bearer ${user.token}`,
            'x-client-id': selectedClientId,
            'Cache-Control': 'no-cache',
          },
        });
        if (data?._id) {
          setConversations((prev) => {
            const exists = prev.some((c) => c._id === data._id);
            if (exists) return prev;
            return [data, ...prev];
          });
          setActiveConv(data);
          openedRequestedRef.current = requestedConversationId;
        }
      } catch {
      }
    };

    run();
  }, [requestedConversationId, conversations, user, selectedClientId]);

  useEffect(() => {
    if (!user || !selectedClientId) return;

    const intervalId = window.setInterval(async () => {
      try {
        let url = '/api/conversations';
        const params = new URLSearchParams();
        if (filterOrigin) params.append('origin', filterOrigin);
        if (filterStage) params.append('stage', filterStage);
        params.append('_t', String(Date.now()));
        if (params.toString()) url += `?${params.toString()}`;

        const { data } = await axios.get(url, {
          headers: { 
            Authorization: `Bearer ${user.token}`, 
            'x-client-id': selectedClientId,
            'Cache-Control': 'no-cache' 
          }
        });
        setConversations(data);
      } catch {
      }
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [user, selectedClientId, filterOrigin, filterStage]);

  useEffect(() => {
    if (!user || !selectedClientId) return;
    
    // Setup Socket.io
    const socketUrl = import.meta.env.DEV
      ? (import.meta.env.VITE_SOCKET_URL || `${window.location.protocol}//${window.location.hostname}:3001`)
      : undefined;
    const newSocket = socketUrl ? io(socketUrl) : io();
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setSocketConnected(true);
      setSocketJoined(false);
      console.log('[socket] connected', {
        socketId: newSocket.id,
        clientId: selectedClientId,
        socketUrl: socketUrl || 'same-origin',
      });

      newSocket.emit('join', selectedClientId, (ack: any) => {
        if (ack?.ok) {
          setSocketJoined(true);
          setSocketRoom(String(ack.room));
          console.log('[socket] joined', ack);
        } else {
          setSocketJoined(false);
          console.error('[socket] join_failed', ack);
        }
      });
    });

    newSocket.on('connect_error', (err) => {
      setSocketConnected(false);
      setSocketJoined(false);
      console.error('[socket] connect_error', err);
    });

    newSocket.on('disconnect', (reason) => {
      setSocketConnected(false);
      setSocketJoined(false);
      console.log('[socket] disconnected', reason);
    });

    newSocket.on('new_message', (data: { conversation: Conversation, message: Message }) => {
      console.log('[socket] new_message received:', {
        conversationId: data?.conversation?._id,
        messageId: data?.message?._id,
        mediaType: data?.message?.mediaType,
        hasMediaUrl: !!data?.message?.mediaUrl
      });
      setSocketEventsCount((v) => v + 1);
      setLastSocketEventAt(new Date().toISOString());
      setConversations(prev => {
        const idx = prev.findIndex(c => c._id === data.conversation._id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = data.conversation;
          // Sort to top
          return updated.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
        }
        return [data.conversation, ...prev];
      });

      setActiveConv(currentActive => {
        if (currentActive && currentActive._id === data.conversation._id) {
          setMessages(prevMsgs => [...prevMsgs, data.message]);
          // If we are looking at it, it's read, but we let backend handle or reset on next click
        }
        return currentActive;
      });
    });

    newSocket.on('mql_updated', (data: { conversation: Conversation }) => {
      setSocketEventsCount((v) => v + 1);
      setLastSocketEventAt(new Date().toISOString());
      setConversations(prev => {
        const idx = prev.findIndex(c => c._id === data.conversation._id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], ...data.conversation };
          return updated;
        }
        return prev;
      });
      setActiveConv(current => {
        if (current && current._id === data.conversation._id) return { ...current, ...data.conversation };
        return current;
      });
    });

    return () => {
      newSocket.disconnect();
    };
  }, [user, selectedClientId]);

  const handleScoreMql = async () => {
    if (!activeConv) return;
    setMqlLoading(true);
    try {
      const { data } = await axios.post(`/api/mql/conversations/${activeConv._id}/score`, {}, getHeaders());
      const updatedConversation: Conversation | undefined = data?.conversation;
      if (updatedConversation) {
        setActiveConv(updatedConversation);
        setMqlDetailsOpen(true);
        setConversations(prev => {
          const idx = prev.findIndex(c => c._id === updatedConversation._id);
          if (idx < 0) return prev;
          const next = [...prev];
          next[idx] = { ...next[idx], ...updatedConversation };
          return next;
        });
      }
    } catch (error: any) {
      console.error('Error scoring MQL', error);
      const apiMessage = error?.response?.data?.message;
      const apiDetails = error?.response?.data?.details;
      const status = error?.response?.status;
      if (apiMessage) {
        const extra = apiDetails ? `\n\nDetalhes: ${String(apiDetails).slice(0, 500)}` : '';
        alert(`Falha ao calcular MQL (${status || 'erro'}): ${apiMessage}${extra}`);
      } else {
        alert('Não foi possível calcular o MQL. Verifique se o servidor (API) está online e com a IA configurada.');
      }
    } finally {
      setMqlLoading(false);
    }
  };

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const lastMessagesSignatureRef = useRef('');
  const lastScrolledConvIdRef = useRef<string | null>(null);

  const getMessagesSignature = (msgs: Message[]) => {
    if (!Array.isArray(msgs) || msgs.length === 0) return '0|empty';
    const first = msgs[0];
    const last = msgs[msgs.length - 1];
    return `${msgs.length}|${String(first?._id)}|${String(last?._id)}|${String(last?.timestamp)}`;
  };

  const applyMessagesIfChanged = (next: unknown) => {
    const nextMessages: Message[] = Array.isArray(next) ? next : [];
    const sig = getMessagesSignature(nextMessages);
    if (sig === lastMessagesSignatureRef.current) return;
    lastMessagesSignatureRef.current = sig;
    setMessages(nextMessages);
  };

  const handleMessagesScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 120;
  };

  useEffect(() => {
    shouldAutoScrollRef.current = true;
  }, [activeConv?._id]);

  useEffect(() => {
    if (activeConv && user && selectedClientId) {
      const fetchMessages = async () => {
        try {
          const { data } = await axios.get(`/api/conversations/${activeConv._id}/messages?_t=${Date.now()}`, {
            headers: {
              Authorization: `Bearer ${user.token}`,
              'x-client-id': selectedClientId,
              'Cache-Control': 'no-cache'
            }
          });
          applyMessagesIfChanged(data);

          // Clear unread count locally
          setConversations(prev => prev.map(c => c._id === activeConv._id ? { ...c, unreadCount: 0 } : c));
        } catch (error) {
          console.error('Error fetching messages', error);
        }
      };
      fetchMessages();
    }
  }, [activeConv, user, selectedClientId]);

  useEffect(() => {
    if (!activeConv || !user || !selectedClientId) return;

    const intervalId = window.setInterval(async () => {
      try {
        const { data } = await axios.get(`/api/conversations/${activeConv._id}/messages?_t=${Date.now()}`,
          { 
            headers: { 
              Authorization: `Bearer ${user.token}`, 
              'x-client-id': selectedClientId,
              'Cache-Control': 'no-cache' 
            } 
          }
        );
        applyMessagesIfChanged(data);
      } catch {
      }
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [activeConv?._id, user, selectedClientId]);

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    const behavior: ScrollBehavior = lastScrolledConvIdRef.current === (activeConv?._id ?? null) ? 'smooth' : 'auto';
    lastScrolledConvIdRef.current = activeConv?._id ?? null;
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, [messages, activeConv?._id]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !activeConv) return;

    try {
      const { data } = await axios.post(`/api/conversations/${activeConv._id}/messages`, 
        { text: newMessage },
        getHeaders()
      );
      shouldAutoScrollRef.current = true;
      setMessages(prev => [...prev, data]);
      setNewMessage('');
      
      // Update local lastMessageAt
      setConversations(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(c => c._id === activeConv._id);
        if (idx >= 0) {
          updated[idx].lastMessageAt = new Date().toISOString();
          updated.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
        }
        return updated;
      });
    } catch (error) {
      console.error('Error sending message', error);
      alert('Erro ao enviar mensagem. O WhatsApp está conectado?');
    }
  };

  const handleStageChange = async (stage: string) => {
    if (!activeConv) return;
    try {
      await axios.put(`/api/conversations/${activeConv._id}/stage`, 
        { stage },
        getHeaders()
      );
      setActiveConv({ ...activeConv, funnelStage: stage });
      setConversations(prev => prev.map(c => c._id === activeConv._id ? { ...c, funnelStage: stage } : c));
    } catch (error) {
      console.error('Error updating stage', error);
    }
  };

  return (
    <div className="flex h-screen bg-[#fafafa] overflow-hidden">
      {mqlDetailsOpen && activeConv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setMqlDetailsOpen(false)}>
          <div className="w-full max-w-lg rounded-xl bg-white shadow-lg border border-zinc-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-zinc-200">
              <div className="min-w-0">
                <h4 className="font-semibold text-zinc-900 truncate">Análise de MQL</h4>
                <p className="text-xs text-zinc-500 truncate">
                  {activeConv.contactName || activeConv.contactPhone}
                </p>
              </div>
              <button
                type="button"
                className="text-sm px-2 py-1 rounded border border-zinc-200 text-zinc-700 hover:bg-zinc-50"
                onClick={() => setMqlDetailsOpen(false)}
              >
                Fechar
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-600">Pontuação</span>
                <span className="font-semibold text-zinc-900">
                  {typeof activeConv.mqlScore === 'number' ? `${activeConv.mqlScore}/100` : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-600">Nível</span>
                <span className="text-sm font-medium text-zinc-900 uppercase">{activeConv.mqlLevel || '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-600">Atualizado em</span>
                <span className="text-sm text-zinc-900">
                  {activeConv.mqlUpdatedAt ? format(new Date(activeConv.mqlUpdatedAt), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '—'}
                </span>
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-800 mb-1">Motivo</p>
                <p className="text-sm text-zinc-700 whitespace-pre-wrap">
                  {activeConv.mqlSummary || 'Sem resumo disponível.'}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-800 mb-1">Sinais identificados</p>
                {Array.isArray(activeConv.mqlSignals) && activeConv.mqlSignals.length > 0 ? (
                  <ul className="text-sm text-zinc-700 list-disc pl-5 space-y-1">
                    {activeConv.mqlSignals.map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-zinc-500">Nenhum sinal listado.</p>
                )}
              </div>
            </div>
            <div className="p-4 border-t border-zinc-200 flex justify-end">
              <button
                type="button"
                onClick={handleScoreMql}
                disabled={mqlLoading}
                className="text-sm px-3 py-2 rounded bg-primary text-white hover:bg-primary-500 disabled:opacity-50"
              >
                {mqlLoading ? 'Recalculando…' : 'Recalcular'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Sidebar */}
      <aside className="w-80 bg-white border-r border-zinc-200 flex flex-col shrink-0">
        <div className="p-4 border-b border-zinc-200 flex items-center justify-between">
          <h2 className="text-lg font-bold text-zinc-800">Leads</h2>
          <div className="flex flex-col items-end gap-1">
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${socketConnected ? 'bg-emerald-50 text-emerald-600' : 'bg-zinc-100 text-zinc-500'}`}>
              {socketConnected ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
        <div className="p-3 border-b border-zinc-200 bg-white flex flex-col gap-2">
          <select 
            value={filterOrigin} 
            onChange={(e) => setFilterOrigin(e.target.value)}
            className="text-sm border border-zinc-200 bg-zinc-50 rounded-md p-2 w-full focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          >
            <option value="">Todas as origens</option>
            <option value="meta_ads">Meta Ads</option>
            <option value="google_ads">Google Ads</option>
            <option value="organic">Orgânico</option>
            <option value="unknown">Desconhecido</option>
          </select>
          <select 
            value={filterStage} 
            onChange={(e) => setFilterStage(e.target.value)}
            className="text-sm border border-zinc-200 bg-zinc-50 rounded-md p-2 w-full focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          >
            <option value="">Todas as etapas</option>
            {Object.entries(STAGES).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.map(conv => {
            const alert = getAlertFlag(conv);
            return (
            <div 
              key={conv._id} 
              onClick={() => setActiveConv(conv)}
              className={`p-4 border-b border-zinc-100 cursor-pointer transition ${activeConv?._id === conv._id ? 'bg-primary/5 border-l-4 border-l-primary' : 'hover:bg-zinc-50 border-l-4 border-l-transparent'}`}
            >
              <div className="flex justify-between items-start mb-1">
                <div className="flex items-center gap-2 overflow-hidden">
                  <span className="font-medium text-zinc-900 truncate">
                    {conv.contactName || conv.contactPhone}
                  </span>
                  {typeof conv.mqlScore === 'number' && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap ${
                        conv.mqlLevel === 'hot'
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : conv.mqlLevel === 'cold'
                            ? 'bg-sky-50 text-sky-700 border-sky-200'
                            : 'bg-zinc-50 text-zinc-700 border-zinc-200'
                      }`}
                      title={conv.mqlSummary || ''}
                    >
                      {conv.mqlLevel === 'hot' ? '🔥' : conv.mqlLevel === 'cold' ? '❄️' : ''} {conv.mqlScore}
                    </span>
                  )}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap
                    ${conv.funnelStage === 'first_contact' ? 'bg-primary/10 text-primary border-primary/20' : 
                      conv.funnelStage === 'replied' ? 'bg-indigo-50 text-indigo-600 border-indigo-200' :
                      conv.funnelStage === 'closed' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                      conv.funnelStage === 'lost' ? 'bg-red-50 text-red-600 border-red-200' :
                      'bg-zinc-50 text-zinc-600 border-zinc-200'
                    }`}
                  >
                    {STAGES[conv.funnelStage as keyof typeof STAGES]}
                  </span>
                </div>
                <span className="text-xs text-zinc-500 whitespace-nowrap ml-2">
                  {format(new Date(conv.lastMessageAt), 'HH:mm')}
                </span>
              </div>
              {alert && (
                <div className="mb-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border inline-block ${alert.color}`}>
                    {alert.label}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center text-sm">
                <span className="text-zinc-500 truncate mr-2">
                  {conv.lastMessageContent || '...'}
                </span>
                {conv.unreadCount > 0 && (
                  <span className="bg-primary text-white text-xs px-2 py-0.5 rounded-full shrink-0">{conv.unreadCount}</span>
                )}
              </div>
            </div>
          )})}
          {conversations.length === 0 && (
            <div className="p-8 text-center text-zinc-500">Nenhuma conversa encontrada.</div>
          )}
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col bg-[#efeae2]">
        {activeConv ? (
          <>
            {/* Chat Header */}
            <header className="p-4 bg-zinc-50 border-b border-zinc-200 flex justify-between items-center">
              <div>
                <h3 className="font-semibold text-zinc-800">{activeConv.contactName || activeConv.contactPhone}</h3>
                <p className="text-xs text-zinc-500">{activeConv.contactPhone}</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-600">Origem:</span>
                  <span className="text-xs px-2 py-1 bg-zinc-200 rounded text-zinc-800 uppercase">
                    {activeConv.origin.replace('_', ' ')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-600">MQL:</span>
                  <span
                    title={activeConv.mqlSummary || ''}
                    onClick={() => setMqlDetailsOpen(true)}
                    className={`text-xs px-2 py-1 rounded border ${
                      activeConv.mqlLevel === 'hot'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : activeConv.mqlLevel === 'warm'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-zinc-100 text-zinc-700 border-zinc-200'
                    } ${typeof activeConv.mqlScore === 'number' ? 'cursor-pointer' : ''}`}
                  >
                    {typeof activeConv.mqlScore === 'number' ? `${activeConv.mqlScore}/100` : '—'}
                  </span>
                  <button
                    type="button"
                    onClick={handleScoreMql}
                    disabled={mqlLoading}
                    className="text-xs px-2 py-1 rounded bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    {mqlLoading ? 'Calculando…' : 'Atualizar'}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-600">Etapa:</span>
                  <select 
                    value={activeConv.funnelStage}
                    onChange={(e) => handleStageChange(e.target.value)}
                    className="text-sm border border-zinc-200 bg-white rounded-md p-1.5 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm"
                  >
                    {Object.entries(STAGES).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </header>

            {/* Messages */}
            <div ref={messagesContainerRef} onScroll={handleMessagesScroll} className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map(msg => (
                <div key={msg._id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] rounded-2xl p-3 shadow-sm ${msg.direction === 'outbound' ? 'bg-primary/10 text-zinc-900 rounded-tr-sm' : 'bg-white text-zinc-900 rounded-tl-sm border border-zinc-100'}`}>
                    {msg.mediaType === 'audio' && msg.mediaUrl ? (
                      <div className="mb-2">
                        <audio controls className="max-w-full h-10">
                          <source src={msg.mediaUrl} type="audio/ogg" />
                          <source src={msg.mediaUrl} type="audio/mp3" />
                          <source src={msg.mediaUrl} type="audio/mpeg" />
                          Seu navegador não suporta o elemento de áudio.
                        </audio>
                      </div>
                    ) : msg.mediaType === 'image' && msg.mediaUrl ? (
                      <div className="mb-2">
                        <img src={msg.mediaUrl} alt="Imagem recebida" className="max-w-xs max-h-64 object-cover rounded cursor-pointer hover:opacity-90 transition" onClick={() => window.open(msg.mediaUrl, '_blank')} />
                        {msg.content !== 'Imagem' && <p className="text-sm mt-1">{msg.content}</p>}
                      </div>
                    ) : (
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    )}
                    <span className="text-[10px] text-zinc-500 block text-right mt-1">
                      {(() => {
                        const d = new Date(msg.timestamp);
                        if (Number.isNaN(d.getTime())) return '';
                        return format(d, 'dd/MM/yyyy HH:mm', { locale: ptBR });
                      })()}
                    </span>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-white border-t border-zinc-200">
              <form onSubmit={handleSendMessage} className="flex gap-2 max-w-4xl mx-auto">
                <input 
                  type="text" 
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Digite uma mensagem..."
                  className="flex-1 rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary focus:bg-white transition-colors"
                />
                <button 
                  type="submit"
                  disabled={!newMessage.trim()}
                  className="bg-primary hover:bg-primary-500 text-white rounded-full p-2.5 w-10 h-10 flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                  <Send size={18} className="ml-1" />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 bg-zinc-50/50">
            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
              <MessageSquare size={24} className="text-zinc-300" />
            </div>
            <p className="font-medium text-zinc-500">Selecione uma conversa para começar</p>
          </div>
        )}
      </main>
    </div>
  );
};

export default Conversations;
