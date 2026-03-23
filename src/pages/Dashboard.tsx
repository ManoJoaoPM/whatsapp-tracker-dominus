import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import axios from 'axios';
import { useAuthStore } from '../store/useAuthStore';

interface AnalyticsData {
  totalLeads: number;
  byOrigin: {
    meta_ads: number;
    google_ads: number;
    organic: number;
    unknown: number;
  };
  byStage: {
    first_contact: number;
    replied: number;
    qualified: number;
    proposal: number;
    scheduled: number;
    closed: number;
    lost: number;
  };
}

const Dashboard = () => {
  const { user, selectedClientId } = useAuthStore();
  const [data, setData] = useState<AnalyticsData | null>(null);

  useEffect(() => {
    if (user && selectedClientId) {
      axios.get('/api/analytics', {
        headers: { 
          Authorization: `Bearer ${user.token}`,
          'x-client-id': selectedClientId
        }
      }).then(res => setData(res.data))
        .catch(err => console.error(err));
    }
  }, [user, selectedClientId]);

  if (!user) {
    return <Navigate to="/login" />;
  }

  return (
    <div className="p-8 h-full overflow-y-auto bg-[#fafafa]">
      <header className="flex items-center justify-between mb-8 pb-4 border-b border-zinc-200">
        <div>
          <h2 className="text-2xl font-bold text-zinc-800">Dashboard</h2>
          <p className="text-sm text-zinc-500 mt-1">Visão geral operacional do cliente.</p>
        </div>
      </header>
      
      {data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
            <div className="rounded-xl bg-white p-6 shadow-sm border border-zinc-100 flex flex-col justify-center">
              <h3 className="text-sm font-medium text-zinc-500 uppercase tracking-wider mb-2">Total de Leads</h3>
              <p className="text-4xl font-bold text-primary">{data.totalLeads}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Por Origem */}
            <div className="rounded-xl bg-white p-6 shadow-sm border border-zinc-100">
              <h3 className="text-lg font-semibold text-zinc-800 mb-6">Leads por Origem</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center p-3 bg-zinc-50 rounded-lg">
                  <span className="text-zinc-700 font-medium">Meta Ads</span>
                  <span className="font-bold text-primary text-lg">{data.byOrigin.meta_ads}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-zinc-50 rounded-lg">
                  <span className="text-zinc-700 font-medium">Google Ads</span>
                  <span className="font-bold text-primary text-lg">{data.byOrigin.google_ads}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-zinc-50 rounded-lg">
                  <span className="text-zinc-700 font-medium">Orgânico</span>
                  <span className="font-bold text-primary text-lg">{data.byOrigin.organic}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-zinc-50 rounded-lg">
                  <span className="text-zinc-700 font-medium">Desconhecido</span>
                  <span className="font-bold text-primary text-lg">{data.byOrigin.unknown}</span>
                </div>
              </div>
            </div>

            {/* Por Etapa */}
            <div className="rounded-xl bg-white p-6 shadow-sm border border-zinc-100">
              <h3 className="text-lg font-semibold text-zinc-800 mb-6">Funil de Vendas</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center p-2 hover:bg-zinc-50 rounded transition-colors">
                  <span className="text-zinc-600">Primeiro contato</span>
                  <span className="font-semibold text-zinc-800">{data.byStage.first_contact}</span>
                </div>
                <div className="flex justify-between items-center p-2 hover:bg-zinc-50 rounded transition-colors">
                  <span className="text-zinc-600">Respondeu</span>
                  <span className="font-semibold text-zinc-800">{data.byStage.replied}</span>
                </div>
                <div className="flex justify-between items-center p-2 hover:bg-zinc-50 rounded transition-colors">
                  <span className="text-zinc-600">Qualificado</span>
                  <span className="font-semibold text-zinc-800">{data.byStage.qualified}</span>
                </div>
                <div className="flex justify-between items-center p-2 hover:bg-zinc-50 rounded transition-colors">
                  <span className="text-zinc-600">Proposta enviada</span>
                  <span className="font-semibold text-zinc-800">{data.byStage.proposal}</span>
                </div>
                <div className="flex justify-between items-center p-2 hover:bg-zinc-50 rounded transition-colors">
                  <span className="text-zinc-600">Agendamento</span>
                  <span className="font-semibold text-zinc-800">{data.byStage.scheduled}</span>
                </div>
                <div className="flex justify-between items-center p-2 bg-emerald-50 rounded">
                  <span className="text-emerald-700 font-medium">Venda concluída</span>
                  <span className="font-bold text-emerald-600">{data.byStage.closed}</span>
                </div>
                <div className="flex justify-between items-center p-2 bg-red-50 rounded">
                  <span className="text-red-700 font-medium">Perdido</span>
                  <span className="font-bold text-red-600">{data.byStage.lost}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-64 text-zinc-400">
          Carregando métricas...
        </div>
      )}
    </div>
  );
}

export default Dashboard;