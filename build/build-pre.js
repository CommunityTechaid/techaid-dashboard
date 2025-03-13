const path = require('path');
const fs = require('fs');
const appVersion = require('../package.json').version;
const today = new Date();
const versionFilePath = path.join(__dirname + '/../src/environments/version.ts');

function dateFormat (date, fstr, utc) {
    utc = utc ? 'getUTC' : 'get';
    return fstr.replace (/%[YymdHMS]/g, function (m) {
      switch (m) {
      case '%Y': return date[utc + 'FullYear'] (); // no leading zeros required
      case '%y': return date[utc + 'FullYear']().toString().substr(-2);
      case '%m': m = 1 + date[utc + 'Month'] (); break;
      case '%d': m = date[utc + 'Date'] (); break;
      case '%H': m = date[utc + 'Hours'] (); break;
      case '%M': m = date[utc + 'Minutes'] (); break;
      case '%S': m = date[utc + 'Seconds'] (); break;
      default: return m.slice (1); // unknown code, remove %
      }
      // add leading zero if required
      return ('0' + m).slice (-2);
    });
}

const build = dateFormat(today, '%y.%m.%d-%H%M');
const api_host = process.env.API_HOST || '/api';
const src = `
export const APP_VERSION = {version: '${appVersion}', build: '${build}', date: '${today.toISOString()}'};
export const API_HOST = '${api_host}';
`;
fs.writeFile(versionFilePath, src, { flat: 'w' }, function (err) {
    if (err) {
        return console.log(err);
    }

    console.log(`Updating application version ${appVersion} build: ${build}`);
    console.log(`Updating API_HOST to ${api_host}`);
    console.log(`${'Writing version module to '}${versionFilePath}\n`);
});
