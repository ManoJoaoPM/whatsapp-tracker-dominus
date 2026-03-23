1. Visão Geral do Projeto
Nome sugerido: LeadTrack WA (ou similar — ponto a validar)

Tipo: Aplicação web multi-tenant SaaS

Problema central: Campanhas de tráfego pago (Meta Ads e Google Ads) geram cliques e leads, mas não oferecem visibilidade sobre o que acontece depois que o usuário entra em contato via WhatsApp. O anunciante não sabe quantas pessoas responderam, de qual campanha vieram, como a conversa evoluiu nem se o lead converteu.

Solução proposta: Uma plataforma web que conecta o WhatsApp de cada cliente via Evolution API, captura e organiza as conversas, identifica automaticamente a origem de cada lead (Meta Ads, Google Ads ou orgânico) e exibe tudo em um painel de CRM leve, com filtros por origem, status e etapa do funil.

Público-alvo: Empresas e profissionais que usam WhatsApp como canal de atendimento comercial e investem em tráfego pago.

2. Escopo Funcional do MVP
O MVP cobre exclusivamente o ciclo de captação, identificação e visualização dos leads:

#	Funcionalidade	Incluso no MVP
1	Cadastro e login de clientes na plataforma	Sim
2	Conexão do WhatsApp via QR Code (Evolution API)	Sim
3	Carregamento do histórico inicial de conversas (últimas 20)	Sim
4	Exibição de conversas individuais (excluir grupos)	Sim
5	Visualização de mensagens enviadas e recebidas	Sim
6	Identificação automática da origem do lead	Sim
7	Filtro de conversas por origem (Meta / Google / Orgânico)	Sim
8	Atribuição manual de etapa do funil por conversa	Sim
9	Painel com contadores por origem e etapa	Sim
10	Disparo de eventos para Meta / Google ao avançar no funil	Não (Fase 3)
11	Relatórios avançados com gráficos e períodos	Não (Fase 2)
3. Módulos Funcionais
Módulo 1 — Autenticação e Gestão de Clientes
Cadastro de clientes (nome, e-mail, senha)
Login com sessão autenticada (JWT ou similar)
Painel de perfil do cliente
Cada cliente tem isolamento total de dados (multi-tenant)
Módulo 2 — Conexão WhatsApp
Geração e exibição de QR Code via Evolution API
Gerenciamento do status da conexão (conectado / desconectado / aguardando)
Reconexão automática ou manual
Suporte a reconexão quando a sessão expira
Módulo 3 — Caixa de Entrada de Conversas
Listagem de conversas individuais (sem grupos)
Carregamento do histórico inicial (últimas 20 conversas)
Recebimento em tempo real de novas mensagens (webhook)
Exibição de mensagens enviadas e recebidas dentro de cada conversa
Indicação visual de conversas não lidas
Módulo 4 — Identificação de Origem
Tentativa automática de detectar a origem do lead ao criar uma nova conversa
Estratégias de identificação (ver seção 6 — Regras de Negócio)
Armazenamento da origem identificada junto à conversa
Possibilidade de o usuário corrigir/confirmar a origem manualmente
Módulo 5 — Funil de Leads
Atribuição de etapa do funil a cada conversa
Etapas padrão sugeridas:
Primeiro contato
Lead respondeu
Lead qualificado
Proposta enviada
Agendamento/visita marcada
Venda concluída
Perdido
Histórico de mudanças de etapa por conversa
Etapas personalizáveis por cliente (ponto a validar para MVP)
Módulo 6 — Painel Analítico (MVP básico)
Total de leads recebidos por origem
Total de leads por etapa do funil
Filtros: por origem, por período, por etapa
Exportação básica (CSV) — ponto a validar para MVP
4. Fluxo do Usuário na Plataforma

[Acessa a plataforma]
        ↓
[Login / Cadastro]
        ↓
[Dashboard inicial]
        ↓
[Conectar WhatsApp] → [Escaneia QR Code] → [Conexão confirmada]
        ↓
[Caixa de entrada carrega as últimas 20 conversas]
        ↓
[Usuário clica em uma conversa]
        ↓
[Visualiza histórico de mensagens]
[Vê origem identificada do lead: Meta / Google / Orgânico]
[Atualiza etapa do funil manualmente]
        ↓
[Retorna ao painel → filtra por origem ou etapa]
        ↓
[Visualiza contadores e resumo analítico]
5. Fluxo Técnico da Operação

[Meta Ads / Google Ads]
        ↓ (link com UTM ou parâmetro de origem)
[Usuário clica → é direcionado ao WhatsApp]
        ↓
[Usuário envia mensagem no WhatsApp]
        ↓
[Evolution API recebe a mensagem]
        ↓ (webhook POST para o backend da aplicação)
[Backend recebe o evento de nova mensagem]
        ↓
