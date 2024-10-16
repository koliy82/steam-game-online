require('dotenv').config();
const i18next = require('i18next');
const Backend = require('i18next-node-fs-backend');
i18next.use(Backend).init({
  lng: 'en',
  fallbackLng: 'en',
  backend: {
    loadPath: './locales/{{lng}}.json'
  }
});

const SteamUser = require('steam-user');
const totp = require('steam-totp');

const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, {polling: true});

const { MongoClient, ServerApiVersion } = require("mongodb");
const mongoUrl = process.env.MONGO_URL;
const mongoDB = 'steam';
const client = new MongoClient(mongoUrl,  {
  serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
  }
});
let db = client.db(mongoDB);
const usersColl = db.collection('users');
(async() => {
  await db.command({ ping: 1 });
  console.log("Successful connected to MongoDB");
})();
const activeSessions = {};

function isTokenExpired(token) {
  const jwt = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
  const currentTime = Math.floor(Date.now() / 1000);
  return jwt.exp && currentTime >= jwt.exp;
}

async function findOrCreateUser(telegramId) {
  let user = await usersColl.findOne({ id: telegramId });
  if (!user) {
    user = { id: telegramId, accounts: {} };
    await usersColl.insertOne(user);
  }
  return user;
}

async function accountExist(telegramId, login) {
  const count = await usersColl.countDocuments({
    id: telegramId,
    [`accounts.${login}`]: { $exists: true }
  });
  return count > 0;
}

