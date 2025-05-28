import TelegramBot from "node-telegram-bot-api";
import { readFile, writeFile } from "fs/promises";
// Sostituisci questo token con quello fornito da BotFather
const token = (await readFile("token.txt", "utf8")).trim();
// Crea un'istanza del bot utilizzando il polling per ricevere i messaggi
const bot = new TelegramBot(token, { polling: true });
console.log("Bot avviato con successo!");

class DataStorage {
    constructor(filename = "bot_data.json") {
        this.filename = filename;
        this.data = {};
        this.loadData();
    }
    async loadData() {
        try {
            const fileContent = await readFile(this.filename, "utf8");
            this.data = JSON.parse(fileContent);
        } catch (error) {
            this.data = { users: {}, stats: { totalMessages: 0 } };
            await this.saveData();
        }
    }
    async saveData() {
        try {
            await writeFile(this.filename, JSON.stringify(this.data, null, 2));
        } catch (error) {
            console.error("Errore nel salvataggio:", error);
        }
    }
    getUser(userId) {
        if (!this.data.users[userId]) {
            this.data.users[userId] = {
                id: userId,
                messageCount: 0,
                firstSeen: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
            };
        }
        return this.data.users[userId];
    }
    updateUser(userId, updates) {
        const user = this.getUser(userId);
        Object.assign(user, updates, { lastSeen: new Date().toISOString() });

        this.saveData();
    }
    incrementMessageCount(userId) {
        const user = this.getUser(userId);
        user.messageCount++;
        this.data.stats.totalMessages++;
        this.saveData();
    }
}

// Utilizzo del sistema di storage
const storage = new DataStorage();
bot.on("message", (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    // Aggiorna le statistiche dell'utente
    storage.incrementMessageCount(userId);
    storage.updateUser(userId, {
        firstName: msg.from.first_name,
        username: msg.from.username,
    });
});

// Comando per vedere le proprie statistiche
bot.onText(/\/mystats/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const user = storage.getUser(userId);
    const statsMessage = `
**Le tue statistiche:**
Nome: ${user.firstName}
Messaggi inviati: ${user.messageCount}
Prima volta: ${new Date(user.firstSeen).toLocaleDateString("it-IT")}
Ultima attività: ${new Date(user.lastSeen).toLocaleDateString("it-IT")}
`;
    bot.sendMessage(chatId, statsMessage, { parse_mode: "Markdown" });
});

// Ascolta tutti i messaggi di testo
bot.on("message", (msg) => {
    const chatId = msg.chat.id;
    const messageText = msg.text;
    console.log(`Ricevuto messaggio da ${msg.from.first_name}:
${messageText}`);
    // Risponde con un saluto personalizzato
    bot.sendMessage(
        chatId,
        `Ciao ${msg.from.first_name}! Hai scritto:
"${messageText}"`
    );
});
