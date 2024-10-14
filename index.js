const TelegramBot = require('node-telegram-bot-api');
const { MongoClient, ServerApiVersion } = require("mongodb");
const i18next = require('i18next');
const Backend = require('i18next-node-fs-backend');
require('dotenv').config();

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, {polling: true});
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
db.command({ ping: 1 })
console.log("Connected to MongoDB");

i18next.use(Backend).init({
  lng: 'en',
  fallbackLng: 'en',
  backend: {
    loadPath: './locales/{{lng}}.json'
  }
});

async function findOrCreateUser(telegramId, callback) {
  const usersCollection = db.collection('users');
  user = await usersCollection.findOne({ id: telegramId });
  if (!user) {
    result = await usersCollection.insertOne({ id: telegramId, accounts: [] });
    callback(result.ops[0]);
  } else {
    callback(user);
  }
}

bot.onText(/\/start/, (msg) => {
  i18next.changeLanguage(msg.from.language_code || 'en').then(() => {
    const responseText = i18next.t('start');
    bot.sendMessage(msg.chat.id, responseText);
  });
});

bot.onText(/\/add (.+) (.+)/, (msg, match) => {
  const chatId = msg.from.id;
  const login = match[1];
  const password = match[2];
  console.log(login);
  console.log(password);
  findOrCreateUser(chatId, (user) => {
    console.log(user);
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


    bot.once('callback_query', (callbackQuery) => {
      const response = callbackQuery.data;
      if (response === 'yes') {
        bot.sendMessage(chatId, 'Отправьте свой shared secret.');
        bot.answerCallbackQuery(callbackQuery.id)
        bot.once('message', (secretResponse) => {
          const sharedSecret = secretResponse.text;
          saveAccountToDB(chatId, login, password, sharedSecret);
          bot.sendMessage(chatId, 'Аккаунт добавлен!');
        });
      } else if (response === 'no') {
        bot.sendMessage(chatId, 'Отправьте код Steam Guard.');
        bot.answerCallbackQuery(callbackQuery.id)
        bot.once('message', (codeResponse) => {
          const code = codeResponse.text;
          saveAccountToDB(chatId, login, password);
          bot.sendMessage(chatId, 'Аккаунт добавлен!');
        });
        
      }
    });
  });
});

function saveAccountToDB(userId, login, password, sharedSecret = null) {
  const usersCollection = db.collection('users');
  usersCollection.updateOne(
    { id: userId },
    {
      $push: {
        accounts: {
          login,
          password,
          shared_secret: sharedSecret,
          JWT: {}
        }
      }
    },
    { upsert: true }
  );
}

bot.onText(/\/list/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await db.collection('users').findOne({id: chatId});

  if (user && user.accounts.length > 0) {
    let message = 'Ваши аккаунты:\n';
    user.accounts.forEach((account, index) => {
      message += `${index + 1}. ${account.login}\n`;
    });
    bot.sendMessage(chatId, message);
  } else {
    bot.sendMessage(chatId, 'У вас нет добавленных аккаунтов.');
  }
});

// require('dotenv').config();
// const SteamUser = require('steam-user');
// const fs = require('fs');
// const path = require('path');
// const rlSync = require('readline-sync');

// function logIntoAccount(account) {
//   const user = new SteamUser();

//   const logOnOptions = {
//     accountName: account.login,
//     password: account.password,
//     machineName: "Koliy82",
//     clientOS: 20,
//   };

//   const tokenPath = `${logOnOptions.accountName}.secret`
//   if (fs.existsSync(user.storage.directory + path.sep + tokenPath)) {
//     user.storage.readFile(tokenPath).then(bytes => {
//       const token = bytes.toString();
//       console.log('Token ' + tokenPath + ' is loaded:');
//       const jwt = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
//       const currentTime = Math.floor(Date.now() / 1000);

//       if (jwt.exp && currentTime >= jwt.exp) {
//         console.log(`Token ${account.login} has expired. Logging in with username and password...`);
//         user.logOn(logOnOptions);
//       } else {
//         console.log(`Token ${account.login} is still valid.`);
//         user.logOn({
//           refreshToken: token,
//           machineName: "Koliy82",
//           clientOS: 20,
//          });
//       }
//     });
//   } else {
//     user.logOn(logOnOptions);
//   }

//   user.on('loggedOn', () => {
//     console.log(logOnOptions.accountName + ' - Successfully logged on');
//     user.setPersona(account.state);

//     let games = account.gameIds;

//     if (Array.isArray(games) && games.every(game => typeof game === 'string' && /^\d+$/.test(game))) {
//       games = games.map(Number);
//     }

//     user.gamesPlayed(games);
//     console.log('Playing games:', games);
//   });
  
//   user.on('steamGuard', async (domain, callback) => {
//     var code = rlSync.question(`Steam Guard code for ${account.login}: `);
//     callback(code);
//   });

//   user.on('refreshToken', function(token) {
//     user.storage.saveFile(tokenPath, token)
//     console.log(`Auth token for ${account.login} has been saved.`);
//   });

//   user.on('disconnected', function(msg) {
// 		console.log(`${account.login} disconnected, reason: ${msg}`);
// 	});

// 	user.on('playingState', function(blocked, playingApp) {
// 		if (blocked == true) {
// 			console.log(`${account.login} - playing on another device. Game: ${playingApp}`);
// 		}
// 	})

// 	user.on('error', function(err) {
// 		if (err == "Error: RateLimitExceeded") {
// 			console.log(`${account.login} - rate limit:`);
// 		}else if (err == "Error: InvalidPassword") {
// 				console.log(`${account.login} - bad password:`);
// 		}else if (err == "Error: LoggedInElsewhere") {
//       console.log(`${account.login} - logout:`);
// 			user.logOff();
// 		}else {
// 			console.log(`${account.login} - OTHER ERROR:`);
// 			user.logOff();
// 		}
//     console.log(err);
// 	});
// }

// const accounts = JSON.parse(fs.readFileSync('accounts.json', 'utf8')).accounts;
// accounts.forEach(account => {
//   logIntoAccount(account);
// });