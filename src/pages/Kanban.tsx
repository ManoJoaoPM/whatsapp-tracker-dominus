import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { io, Socket } from 'socket.io-client'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/useAuthStore'
import { KanbanColumn } from '@/components/kanban/KanbanColumn'
import { FUNNEL_STAGES } from '@/components/kanban/constants'
import type { ConversationCard, FunnelStage, LeadOrigin } from '@/components/kanban/types'
import { KanbanToolbar } from '@/components/kanban/KanbanToolbar'
import { KanbanStageSlider } from '@/components/kanban/KanbanStageSlider'

type KanbanResponse = {
  stages: FunnelStage[]
  columns: Record<FunnelStage, ConversationCard[]>
  counts: Record<FunnelStage, number>
}

const emptyColumns = (): Record<FunnelStage, ConversationCard[]> =>
  Object.fromEntries(FUNNEL_STAGES.map((s) => [s, []])) as Record<FunnelStage, ConversationCard[]>

const emptyCounts = (): Record<FunnelStage, number> =>
  Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0])) as Record<FunnelStage, number>

function buildIsoRange(from: string, to: string) {
  const fromIso = from ? `${from}T00:00:00.000Z` : undefined
  const toIso = to ? `${to}T23:59:59.999Z` : undefined
  return { fromIso, toIso }
}

function findStageOf(columns: Record<FunnelStage, ConversationCard[]>, cardId: string): FunnelStage | null {
  for (const s of FUNNEL_STAGES) {
    if (columns[s].some((c) => c.id === cardId)) return s
  }
  return null
}

function upsertCard(columns: Record<FunnelStage, ConversationCard[]>, card: ConversationCard) {
  const next = { ...columns }
  let removedFrom: FunnelStage | null = null

  for (const s of FUNNEL_STAGES) {
    const idx = next[s].findIndex((c) => c.id === card.id)
    if (idx >= 0) {
      next[s] = [...next[s].slice(0, idx), ...next[s].slice(idx + 1)]
      removedFrom = s
      break
    }
  }

  next[card.funnelStage] = [card, ...next[card.funnelStage]]
  return { columns: next, removedFrom }
}

