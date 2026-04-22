const fs = require('fs');
const path = require('path');

const rootDir = process.cwd();

/**
 * CONFIGURAÇÃO DE MÓDULOS
 * Aqui definimos quais pastas pertencem a cada módulo lógico.
 */
const MODULES = {
  'memoria': ['lib/llm/memory'],
  'contexto': ['lib/llm/context'],
  'groq': ['lib/llm/groq'],
  'api': ['app/api/chat'],
  'ui': ['app/chat', 'app/globals.css'],
  'core': ['lib/llm/pipeline.ts', 'lib/llm/types.ts', 'lib/llm/supabase'],
};

// Arquivos que SEMPRE serão incluídos em qualquer exportação (essenciais para contexto)
const ESSENTIAL_FILES = [
  'lib/llm/types.ts',
  'package.json',
  'tsconfig.json'
];

const IGNORE_DIRS = new Set([
  'node_modules', '.next', '.git', 'dist', '.vscode', 'coverage', 'build', '.turbo'
]);

const ALLOWED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.env', '.css'
]);

const MAX_FILE_SIZE = 200 * 1024;

// Captura o argumento do módulo (ex: node exportar-modulo.js memoria)
const targetModule = process.argv[2]?.toLowerCase();

if (!targetModule || (!MODULES[targetModule] && targetModule !== 'total')) {
  console.log('\n❌ Por favor, especifique um módulo válido:');
  console.log('Opções: ' + Object.keys(MODULES).join(', ') + ', total');
  console.log('Exemplo: node exportar-modulo.js memoria\n');
  process.exit(1);
}

const outputFile = path.join(rootDir, `CONTEXTO_${targetModule.toUpperCase()}.txt`);

let codeOutput = '';
let includedFiles = new Set();

/**
 * Adiciona um arquivo ou diretório ao conjunto de arquivos incluídos
 */
function collectFiles(targetPath) {
  const fullPath = path.join(rootDir, targetPath);
  if (!fs.existsSync(fullPath)) return;

  const stat = fs.statSync(fullPath);
  if (stat.isFile()) {
    includedFiles.add(targetPath);
  } else if (stat.isDirectory()) {
    const items = fs.readdirSync(fullPath);
    items.forEach(item => {
      if (IGNORE_DIRS.has(item)) return;
      collectFiles(path.join(targetPath, item));
    });
  }
}

// 1. Coletar arquivos essenciais
ESSENTIAL_FILES.forEach(collectFiles);

// 2. Coletar arquivos do módulo alvo (ou tudo se for 'total')
if (targetModule === 'total') {
  function walkAll(dir, base = '') {
    const items = fs.readdirSync(dir);
    items.forEach(item => {
      if (IGNORE_DIRS.has(item)) return;
      const fullPath = path.join(dir, item);
      const relPath = path.join(base, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) walkAll(fullPath, relPath);
      else includedFiles.add(relPath);
    });
  }
  walkAll(rootDir);
} else {
  MODULES[targetModule].forEach(collectFiles);
}

// 3. Ler e formatar o conteúdo
includedFiles.forEach(relPath => {
  const fullPath = path.join(rootDir, relPath);
  const ext = path.extname(relPath);
  
  if (!ALLOWED_EXTENSIONS.has(ext)) return;
  
  const stat = fs.statSync(fullPath);
  if (stat.size > MAX_FILE_SIZE) return;

  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    codeOutput += `\n==================================================\n`;
    codeOutput += `ARQUIVO: ${relPath}\n`;
    codeOutput += `==================================================\n\n`;
    codeOutput += content + `\n`;
  } catch (e) {
    codeOutput += `\n[ERRO AO LER ${relPath}]\n`;
  }
});

const finalOutput = `##################################################
CONTEXTO DO MÓDULO: ${targetModule.toUpperCase()}
Data: ${new Date().toLocaleString()}
##################################################

${codeOutput}`;

fs.writeFileSync(outputFile, finalOutput.trim(), 'utf-8');

console.log(`\n✅ CONTEXTO DO MÓDULO [${targetModule.toUpperCase()}] GERADO`);
console.log(`📄 Arquivo: ${outputFile}\n`);
