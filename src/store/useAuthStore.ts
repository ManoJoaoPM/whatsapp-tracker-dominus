import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  _id: string;
  name: string;
  email: string;
  token: string;
  role?: 'admin' | 'user';
}

export interface ClientEntity {
  _id: string;
  name: string;
  createdAt?: string;
  whatsappInstance?: {
    instanceId?: string;
    status?: 'connected' | 'disconnected' | 'pending';
    phoneNumber?: string;
    connectedAt?: string;
  };
}

interface AuthState {
  user: User | null;
  selectedClientId: string | null;
  clients: ClientEntity[];
  setUser: (user: User | null) => void;
  setAuth: (user: User, token: string) => void;
  setSelectedClientId: (id: string | null) => void;
  setClients: (clients: ClientEntity[]) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      selectedClientId: null,
      clients: [],
      setUser: (user) => set({ user }),
      setAuth: (user, token) => set({ user: { ...user, token } }),
      setSelectedClientId: (id) => set({ selectedClientId: id }),
      setClients: (clients) => set({ clients }),
      logout: () => set({ user: null, selectedClientId: null, clients: [] }),
    }),
    {
      name: 'auth-storage',
    }
  )
);