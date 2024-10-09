require('dotenv').config();
const SteamUser = require('steam-user');
const ReadLine = require('readline');
const fs = require('fs')
const path = require('node:path'); 

const user = new SteamUser();

const logOnOptions = {
  accountName: process.env.STEAM_USERNAME,
  password: process.env.STEAM_PASSWORD,
};

token_path = logOnOptions.accountName + ".secret";

if (fs.existsSync(user.storage.directory + path.sep + token_path)) { 
  user.storage.readFile(token_path).then( bytes => {
    token = bytes.toString()
    console.log('token ' + token_path + ' is loaded:');
    jwt = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    console.log(jwt);
    const currentTime = Math.floor(Date.now() / 1000);
    if (jwt.exp && currentTime >= jwt.exp) {
      console.log('Token has expired. Logging in with username and password...');
      user.logOn(logOnOptions);
    } else {
      console.log('Token is still valid.');
      user.logOn({ refreshToken: token });
    }
  });
}else{
  user.logOn(logOnOptions);
}

user.on('loggedOn', () => {
  console.log(logOnOptions.accountName + ' - Successfully logged on');
  user.setPersona(1); 
  
  let games;
  if (/^\d+(,\d+)*$/.test(process.env.GAMES_IDS)) {
    games = process.env.GAMES_IDS.split(',').map(Number);
  } else {
    games = process.env.GAMES_IDS;
  }
  user.gamesPlayed(games); 
  console.log('Playing games:', games);
});

user.on('steamGuard', function(domain, callback) {
  let rl = ReadLine.createInterface({
		input: process.stdin,
		output: process.stdout
	});
  rl.question('Steam Guard code: ', (code) => {
			rl.close();
      callback(code);
	});
});

user.on('refreshToken', function(token) {
	user.storage.saveFile(token_path, token)
  console.log(token);
});
