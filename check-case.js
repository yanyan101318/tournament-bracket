const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.js') || file.endsWith('.jsx') || file.endsWith('.css')) {
      results.push(file);
    }
  });
  return results;
}

const files = walk('./src');
const cache = {};

function getTruePath(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  if (!fs.existsSync(dir)) return null;
  if (!cache[dir]) cache[dir] = fs.readdirSync(dir);
  return cache[dir].find(f => f.toLowerCase() === base.toLowerCase());
}

let found = false;
files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  const importRegex = /import\s+.*?['"](.*?)['"]|import\s+['"](.*?)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1] || match[2];
    if (importPath && importPath.startsWith('.')) {
      const resolvedPath = path.resolve(path.dirname(file), importPath);
      
      let extFound = false;
      const exts = ['', '.js', '.jsx', '.css', '/index.js', '/index.jsx'];
      
      for (const ext of exts) {
        if (fs.existsSync(resolvedPath + ext)) {
           const trueBase = getTruePath(resolvedPath + ext);
           if (trueBase && trueBase !== path.basename(resolvedPath + ext)) {
             console.log('Case mismatch in ' + file + ': imported ' + importPath + ' but actual file is ' + trueBase);
             found = true;
           }
           extFound = true;
           break;
        }
      }
    }
  }
});
if (!found) console.log('No case mismatch found');
