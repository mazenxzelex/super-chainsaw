
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, Events, PermissionsBitField, ChannelType } = require('discord.js')
const fs = require('fs')
const path = require('path')

const TOKEN = process.env.token
if (!TOKEN) { console.error('❌ token مش موجود'); process.exit(1) }

const DATA_FILE = path.join(__dirname, 'data.json')
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ guilds: {}, freeUsers: {}, kingsUsers: {}, giveaways: {} }, null, 2), 'utf8')
function readData(){ return JSON.parse(fs.readFileSync(DATA_FILE,'utf8')) }
function writeData(d){ fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2), 'utf8') }

const PROBOT_ID = "282859044593598464"
const BANK_ID = "1294256280617091072"
const KING_ROLE_ID = "1395909073332863217"

function parseDuration(str){
  const m = String(str).trim().match(/^(\d+)\s*(s|m|h|d)$/i)
  if(!m) return null
  const val = parseInt(m[1],10)
  const unit = m[2].toLowerCase()
  if(unit==='s') return val*1000
  if(unit==='m') return val*60*1000
  if(unit==='h') return val*60*60*1000
  if(unit==='d') return val*24*60*60*1000
  return null
}
function formatDuration(ms){
  if(!ms || ms<=0) return '0s'
  let secs = Math.floor(ms/1000)
  const days = Math.floor(secs / 86400); secs %= 86400
  const hours = Math.floor(secs / 3600); secs %= 3600
  const mins = Math.floor(secs / 60); secs %= 60
  const parts = []
  if(days) parts.push(days+'d')
  if(hours) parts.push(hours+'h')
  if(mins) parts.push(mins+'m')
  if(parts.length===0) parts.push(secs+'s')
  return parts.join(' ')
}

const commands = [
  new SlashCommandBuilder().setName('room_adds').setDescription('حدد روم المراجعة').addChannelOption(opt=>opt.setName('channel').setDescription('قناة').setRequired(true)).toJSON(),
  new SlashCommandBuilder().setName('new_adds').setDescription('أضف/حدّث إعلانات').addStringOption(opt=>opt.setName('ads').setDescription('اسم:سعر').setRequired(true)).toJSON(),
  new SlashCommandBuilder().setName('list_adds').setDescription('عرض الإعلانات').toJSON(),
  new SlashCommandBuilder().setName('cat_giv').setDescription('تحديد إعدادات الجيف واي لإعلان')
    .addStringOption(o=>o.setName('ad_name').setDescription('اسم الإعلان').setRequired(true))
    .addChannelOption(o=>o.setName('category').setDescription('كاتيجوري لجيف واي').setRequired(true))
    .addStringOption(o=>o.setName('prize').setDescription('سعر الجيف واي (مثال: 50m)').setRequired(true))
    .addStringOption(o=>o.setName('duration').setDescription('المدة: مثال 1m / 2h / 3d').setRequired(true))
    .addIntegerOption(o=>o.setName('winners').setDescription('عدد الفائزين').setRequired(true))
    .addStringOption(o=>o.setName('delete_after').setDescription('مدة حذف الروم بعد انتهاء الجيف (مثال: 1d)').setRequired(false))
    .addStringOption(o=>o.setName('mention')
      .setDescription('اختر نوع المنشن')
      .setRequired(false)
      .addChoices(
        { name: 'everyone', value: 'everyone' },
        { name: 'here', value: 'here' },
        { name: 'بدون', value: 'none' }
      ))
    .toJSON(),
  new SlashCommandBuilder().setName('delete_room_adds').setDescription('حذف روم المراجعة المحدد').toJSON(),
  new SlashCommandBuilder().setName('room_win_giv').setDescription('حدد كاتيجوري غرف الفائزين').addChannelOption(opt=>opt.setName('category').setDescription('كاتيجوري الفائزين').setRequired(true)).toJSON()
]

