# Meta Ads (Pixel + Conversions API)

Este projeto envia conversões para o Meta via **Conversions API (CAPI)**. Na prática, o “pixel” é a fonte de eventos no Events Manager, mas o envio é feito **server-side**.

## 1) Criar/selecionar o Pixel

1. Abra o **Meta Business Manager** → **Events Manager**.
2. Em **Data Sources** → **Add** → **Web**.
3. Crie (ou selecione) um **Meta Pixel**.
4. Copie o **Pixel ID**.

## 2) Gerar o token da Conversions API

1. No **Events Manager** → selecione o Pixel.
2. Vá em **Settings**.
3. Em **Conversions API**, gere um **Access Token**.

Guarde esse token com segurança.

## 3) Configurar variáveis de ambiente

Defina no backend:

- `SECRETS_MASTER_KEY` = chave mestre para criptografar tokens por cliente

## 4) Integração por empresa (multi-tenant)

Cada **empresa/cliente** configura seu próprio:

- `Pixel ID`
- Token da Conversions API

Na aplicação, isso fica disponível em `Conexões` → seção **Meta Ads**.

## 5) Como o evento é disparado neste projeto

- O evento é enviado **apenas** quando:
  - `conversation.origin === 'meta_ads'`
  - o MQL cruza para o nível configurado na integração do cliente (padrão: `hot`)
- Evento enviado: `QualifiedLead` (nome idêntico, com maiúsculas, tanto para `business_messaging` quanto para `chat`)
- Antes de cada envio o payload é validado localmente (`api/services/metaEventValidation.ts`):
  - nome de evento aceito pelo Meta para mensageria: `Purchase`, `LeadSubmitted`, `QualifiedLead`, `InitiateCheckout`, `AddToCart`, `ViewContent`, `OrderCreated`, `OrderShipped`, `OrderDelivered`, `OrderCanceled`, `OrderReturned`, `CartAbandoned`, `RatingProvided`, `ReviewProvided`. **`Lead` não é aceito em mensageria.**
  - `event_time` em segundos, no máximo 7 dias no passado e nunca no futuro
  - `ctwa_clid` obrigatório, sem hash e sem espaços
  - `Purchase`/`OrderCreated` exigem `custom_data.currency` e `custom_data.value`
- O Meta pode responder HTTP 200 com `events_received: 0` (evento descartado). Isso é tratado como **falha**, e o motivo fica em `metaConversions.mqlQualifiedLastError` da conversa.

## 6) Click-to-WhatsApp (CTWA) e Business Messaging

Se o lead vier de uma campanha de mensagens com o parâmetro nativo Click-to-WhatsApp (`ctwaClid` capturado do webhook da Evolution API):
1. O backend automaticamente acionará a Meta Graph API para recuperar dados estendidos do anúncio (ID da Campanha, Nome, Título do Ad, Thumbnail) que ficarão salvos para contexto interno/UI (`metaAdData`).
2. O envio de conversão ocorrerá usando `action_source: "business_messaging"` e `messaging_channel: "whatsapp"`.
3. O parâmetro `ctwa_clid` será enviado no `user_data`, garantindo atribuição correta das campanhas de WhatsApp sem a necessidade de links UTM.
4. O telefone do usuário (`ph`) também é passado em hash SHA-256 no formato internacional (`55...`).

## 5.1) Fila de envio (entrega confiável)

Nenhum evento é enviado "no ar". Quando um lead atinge o nível configurado, o evento é **gravado** em `MetaEventLog` (`api/models/MetaEventLog.ts`) e só então enviado (`api/services/metaEventQueue.ts`):

| Status | Significado |
|---|---|
| `pending` | Na fila: primeira tentativa ou nova tentativa agendada (`nextAttemptAt`) |
| `sending` | Um worker está enviando agora |
| `sent` | O Meta confirmou (`events_received >= 1`) |
| `failed` | Desistiu; pode ser reenviado manualmente em **Logs → Eventos enviados** |

- **Um evento por conversa e nome, para sempre.** A chave `conversa:QualifiedLead` é única. Reavaliar a conversa várias vezes não duplica o envio (o Meta não deduplica mensageria).
- **Retry automático** só para erros temporários (rede, timeout, HTTP 5xx/429, códigos Meta 1, 2, 4, 17, 32, 341, 368, 613), com espera de 1 min, 5 min, 15 min, 1 h, 3 h, 6 h, 12 h e 24 h (9 tentativas no total).
- **Sem retry** para token inválido (190), permissão (3, 10, 200-299), parâmetro inválido (100), evento recusado (`events_received: 0`) ou evento com mais de 7 dias. Esses vão para `failed` e esperam uma pessoa corrigir a integração e clicar em **Reenviar**. O reenvio usa o `page_id` atual da integração.
- **Nível mínimo.** O nível configurado é um mínimo: com "Warm", um lead que vai direto a "Hot" também dispara.
- **Worker.** Roda dentro do servidor (`startMetaEventWorker`, a cada 30 s) e devolve à fila eventos presos em `sending` por mais de 5 min (queda do servidor no meio do envio). Precisa de processo contínuo (Docker ou `npm run server:dev`). **Em hospedagem serverless (Vercel) os retries não rodam.**
- Se o servidor cair exatamente depois de o Meta receber e antes de gravarmos `sent`, a recuperação reenvia e pode duplicar o evento. É raro e inevitável sem deduplicação no Meta.
- Conversas já marcadas como enviadas antes da fila (`metaConversions.mqlQualifiedSentAt`) **não** são reenviadas. Atenção: aquelas foram enviadas com o nome antigo `qualified_lead`, e não há como saber se o Meta as contou.

## 5.2) Escada de eventos

