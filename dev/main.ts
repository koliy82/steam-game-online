import dotenv from 'dotenv';
import SteamUser from 'steam-user';
import totp from 'steam-totp';
import { Bot, Context, InlineKeyboard, session, SessionFlavor, Composer  } from "grammy";
import { I18n, I18nFlavor } from "@grammyjs/i18n";
import { MongoClient, ServerApiVersion, Collection, Db, ObjectId } from "mongodb";
import { Buffer } from "node:buffer";
import { conversations, createConversation, Conversation, ConversationFlavor } from '@grammyjs/conversations';
import { StatelessQuestion } from "@grammyjs/stateless-question";

dotenv.config();
const mongoUrl: string = process.env.MONGO_URL || "?";
const mongoDB: string = process.env.MONGO_DATABASE || "steam";
const client = new MongoClient(mongoUrl, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});
let db: Db = client.db(mongoDB);
const usersColl: Collection<User> = db.collection<User>('users');

interface Account {
  login: string;
  password: string;
  telegramId: number;
  state: number;
  token: string | null;
  shared_secret: string | null;
  gameIds: any[];
}

interface User {
  id: number;
  accounts: { [login: string]: Account };
}

const activeSessions: { [login: string]: SteamUser } = {};

(async () => {
  await db.command({ ping: 1 });
  console.log("Successfully connected to MongoDB");
})();

type MyContext = Context & I18nFlavor & SessionFlavor<SessionData> & ConversationFlavor;
type MyConversation = Conversation<MyContext>;
const bot = new Bot<MyContext>(process.env.TELEGRAM_TOKEN || "?");
const i18n = new I18n<MyContext>({
  defaultLocale: "en",
  directory: "locales",
});


bot.use(i18n);
interface SessionData {
  currentLogin?: string;
  steamGuardCallback?: (code: string) => void;
}
bot.use(session({
  initial: (): SessionData => ({}),
}));
bot.use(conversations());
const composer = new Composer<MyContext>();
bot.use(composer);

const sharedSecretQuestion = new StatelessQuestion("shared_secret", async (ctx) => {
  const secretResponse = ctx.message?.text;
  if (!secretResponse) {
    await ctx.reply("Пожалуйста, отправьте текстовое сообщение.");
    return;
  }
  const login = ctx.session.currentLogin;
  const user = await findOrCreateUser(ctx.from?.id!);
  const account = user.accounts[login];
  account.shared_secret = secretResponse;
  logIntoAccount(account, null, ctx);  // Вход в аккаунт после получения shared_secret
  await ctx.reply(`shared_secret для ${login} успешно сохранен и аккаунт запущен.`);
});

const steamGuardCodeQuestion = new StatelessQuestion("steam_guard", async (ctx) => {
  const code = ctx.message?.text;
  if (!code) {
    await ctx.reply("Пожалуйста, отправьте код Steam Guard.");
    return;
  }
  const steamGuardCallback = ctx.session.steamGuardCallback;
  steamGuardCallback(code);  // Передаем код обратно в SteamUser
  await ctx.reply(`Код для ${ctx.session.currentLogin} успешно отправлен.`);
});

const invalidPasswordQuestion = new StatelessQuestion("invalid_password", async (ctx) => {
  const password = ctx.message?.text;
  if (!password) {
    await ctx.reply("Пожалуйста, отправьте пароль повторно.");
    return;
  }
  const newAccount: Account = {
    login: ctx.session.currentLogin,
    password: password,
    telegramId: ctx.from!.id,
    state: SteamUser.EPersonaState.Online,
    token: null,
    shared_secret: null,
    gameIds: ["@MasterFarmBot", 219780]
  };
  logIntoAccount(newAccount, null, ctx)
  await ctx.reply(`Пароль для ${ctx.session.currentLogin} успешно отправлен.`);
});

function isTokenExpired(token: string): boolean {
  const jwt = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
  const currentTime = Math.floor(Date.now() / 1000);
  return jwt.exp && currentTime >= jwt.exp;
}

async function findOrCreateUser(telegramId: number): Promise<User> {
  let user = await usersColl.findOne<User>({ id: telegramId });
  if (!user) {
    user = {id: telegramId, accounts: {} };
    await usersColl.insertOne(user!);
  }
  return user!;
}

