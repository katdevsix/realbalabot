 const fs = require('node:fs');
const path = require('node:path');
const {
  Client,
  ChannelType,
  Events,
  GatewayIntentBits,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
require('dotenv').config();

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  PANEL_CHANNEL_ID,
  REGISTRATION_CHANNEL_ID,
  RANKING_CHANNEL_ID,
  MEMBER_ROLE_ID,
  ORDERS_PANEL_CHANNEL_ID,
  ORDERS_REVIEW_CHANNEL_ID,
  ORDERS_PENDING_CHANNEL_ID,
  SALES_LOG_CHANNEL_ID,
} = process.env;

const FARM_TICKET_PANEL_CHANNEL_ID = '1452781827407216837';
const ELITE_TICKET_PANEL_CHANNEL_ID = '1490871796562399477';
const ANNOUNCEMENT_PANEL_CHANNEL_ID = '1490875725853491210';

// Lista de categorias de farm (múltiplas para superar limite de 50 canais)
const FARM_TICKET_CATEGORY_IDS = [
  '1452781296618049619', // Categoria 1
  '1490373062279827548', // Categoria 2
  // Adicione mais IDs de categorias aqui conforme necessário
];

// Lista de categorias de elite (múltiplas para superar limite de 50 canais)
const ELITE_TICKET_CATEGORY_IDS = [
  '1490867310561595442', // Categoria 1
  // Adicione mais IDs de categorias aqui conforme necessário
];

// Função para encontrar categoria com espaço disponível
async function findAvailableFarmCategory(guild) {
  const channels = await guild.channels.fetch();
  
  for (const categoryId of FARM_TICKET_CATEGORY_IDS) {
    const categoryChannels = channels.filter(
      (c) => c?.type === ChannelType.GuildText && c.parentId === categoryId
    );
    
    if (categoryChannels.size < 50) {
      return categoryId;
    }
  }
  
  return null; // Todas as categorias estão cheias
}

// Função para encontrar categoria de elite com espaço disponível
async function findAvailableEliteCategory(guild) {
  const channels = await guild.channels.fetch();
  
  for (const categoryId of ELITE_TICKET_CATEGORY_IDS) {
    const categoryChannels = channels.filter(
      (c) => c?.type === ChannelType.GuildText && c.parentId === categoryId
    );
    
    if (categoryChannels.size < 50) {
      return categoryId;
    }
  }
  
  return null; // Todas as categorias estão cheias
}

if (!DISCORD_TOKEN) throw new Error('Missing DISCORD_TOKEN in .env');
if (!CLIENT_ID) throw new Error('Missing CLIENT_ID in .env');
if (!PANEL_CHANNEL_ID) throw new Error('Missing PANEL_CHANNEL_ID in .env');
if (!REGISTRATION_CHANNEL_ID) throw new Error('Missing REGISTRATION_CHANNEL_ID in .env');
if (!RANKING_CHANNEL_ID) throw new Error('Missing RANKING_CHANNEL_ID in .env');
if (!MEMBER_ROLE_ID) throw new Error('Missing MEMBER_ROLE_ID in .env');
if (!ORDERS_PANEL_CHANNEL_ID) throw new Error('Missing ORDERS_PANEL_CHANNEL_ID in .env');
if (!ORDERS_REVIEW_CHANNEL_ID) throw new Error('Missing ORDERS_REVIEW_CHANNEL_ID in .env');
if (!ORDERS_PENDING_CHANNEL_ID) throw new Error('Missing ORDERS_PENDING_CHANNEL_ID in .env');
if (!SALES_LOG_CHANNEL_ID) throw new Error('Missing SALES_LOG_CHANNEL_ID in .env');

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

const DATA_DIR = path.join(__dirname, 'data');
const REGISTRATIONS_PATH = path.join(DATA_DIR, 'registrations.json');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const ORDERS_PATH = path.join(DATA_DIR, 'orders.json');
const APPROVALS_PATH = path.join(DATA_DIR, 'approvals.json');

const BRAND_IMAGE_PATH = path.join(__dirname, 'images', 'standard.gif');
const BRAND_IMAGE_NAME = 'standard.gif';

const RANKING_SOURCE_CHANNEL_ID = '1486206528720470148';

let registrationsLock = Promise.resolve();

function withRegistrationsLock(fn) {
  const run = registrationsLock.then(fn, fn);
  registrationsLock = run.catch(() => {});
  return run;
}

function brandingFiles() {
  return [new AttachmentBuilder(BRAND_IMAGE_PATH, { name: BRAND_IMAGE_NAME })];
}

function readJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeRecruiterId(input) {
  const s = String(input ?? '').trim();
  const m = s.match(/^<@!?([0-9]{15,25})>$/);
  if (m) return m[1];
  if (/^[0-9]{15,25}$/.test(s)) return s;
  return null;
}

function recruiterDisplay(recruiterId) {
  return recruiterId ? String(recruiterId) : '-';
}

function readApprovals() {
  return readJson(APPROVALS_PATH, { counts: {} });
}

function writeApprovals(data) {
  writeJson(APPROVALS_PATH, data);
}

function extractApproverIdFromEmbed(embed) {
  const fields = embed?.fields || [];

  const statusField = fields.find((f) => String(f?.name || '').toLowerCase() === 'status');
  const statusText = String(statusField?.value || '').toLowerCase();
  if (statusText && !statusText.includes('aprov')) return null;

  const fieldPairs = fields
    .map((f) => `${String(f?.name || '')}\n${String(f?.value || '')}`)
    .join('\n\n');

  const haystack = [
    String(embed?.title || ''),
    String(embed?.description || ''),
    fieldPairs,
    String(embed?.footer?.text || ''),
    String(embed?.author?.name || ''),
  ].join('\n');

  const dataField = fields.find((f) => String(f?.name || '').toLowerCase() === 'data');
  const dataText = String(dataField?.value || '');
  let m = dataText.match(/—\s*<@!?([0-9]{15,25})>/);
  if (m) return m[1];

  m = haystack.match(/—\s*<@!?([0-9]{15,25})>/);
  if (m) return m[1];

  const namedField = fields.find((f) => /aprov|aceit|instrutor|gerent|respons|aprovador/i.test(String(f?.name || '')));
  if (namedField) {
    const v = String(namedField?.value || '');
    const mm = v.match(/<@!?([0-9]{15,25})>/g);
    if (mm?.length) {
      const last = mm[mm.length - 1].match(/<@!?([0-9]{15,25})>/);
      if (last) return last[1];
    }
  }

  const all = haystack.match(/<@!?([0-9]{15,25})>/g);
  if (all?.length) {
    const last = all[all.length - 1].match(/<@!?([0-9]{15,25})>/);
    if (last) return last[1];
  }

  return null;
}

