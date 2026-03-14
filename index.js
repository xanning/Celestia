const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const fs = require('fs');
const readline = require('readline');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { spawn } = require('child_process');
const { HttpsProxyAgent } = require('https-proxy-agent');
const axios = require('axios'); 

const CONFIG = {
    spawnConsoleWindows: 'true', // Set to 'false' to disable, 'true' for all bots, or 'singular' for only first bot
    mode: null, // Will be set on startup: 'bedwars' or 'lobby'
    gameMode: 'bedwars_eight_one', // solos, doubles: bedwars_eight_two, threes: bedwars_four_three, fours: bedwars_four_four
    tokensFile: 'tokens.txt',
    proxiesFile: 'proxies.txt', // Optional, format: type://user:pass@host:port or type://host:port
    botIdentifier: generateRandomString(8),
    // stupid chat phrases
    chatPhrases: [
        'gl hf lelz',
        'but why would lz',
        'this maybe google it',
        'not in the way of',
        'dont really like',
        'good not luck have not fun',
        'bed wars when we',
        'hello mark youtube wer',
        'game hooker loop',
        'prepared lez'
    ],
    inGameActions: {
        shopVisitChance: 0.7, // these dont actually do anything
        chestVisitChance: 0.6,
        randomWalkChance: 0.8,
        actionInterval: 10000 
    },
    lobbyMode: {
        messageInterval: 4000, // 4 seconds
        messageTemplate: 'im a spammer i like spamming!!! |  '
    }
};

