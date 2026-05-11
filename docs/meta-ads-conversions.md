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
- Evento enviado: `QualifiedLead` (ou `qualified_lead` se for via Business Messaging)

## 6) Click-to-WhatsApp (CTWA) e Business Messaging

Se o lead vier de uma campanha de mensagens com o parâmetro nativo Click-to-WhatsApp (`ctwaClid` capturado do webhook da Evolution API):
1. O backend automaticamente acionará a Meta Graph API para recuperar dados estendidos do anúncio (ID da Campanha, Nome, Título do Ad, Thumbnail) que ficarão salvos para contexto interno/UI (`metaAdData`).
2. O envio de conversão ocorrerá usando `action_source: "business_messaging"` e `messaging_channel: "whatsapp"`.
3. O parâmetro `ctwa_clid` será enviado no `user_data`, garantindo atribuição correta das campanhas de WhatsApp sem a necessidade de links UTM.
4. O telefone do usuário (`ph`) também é passado em hash SHA-256 no formato internacional (`55...`).

## 7) Validar no Events Manager (modo teste)

1. No **Events Manager** → selecione o Pixel → **Test events**.
2. Copie o **Test Event Code**.
3. Na aplicação, em `Conexões` → **Meta Ads** → seção **Teste de evento**, cole o código e clique em **Enviar teste**.
4. O evento deve aparecer no painel de teste.

Alternativa (mais rápida): na aplicação, em `Conexões` → **Meta Ads** → seção **Teste de evento**, cole o **Test Event Code** e clique em **Enviar teste**.

O Test Event Code é só para validação; pode trocar a cada teste.

## 8) Usar em campanhas

1. No Ads Manager, escolha o Pixel e otimize para o evento `QualifiedLead`.
2. Se precisar de regras extras, crie uma **Custom Conversion** baseada no evento `QualifiedLead`.

## Observações importantes

- O envio é server-side, então **não depende** do navegador do usuário.
- Para matching, o projeto envia dados hash (SHA-256), como telefone (`ph`) quando disponível.
- Para evitar duplicidade, o envio é controlado por flags na conversa (idempotência).