[Serviço de identificação de origem executa:
  1. Verifica parâmetros no link de origem (ref, utm_source, etc.)
  2. Analisa o conteúdo da primeira mensagem (palavras-chave)
  3. Consulta registros anteriores para aquele número
  4. Atribui origem: Meta Ads / Google Ads / Orgânico / Desconhecido]
        ↓
[Conversa é salva no MongoDB com: número, origem, data, etapa inicial]
        ↓
[Frontend recebe atualização via WebSocket ou polling]
        ↓
[Conversa aparece na caixa de entrada do cliente]
6. Regras de Negócio
RN01 — Isolamento multi-tenant:
Cada cliente só visualiza conversas do seu próprio WhatsApp conectado. Nenhum dado é compartilhado entre clientes.

RN02 — Exclusão de grupos:
A aplicação deve filtrar e ignorar conversas de grupos do WhatsApp. Somente conversas individuais (1:1) devem ser exibidas.

RN03 — Identificação de origem:
A identificação deve seguir esta ordem de prioridade:

Parâmetro explícito no link de entrada (ref=meta, utm_source=google, etc.) — mais confiável
Conteúdo da primeira mensagem (ex: mensagem automática com texto padrão da campanha)
Número de telefone cruzado com registros anteriores
Fallback: "Orgânico / Desconhecido"
RN04 — Histórico inicial:
Na primeira conexão, a aplicação deve carregar as últimas 20 conversas individuais. Esse número pode ser configurável por cliente no futuro.

RN05 — Etapa do funil:
Todo lead novo entra automaticamente na etapa "Primeiro contato". A progressão pode ser manual (pelo usuário) ou automática (fase futura, via análise de mensagens).

RN06 — Uma sessão WhatsApp por cliente:
Cada cliente conecta um único número de WhatsApp. Múltiplos números por cliente é fora do escopo do MVP.

RN07 — Retenção do histórico:
As mensagens capturadas ficam armazenadas no banco da plataforma, mesmo que o cliente desconecte o WhatsApp.

7. Estrutura Sugerida de Banco de Dados (MongoDB)
Collection: clients

{
  _id,
  name,
  email,
  passwordHash,
  createdAt,
  plan (free | paid),
  whatsappInstance: {
    instanceId,        // ID da instância na Evolution API
    status,            // connected | disconnected | pending
    phoneNumber,
    connectedAt
  }
}
Collection: conversations

{
  _id,
  clientId,           // ref → clients._id
  contactPhone,
  contactName,
  origin,             // meta_ads | google_ads | organic | unknown
  originConfidence,   // auto | manual
  funnelStage,        // first_contact | replied | qualified | proposal | scheduled | closed | lost
  funnelHistory: [
    { stage, changedAt, changedBy }
  ],
  lastMessageAt,
  unreadCount,
  createdAt
}
Collection: messages

{
  _id,
  conversationId,     // ref → conversations._id
  clientId,
  direction,          // inbound | outbound
  content,
  mediaType,          // text | image | audio | document | null
  mediaUrl,
  timestamp,
  externalMessageId   // ID da mensagem na Evolution API
}
Collection: originEvents

{
  _id,
  clientId,
  contactPhone,
  rawParams,          // parâmetros capturados no link de entrada
  utmSource,
  utmMedium,
  utmCampaign,
  referrer,
  capturedAt
}
8. Integrações Necessárias
Integração	Finalidade	Tipo	Prioridade
Evolution API	Conectar WhatsApp, receber/enviar mensagens	REST + Webhook	MVP — crítica
MongoDB	Armazenamento de dados	Driver nativo	MVP — crítica
Meta Conversions API	Enviar eventos de funil para Meta Ads	REST	Fase 3
Google Ads API	Enviar conversões para Google Ads	REST	Fase 3
WebSocket / SSE	Atualização em tempo real no frontend	Protocolo	MVP — recomendado
SMTP / e-mail	Notificações e recuperação de senha	SMTP	MVP — básico
9. Riscos Técnicos e Pontos de Atenção
Risco 1 — Identificação de origem é complexa
Problema: O WhatsApp não transmite UTMs ou parâmetros de URL nativamente. A identificação de origem depende de mecanismos indiretos.
Mitigação: Implementar um intermediário (landing page ou link personalizado) que captura os parâmetros antes de redirecionar ao WhatsApp, e armazena essa informação associada ao número.

Risco 2 — Limitações da Evolution API
Problema: A Evolution API é um projeto open-source que usa automação do WhatsApp Web, o que não é oficialmente suportado pelo WhatsApp. Pode haver instabilidade, banimentos de número ou mudanças de comportamento.
Mitigação: Monitorar a saúde da instância, alertar o cliente em caso de desconexão. Para escala maior, avaliar a migração para WhatsApp Business API oficial no futuro.

Risco 3 — Volume de mensagens
Problema: Clientes com alto volume de conversas podem gerar carga significativa de dados.
Mitigação: Paginação nas listagens, índices adequados no MongoDB, limitar o histórico inicial.