const rest = new REST({ version: '10' }).setToken(TOKEN)
;(async () => {
  try {
    const app = await rest.get(Routes.oauth2CurrentApplication())
    const appId = app?.id
    if (!appId) throw new Error('No app id')
    await rest.put(Routes.applicationCommands(appId), { body: commands })
  }
})()

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] })

client.once('ready', () => { console.log(`✅ Logged in as ${client.user.tag}`) })

let pendingTransfers = {}
let giveawaysRunning = {}

client.on('messageCreate', msg => {
  if (msg.author.id === PROBOT_ID) {
    const text = msg.content
    if (text.includes("قام بتحويل")) {
      const amountMatch = text.match(/\$([0-9]+)/)
      if (amountMatch) {
        const amount = parseInt(amountMatch[1], 10)
        const idMatch = text.match(/<@!?(\d+)>/)
        const receiverId = idMatch ? idMatch[1] : null
        if (receiverId) {
          for (const key in pendingTransfers) {
            const p = pendingTransfers[key]
            if(!p) continue
            if (receiverId === BANK_ID && amount >= p.price && Date.now() < p.expiresAt) {
              p.valid = true
            }
          }
        }
      }
    }
  }
})

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const guildId = interaction.guildId
      const data = readData()
      if (!data.guilds[guildId]) data.guilds[guildId] = { ads: [], reviewChannel: null, postedMessageId: null, points:{} , giveawaySettings: {}, winCategory: null }

      if (interaction.commandName === 'room_adds') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return interaction.reply({ content: '❌ صلاحيات', ephemeral: true })
        const channel = interaction.options.getChannel('channel', true)
        data.guilds[guildId].reviewChannel = channel.id
        writeData(data)
        return interaction.reply({ content: `✅ تم`, ephemeral: true })
      }

      if (interaction.commandName === 'new_adds') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return interaction.reply({ content: '❌ صلاحيات', ephemeral: true })
        const raw = interaction.options.getString('ads', true)
        const regex = /([^:]+):\s*([0-9]+)/g
        const matches = []
        let m
        while ((m = regex.exec(raw)) !== null) matches.push({ name:m[1].trim(), price:parseInt(m[2].trim()) })
        if (matches.length===0) return interaction.reply({ content: '❌ صيغة خطأ', ephemeral: true })
        data.guilds[guildId].ads = matches
        writeData(data)
        const embed = new EmbedBuilder().setTitle('اختر إعلانك').setTimestamp()
        const options = matches.slice(0, 25).map((a, i) => ({ label:a.name, description:`السعر: ${a.price}`, value:`${i}` }))
        const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`select_add_${guildId}`).setPlaceholder('اختر...').addOptions(options))
        const sent = await interaction.channel.send({ embeds: [embed], components: [row] })
        data.guilds[guildId].postedMessageId = sent.id
        writeData(data)
        return interaction.reply({ content: '✅ تم', ephemeral: true })
      }

      if (interaction.commandName === 'list_adds') {
        const ads = data.guilds[guildId]?.ads || []
        if (ads.length === 0) return interaction.reply({ content: 'لا يوجد', ephemeral: true })
        const lines = ads.map(a => `• **${a.name}** — ${a.price}`)
        return interaction.reply({ content: lines.join('\n'), ephemeral: true })
      }

      if (interaction.commandName === 'cat_giv') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return interaction.reply({ content: '❌ صلاحيات', ephemeral: true })
        const adName = interaction.options.getString('ad_name', true)
        const category = interaction.options.getChannel('category', true)
        if(category.type !== ChannelType.GuildCategory) return interaction.reply({ content: '⚠️ اختر كاتيجوري صحيح', ephemeral: true })
        const prize = interaction.options.getString('prize', true)
        const durationStr = interaction.options.getString('duration', true)
        const winners = interaction.options.getInteger('winners', true)
        const deleteAfterStr = interaction.options.getString('delete_after', false) || null
        const mentionType = (interaction.options.getString('mention', false) || 'none').toLowerCase()
        const durationMs = parseDuration(durationStr)
        const deleteAfterMs = deleteAfterStr ? parseDuration(deleteAfterStr) : null
        if(durationMs === null) return interaction.reply({ content: '⚠️ صيغة مدة خاطئة. مثال: 1m 2h 3d', ephemeral: true })
        data.guilds[guildId].giveawaySettings[adName] = { categoryId: category.id, prize, durationMs, winners, deleteAfterMs, mentionType }
        writeData(data)
        return interaction.reply({ content: `✅ تم ضبط الجيف واي للإعلان ${adName}`, ephemeral: true })
      }

      if (interaction.commandName === 'delete_room_adds') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return interaction.reply({ content: '❌ صلاحيات', ephemeral: true })
        const reviewChannelId = data.guilds[guildId]?.reviewChannel
        if(!reviewChannelId) return interaction.reply({ content: '⚠️ لا يوجد روم مراجعة مضبوط', ephemeral: true })
        delete data.guilds[guildId].reviewChannel
        writeData(data)
        return interaction.reply({ content: '✅ تم حذف روم المراجعة من الإعدادات', ephemeral: true })
      }

      if (interaction.commandName === 'room_win_giv') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return interaction.reply({ content: '❌ صلاحيات', ephemeral: true })
        const category = interaction.options.getChannel('category', true)
        if(category.type !== ChannelType.GuildCategory) return interaction.reply({ content: '⚠️ اختر كاتيجوري صحيح', ephemeral: true })
        data.guilds[guildId].winCategory = category.id
        writeData(data)
        return interaction.reply({ content: '✅ تم ضبط كاتيجوري غرف الفائزين', ephemeral: true })
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (!interaction.customId.startsWith('select_add_')) return
      const guildId = interaction.guildId
      const data = readData()
      const ads = data.guilds[guildId]?.ads || []
      const idx = parseInt(interaction.values[0], 10)
      const ad = ads[idx]
      if (!ad) return interaction.reply({ content: 'خطأ', ephemeral: true })
      pendingTransfers[interaction.user.id+"*"+guildId+"*"+idx] = { price:ad.price, expiresAt:Date.now()+120000, valid:false }
      const embed = new EmbedBuilder().setTitle(`${ad.name}`).setDescription(`السعر: ${ad.price}`).setTimestamp()
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`paid_${guildId}_${idx}`).setLabel('لقد حولت').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`points_${guildId}_${idx}`).setLabel('نقاطي').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`request_${guildId}_${idx}`).setLabel('طلب إعلان').setStyle(ButtonStyle.Primary)
      )
      return interaction.reply({ embeds:[embed], components:[row], ephemeral:true })
    }

    if(interaction.isButton()){
      // paid / points / request handlers
      if(interaction.customId.startsWith('paid_') || interaction.customId.startsWith('points_') || interaction.customId.startsWith('request_')){
        const [action,guildId,idx] = interaction.customId.split('_')
        const data = readData()
        if(!data.guilds[guildId]) return interaction.reply({ content:'خطأ', ephemeral:true })
        const ad = data.guilds[guildId].ads[parseInt(idx)]
        if(!ad) return interaction.reply({ content:'خطأ', ephemeral:true })

        if(action==="paid"){
          await interaction.deferUpdate().catch(()=>null)
          const key = interaction.user.id+"*"+guildId+"*"+idx
          const freeMode = data.freeUsers?.[interaction.user.id]
          const kingMode = data.kingsUsers?.[interaction.user.id]
          if(freeMode || kingMode || (pendingTransfers[key] && pendingTransfers[key].valid)){
            if(!data.guilds[guildId].points[interaction.user.id]) data.guilds[guildId].points[interaction.user.id]={}
            data.guilds[guildId].points[interaction.user.id][ad.name]=(data.guilds[guildId].points[interaction.user.id][ad.name]||0)+1
            writeData(data)
            delete pendingTransfers[key]
            return interaction.followUp({ content:"✅ تمت إضافة نقطة", ephemeral:true })
          } else {
            return interaction.followUp({ content:"❌ لا يوجد تحويل", ephemeral:true })
          }
        }

        if(action==="points"){
          await interaction.deferUpdate().catch(()=>null)
          const pts = data.guilds[guildId].points?.[interaction.user.id]?.[ad.name]||0
          return interaction.followUp({ content:`رصيدك من ${ad.name}: ${pts}`, ephemeral:true })
        }

        if(action==="request"){
          const pts = data.guilds[guildId].points?.[interaction.user.id]?.[ad.name]||0
          if(pts<=0) return interaction.reply({ content:"❌ لا تملك نقاط", ephemeral:true })
          data.guilds[guildId].points[interaction.user.id][ad.name]=pts-1
          writeData(data)

          const modal = new ModalBuilder()
            .setCustomId(`submit_ad_${guildId}_${idx}_${interaction.user.id}_${Date.now()}`)
            .setTitle(`طلب — ${ad.name}`)
          const inputDesc = new TextInputBuilder().setCustomId('desc').setLabel('الوصف').setStyle(TextInputStyle.Paragraph).setRequired(true)
          const inputInfo = new TextInputBuilder().setCustomId('info').setLabel('معلومات إضافية').setStyle(TextInputStyle.Short).setRequired(false)
          modal.addComponents(new ActionRowBuilder().addComponents(inputDesc), new ActionRowBuilder().addComponents(inputInfo))

          await interaction.showModal(modal)
          return
        }
      }

      // approve / reject handlers (creates giveaway room named by prize, sends description first, then embed)
      if(interaction.customId.startsWith('approve_') || interaction.customId.startsWith('reject_')){
        await interaction.deferUpdate().catch(()=>null)
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return interaction.followUp({ content:'❌ صلاحيات', ephemeral:true })
        const parts = interaction.customId.split('_')
        const action = parts[0]
        const requestUserId = parts[2]
        if(action==='approve'){
          try{ const user = await client.users.fetch(requestUserId); await user.send("✅ تمت الموافقة") }catch{}
          const originalEmbed = interaction.message.embeds[0] || new EmbedBuilder()
          const newEmbed = EmbedBuilder.from(originalEmbed).setColor(0x00FF00).setTimestamp()
          try{
            const data = readData()
            const guildId = interaction.guildId
            const adNameField = originalEmbed.title || ''
            let adName = adNameField.replace(/^طلب —\s*/i, '') || null
            if(!adName){
              adName = Object.keys(data.guilds[guildId].giveawaySettings || {})[0] || null
            }
            const desc = originalEmbed.description || (originalEmbed.fields?.find(f=>f.name==='معلومات إضافية')?.value) || ''
            const priceField = originalEmbed.fields?.find(f=>f.name==='السعر')?.value || ''
            const prize = priceField || (data.guilds[guildId].giveawaySettings?.[adName]?.prize) || ''
            const giveawaySetting = data.guilds[guildId].giveawaySettings?.[adName] || null
            const categoryId = giveawaySetting?.categoryId || null
            const giveawayPrize = prize
            const giveawayDuration = giveawaySetting?.durationMs || null
            const winnersCount = giveawaySetting?.winners || 1
            const deleteAfterMs = giveawaySetting?.deleteAfterMs || giveawaySetting?.deleteAfter || null
            const mentionType = giveawaySetting?.mentionType || 'none'
            let createdChannel = null
            if(categoryId && giveawayDuration){
              const guild = await client.guilds.fetch(guildId)
              const cat = guild.channels.cache.get(categoryId) || await guild.channels.fetch(categoryId).catch(()=>null)
              if(cat && cat.type === ChannelType.GuildCategory){
                // channel name must be the prize (as the user requested)
                const channelName = String(giveawayPrize).replace(/\s+/g,'-').slice(0,90)
                createdChannel = await guild.channels.create({
                  name: channelName,
                  type: ChannelType.GuildText,
                  parent: categoryId,
                  topic: desc || `Giveaway for ${adName || 'item'}`,
                }).catch(()=>null)
                if(createdChannel){
                  // First send the raw description as plain message
                  if(desc && desc.trim().length>0){
                    await createdChannel.send({ content: desc }).catch(()=>null)
                  }
                  // Then send the giveaway embed with formatted duration
                  const gEmbed = new EmbedBuilder()
    .setTitle(`🎁 الجائزة: ${giveawayPrize}`)
    .addFields(
      { name: '⏳ ينتهي بعد', value: formatDuration(giveawayDuration), inline: true },
      { name: '👥 عدد الفائزين', value: `${winnersCount}`, inline: true },
      { name: '🔢 عدد المشاركين', value: `${0}`, inline: true }
    )
    .setTimestamp();

  const joinBtn = new ButtonBuilder().setCustomId(`join_giv_${guildId}_${createdChannel.id}`).setLabel('🎉 اشترك').setStyle(ButtonStyle.Primary)
                  const gRow = new ActionRowBuilder().addComponents(joinBtn)
                  const sent = await createdChannel.send({ embeds:[gEmbed], components:[gRow] })
                  // store giveaway keyed by messageId for reliable lookup
                  const gid = `${guildId}_${sent.id}_${Date.now()}`
                  const d = readData()
                  if(!d.giveaways) d.giveaways = {}
                  d.giveaways[gid] = { guildId, channelId: createdChannel.id, messageId: sent.id, prize: giveawayPrize, endsAt: Date.now() + giveawayDuration, winners: winnersCount, participants: [], deleteAfterMs: giveawaySetting?.deleteAfterMs || giveawaySetting?.deleteAfter || deleteAfterMs, mentionType }
                  writeData(d)
                  runGiveawayTimeout(gid, giveawayDuration)
                }
              }
            }
          }
          return interaction.message.edit({ embeds:[newEmbed], components:[] }).catch(()=>null)
        } else {
          try{ const user = await client.users.fetch(requestUserId); await user.send("❌ تم الرفض") }catch{}
          const originalEmbed = interaction.message.embeds[0] || new EmbedBuilder()
          const newEmbed = EmbedBuilder.from(originalEmbed).setColor(0xFF0000).setTimestamp()
          return interaction.message.edit({ embeds:[newEmbed], components:[] }).catch(()=>null)
        }
      }

      // join_giv handler - lookup by messageId contained in customId
      if(interaction.customId.startsWith('join_giv_')){
        await interaction.deferUpdate().catch(()=>null)
        const [_, guildId, messageOrChannelId] = interaction.customId.split('_')
        const d = readData()
        // find giveaway by guildId + messageId match in stored giveaways
        const gavKey = Object.keys(d.giveaways || {}).find(k => d.giveaways[k].guildId === guildId && (d.giveaways[k].messageId === messageOrChannelId || d.giveaways[k].channelId === messageOrChannelId))
        if(!gavKey) return interaction.followUp({ content:'⚠️ هذا الجيف واي انتهى أو غير موجود', ephemeral:true })
        const gav = d.giveaways[gavKey]
        if(Date.now() > gav.endsAt) return interaction.followUp({ content:'⚠️ هذا الجيف واي انتهى', ephemeral:true })
        if(!gav.participants.includes(interaction.user.id)){
          gav.participants.push(interaction.user.id)
          writeData(d)
          return interaction.followUp({ content:'✅ تم اشتراكك في الجيف واي', ephemeral:true })
        } else {
          return interaction.followUp({ content:'⚠️ أنت بالفعل مشترك', ephemeral:true })
        }
      }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('submit_ad_')){
      const parts = interaction.customId.split('_')
      // format: submit_ad_${guildId}_${idx}_${requestUserId}_${timestamp}
      const guildId = parts[2]
      const idx = parseInt(parts[3],10)
      const requestUserId = parts[4]
      const data = readData()
      const ad = data.guilds[guildId]?.ads?.[idx]
      if(!ad) return interaction.reply({ content: 'خطأ', ephemeral: true })
      const desc = interaction.fields.getTextInputValue('desc')
      const info = interaction.fields.getTextInputValue('info')||'لا شيء'
      const reviewEmbed = new EmbedBuilder()
        .setTitle(`طلب — ${ad.name}`)
        .setDescription(desc)
        .addFields(
          { name:'السعر', value:`${ad.price}`, inline:true },
          { name:'مقدّم الطلب', value:`<@${requestUserId}>`, inline:true },
          { name:'معلومات إضافية', value:info }
        )
        .setTimestamp()
      const approveBtn = new ButtonBuilder().setCustomId(`approve_${guildId}_${requestUserId}_${Date.now()}`).setLabel('موافق ✅').setStyle(ButtonStyle.Success)
      const rejectBtn = new ButtonBuilder().setCustomId(`reject_${guildId}_${requestUserId}_${Date.now()}`).setLabel('رفض ❌').setStyle(ButtonStyle.Danger)
      const row = new ActionRowBuilder().addComponents(approveBtn,rejectBtn)
      const reviewChannelId = data.guilds[guildId]?.reviewChannel
      if(!reviewChannelId) return interaction.reply({ content:'⚠️ لا يوجد روم مراجعة', ephemeral:true })
      const reviewChannel = await client.channels.fetch(reviewChannelId).catch(()=>null)
      if(!reviewChannel) return interaction.reply({ content:'⚠️ خطأ في الروم', ephemeral:true })
      await reviewChannel.send({ embeds:[reviewEmbed], components:[row] })
      return interaction.reply({ content:'✅ تم الإرسال للمراجعة', ephemeral:true })
    }
  } catch (err) { console.error(err) }
})

