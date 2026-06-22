const fs = require('fs');
let code = fs.readFileSync('kiosk-print-server.js', 'utf-8');
code = code.replace('const { PNG } = require("pngjs");\r\n', '');
code = code.replace('const { PNG } = require("pngjs");\n', '');
const logoStr = fs.readFileSync('logo.base64', 'utf-8').trim();
code = code.replace(/try \{[\s\S]*?console\.error\(\"\[kiosk-print-server\] Failed to print logo:\", e\.message\);\r?\n  \}/, 'const logoBuf = Buffer.from("' + logoStr + '", "base64");\n  for(let i=0; i<logoBuf.length; i++) wr(logoBuf[i]);');
fs.writeFileSync('kiosk-print-server.js', code);
console.log("Patched successfully");