function buildPanelMessage() {
  const embed = new EmbedBuilder()
    .setTitle('Registro de membro')
    .setDescription('Clique no botão abaixo para se registrar.')
    .setImage(`attachment://${BRAND_IMAGE_NAME}`)
    .setFooter({ text: '© RealBala - Kat' })
    .setColor(0x2b2d31);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_registration_modal')
      .setEmoji('<a:_carregando_3_:1486358648027480235>')
      .setLabel('Registrar')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row], files: brandingFiles() };
}

function buildEliteTicketPanelMessage() {
  const embed = new EmbedBuilder()
    .setTitle('Registro de farm da Elite')
    .setDescription('Crie sua pasta de farm.')
    .setImage(`attachment://${BRAND_IMAGE_NAME}`)
    .setFooter({ text: '© RealBala - Kat' })
    .setColor(0x2b2d31);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_elite_ticket')
      .setLabel('Abrir')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row], files: brandingFiles() };
}

function buildAnnouncementPanelMessage() {
  const embed = new EmbedBuilder()
    .setTitle('📢 Sistema de Anúncios')
    .setDescription('Clique no botão abaixo para enviar um aviso importante para todos os membros do servidor.')
    .addFields(
      { name: '📤 Como funciona', value: 'Ao clicar, você poderá digitar sua mensagem e o bot enviará para todos os membros via DM.', inline: false },
      { name: '⚠️ Importante', value: 'Use com responsabilidade. Todos os membros receberão sua mensagem.', inline: false }
    )
    .setImage(`attachment://${BRAND_IMAGE_NAME}`)
    .setFooter({ text: '© RealBala - Kat' })
    .setColor(0x2b2d31);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_announcement_modal')
      .setLabel('Enviar Anúncio')
      .setEmoji('📢')
      .setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row], files: brandingFiles() };
}

function buildFarmTicketPanelMessage() {
  const embed = new EmbedBuilder()
    .setTitle('Pasta de Farm')
    .setDescription('Crie sua pasta de farm.')
    .setImage(`attachment://${BRAND_IMAGE_NAME}`)
    .setFooter({ text: '© RealBala - Kat' })
    .setColor(0x2b2d31);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_farm_ticket')
      .setLabel('Abrir')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row], files: brandingFiles() };
}

async function upsertPanelMessage(client) {
  const state = readJson(STATE_PATH, { rankingMessageId: null, panelMessageId: null, orderPanelMessageId: null, farmTicketPanelMessageId: null });
  const channel = await client.channels.fetch(PANEL_CHANNEL_ID);
  if (!channel?.isTextBased?.()) throw new Error('PANEL_CHANNEL_ID is not a text channel');

   const payload = buildPanelMessage();

   if (state.panelMessageId) {
     try {
       const msg = await channel.messages.fetch(state.panelMessageId);
       await msg.edit(payload);
       return;
     } catch {
       state.panelMessageId = null;
       writeJson(STATE_PATH, state);
     }
   }

  const sent = await channel.send(payload);
  state.panelMessageId = sent.id;
  writeJson(STATE_PATH, state);
}

 async function upsertFarmTicketPanelMessage(client) {
   const state = readJson(STATE_PATH, { rankingMessageId: null, panelMessageId: null, orderPanelMessageId: null, farmTicketPanelMessageId: null });
   const channel = await client.channels.fetch(FARM_TICKET_PANEL_CHANNEL_ID);
   if (!channel?.isTextBased?.()) throw new Error('FARM_TICKET_PANEL_CHANNEL_ID is not a text channel');

   const payload = buildFarmTicketPanelMessage();

   if (state.farmTicketPanelMessageId) {
     try {
       const msg = await channel.messages.fetch(state.farmTicketPanelMessageId);
       await msg.edit(payload);
       return;
     } catch {
       state.farmTicketPanelMessageId = null;
       writeJson(STATE_PATH, state);
     }
   }

   const sent = await channel.send(payload);
   state.farmTicketPanelMessageId = sent.id;
   writeJson(STATE_PATH, state);
}

async function upsertEliteTicketPanelMessage(client) {
  const state = readJson(STATE_PATH, { rankingMessageId: null, panelMessageId: null, orderPanelMessageId: null, farmTicketPanelMessageId: null, eliteTicketPanelMessageId: null });
  const channel = await client.channels.fetch(ELITE_TICKET_PANEL_CHANNEL_ID);
  if (!channel?.isTextBased?.()) throw new Error('ELITE_TICKET_PANEL_CHANNEL_ID is not a text channel');

  const payload = buildEliteTicketPanelMessage();

  if (state.eliteTicketPanelMessageId) {
    try {
      const msg = await channel.messages.fetch(state.eliteTicketPanelMessageId);
      await msg.edit(payload);
      return;
    } catch {
      state.eliteTicketPanelMessageId = null;
      writeJson(STATE_PATH, state);
    }
  }

  const sent = await channel.send(payload);
  state.eliteTicketPanelMessageId = sent.id;
  writeJson(STATE_PATH, state);
}

