import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useAuthStore } from '../store/useAuthStore';
import { Smartphone, QrCode, CheckCircle } from 'lucide-react';

const Connection = () => {
  const { user, selectedClientId } = useAuthStore();
  const [status, setStatus] = useState<'connected' | 'disconnected' | 'pending' | 'checking' | 'loading' | 'error'>('checking');
  const [loading, setLoading] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);

  const getHeaders = () => ({
    headers: { 
      Authorization: `Bearer ${user?.token}`,
      'x-client-id': selectedClientId
    }
  });

  const fetchStatus = async () => {
    if (!user || !selectedClientId) return;
    try {
      const { data } = await axios.get('/api/whatsapp/status', getHeaders());
      setStatus(data.status);
      if (data.qrCode) {
        setQrCode(data.qrCode);
      }
    } catch (error: any) {
      if (error.response?.status === 404) {
        setStatus('disconnected');
      } else {
        setStatus('error');
      }
    }
  };

  useEffect(() => {
    if (!user || !selectedClientId) return;
    fetchStatus();
    
    // Poll status every 5 seconds if pending
    const interval = setInterval(() => {
      if (status === 'pending') {
        fetchStatus();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [user, selectedClientId, status]);

  const connectWhatsApp = async () => {
    setStatus('loading');
    try {
      const { data } = await axios.post('/api/whatsapp/connect', {}, getHeaders());
      setStatus(data.status);
      setQrCode(data.qrCode);
    } catch (error) {
      console.error(error);
      setStatus('error');
    }
  };

  const disconnectWhatsApp = async () => {
    setStatus('loading');
    try {
      await axios.post('/api/whatsapp/disconnect', {}, getHeaders());
      setStatus('disconnected');
      setQrCode(null);
    } catch (error) {
      console.error(error);
      setStatus('error');
    }
  };

  if (!user) return <div className="p-8">Não autenticado</div>;
  if (!selectedClientId) return <div className="p-8 text-zinc-500">Selecione um cliente no menu lateral.</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto w-full h-full overflow-y-auto bg-[#fafafa]">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-zinc-800">Conexão WhatsApp</h2>
        <p className="text-zinc-500 mt-1">Conecte o número de WhatsApp do cliente para enviar e receber mensagens.</p>
      </div>
      <div className="bg-white p-8 rounded-xl shadow-sm border border-zinc-100 max-w-2xl">
        <div className="mb-6 flex items-center gap-4 p-4 rounded-lg bg-zinc-50 border border-zinc-100">
          <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shadow-sm">
            <Smartphone className="text-primary" size={24} />
          </div>
          <div>
            <h3 className="font-semibold text-zinc-800 text-lg">Status atual</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className={`w-2.5 h-2.5 rounded-full ${
                status === 'connected' ? 'bg-emerald-500' : 
                status === 'pending' ? 'bg-amber-500' : 
                'bg-red-500'
              }`}></span>
              <span className="text-sm font-medium text-zinc-600">
                {status === 'connected' ? 'Conectado' : 
                 status === 'pending' ? 'Aguardando Leitura do QR Code' : 
                 'Desconectado'}
              </span>
            </div>
          </div>
        </div>

        {status === 'disconnected' && (
          <div className="text-center py-8">
            <div className="bg-primary/5 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <QrCode size={32} className="text-primary" />
            </div>
            <p className="text-zinc-600 mb-6 max-w-md mx-auto">Para começar a gerenciar seus leads, clique no botão abaixo para gerar um QR Code e conectar seu WhatsApp.</p>
            <button 
              onClick={connectWhatsApp}
              disabled={loading}
              className="bg-primary hover:bg-primary-500 text-white px-6 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {loading ? 'Gerando...' : 'Gerar QR Code'}
            </button>
          </div>
        )}

        {status === 'pending' && qrCode && (
          <div className="text-center py-6">
            <p className="text-zinc-600 mb-6 text-sm">Abra o WhatsApp no seu celular, vá em <strong>Aparelhos Conectados</strong> e escaneie o código abaixo:</p>
            <div className="bg-white p-4 inline-block rounded-xl border border-zinc-200 shadow-sm mb-4">
              <img src={qrCode} alt="QR Code WhatsApp" className="w-64 h-64" />
            </div>
            <p className="text-xs text-zinc-400">O código expira em alguns segundos.</p>
          </div>
        )}

        {status === 'connected' && (
          <div className="text-center py-8">
            <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
              <CheckCircle size={32} className="text-emerald-500" />
            </div>
            <p className="text-zinc-800 font-medium text-lg mb-2">WhatsApp Conectado com sucesso!</p>
            <p className="text-zinc-500 mb-8 max-w-md mx-auto">Suas conversas e leads já estão sendo sincronizados com a plataforma.</p>
            <button 
              onClick={disconnectWhatsApp}
              disabled={loading}
              className="bg-white border border-red-200 text-red-600 hover:bg-red-50 px-6 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Desconectando...' : 'Desconectar WhatsApp'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Connection;