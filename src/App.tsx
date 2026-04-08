import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import React, { useEffect } from "react";
import axios from "axios";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Dashboard from "@/pages/Dashboard";
import Conversations from "@/pages/Conversations";
import Connection from "@/pages/Connection";
import Admin from "@/pages/Admin";
import Kanban from "@/pages/Kanban";
import { useAuthStore } from "@/store/useAuthStore";
import { LayoutDashboard, MessageSquare, Briefcase, Settings, LogOut, KanbanSquare } from "lucide-react";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/dashboard" element={<DashboardLayout><Dashboard /></DashboardLayout>} />
        <Route path="/conversations" element={<DashboardLayout><Conversations /></DashboardLayout>} />
        <Route path="/app/kanban" element={<DashboardLayout><Kanban /></DashboardLayout>} />
        <Route path="/connection" element={<DashboardLayout><Connection /></DashboardLayout>} />
        <Route path="/admin" element={<DashboardLayout><Admin /></DashboardLayout>} />
      </Routes>
    </Router>
  );
}

// Simple layout wrapper for Dashboard pages
function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, clients, setClients, selectedClientId, setSelectedClientId, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (user) {
      axios.get('/api/clients', {
        headers: { Authorization: `Bearer ${user.token}` }
      }).then(res => {
        setClients(res.data);
        if (res.data.length > 0 && !selectedClientId) {
          setSelectedClientId(res.data[0]._id);
        }
      }).catch(err => console.error(err));
    }
  }, [user]);

  if (!user) {
    return <Navigate to="/login" />;
  }

  const isActive = (path: string) => location.pathname === path;
  const navItemClass = (path: string) => 
    `flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
      isActive(path) 
        ? 'text-primary border-r-2 border-primary bg-primary/5' 
        : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50'
    }`;

  return (
    <div className="flex h-screen bg-[#fafafa] font-sans">
      <aside className="w-64 bg-white border-r border-zinc-100 flex flex-col justify-between shrink-0">
        <div>
          <div className="p-6 pb-2">
            <img src="/logo-institucional.png" alt="Astro Dominus" className="h-8 object-contain" />
          </div>
          
          <div className="px-6 py-4">
            <div className="text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wider">Cliente Selecionado</div>
            <select 
              className="w-full bg-zinc-50 border border-zinc-200 text-zinc-800 text-sm rounded-md focus:ring-primary focus:border-primary block p-2 outline-none"
              value={selectedClientId || ''}
              onChange={(e) => setSelectedClientId(e.target.value)}
            >
              <option value="" disabled>Selecione um cliente</option>
              {clients.map(c => (
                <option key={c._id} value={c._id}>{c.name}</option>
              ))}
            </select>
          </div>

          <nav className="mt-2 flex flex-col gap-1">
            <a href="/dashboard" className={navItemClass('/dashboard')}>
              <LayoutDashboard size={18} />
              Dashboard
            </a>
            <a href="/conversations" className={navItemClass('/conversations')}>
              <MessageSquare size={18} />
              Leads
            </a>
            <a href="/app/kanban" className={navItemClass('/app/kanban')}>
              <KanbanSquare size={18} />
              Kanban
            </a>
            <a href="/connection" className={navItemClass('/connection')}>
              <Settings size={18} />
              Conexão WhatsApp
            </a>
            <a href="/admin" className={navItemClass('/admin')}>
              <Briefcase size={18} />
              Gerenciar Clientes
            </a>
          </nav>
        </div>

        <div className="p-4 border-t border-zinc-100">
          <div className="flex items-center justify-between px-2 py-2">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-md bg-zinc-100 flex items-center justify-center text-zinc-600 font-medium border border-zinc-200 uppercase">
                {user.name?.charAt(0) || 'U'}
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-zinc-800 leading-none">{user.name || 'Usuário'}</span>
                <span className="text-[10px] text-zinc-500 mt-1 truncate max-w-[120px]">{user.email}</span>
              </div>
            </div>
            <button 
              onClick={() => { logout(); navigate('/login'); }}
              className="text-zinc-400 hover:text-red-500 transition-colors"
              title="Sair"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main className="flex-1 flex flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
