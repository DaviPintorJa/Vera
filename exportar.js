const fs = require('fs');
const path = require('path');

const rootDir = process.cwd();
const outputFile = path.join(rootDir, 'CONTEXTO_COMPLETO_PROJETO.txt');

const IGNORE_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  '.vscode',
  'coverage',
  'build',
  '.turbo'
]);

const ALLOWED_EXTENSIONS = new Set([
  '.ts','.tsx','.js','.jsx','.json','.md','.env','.css','.scss','.html'
]);

const MAX_FILE_SIZE = 200 * 1024; // 200kb limite por arquivo

let structureOutput = '';
let codeOutput = '';
let skippedFiles = [];

/* ================================
   DATA DA EXPORTAÇÃO
================================ */
const now = new Date().toLocaleString();

/* ================================
   GERAR ESTRUTURA DO PROJETO
================================ */
function walkStructure(dir, prefix = '') {
  let items;
  try { items = fs.readdirSync(dir); } catch { return; }

  const visibleItems = items.filter(item => !IGNORE_DIRS.has(item));

  visibleItems.forEach((item, index) => {
    const fullPath = path.join(dir, item);
    let stat;
    try { stat = fs.statSync(fullPath); } catch { return; }

    const isLast = index === visibleItems.length - 1;
    const connector = isLast ? '└─ ' : '├─ ';
    structureOutput += `${prefix}${connector}${item}\n`;

    if (stat.isDirectory()) {
      walkStructure(fullPath, prefix + (isLast ? '   ' : '│  '));
    }
  });
}

/* ================================
   LER PACKAGE.JSON (DEPENDÊNCIAS)
================================ */
function getDependencies() {
  const pkgPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return 'Nenhum package.json encontrado.';

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return JSON.stringify({
    dependencies: pkg.dependencies || {},
    devDependencies: pkg.devDependencies || {}
  }, null, 2);
}

/* ================================
   GERAR CÓDIGO COMPLETO
================================ */
function walkCode(dir) {
  let items;
  try { items = fs.readdirSync(dir); } catch { return; }

  items.forEach(item => {
    if (IGNORE_DIRS.has(item)) return;

    const fullPath = path.join(dir, item);
    let stat;
    try { stat = fs.statSync(fullPath); } catch { return; }

    if (stat.isDirectory()) return walkCode(fullPath);

    const ext = path.extname(item);
    if (!ALLOWED_EXTENSIONS.has(ext)) return;

    if (stat.size > MAX_FILE_SIZE) {
      skippedFiles.push(path.relative(rootDir, fullPath));
      return;
    }

    const relativePath = path.relative(rootDir, fullPath);
    let content = '';

    try { content = fs.readFileSync(fullPath, 'utf-8'); }
    catch { content = '[ERRO AO LER ARQUIVO]'; }

    codeOutput += `
==================================================
ARQUIVO: ${relativePath}
==================================================

${content}

`;
  });
}

/* ================================
   EXECUÇÃO
================================ */
structureOutput += `${path.basename(rootDir)}/\n`;

walkStructure(rootDir);
walkCode(rootDir);

const finalOutput = `
##################################################
CONTEXTO COMPLETO DO PROJETO
##################################################

Data da exportação: ${now}

===============================
DEPENDÊNCIAS DO PROJETO
===============================
${getDependencies()}

===============================
ESTRUTURA DE PASTAS
===============================
${structureOutput}

===============================
ARQUIVOS IGNORADOS POR TAMANHO
===============================
${skippedFiles.join('\n') || 'Nenhum'}

===============================
CÓDIGO FONTE COMPLETO
===============================
${codeOutput}
`;

fs.writeFileSync(outputFile, finalOutput.trim(), 'utf-8');

console.log('\n✅ CONTEXTO GERADO COM SUCESSO');
console.log('📄 Arquivo:', outputFile);