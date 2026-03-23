import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Conversation from './api/models/Conversation.js';
import Client from './api/models/Client.js';
import { fetchSavedContactName } from './api/services/evolutionService.js';

dotenv.config();

const syncNames = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || '');
    console.log('Connected to MongoDB');

    // Buscar todas as conversas onde o contactName está vazio ou é igual ao número de telefone
    const conversations = await Conversation.find({
      $or: [
        { contactName: '' },
        { contactName: null },
        { $expr: { $eq: ['$contactName', '$contactPhone'] } }
      ]
    });

    console.log(`Encontradas ${conversations.length} conversas para atualizar o nome.`);

    for (const conv of conversations) {
      try {
        const client = await Client.findById(conv.clientId);
        
        if (client?.whatsappInstance?.instanceId && client.whatsappInstance.status === 'connected') {
          console.log(`Buscando nome salvo na agenda para ${conv.contactPhone}...`);
          const fetchedName = await fetchSavedContactName(client.whatsappInstance.instanceId, conv.contactPhone);
          
          if (fetchedName) {
            conv.contactName = fetchedName;
            await conv.save();
            console.log(`✅ Atualizado: ${conv.contactPhone} -> ${fetchedName}`);
          } else {
            console.log(`❌ Nome não encontrado na agenda para: ${conv.contactPhone}`);
          }
        } else {
           console.log(`⚠️ Instância do cliente desconectada ou inválida para a conversa ${conv._id}`);
        }
      } catch (err: any) {
         console.error(`Erro ao atualizar conversa ${conv._id}:`, err.message);
      }
      
      // Pequeno delay para não sobrecarregar a Evolution API
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log('Sincronização finalizada!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

syncNames();