const express = require('express');
const path = require('path');
const session = require('express-session');
const axios = require('axios');
const http = require('http');
const { WebSocketServer } = require('ws');
const { Client, GatewayIntentBits } = require('discord.js'); // Importa o discord.js
require('dotenv').config(); // Carrega as variáveis do arquivo .env

const app = express();
const server = http.createServer(app); // Cria um servidor HTTP a partir do Express

// --- Configuração de Autenticação e Sessão ---
const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, SESSION_SECRET, BASE_URL } = process.env;
const REDIRECT_URI = `${BASE_URL}/auth/discord/callback`;

const sessionParser = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
});

app.use(sessionParser);

// --- Configuração do Bot do Discord ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers // Necessário para encontrar usuários que não estão no cache
    ]
});

client.once('ready', () => {
    console.log(`Bot do Discord logado como ${client.user.tag}!`);
});

// --- Configuração do WebSocket ---
const wss = new WebSocketServer({ noServer: true });

// Mapa para associar userId do Discord com a conexão WebSocket
const wsClients = new Map();
// Mapa para guardar os bots dos usuários
// Formato: { sessionId: discordClient }
const userBots = new Map();
// Novo mapa para rastrear as sessões de chat ativas
// Formato: { websiteUserId: targetDiscordUserId }
const activeChats = new Map();

server.on('upgrade', (request, socket, head) => {
    // Usa o parser de sessão do Express para autenticar a conexão WebSocket
    sessionParser(request, {}, () => {
        if (!request.session.user) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    });
});

wss.on('connection', (ws, request) => {
    const userId = request.session.user.id;
    wsClients.set(userId, ws);
    console.log(`Cliente WebSocket conectado: ${userId}`);

    ws.on('message', (message) => {
        // Lógica para lidar com mensagens do cliente (para o chat)
        handleWsMessage(userId, message);
    });

    ws.on('close', () => {
        wsClients.delete(userId);
        activeChats.delete(userId); // Limpa o chat ativo ao desconectar
        console.log(`Cliente WebSocket desconectado: ${userId}`);
    });
});

// Configurações do Servidor
const PORT = process.env.PORT || 3000; // Render usa a variável de ambiente PORT
 
// Middlewares
app.use(express.json()); // Para entender JSON vindo no corpo das requisições
app.use(express.static(path.join(__dirname, 'public'))); // Para servir os arquivos estáticos (html, css, js)

// --- Middleware de Proteção de Rota ---
function ensureAuthenticated(req, res, next) {
    if (req.session.user) {
        return next();
    }
    // Se for uma chamada de API (esperando JSON), retorne um erro 401.
    if (req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith('/bots/')) {
        return res.status(401).json({ message: 'Não autenticado.' });
    }
    // Se for uma navegação de página, redirecione para o login.
    res.redirect('/');
}

// --- Rotas de Autenticação ---
app.get('/auth/discord', (req, res) => {
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
    res.redirect(authUrl);
});

