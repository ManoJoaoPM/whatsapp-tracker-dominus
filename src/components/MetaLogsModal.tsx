import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { X, RefreshCcw } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';

interface MetaLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MetaLogsModal: React.FC<MetaLogsModalProps> = ({ isOpen, onClose }) => {
  const { user, selectedClientId } = useAuthStore();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = async () => {
    if (!user || !selectedClientId) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.get('/api/integrations/meta/logs', {
        headers: {
          Authorization: `Bearer ${user.token}`,
          'x-client-id': selectedClientId,
        },
      });
      setLogs(data);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Erro ao carregar logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchLogs();
    }
  }, [isOpen, user, selectedClientId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-zinc-100">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Logs de Leads (Meta Ads)</h2>
            <p className="text-sm text-zinc-500">Visualização de todos os payloads crus que chegaram via Meta.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchLogs}
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

        <div className="p-4 flex-1 overflow-auto bg-zinc-50">
          {loading ? (
            <div className="text-center py-10 text-zinc-500 text-sm">Carregando logs...</div>
          ) : error ? (
            <div className="text-center py-10 text-red-500 text-sm">{error}</div>
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