export default function Kanban() {
  const { user, selectedClientId } = useAuthStore()
  const navigate = useNavigate()

  const [origin, setOrigin] = useState<'' | LeadOrigin>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')

  const [columns, setColumns] = useState<Record<FunnelStage, ConversationCard[]>>(emptyColumns)
  const [counts, setCounts] = useState<Record<FunnelStage, number>>(emptyCounts)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [isDndDragging, setIsDndDragging] = useState(false)

  const toastTimerRef = useRef<number | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const lastDragEndAtRef = useRef(0)
  const boardScrollRef = useRef<HTMLDivElement | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  )

  const headers = useMemo(() => {
    return {
      Authorization: `Bearer ${user?.token}`,
      'x-client-id': selectedClientId || '',
    }
  }, [user?.token, selectedClientId])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2200)
  }, [])

  const openConversation = useCallback(
    (conversationId: string) => {
      if (isDndDragging) return
      if (Date.now() - lastDragEndAtRef.current < 250) return
      navigate(`/conversations?conversationId=${encodeURIComponent(conversationId)}`)
    },
    [isDndDragging, navigate]
  )

  const fetchBoard = useCallback(async () => {
    if (!user || !selectedClientId) return
    setLoading(true)
    setError(null)
    try {
      const { fromIso, toIso } = buildIsoRange(from, to)
      const { data } = await axios.get<KanbanResponse>('/api/conversations/kanban', {
        headers,
        params: {
          origin: origin || undefined,
          q: q || undefined,
          from: fromIso,
          to: toIso,
          perStage: 50,
          _t: Date.now(),
        },
      })

      const nextColumns = emptyColumns()
      for (const s of FUNNEL_STAGES) {
        nextColumns[s] = data.columns?.[s] || []
      }

      setColumns(nextColumns)
      setCounts({ ...emptyCounts(), ...(data.counts || {}) })
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Falha ao carregar o Kanban')
    } finally {
      setLoading(false)
    }
  }, [user, selectedClientId, headers, origin, q, from, to])

  useEffect(() => {
    const id = window.setTimeout(() => setQ(qInput.trim()), 250)
    return () => window.clearTimeout(id)
  }, [qInput])

  useEffect(() => {
    fetchBoard()
  }, [fetchBoard])

  useEffect(() => {
    if (!user || !selectedClientId) return

    const socketUrl = import.meta.env.DEV
      ? (import.meta.env.VITE_SOCKET_URL || `${window.location.protocol}//${window.location.hostname}:3001`)
      : undefined
    const s = socketUrl ? io(socketUrl) : io()
    socketRef.current = s

    s.on('connect', () => {
      s.emit('join', selectedClientId)
    })

    s.on('new_message', (payload: { conversation: any }) => {
      const conv = payload?.conversation
      if (!conv?._id && !conv?.id) return

      const card: ConversationCard = {
        id: String(conv._id || conv.id),
        clientId: String(conv.clientId),
        contactName: conv.contactName || undefined,
        contactPhone: conv.contactPhone,
        origin: conv.origin,
        funnelStage: conv.funnelStage,
        lastMessageAt: new Date(conv.lastMessageAt).toISOString(),
        lastMessagePreview: conv.lastMessageContent || undefined,
        unreadCount: conv.unreadCount || 0,
      }

      setColumns((prev) => {
        const result = upsertCard(prev, card)
        setCounts((prevCounts) => {
          const next = { ...prevCounts }
          if (!result.removedFrom) {
            next[card.funnelStage] = (next[card.funnelStage] || 0) + 1
            return next
          }
          if (result.removedFrom !== card.funnelStage) {
            next[result.removedFrom] = Math.max(0, (next[result.removedFrom] || 0) - 1)
            next[card.funnelStage] = (next[card.funnelStage] || 0) + 1
          }
          return next
        })
        return result.columns
      })
    })

    s.on('conversation_updated', (payload: { conversation: ConversationCard }) => {
      const card = payload?.conversation
      if (!card?.id) return
      setColumns((prev) => {
        const result = upsertCard(prev, card)
        setCounts((prevCounts) => {
          const next = { ...prevCounts }
          if (!result.removedFrom) {
            next[card.funnelStage] = (next[card.funnelStage] || 0) + 1
            return next
          }
          if (result.removedFrom !== card.funnelStage) {
            next[result.removedFrom] = Math.max(0, (next[result.removedFrom] || 0) - 1)
            next[card.funnelStage] = (next[card.funnelStage] || 0) + 1
          }
          return next
        })
        return result.columns
      })
    })

    s.on('disconnect', () => {
    })

    return () => {
      s.disconnect()
      socketRef.current = null
    }
  }, [user, selectedClientId])

  const onDragEnd = useCallback(
    async (evt: any) => {
      setIsDndDragging(false)
      lastDragEndAtRef.current = Date.now()
      const activeId = evt?.active?.id ? String(evt.active.id) : ''
      const overId = evt?.over?.id ? String(evt.over.id) : ''
      if (!activeId || !overId) return

      const fromStage = findStageOf(columns, activeId)
      const toStage = FUNNEL_STAGES.includes(overId as FunnelStage) ? (overId as FunnelStage) : null
      if (!fromStage || !toStage || fromStage === toStage) return

      const moving = columns[fromStage].find((c) => c.id === activeId)
      if (!moving) return

      const nextCard: ConversationCard = { ...moving, funnelStage: toStage }

      setColumns((prev) => {
        const copy = { ...prev }
        copy[fromStage] = copy[fromStage].filter((c) => c.id !== activeId)
        copy[toStage] = [nextCard, ...copy[toStage]]
        return copy
      })

      setCounts((prev) => ({
        ...prev,
        [fromStage]: Math.max(0, (prev[fromStage] || 0) - 1),
        [toStage]: (prev[toStage] || 0) + 1,
      }))

      showToast('Etapa atualizada')

      try {
        await axios.patch(
          `/api/conversations/${activeId}/stage`,
          { stage: toStage },
          {
            headers,
          }
        )
      } catch (_e) {
        setColumns((prev) => {
          const copy = { ...prev }
          copy[toStage] = copy[toStage].filter((c) => c.id !== activeId)
          copy[fromStage] = [moving, ...copy[fromStage]]
          return copy
        })
        setCounts((prev) => ({
          ...prev,
          [fromStage]: (prev[fromStage] || 0) + 1,
          [toStage]: Math.max(0, (prev[toStage] || 0) - 1),
        }))
        showToast('Não foi possível salvar a etapa')
      }
    },
    [columns, headers, showToast]
  )

  const onDragStart = useCallback(() => {
    setIsDndDragging(true)
  }, [])

  const onDragCancel = useCallback(() => {
    setIsDndDragging(false)
    lastDragEndAtRef.current = Date.now()
  }, [])

  const clearFilters = () => {
    setOrigin('')
    setFrom('')
    setTo('')
    setQInput('')
    setQ('')
  }

  return (
    <div className="h-full overflow-hidden bg-[#fafafa]">
      <KanbanToolbar
        origin={origin}
        setOrigin={setOrigin}
        from={from}
        setFrom={setFrom}
        to={to}
        setTo={setTo}
        qInput={qInput}
        setQInput={setQInput}
        onClear={clearFilters}
        onRefresh={fetchBoard}
        error={error}
      />

      <div className="mt-5">
        <KanbanStageSlider
          scrollContainerRef={boardScrollRef}
        />
      </div>

      <div ref={boardScrollRef} className="px-8 pb-8 pt-6 overflow-x-auto">
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragCancel={onDragCancel} onDragEnd={onDragEnd}>
          <div className="flex gap-4 min-w-max">
            {FUNNEL_STAGES.map((stage) => (
              <KanbanColumn
                key={stage}
                stage={stage}
                count={counts[stage] || 0}
                cards={columns[stage] || []}
                isLoading={loading}
                onOpenConversation={openConversation}
              />
            ))}
          </div>
        </DndContext>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
