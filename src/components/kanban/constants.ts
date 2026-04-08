import type { FunnelStage, LeadOrigin } from './types'

export const FUNNEL_STAGES: FunnelStage[] = [
  'first_contact',
  'replied',
  'qualified',
  'proposal',
  'scheduled',
  'closed',
  'lost',
]

export const FUNNEL_STAGE_LABEL: Record<FunnelStage, string> = {
  first_contact: 'Primeiro contato',
  replied: 'Lead respondeu',
  qualified: 'Lead qualificado',
  proposal: 'Proposta enviada',
  scheduled: 'Agendamento/visita marcada',
  closed: 'Venda concluída',
  lost: 'Perdido',
}

export const ORIGIN_LABEL: Record<LeadOrigin, string> = {
  meta_ads: 'Meta',
  google_ads: 'Google',
  organic: 'Orgânico',
  unknown: 'Desconhecido',
}

