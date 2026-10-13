# Link de conexão para o cliente

Permite que o cliente conecte o próprio WhatsApp sem ter login no sistema. A agência gera um link, envia ao cliente, e ele só abre, toca em **Conectar** e segue o passo a passo. Quando o número conecta, aparece a página de agradecimento.

## Como usar (agência)

1. Selecione a empresa no menu lateral e abra **Conexão WhatsApp**.
2. No cartão **Link de conexão para o cliente**, informe (opcional) o nome do número, como "Comercial", escolha a validade (padrão 7 dias) e clique em **Gerar link**. O link é copiado automaticamente.
3. Envie o link ao cliente. O cartão mostra o andamento: *Aguardando o cliente*, *Cliente conectando*, *Conectado*, *Expirado* ou *Cancelado*.
4. Quando conectar, o número aparece sozinho na lista de **Números conectados**.

Cada link serve para conectar **um** número. Para dois números, gere dois links. Você pode **cancelar** um link ainda não usado, ou remover da lista os que já terminaram (o número conectado não é afetado).

## O que o cliente vê

1. **Abertura:** "Conecte o WhatsApp da *Empresa*" e o botão **Conectar**, com uma frase explicando que a empresa passa a acompanhar as conversas do número para medir o resultado dos anúncios e que ele pode desconectar quando quiser em *Aparelhos conectados*. Revise esse texto com o seu jurídico/LGPD antes de usar com clientes (`src/pages/PublicConnect.tsx`).
2. **QR code** (computador): o passo a passo escrito com o caminho exato do menu do WhatsApp (*Aparelhos conectados › Conectar um aparelho*) e o QR, que se renova sozinho antes de vencer.
3. **Código de 8 letras** (celular): ninguém consegue escanear o QR da própria tela do celular, e o mais provável é o cliente abrir o link no celular em que o WhatsApp está. Por isso a página abre direto neste modo quando detecta um celular: o cliente digita o número, recebe o código e digita no WhatsApp em *Conectar com número de telefone*. Há troca entre os dois modos.
4. **Agradecimento:** "WhatsApp conectado. Tudo certo. Você já pode fechar esta página."

Links inexistentes, expirados ou cancelados mostram uma mensagem clara orientando a pedir um novo link.

## Segurança

O link é uma credencial: quem o tiver consegue exibir um QR code de conexão da empresa. Por isso:

- O token tem 256 bits aleatórios (43 caracteres), impossível de adivinhar. No banco fica o hash para a busca e o token criptografado com `SECRETS_MASTER_KEY` apenas para a agência poder copiar o link de novo.
- Expira (1 a 30 dias), pode ser cancelado e **para de gerar códigos assim que o número conecta**. Depois disso o link só mostra o agradecimento.
- Os endpoints públicos (`/api/public/connect/:token/...`) só devolvem o nome da empresa, o estado e o QR/código. Nenhum id, nome de instância ou dado da empresa.
- Limite de requisições por link e por IP. Atrás de um proxy reverso (nginx, Traefik) defina `TRUST_PROXY=1` para o limite por IP enxergar o cliente real.
- O número digitado para o código de pareamento não é salvo nem registrado em log.
- Se um link vazar antes de ser usado, cancele-o e gere outro. Um número conectado por engano pode ser desconectado em **Conexão WhatsApp → Desconectar**.
- Máximo de 20 links ativos por empresa.

## Endpoints

| Rota | Quem usa | Para quê |
|---|---|---|
| `GET /api/connection-invites` | agência (login) | listar links |
| `POST /api/connection-invites` | agência | gerar link (`displayName`, `expiresInDays`) |
| `DELETE /api/connection-invites/:id` | agência | cancelar ou remover |
| `GET /api/public/connect/:token` | cliente | nome da empresa e estado do link |
| `POST /api/public/connect/:token/start` | cliente | cria a conexão (1ª vez) e devolve um QR novo |
| `POST /api/public/connect/:token/pairing` | cliente | código de 8 letras para um número |
| `GET /api/public/connect/:token/status` | cliente | verifica se já conectou |

A página pública fica em `/conectar/:token`, fora do layout com menu e login.

## Limites conhecidos

- O código de 8 letras usa o parâmetro `number` do endpoint `instance/connect` do **Evolution API v2**. Não pude testar contra o seu Evolution: se a sua versão não devolver `pairingCode`, a página avisa e orienta a abrir o link em um computador para escanear o QR.
- Um link que o cliente abre e abandona deixa uma conexão "pendente" na lista de números. Basta usar **Desconectar** nela ou deixá-la.
- O limite de requisições é em memória, por processo: serve para um container só.
- Fontes: a página carrega a Plus Jakarta Sans do Google Fonts; sem internet, cai na fonte do sistema.