async function upsertAnnouncementPanelMessage(client) {
  console.log(`📢 Tentando configurar painel de anúncio no canal ${ANNOUNCEMENT_PANEL_CHANNEL_ID}...`);
  
  const state = readJson(STATE_PATH, { rankingMessageId: null, panelMessageId: null, orderPanelMessageId: null, farmTicketPanelMessageId: null, eliteTicketPanelMessageId: null, announcementPanelMessageId: null });
  
  try {
    const channel = await client.channels.fetch(ANNOUNCEMENT_PANEL_CHANNEL_ID);
    if (!channel?.isTextBased?.()) {
      console.error(`❌ Canal ${ANNOUNCEMENT_PANEL_CHANNEL_ID} não é um canal de texto ou não existe`);
      throw new Error('ANNOUNCEMENT_PANEL_CHANNEL_ID is not a text channel');
    }
    
    console.log(`✅ Canal ${channel.name} encontrado e é um canal de texto`);

    const payload = buildAnnouncementPanelMessage();

    if (state.announcementPanelMessageId) {
      try {
        const msg = await channel.messages.fetch(state.announcementPanelMessageId);
        await msg.edit(payload);
        console.log('✅ Painel de anúncio atualizado com sucesso');
        return;
      } catch {
        state.announcementPanelMessageId = null;
        writeJson(STATE_PATH, state);
      }
    }

    const sent = await channel.send(payload);
    state.announcementPanelMessageId = sent.id;
    writeJson(STATE_PATH, state);
    console.log('✅ Painel de anúncio criado com sucesso');
    
  } catch (error) {
    console.error('❌ Erro ao configurar painel de anúncio:', error);
    throw error;
  }
}

function buildRegistrationEmbed(reg) {
  const decidedBy = reg.decidedBy ? `<@${reg.decidedBy}>` : '-';
  const statusText = reg.status === 'approved' ? 'Aprovado' : reg.status === 'rejected' ? 'Recusado' : 'Pendente';

  return new EmbedBuilder()
    .setTitle('Novo registro')
    .setColor(0x57f287)
    .setImage(`attachment://${BRAND_IMAGE_NAME}`)
    .setFooter({ text: '© RealBala - Kat' })
    .addFields(
      { name: 'Usuário', value: `<@${reg.discordUserId}>`, inline: true },
      { name: 'ID (informado)', value: String(reg.userIdProvided || '-'), inline: true },
      { name: 'Nome', value: String(reg.name || '-'), inline: false },
      { name: 'Telefone', value: String(reg.phone || '-'), inline: true },
      { name: 'Recrutador', value: recruiterDisplay(reg.recruiterId), inline: true },
      { name: 'Status', value: statusText, inline: true },
      {
        name: 'Data',
        value: `${`<t:${Math.floor(new Date(reg.createdAt).getTime() / 1000)}:f>`}${reg.status && reg.status !== 'pending' ? ` — ${decidedBy}` : ''}`,
        inline: false,
      }
    );
}

function buildRegistrationActions(reg) {
  if (reg.status && reg.status !== 'pending') return [];
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`reg_accept:${reg.id}`)
      .setLabel('Aceitar')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`reg_reject:${reg.id}`)
      .setLabel('Recusar')
      .setStyle(ButtonStyle.Danger)
  );
  return [row];
}

function computeRanking(registrations) {
  const approvals = readApprovals();
  const countsObj = approvals?.counts && typeof approvals.counts === 'object' ? approvals.counts : {};

  return Object.entries(countsObj)
    .map(([userId, total]) => [userId, Number(total) || 0])
    .filter(([, total]) => total > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([recruiterId, total]) => ({ recruiterId, total }));
}

function buildRankingEmbed(ranking) {
  const embed = new EmbedBuilder()
    .setTitle('Ranking de aprovações')
    .setColor(0x5865f2)
    .setImage(`attachment://${BRAND_IMAGE_NAME}`)
    .setFooter({ text: '© RealBala - Kat' });

  if (!ranking.length) {
    embed.setDescription('Ainda não há aprovações.');
    return embed;
  }

  const lines = ranking
    .slice(0, 20)
    .map((x, i) => `${i + 1}. <@${x.recruiterId}> — **${x.total}**`);
  embed.setDescription(lines.join('\n'));
  return embed;
}

async function upsertRankingMessage(client) {
  const registrations = readJson(REGISTRATIONS_PATH, []);
  const ranking = computeRanking(registrations);
  const embed = buildRankingEmbed(ranking);

  const state = readJson(STATE_PATH, { rankingMessageId: null, panelMessageId: null, orderPanelMessageId: null, farmTicketPanelMessageId: null });
  const channel = await client.channels.fetch(RANKING_CHANNEL_ID);
  if (!channel?.isTextBased?.()) throw new Error('RANKING_CHANNEL_ID is not a text channel');

  if (state.rankingMessageId) {
    try {
      const msg = await channel.messages.fetch(state.rankingMessageId);
      await msg.edit({ embeds: [embed], components: [], files: brandingFiles() });
      return;
    } catch {
      state.rankingMessageId = null;
      writeJson(STATE_PATH, state);
    }
  }

  const sent = await channel.send({ embeds: [embed], components: [], files: brandingFiles() });
  state.rankingMessageId = sent.id;
  writeJson(STATE_PATH, state);
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('painel-registro')
      .setDescription('Posta o painel de registro (embed com botão).'),
    new SlashCommandBuilder()
      .setName('painel-encomenda')
      .setDescription('Posta o painel de encomendas (embed com botão).'),
    new SlashCommandBuilder()
      .setName('painel-farm')
      .setDescription('Posta o painel da Pasta de Farm (ticket).'),
    new SlashCommandBuilder()
      .setName('painel-elite')
      .setDescription('Posta o painel da Pasta de Elite (ticket).'),
    new SlashCommandBuilder()
      .setName('anunciar')
      .setDescription('Envia mensagem de aviso importante para todos os membros.')
      .addStringOption(option =>
        option.setName('mensagem')
          .setDescription('Mensagem a ser enviada após o título')
          .setRequired(true)),
    new SlashCommandBuilder()
      .setName('rebuild-ranking')
      .setDescription('Reconstroi o ranking varrendo o canal histórico configurado.'),
  ].map((c) => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

function buildOrdersPanelMessage() {
  const embed = new EmbedBuilder()
    .setTitle('Criar encomenda')
    .setDescription('Clique no botão abaixo para criar uma encomenda.')
    .setImage(`attachment://${BRAND_IMAGE_NAME}`)
    .setFooter({ text: '© RealBala - Kat' })
    .setColor(0x2b2d31);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_order_modal')
      .setEmoji('<a:_carregando_3_:1486358648027480235>')
      .setLabel('Criar encomenda')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row], files: brandingFiles() };
}