async function getProfileFromToken(accessToken) {
    try {
        
        
        const response = await axios.get('https://api.minecraftservices.com/minecraft/profile', {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (response.data && response.data.id && response.data.name) {
            return {
                username: response.data.name,
                uuid: response.data.id,
                accessToken: accessToken
            };
        }
    } catch (error) {
        if (error.response) {
            console.error(`Error getting profile from token: HTTP ${error.response.status} - ${error.response.statusText}`);
            if (error.response.status === 401) {
                console.error('Token is invalid or expired');
            }
        } else {
            console.error(`Error getting profile from token: ${error.message}`);
        }
    }
    return null;
}


async function getUUIDFromUsername(username) {
    try {
       
        const response = await axios.get(`https://api.minecraftservices.com/minecraft/profile/lookup/name/${username}`);
        
        if (response.data && response.data.id) {
            return response.data.id;
        }
    } catch (error) {
    
        try {
            const notso = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${username}`);
            if (notso.data && notso.data.id) {
                return notso.data.id;
            }
        } catch (notsoError) {
            if (error.response && error.response.status === 204) {
                console.error(`Username "${username}" does not exist`);
            } else if (error.response && error.response.status === 404) {
                console.error(`Username "${username}" not found`);
            } else {
                console.error(`Error fetching UUID for ${username}: ${error.message}`);
            }
        }
    }
    return null;
}

class BotManager {
    constructor() {
        this.bots = new Map();
        this.lobbyGroups = new Map(); 
        this.botStates = new Map();
        this.pregameBots = new Set(); 
    }

    addBot(username, botInstance) {
        this.bots.set(username, botInstance);
        this.updateBotState(username, 'INITIALIZING');
    }

    removeBot(username) {
        this.bots.delete(username);
        this.botStates.delete(username);
    }

    updateBotState(username, state, extraData = {}) {
        this.botStates.set(username, { state, ...extraData, timestamp: Date.now() });
        this.printDashboard();
    }
    updateLobbyInfo(username, lobbyId, mapName = null) {
        if (!this.lobbyGroups.has(lobbyId)) {
            this.lobbyGroups.set(lobbyId, new Set());
        }
        this.lobbyGroups.get(lobbyId).add(username);
    
        const botState = this.botStates.get(username);
        if (botState) {
            botState.lobbyId = lobbyId;
            if (mapName) {
                botState.mapName = mapName;
            }
        }
    
      
        this.printDashboard();
    }
    

    removeBotFromLobby(username) {
        for (const [lobbyId, bots] of this.lobbyGroups.entries()) {
            if (bots.has(username)) {
                bots.delete(username);
                if (bots.size === 0) {
                    this.lobbyGroups.delete(lobbyId);
                }
            }
        }
        
        const botState = this.botStates.get(username);
        if (botState) {
            delete botState.lobbyId;
            delete botState.mapName;
        }
    }

    printDashboard() {
        console.clear();
        process.stdout.write('\x1Bc');
        console.log('═══════════════════════════════════════════════════════════════════');
        console.log('          Celestia');
        console.log('═══════════════════════════════════════════════════════════════════');
        console.log(`Session ID: ${CONFIG.botIdentifier} | Mode: ${CONFIG.mode || 'N/A'} | Game: ${CONFIG.gameMode}`);
        console.log(`Total Bots: ${this.bots.size} | Active: ${Array.from(this.botStates.values()).filter(s => s.state !== 'DISCONNECTED').length}`);
        console.log('───────────────────────────────────────────────────────────────────');
        
    
        const stateGroups = new Map();
        for (const [username, stateData] of this.botStates.entries()) {
            if (!stateGroups.has(stateData.state)) {
                stateGroups.set(stateData.state, []);
            }
            stateGroups.get(stateData.state).push({ username, ...stateData });
        }

      
        const stateOrder = CONFIG.mode === 'lobby' 
            ? ['LOBBY_SPAM', 'LOBBY', 'INITIALIZING', 'DISCONNECTED']
            : ['IN_GAME', 'PREGAME_LOBBY', 'QUEUEING', 'LOBBY', 'INITIALIZING', 'DISCONNECTED'];
            
        for (const state of stateOrder) {
            if (stateGroups.has(state)) {
                const bots = stateGroups.get(state);
                console.log(`\n${getStateIcon(state)} ${state} (${bots.length}):`);
                bots.forEach(bot => {
                    let infoStr = `  • ${bot.username}`;
                    if (bot.lobbyId) {
                        infoStr += ` [Server: ${bot.lobbyId}]`;
                    }
                    if (bot.mapName) {
                        infoStr += ` [Map: ${bot.mapName}]`;
                    }
                    if (bot.extraInfo) {
                        infoStr += bot.extraInfo;
                    }
                    console.log(infoStr);
                });
            }
        }

        
        if (CONFIG.mode === 'bedwars' && this.lobbyGroups.size > 0) {
            console.log('\n───────────────────────────────────────────────────────────────────');
            console.log('🎮 PREGAME LOBBY GROUPS:');
            for (const [lobbyId, bots] of this.lobbyGroups.entries()) {
                if (bots.size > 0) {
                    console.log(`\n  Server ${lobbyId} (${bots.size} bots):`);
                    bots.forEach(username => {
                        const botState = this.botStates.get(username);
                        const mapInfo = botState && botState.mapName ? ` - ${botState.mapName}` : '';
                        console.log(`    ✓ ${username}${mapInfo}`);
                    });
                }
            }
        }

        console.log('\n═══════════════════════════════════════════════════════════════════');
        if (CONFIG.mode === 'bedwars') {
            console.log('Commands: Type bot number (1-N) to requeue | "all" to requeue all | "quit" to exit');
        } else {
            console.log('Commands: "quit" to exit');
        }
        console.log('═══════════════════════════════════════════════════════════════════\n');
    }
}

const manager = new BotManager();


function generateRandomString(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function getRandomPhrase() {
    return CONFIG.chatPhrases[Math.floor(Math.random() * CONFIG.chatPhrases.length)];
}

function getStateIcon(state) {
    const icons = {
        'IN_GAME': '⚔️',
        'PREGAME_LOBBY': '⏳',
        'QUEUEING': '🔄',
        'LOBBY': '🏠',
        'LOBBY_SPAM': '💬',
        'INITIALIZING': '🔧',
        'DISCONNECTED': '❌'
    };
    return icons[state] || '•';
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadTokens() {
    const lines = fs.readFileSync(CONFIG.tokensFile, 'utf8')
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);
    
    const tokens = [];
    const updatedLines = [];
    let needsUpdate = false;

    for (const line of lines) {
        const parts = line.split(':');
        
        if (parts.length === 3) {
            const [username, uuid, accessToken] = parts;
            tokens.push({ username, uuid, accessToken });
            updatedLines.push(line);
        }
        
        else if (parts.length === 2) {
            const [identifier, token] = parts;
            
            
            if (identifier.length <= 16 && /^[a-zA-Z0-9_]+$/.test(identifier)) {
                console.log(`Fetching UUID: "${identifier}"...`);
                
               
                const uuid = await getUUIDFromUsername(identifier);
                
                if (uuid) {
                    tokens.push({ username: identifier, uuid: uuid, accessToken: token });
                    updatedLines.push(`${identifier}:${uuid}:${token}`);
                    needsUpdate = true;
                    console.log(`Retrieved UUID for ${identifier}: ${uuid}`);
                } else {
                    console.error(`Failed to get UUID for ${identifier}, skipping...`);
                    updatedLines.push(line); 
                }
            } else {
                console.error(`Invalid format: ${line}`);
                updatedLines.push(line);
            }
            
            
            await sleep(300);
        }
        
        else if (parts.length === 1) {
            const token = parts[0];
            console.log(`Processing token: ` + `${token.substring(0, 10)}...`);
            
            const profile = await getProfileFromToken(token);
            
            if (profile) {
                tokens.push(profile);
                updatedLines.push(`${profile.username}:${profile.uuid}:${profile.accessToken}`);
                needsUpdate = true;
                console.log(`Retrieved profile from token: ${profile.username} (${profile.uuid})`);
            } else {
                console.error(`Failed to get profile from token, skipping...`);
                updatedLines.push(line); 
            }
            
            
            await sleep(300);
        }
        else {
            console.error(`Invalid token format: ${line}`);
            updatedLines.push(line);
        }
    }


    if (needsUpdate) {
        console.log('\nUpdating tokens.txt with retrieved usernames and UUIDs...');
        fs.writeFileSync(CONFIG.tokensFile, updatedLines.join('\n') + '\n');
        console.log('tokens.txt has been updated!\n');
    }

    return tokens;
}



function loadProxies() {
    if (!fs.existsSync(CONFIG.proxiesFile)) {
        console.log('No proxies file found, bots will connect directly without proxies');
        return [];
    }
    const proxies = fs.readFileSync(CONFIG.proxiesFile, 'utf-8')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    
    if (proxies.length === 0) {
        console.log('Proxies file is empty, bots will connect directly without proxies');
    }
    
    return proxies;
}

function createProxyAgent(proxyString) {
    if (!proxyString) return null;
    
    try {
        if (proxyString.startsWith('socks4://') || proxyString.startsWith('socks5://')) {
            return new SocksProxyAgent(proxyString);
        } else if (proxyString.startsWith('http://') || proxyString.startsWith('https://')) {
            return new HttpsProxyAgent(proxyString);
        }
    } catch (error) {
        console.error(`Failed to create proxy agent: ${error.message}`);
    }
    return null;
}

let _botIndex = 0;

class BedwarsBot {
    constructor(tokenData, proxy = null) {
        this.username = tokenData.username;
        this.uuid = tokenData.uuid;
        this.accessToken = tokenData.accessToken;
        this.proxy = proxy;
        this.bot = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.pregameAnnouncePhrase = `${CONFIG.botIdentifier} ${getRandomPhrase()}`;
        this.hasAnnouncedInPregame = false;
        this.inGameInterval = null;
        this.lobbySpamInterval = null;
        this.currentState = 'INITIALIZING';
        this.lobbyId = null;
        this.mapName = null;
        this.policiesAccepted = false;
        this._instanceIndex = _botIndex++;
        
        
        const logDir = './logs';
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        this.logFile = `${logDir}/bot_${this.username}_log.txt`;
       


       
        fs.writeFileSync(this.logFile, `=== ${this.username} CONSOLE LOGS ===\n`);
        
        const shouldSpawn = CONFIG.spawnConsoleWindows === 'true' || (CONFIG.spawnConsoleWindows === 'singular' && this._instanceIndex === 0);
        if (shouldSpawn) {
            const openLogWindow = (logFile) => {
                const logCommand = `powershell -command "Get-Content ${logFile} -Wait"`;
                spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', logCommand], { shell: true });
            };
            openLogWindow(this.logFile);
        }
    }

    logToChild(message) {
        const timestamp = new Date().toLocaleTimeString();
        const logMessage = `[${timestamp}] ${message}`;
        fs.appendFileSync(this.logFile, logMessage + '\n');
    }

    async connect() {
        const botOptions = {
            host: 'mc.hypixel.net',
            port: 25565,
            version: '1.8.9',
            auth: 'mojang',
            skipValidation: true,
            profilesFolder: './auth_cache',
            session: {
                accessToken: this.accessToken,
                selectedProfile: {
                    id: this.uuid,
                    name: this.username
                }
            }
        };

        if (this.proxy) {
            botOptions.agent = createProxyAgent(this.proxy);
        }

        try {
            this.bot = mineflayer.createBot(botOptions);
            this.setupEventHandlers();
            manager.addBot(this.username, this);
            this.logToChild('✅ Bot connected successfully');
        } catch (error) {
            this.logToChild(`❌ Failed to connect: ${error.message}`);
            this.handleDisconnect();
        }
    }

    setupEventHandlers() {
        this.bot.once('login', () => {
            this.username = this.bot.username;
            this.currentState = 'LOBBY';
            manager.updateBotState(this.username, 'LOBBY');
            this.logToChild('Logged in successfully');
        });
    
        this.bot.once('spawn', async () => {
            try {
              
                let attempts = 0;
                while (!this.bot.entity && attempts < 50) {
                    await sleep(100);
                    attempts++;
                }
                
                if (!this.bot.entity) {
                    this.logToChild('Bot entity not inited, retrying spawn...');
                    return;
                }
    
                this.logToChild('Entity spawned, waiting for chunks...');
                this.bot.chat("/language English") // failsafe because apperantly theres ppl that dont speak english lol!!!!
              
                await this.bot.waitForChunksToLoad();
                
                await sleep(2000);
                
                this.logToChild('Chunks loaded');
                
                if (CONFIG.mode === 'lobby') {
                    this.startLobbyMode();
                } else {
                    this.queueGame();
                }
            } catch (error) {
                this.logToChild(`❌ Spawn error: ${error.message}`);
             
                await sleep(3000);
                if (this.bot && this.bot._client) {
                    if (CONFIG.mode === 'lobby') {
                        this.startLobbyMode();
                    } else {
                        this.queueGame();
                    }
                }
            }
        });
        
        this.bot._client.on('custom_payload', async (packet) => {
            if (!this.policiesAccepted && packet.channel === 'MC|BOpen') {
                this.logToChild('Book GUI detected, checking for policies...');
                await sleep(500); 
                this.checkAndAcceptPolicies();
            }
        });
        
        let policiesCheckCount = 0;
        const policiesCheckInterval = setInterval(() => {
            if (this.policiesAccepted || policiesCheckCount >= 15) {
                clearInterval(policiesCheckInterval);
                return;
            }
            policiesCheckCount++;
            this.checkAndAcceptPolicies();
        }, 2000);
    
        this.bot.on('message', async (message) => {
            const msg = message.toString();
            this.logToChild(`[CHAT]: ${msg}`);
            
            if (CONFIG.mode === 'bedwars') {
                await this.handleMessage(msg);
            } else {
                await this.handleLobbyMessage(msg);
            }
        });
    
        this.bot.on('end', () => {
            this.logToChild('Bot disconnected');
            this.handleDisconnect();
        });
    
        this.bot.on('kicked', (reason) => {
            this.logToChild(`⚠️ KICKED: ${reason}`);
            this.handleDisconnect();
        });
    
        this.bot.on('error', (error) => {
            this.logToChild(`❌ ERROR: ${error.message}`);
        });
    }

    checkAndAcceptPolicies() {
        try {
            if (this.policiesAccepted || !this.bot) return;
            
                this.logToChild('Hypixel policies book detected');
                
                
                this.bot.chat('/policies accept');
                this.policiesAccepted = true;
                this.logToChild('Sent /policies accept command');
                
              
                setTimeout(() => {
                    try {
                        if (this.bot && this.bot.currentWindow) {
                            this.bot.closeWindow(this.bot.currentWindow);
                            this.logToChild('Closed book window');
                        }
                    } catch (e) {
                        this.logToChild(`Could not close window: ${e.message}`);
                    }
                }, 500);
            
        } catch (error) {
            this.logToChild(`Error checking policies: ${error.message}`);
            this.logToChild(`what: ${error.stack}`);
        }}
    

    async handleLobbyMessage(msg) {
       
        if (msg.includes('joined the lobby!') || msg.includes('You are now in')) {
            // dont rly do smthn
        }
    }

    async startLobbyMode() {
        this.logToChild('Starting lobby mode sequence');
        
        await sleep(1000);
        this.bot.chat(`/play ${CONFIG.gameMode}`);
        this.logToChild(`Joined ${CONFIG.gameMode}`);
        

        await sleep(2000);
        this.bot.chat('/l');
        this.logToChild('Sent /l command');
        
        await sleep(1000);
        this.bot.chat('/swaplobby 1');
        this.logToChild('Switched to lobby 1');
    
        await sleep(2000);
        
        this.currentState = 'LOBBY_SPAM';
        manager.updateBotState(this.username, 'LOBBY_SPAM');
        this.startLobbySpam();
    }

    startLobbySpam() {
        this.logToChild('Starting lobby spam');
        
        if (this.lobbySpamInterval) {
            clearInterval(this.lobbySpamInterval);
        }
        
        this.lobbySpamInterval = setInterval(() => {
            if (this.bot && this.bot._client && CONFIG.mode === 'lobby') {
                const randomChars = generateRandomString(23);
                const message = `${CONFIG.lobbyMode.messageTemplate} ${randomChars}`;
                this.bot.chat(message);
                this.logToChild(`Sent: ${message}`);
            }
        }, CONFIG.lobbyMode.messageInterval);
    }

    stopLobbySpam() {
        if (this.lobbySpamInterval) {
            clearInterval(this.lobbySpamInterval);
            this.lobbySpamInterval = null;
            this.logToChild('Stopped lobby spam');
        }
    }

    async handleMessage(msg) {
        
        const joinMatch = msg.match(/(.+) has joined \((\d+)\/(\d+)\)!/);
        if (joinMatch) {
            const joinedPlayer = joinMatch[1];
            const current = parseInt(joinMatch[2]);
            const max = parseInt(joinMatch[3]);
            
           
            if (joinedPlayer === this.username) {
                this.currentState = 'PREGAME_LOBBY';
                manager.updateBotState(this.username, 'PREGAME_LOBBY', { extraInfo: ` (${current}/${max})` });
                await this.getLobbyInfo();
            }
            return;
        }

        
        if (msg.includes(': ')) {
            if (msg.includes(CONFIG.botIdentifier)) {
                const match = msg.match(/(\w+): (.+)/);
                if (match && match[2].startsWith(CONFIG.botIdentifier)) {
                    const senderUsername = match[1];
                    if (this.lobbyId && senderUsername !== this.username) {
                        manager.updateLobbyInfo(senderUsername, this.lobbyId, this.mapName);
                    }
                }
            }
            return;
        }

        
        if (msg.includes('The game starts in 5 seconds!')) {
            if (!this.hasAnnouncedInPregame && this.bot && this.bot._client) {
                await sleep(100);
                this.bot.chat(this.pregameAnnouncePhrase);
                this.hasAnnouncedInPregame = true;
                this.logToChild(`Announced in pregame: ${this.pregameAnnouncePhrase}`);
            }
        }

       
        if (msg.includes('Protect your bed and destroy')) {
            this.hasAnnouncedInPregame = false;
            this.currentState = 'IN_GAME';
            manager.removeBotFromLobby(this.username);
            manager.updateBotState(this.username, 'IN_GAME');
            this.logToChild('Game started! Beginning in-game behavior...');
            await sleep(1000);
            await this.startInGameBehavior();
        }

       
        if (msg.includes('1st Killer') || msg.includes('1st Place') || msg.includes('Winner') || 
            msg.includes('Reward Summary') ||
            (msg.includes(this.username) && msg.includes('FINAL KILL'))) {
            this.logToChild('Game ended');
            this.stopInGameActions();
            manager.removeBotFromLobby(this.username);
            await sleep(2000);
            this.queueGame();
        }

       
        if (msg.includes('You were spawned in limbo') || msg.includes('A kick occurred')) {
            this.logToChild('In limbo, returning to lobby');
            if (this.bot && this.bot._client) {
                this.bot.chat('/lobby');
                await sleep(1000);
                this.queueGame();
            }
        }

       
        if (msg.includes('joined the lobby!')) {
            this.logToChild('Joined bedwars lobby');
            this.stopInGameActions();
            manager.removeBotFromLobby(this.username);
            this.currentState = 'LOBBY';
            manager.updateBotState(this.username, 'LOBBY');
        }

        
        if (msg.includes('You were kicked for inactivity!')) {
            this.logToChild('Kicked for inactivity, rejoining...');
            await sleep(3000);
            if (this.bot && this.bot._client) {
                this.bot.chat('/rejoin');
            }
        }
    }

    async getLobbyInfo() {
        if (!this.bot || !this.bot._client) return;
        
        await sleep(500);
        this.bot.chat('/locraw');
        
       
        const locrawListener = (message) => {
            const msg = message.toString();
            if (msg.startsWith('{') && msg.includes('server')) {
                try {
                    const data = JSON.parse(msg);
                    if (data.server) {
                        this.lobbyId = data.server;
                        this.mapName = data.map || null;
                        manager.updateLobbyInfo(this.username, this.lobbyId, this.mapName);
                        this.logToChild(`Lobby Info - Server: ${this.lobbyId}, Map: ${this.mapName || 'Unknown'}`);
                    }
                } catch (e) {
                    
                }
                this.bot.removeListener('message', locrawListener);
            }
        };
        
        this.bot.on('message', locrawListener);
        
        
        setTimeout(() => {
            this.bot.removeListener('message', locrawListener);
        }, 3000);
    }

    queueGame() {
        this.stopInGameActions();
        if (!this.bot || !this.bot._client) {
            this.logToChild('Bot not ready, skipping queue');
            return;
        }
        this.currentState = 'QUEUEING';
        manager.updateBotState(this.username, 'QUEUEING');
        this.bot.chat(`/play ${CONFIG.gameMode}`);
        this.logToChild(`Queuing for ${CONFIG.gameMode}`);
    }


    async startInGameBehavior() {
        this.logToChild('Starting in-game behavior');
        
        
        await sleep(500);
        this.bot.clearControlStates();
        this.bot.setControlState('back', true);
        this.bot.setControlState('jump', true);
        await sleep(3000);
        this.bot.clearControlStates();
        
        this.logToChild('Starting periodic actions');
    
       
        this.inGameInterval = setInterval(() => {
            if (this.currentState === 'IN_GAME') {
                this.performRandomAction();
            }
        }, CONFIG.inGameActions.actionInterval);
    }
    
    async performRandomAction() {
        if (!this.bot || this.currentState !== 'IN_GAME') return;
        if (this.isPerformingAction) {
            this.logToChild('Action already in progress, skipping...');
            return;
        }
    
        this.isPerformingAction = true;
    
        try {
            const timeoutPromise = new Promise((resolve) => {
                setTimeout(() => {
                    this.logToChild('Action timeout - forcing completion');
                    this.bot.clearControlStates();
                    resolve();
                }, 8000);
            });
    
            await Promise.race([this.randomWalk(), timeoutPromise]);
        } catch (e) {
            this.logToChild(`Action error: ${e.message}`);
            this.bot.clearControlStates();
        } finally {
            this.isPerformingAction = false;
            this.logToChild('Action completed, ready for next action');
        }
    }
    
  
    async simpleWalkTowards(targetPos, duration = 3000) {
        const startPos = this.bot.entity.position.clone();
        const dx = targetPos.x - startPos.x;
        const dz = targetPos.z - startPos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance < 1) {
            this.logToChild('Already at target');
            return true;
        }
        
      
        const yaw = Math.atan2(-dx, -dz);
        await this.bot.look(yaw, 0, true);
        await sleep(100);
        
        this.logToChild(`walk towards target (${distance.toFixed(1)}m away)`);
        
       
        this.bot.setControlState('forward', true);
        this.bot.setControlState('jump', true);
        
        
        const startTime = Date.now();
        let lastProgress = 0;
        
        return new Promise((resolve) => {
            const progressCheck = setInterval(() => {
                const currentPos = this.bot.entity.position;
                const currentDist = Math.sqrt(
                    Math.pow(targetPos.x - currentPos.x, 2) + 
                    Math.pow(targetPos.z - currentPos.z, 2)
                );
                
               
                if (currentDist < 2) {
                    this.bot.clearControlStates();
                    clearInterval(progressCheck);
                    this.logToChild('walk completed (reached target)');
                    resolve(true);
                } else if (Date.now() - startTime > duration) {
                    this.bot.clearControlStates();
                    clearInterval(progressCheck);
                    this.logToChild('walk completed (timeout)');
                    resolve(true);
                }
                
                
                if (Math.abs(currentDist - lastProgress) < 0.1) {
                    const timeSinceStart = Date.now() - startTime;
                    if (timeSinceStart > 1000) {
                        this.bot.clearControlStates();
                        clearInterval(progressCheck);
                        this.logToChild('walk: appears stuck, completing');
                        resolve(false);
                    }
                } else {
                    lastProgress = currentDist;
                }
            }, 200);
        });
    }
    
    async randomWalk() {
        if (!this.bot || this.currentState !== 'IN_GAME') {
            this.logToChild('Bot not ready');
            return;
        }
    
        try {
            const pos = this.bot.entity.position;
            const randomOffset = new Vec3(
                Math.floor(Math.random() * 12) - 6,
                0,
                Math.floor(Math.random() * 12) - 6
            );
            const targetPos = pos.plus(randomOffset);
    
            this.logToChild(`Walking to (${targetPos.x.toFixed(1)}, ${targetPos.y.toFixed(1)}, ${targetPos.z.toFixed(1)})`);
            await this.simpleWalkTowards(targetPos, 3000);
        } catch (e) {
            this.logToChild(`Walk failed: ${e.message}`);
            this.bot.clearControlStates();
        }
    }
    
    stopInGameActions() {
        if (this.inGameInterval) {
            clearInterval(this.inGameInterval);
            this.inGameInterval = null;
            this.logToChild('Stopped in-game actions');
        }
        
        if (this.bot) {
            this.bot.clearControlStates();
        }
    }

    handleDisconnect() {
        this.stopInGameActions();
        this.stopLobbySpam();
        this.currentState = 'DISCONNECTED';
        manager.updateBotState(this.username, 'DISCONNECTED');
        this.logToChild('🔴 DISCONNECTED - Attempting reconnect...');
        
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            this.logToChild(`🔄 Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
            setTimeout(() => {
                this.connect();
            }, 30000);
        } else {
            this.logToChild('❌ Max reconnection attempts exceeded');
            manager.removeBot(this.username);
        }
    }

    forceRequeue() {
        this.stopInGameActions();
        if (this.bot && this.bot._client) {
            this.bot.chat('/lobby');
            this.logToChild('Force requeue requested');
            setTimeout(() => {
                this.queueGame();
            }, 2000);
        } else {
            this.logToChild('Bot not connected, cannot requeue');
        }
    }

    disconnect() {
        this.stopInGameActions();
        this.stopLobbySpam();
        if (this.bot) {
            this.bot.quit();
        }
        this.logToChild('Bot shutting down');
        manager.removeBot(this.username);
    }
}


async function main() {
    console.log('Loading configuration...');
    
    const tokens = await loadTokens();
    const proxies = loadProxies();
    
    console.log(`Loaded ${tokens.length} tokens`);
    if (proxies.length > 0) {
        console.log(`Loaded ${proxies.length} proxies`);
    } else {
        console.log('No proxies configured - connecting directly');
    }
    console.log(`Bot Session ID: ${CONFIG.botIdentifier}`);
    console.log(`Console Windows: ${CONFIG.spawnConsoleWindows ? 'Enabled' : 'Disabled'}`);
    
    axios.get('https://wtfismyip.com/json').then(response => {
        console.log(`Running on IP: ${response.data.YourFuckingIPAddress}`);
        console.log(`Running on Location: ${response.data.YourFuckingLocation}`);
    }).catch(error => {
        console.log('Could not fetch public IP address');
    });
    
    // Mode selection
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('Select Mode:');
    console.log('1) Bedwars (queue and play games)');
    console.log('2) Lobby (spam messages in lobby)');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    await new Promise(resolve => {
        rl.question('Enter mode (1 or 2): ', (answer) => {
            const mode = answer.trim();
            if (mode === '1') {
                CONFIG.mode = 'bedwars';
                console.log('\nBedwars mode selected');
            } else if (mode === '2') {
                CONFIG.mode = 'lobby';
                console.log('\nLobby mode selected');
            } else {
                console.log('\nInvalid selection, defaulting to Bedwars mode');
                CONFIG.mode = 'bedwars';
            }
            resolve();
        });
    });
    
    console.log(`Game Mode: ${CONFIG.gameMode}`);
    console.log('\nPress enter to continue...\n');
    
    await new Promise(resolve => {
        rl.question('', () => {
            resolve();
        });
    });
    
    console.log('\nhm..\n');

  
    const bots = [];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const proxy = proxies.length > 0 ? proxies[i % proxies.length] : null;
        const bot = new BedwarsBot(token, proxy);
        bots.push(bot);
        
        
        await sleep(1000);
        bot.connect();
    }

   
    rl.on('line', (input) => {
        const command = input.trim().toLowerCase();
        
        if (command === 'quit') {
            console.log('Shutting down all bots...');
            bots.forEach(bot => bot.disconnect());
            process.exit(0);
        } else if (CONFIG.mode === 'bedwars') {
            if (command === 'all') {
                console.log('Requeueing all bots...');
                bots.forEach(bot => bot.forceRequeue());
            } else {
                const botIndex = parseInt(command) - 1;
                if (botIndex >= 0 && botIndex < bots.length) {
                    console.log(`Requeueing bot ${botIndex + 1}...`);
                    bots[botIndex].forceRequeue();
                }
            }
        }
    });
}


main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
