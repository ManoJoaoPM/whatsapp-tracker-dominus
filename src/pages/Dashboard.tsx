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
  mql: {
    avgScore: number | null;
    scoredLeads: number;
  };
  topLeads: Array<{
    _id: string;
    contactName?: string;
    contactPhone: string;
    origin: 'meta_ads' | 'google_ads' | 'organic' | 'unknown';
    funnelStage: 'first_contact' | 'replied' | 'qualified' | 'proposal' | 'scheduled' | 'closed' | 'lost';
    mqlScore?: number;
    mqlLevel?: 'cold' | 'warm' | 'hot';
    lastMessageAt: string;
  }>;
}

const Dashboard = () => {
  const { user, selectedClientId } = useAuthStore();
  const [data, setData] = useState<AnalyticsData | null>(null);

  const getOriginLabel = (origin: AnalyticsData['topLeads'][number]['origin']) => {
    if (origin === 'meta_ads') return 'Meta Ads';
    if (origin === 'google_ads') return 'Google Ads';
    if (origin === 'organic') return 'Orgânico';
    return 'Desconhecido';
  };

  const getStageLabel = (stage: AnalyticsData['topLeads'][number]['funnelStage']) => {
    if (stage === 'first_contact') return 'Primeiro contato';
    if (stage === 'replied') return 'Respondeu';
    if (stage === 'qualified') return 'Qualificado';
    if (stage === 'proposal') return 'Proposta';
    if (stage === 'scheduled') return 'Agendamento';
    if (stage === 'closed') return 'Venda';
    return 'Perdido';
  };

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

            <div className="rounded-xl bg-white p-6 shadow-sm border border-zinc-100 flex flex-col justify-center">
              <h3 className="text-sm font-medium text-zinc-500 uppercase tracking-wider mb-2">MQL médio</h3>
              <p className="text-4xl font-bold text-primary">
                {data.mql.avgScore === null ? '—' : data.mql.avgScore}
              </p>
              <p className="text-xs text-zinc-500 mt-2">
                Base: {data.mql.scoredLeads} lead{data.mql.scoredLeads === 1 ? '' : 's'} com MQL
              </p>
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

          <div className="rounded-xl bg-white p-6 shadow-sm border border-zinc-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-zinc-800">Leads mais qualificados</h3>
              <span className="text-xs text-zinc-500">Ordenado por MQL</span>
            </div>

            {data.topLeads.length === 0 ? (
              <div className="text-sm text-zinc-500">Ainda não há leads para ranquear.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-zinc-500 border-b border-zinc-200">
                      <th className="py-2 pr-4 font-medium">Lead</th>
                      <th className="py-2 pr-4 font-medium">Telefone</th>
                      <th className="py-2 pr-4 font-medium">Origem</th>
                      <th className="py-2 pr-4 font-medium">Etapa</th>
                      <th className="py-2 pr-4 font-medium">MQL</th>
                      <th className="py-2 pr-0 font-medium">Última mensagem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topLeads.map((lead) => (
                      <tr key={lead._id} className="border-b border-zinc-100 last:border-b-0">
                        <td className="py-3 pr-4 text-zinc-800 font-medium whitespace-nowrap">
                          {lead.contactName?.trim() ? lead.contactName : 'Sem nome'}
                        </td>
                        <td className="py-3 pr-4 text-zinc-600 whitespace-nowrap">{lead.contactPhone}</td>
                        <td className="py-3 pr-4 text-zinc-600 whitespace-nowrap">{getOriginLabel(lead.origin)}</td>
                        <td className="py-3 pr-4 text-zinc-600 whitespace-nowrap">{getStageLabel(lead.funnelStage)}</td>
                        <td className="py-3 pr-4 whitespace-nowrap">
                          {typeof lead.mqlScore === 'number' ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="font-semibold text-zinc-800">{lead.mqlScore}</span>
                              {lead.mqlLevel ? (
                                <span className="text-xs text-zinc-500 uppercase">{lead.mqlLevel}</span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="text-zinc-400">—</span>
                          )}
                        </td>
                        <td className="py-3 pr-0 text-zinc-600 whitespace-nowrap">
                          {lead.lastMessageAt ? new Date(lead.lastMessageAt).toLocaleString('pt-BR') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
