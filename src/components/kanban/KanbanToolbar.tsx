import React from 'react'
import { CalendarRange, KanbanSquare, RotateCcw, Search } from 'lucide-react'
import type { LeadOrigin } from './types'

export function KanbanToolbar({
  origin,
  setOrigin,
  from,
  setFrom,
  to,
  setTo,
  qInput,
  setQInput,
  onClear,
  onRefresh,
  error,
}: {
  origin: '' | LeadOrigin
  setOrigin: (value: '' | LeadOrigin) => void
  from: string
  setFrom: (value: string) => void
  to: string
  setTo: (value: string) => void
  qInput: string
  setQInput: (value: string) => void
  onClear: () => void
  onRefresh: () => void
  error: string | null
}) {
  return (
    <header className="px-8 pt-8">
      <div className="flex items-start justify-between gap-4 border-b border-zinc-200 pb-5">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 shadow-sm">
              <KanbanSquare size={18} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-zinc-800">Leads — Kanban</h2>
              <p className="mt-1 text-sm text-zinc-500">Arraste os leads entre etapas para atualizar o funil.</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50"
          >
            <RotateCcw size={16} />
            Atualizar
          </button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-12">
        <div className="md:col-span-3">
          <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Origem</label>
          <select
            value={origin}
            onChange={(e) => setOrigin(e.target.value as any)}
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
          >
            <option value="">Todas</option>
            <option value="meta_ads">Meta Ads</option>
            <option value="google_ads">Google Ads</option>
            <option value="organic">Orgânico</option>
            <option value="unknown">Desconhecido</option>
          </select>
        </div>

        <div className="md:col-span-3">
          <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">
            Período (última mensagem)
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <CalendarRange size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full rounded-md border border-zinc-200 bg-white pl-9 pr-3 py-2 text-sm text-zinc-800 shadow-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
              />
            </div>
            <div className="relative">
              <CalendarRange size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full rounded-md border border-zinc-200 bg-white pl-9 pr-3 py-2 text-sm text-zinc-800 shadow-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
              />
            </div>
          </div>
        </div>

        <div className="md:col-span-4">
          <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Busca</label>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Buscar por nome, telefone ou termo..."
              className="w-full rounded-md border border-zinc-200 bg-white pl-10 pr-3 py-2 text-sm text-zinc-800 shadow-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </div>
        </div>

        <div className="md:col-span-2 flex items-end gap-2">
          <button
            type="button"
            onClick={onClear}
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50"
          >
            Limpar
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button
            type="button"
            className="ml-3 underline"
            onClick={onRefresh}
          >
            Tentar novamente
          </button>
        </div>
      )}
    </header>
  )
}