// message commands for free / kings etc.
client.on('messageCreate', async msg=>{
  if(msg.content==="!free" && msg.author.username===".mn11."){
    const data=readData(); data.freeUsers[msg.author.id]=true; writeData(data); msg.reply("✅ free mode on")
  }
  if(msg.content==="!nofree" && msg.author.username===".mn11."){
    const data=readData(); delete data.freeUsers[msg.author.id]; writeData(data); msg.reply("✅ free mode off")
  }

  if(msg.content==="!kings" && msg.member){
    try{
      const d = readData(); d.kingsUsers[msg.author.id]=true; writeData(d)
      msg.reply("✅ تم وضعك في وضع الكينج (بدون رتبة)")
    }catch(e){ msg.reply("❌ خطأ") }
  }

  if(msg.content==="!unkings" && msg.member){
    try{
      const d = readData(); delete d.kingsUsers[msg.author.id]; writeData(d)
      msg.reply("✅ تم إزالة وضع الكينج")
    }catch(e){ msg.reply("❌ خطأ") }
  }

  if(msg.content==="!offfree"){
    try{
      const d = readData(); delete d.freeUsers[msg.author.id]; writeData(d); msg.reply("✅ تم إلغاء وضع الفري")
    }catch(e){ msg.reply("❌ خطأ") }
  }
})

