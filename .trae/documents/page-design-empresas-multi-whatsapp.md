# Page Design — Empresa com múltiplos WhatsApps (desktop-first)

## Global Styles (tokens)
- Layout: CSS Grid para shell (sidebar + conteúdo) e Flexbox em componentes.
- Breakpoints: Desktop 1280+ (base), Tablet 768–1279 (sidebar colapsa), Mobile <768 (stack vertical).
- Cores: background #0B1220; surface #111B2E; border #22304A; texto #E6EDF7; muted #9FB0CC.
- Accent/origem: Meta #2E6BFF; Google #F4B400; Orgânico #22C55E; Desconhecido #94A3B8.
- Tipografia: 14px base; headings 18/24/32; números de KPI 28–40.
- Botões: Primary (accent), Secondary (surface), Danger (vermelho); hover com leve elevação + border mais clara.
- Estados: loading skeleton; empty state com CTA; toast para sucesso/erro.

---

## 1) Login/Cadastro
### Meta Information
- title: "Entrar | LeadTrack WA"
- description: "Acesse sua conta e gerencie os WhatsApps da sua empresa."

### Page Structure
- Centralizado (max-width 420px), card sobre background.

### Sections & Components
- Header: logo + nome do produto.
- Tabs: “Entrar” / “Criar conta”.
- Form: e-mail, senha; (cadastro) nome da empresa.
- CTA: botão principal; link “Esqueci minha senha” (se aplicável).

---

## 2) Dashboard da Empresa (agregado)
### Meta Information
- title: "Dashboard | Empresa"
- description: "Resumo agregado por origem e etapa do funil, com filtros."

### Layout
- App Shell em Grid: Sidebar (240px) + Main.
- Main: grid 12 colunas; cards de KPIs em 3–4 colunas.

### Sections & Components
- Topbar: nome da Empresa, seletor de período, avatar/menu.
- Filtros: período, origem, etapa, WhatsApp (dropdown “Todos” + lista de números).
- KPI Row:
  - Cards: Total de leads, Meta, Google, Orgânico, Desconhecido.
- Funil (resumo): lista compacta de etapas com contadores (clicáveis para filtrar Inbox).
- Lista de WhatsApps: tabela com Display Name, Número, Status (badge), Última conexão.

---

## 3) Conexões de WhatsApp
### Meta Information
- title: "Conexões | WhatsApps"
- description: "Adicione e gerencie múltiplos WhatsApps por empresa."

### Layout
- Duas colunas (desktop): esquerda lista; direita painel de ação (QR/status).

### Sections & Components
- Lista de contas:
  - Cada item: nome/número, status, botões “Ver QR”, “Atualizar QR”, “Desconectar”.
- Painel QR:
  - QR grande com timer/expiração; instruções “Abra o WhatsApp → Dispositivos conectados”.
  - Status em tempo real (pending/connected/disconnected).
- CTA: “Adicionar novo WhatsApp” (abre modal para nome interno; gera instância).

---

## 4) Caixa de Entrada
### Meta Information
- title: "Inbox | Conversas"
- description: "Caixa de entrada por WhatsApp, com origem e funil."

### Layout
- 3 colunas (desktop):
  1) Coluna A (320px): conversas
  2) Coluna B (flex): mensagens
  3) Coluna C (320px): detalhes (origem/funil)

### Sections & Components
- Header/Filtros:
  - Seletor de WhatsApp (obrigatório)
  - Busca por nome/número
  - Filtros: origem, etapa, não lidas
- Lista de conversas:
  - Itens com: nome/número, preview, hora, badge de origem (cor), unreadCount.
  - Exclusão de grupos (nunca renderizar).
- Painel de mensagens:
  - Thread com bubbles inbound/outbound; suporte a mídia (placeholder/link).
  - Carregamento incremental (scroll) e atualização em tempo real.
- Painel de detalhes:
  - Origem: dropdown (Meta/Google/Orgânico/Desconhecido) + indicador auto/manual.
  - Funil: dropdown de etapa + mini-timeline (últimas mudanças).
  - Metadados: último contato, WhatsApp responsável (número).
