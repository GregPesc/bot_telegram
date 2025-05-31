import TelegramBot from "node-telegram-bot-api";
import { readFile, writeFile, rename } from "fs/promises";
import { existsSync, unlinkSync } from "fs";

class DataStorage {
  constructor(filename = "bot_data.json") {
    this.filename = filename;
    this.data = { users: {} };
  }

  async loadData() {
    try {
      const fileContent = await readFile(this.filename, "utf8");
      this.data = JSON.parse(fileContent);
    } catch {
      this.data = { users: {} };
      await this.saveData();
    }
  }
  async saveData() {
    try {
      // Use atomic write by writing to a temporary file first
      const tempFile = this.filename + ".tmp";
      await writeFile(tempFile, JSON.stringify(this.data, null, 2));

      // Only after successful write, replace the original file
      await rename(tempFile, this.filename);
    } catch (error) {
      console.error("Errore nel salvataggio:", error);
      // Try to clean up temp file if it exists
      try {
        const tempFile = this.filename + ".tmp";
        if (existsSync(tempFile)) {
          unlinkSync(tempFile);
        }
      } catch (cleanupError) {
        console.error(
          "Errore nella pulizia del file temporaneo:",
          cleanupError
        );
      }
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

  deleteReminder(userId, reminderId) {
    const user = this.getUser(userId);
    if (user.reminders) {
      user.reminders = user.reminders.filter((r) => r.id !== reminderId);
      this.saveData();
      return true;
    }
    return false;
  }

  clearReminders(userId, clearAll = false) {
    const user = this.getUser(userId);
    if (!user.reminders)
      return { deleted: 0, message: "Nessun promemoria da eliminare." };

    const initialCount = user.reminders.length;

    if (clearAll) {
      // Delete all reminders
      user.reminders = [];
      this.saveData();
      return {
        deleted: initialCount,
        message: `Eliminati tutti i ${initialCount} promemoria.`,
      };
    } else {
      // Delete only completed reminders
      const completedCount = user.reminders.filter((r) => r.sent).length;
      user.reminders = user.reminders.filter((r) => !r.sent);
      this.saveData();
      return {
        deleted: completedCount,
        message:
          completedCount > 0
            ? `Eliminati ${completedCount} promemoria completati.`
            : "Nessun promemoria completato da eliminare.",
      };
    }
  }

  getAllActiveReminders() {
    const now = new Date();
    const activeReminders = [];

    for (const userId in this.data.users) {
      const user = this.data.users[userId];
      if (user.reminders) {
        user.reminders.forEach((reminder) => {
          const reminderDate = new Date(reminder.datetime);
          if (reminderDate <= now && !reminder.sent) {
            activeReminders.push({
              userId: parseInt(userId),
              reminder: reminder,
            });
          }
        });
      }
    }
    return activeReminders;
  }

  markReminderAsSent(userId, reminderId) {
    const user = this.getUser(userId);
    if (user.reminders) {
      const reminder = user.reminders.find((r) => r.id === reminderId);
      if (reminder) {
        reminder.sent = true;
        this.saveData();
      }
    }
  }
}

async function main() {
  const token = (await readFile("token.txt", "utf8")).trim();
  const bot = new TelegramBot(token, { polling: true });
  console.log("Bot avviato con successo!");

  const storage = new DataStorage();
  await storage.loadData();

  const pendingReminders = new Map();
  const pendingDeletions = new Map();

  // Function to generate unique ID for reminders
  function generateReminderId() {
    return Date.now() + Math.random().toString(36).substr(2, 9);
  }

  // Function to check and send due reminders
  function checkReminders() {
    const activeReminders = storage.getAllActiveReminders();

    activeReminders.forEach(({ userId, reminder }) => {
      bot
        .sendMessage(userId, `🔔 *Promemoria:*\n\n${reminder.msg}`, {
          parse_mode: "Markdown",
        })
        .then(() => {
          storage.markReminderAsSent(userId, reminder.id);
        })
        .catch((err) => {
          console.error(`Errore nell'invio del promemoria a ${userId}:`, err);
        });
    });
  }

  // Check reminders every minute
  setInterval(checkReminders, 60000);

  // Commands
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `
🤖 *Bot Promemoria*

Comandi disponibili:
• /add - Crea un nuovo promemoria
• /list - Mostra tutti i tuoi promemoria
• /del - Elimina un promemoria
• /clear - Elimina promemoria completati
• /help - Mostra tutti i comandi nello specifico

Inizia creando il tuo primo promemoria con /add!
        `;
    bot.sendMessage(chatId, welcomeMessage, { parse_mode: "Markdown" });
  });
  bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const helpMessage = `
📖 *Guida Bot Promemoria*

*Comandi:*
• /add - Crea un nuovo promemoria
• /list - Mostra tutti i tuoi promemoria
• /del - Elimina un promemoria
• /clear - Elimina promemoria completati

*Come usare /add:*
1. Scrivi /add
2. Inserisci il messaggio del promemoria
3. Inserisci data e ora (es: 14:30 30/05/2025)

*Come usare /del:*
1. Scrivi /del
2. Scegli il numero del promemoria da eliminare

*Come usare /clear:*
• /clear - Elimina solo i promemoria completati
• /clear all - Elimina TUTTI i promemoria (anche quelli futuri)

I promemoria vengono inviati automaticamente alla data e ora specificata!
        `;
    bot.sendMessage(chatId, helpMessage, { parse_mode: "Markdown" });
  });

  bot.onText(/\/add/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    pendingReminders.set(userId, { step: 1, reminder: {} });
    bot.sendMessage(chatId, "📝 *Messaggio di promemoria?*", {
      parse_mode: "Markdown",
    });
  });

  // Consolidated message handler
  bot.on("message", (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const text = msg.text;

    // Ignore commands and bot's own messages
    if (!text || text.startsWith("/") || !msg.from || msg.from.is_bot) return; // Handle reminder deletion first (don't update user info during deletion to avoid race conditions)
    if (pendingDeletions.has(userId)) {
      const session = pendingDeletions.get(userId);

      // Handle confirmation for "clear all" command
      if (session.type === "clear_all" && session.awaitingConfirmation) {
        if (text.toUpperCase() === "CONFERMA") {
          const result = storage.clearReminders(userId, true);
          bot.sendMessage(chatId, `✅ ${result.message}`, {
            parse_mode: "Markdown",
          });
        } else {
          bot.sendMessage(
            chatId,
            "❌ Operazione annullata. I tuoi promemoria sono al sicuro.",
            {
              parse_mode: "Markdown",
            }
          );
        }
        pendingDeletions.delete(userId);
        return;
      }

      // Handle normal reminder deletion by index
      if (session.reminders) {
        const reminderIndex = parseInt(text) - 1;

        if (
          isNaN(reminderIndex) ||
          reminderIndex < 0 ||
          reminderIndex >= session.reminders.length
        ) {
          bot.sendMessage(chatId, "❌ Numero non valido. Riprova con /del");
          pendingDeletions.delete(userId);
          return;
        }

        const reminderToDelete = session.reminders[reminderIndex];
        const success = storage.deleteReminder(userId, reminderToDelete.id);

        if (success) {
          bot.sendMessage(
            chatId,
            `✅ Promemoria eliminato:\n"${reminderToDelete.msg}"`
          );
        } else {
          bot.sendMessage(
            chatId,
            "❌ Errore nell'eliminazione del promemoria."
          );
        }

        pendingDeletions.delete(userId);
        return;
      }
    }

    // Update user info only when not processing deletions
    storage.updateUser(userId, {
      firstName: msg.from.first_name,
      username: msg.from.username,
      messageCount: storage.getUser(userId).messageCount + 1,
    });

    // Handle reminder creation
    if (pendingReminders.has(userId)) {
      const session = pendingReminders.get(userId);

      switch (session.step) {
        case 1:
          session.reminder.msg = text;
          session.step = 2;
          bot.sendMessage(
            chatId,
            "📅⏰ *Data e ora del promemoria?* (es: 14:30 30/05/2025)",
            { parse_mode: "Markdown" }
          );
          break;

        case 2:
          // Parse format: "HH:MM DD/MM/YYYY"
          const parts = text.split(/[\s/:]/); // [hh, mm, gg, mm, aaaa]

          if (parts.length < 5) {
            bot.sendMessage(
              chatId,
              "❌ Formato data/ora non valido. Usa il formato: HH:MM DD/MM/YYYY (es: 14:30 30/05/2025)\nRiprova con /add"
            );
            pendingReminders.delete(userId);
            return;
          }

          // Create date from parts: parts[4]-parts[3]-parts[2]T{parts[0]}:{parts[1]}:00
          const reminderDate = new Date(
            `${parts[4]}-${parts[3]}-${parts[2]}T${parts[0]}:${parts[1]}:00`
          );

          if (isNaN(reminderDate)) {
            bot.sendMessage(
              chatId,
              "❌ Formato data/ora non valido. Usa il formato: HH:MM DD/MM/YYYY (es: 14:30 30/05/2025)\nRiprova con /add"
            );
            pendingReminders.delete(userId);
            return;
          }

          // Check if the date is in the past
          const now = new Date();
          if (reminderDate <= now) {
            bot.sendMessage(
              chatId,
              "❌ La data e ora specificata è nel passato. Inserisci una data futura.\nRiprova con /add"
            );
            pendingReminders.delete(userId);
            return;
          }

          session.reminder.datetime = reminderDate.toISOString();

          const user = storage.getUser(userId);
          if (!user.reminders) user.reminders = [];

          const reminderId = generateReminderId();
          user.reminders.push({
            id: reminderId,
            msg: session.reminder.msg,
            datetime: session.reminder.datetime,
            sent: false,
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

  // /list command - shows all reminders
  bot.onText(/\/list/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const user = storage.getUser(userId);

    let res = `📋 *I tuoi promemoria:*\n`;

    if (user.reminders && user.reminders.length > 0) {
      const activeReminders = user.reminders.filter((r) => !r.sent);
      const sentReminders = user.reminders.filter((r) => r.sent);

      if (activeReminders.length > 0) {
        res += `\n🟢 *Attivi:*\n`;
        activeReminders.forEach((reminder, index) => {
          const date = new Date(reminder.datetime);
          const now = new Date();
          const isOverdue = date < now;
          const status = isOverdue ? "⚠️ Scaduto" : "⏰ Programmato";

          res += `\n*${index + 1}.* ${reminder.msg}\n📅 ${date.toLocaleString(
            "it-IT"
          )} ${status}\n`;
        });
      }

      if (sentReminders.length > 0) {
        res += `\n✅ *Completati:*\n`;
        sentReminders.slice(-3).forEach((reminder, index) => {
          const date = new Date(reminder.datetime);
          res += `\n*${index + 1}.* ${reminder.msg}\n📅 ${date.toLocaleString(
            "it-IT"
          )} ✅\n`;
        });
        if (sentReminders.length > 3) {
          res += `\n_... e altri ${
            sentReminders.length - 3
          } promemoria completati_\n`;
        }
      }
    } else {
      res += "\nNessun promemoria impostato.\nUsa /add per crearne uno!";
    }

    bot.sendMessage(chatId, res, { parse_mode: "Markdown" });
  });

  // /del command - delete a reminder
  bot.onText(/\/del/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const user = storage.getUser(userId);

    if (!user.reminders || user.reminders.length === 0) {
      bot.sendMessage(
        chatId,
        "❌ Non hai promemoria da eliminare.\nUsa /add per crearne uno!",
        {
          parse_mode: "Markdown",
        }
      );
      return;
    }

    const activeReminders = user.reminders.filter((r) => !r.sent);

    if (activeReminders.length === 0) {
      bot.sendMessage(chatId, "❌ Non hai promemoria attivi da eliminare.", {
        parse_mode: "Markdown",
      });
      return;
    }

    let res = `🗑️ *Quale promemoria vuoi eliminare?*\n\nScrivi il numero del promemoria:\n`;

    activeReminders.forEach((reminder, index) => {
      const date = new Date(reminder.datetime);
      res += `\n*${index + 1}.* ${reminder.msg}\n📅 ${date.toLocaleString(
        "it-IT"
      )}\n`;
    });
    res += `\n_Scrivi solo il numero (es: 1, 2, 3...)_`;
    pendingDeletions.set(userId, { reminders: activeReminders });
    bot.sendMessage(chatId, res, { parse_mode: "Markdown" });
  });

  // /clear command - delete completed reminders or all reminders
  bot.onText(/\/clear(\s+(.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const argument = match[2] ? match[2].trim().toLowerCase() : null;

    const user = storage.getUser(userId);

    if (!user.reminders || user.reminders.length === 0) {
      bot.sendMessage(chatId, "❌ Non hai promemoria da eliminare.", {
        parse_mode: "Markdown",
      });
      return;
    }

    if (argument === "all") {
      // Ask for confirmation before deleting all reminders
      const totalCount = user.reminders.length;
      const activeCount = user.reminders.filter((r) => !r.sent).length;

      bot.sendMessage(
        chatId,
        `⚠️ *Attenzione!*\n\nStai per eliminare TUTTI i ${totalCount} promemoria (${activeCount} attivi e ${
          totalCount - activeCount
        } completati).\n\n*Questa azione è irreversibile!*\n\nScrivi "CONFERMA" per procedere o qualsiasi altro messaggio per annullare.`,
        { parse_mode: "Markdown" }
      );

      // Set a temporary state to handle confirmation
      pendingDeletions.set(userId, {
        type: "clear_all",
        awaitingConfirmation: true,
      });
      return;
    }

    // Clear only completed reminders
    const result = storage.clearReminders(userId, false);

    if (result.deleted > 0) {
      bot.sendMessage(chatId, `✅ ${result.message}`, {
        parse_mode: "Markdown",
      });
    } else {
      bot.sendMessage(chatId, `ℹ️ ${result.message}`, {
        parse_mode: "Markdown",
      });
    }
  });
}

main();
