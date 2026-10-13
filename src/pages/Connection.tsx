import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { CheckCircle, Plus, QrCode, RefreshCcw, Smartphone, Trash2, Unplug, List } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import MetaLogsModal from '../components/MetaLogsModal';
import MqlCriteriaCard from '../components/MqlCriteriaCard';
import ConnectionInvitesCard from '../components/ConnectionInvitesCard';

type WhatsAppStatus = 'connected' | 'disconnected' | 'pending';

type WhatsAppAccount = {
  _id: string;
  displayName?: string;
  instanceId: string;
  status: WhatsAppStatus;
  phoneNumber?: string;
  connectedAt?: string;
};

type MetaAdsIntegration = {
  pixelId: string | null;
  hasAccessToken: boolean;
  mqlTriggerLevel?: 'cold' | 'warm' | 'hot';
  updatedAt?: string | null;
};

const statusLabel = (s: WhatsAppStatus) => {
  if (s === 'connected') return 'Conectado';
  if (s === 'pending') return 'Aguardando QR';
  return 'Desconectado';
};

const statusDotClass = (s: WhatsAppStatus) => {
  if (s === 'connected') return 'bg-emerald-500';
  if (s === 'pending') return 'bg-amber-500';
  return 'bg-red-500';
};

const Connection = () => {
  const {
    user,
    selectedClientId,
    selectedWhatsAppAccountId,
    setSelectedWhatsAppAccountId,
  } = useAuthStore();

  const [accounts, setAccounts] = useState<WhatsAppAccount[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [panelLoading, setPanelLoading] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [panelStatus, setPanelStatus] = useState<WhatsAppStatus>('disconnected');
  const [createName, setCreateName] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const [metaLoading, setMetaLoading] = useState(false);
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaPixelId, setMetaPixelId] = useState('');
  const [metaPageId, setMetaPageId] = useState('');
  const [metaAccessToken, setMetaAccessToken] = useState('');
  const [metaHasToken, setMetaHasToken] = useState(false);
  const [metaStatusText, setMetaStatusText] = useState<string | null>(null);
  const [metaTestCode, setMetaTestCode] = useState('');
  const [metaTestStatusText, setMetaTestStatusText] = useState<string | null>(null);
  const [metaTestDebug, setMetaTestDebug] = useState<any>(null);
  const [metaTestEventName, setMetaTestEventName] = useState<'QualifiedLead' | 'LeadSubmitted' | 'Purchase'>('QualifiedLead');
  const [metaTestActionSource, setMetaTestActionSource] = useState<'website' | 'chat' | 'physical_store' | 'business_messaging'>('business_messaging');
  const [metaTestEventSourceUrl, setMetaTestEventSourceUrl] = useState('https://meu-tintim.com.br');
  const [metaTestCtwaClid, setMetaTestCtwaClid] = useState('');
  const [metaTestPhone, setMetaTestPhone] = useState('5511999999999');
  const [metaTriggerLevel, setMetaTriggerLevel] = useState<'cold' | 'warm' | 'hot'>('hot');
  // deleting a WhatsApp number (the confirmation dialog)
  const [deleteTarget, setDeleteTarget] = useState<WhatsAppAccount | null>(null);
  const [deleteConversations, setDeleteConversations] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<{ message: string; canForce: boolean } | null>(null);

  const [metaSendUntracked, setMetaSendUntracked] = useState(false);
  const [metaEvents, setMetaEvents] = useState({
    leadSubmitted: { enabled: false, minInbound: 2 },
    qualifiedLead: { enabled: true },
    purchase: { enabled: false },
  });
  const [metaCurrency, setMetaCurrency] = useState('BRL');
  const [logsModalOpen, setLogsModalOpen] = useState(false);

  const headers = useMemo(() => {
    return {
      headers: {
        Authorization: `Bearer ${user?.token}`,
        'x-client-id': selectedClientId,
      },
    };
  }, [user?.token, selectedClientId]);

  const activeAccount = useMemo(() => {
    if (!selectedWhatsAppAccountId) return null;
    return accounts.find((a) => a._id === selectedWhatsAppAccountId) || null;
  }, [accounts, selectedWhatsAppAccountId]);

  const fetchAccounts = async () => {
    if (!user || !selectedClientId) return;
    setLoadingList(true);
    try {
      const { data } = await axios.get('/api/whatsapp-accounts', headers);
      const list: WhatsAppAccount[] = Array.isArray(data) ? data : [];
      setAccounts(list);
      const stillSelected = selectedWhatsAppAccountId && list.some((a) => a._id === selectedWhatsAppAccountId);
      if (!stillSelected) {
        if (list.length === 1) {
          setSelectedWhatsAppAccountId(list[0]._id);
        } else {
          setSelectedWhatsAppAccountId(null);
        }
      }
    } finally {
      setLoadingList(false);
    }
  };

  const fetchMetaIntegration = async () => {
    if (!user || !selectedClientId) return;
    setMetaLoading(true);
    setMetaStatusText(null);
    try {
      const { data } = await axios.get('/api/integrations/meta', headers);
      const integration: MetaAdsIntegration = data || { pixelId: null, hasAccessToken: false };
      setMetaPixelId(String(integration.pixelId || ''));
      setMetaPageId(String((integration as any).pageId || ''));
      setMetaHasToken(Boolean(integration.hasAccessToken));
      setMetaTriggerLevel((integration.mqlTriggerLevel as any) || 'hot');
      setMetaSendUntracked(Boolean((integration as any).sendUntracked));
      const events = (integration as any).events;
      if (events) {
        setMetaEvents({
          leadSubmitted: {
            enabled: Boolean(events.leadSubmitted?.enabled),
            minInbound: Number(events.leadSubmitted?.minInbound) || 2,
          },
          qualifiedLead: { enabled: events.qualifiedLead?.enabled !== false },
          purchase: { enabled: Boolean(events.purchase?.enabled) },
        });
      }
      setMetaCurrency(String((integration as any).currency || 'BRL'));
    } catch {
      setMetaPixelId('');
      setMetaPageId('');
      setMetaHasToken(false);
      setMetaTriggerLevel('hot');
      setMetaSendUntracked(false);
    } finally {
      setMetaLoading(false);
    }
  };

  const saveMetaIntegration = async () => {
    if (!user || !selectedClientId) return;
    setMetaSaving(true);
    setMetaStatusText(null);
    try {
      const payload: any = {};
      if (metaPixelId.trim()) payload.pixelId = metaPixelId.trim();
      if (metaPageId.trim()) payload.pageId = metaPageId.trim();
      if (metaAccessToken.trim()) payload.accessToken = metaAccessToken.trim();
      payload.mqlTriggerLevel = metaTriggerLevel;
      payload.sendUntracked = metaSendUntracked;
      payload.events = metaEvents;
      payload.currency = metaCurrency.trim().toUpperCase();

      const { data } = await axios.put('/api/integrations/meta', payload, headers);
      if (data?.pixelId) setMetaPixelId(String(data.pixelId || ''));
      if (data?.pageId) setMetaPageId(String(data.pageId || ''));
      setMetaHasToken(Boolean(data?.hasAccessToken));
      if (data?.mqlTriggerLevel) setMetaTriggerLevel(data.mqlTriggerLevel);
      setMetaAccessToken('');
      setMetaStatusText('Salvo.');
    } catch (e: any) {
      const msg = String(e?.response?.data?.message || 'Erro ao salvar');
      setMetaStatusText(msg);
    } finally {
      setMetaSaving(false);
    }
  };

  const clearMetaToken = async () => {
    if (!user || !selectedClientId) return;
    setMetaSaving(true);
    setMetaStatusText(null);
    try {
      const { data } = await axios.put('/api/integrations/meta', { clearAccessToken: true }, headers);
      setMetaHasToken(Boolean(data?.hasAccessToken));
      setMetaStatusText('Token removido.');
    } catch (e: any) {
      const msg = String(e?.response?.data?.message || 'Erro ao remover token');
      setMetaStatusText(msg);
    } finally {
      setMetaSaving(false);
    }
  };

  const sendMetaTestEvent = async () => {
    if (!user || !selectedClientId) return;
    setMetaSaving(true);
    setMetaTestStatusText(null);
    setMetaTestDebug(null);
    try {
      const { data } = await axios.post(
        '/api/integrations/meta/test-event',
        {
          testEventCode: metaTestCode.trim(),
          eventName: metaTestEventName,
          actionSource: metaTestActionSource,
          eventSourceUrl: metaTestEventSourceUrl.trim() || undefined,
          ctwaClid: metaTestCtwaClid.trim() || undefined,
          phone: metaTestPhone.trim() || undefined,
        },
        headers,
      );
      const received = data?.response?.events_received;
      const msg = typeof received === 'number' ? `Enviado. events_received=${received}` : 'Enviado.';
      setMetaTestStatusText(msg);
      setMetaTestDebug(data?.debug || data?.response || null);
    } catch (e: any) {
      const msg = String(e?.response?.data?.message || e?.response?.data?.error || 'Erro ao enviar evento');
      setMetaTestStatusText(msg);
      setMetaTestDebug(e?.response?.data?.debug || e?.response?.data || null);
    } finally {
      setMetaSaving(false);
    }
  };

  const fetchStatus = async (accountId: string) => {
    if (!user || !selectedClientId) return;
    setPanelLoading(true);
    try {
      const { data } = await axios.get(`/api/whatsapp-accounts/${accountId}/status`, {
        ...headers,
        headers: { ...headers.headers, 'Cache-Control': 'no-cache' },
      });
      const status: WhatsAppStatus = data?.status || 'disconnected';
      setPanelStatus(status);
      if (data?.qrCode) setQrCode(data.qrCode);
      setAccounts((prev) => prev.map((a) => (a._id === accountId ? { ...a, status } : a)));
    } catch {
      setPanelStatus('disconnected');
      setQrCode(null);
    } finally {
      setPanelLoading(false);
    }
  };

  const createAccount = async () => {
    if (!user || !selectedClientId) return;
    setPanelLoading(true);
    try {
      const { data } = await axios.post(
        '/api/whatsapp-accounts',
        { displayName: createName.trim() || undefined },
        headers,
      );
      const account: WhatsAppAccount | null = data?.account || null;
      if (account?._id) {
        setAccounts((prev) => [account, ...prev]);
        setSelectedWhatsAppAccountId(account._id);
        setPanelStatus(account.status || 'pending');
        setQrCode(data?.qrCode || null);
        setCreateOpen(false);
        setCreateName('');
      }
    } finally {
      setPanelLoading(false);
    }
  };

  const refreshQr = async () => {
    if (!activeAccount) return;
    setPanelLoading(true);
    try {
      const { data } = await axios.post(`/api/whatsapp-accounts/${activeAccount._id}/refresh-qr`, {}, headers);
      setPanelStatus('pending');
      setQrCode(data?.qrCode || null);
      setAccounts((prev) => prev.map((a) => (a._id === activeAccount._id ? { ...a, status: 'pending' } : a)));
    } finally {
      setPanelLoading(false);
    }
  };

  const disconnect = async () => {
    if (!activeAccount) return;
    setPanelLoading(true);
    try {
      await axios.post(`/api/whatsapp-accounts/${activeAccount._id}/disconnect`, {}, headers);
      setPanelStatus('disconnected');
      setQrCode(null);
      setAccounts((prev) => prev.map((a) => (a._id === activeAccount._id ? { ...a, status: 'disconnected' } : a)));
    } finally {
      setPanelLoading(false);
    }
  };

  const openDelete = (account: WhatsAppAccount) => {
    setDeleteTarget(account);
    setDeleteConversations(false);
    setDeleteError(null);
  };

  const closeDelete = () => {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteError(null);
  };

  const confirmDelete = async (force = false) => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const query = new URLSearchParams();
      if (deleteConversations) query.set('deleteConversations', 'true');
      if (force) query.set('force', 'true');
      const suffix = query.toString() ? `?${query.toString()}` : '';

      await axios.delete(`/api/whatsapp-accounts/${deleteTarget._id}${suffix}`, headers);

      if (selectedWhatsAppAccountId === deleteTarget._id) setSelectedWhatsAppAccountId(null);
      setAccounts((prev) => prev.filter((a) => a._id !== deleteTarget._id));
      setDeleteTarget(null);
      await fetchAccounts();
    } catch (e: any) {
      setDeleteError({
        message: String(e?.response?.data?.message || 'Não foi possível excluir. Tente de novo.'),
        canForce: Boolean(e?.response?.data?.canForce),
      });
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, [user, selectedClientId]);

  useEffect(() => {
    fetchMetaIntegration();
  }, [user, selectedClientId]);

  useEffect(() => {
    if (!activeAccount) {
      setPanelStatus('disconnected');
      setQrCode(null);
      return;
    }
    setPanelStatus(activeAccount.status || 'disconnected');
    setQrCode(null);
    void fetchStatus(activeAccount._id);
  }, [activeAccount?._id]);

  useEffect(() => {
    if (!activeAccount) return;
    if (panelStatus !== 'pending') return;

    const interval = window.setInterval(() => {
      void fetchStatus(activeAccount._id);
    }, 5000);

    return () => window.clearInterval(interval);
  }, [activeAccount?._id, panelStatus]);

  if (!user) return <div className="p-8">Não autenticado</div>;
  if (!selectedClientId) return <div className="p-8 text-zinc-500">Selecione uma empresa no menu lateral.</div>;

  return (
    <div className="p-8 w-full h-full overflow-y-auto bg-[#fafafa]">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-zinc-800">Conexões de WhatsApp</h2>
        <p className="text-zinc-500 mt-1">Adicione vários números para a mesma empresa e gerencie o status de cada um.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-zinc-100 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-zinc-100 flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-800">Números conectados</div>
              <div className="text-xs text-zinc-500">Selecione um para ver QR e status</div>
            </div>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-500 transition-colors"
            >
              <Plus size={16} />
              Adicionar
            </button>
          </div>

          {createOpen && (
            <div className="p-4 border-b border-zinc-100 bg-zinc-50">
              <div className="text-sm font-medium text-zinc-800 mb-2">Novo WhatsApp</div>
              <div className="flex gap-2">
                <input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="Ex.: Comercial 1"
                  className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
                <button
                  type="button"
                  onClick={createAccount}
                  disabled={panelLoading}
                  className="px-3 py-2 rounded-lg bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 disabled:opacity-50"
                >
                  Criar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreateOpen(false);
                    setCreateName('');
                  }}
                  className="px-3 py-2 rounded-lg bg-white border border-zinc-200 text-zinc-700 text-sm font-medium hover:bg-zinc-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {loadingList ? (
              <div className="p-6 text-sm text-zinc-500">Carregando…</div>
            ) : accounts.length === 0 ? (
              <div className="p-6 text-sm text-zinc-500">Nenhum WhatsApp adicionado ainda.</div>
            ) : (
              accounts.map((a) => (
                <button
                  key={a._id}
                  type="button"
                  onClick={() => setSelectedWhatsAppAccountId(a._id)}
                  className={`w-full text-left px-4 py-3 border-b border-zinc-100 hover:bg-zinc-50 transition-colors ${
                    selectedWhatsAppAccountId === a._id ? 'bg-primary/5' : 'bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-900 truncate">
                        {a.displayName || 'WhatsApp'}
                      </div>
                      <div className="text-xs text-zinc-500 truncate">{a.phoneNumber || a.instanceId}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`w-2.5 h-2.5 rounded-full ${statusDotClass(a.status)}`} />
                      <span className="text-xs font-medium text-zinc-600">{statusLabel(a.status)}</span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-zinc-100 overflow-hidden">
            <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-12 h-12 rounded-full bg-zinc-50 flex items-center justify-center border border-zinc-200">
                  <Smartphone className="text-primary" size={22} />
                </div>
                <div className="min-w-0">
                  <div className="text-lg font-semibold text-zinc-900 truncate">
                    {activeAccount ? activeAccount.displayName || 'WhatsApp' : 'Selecione um WhatsApp'}
                  </div>
                  {activeAccount ? (
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`w-2.5 h-2.5 rounded-full ${statusDotClass(panelStatus)}`} />
                      <span className="text-sm text-zinc-600">{statusLabel(panelStatus)}</span>
                    </div>
                  ) : (
                    <div className="text-sm text-zinc-500 mt-1">Escolha na lista ao lado.</div>
                  )}
                </div>
              </div>

              {activeAccount && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={refreshQr}
                    disabled={panelLoading}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-zinc-200 text-zinc-700 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
                  >
                    <RefreshCcw size={16} />
                    Atualizar QR
                  </button>
                  <button
                    type="button"
                    onClick={disconnect}
                    disabled={panelLoading}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-50"
                  >
                    <Unplug size={16} />
                    Desconectar
                  </button>
                  <button
                    type="button"
                    onClick={() => openDelete(activeAccount)}
                    disabled={panelLoading}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                  >
                    <Trash2 size={16} />
                    Excluir
                  </button>
                </div>
              )}
            </div>

            <div className="p-6">
              {!activeAccount ? (
                <div className="text-center py-16 text-zinc-500">
                  <div className="bg-primary/5 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                    <QrCode size={28} className="text-primary" />
                  </div>
                  <div className="font-medium text-zinc-800">Selecione um WhatsApp</div>
                  <div className="text-sm mt-1">Para gerar QR e acompanhar status.</div>
                </div>
              ) : panelStatus === 'connected' ? (
                <div className="text-center py-10">
                  <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle size={32} className="text-emerald-500" />
                  </div>
                  <p className="text-zinc-900 font-medium text-lg mb-2">Conectado com sucesso</p>
                  <p className="text-zinc-500 text-sm max-w-md mx-auto">Novas mensagens e conversas serão sincronizadas automaticamente.</p>
                </div>
              ) : (
                <div className="text-center py-6">
                  <p className="text-zinc-600 mb-6 text-sm">Abra o WhatsApp no seu celular, vá em <strong>Aparelhos Conectados</strong> e escaneie o código abaixo.</p>
                  {qrCode ? (
                    <div className="bg-white p-4 inline-block rounded-xl border border-zinc-200 shadow-sm mb-4">
                      <img src={qrCode} alt="QR Code WhatsApp" className="w-64 h-64" />
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-2 text-sm text-zinc-500 bg-zinc-50 border border-zinc-200 px-4 py-3 rounded-lg">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                      {panelLoading ? 'Carregando QR…' : 'QR indisponível. Tente “Atualizar QR”.'}
                    </div>
                  )}
                  <p className="text-xs text-zinc-400 mt-2">O QR expira em alguns segundos.</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-zinc-100 overflow-hidden">
            <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-lg font-semibold text-zinc-900 truncate flex items-center gap-2">
                  Meta Ads
                  <button 
                    onClick={() => setLogsModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded-md transition-colors"
                  >
                    <List size={14} />
                    Ver Logs
                  </button>
                </div>
                <div className="text-sm text-zinc-500 mt-1">Configuração do Pixel e token de Conversions API para esta empresa.</div>
              </div>
              <div className="text-xs font-medium text-zinc-600">
                {metaLoading ? 'Carregando…' : metaHasToken ? 'Token configurado' : 'Token ausente'}
              </div>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-2">Pixel ID</label>
                  <div className="flex gap-2">
                    <input
                      value={metaPixelId}
                      onChange={(e) => setMetaPixelId(e.target.value)}
                      placeholder="Meta Pixel ID"
                      className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                      disabled={metaLoading || metaSaving}
                    />
                    <input
                      value={metaPageId}
                      onChange={(e) => setMetaPageId(e.target.value)}
                      placeholder="Page ID (Business Messaging)"
                      className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                      disabled={metaLoading || metaSaving}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-2">Token CAPI (Access Token)</label>
                  <input
                    value={metaAccessToken}
                    onChange={(e) => setMetaAccessToken(e.target.value)}
                    placeholder={metaHasToken ? '•••••••••••• (já salvo)' : 'Cole o token aqui'}
                    type="password"
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    disabled={metaLoading || metaSaving}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-2">Disparar conversão quando MQL</label>
                  <select
                    value={metaTriggerLevel}
                    onChange={(e) => setMetaTriggerLevel(e.target.value as any)}
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    disabled={metaLoading || metaSaving}
                  >
                    <option value="cold">Cold</option>
                    <option value="warm">Warm</option>
                    <option value="hot">Hot</option>
                  </select>
                </div>

                <div className="lg:col-span-2">
                  <label className="flex items-start gap-3 text-sm text-zinc-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={metaSendUntracked}
                      onChange={(e) => setMetaSendUntracked(e.target.checked)}
                      disabled={metaLoading || metaSaving}
                      className="mt-0.5 h-4 w-4 rounded border-zinc-300"
                    />
                    <span>
                      Enviar também leads Meta sem <code className="text-xs">ctwa_clid</code>
                      <span className="block text-xs text-zinc-500 mt-0.5">
                        Desligado (recomendado): o Meta não consegue ligar esses eventos a um clique, o que só reduz a qualidade de correspondência.
                      </span>
                    </span>
                  </label>
                </div>

                <div className="lg:col-span-2 border-t border-zinc-100 pt-4">
                  <div className="text-xs font-medium text-zinc-700 mb-1">Eventos enviados ao Meta</div>
                  <p className="text-xs text-zinc-500 mb-3">
                    Cada etapa vira um sinal para o algoritmo. No Gerenciador de Anúncios, otimize para o evento mais próximo da venda que ainda tenha volume
                    (em geral, cerca de 50 eventos por semana por conjunto de anúncios). Com pouco volume, comece por <code className="text-[11px]">LeadSubmitted</code> e suba depois.
                  </p>

                  <div className="space-y-3">
                    <label className="flex items-start gap-3 text-sm text-zinc-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={metaEvents.leadSubmitted.enabled}
                        onChange={(e) => setMetaEvents((p) => ({ ...p, leadSubmitted: { ...p.leadSubmitted, enabled: e.target.checked } }))}
                        disabled={metaLoading || metaSaving}
                        className="mt-0.5 h-4 w-4 rounded border-zinc-300"
                      />
                      <span className="flex-1">
                        <code className="text-xs font-semibold">LeadSubmitted</code> — o lead respondeu
                        <span className="block text-xs text-zinc-500 mt-0.5">Sinal inicial e de maior volume. Não depende da IA.</span>
                      </span>
                      <span className="flex items-center gap-1 text-xs text-zinc-500 shrink-0">
                        após
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={metaEvents.leadSubmitted.minInbound}
                          onChange={(e) =>
                            setMetaEvents((p) => ({
                              ...p,
                              leadSubmitted: { ...p.leadSubmitted, minInbound: Math.max(1, Math.min(20, Number(e.target.value) || 1)) },
                            }))
                          }
                          disabled={metaLoading || metaSaving || !metaEvents.leadSubmitted.enabled}
                          className="w-14 rounded-lg border border-zinc-200 px-2 py-1 text-xs outline-none"
                        />
                        mensagens
                      </span>
                    </label>

                    <label className="flex items-start gap-3 text-sm text-zinc-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={metaEvents.qualifiedLead.enabled}
                        onChange={(e) => setMetaEvents((p) => ({ ...p, qualifiedLead: { enabled: e.target.checked } }))}
                        disabled={metaLoading || metaSaving}
                        className="mt-0.5 h-4 w-4 rounded border-zinc-300"
                      />
                      <span>
                        <code className="text-xs font-semibold">QualifiedLead</code> — a IA qualificou o lead
                        <span className="block text-xs text-zinc-500 mt-0.5">Usa o nível escolhido acima e só sai depois da confirmação da IA.</span>
                      </span>
                    </label>

                    <label className="flex items-start gap-3 text-sm text-zinc-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={metaEvents.purchase.enabled}
                        onChange={(e) => setMetaEvents((p) => ({ ...p, purchase: { enabled: e.target.checked } }))}
                        disabled={metaLoading || metaSaving}
                        className="mt-0.5 h-4 w-4 rounded border-zinc-300"
                      />
                      <span className="flex-1">
                        <code className="text-xs font-semibold">Purchase</code> — venda concluída, com valor
                        <span className="block text-xs text-zinc-500 mt-0.5">
                          Só sai quando uma pessoa move o lead para "Venda concluída" e informa o valor. É o que permite otimizar por retorno sobre o investimento.
                        </span>
                      </span>
                      <span className="flex items-center gap-1 text-xs text-zinc-500 shrink-0">
                        moeda
                        <input
                          value={metaCurrency}
                          onChange={(e) => setMetaCurrency(e.target.value.toUpperCase().slice(0, 3))}
                          disabled={metaLoading || metaSaving || !metaEvents.purchase.enabled}
                          className="w-14 rounded-lg border border-zinc-200 px-2 py-1 text-xs uppercase outline-none"
                        />
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between mt-4 gap-3">
                <div className="text-xs text-zinc-500 min-h-[16px]">{metaStatusText || ''}</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={clearMetaToken}
                    disabled={metaLoading || metaSaving || !metaHasToken}
                    className="px-3 py-2 rounded-lg bg-white border border-zinc-200 text-zinc-700 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
                  >
                    Remover token
                  </button>
                  <button
                    type="button"
                    onClick={saveMetaIntegration}
                    disabled={metaLoading || metaSaving}
                    className="px-3 py-2 rounded-lg bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 disabled:opacity-50"
                  >
                    Salvar
                  </button>
                </div>
              </div>

              <div className="mt-6 pt-6 border-t border-zinc-100">
                <div className="text-sm font-semibold text-zinc-900">Teste de evento</div>
                <div className="text-xs text-zinc-500 mt-1">Use o Test Event Code do Events Manager para validar no painel.</div>

                <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-3 mt-3">
                  <select
                    value={metaTestEventName}
                    onChange={(e) => setMetaTestEventName(e.target.value as any)}
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    disabled={metaLoading || metaSaving}
                  >
                    <option value="QualifiedLead">QualifiedLead</option>
                    <option value="LeadSubmitted">LeadSubmitted</option>
                    <option value="Purchase">Purchase</option>
                  </select>
                  <input
                    value={metaTestCode}
                    onChange={(e) => setMetaTestCode(e.target.value)}
                    placeholder="Test Event Code"
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    disabled={metaLoading || metaSaving}
                  />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr_auto] gap-3 mt-3">
                  <select
                    value={metaTestActionSource}
                    onChange={(e) => setMetaTestActionSource(e.target.value as any)}
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    disabled={metaLoading || metaSaving}
                  >
                    <option value="business_messaging">business_messaging (CTWA)</option>
                    <option value="website">website</option>
                    <option value="chat">chat</option>
                    <option value="physical_store">physical_store</option>
                  </select>
                  
                  {metaTestActionSource === 'website' ? (
                    <input
                      value={metaTestEventSourceUrl}
                      onChange={(e) => setMetaTestEventSourceUrl(e.target.value)}
                      placeholder="Event Source URL (opcional)"
                      className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                      disabled={metaLoading || metaSaving}
                    />
                  ) : metaTestActionSource === 'business_messaging' ? (
                    <div className="flex flex-col gap-1 w-full">
                      <div className="flex gap-2">
                        <div className="flex gap-1 flex-1">
                          <input
                            value={metaTestCtwaClid}
                            onChange={(e) => setMetaTestCtwaClid(e.target.value)}
                            placeholder="ctwa_clid (opcional)"
                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                            disabled={metaLoading || metaSaving}
                          />
                          <button
                            type="button"
                            onClick={() => setMetaTestCtwaClid('0000000000000000000000000000000000000000000000000000000000000000')}
                            className="px-2 py-2 text-xs text-primary hover:bg-primary/10 rounded-lg border border-primary font-medium shrink-0"
                            title="Gerar mock padrão da Meta"
                          >
                            Mock
                          </button>
                        </div>
                        <input
                          value={metaTestPhone}
                          onChange={(e) => setMetaTestPhone(e.target.value)}
                          placeholder="Tel (Ex: 5511999999999)"
                          className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                          disabled={metaLoading || metaSaving}
                        />
                      </div>
                      <p className="text-[10px] text-zinc-500 leading-tight">
                        Deve ter no mínimo 64 caracteres. Use "Mock" se não tiver um real.
                      </p>
                    </div>
                  ) : (
                    <div className="w-full" />
                  )}

                  <button
                    type="button"
                    onClick={sendMetaTestEvent}
                    disabled={metaLoading || metaSaving || !metaHasToken || !metaPixelId.trim() || !metaTestCode.trim()}
                    className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-500 disabled:opacity-50"
                  >
                    Enviar teste
                  </button>
                </div>

                <div className="text-xs text-zinc-500 min-h-[16px] mt-2">{metaTestStatusText || ''}</div>

                {metaTestDebug && (
                  <pre className="mt-3 text-xs text-zinc-700 bg-zinc-50 border border-zinc-200 rounded-lg p-3 overflow-x-auto">
                    {JSON.stringify(metaTestDebug, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-6">
        <ConnectionInvitesCard onAccountsChanged={fetchAccounts} />
      </div>

      <div className="mt-6">
        <MqlCriteriaCard />
      </div>
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeDelete}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-whatsapp-title"
            className="w-full max-w-md rounded-xl bg-white shadow-lg border border-zinc-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-zinc-200">
              <h4 id="delete-whatsapp-title" className="font-semibold text-zinc-900">
                Excluir {deleteTarget.displayName ? `"${deleteTarget.displayName}"` : 'este WhatsApp'}?
              </h4>
              <p className="text-xs text-zinc-500 mt-0.5 truncate">{deleteTarget.phoneNumber || deleteTarget.instanceId}</p>
            </div>

            <div className="p-5 space-y-4 text-sm text-zinc-700">
              <p>
                A conexão será removida e o aparelho deixa de ficar vinculado ao sistema. Para voltar a usar este número,
                será preciso conectar de novo.
              </p>
              <p className="text-zinc-600">
                As conversas e os leads deste número <strong>continuam no sistema</strong> (Dashboard, Kanban e histórico).
              </p>

              <label className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteConversations}
                  onChange={(e) => setDeleteConversations(e.target.checked)}
                  disabled={deleting}
                  className="mt-0.5 h-4 w-4 rounded border-zinc-300"
                />
                <span>
                  Apagar também as conversas e mensagens deste número
                  <span className="block text-xs text-red-600 mt-0.5">
                    Não dá para desfazer. Os leads somem do Dashboard e do Kanban. O registro dos eventos já enviados ao Meta é mantido.
                  </span>
                </span>
              </label>

              {deleteError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700" role="alert">
                  {deleteError.message}
                </div>
              )}
            </div>

            <div className="p-5 border-t border-zinc-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeDelete}
                disabled={deleting}
                className="px-3 py-2 rounded-lg bg-white border border-zinc-200 text-zinc-700 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              {deleteError?.canForce && (
                <button
                  type="button"
                  onClick={() => void confirmDelete(true)}
                  disabled={deleting}
                  className="px-3 py-2 rounded-lg bg-white border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-50"
                >
                  Excluir mesmo assim
                </button>
              )}
              <button
                type="button"
                onClick={() => void confirmDelete(false)}
                disabled={deleting}
                className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Excluindo…' : deleteConversations ? 'Excluir tudo' : 'Excluir WhatsApp'}
              </button>
            </div>
          </div>
        </div>
      )}
      <MetaLogsModal isOpen={logsModalOpen} onClose={() => setLogsModalOpen(false)} />
    </div>
  );
};

export default Connection;
