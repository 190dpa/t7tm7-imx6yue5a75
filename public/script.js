/**
 * Inicializa a animação de partículas no canvas.
 */
function initParticleAnimation() {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let width = canvas.width = window.innerWidth;
    let height = canvas.height = window.innerHeight;
    let particles = [];

    class Particle {
        constructor() {
            this.x = Math.random() * width;
            this.y = Math.random() * height;
            this.vx = -1 + Math.random() * 2;
            this.vy = -1 + Math.random() * 2;
            this.radius = Math.random() * 1.5;
        }
        update() {
            this.x += this.vx;
            this.y += this.vy;
            if (this.x < 0 || this.x > width) this.vx = -this.vx;
            if (this.y < 0 || this.y > height) this.vy = -this.vy;
        }
        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(52, 152, 219, 0.4)'; // Azul, semi-transparente
            ctx.fill();
        }
    }

    function createParticles() {
        particles = [];
        const particleCount = (width * height) / 10000;
        for (let i = 0; i < particleCount; i++) {
            particles.push(new Particle());
        }
    }

    function animate() {
        ctx.clearRect(0, 0, width, height);
        particles.forEach(p => { p.update(); p.draw(); });
        requestAnimationFrame(animate);
    }

    window.addEventListener('resize', () => {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
        createParticles();
    });

    createParticles();
    animate();
}

/**
 * Verifica o status de login e inicializa a UI.
 */
async function initializeApp() {
    const loginView = document.getElementById('login-view');
    const appView = document.getElementById('app-view');
    const userAvatar = document.getElementById('user-avatar');
    const userUsername = document.getElementById('user-username');
    let incorporatedBotToken = null; // Armazena o token do bot incorporado

    try {
        const response = await fetch('/api/me');
        if (response.status === 401) {
            // Não autenticado: mostra a tela de login e esconde a da aplicação.
            loginView.classList.remove('hidden');
            appView.classList.add('hidden');
            return;
        }
        if (!response.ok) throw new Error('Falha ao buscar dados do usuário. Status: ' + response.status);

        // Autenticado: mostra a tela da aplicação e esconde a de login.
        loginView.classList.add('hidden');
        appView.classList.remove('hidden');

        const userData = await response.json();

        // Preenche as informações do perfil do usuário no topo da página
        if (userAvatar) userAvatar.src = userData.avatar;
        if (userUsername) userUsername.textContent = userData.username;

        // Verifica se já existe um bot incorporado na sessão
        if (userData.incorporatedBot) {
            showBotPanel(userData.incorporatedBot);
        }

        // Se autenticado, conecta ao WebSocket
        connectWebSocket();

    } catch (error) {
        console.error('Erro ao inicializar:', error);
        // Em caso de erro, mostra a tela de login como fallback
        loginView.classList.remove('hidden');
        appView.classList.add('hidden');
    }
}

// --- Lógica de Incorporação de Bot ---

const incorporateForm = document.getElementById('incorporate-form');
if (incorporateForm) {
    incorporateForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const token = document.getElementById('bot-token').value;
        const button = incorporateForm.querySelector('button');
        button.disabled = true;
        button.textContent = 'Incorporando...';

        try {
            const response = await fetch('/bots/incorporate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token })
            });
            const result = await response.json();
            if (response.status === 401) {
                // Se a sessão expirou, o servidor retorna 401.
                // Avisa o usuário e recarrega a página para forçar o login.
                addLog('error', 'Sua sessão expirou. Por favor, faça login novamente.');
                window.location.reload();
                return;
            }
            if (!response.ok) throw new Error(result.message || 'Ocorreu um erro desconhecido.');

            // Salva o token localmente e mostra o painel do bot
            localStorage.setItem('incorporatedBotToken', token);
            showBotPanel({ ...result.bot, token });

        } catch (error) {
            addLog('error', `Falha ao incorporar: ${error.message}`);
        } finally {
            button.disabled = false;
            button.textContent = 'Incorporar';
        }
    });
}

function showBotPanel(botData) {
    document.getElementById('incorporate-content').classList.remove('active');
    document.getElementById('main-tabs').classList.add('hidden');

    const botPanel = document.getElementById('bot-panel-content');
    botPanel.classList.add('active');

    document.getElementById('bot-avatar').src = botData.avatar;
    document.getElementById('bot-name').textContent = botData.name;
}

document.getElementById('disconnect-bot-btn')?.addEventListener('click', async () => {
    await fetch('/bots/disconnect', { method: 'POST' });
    localStorage.removeItem('incorporatedBotToken');
    
    document.getElementById('bot-panel-content').classList.remove('active');
    document.getElementById('incorporate-content').classList.add('active');
    document.getElementById('main-tabs').classList.remove('hidden');
    addLog('system', 'Bot desconectado.');
});

// --- Lógica do Formulário ---

const messageForm = document.getElementById('message-form');
if (messageForm) {
    messageForm.addEventListener('submit', async function(event) {
        event.preventDefault();
        const form = event.target;
    const userId = form.userId.value;
    const count = form.count.value;
    const message = form.message.value;
    const statusDiv = document.getElementById('status');
    const botToken = localStorage.getItem('incorporatedBotToken');

    if (!botToken) {
        addLog('error', 'Nenhum bot incorporado. Impossível enviar mensagem.');
        return;
    }
    
    statusDiv.className = 'status-sending'; // Adiciona a classe para "enviando"
    statusDiv.textContent = 'Enviando mensagens...';

    try {
        // Faz a requisição para o nosso backend
        const response = await fetch('/send-message', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ userId, count, message, botToken }),
        });

        const result = await response.json();

        if (response.ok) {
            statusDiv.className = 'status-success'; // Adiciona a classe para "sucesso"
            statusDiv.textContent = result.message;
            form.reset(); // Limpa o formulário
        } else {
            throw new Error(result.message || 'Ocorreu um erro no servidor.');
        }
    } catch (error) {
        statusDiv.className = 'status-error'; // Adiciona a classe para "erro"
        statusDiv.textContent = `Erro: ${error.message}`;
    }
    });
}

