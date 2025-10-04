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
 * Busca os amigos do usuário e preenche o menu de seleção.
 */
async function populateFriendsList() {
    const select = document.getElementById('friend-select');
    const userAvatar = document.getElementById('user-avatar');
    const userUsername = document.getElementById('user-username');
    if (!select || !userAvatar || !userUsername) return;

    try {
        const response = await fetch('/api/me');
        if (response.status === 401) {
            // Se não estiver autenticado, redireciona para a página de login.
            window.location.href = '/';
            return;
        }
        if (!response.ok) throw new Error('Falha ao buscar dados do usuário. Status: ' + response.status);

        const userData = await response.json();

        // Preenche as informações do perfil do usuário no topo da página
        userAvatar.src = userData.avatar;
        userAvatar.alt = `Avatar de ${userData.username}`;
        userUsername.textContent = userData.username;

        select.innerHTML = '<option value="" disabled selected>Selecione um amigo</option>'; // Limpa e adiciona a opção padrão

        userData.friends.forEach(friend => {
            const option = new Option(`${friend.username}#${friend.discriminator}`, friend.id);
            select.add(option);
        });
    } catch (error) {
        console.error('Erro ao popular lista de amigos:', error);
        select.innerHTML = '<option value="" disabled selected>Erro ao carregar amigos</option>';
    }
}

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
    
    statusDiv.className = 'status-sending'; // Adiciona a classe para "enviando"
    statusDiv.textContent = 'Enviando mensagens...';

    try {
        // Faz a requisição para o nosso backend
        const response = await fetch('/send-message', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ userId, count, message }),
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
    populateFriendsList(); // Chama a nova função para buscar os amigos
});
