require('dotenv').config();
const SteamUser = require('steam-user');
const fs = require('fs');
const path = require('path');
const rlSync = require('readline-sync');

function logIntoAccount(account) {
  const user = new SteamUser();

  const logOnOptions = {
    accountName: account.login,
    password: account.password,
    machineName: "Koliy82",
    clientOS: 20,
  };

  const tokenPath = `${logOnOptions.accountName}.secret`
  if (fs.existsSync(user.storage.directory + path.sep + tokenPath)) {
    user.storage.readFile(tokenPath).then(bytes => {
      const token = bytes.toString();
      console.log('Token ' + tokenPath + ' is loaded:');
      const jwt = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      const currentTime = Math.floor(Date.now() / 1000);

      if (jwt.exp && currentTime >= jwt.exp) {
        console.log(`Token ${account.login} has expired. Logging in with username and password...`);
        user.logOn(logOnOptions);
      } else {
        console.log(`Token ${account.login} is still valid.`);
        user.logOn({
          refreshToken: token,
          machineName: "Koliy82",
          clientOS: 20,
         });
      }
    });
  } else {
    user.logOn(logOnOptions);
  }

  user.on('loggedOn', () => {
    console.log(logOnOptions.accountName + ' - Successfully logged on');
    user.setPersona(account.state);

    let games = account.gameIds;

    if (Array.isArray(games) && games.every(game => typeof game === 'string' && /^\d+$/.test(game))) {
      games = games.map(Number);
    }

    user.gamesPlayed(games);
    console.log('Playing games:', games);
  });
  
  user.on('steamGuard', async (domain, callback) => {
    var code = rlSync.question(`Steam Guard code for ${account.login}: `);
    callback(code);
  });

  user.on('refreshToken', function(token) {
    user.storage.saveFile(tokenPath, token)
    console.log(`Auth token for ${account.login} has been saved.`);
  });
}

const accounts = JSON.parse(fs.readFileSync('accounts.json', 'utf8')).accounts;
accounts.forEach(account => {
  logIntoAccount(account);
});