async function accountExist(telegramId: number, login: string): Promise<boolean> {
  const count = await usersColl.countDocuments({
    id: telegramId,
    [`accounts.${login}`]: { $exists: true }
  });
  return count > 0;
}

function subscribeUserEvents(user: SteamUser, account: Account, ctx: MyContext): void {
  user.on('loggedOn', async () => {
    console.log(`${account.login} - Successfully logged on`);
    user.setPersona(account.state);

    let games = account.gameIds;
    if (Array.isArray(games) && games.every(game => typeof game === 'string' && /^\d+$/.test(game))) {
      games = games.map(Number);
    }

    user.gamesPlayed(games);
    console.log(`Playing games: ${games}`);
    bot.api.sendMessage(account.telegramId, `Аккаунт ${account.login} начал фарм. \nИгры: ${games} \nState: ${SteamUser.EPersonaState[account.state]}`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Остановить фарм', callback_data: `stop_farming_${account.login}` }]
        ]
      }
    });

    await usersColl.updateOne(
      { id: account.telegramId },
      { $set: { [`accounts.${account.login}`]: account } }
    );
  });

  user.on('steamGuard', async (domain: string, callback: (code: string) => void) => {
    bot.api.sendMessage(account.telegramId, `Введите код Steam Guard для ${account.login}:`);
    ctx.session.currentLogin = account.login;  // Сохраняем логин в сессию
    ctx.session.steamGuardCallback = callback;  // Сохраняем callback в сессию
    await steamGuardCodeQuestion.replyWithMarkdown(ctx, "Пожалуйста, введите код Steam Guard:");
  });
  
  // user.on('steamGuard', async (domain: string, callback: (code: string) => void) => {
  //   const msg = await bot.api.sendMessage(account.telegramId, `Введите код для ${account.login}: `);
  //   bot.once('message', (codeResponse) => {
  //     const code = codeResponse.text;
  //     callback(code);
  //   });
  // });

  user.on('refreshToken', async (token: string) => {
    account.token = token;
    console.log(`Auth token for ${account.login} has been saved.`);
  });

  user.on('playingState', (blocked: boolean, playingApp: number) => {
    if (blocked) {
      console.log(`${account.login} is playing on another device: ${playingApp}`);
    }
  });

  user.on('error', async (err: Error) => {
    console.log(`Error for ${account.login}:`, err);
    if (err.message === "RateLimitExceeded") {
      bot.api.sendMessage(account.telegramId, `${account.login} - Превышено количество попыток авторизации в аккаунт Steam, попробуйте через час.`);
    } else if (err.message === "InvalidPassword") {
      await invalidPasswordQuestion.replyWithMarkdown(ctx, `${account.login} - Неверный пароль, введите повторно: `);
      ctx.
      // bot.api.sendMessage(account.telegramId, `${account.login} - Неверный пароль, введите повторно: `);
      // bot.once('message', async (msg) => {
      //   account.password = msg.text!;
      //   logIntoAccount(account, user);
      // });
    } else if (err.message === "LoggedInElsewhere") {
      console.log(`${account.login} - Logged in elsewhere.`);
      bot.api.sendMessage(account.telegramId, `Вы играете в другую игру на аккаунте ${account.login}, фарм остановлен.`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Продолжить фарм', callback_data: `continue_farming_${account.login}` }]
          ]
        }
      });
      exitAccount(account.login);
    } else {
      bot.api.sendMessage(account.telegramId, `${account.login} - Неизвестная ошибка, выход из аккаунта...`);
      exitAccount(account.login);
    }
  });
}

function exitAccount(login: string): void {
  const user = activeSessions[login];
  if (user) {
    delete activeSessions[login];
    user.logOff();
  }
}

function logIntoAccount(account: Account, steamUser: SteamUser | null = null, ctx): void {
  if (!steamUser) {
    steamUser = new SteamUser();
    subscribeUserEvents(steamUser, account, ctx);
    activeSessions[account.login] = steamUser;
  }

  const logOnOptions: SteamUser.LogOnDetails = {
    accountName: account.login,
    password: account.password,
    machineName: "Koliy82",
    clientOS: 20,
  };

  if (account.token) {
    if (isTokenExpired(account.token)) {
      console.log(`Token for ${account.login} has expired. Logging with username and password...`);
      steamUser.logOn(logOnOptions);
    } else {
      console.log(`Token for ${account.login} is still valid. Logging with token...`);
      steamUser.logOn({
        machineName: "Koliy82",
        clientOS: 20,
        refreshToken: account.token
      });
    }
  } else {
    if (account.shared_secret != null) {
      logOnOptions.twoFactorCode = totp.generateAuthCode(account.shared_secret);
      steamUser.logOn(logOnOptions);
    } else {
      steamUser.logOn(logOnOptions);
    }
  }
}