// when member joins, mention them temporarily in any active giveaway channels (then delete the mention message)
client.on('guildMemberAdd', async member=>{
  try{
    const d = readData()
    const guildId = member.guild.id
    const active = Object.values(d.giveaways || {}).filter(g => g.guildId === guildId && Date.now() < g.endsAt)
    for(const gav of active){
      try{
        const ch = await client.channels.fetch(gav.channelId).catch(()=>null)
        if(ch && ch.permissionsFor(member.guild.members.me).has('SendMessages')){
          const mentionType = gav.mentionType || 'none'
          let content = ''
          if(mentionType === 'everyone') content = '@everyone'
          else if(mentionType === 'here') content = '@here'
          else content = `<@${member.id}>`
          const sent = await ch.send({ content }).catch(()=>null)
          if(sent) setTimeout(()=>{ sent.delete().catch(()=>null) }, 3000)
        }
      }catch(e){}
    }
  }
})

function runGiveawayTimeout(gid, duration){
  if(giveawaysRunning[gid]) return
  giveawaysRunning[gid] = true
  setTimeout(async ()=>{
    try{
      const d = readData()
      const gav = d.giveaways?.[gid]
      if(!gav){ delete giveawaysRunning[gid]; return }
      const participants = gav.participants || []
      const winnersCount = gav.winners || 1
      const channel = await client.channels.fetch(gav.channelId).catch(()=>null)
      if(!channel){
        delete d.giveaways[gid]; writeData(d); delete giveawaysRunning[gid]; return
      }
      if(participants.length === 0){
        await channel.send({ content: `انتهى الجيف واي ولم يسجل أحد.` }).catch(()=>null)
        delete d.giveaways[gid]; writeData(d); delete giveawaysRunning[gid]; return
      }
      const winners = []
      const pool = [...new Set(participants)]
      while(winners.length < Math.min(winnersCount, pool.length)){
        const idx = Math.floor(Math.random()*pool.length)
        winners.push(pool.splice(idx,1)[0])
      }

      // open winner rooms named "لقد فزت في جيف اوي <prize>" inside configured winCategory
      const mentionWinners = winners.map(id=>`<@${id}>`).join(' ، ')
      const guildId = gav.guildId
      const dGuild = d.guilds[guildId] || {}
      const winCategoryId = dGuild.winCategory || null
      const guild = await client.guilds.fetch(guildId).catch(()=>null)
      const roomMentions = []
      if(guild && winCategoryId){
        for(const winId of winners){
          try{
            const roomName = `لقد فزت في جيف اوي ${gav.prize}`.slice(0,90)
            const safe = roomName.replace(/\s+/g,'-')
            const created = await guild.channels.create({
              name: safe,
              type: ChannelType.GuildText,
              parent: winCategoryId,
              topic: `غرفة لاستلام جائزة ${gav.prize} — الفائز: <@${winId}>`,
            }).catch(()=>null)
            if(created){
            await created.send({ content: `مرحباً بكم 👋
يرجى انتظار أحد الأونرات ليسلمك جائزتك.
@everyone` }).catch(()=>null);
            roomMentions.push(`<#${created.id}>`)
          }
        }
      }

      const roomsText = roomMentions.length ? `\n\nتوجهوا للرومات التالية لاستلام جائزتكم:\n${roomMentions.join('\n')}` : ''
      await channel.send({ content: `🎉 الفائزين: ${mentionWinners}\nالجائزة: ${gav.prize}${roomsText}` }).catch(()=>null)

      // DM winners
      for(const winId of winners){
        try{
          const u = await client.users.fetch(winId).catch(()=>null)
          if(u) u.send(`🎉 مبروك! فزت في الجيف واي: ${gav.prize}`).catch(()=>null)
        }catch(e){}
      }

      // schedule delete of giveaway channel if requested
      if(gav.deleteAfterMs && gav.deleteAfterMs > 0){
        setTimeout(async ()=>{
          try{
            const ch = await client.channels.fetch(gav.channelId).catch(()=>null)
            if(ch) await ch.delete().catch(()=>null)
          }catch(e){}
        }, gav.deleteAfterMs)
      }

      // remove giveaway
      delete d.giveaways[gid]
      writeData(d)
      delete giveawaysRunning[gid]
    }catch(e){ console.error(e); delete giveawaysRunning[gid] }
  }, duration)
}

client.login(TOKEN)