Em `Conexões` → **Meta Ads** → **Eventos enviados ao Meta** cada cliente liga o que quer enviar. Todos usam a mesma fila (seção 5.1), com um evento por conversa e por nome.

| Evento | Quando sai | Depende da IA? | Padrão |
|---|---|---|---|
| `LeadSubmitted` | O lead respondeu pelo menos N vezes (padrão 2) | Não | Desligado |
| `QualifiedLead` | A IA qualificou e confirmou (nível mínimo configurado) | Sim | Ligado |
| `Purchase` | Uma **pessoa** move o lead para "Venda concluída" e informa o valor | Não (a IA só sugere o valor) | Desligado |

- **Só leads de anúncio.** Os três eventos exigem origem Meta e `ctwa_clid` (salvo a opção de enviar leads sem `ctwa_clid`).
- **Valor da venda.** Ao arrastar um card para "Venda concluída" (Kanban) ou trocar a etapa (tela de conversas), o sistema pede o valor. Se a IA encontrou na conversa um valor com citação verificável, ele aparece como sugestão para conferir. Sem valor, a venda é registrada, mas o `Purchase` não é enviado. O valor pode ser informado depois (botão "Informar valor"), e o evento sai nesse momento.
- **Moeda.** Configurável (padrão BRL), enviada em `custom_data.currency`.
- **Um `Purchase` por conversa.** Se o valor for corrigido depois do envio, o Meta continua com o valor antigo. Recompras do mesmo contato não geram novo evento.
- **No Gerenciador de Anúncios**, otimize para o evento mais próximo da venda que ainda tenha volume. O número comumente citado é cerca de 50 eventos por semana por conjunto de anúncios (referência de mercado, não regra oficial confirmada). Com menos volume, comece por `LeadSubmitted` e suba para `QualifiedLead` e `Purchase` conforme o volume crescer. Confirme na sua campanha quais eventos de mensageria aparecem como meta de otimização: a documentação oficial só garante `Purchase` para anúncios de clique para o WhatsApp.

## 6.1) Atribuição por último clique

O Meta atribui a conversão ao clique mais recente, então o sistema faz o mesmo (`api/services/attribution.ts`):

- Todo clique de anúncio (`ctwa_clid`) visto em mensagem recebida fica no histórico `metaClicks` da conversa (últimos 20).
- Quando um contato que já tinha conversa clica em **outro** anúncio, `metaCtwaClid` e `metaAdData` passam a refletir o novo clique. Os dados da campanha anterior são descartados, não misturados.
- Mensagens atrasadas (backlog entregue após reconexão) entram no histórico, mas não substituem o clique mais recente.
- Origem marcada manualmente (`originConfidence = manual`) não é sobrescrita.
- O mesmo `ctwa_clid` repetido (reentrega de webhook) é ignorado.

### Leads sem `ctwa_clid`

Por padrão, leads classificados como Meta **sem** `ctwa_clid` (por UTM ou palavra-chave) **não disparam evento**, pois o Meta não consegue ligá-los a um clique. Em `Conexões` → **Meta Ads** existe a opção "Enviar também leads Meta sem ctwa_clid" para mudar isso.

### Medindo a captura

O Dashboard mostra "Qualidade da atribuição (Meta Ads)": leads Meta, quantos têm `ctwa_clid`, quantos tiveram campanha identificada e quantos eventos foram enviados. Para saber se há cliques sem captura, compare "Leads Meta" com as **conversas iniciadas** do mesmo período no Gerenciador de Anúncios.

Se a diferença for grande de forma persistente com o Evolution (ele é um cliente não oficial e pode não entregar os dados do anúncio), a saída é migrar o número para a WhatsApp Cloud API oficial.

## 7) Validar no Events Manager (modo teste)

1. No **Events Manager** → selecione o Pixel → **Test events**.
2. Copie o **Test Event Code**.
3. Na aplicação, em `Conexões` → **Meta Ads** → seção **Teste de evento**, cole o código e clique em **Enviar teste**.
4. O evento deve aparecer no painel de teste.

O Test Event Code é só para validação; pode trocar a cada teste.

### Checklist de validação (obrigatório antes de usar em produção)

1. Em `Conexões` → **Meta Ads**, informe Pixel ID, Page ID e o token CAPI e salve.
2. Em **Teste de evento**: evento `QualifiedLead`, origem `business_messaging (CTWA)`. Use um `ctwa_clid` real de um lead recente (aba **Ver Logs**) ou o botão **Mock**.
3. Envie e confira no **Events Manager → Test events** que o evento apareceu.
4. Se a resposta for `events_received: 0`, ou se o evento não aparecer, o dataset configurado não aceita o formato. O Meta documenta duas formas, e só o Test Events diz qual vale para a sua conta:
   - **Pixel/dataset de mensagens ligado à Página** (`page_id` em `user_data`): é o que este projeto envia hoje.
   - **Dataset da conta WhatsApp Business (WABA)** com `whatsapp_business_account_id` em `user_data`: é o formato da documentação oficial da Cloud API (`POST /{waba_id}/dataset` devolve o dataset).
5. Registre aqui qual formato funcionou: _(preencher após o teste)_

Códigos de erro frequentes (relatados por terceiros, não documentados pelo Meta): `2804066` nome de evento não aceito; `2804131` dataset sem Página associada; `2804081` moeda ausente em evento de compra.

## 8) Usar em campanhas

1. No Ads Manager, escolha o Pixel e otimize para o evento `QualifiedLead`.
2. Se precisar de regras extras, crie uma **Custom Conversion** baseada no evento `QualifiedLead`.

## Observações importantes

- O envio é server-side, então **não depende** do navegador do usuário.
- Para matching, o projeto envia dados hash (SHA-256), como telefone (`ph`) quando disponível.
- Para evitar duplicidade, o envio é controlado por flags na conversa (idempotência).
