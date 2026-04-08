# Especificação de Design — Visão Kanban (Leads por Etapa)

## Layout
- Abordagem desktop-first.
- Estrutura principal em **CSS Grid**:
  - Linha 1: Topbar fixa (altura ~56–64px).
  - Linha 2: Área de conteúdo (Kanban).
- Kanban com colunas em **Flex horizontal** com `overflow-x: auto` e `scroll-snap` opcional.
- Espaçamento base: 8px (escala 8/16/24/32).

## Meta Information
- Title: `Leads — Kanban | LeadTrack WA`
- Description: `Organize e mova leads por etapa do funil com filtros básicos.`
- Open Graph:
  - og:title = `Leads — Kanban`
  - og:description = `Visão Kanban por etapa do funil.`

## Global Styles
- Background: #0B1220 (dark) ou #FFFFFF (light) — manter coerente com o app.
- Surface/card: #111A2E (dark) / #FFFFFF (light) com borda sutil.
- Texto principal: #E8EEF9 (dark) / #0F172A (light).
- Accent (ações primárias): azul (#3B82F6).
- Tipografia (escala): 12 / 14 / 16 / 20 / 24.
- Botões:
  - Primary: fundo accent, texto branco, hover +8% brilho.
  - Secondary: borda 1px, hover com background sutil.
- Links: sublinhado no hover.
- Estados:
  - Loading: skeleton em cards/colunas.
  - Empty: mensagem curta + sugestão de remover filtros.
  - Error: banner com ação “Tentar novamente”.

## Page Structure
Padrão de dashboard com:
1) Topbar (navegação global)
2) Barra de filtros
3) Board Kanban (colunas)
4) Drawer/modal de detalhe do lead

## Sections & Components

### 1) Topbar
- Logo/nome do produto à esquerda.
- Item de navegação ativo: **Leads**.
- À direita: status da conexão do WhatsApp (Conectado/Desconectado/Aguardando) + menu de conta.

### 2) Barra de filtros (logo abaixo da Topbar)
- Componente em linha (desktop):
  - **Select Origem**: Meta / Google / Orgânico / Desconhecido / Todos.
  - **Período**: DateRange (de/até) baseado em `lastMessageAt`.
  - **Busca**: input único (placeholder “Buscar por nome, telefone ou termo…”).
  - **Botão Limpar**: reseta filtros.
- Interação:
  - Alterar filtro atualiza board e contagens.
  - Mostrar “chips” dos filtros ativos (removíveis) opcional.

### 3) Board Kanban
- Colunas fixas (da esquerda para direita):
  - Primeiro contato, Lead respondeu, Lead qualificado, Proposta enviada, Agendamento/visita marcada, Venda concluída, Perdido.
- Cabeçalho da coluna:
  - Nome da etapa + contador.
  - Ações mínimas: refresh (opcional) e indicador de carregamento.
- Lista de cards:
  - Paginação/virtualização opcional; no MVP, scroll interno por coluna.
  - Ordenação padrão: `lastMessageAt` desc.

### 4) Card do Lead (Conversa)
- Conteúdo (prioridade):
  - Título: `contactName` (ou telefone formatado se não houver nome).
  - Sub: origem (badge) + “há X tempo” (relativo) / data curta.
  - Preview: trecho da última mensagem (1–2 linhas, truncado).
  - Indicador: `unreadCount` (badge numérico) quando > 0.
- Interação:
  - Click abre Drawer de detalhe.
  - Drag handle (ícone) opcional para indicar área de arraste.
  - Durante drag: card com sombra forte + placeholder na lista.

### 5) Drag-and-drop (mudança de etapa)
- Regras visuais:
  - Coluna alvo destaca borda/accent ao “hover”.
  - Ao soltar: mostrar toast “Etapa atualizada”.
- Regras de comportamento:
  - Atualização otimista no UI.
  - Se falhar no backend: reverte card para coluna original + toast de erro.

### 6) Drawer/Modal — Detalhe da Conversa (Lead)
- Abre do lado direito (desktop), largura ~420–520px.
- Cabeçalho:
  - Nome/telefone + badge de origem.
  - Dropdown de etapa (alternativa ao drag-and-drop).
- Corpo:
  - Timeline/lista de mensagens (inbound/outbound, alinhamento esquerdo/direito).
  - Metadados: origem (com opção de corrigir/confirmar), etapa atual e histórico de mudanças.
- Rodapé:
  - Botão “Fechar”.

## Responsive behavior
- <= 768px:
  - Filtros quebram em 2 linhas.
  - Kanban mantém `overflow-x` com colunas em largura mínima (~280–320px) para swipe horizontal.
  - Drawer vira modal full-screen.