async function upsertOrdersPanelMessage(client) {
  const state = readJson(STATE_PATH, { rankingMessageId: null, panelMessageId: null, orderPanelMessageId: null, farmTicketPanelMessageId: null });
  const channel = await client.channels.fetch(ORDERS_PANEL_CHANNEL_ID);
  if (!channel?.isTextBased?.()) throw new Error('ORDERS_PANEL_CHANNEL_ID is not a text channel');

  const payload = buildOrdersPanelMessage();

  if (state.orderPanelMessageId) {
    try {
      const msg = await channel.messages.fetch(state.orderPanelMessageId);
      await msg.edit(payload);
      return;
    } catch {
      state.orderPanelMessageId = null;
      writeJson(STATE_PATH, state);
    }
  }

  const sent = await channel.send(payload);
  state.orderPanelMessageId = sent.id;
  writeJson(STATE_PATH, state);
}

function buildOrderEmbed(order) {
  const statusText = order.status === 'accepted' ? 'Aceita' : order.status === 'rejected' ? 'Recusada' : order.status === 'delivered' ? 'Entregue' : 'Pendente';
  const responsible = order.responsibleId ? `<@${order.responsibleId}>` : '-';
  const createdBy = order.createdBy ? `<@${order.createdBy}>` : '-';
  const customerName = String(order.customerName || '-');
  const customerContact = String(order.contact || '-');
  const createdAt = order.createdAt ? `<t:${Math.floor(new Date(order.createdAt).getTime() / 1000)}:f>` : '-';
  const decidedBy = order.decidedBy ? `<@${order.decidedBy}>` : '-';

  return new EmbedBuilder()
    .setTitle('Encomenda')
    .setColor(order.status === 'accepted' ? 0x57f287 : order.status === 'rejected' ? 0xed4245 : order.status === 'delivered' ? 0xfee75c : 0x5865f2)
    .setImage(`attachment://${BRAND_IMAGE_NAME}`)
    .setFooter({ text: '© RealBala - Kat' })
    .addFields(
      { name: 'Cliente', value: customerName, inline: true },
      { name: 'Contato', value: customerContact, inline: true },
      { name: 'Data', value: String(order.date || '-'), inline: true },

      { name: 'Fac', value: String(order.fac || '-'), inline: true },
      { name: 'Produto', value: String(order.product || '-'), inline: true },
      { name: 'Entrega', value: String(order.delivery || '-'), inline: true },

      { name: 'Status', value: statusText, inline: true },
      { name: 'Criado por', value: createdBy, inline: true },
      { name: 'Responsável', value: responsible, inline: true },
      { name: 'Registro', value: `${createdAt}${order.status !== 'pending' ? ` — ${decidedBy}` : ''}`, inline: false }
    );
}

function buildOrderReviewActions(order) {
  if (order.status && order.status !== 'pending') return [];
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`order_accept:${order.id}`).setLabel('Aceitar').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`order_reject:${order.id}`).setLabel('Recusar').setStyle(ButtonStyle.Danger)
  );
  return [row];
}

function buildOrderPendingActions(order) {
  if (order.status !== 'accepted') return [];
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`order_delivered:${order.id}`).setLabel('Entregue').setStyle(ButtonStyle.Primary)
  );
  return [row];
}

 function buildOrderText(order) {
   const createdAt = order.createdAt ? `<t:${Math.floor(new Date(order.createdAt).getTime() / 1000)}:f>` : '-';
   const customer = order.customerName ? `**Cliente:** ${order.customerName}` : '**Cliente:** -';
   const contact = order.contact ? `**Contato:** ${order.contact}` : '**Contato:** -';
   const date = order.date ? `**Data:** ${order.date}` : '**Data:** -';
   const fac = order.fac ? `**Fac:** ${order.fac}` : '**Fac:** -';
   const product = order.product ? `**Produto:** ${order.product}` : '**Produto:** -';
   const delivery = order.delivery ? `**Entrega:** ${order.delivery}` : '**Entrega:** -';
   const createdBy = order.createdBy ? `**Criado por:** <@${order.createdBy}>` : '**Criado por:** -';
   const responsible = order.responsibleId ? `**Responsável:** <@${order.responsibleId}>` : '**Responsável:** -';

   return [
     '**ENCOMENDA**',
     `${customer} | ${contact}`,
     `${date} | ${fac}`,
     product,
     delivery,
     createdBy,
     responsible,
     `**Registro:** ${createdAt}`,
   ].join('\n');
 }

