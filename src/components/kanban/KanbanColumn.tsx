import React from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { ConversationCard, FunnelStage } from './types'
import { FUNNEL_STAGE_LABEL } from './constants'
import { LeadCard } from './LeadCard'

export function KanbanColumn({
  stage,
  count,
  cards,
  isLoading,
  onOpenConversation,
}: {
  stage: FunnelStage
  count: number
  cards: ConversationCard[]
  isLoading: boolean
  onOpenConversation: (conversationId: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })

  return (
    <section className="w-[320px] shrink-0" data-kanban-stage={stage}>
      <header
        className={
          'sticky top-0 z-10 rounded-xl border bg-white px-4 py-3 shadow-sm ' +
          (isOver ? 'border-primary ring-2 ring-primary/20' : 'border-zinc-100')
        }
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-zinc-900">{FUNNEL_STAGE_LABEL[stage]}</div>
          </div>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700">
            {count}
          </span>
        </div>
      </header>

      <div
        ref={setNodeRef}
        className={
          'mt-3 rounded-xl border bg-zinc-50 p-3 h-[calc(100vh-220px)] overflow-y-auto space-y-3 ' +
          (isOver ? 'border-primary/30' : 'border-zinc-100')
        }
      >
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 rounded-lg bg-white border border-zinc-100 animate-pulse" />
            ))}
          </div>
        ) : cards.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-200 bg-white p-4 text-center">
            <div className="text-xs font-medium text-zinc-600">Sem leads nesta etapa</div>
            <div className="mt-1 text-[11px] text-zinc-500">Arraste um card aqui para atualizar.</div>
          </div>
        ) : (
          cards.map((card) => <LeadCard key={card.id} card={card} onOpenConversation={onOpenConversation} />)
        )}
      </div>
    </section>
  )
}