function subscribeUserEvents(user, account) {
  user.on('loggedOn', async () => {
    console.log(`${account.login} - Successfully logged on`);
    user.setPersona(account.state);

    let games = account.gameIds;
    if (Array.isArray(games) && games.every(game => typeof game === 'string' && /^\d+$/.test(game))) {
      games = games.map(Number);
    }

    user.gamesPlayed(games);
    console.log(`Playing games: ${games}`);
    bot.sendMessage(account.telegramId, `Аккаунт ${account.login} начал фарм. \nИгры: ${games} \nState: ${SteamUser.EPersonaState[account.state]}`, {
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

  user.on('steamGuard', (domain, callback) => {
    bot.sendMessage(account.telegramId, `Введите код Steam Guard для ${account.login}: `);
    bot.once('message', (codeResponse) => {
      const code = codeResponse.text;
      callback(code);
    });
  });

  user.on('refreshToken', async function(token) {
    account.token = token;
    console.log(`Auth token for ${account.login} has been saved.`);
  });

  user.on('playingState', (blocked, playingApp) => {
    if (blocked) {
      console.log(`${account.login} is playing on another device: ${playingApp}`);
      // bot.sendMessage(account.telegramId, `Вы играете в другую игру на ${playingApp}, фарм остановлен.`, {
      //   reply_markup: {
      //     inline_keyboard: [
      //       [{ text: 'Продолжить фарм', callback_data: `continue_farming_${account.login}` }]
      //     ]
      //   }
      // });
      // user.logOff();
    }
  });

  user.on('error', (err) => {
    console.log(`Error for ${account.login}:`, err);
    if (err.message === "RateLimitExceeded") {
      bot.sendMessage(account.telegramId, `${account.login} - Превышено количество попыток авторизации в аккаунт Steam, попробуйте через час.`);
    } else if (err.message === "InvalidPassword") {
      bot.sendMessage(account.telegramId, `${account.login} - Неверный пароль, введите повторно: `);
      bot.once('message', async (msg) => {
        account.password = msg.text;
        logIntoAccount(account, user);
      });
    } else if (err.message === "LoggedInElsewhere") {
      console.log(`${account.login} - Logged in elsewhere.`);
      bot.sendMessage(account.telegramId, `Вы играете в другую игру на аккаунте ${account.login}, фарм остановлен.`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Продолжить фарм', callback_data: `continue_farming_${account.login}` }]
          ]
        }
      });
      exitAccount(account.login);
    } else {
      bot.sendMessage(account.telegramId, `${account.login} - Неизвестная ошибка, выход из аккаунта...`);
      exitAccount(account.login);
    }
  });
}

function exitAccount(login){
  const user = activeSessions[login];
  if(user){
    delete activeSessions[login];
    user.logOff();
  }
}

function logIntoAccount(account, steamUser=null) {
  if (!steamUser){
    steamUser = new SteamUser();
    subscribeUserEvents(steamUser, account);
    activeSessions[account.login] = steamUser;
  }

  const logOnOptions = {
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
    if (account.shared_secret != null){
      logOnOptions.twoFactorCode = totp.generateAuthCode(account.shared_secret);
      steamUser.logOn(logOnOptions);
    }else{
      steamUser.logOn(logOnOptions);
    }
  }
}

bot.onText(/\/start/, (msg) => {
  i18next.changeLanguage(msg.from.language_code || 'en').then(() => {
    const responseText = i18next.t('start');
    bot.sendMessage(msg.chat.id, responseText, {parse_mode: 'HTML'});
  });
});

bot.onText(/\/add (.+) (.+)/, async (msg, match) => {
  const chatId = msg.from.id;
  const login = match[1];
  const password = match[2];
  const newAccount = {
    login: login,
    password: password,
    telegramId: chatId,
    state: SteamUser.EPersonaState.Online,
    token: null,
    shared_secret: null,
    gameIds: ["@MasterFarmBot", 219780]
  };
  const user = await findOrCreateUser(chatId);

  i18next.changeLanguage(msg.from.language_code || 'en').then(() => {
    const sharedText = i18next.t('shared_secret');
    const yesText = i18next.t('yes');
    const noText = i18next.t('no');
    bot.sendMessage(chatId, sharedText, {
      reply_markup: {
        inline_keyboard: [
          [{ text: yesText, callback_data: 'yes' }, { text: noText, callback_data: 'no' }]
        ]
      }
    });
  });

  bot.once('callback_query', async (callbackQuery) => {
    const response = callbackQuery.data;
    if (response === 'yes') {
      bot.sendMessage(chatId, `Отправьте свой shared_secret для ${login}: `);
      bot.answerCallbackQuery(callbackQuery.id);
      bot.once('message', async (secretResponse) => {
        newAccount.shared_secret = secretResponse.text;
        user.accounts[login] = newAccount;
        logIntoAccount(newAccount);
      });
    } else if (response === 'no') {
      user.accounts[login] = newAccount;
      logIntoAccount(newAccount);
      bot.answerCallbackQuery(callbackQuery.id);
    }
  });
});

bot.onText(/\/list/, async (msg) => {
  const fromId = msg.from.id;
  const user = await usersColl.findOne({ id: fromId });

  if (user && Object.keys(user.accounts).length > 0) {
    let message = 'Ваши аккаунты:\n';
    const inlineKeyboard = [];

    Object.keys(user.accounts).forEach((login, index) => {
      message += `${index + 1}. ${login}\n`;
      inlineKeyboard.push([{ text: `${index + 1}`, callback_data: `select_${login}` }]);
    });

    bot.sendMessage(fromId, message, {
      reply_markup: {
        inline_keyboard: inlineKeyboard
      }
    });
  } else {
    bot.sendMessage(fromId, 'У вас нет добавленных аккаунтов.');
  }
});

bot.onText(/\/donate/, (msg) => {
  i18next.changeLanguage(msg.from.language_code || 'en').then(() => {
    const donateText = i18next.t('donate');
    bot.sendMessage(msg.chat.id, donateText);
  });
});

bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  if (data.startsWith('continue_farming_')) {
    const login = data.split('_')[2];
    const user = await usersColl.findOne({ id: chatId });
    const account = user.accounts[login];
    if (!account) {
      bot.sendMessage(chatId, `Аккаунт не найден.`);
      return
    }
    logIntoAccount(account);
  }

  if (data.startsWith('stop_farming_')) {
    const login = data.split('_')[2];
    const user = await usersColl.findOne({ id: chatId });
    const account = user.accounts[login];
    if (!account) {
      bot.sendMessage(chatId, `Аккаунт не найден.`);
      return
    }
    const steamUser = activeSessions[login];
    if (!steamUser) {
      bot.sendMessage(chatId, `Фарм для аккаунта ${login} уже остановлен.`);
      return
    }
    steamUser.logOff();
    delete activeSessions[login];
    bot.sendMessage(chatId, `Фарм для аккаунта ${login} остановлен.`,{
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Продолжить фарм', callback_data: `continue_farming_${account.login}` }]
        ]
      }
    });
  }

  if (data.startsWith('select_')) {
    const login = data.split('_')[1];
    if (!await accountExist(chatId, login)) {
      bot.sendMessage(chatId, `Аккаунт ${login} не найден.`);
      return;
    }
    const user = await usersColl.findOne({ id: chatId });
    const account = user.accounts[login];

    // if (!account) {
    //   bot.sendMessage(chatId, `Аккаунт не найден.`);
    //   return;
    // }

    const steamUser = activeSessions[login];
    const farmingStatus = steamUser ? 'Остановить фарм' : 'Продолжить фарм';

    let accountInfo = `Информация об аккаунте ${login}:\n` +
                      `Игры: ${account.gameIds.join(', ')}\n` +
                      `Статус: ${SteamUser.EPersonaState[account.state]}`;

    bot.sendMessage(chatId, accountInfo, {
      reply_markup: {
        inline_keyboard: [
          [{ text: farmingStatus, callback_data: steamUser ? `stop_farming_${login}` : `continue_farming_${login}` }],
          [{ text: 'Изменить игры', callback_data: `edit_games_${login}` }],
          [{ text: 'Изменить статус', callback_data: `edit_state_${login}` }],
          [{ text: 'Удалить', callback_data: `delete_data_${login}` }]
        ]
      }
    });
  }

  if (data.startsWith('edit_games_')) {
    const login = data.split('_')[2];
    if (!await accountExist(chatId, login)) {
      bot.sendMessage(chatId, `Аккаунт ${login} не найден.`);
      return;
    }
    bot.sendMessage(chatId, `Отправьте новый список ID игр для аккаунта ${login}:`);
    bot.once('message', async (msg) => {
      const gameIds = msg.text.split(',').map(Number);
      await usersColl.updateOne(
        { id: chatId },
        { $set: { [`accounts.${login}.gameIds`]: gameIds } }
      );
      bot.sendMessage(chatId, `Игры для аккаунта ${login} обновлены: ${gameIds.join(', ')}`);
      const steamUser = activeSessions[login];
      if(steamUser){
        steamUser.gamesPlayed(gameIds);
      }
    });
  }
  
  if (data.startsWith('edit_state_')) {
    const login = data.split('_')[2];
    if (!await accountExist(chatId, login)) {
      bot.sendMessage(chatId, `Аккаунт ${login} не найден.`);
      return;
    }
    var text = `Выберите новый статус для аккаунта ${login}: \n`
    const stateOptions = Object.keys(SteamUser.EPersonaState).
    filter((v) => !isNaN(Number(v))).
    map((state) => {
        showState = parseInt(state) + 1
        strState = SteamUser.EPersonaState[state]
        text += `${showState}. ${strState}\n`
        return {
            text: showState,
            callback_data: `set_state_${login}_${state}`
        };
    });
    bot.sendMessage(chatId, text, {
      reply_markup: {
        inline_keyboard: [stateOptions]
      }
    });
  }

  if (data.startsWith('set_state_')) {
    const parts = data.split('_');
    const login = parts[2];
    const state = parts[3];
    if (!await accountExist(chatId, login)) {
      bot.sendMessage(chatId, `Аккаунт ${login} не найден.`);
      return;
    }
    await usersColl.updateOne(
      { id: chatId },
      { $set: { [`accounts.${login}.state`]: parseInt(state) } }
    );
    bot.sendMessage(chatId, `Статус для аккаунта ${login} обновлен на ${state}`);
    const steamUser = activeSessions[login];
    if(steamUser){
      steamUser.setPersona(state);
    }
  }

  if (data.startsWith('delete_data_')) {
    const login = data.split('_')[2];
    if (!await accountExist(chatId, login)) {
      bot.sendMessage(chatId, `Аккаунт ${login} не найден.`);
      return;
    }
    await usersColl.updateOne(
      { id: chatId }, 
      { $unset: { [`accounts.${login}`]: "" } }
    );
    exitAccount(login);
    bot.sendMessage(chatId, `Аккаунт ${login} был успешно удалён.`);
  }
  
  bot.answerCallbackQuery(callbackQuery.id);
});

(async() => {
  (await usersColl.find().toArray()).forEach(user => {
    Object.values(user.accounts).forEach((account) => {
      logIntoAccount(account);
    });
  });
  console.log("Bot is started");
})();