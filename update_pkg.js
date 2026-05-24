const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.scripts.start = "concurrently \"node server.js\" \"react-scripts start\"";
pkg.proxy = "http://127.0.0.1:3001";
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
console.log('package.json updated');