bot.command("start", async (ctx) => {
  await ctx.reply(ctx.t("start"), {
    reply_parameters: { message_id: ctx.msg.message_id },
  });
});

bot.command("donate", async (ctx) => {
  await ctx.reply(ctx.t("donate"), {
    reply_parameters: { message_id: ctx.msg.message_id },
  });
});

bot.command("add", async (ctx) => {
  const fromId = ctx.from?.id;
  if (!fromId) return;
  const [login, password] = ctx.match.split(' ');
  console.log(ctx.match);
  console.log(login);
  console.log(password);
  const newAccount: Account = {
    login: login,
    password: password,
    telegramId: fromId,
    state: SteamUser.EPersonaState.Online,
    token: null,
    shared_secret: null,
    gameIds: ["@MasterFarmBot", 219780]
  };

  const user = await findOrCreateUser(fromId);

  await ctx.reply(ctx.t('shared_secret'), {
    reply_markup: {
      inline_keyboard: [
        [{ text: ctx.t('yes'), callback_data: `yes` }, { text: ctx.t('no'), callback_data: `no` }]
      ]
    }
  });

  composer.callbackQuery(['yes', 'no'], async (callbackCtx) => {
    const response = callbackCtx.callbackQuery.data;
    callbackCtx.session.currentLogin = login;
    if (response === 'yes') {
      await sharedSecretQuestion.replyWithHTML(callbackCtx, `Отправьте свой shared_secret для ${login}:`);
    } else {
      user.accounts[login] = newAccount;
      logIntoAccount(newAccount, null, ctx);
    }
    await callbackCtx.answerCallbackQuery();
  });
  
  // bot.callbackQuery(['yes', 'no'], async (callbackCtx) => {
  //   const response = callbackCtx.callbackQuery.data;
  //   if (response === 'yes') {
  //     await callbackCtx.reply(`Отправьте свой shared_secret для ${login}:`);
  //     bot.once('message', async (secretResponse) => {
  //       newAccount.shared_secret = secretResponse.text;
  //       user.accounts[login] = newAccount;
  //       logIntoAccount(newAccount);
  //     });
  //   } else {
  //     user.accounts[login] = newAccount;
  //     logIntoAccount(newAccount);
  //   }
  //   await callbackCtx.answerCallbackQuery();
  // });
});

bot.command("list", async (ctx) => {
  const fromId = ctx.message?.from.id;
  if(!fromId) return;
  const user = await findOrCreateUser(fromId);
  if (Object.keys(user.accounts).length > 0) {
    let message = 'Ваши аккаунты:\n';
    const inlineKeyboard = new InlineKeyboard();
    Object.keys(user.accounts).forEach((login, index) => {
      message += `${index + 1}. ${login}\n`;
      inlineKeyboard.text(`${index + 1}`, `select_${login}` )
    });
    await ctx.reply(message, {
      reply_markup: inlineKeyboard,
    });
  } else {
    await ctx.reply('У вас нет добавленных аккаунтов.');
  }
});

