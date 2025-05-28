import TelegramBot from "node-telegram-bot-api";
import { readFile, writeFile } from "fs/promises";

class DataStorage {
    constructor(filename = "bot_data.json") {
        this.filename = filename;
        this.data = { users: {}, stats: { totalMessages: 0 } };
    }

    async loadData() {
        try {
            const fileContent = await readFile(this.filename, "utf8");
            this.data = JSON.parse(fileContent);
        } catch {
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
                reminders: [],
                messageCount: 0,
                firstSeen: new Date().toISOString(),
                lastSeen: new Date().toISOString(),
                firstName: null,
                username: null,
            };
        }
        return this.data.users[userId];
    }

    updateUser(userId, updates) {
        const user = this.getUser(userId);
        Object.assign(user, updates);
        user.lastSeen = new Date().toISOString();
        this.saveData();
    }
}

async function main() {
    const token = (await readFile("token.txt", "utf8")).trim();
    const bot = new TelegramBot(token, { polling: true });
    console.log("Bot avviato con successo!");

    const storage = new DataStorage();
    await storage.loadData();

    const pendingReminders = new Map();

    bot.onText(/\/add/, (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        pendingReminders.set(userId, { step: 1, reminder: {} });
        bot.sendMessage(chatId, "📝 *Messaggio di promemoria?*", {
            parse_mode: "Markdown",
        });
    });

    bot.on("message", (msg) => {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        const text = msg.text;

        if (!text || text.startsWith("/")) return;

        if (pendingReminders.has(userId)) {
            const session = pendingReminders.get(userId);

            switch (session.step) {
                case 1:
                    session.reminder.msg = text;
                    session.step = 2;
                    bot.sendMessage(
                        chatId,
                        "📅 *Data del promemoria?* (es: 30/05/2025)",
                        { parse_mode: "Markdown" }
                    );
                    break;

                case 2:
                    session.reminder.date = text;
                    session.step = 3;
                    bot.sendMessage(chatId, "⏰ *Ora?* (es: 14:30)", {
                        parse_mode: "Markdown",
                    });
                    break;

                case 3:
                    const fullDateStr = `${session.reminder.date} ${text}`;
                    const parts = fullDateStr.split(/[\s/:]/); // [gg, mm, aaaa, hh, mm]

                    if (parts.length < 5) {
                        bot.sendMessage(
                            chatId,
                            "❌ Formato data/ora non valido. Riprova con /add"
                        );
                        pendingReminders.delete(userId);
                        return;
                    }

                    const reminderDate = new Date(
                        `${parts[2]}-${parts[1]}-${parts[0]}T${parts[3]}:${parts[4]}:00`
                    );

                    if (isNaN(reminderDate)) {
                        bot.sendMessage(
                            chatId,
                            "❌ Formato data/ora non valido. Riprova con /add"
                        );
                        pendingReminders.delete(userId);
                        return;
                    }

                    session.reminder.datetime = reminderDate.toISOString();

                    const user = storage.getUser(userId);
                    if (!user.reminders) user.reminders = [];
                    user.reminders.push({
                        msg: session.reminder.msg,
                        datetime: session.reminder.datetime,
                    });

                    storage.updateUser(userId, user);

                    bot.sendMessage(
                        chatId,
                        `✅ Promemoria salvato per il ${reminderDate.toLocaleString(
                            "it-IT"
                        )}`
                    );
                    pendingReminders.delete(userId);
                    break;
            }
        }
    });

    bot.onText(/\/all/, (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const user = storage.getUser(userId);

        let res = `**I tuoi promemoria:**\n`;

        if (user.reminders && user.reminders.length > 0) {
            user.reminders.forEach((reminder, index) => {
                const date = new Date(reminder.datetime);
                res += `\n*${index + 1}.* ${
                    reminder.msg
                }\n🕒 ${date.toLocaleString("it-IT")}\n`;
            });
        } else {
            res += "Nessun promemoria impostato.";
        }

        bot.sendMessage(chatId, res, { parse_mode: "Markdown" });
    });
}

main();