Risco 4 — Multi-tenancy e segurança
Problema: Com múltiplos clientes na mesma base, um bug pode expor dados de outro cliente.
Mitigação: Sempre filtrar queries por clientId. Validar o clientId no token JWT em toda requisição.

Risco 5 — QR Code e sessão do WhatsApp
Problema: O QR Code expira rapidamente e a sessão pode cair sem aviso.
Mitigação: Exibir status da conexão em tempo real. Notificar o cliente quando a sessão cair.

10. Roadmap por Fases
Fase 1 — MVP
Objetivo: Conectar, capturar e organizar leads do WhatsApp com identificação de origem.

Autenticação de clientes
Conexão do WhatsApp via QR Code
Caixa de entrada com conversas individuais
Histórico inicial (últimas 20 conversas)
Identificação automática de origem
Funil manual (atribuição de etapa pelo usuário)
Painel com contadores básicos (por origem, por etapa)
Filtros por origem e etapa
Fase 2 — Relatórios Avançados
Objetivo: Transformar os dados em inteligência acionável.

Gráficos de conversão por etapa do funil
Comparativo de performance entre Meta Ads e Google Ads
Evolução temporal (leads por dia/semana/mês)
Taxa de resposta e tempo médio de resposta
Relatórios exportáveis (PDF / CSV)
Filtros avançados por campanha, período, atendente
Fase 3 — Disparo de Eventos para Meta e Google
Objetivo: Fechar o ciclo de atribuição — devolver ao anunciante o dado de conversão real.

Integração com Meta Conversions API
Integração com Google Ads Conversion API
Configuração de quais etapas do funil disparam qual evento
Log de eventos disparados por conversa
Validação de eventos no painel do Meta/Google
11. Pontos a Validar Antes de Desenvolver
#	Dúvida	Impacto
1	Como será capturada a origem do lead? Será usada uma landing page intermediária antes do WhatsApp?	Alto — define a viabilidade da identificação automática
2	O cliente usará links personalizados por campanha (ex: wa.me/...?ref=meta)?	Alto — determina a estratégia de rastreamento
3	A Evolution API será self-hosted ou usada como serviço?	Médio — afeta infraestrutura e custo
4	As etapas do funil serão fixas ou personalizáveis por cliente no MVP?	Médio — afeta complexidade do MVP
5	O cliente poderá responder mensagens pela plataforma ou apenas visualizar?	Médio — define se é CRM leve ou só analytics
6	O sistema precisará suportar múltiplos atendentes por cliente no MVP?	Médio — impacta modelo de usuários
7	Exportação de dados (CSV/PDF) entra no MVP ou fica para Fase 2?	Baixo — escopo do MVP
8	Qual o nome comercial da plataforma?	Baixo — branding
12. Versão Resumida — Prompt para o TRAE
Construa uma aplicação web multi-tenant para rastreamento de leads do WhatsApp vindos de campanhas de Meta Ads e Google Ads.

Stack: Node.js (backend), React (frontend), MongoDB (banco de dados), Evolution API (integração WhatsApp).

O sistema deve:

1. Autenticação:

Cadastro e login de clientes com JWT.
Cada cliente tem dados completamente isolados (multi-tenant por clientId).
2. Conexão WhatsApp:

O cliente conecta seu WhatsApp escaneando um QR Code gerado pela Evolution API.
Exibir o status da conexão em tempo real (conectado / desconectado / aguardando).
3. Caixa de entrada:

Carregar e exibir as últimas 20 conversas individuais (excluir grupos).
Receber novas mensagens em tempo real via webhook da Evolution API.
Exibir mensagens enviadas e recebidas dentro de cada conversa.
4. Identificação de origem do lead:

Ao registrar uma nova conversa, tentar identificar se o lead veio de Meta Ads, Google Ads ou orgânico.
A identificação usa: parâmetros no link de entrada (utm_source, ref), conteúdo da primeira mensagem, ou fallback para "Desconhecido".
5. Funil de vendas:

Cada conversa tem uma etapa do funil: Primeiro contato → Respondeu → Qualificado → Proposta → Agendamento → Venda → Perdido.
O usuário pode alterar a etapa manualmente. O histórico de mudanças deve ser salvo.
6. Painel analítico:

Exibir contadores de leads por origem (Meta / Google / Orgânico) e por etapa do funil.
Filtros por origem, etapa e período.
Banco de dados MongoDB — collections principais:

clients — dados do cliente e da instância WhatsApp conectada
conversations — conversa com origem, etapa do funil e histórico
messages — mensagens individuais de cada conversa
originEvents — parâmetros capturados no momento de entrada do lead
Regras importantes:

Nunca exibir grupos — somente conversas 1:1.
Toda query deve ser filtrada por clientId para garantir isolamento.
Toda nova conversa entra na etapa "Primeiro contato" automaticamente.
O histórico de mensagens deve persistir mesmo após desconexão do WhatsApp.
Fora do escopo desta versão: disparo de eventos para Meta/Google, relatórios avançados com gráficos, múltiplos atendentes por cliente.