// --- Lógica da Mensagem de Teste ---

const testMessageBtn = document.getElementById('test-message-btn');
if (testMessageBtn) {
    testMessageBtn.addEventListener('click', async () => {
        const statusDiv = document.getElementById('status');
        statusDiv.className = 'status-sending';
        statusDiv.textContent = 'Enviando mensagem de teste...';
        testMessageBtn.disabled = true;

        try {
            const response = await fetch('/send-test-message', {
                method: 'POST'
            });

            const result = await response.json();

            if (response.ok) {
                statusDiv.className = 'status-success';
                statusDiv.textContent = result.message;
            } else {
                throw new Error(result.message || 'Ocorreu um erro no servidor.');
            }
        } catch (error) {
            statusDiv.className = 'status-error';
            statusDiv.textContent = `Erro: ${error.message}`;
        } finally {
            testMessageBtn.disabled = false;
        }
    });
}

// --- Lógica do WebSocket e Painel de Log ---
let socket;

function connectWebSocket() {
    // Constrói a URL do WebSocket (ws:// ou wss:// para produção)
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}`;
    
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        addLog('system', 'Conectado ao servidor.');
    };

    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'log') {
            addLog(message.data.type, message.data.message);
        }
        if (message.type === 'chat') {
            handleIncomingChatMessage(message.data);
        }
    };

    socket.onclose = () => {
        addLog('error', 'Desconectado do servidor. Tentando reconectar em 5s...');
        setTimeout(connectWebSocket, 5000);
    };

    socket.onerror = (error) => {
        console.error('WebSocket Error:', error);
        addLog('error', 'Erro na conexão WebSocket.');
    };
}

const logMessagesDiv = document.getElementById('log-messages');
function addLog(type, message) {
    if (!logMessagesDiv.querySelector('.log-entry')) {
        logMessagesDiv.innerHTML = ''; // Limpa a mensagem "Aguardando atividade"
    }
    const logEntry = document.createElement('p');
    logEntry.className = `log-entry ${type}`;
    logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logMessagesDiv.appendChild(logEntry);
    logMessagesDiv.scrollTop = logMessagesDiv.scrollHeight; // Auto-scroll
}

document.getElementById('clear-log-btn')?.addEventListener('click', () => {
    logMessagesDiv.innerHTML = '<p class="log-entry system">Log limpo.</p>';
});

// --- Lógica das Abas e Chat ---
document.querySelectorAll('.tab-btn').forEach(button => {
    button.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

        button.classList.add('active');
        document.getElementById(`${button.dataset.tab}-content`).classList.add('active');
    });
});

const chatUserIdInput = document.getElementById('chat-userId');
const chatWindow = document.getElementById('chat-window');
const chatMessagesDiv = document.getElementById('chat-messages');
let currentChatTargetId = null;

chatUserIdInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const userId = chatUserIdInput.value.trim();
        if (userId && chatUserIdInput.checkValidity()) {
            currentChatTargetId = userId;
            chatWindow.classList.remove('hidden');
            chatMessagesDiv.innerHTML = `<div class="chat-bubble system">Chat iniciado com o usuário ${userId}.</div>`;
            // Informa ao servidor que um chat foi iniciado
            if (socket?.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({
                    type: 'chat', action: 'start', data: { targetUserId: userId }
                }));
            }
            chatUserIdInput.disabled = true;
        }
    }
});

document.getElementById('chat-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const message = input.value.trim();

    if (message && currentChatTargetId && socket?.readyState === WebSocket.OPEN) {
        // Envia a mensagem para o servidor via WebSocket
        socket.send(JSON.stringify({
            type: 'chat',
            data: { targetUserId: currentChatTargetId, message: message }
        }));

        // Mostra a mensagem enviada na UI
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble sent';
        bubble.textContent = message;
        chatMessagesDiv.appendChild(bubble);
        chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;

        input.value = '';
    }
});

function handleIncomingChatMessage(data) {
    // Só mostra a mensagem se o chat for com o usuário correto
    if (data.from === currentChatTargetId) {
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble received';
        bubble.textContent = data.text;
        chatMessagesDiv.appendChild(bubble);
        chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
    }
    // Loga a mensagem recebida no painel de atividade
    addLog('info', `Msg de ${data.fromUsername}: ${data.text}`);
}

// --- Lógica do Cursor Personalizado ---

const customCursor = document.querySelector('.custom-cursor');

if (customCursor) {
    window.addEventListener('mousemove', e => {
        customCursor.style.left = `${e.clientX}px`;
        customCursor.style.top = `${e.clientY}px`;
    });
    document.body.addEventListener('mouseleave', () => {
        customCursor.style.display = 'none';
    });
    document.body.addEventListener('mouseenter', () => {
        customCursor.style.display = 'block';
    });
}

// --- Inicialização ---

// Garante que o DOM está carregado antes de rodar os scripts de animação
document.addEventListener('DOMContentLoaded', () => {
    initParticleAnimation();
    initializeApp();
});
