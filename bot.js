const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const readline = require('readline'); // <-- Nueva librería para pedir datos

// --- CONFIGURACIÓN ---
const CONFIG = {
    // Los dueños siguen siendo los mismos
    owners: ['5492396522761', '5354609909'], 
    botName: 'Mi Bot Asistente',
    prefix: '#'
};

const STATE_FILE = './bot_state.json';

function getBotState() {
    if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
    return { active: true };
}

function setBotState(active) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ active }));
}

// Función para preguntar el número en la terminal
function askPhoneNumber() {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        rl.question('📱 Ingresa el número de WhatsApp a vincular (sin el + y sin espacios): ', (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

// --- FUNCIÓN PRINCIPAL ---
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    // --- LÓGICA DEL CÓDIGO DE EMPAREJAMIENTO CON PREGUNTA ---
    if (!sock.authState.creds.registered) {
        // Si no está registrado, le pedimos el número al usuario
        const phoneNumber = await askPhoneNumber();
        
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                console.log('\n=========================================');
                console.log(`🔑 TU CÓDIGO DE EMPAREJAMIENTO ES: ${code}`);
                console.log('=========================================\n');
                console.log('Instrucciones:');
                console.log('1. Abre WhatsApp en tu teléfono.');
                console.log('2. Ve a Dispositivos vinculados > Vincular dispositivo.');
                console.log('3. Toca en "Vincular con número de teléfono".');
                console.log('4. Ingresa el código de 8 dígitos mostrado arriba.');
            } catch (error) {
                console.error('Error al solicitar el código:', error);
            }
        }, 3000); 
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr && !sock.authState.creds.registered) {
            console.log('⚠️ Se generó un QR. Si prefieres usarlo, escanéalo:');
            require('qrcode-terminal').generate(qr, { small: true });
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ Bot conectado correctamente.');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // --- MANEJADOR DE MENSAJES ---
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        
        if (!msg.message) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        
        if (!text.startsWith(CONFIG.prefix)) return;

        const args = text.slice(CONFIG.prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        const from = msg.key.remoteJid;
        
        const sender = msg.key.fromMe ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : (msg.key.participant || from);
        
        const isGroup = from.endsWith('@g.us');

        const state = getBotState();
        const senderNumber = sender.split('@')[0];
        const isOwner = CONFIG.owners.includes(senderNumber);

        if (!state.active) {
            if (command !== 'activarbot' || !isOwner) {
                return;
            }
        }

        let isAdmin = false;
        if (isGroup) {
            try {
                const groupMetadata = await sock.groupMetadata(from);
                const participant = groupMetadata.participants.find(p => p.id === sender);
                isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
            } catch (e) {
                console.error('Error obteniendo metadata:', e);
            }
        }

        const hasPermission = isOwner || isAdmin || msg.key.fromMe;

        try {
            switch (command) {
                case 'activarbot':
                    if (!hasPermission) return;
                    setBotState(true);
                    await sock.sendMessage(from, { text: '✅ Bot activado correctamente.' });
                    break;

                case 'desactivarbot':
                    if (!hasPermission) return;
                    setBotState(false);
                    await sock.sendMessage(from, { text: '❌ Bot desactivado. Solo los dueños pueden activarlo de nuevo.' });
                    break;

                case 'ban':
                case 'kick':
                    if (!hasPermission) return;
                    const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    if (mentioned.length > 0) {
                        await sock.groupParticipantsUpdate(from, mentioned, 'remove');
                        await sock.sendMessage(from, { text: '🚫 Usuario(s) eliminado(s).' });
                    } else {
                        await sock.sendMessage(from, { text: '⚠️ Debes mencionar a alguien para banearlo.' });
                    }
                    break;

                case 'promote':
                case 'demote':
                    if (!hasPermission) return;
                    const target = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    if (target.length > 0) {
                        await sock.groupParticipantsUpdate(from, target, command === 'promote' ? 'promote' : 'demote');
                        await sock.sendMessage(from, { text: `✅ Acción realizada.` });
                    }
                    break;

                case 'abrir':
                    if (!hasPermission) return;
                    await sock.groupSettingUpdate(from, 'not_announcement'); 
                    await sock.sendMessage(from, { text: '🔓 Grupo abierto.' });
                    break;

                case 'cerrar':
                    if (!hasPermission) return;
                    await sock.groupSettingUpdate(from, 'announcement'); 
                    await sock.sendMessage(from, { text: '🔒 Grupo cerrado.' });
                    break;

                case 'adv':
                    if (!hasPermission) return;
                    await sock.sendMessage(from, { text: '⚠️ Advertencia enviada (Simulado).' });
                    break;

                case 'mute':
                    if (!hasPermission) return;
                    await sock.sendMessage(from, { text: '🔇 Bot silenciado (Simulado).' });
                    break;

                default:
                    break;
            }
        } catch (error) {
            console.error('Error ejecutando comando:', error);
            if (!msg.key.fromMe) {
                await sock.sendMessage(from, { text: '❌ Error ejecutando la acción. Asegúrate de que el bot sea administrador.' });
            }
        }
    });
}

startBot();
