export type LeadOrigin = 'meta_ads' | 'google_ads' | 'organic' | 'unknown'

export type FunnelStage =
  | 'first_contact'
  | 'replied'
  | 'qualified'
  | 'proposal'
  | 'scheduled'
  | 'closed'
  | 'lost'

export type ConversationCard = {
  id: string
  clientId: string
  contactName?: string
  contactPhone: string
  origin: LeadOrigin
  funnelStage: FunnelStage
  lastMessageAt: string
  lastMessagePreview?: string
  unreadCount: number
}