client.once(Events.ClientReady, async () => {
  console.log('🤖 Bot iniciado, começando a configurar painéis...');
  
  try {
    await registerCommands();
    console.log('✅ Comandos registrados');
    
    await upsertPanelMessage(client);
    console.log('✅ Painel de registro criado');
    
    await upsertOrdersPanelMessage(client);
    console.log('✅ Painel de encomendas criado');
    
    await upsertFarmTicketPanelMessage(client);
    console.log('✅ Painel de farm criado');
    
    await upsertEliteTicketPanelMessage(client);
    console.log('✅ Painel de elite criado');
    
    await upsertAnnouncementPanelMessage(client);
    console.log('✅ Painel de anúncio criado');
    
    await upsertRankingMessage(client);
    console.log('✅ Ranking atualizado');
    
    console.log('🎉 Todos os painéis foram configurados com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao configurar painéis:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'painel-registro') {
        await upsertPanelMessage(client);
        await interaction.reply({ content: 'Painel atualizado no canal configurado.', ephemeral: true });
      }
      if (interaction.commandName === 'painel-encomenda') {
        await upsertOrdersPanelMessage(client);
        await interaction.reply({ content: 'Painel de encomendas atualizado no canal configurado.', ephemeral: true });
      }
      if (interaction.commandName === 'painel-farm') {
        await upsertFarmTicketPanelMessage(client);
        await interaction.reply({ content: 'Painel da Pasta de Farm atualizado no canal configurado.', ephemeral: true });
      }
      if (interaction.commandName === 'painel-elite') {
        await upsertEliteTicketPanelMessage(client);
        await interaction.reply({ content: 'Painel da Pasta de Elite atualizado no canal configurado.', ephemeral: true });
      }
      if (interaction.commandName === 'anunciar') {
        await interaction.deferReply({ ephemeral: true });
        
        if (!interaction.inGuild()) {
          await interaction.editReply({ content: 'Essa ação só funciona dentro do servidor.' });
          return;
        }

        const userMessage = interaction.options.getString('mensagem');
        const message = `📢 **Aviso Importante**

${userMessage}`;
        const guild = interaction.guild;
        
        await interaction.editReply({ content: '📤 Enviando mensagem para todos os membros...' });
        
        try {
          const members = await guild.members.fetch();
          let successCount = 0;
          let failCount = 0;
          
          for (const member of members.values()) {
            if (member.user.bot) continue; // Pula bots
            
            try {
              await member.send(message);
              successCount++;
              // Pequeno delay para não atingir rate limits
              if (successCount % 10 === 0) {
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            } catch (error) {
              failCount++;
              console.log(`Falha ao enviar para ${member.user.tag}: ${error.message}`);
            }
          }
          
          await interaction.editReply({ 
            content: `✅ **Anúncio enviado com sucesso!**\n\n📊 **Estatísticas:**\n✅ Enviados: ${successCount}\n❌ Falhas: ${failCount}\n👥 Total de membros: ${members.size - [...members.values()].filter(m => m.user.bot).length}` 
          });
          
        } catch (error) {
          console.error('Erro ao buscar membros:', error);
          await interaction.editReply({ content: '❌ Ocorreu um erro ao buscar os membros do servidor.' });
        }
      }
      if (interaction.commandName === 'rebuild-ranking') {
        await interaction.deferReply({ ephemeral: true });

        if (!interaction.inGuild()) {
          await interaction.editReply({ content: 'Essa ação só funciona dentro do servidor.' });
          return;
        }

        const sourceChannel = await client.channels.fetch(RANKING_SOURCE_CHANNEL_ID);
        if (!sourceChannel?.isTextBased?.()) throw new Error('RANKING_SOURCE_CHANNEL_ID is not a text channel');

        const counts = {};
        let before;
        let scanned = 0;

        while (true) {
          const batch = await sourceChannel.messages.fetch({ limit: 100, before });
          if (!batch.size) break;

          for (const msg of batch.values()) {
            scanned += 1;
            const embeds = msg.embeds || [];
            for (const e of embeds) {
              const userId = extractApproverIdFromEmbed(e);
              if (!userId) continue;
              counts[userId] = (counts[userId] || 0) + 1;
            }
          }

          before = batch.last()?.id;
        }

        writeApprovals({ counts, rebuiltAt: new Date().toISOString(), scannedMessages: scanned, sourceChannelId: RANKING_SOURCE_CHANNEL_ID });
        await upsertRankingMessage(client);
        await interaction.editReply({ content: `Ranking reconstruído. Mensagens lidas: ${scanned}. Pessoas no ranking: ${Object.keys(counts).length}.` });
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'open_registration_modal') {
        const modal = new ModalBuilder().setCustomId('registration_modal').setTitle('Registro');

        const nameInput = new TextInputBuilder()
          .setCustomId('name')
          .setLabel('Nome do usuário')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(64);

        const userIdInput = new TextInputBuilder()
          .setCustomId('user_id')
          .setLabel('ID (informado)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(64);

        const phoneInput = new TextInputBuilder()
          .setCustomId('phone')
          .setLabel('Número de telefone')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(32);

        const recruiterInput = new TextInputBuilder()
          .setCustomId('recruiter_id')
          .setLabel('ID do recrutador (ID ou @menção)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(64);

        modal.addComponents(
          new ActionRowBuilder().addComponents(nameInput),
          new ActionRowBuilder().addComponents(userIdInput),
          new ActionRowBuilder().addComponents(phoneInput),
          new ActionRowBuilder().addComponents(recruiterInput)
        );

        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === 'open_farm_ticket') {
        await interaction.deferReply({ ephemeral: true });
        if (!interaction.inGuild()) {
          await interaction.editReply({ content: 'Essa ação só funciona dentro do servidor.' });
          return;
        }

        const channels = await interaction.guild.channels.fetch();
        
        // Verificar se já tem um ticket aberto em qualquer categoria de farm
        const existing = channels.find(
          (c) =>
            c?.type === ChannelType.GuildText &&
            FARM_TICKET_CATEGORY_IDS.includes(c.parentId) &&
            c.topic === `farm-ticket:${interaction.user.id}`
        );

        if (existing) {
          await interaction.editReply({ content: `Sua Pasta de Farm já está aberta: <#${existing.id}>` });
          return;
        }

        // Encontrar categoria com espaço disponível
        const availableCategory = await findAvailableFarmCategory(interaction.guild);
        
        if (!availableCategory) {
          await interaction.editReply({ 
            content: '⚠️ Todas as categorias de Farm atingiram o limite de 50 canais do Discord. Por favor, peça a um administrador para:\n\n1. Deletar tickets antigos/inativos\n2. Ou adicionar uma nova categoria de farm no código' 
          });
          return;
        }

        const base = (interaction.user.username || 'usuario')
          .toLowerCase()
          .replace(/[^a-z0-9-_]/g, '-')
          .slice(0, 20);
        const channelName = `farm-${base}-${interaction.user.id.slice(-4)}`;

        const created = await interaction.guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: availableCategory,
          topic: `farm-ticket:${interaction.user.id}`,
          permissionOverwrites: [
            {
              id: interaction.guild.roles.everyone.id,
              deny: [PermissionsBitField.Flags.ViewChannel],
            },
            {
              id: interaction.user.id,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
              ],
            },
            {
              id: client.user.id,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.ManageChannels,
                PermissionsBitField.Flags.ManageMessages,
              ],
            },
          ],
        });

        await created.send({
          content:
            `<@${interaction.user.id}> sua Pasta de Farm foi aberta.\n\n` +
            `**Seguir Modelo**\n\n` +
            `-  item que farmou:\n` +
            `- quantidade:\n` +
            `- dia e horas:\n` +
            `- print com data e hora\n\n` +
            `Caso não consiga tirar print  enviar pra gerencia mas deixar claro aqui no canal e mencionar o gerente. Quais quer outra informação deixar explicado aqui.`,
        });

        await interaction.editReply({ content: `Ticket criado: <#${created.id}>` });
        return;
      }

      if (interaction.customId === 'open_elite_ticket') {
        await interaction.deferReply({ ephemeral: true });
        if (!interaction.inGuild()) {
          await interaction.editReply({ content: 'Essa ação só funciona dentro do servidor.' });
          return;
        }

        const channels = await interaction.guild.channels.fetch();
        
        // Verificar se já tem um ticket aberto em qualquer categoria de elite
        const existing = channels.find(
          (c) =>
            c?.type === ChannelType.GuildText &&
            ELITE_TICKET_CATEGORY_IDS.includes(c.parentId) &&
            c.topic === `elite-ticket:${interaction.user.id}`
        );

        if (existing) {
          await interaction.editReply({ content: `Sua Pasta de Elite já está aberta: <#${existing.id}>` });
          return;
        }

        // Encontrar categoria com espaço disponível
        const availableCategory = await findAvailableEliteCategory(interaction.guild);
        
        if (!availableCategory) {
          await interaction.editReply({ 
            content: '⚠️ Todas as categorias de Elite atingiram o limite de 50 canais do Discord. Por favor, peça a um administrador para:\n\n1. Deletar tickets antigos/inativos\n2. Ou adicionar uma nova categoria de elite no código' 
          });
          return;
        }

        const base = (interaction.user.username || 'usuario')
          .toLowerCase()
          .replace(/[^a-z0-9-_]/g, '-')
          .slice(0, 20);
        const channelName = `elite-${base}-${interaction.user.id.slice(-4)}`;

        const created = await interaction.guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: availableCategory,
          topic: `elite-ticket:${interaction.user.id}`,
          permissionOverwrites: [
            {
              id: interaction.guild.roles.everyone.id,
              deny: [PermissionsBitField.Flags.ViewChannel],
            },
            {
              id: interaction.user.id,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
              ],
            },
            {
              id: client.user.id,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.ManageChannels,
                PermissionsBitField.Flags.ManageMessages,
              ],
            },
          ],
        });

        await created.send({
          content:
            `<@${interaction.user.id}> sua Pasta de Elite foi aberta.\n\n` +
            `**Seguir Modelo**\n\n` +
            `-  item que farmou:\n` +
            `- quantidade:\n` +
            `- dia e horas:\n` +
            `- print com data e hora\n\n` +
            `Caso não consiga tirar print  enviar pra gerencia mas deixar claro aqui no canal e mencionar o gerente. Quais quer outra informação deixar explicado aqui.`,
        });

        await interaction.editReply({ content: `Ticket criado: <#${created.id}>` });
        return;
      }

      if (interaction.customId === 'open_announcement_modal') {
        const modal = new ModalBuilder().setCustomId('announcement_modal').setTitle('Enviar Anúncio');

        const messageInput = new TextInputBuilder()
          .setCustomId('announcement_message')
          .setLabel('Mensagem do anúncio')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
          .setPlaceholder('Digite sua mensagem aqui...');

        modal.addComponents(
          new ActionRowBuilder().addComponents(messageInput)
        );

        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === 'open_order_modal') {
        const modal = new ModalBuilder().setCustomId('order_modal').setTitle('Criar encomenda');

        const dateInput = new TextInputBuilder()
          .setCustomId('order_date')
          .setLabel('Data')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(64);

        const facInput = new TextInputBuilder()
          .setCustomId('order_fac')
          .setLabel('Fac')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(64);

        const productInput = new TextInputBuilder()
          .setCustomId('order_product')
          .setLabel('Produto')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(128);

        const deliveryInput = new TextInputBuilder()
          .setCustomId('order_delivery')
          .setLabel('Entrega')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(400);

        const contactInput = new TextInputBuilder()
          .setCustomId('order_contact')
          .setLabel('Contato (telefone/discord/etc)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(64);

        modal.addComponents(
          new ActionRowBuilder().addComponents(dateInput),
          new ActionRowBuilder().addComponents(facInput),
          new ActionRowBuilder().addComponents(productInput),
          new ActionRowBuilder().addComponents(deliveryInput),
          new ActionRowBuilder().addComponents(contactInput)
        );

        await interaction.showModal(modal);
        return;
      }

      if (
        interaction.customId.startsWith('order_accept:') ||
        interaction.customId.startsWith('order_reject:') ||
        interaction.customId.startsWith('order_delivered:')
      ) {
        await interaction.deferReply({ ephemeral: true });
        if (!interaction.inGuild()) {
          await interaction.editReply({ content: 'Essa ação só funciona dentro do servidor.' });
          return;
        }

        const orders = readJson(ORDERS_PATH, []);
        const [action, orderId] = interaction.customId.split(':');
        const idx = orders.findIndex((o) => o?.id === orderId);
        if (idx === -1) {
          await interaction.editReply({ content: 'Encomenda não encontrada.' });
          return;
        }

        const order = orders[idx];
        const me = await interaction.guild.members.fetchMe();
        if (!me.permissions.has('ManageMessages')) {
          throw new Error('Bot missing permission: ManageMessages');
        }

        if (action === 'order_accept') {
          if (order.status !== 'pending') {
            await interaction.editReply({ content: 'Essa encomenda já foi analisada.' });
            return;
          }
          order.status = 'accepted';
          order.responsibleId = interaction.user.id;
          order.decidedBy = interaction.user.id;
          order.decidedAt = new Date().toISOString();
          orders[idx] = order;
          writeJson(ORDERS_PATH, orders);

          const pendingChannel = await client.channels.fetch(ORDERS_PENDING_CHANNEL_ID);
          if (!pendingChannel?.isTextBased?.()) throw new Error('ORDERS_PENDING_CHANNEL_ID is not a text channel');
          const pendingMsg = await pendingChannel.send({
            embeds: [buildOrderEmbed(order)],
            components: buildOrderPendingActions(order),
            files: brandingFiles(),
          });
          order.pendingMessageId = pendingMsg.id;
          orders[idx] = order;
          writeJson(ORDERS_PATH, orders);

          if (order.reviewMessageId) {
            try {
              const reviewChannel = await client.channels.fetch(ORDERS_REVIEW_CHANNEL_ID);
              if (reviewChannel?.isTextBased?.()) {
                const msg = await reviewChannel.messages.fetch(order.reviewMessageId);
                await msg.delete();
              }
            } catch {
              // ignore
            }
          }

          try {
            await interaction.message.delete();
          } catch {
            try {
              await interaction.message.edit({ components: [] });
            } catch {
              // ignore
            }
          }

          await interaction.editReply({ content: 'Encomenda aceita e enviada para pendentes de entrega.' });
          return;
        }

        if (action === 'order_reject') {
          if (order.status !== 'pending') {
            await interaction.editReply({ content: 'Essa encomenda já foi analisada.' });
            return;
          }
          order.status = 'rejected';
          order.decidedBy = interaction.user.id;
          order.decidedAt = new Date().toISOString();
          orders[idx] = order;
          writeJson(ORDERS_PATH, orders);

          if (order.reviewMessageId) {
            try {
              const reviewChannel = await client.channels.fetch(ORDERS_REVIEW_CHANNEL_ID);
              if (reviewChannel?.isTextBased?.()) {
                const msg = await reviewChannel.messages.fetch(order.reviewMessageId);
                await msg.delete();
              }
            } catch {
              // ignore
            }
          }

          try {
            await interaction.message.delete();
          } catch {
            try {
              await interaction.message.edit({ components: [] });
            } catch {
              // ignore
            }
          }

          await interaction.editReply({ content: 'Encomenda recusada.' });
          return;
        }

        if (action === 'order_delivered') {
          if (order.status !== 'accepted') {
            await interaction.editReply({ content: 'Essa encomenda não está em estado de pendente.' });
            return;
          }
          order.status = 'delivered';
          order.deliveredBy = interaction.user.id;
          order.deliveredAt = new Date().toISOString();
          orders[idx] = order;
          writeJson(ORDERS_PATH, orders);

          const salesChannel = await client.channels.fetch(SALES_LOG_CHANNEL_ID);
          if (!salesChannel?.isTextBased?.()) throw new Error('SALES_LOG_CHANNEL_ID is not a text channel');
          await salesChannel.send({ embeds: [buildOrderEmbed(order)], files: brandingFiles() });

          if (order.pendingMessageId) {
            try {
              const pendingChannel = await client.channels.fetch(ORDERS_PENDING_CHANNEL_ID);
              if (pendingChannel?.isTextBased?.()) {
                const msg = await pendingChannel.messages.fetch(order.pendingMessageId);
                await msg.delete();
              }
            } catch {
              // ignore
            }
          }

          try {
            await interaction.message.delete();
          } catch {
            try {
              await interaction.message.edit({ components: [] });
            } catch {
              // ignore
            }
          }

          await interaction.editReply({ content: 'Encomenda marcada como entregue e registrada em vendas.' });
          return;
        }

        await interaction.editReply({ content: 'Ação inválida.' });
        return;
      }

      if (interaction.customId.startsWith('reg_accept:') || interaction.customId.startsWith('reg_reject:')) {
        const isAccept = interaction.customId.startsWith('reg_accept:');
        const regId = interaction.customId.split(':')[1];

        await interaction.deferReply({ ephemeral: true });

        if (!interaction.inGuild()) {
          await interaction.editReply({ content: 'Essa ação só funciona dentro do servidor.' });
          return;
        }

        const result = await withRegistrationsLock(async () => {
          const registrations = readJson(REGISTRATIONS_PATH, []);
          const idx = registrations.findIndex((r) => r?.id === regId);
          if (idx === -1) return { kind: 'not_found' };

          const reg = registrations[idx];
          if (reg.status && reg.status !== 'pending') return { kind: 'already_done' };

          reg.status = isAccept ? 'approved' : 'rejected';
          reg.decidedAt = new Date().toISOString();
          reg.decidedBy = interaction.user.id;

          registrations[idx] = reg;
          writeJson(REGISTRATIONS_PATH, registrations);

          if (isAccept) {
            const approvals = readApprovals();
            const counts = approvals?.counts && typeof approvals.counts === 'object' ? approvals.counts : {};
            counts[interaction.user.id] = (counts[interaction.user.id] || 0) + 1;
            writeApprovals({ ...approvals, counts });
          }

          await upsertRankingMessage(client);

          return { kind: 'ok', reg };
        });

        if (result.kind === 'not_found') {
          await interaction.editReply({ content: 'Registro não encontrado.' });
          return;
        }
        if (result.kind === 'already_done') {
          await interaction.editReply({ content: 'Esse registro já foi analisado.' });
          return;
        }

        const reg = result.reg;

        const me = await interaction.guild.members.fetchMe();
        if (!me.permissions.has('ManageNicknames')) throw new Error('Bot missing permission: ManageNicknames');
        if (!me.permissions.has('ManageRoles')) throw new Error('Bot missing permission: ManageRoles');

        if (isAccept) {
          try {
            const member = await interaction.guild.members.fetch(reg.discordUserId);
            const nickname = `${reg.userIdProvided} | ${reg.name}`.slice(0, 32);
            await member.setNickname(nickname);
            await member.roles.add(MEMBER_ROLE_ID);
          } catch (e) {
            throw new Error(`Falha ao aprovar (apelido/cargo). Verifique permissões e hierarquia de cargos. Detalhe: ${e?.message || e}`);
          }
        }

        const embed = buildRegistrationEmbed(reg);
        await interaction.message.edit({ embeds: [embed], components: [], files: brandingFiles() });
        await interaction.editReply({ content: isAccept ? 'Registro aprovado.' : 'Registro recusado.' });
        return;
      }

      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'announcement_modal') {
        const userMessage = interaction.fields.getTextInputValue('announcement_message')?.trim();
        const message = `📢 **Aviso Importante**\n\n${userMessage}`;
        
        await interaction.reply({ content: '📤 Enviando mensagem para todos os membros...', ephemeral: true });
        
        try {
          const guild = interaction.guild;
          const members = await guild.members.fetch();
          let successCount = 0;
          let failCount = 0;
          
          for (const member of members.values()) {
            if (member.user.bot) continue; // Pula bots
            
            try {
              await member.send(message);
              successCount++;
              // Pequeno delay para não atingir rate limits
              if (successCount % 10 === 0) {
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            } catch (error) {
              failCount++;
              console.log(`Falha ao enviar para ${member.user.tag}: ${error.message}`);
            }
          }
          
          await interaction.editReply({ 
            content: `✅ **Anúncio enviado com sucesso!**\n\n📊 **Estatísticas:**\n✅ Enviados: ${successCount}\n❌ Falhas: ${failCount}\n👥 Total de membros: ${members.size - [...members.values()].filter(m => m.user.bot).length}` 
          });
          
        } catch (error) {
          console.error('Erro ao buscar membros:', error);
          await interaction.editReply({ content: '❌ Ocorreu um erro ao buscar os membros do servidor.', ephemeral: true });
        }
      }
      
      if (interaction.customId === 'registration_modal') {
        const name = interaction.fields.getTextInputValue('name')?.trim();
        const userIdProvided = interaction.fields.getTextInputValue('user_id')?.trim();
        const phone = interaction.fields.getTextInputValue('phone')?.trim();
        const recruiterRaw = interaction.fields.getTextInputValue('recruiter_id')?.trim();
        const recruiterId = recruiterRaw || null;

        const reg = {
          id: `${Date.now()}_${interaction.user.id}`,
          discordUserId: interaction.user.id,
          name,
          userIdProvided,
          phone,
          recruiterId,
          status: 'pending',
          createdAt: new Date().toISOString(),
        };

        await withRegistrationsLock(async () => {
          const registrations = readJson(REGISTRATIONS_PATH, []);
          registrations.push(reg);
          writeJson(REGISTRATIONS_PATH, registrations);
          await upsertRankingMessage(client);
        });

        const channel = await client.channels.fetch(REGISTRATION_CHANNEL_ID);
        if (!channel?.isTextBased?.()) throw new Error('REGISTRATION_CHANNEL_ID is not a text channel');
        await channel.send({ embeds: [buildRegistrationEmbed(reg)], components: buildRegistrationActions(reg), files: brandingFiles() });
        await interaction.reply({ content: 'Registro enviado com sucesso. Aguarde um instrutor aprovar.', ephemeral: true });
        return;
      }

      if (interaction.customId === 'order_modal') {
        const date = interaction.fields.getTextInputValue('order_date')?.trim();
        const fac = interaction.fields.getTextInputValue('order_fac')?.trim();
        const product = interaction.fields.getTextInputValue('order_product')?.trim();
        const delivery = interaction.fields.getTextInputValue('order_delivery')?.trim();
        const contact = interaction.fields.getTextInputValue('order_contact')?.trim();

        const customerName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;

        const order = {
          id: `${Date.now()}_${interaction.user.id}`,
          createdBy: interaction.user.id,
          customerName,
          contact,
          date,
          fac,
          product,
          delivery,
          status: 'pending',
          createdAt: new Date().toISOString(),
        };

        const orders = readJson(ORDERS_PATH, []);
        orders.push(order);
        writeJson(ORDERS_PATH, orders);

        const reviewChannel = await client.channels.fetch(ORDERS_REVIEW_CHANNEL_ID);
        if (!reviewChannel?.isTextBased?.()) throw new Error('ORDERS_REVIEW_CHANNEL_ID is not a text channel');
        const sent = await reviewChannel.send({
          embeds: [buildOrderEmbed(order)],
          components: buildOrderReviewActions(order),
          files: brandingFiles(),
        });

        order.reviewMessageId = sent.id;
        orders[orders.length - 1] = order;
        writeJson(ORDERS_PATH, orders);

        await interaction.reply({ content: 'Encomenda enviada para análise.', ephemeral: true });
        return;
      }

      return;
    }
  } catch (err) {
    const msg = err?.message ? String(err.message) : 'Erro desconhecido.';
    console.error(err);
    if (interaction.isRepliable()) {
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: `Erro: ${msg}`, ephemeral: true });
        } else {
          await interaction.reply({ content: `Erro: ${msg}`, ephemeral: true });
        }
      } catch (e) {
        console.error('Failed to send error response:', e);
      }
    }
  }
});

 client.login(DISCORD_TOKEN);
