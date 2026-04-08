import React, { useCallback, useEffect, useRef, useState } from 'react'

export function KanbanStageSlider({
  scrollContainerRef,
}: {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}) {
  const [value, setValue] = useState(0)

  const rafRef = useRef<number | null>(null)

  const updateFromScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth)
    if (maxScroll === 0) {
      setValue(0)
      return
    }
    const ratio = container.scrollLeft / maxScroll
    const next = Math.max(0, Math.min(1000, Math.round(ratio * 1000)))
    setValue(next)
  }, [scrollContainerRef])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const onScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(updateFromScroll)
    }

    container.addEventListener('scroll', onScroll, { passive: true })
    updateFromScroll()
    return () => {
      container.removeEventListener('scroll', onScroll)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [scrollContainerRef, updateFromScroll])

  const onChange = useCallback(
    (nextValue: number) => {
      setValue(nextValue)
      const container = scrollContainerRef.current
      if (!container) return
      const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth)
      const left = (nextValue / 1000) * maxScroll
      container.scrollTo({ left, behavior: 'auto' })
    },
    [scrollContainerRef]
  )

  return (
    <div className="px-8">
      <div className="rounded-lg border border-zinc-200 bg-white px-4 py-2 shadow-sm">
        <input
          type="range"
          min={0}
          max={1000}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full"
          aria-label="Navegar horizontalmente no kanban"
        />
      </div>
    </div>
  )
}