bot.callbackQuery(/^select_/, async (ctx) => {
  const login = ctx.callbackQuery.data.split('_')[1];
  if (!await accountExist(ctx.from.id, login)) {
    ctx.reply(`Аккаунт ${login} не найден.`);
    return;
  }
  const user = await findOrCreateUser(ctx.from.id);
  const account = user.accounts[login];
  const steamUser = activeSessions[login];
  const farmingStatus = steamUser ? 'Остановить фарм' : 'Продолжить фарм';

  let accountInfo = `Информация об аккаунте ${login}:\n` +
                    `Игры: ${account.gameIds.join(', ')}\n` +
                    `Статус: ${SteamUser.EPersonaState[account.state]}`;

  ctx.reply(accountInfo, {
    reply_markup: {
      inline_keyboard: [
        [{ text: farmingStatus, callback_data: steamUser ? `stop_farming_${login}` : `continue_farming_${login}` }],
        [{ text: 'Изменить игры', callback_data: `edit_games_${login}` }],
        [{ text: 'Изменить статус', callback_data: `edit_state_${login}` }],
        [{ text: 'Удалить', callback_data: `delete_data_${login}` }]
      ]
    }
  });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^continue_farming_/, async (ctx) => {
  const login = ctx.callbackQuery.data.split('_')[2];
  const user = await findOrCreateUser(ctx.from.id);

  const account = user.accounts[login];
  if (!account) {
    await ctx.reply(`Аккаунт не найден.`);
    return;
  }

  logIntoAccount(account);
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^stop_farming_/, async (ctx) => {
  const login = ctx.callbackQuery.data.split('_')[2];
  const user = await findOrCreateUser(ctx.from.id);

  const account = user.accounts[login];
  if (!account) {
    await ctx.reply(`Аккаунт не найден.`);
    return;
  }

  const steamUser = activeSessions[login];
  if (!steamUser) {
    await ctx.reply(`Фарм для аккаунта ${login} уже остановлен.`);
    return;
  }

  steamUser.logOff();
  delete activeSessions[login];

  await ctx.reply(`Фарм для аккаунта ${login} остановлен.`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Продолжить фарм', callback_data: `continue_farming_${login}` }]
      ]
    }
  });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^delete_data_/, async (ctx) => {
  const login = ctx.callbackQuery.data.split('_')[2];
  if (!await accountExist(ctx.from.id, login)) {
    await ctx.reply(`Аккаунт ${login} не найден.`);
    return;
  }

  await usersColl.updateOne(
    { id: ctx.from.id },
    { $unset: { [`accounts.${login}`]: "" } }
  );

  exitAccount(login);  // Закрываем сессию, если активна
  await ctx.reply(`Аккаунт ${login} был успешно удалён.`);
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^edit_games_/, async (ctx) => {
  const login = ctx.callbackQuery.data.split('_')[2];

  if (!await accountExist(ctx.from.id, login)) {
    await ctx.reply(`Аккаунт ${login} не найден.`);
    return;
  }

  await ctx.reply(`Отправьте новый список ID игр для аккаунта ${login}:`);
  
  bot.once('message', async (msg) => {
    const gameIds = msg.text.split(',').map(Number);
    await usersColl.updateOne(
      { id: ctx.from.id },
      { $set: { [`accounts.${login}.gameIds`]: gameIds } }
    );

    await ctx.reply(`Игры для аккаунта ${login} обновлены: ${gameIds.join(', ')}`);

    const steamUser = activeSessions[login];
    if (steamUser) {
      steamUser.gamesPlayed(gameIds);  // Обновляем список игр в сессии
    }
  });
});

bot.callbackQuery(/^edit_state_/, async (ctx) => {
  const login = ctx.callbackQuery.data.split('_')[2];
  if (!await accountExist(ctx.from.id, login)) {
    await ctx.reply(`Аккаунт ${login} не найден.`);
    return;
  }

  let text = `Выберите новый статус для аккаунта ${login}: \n`;
  const stateOptions = Object.keys(SteamUser.EPersonaState)
    .filter(v => !isNaN(Number(v)))
    .map((state) => {
      const stateNum = parseInt(state) + 1;
      const stateName = SteamUser.EPersonaState[state];
      text += `${stateNum}. ${stateName}\n`;
      return { text: stateName, callback_data: `set_state_${login}_${state}` };
    });

  await ctx.reply(text, {
    reply_markup: { inline_keyboard: [stateOptions] }
  });
});

bot.callbackQuery(/^set_state_/, async (ctx) => {
  const [login, state] = ctx.match;
  if (!await accountExist(ctx.from.id, login)) {
    await ctx.reply(`Аккаунт ${login} не найден.`);
    return;
  }

  await usersColl.updateOne(
    { id: ctx.from.id },
    { $set: { [`accounts.${login}.state`]: parseInt(state) } }
  );

  await ctx.reply(`Статус для аккаунта ${login} обновлен на ${SteamUser.EPersonaState[state]}`);

  const steamUser = activeSessions[login];
  if (steamUser) {
    steamUser.setPersona(parseInt(state));
  }
});

(async () => {
  const users = await usersColl.find().toArray();
  users.forEach(user => {
    Object.values(user.accounts).forEach(account => {
      logIntoAccount(account, null, null);
    });
  });
  bot.start();
  console.log("Bot is started");
  console.log(await bot.api.getMe());
})();