 const fs = require('node:fs');
 const path = require('node:path');
 const {
   Client,
   Events,
   GatewayIntentBits,
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

const BRAND_IMAGE_PATH = path.join(__dirname, 'images', 'standard.gif');
const BRAND_IMAGE_NAME = 'standard.gif';

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
  return recruiterId ? `<@${recruiterId}>` : '`inválido`';
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

async function upsertPanelMessage(client) {
  const state = readJson(STATE_PATH, { rankingMessageId: null, panelMessageId: null, orderPanelMessageId: null });
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
  const counts = new Map();
  for (const r of registrations) {
    if (!r?.recruiterId) continue;
    if (r.status !== 'approved') continue;
    counts.set(r.recruiterId, (counts.get(r.recruiterId) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([recruiterId, total]) => ({ recruiterId, total }));
}

function buildRankingEmbed(ranking) {
  const embed = new EmbedBuilder()
    .setTitle('Ranking de recrutamento')
    .setColor(0x5865f2)
    .setImage(`attachment://${BRAND_IMAGE_NAME}`)
    .setFooter({ text: '© RealBala - Kat' });

  if (!ranking.length) {
    embed.setDescription('Ainda não há registros.');
    return embed;
  }

  const lines = ranking.slice(0, 20).map((x, i) => `${i + 1}. ${recruiterDisplay(x.recruiterId)} — **${x.total}**`);
  embed.setDescription(lines.join('\n'));
  return embed;
}

async function upsertRankingMessage(client) {
  const registrations = readJson(REGISTRATIONS_PATH, []);
  const ranking = computeRanking(registrations);
  const embed = buildRankingEmbed(ranking);

  const state = readJson(STATE_PATH, { rankingMessageId: null, panelMessageId: null, orderPanelMessageId: null });
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
  const state = readJson(STATE_PATH, { rankingMessageId: null, panelMessageId: null, orderPanelMessageId: null });
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
  await registerCommands();
  await upsertPanelMessage(client);
  await upsertOrdersPanelMessage(client);
  await upsertRankingMessage(client);
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
          .setRequired(true)
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
            await interaction.message.edit({ components: [] });
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
            await interaction.message.edit({ components: [] });
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
            await interaction.message.edit({ components: [] });
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

        const registrations = readJson(REGISTRATIONS_PATH, []);
        const idx = registrations.findIndex((r) => r?.id === regId);
        if (idx === -1) {
          await interaction.editReply({ content: 'Registro não encontrado.' });
          return;
        }

        const reg = registrations[idx];
        if (reg.status && reg.status !== 'pending') {
          await interaction.editReply({ content: 'Esse registro já foi analisado.' });
          return;
        }

        const me = await interaction.guild.members.fetchMe();
        if (!me.permissions.has('ManageNicknames')) throw new Error('Bot missing permission: ManageNicknames');
        if (!me.permissions.has('ManageRoles')) throw new Error('Bot missing permission: ManageRoles');

        reg.status = isAccept ? 'approved' : 'rejected';
        reg.decidedAt = new Date().toISOString();
        reg.decidedBy = interaction.user.id;

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

        registrations[idx] = reg;
        writeJson(REGISTRATIONS_PATH, registrations);

        const embed = buildRegistrationEmbed(reg);
        await interaction.message.edit({ embeds: [embed], components: [], files: brandingFiles() });
        await upsertRankingMessage(client);
        await interaction.editReply({ content: isAccept ? 'Registro aprovado.' : 'Registro recusado.' });
        return;
      }

      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'registration_modal') {
        const name = interaction.fields.getTextInputValue('name')?.trim();
        const userIdProvided = interaction.fields.getTextInputValue('user_id')?.trim();
        const phone = interaction.fields.getTextInputValue('phone')?.trim();
        const recruiterRaw = interaction.fields.getTextInputValue('recruiter_id')?.trim();
        const recruiterId = normalizeRecruiterId(recruiterRaw);

        if (!recruiterId) {
          await interaction.reply({ content: 'ID do recrutador inválido. Envie um ID numérico ou @menção.', ephemeral: true });
          return;
        }

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

        const registrations = readJson(REGISTRATIONS_PATH, []);
        registrations.push(reg);
        writeJson(REGISTRATIONS_PATH, registrations);

        const channel = await client.channels.fetch(REGISTRATION_CHANNEL_ID);
        if (!channel?.isTextBased?.()) throw new Error('REGISTRATION_CHANNEL_ID is not a text channel');
        await channel.send({ embeds: [buildRegistrationEmbed(reg)], components: buildRegistrationActions(reg), files: brandingFiles() });

        await upsertRankingMessage(client);
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