app.get('/auth/discord/callback', async (req, res) => {
    // Adiciona log para depuração no Render
    console.log('Recebido callback do Discord. Query:', req.query);

    // Verifica se o usuário negou o acesso
    if (req.query.error) {
        return res.redirect('/?error=' + encodeURIComponent(req.query.error_description));
    }

    const { code } = req.query;
    if (!code) return res.status(400).send('Código de autorização não fornecido.');

    try {
        // 1. Trocar o código pelo token de acesso
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: DISCORD_CLIENT_ID,
            client_secret: DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const accessToken = tokenResponse.data.access_token;

        // 2. Usar o token para pegar os dados do usuário
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        // 2.5 Usar o token para pegar os servidores do usuário
        const guildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const discordUser = userResponse.data;
        const userGuilds = guildsResponse.data.map(guild => guild.id); // Salva apenas os IDs dos servidores
        
        // 3. Salvar os dados do usuário na sessão
        req.session.user = {
            id: discordUser.id,
            username: discordUser.username,
            avatar: `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`,
            guilds: userGuilds,
        };

        // Garante que a sessão seja salva antes de redirecionar.
        req.session.save(() => {
            res.redirect('/');
        });
    } catch (error) {
        console.error('Erro na autenticação com Discord:', error.response ? error.response.data : error.message);
        res.status(500).send('Erro ao autenticar com o Discord.');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// --- Rotas da Aplicação ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota para fornecer os dados do usuário logado (incluindo amigos) para o frontend
app.get('/api/me', ensureAuthenticated, (req, res) => {
    res.json(req.session.user);
});

// Rota para receber os dados do formulário e enviar a mensagem
app.post('/send-message', ensureAuthenticated, async (req, res) => {
    const { userId, count, message, botToken } = req.body;

    // Pega o bot da sessão do usuário
    const userBotClient = userBots.get(req.session.id);
    if (!userBotClient || userBotClient.token !== botToken) {
        return res.status(403).json({ message: 'Bot não incorporado ou token inválido. Por favor, incorpore seu bot primeiro.' });
    }

    // Validação básica dos dados recebidos
    if (!userId || !count || !message) {
        return res.status(400).json({ message: 'Todos os campos são obrigatórios.' });
    }

    try {
        // Usa o bot do usuário para buscar e enviar a mensagem
        const user = await userBotClient.users.fetch(userId);

        const ws = wsClients.get(req.session.user.id);
        const sendLog = (type, logMessage) => {
            if (ws) ws.send(JSON.stringify({ type: 'log', data: { type, message: logMessage } }));
        };

        console.log(`Recebido pedido para enviar ${count} mensagem(ns) para '${user.tag}' com o texto: "${message}"`);
        sendLog('info', `Iniciando envio de ${count} mensagens para ${user.tag}...`);

        for (let i = 0; i < count; i++) {
            await user.send(message);
            console.log(`Mensagem ${i + 1}/${count} enviada para ${user.tag}`);
            sendLog('info', `Mensagem ${i + 1}/${count} enviada.`);
            await new Promise(resolve => setTimeout(resolve, 500)); // 0.5 segundos de espera
        }
        sendLog('success', 'Envio concluído com sucesso!');

        res.status(200).json({ message: `Sucesso! ${count} mensagem(ns) enviada(s) para ${user.tag}.` });

    } catch (error) {
        console.error('Erro ao processar o envio de mensagens:', error);
        let errorMessage = 'Falha ao enviar as mensagens. Verifique o console do servidor.';
        if (error.code === 10013) { // Unknown User
            errorMessage = `Usuário com ID "${userId}" não encontrado. Verifique se o ID está correto.`;
            if (ws) ws.send(JSON.stringify({ type: 'log', data: { type: 'error', message: errorMessage } }));
        }
        if (error.code === 50007) {
            errorMessage = `Não foi possível enviar a DM. O usuário pode ter desativado as mensagens diretas.`;
            if (ws) ws.send(JSON.stringify({ type: 'log', data: { type: 'error', message: errorMessage } }));
        }
        res.status(500).json({ message: errorMessage });
    }
});

// Rota para incorporar um novo bot
app.post('/bots/incorporate', ensureAuthenticated, async (req, res) => {
    const { token } = req.body;
    if (!token) {
        return res.status(400).json({ message: 'Token não fornecido.' });
    }

    // Se já existe um bot para esta sessão, desconecta-o primeiro
    if (userBots.has(req.session.id)) {
        await userBots.get(req.session.id).destroy();
        userBots.delete(req.session.id);
    }

    const newUserBot = new Client({ intents: [] }); // Intents mínimas para enviar DM

    try {
        await newUserBot.login(token);

        // Armazena o cliente do bot associado à sessão do usuário
        userBots.set(req.session.id, newUserBot);

        const botUser = newUserBot.user;
        const botDetails = {
            name: botUser.username,
            avatar: botUser.displayAvatarURL(),
        };

        // Salva os detalhes do bot na sessão para persistência
        req.session.incorporatedBot = { ...botDetails, token };
        req.session.save(() => {
            res.status(200).json({ message: 'Bot incorporado com sucesso!', bot: botDetails });
        });

    } catch (error) {
        console.error('Falha ao incorporar bot:', error.message);
        res.status(401).json({ message: 'Token inválido. Não foi possível fazer login com o bot.' });
    }
});

// Rota para desconectar o bot do usuário
app.post('/bots/disconnect', ensureAuthenticated, async (req, res) => {
    if (userBots.has(req.session.id)) {
        await userBots.get(req.session.id).destroy();
        userBots.delete(req.session.id);
    }
    delete req.session.incorporatedBot;
    req.session.save(() => res.status(200).json({ message: 'Bot desconectado.' }));
});

// Rota para enviar uma mensagem de teste para o próprio usuário logado
app.post('/send-test-message', ensureAuthenticated, async (req, res) => {
    const { id, username } = req.session.user;

    try {
        const user = await client.users.fetch(id);
        const testMessage = `Olá, ${username}! 👋 Esta é uma mensagem de teste para confirmar que estou funcionando corretamente.`;
        
        await user.send(testMessage);
        console.log(`Mensagem de teste enviada para ${user.tag}`);

        res.status(200).json({ message: 'Mensagem de teste enviada com sucesso para sua DM!' });
    } catch (error) {
        console.error('Erro ao enviar mensagem de teste:', error);
        let errorMessage = 'Falha ao enviar a mensagem de teste.';
        if (error.code === 50007) {
            errorMessage = `Não foi possível enviar a DM. Verifique se você não bloqueou o bot.`;
        }
        res.status(500).json({ message: errorMessage });
    }
});

// --- Lógica do Chat em Tempo Real ---

// Lida com mensagens recebidas do site via WebSocket
async function handleWsMessage(senderId, rawMessage) {
    try {
        const messageData = JSON.parse(rawMessage);
        if (messageData.type === 'chat') {
            const { targetUserId, message } = messageData.data;
            const targetUser = await client.users.fetch(targetUserId);
            await targetUser.send(message);

            // Registra que o senderId está agora conversando com o targetUserId
            if (messageData.action === 'start') {
                activeChats.set(senderId, targetUserId);
            }

            // Log para o painel de atividade
            const ws = wsClients.get(senderId);
            if (ws) ws.send(JSON.stringify({ type: 'log', data: { type: 'info', message: `Msg para ${targetUser.tag}: ${message}` } }));
        }
    } catch (error) {
        console.error('Erro ao processar mensagem WebSocket:', error);
    }
}

// Lida com DMs recebidas no Discord e as encaminha para o site
client.on('messageCreate', async (message) => {
    // Ignora mensagens do próprio bot
    if (message.author.bot) return;

    // Verifica se a mensagem é uma DM
    if (message.channel.type === 1) { // 1 = DMChannel
        // Itera sobre os chats ativos para encontrar quem deveria receber esta mensagem
        for (const [websiteUserId, targetDiscordUserId] of activeChats.entries()) {
            // Se o autor da DM é o alvo de um chat ativo...
            if (message.author.id === targetDiscordUserId) {
                // ...envia a mensagem para o usuário do site correspondente.
                const ws = wsClients.get(websiteUserId);
                if (ws) {
                    ws.send(JSON.stringify({
                        type: 'chat',
                        data: { from: message.author.id, fromUsername: message.author.tag, text: message.content }
                    }));
                }
            }
        }
    }
});


// Inicia o servidor
client.login(process.env.BOT_TOKEN).then(() => {
    server.listen(PORT, () => { // Usa o servidor HTTP para escutar
    console.log(`Servidor rodando na porta ${PORT}`);
    });
});
