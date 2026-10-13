import axios from 'axios';

const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || 'http://localhost:8080').replace(/\/$/, '');
const EVOLUTION_GLOBAL_API_KEY = process.env.EVOLUTION_GLOBAL_API_KEY || 'global-key';

const evolutionHeaders = () => ({
  apikey: EVOLUTION_GLOBAL_API_KEY,
});

/**
 * URL that Evolution calls for each event. When EVOLUTION_WEBHOOK_TOKEN is set the
 * token is appended so the webhook handler can reject requests that do not carry it.
 */
export const buildEvolutionWebhookUrl = (): string => {
  const base = `${String(process.env.APP_URL || '').replace(/\/$/, '')}/api/webhooks/evolution`;
  const token = String(process.env.EVOLUTION_WEBHOOK_TOKEN || '').trim();
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
};

const formatEvolutionError = (error: any) => {
  const status = error?.response?.status;
  const data = error?.response?.data;
  const message = error?.message;

  if (status || data) {
    return JSON.stringify({ status, data });
  }

  return String(message || 'Unknown error');
};

const extractEvolutionMessage = (data: any): unknown => {
  if (!data) return undefined;
  if (data?.response?.message) return data.response.message;
  if (data?.message) return data.message;
  return undefined;
};

export const createInstance = async (instanceName: string) => {
  try {
    const response = await axios.post(
      `${EVOLUTION_API_URL}/instance/create`,
      {
        instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      },
      {
        headers: {
          ...evolutionHeaders(),
        },
      }
    );
    return response.data;
  } catch (error: any) {
    console.error('Error creating Evolution instance:', error?.response?.data || error?.message);

    const errorMessage = extractEvolutionMessage(error?.response?.data);
    const alreadyInUse =
      (typeof errorMessage === 'string' &&
        (errorMessage.includes('already exists') || errorMessage.includes('already in use'))) ||
      (Array.isArray(errorMessage) &&
        errorMessage.some(
          (msg: string) => msg.includes('already exists') || msg.includes('already in use')
        ));

    if (alreadyInUse) {
      throw new Error('Instance already exists');
    }

    throw new Error(`Failed to create WhatsApp instance: ${formatEvolutionError(error)}`);
  }
};

export const setWebhook = async (instanceName: string, webhookUrl: string) => {
  try {
    const response = await axios.post(
      `${EVOLUTION_API_URL}/webhook/set/${instanceName}`,
      {
        webhook: {
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          webhookBase64: true, // Habilitar base64 para receber mídia como áudios/imagens no webhook
          events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
        },
      },
      {
        headers: {
          ...evolutionHeaders(),
        },
      }
    );
    return response.data;
  } catch (error: any) {
    console.error('Error setting webhook:', error.response?.data || error.message);
    throw new Error(`Failed to set webhook: ${formatEvolutionError(error)}`);
  }
};

export const connectInstance = async (instanceName: string) => {
  try {
    const response = await axios.get(`${EVOLUTION_API_URL}/instance/connect/${instanceName}`, {
      headers: {
        ...evolutionHeaders(),
      },
    });
    return response.data;
  } catch (error: any) {
    console.error('Error connecting instance:', error.response?.data || error.message);
    throw new Error(`Failed to connect instance: ${formatEvolutionError(error)}`);
  }
};

/**
 * Pairing code: lets someone link WhatsApp by typing an 8-character code instead of scanning a QR
 * ("Connect with phone number" in WhatsApp). Needed when the page is opened on the same phone
 * that runs WhatsApp. Returns null when this Evolution version does not provide it.
 */
export const requestPairingCode = async (instanceName: string, phoneDigits: string): Promise<string | null> => {
  try {
    const response = await axios.get(`${EVOLUTION_API_URL}/instance/connect/${instanceName}`, {
      headers: {
        ...evolutionHeaders(),
      },
      params: { number: phoneDigits },
      timeout: 25_000,
    });
    const code = response.data?.pairingCode;
    return typeof code === 'string' && code.trim() ? code.trim() : null;
  } catch (error: any) {
    // never log the phone number
    console.error('Error requesting pairing code:', error?.response?.status, error?.response?.data || error?.message);
    return null;
  }
};

