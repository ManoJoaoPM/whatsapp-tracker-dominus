import React from 'react'
import { useDraggable } from '@dnd-kit/core'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { GripVertical } from 'lucide-react'
import type { ConversationCard } from './types'
import { ORIGIN_LABEL } from './constants'

function originBadgeClass(origin: ConversationCard['origin']) {
  if (origin === 'meta_ads') return 'bg-blue-50 text-blue-700 border-blue-200'
  if (origin === 'google_ads') return 'bg-amber-50 text-amber-700 border-amber-200'
  if (origin === 'organic') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  return 'bg-zinc-50 text-zinc-600 border-zinc-200'
}

export function LeadCard({
  card,
  onOpenConversation,
}: {
  card: ConversationCard
  onOpenConversation: (conversationId: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
    data: { stage: card.funnelStage },
  })

  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
  }

  const title = card.contactName?.trim() || card.contactPhone
  const relative = (() => {
    const d = new Date(card.lastMessageAt)
    if (Number.isNaN(d.getTime())) return ''
    return formatDistanceToNow(d, { addSuffix: true, locale: ptBR })
  })()

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => onOpenConversation(card.id)}
      {...listeners}
      {...attributes}
      className={
        'rounded-lg border bg-white p-3 shadow-sm transition-shadow hover:shadow-md select-none cursor-grab active:cursor-grabbing ' +
        (isDragging ? 'opacity-70 shadow-md' : 'opacity-100')
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-900">{title}</div>
          <div className="mt-1 flex items-center gap-2">
            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${originBadgeClass(card.origin)}`}>
              {ORIGIN_LABEL[card.origin]}
            </span>
            {relative && <span className="text-[10px] text-zinc-500 truncate">{relative}</span>}
          </div>
        </div>
      </div>

      {card.lastMessagePreview && (
        <div className="mt-2 truncate text-xs text-zinc-600">{card.lastMessagePreview}</div>
      )}

      {card.unreadCount > 0 && (
        <div className="mt-2 flex justify-end">
          <span className="inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-white">
            {card.unreadCount} não lida{card.unreadCount > 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  )
}
