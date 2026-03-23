import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuthStore } from '../store/useAuthStore';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await axios.post('/api/auth/login', { email, password });
      setAuth(response.data.user, response.data.token);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erro ao fazer login');
    }
  };

  return (
    <div className="flex min-h-screen bg-[#fafafa]">
      <div className="flex w-full max-w-md flex-col justify-center px-8 py-12 mx-auto">
        <div className="text-center mb-10">
          <img src="/logo-institucional.png" alt="Astro Dominus" className="h-12 mx-auto mb-6 object-contain" />
          <h2 className="text-2xl font-bold text-zinc-900 tracking-tight">Entrar na sua conta</h2>
          <p className="mt-2 text-sm text-zinc-500">
            Acesse o painel operacional da sua agência.
          </p>
        </div>

        <div className="bg-white p-8 rounded-2xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] border border-zinc-100">
          <form className="space-y-6" onSubmit={handleSubmit}>
            {error && (
              <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600 border border-red-100">
                {error}
              </div>
            )}
            
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                E-mail
              </label>
              <input
                type="email"
                required
                className="block w-full rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-zinc-900 placeholder-zinc-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                Senha
              </label>
              <input
                type="password"
                required
                className="block w-full rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-zinc-900 placeholder-zinc-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              className="flex w-full justify-center rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary-500 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-colors shadow-sm"
            >
              Entrar
            </button>
          </form>

          <p className="mt-8 text-center text-sm text-zinc-500">
            Não tem uma conta?{' '}
            <Link to="/register" className="font-semibold text-primary hover:text-primary-600 transition-colors">
              Cadastre-se
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;