export const getConnectionState = async (instanceName: string) => {
  try {
    const response = await axios.get(
      `${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`,
      {
        headers: {
          ...evolutionHeaders(),
        },
      }
    );
    return response.data;
  } catch (error: any) {
    console.error('Error getting connection state:', error.response?.data || error.message);
    return null;
  }
};

export const logoutInstance = async (instanceName: string) => {
  try {
    await axios.delete(`${EVOLUTION_API_URL}/instance/logout/${instanceName}`, {
      headers: {
        ...evolutionHeaders(),
      },
    });
    return true;
  } catch (error) {
    console.error('Error logging out instance:', error);
    return false;
  }
};

/**
 * Removes the instance from Evolution (it is logged out first so the phone stops listing it
 * under "Linked devices"). An instance that no longer exists counts as removed.
 */
export const deleteInstance = async (instanceName: string): Promise<'deleted' | 'not_found' | 'failed'> => {
  await logoutInstance(instanceName).catch(() => false);

  try {
    await axios.delete(`${EVOLUTION_API_URL}/instance/delete/${instanceName}`, {
      headers: {
        ...evolutionHeaders(),
      },
      timeout: 20_000,
    });
    return 'deleted';
  } catch (error: any) {
    if (error?.response?.status === 404) return 'not_found';
    console.error('Error deleting Evolution instance:', error?.response?.status, error?.response?.data || error?.message);
    return 'failed';
  }
};

export const sendMessage = async (instanceName: string, number: string, text: string) => {
  try {
    const response = await axios.post(
      `${EVOLUTION_API_URL}/message/sendText/${instanceName}`,
      {
        number,
        text,
      },
      {
        headers: {
          ...evolutionHeaders(),
        },
      }
    );
    return response.data;
  } catch (error: any) {
    console.error('Error sending message:', error.response?.data || error.message);
    throw new Error('Failed to send message');
  }
};

export const fetchChatHistory = async (instanceName: string, number: string, limit: number = 50) => {
  try {
    // Busca mensagens da API do chat usando o endpoint da Evolution
    const response = await axios.post(
      `${EVOLUTION_API_URL}/chat/fetchMessages/${instanceName}`,
      {
        where: {
          remoteJid: `${number}@s.whatsapp.net`
        }
      },
      {
        headers: {
          ...evolutionHeaders(),
        },
        params: {
          limit
        }
      }
    );
    return response.data;
  } catch (error: any) {
    console.error('Error fetching chat history:', error.response?.data || error.message);
    // Não estouramos erro aqui para não travar a abertura da tela, apenas logamos
    return [];
  }
};

export const fetchMediaBase64 = async (instanceName: string, messageId: string) => {
  try {
    const response = await axios.post(
      `${EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${instanceName}`,
      {
        message: {
          key: {
            id: messageId
          }
        }
      },
      {
        headers: {
          ...evolutionHeaders(),
        },
      }
    );
    return response.data?.base64;
  } catch (error: any) {
    console.error('Error fetching media base64:', error.response?.data || error.message);
    return null;
  }
};

export const fetchProfileName = async (instanceName: string, number: string) => {
  try {
    const response = await axios.post(
      `${EVOLUTION_API_URL}/chat/fetchProfile/${instanceName}`,
      {
        number
      },
      {
        headers: {
          ...evolutionHeaders(),
        },
      }
    );
    return response.data?.name || null;
  } catch (error: any) {
    console.error('Error fetching profile name:', error.response?.data || error.message);
    return null;
  }
};

export const fetchSavedContactName = async (instanceName: string, number: string) => {
  try {
    // Busca a lista de contatos da instância
    const response = await axios.get(
      `${EVOLUTION_API_URL}/chat/findContacts/${instanceName}`,
      {
        headers: {
          ...evolutionHeaders(),
        },
      }
    );
    
    if (response.data && Array.isArray(response.data)) {
      const contactId = `${number}@s.whatsapp.net`;
      const contact = response.data.find((c: any) => c.id === contactId);
      
      // Retorna o nome salvo na agenda (name) ou o nome público (pushName)
      if (contact) {
        return contact.name || contact.pushName || null;
      }
    }
    return null;
  } catch (error: any) {
    console.error('Error fetching saved contact name:', error.response?.data || error.message);
    return null;
  }
};
