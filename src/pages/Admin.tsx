import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import axios from 'axios';
import { useAuthStore, ClientEntity } from '../store/useAuthStore';

const Admin = () => {
  const { user, clients, setClients } = useAuthStore();
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '' });

  const fetchClients = async () => {
    try {
      const { data } = await axios.get('/api/clients', {
        headers: { Authorization: `Bearer ${user?.token}` }
      });
      setClients(data);
    } catch (err: any) {
      setError('Erro ao carregar clientes');
    }
  };

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await axios.post('/api/clients', formData, {
        headers: { Authorization: `Bearer ${user?.token}` }
      });
      setShowForm(false);
      setFormData({ name: '' });
      fetchClients();
    } catch (err: any) {
      alert('Erro ao criar cliente: ' + (err.response?.data?.message || err.message));
    }
  };

  if (!user) {
    return <Navigate to="/login" />;
  }

  return (
    <div className="p-8 max-w-4xl mx-auto w-full h-full overflow-y-auto bg-[#fafafa]">
      <div className="flex justify-between items-center mb-8 pb-4 border-b border-zinc-200">
        <div>
          <h2 className="text-2xl font-bold text-zinc-800">Gerenciar Clientes</h2>
          <p className="text-zinc-500 mt-1">Crie e gerencie os clientes da sua agência.</p>
        </div>
        <button 
          onClick={() => setShowForm(!showForm)}
          className="bg-[#ff6600] hover:bg-[#e55c00] text-white px-4 py-2.5 rounded-lg font-medium transition-colors shadow-sm"
        >
          {showForm ? 'Cancelar' : 'Novo Cliente'}
        </button>
      </div>

      {error && <div className="mb-4 text-red-600">{error}</div>}

      {showForm && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-zinc-100 mb-8">
          <h3 className="text-lg font-semibold text-zinc-800 mb-4">Adicionar Cliente</h3>
          <form onSubmit={handleCreateClient} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Nome do Cliente / Empresa</label>
              <input 
                type="text" 
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                required
                className="w-full border border-zinc-200 bg-zinc-50 rounded-lg p-2.5 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                placeholder="Ex: Imobiliária XYZ"
              />
            </div>
            <button 
              type="submit"
              className="bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-2.5 rounded-lg font-medium transition-colors shadow-sm"
            >
              Salvar Cliente
            </button>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-zinc-100 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-zinc-50/80 border-b border-zinc-100">
              <th className="p-4 font-semibold text-zinc-600 text-sm">Nome do Cliente</th>
              <th className="p-4 font-semibold text-zinc-600 text-sm">Status WhatsApp</th>
              <th className="p-4 font-semibold text-zinc-600 text-sm">Criado em</th>
            </tr>
          </thead>
          <tbody>
            {clients.map(client => (
              <tr key={client._id} className="border-b border-zinc-50 hover:bg-zinc-50/50 transition-colors">
                <td className="p-4 font-medium text-zinc-800">{client.name}</td>
                <td className="p-4">
                  <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                    client.whatsappInstance?.status === 'connected' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                    client.whatsappInstance?.status === 'pending' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                    'bg-red-50 text-red-700 border border-red-200'
                  }`}>
                    {client.whatsappInstance?.status || 'disconnected'}
                  </span>
                </td>
                <td className="p-4 text-zinc-500 text-sm">
                  {client.createdAt ? new Date(client.createdAt).toLocaleDateString('pt-BR') : '-'}
                </td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr>
                <td colSpan={3} className="p-8 text-center text-zinc-500">Nenhum cliente cadastrado.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Admin;