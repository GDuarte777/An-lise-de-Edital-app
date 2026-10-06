// ═══════════════════════════════════════════════════════════════════════
// EMPACOTA A EXTENSÃO PARA DOWNLOAD
//
// Gera public/extensao-horasis.zip a partir de extensao/, para a aba Robô de
// Lances oferecer o arquivo direto. Roda no `prebuild`, não à mão: um .zip
// commitado no repositório envelhece em silêncio, e a falha que isso produz é
// a pior de todas — o operador instala uma extensão antiga, ela conversa com
// um backend novo, e o erro aparece no meio do pregão.
//
// Gera também public/extensao-horasis.json, com a versão lida do manifesto,
// para a tela dizer o que está oferecendo em vez de um link anônimo.
// ═══════════════════════════════════════════════════════════════════════
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const origem = join(raiz, "extensao");
const destino = join(raiz, "public");
const NOME_ZIP = "extensao-horasis.zip";

/** Arquivos que não devem viajar dentro da extensão instalada. */
const IGNORADOS = new Set(["README.md", ".DS_Store"]);

async function listarArquivos(pasta) {
  const entradas = await readdir(pasta, { withFileTypes: true });
  const arquivos = [];
  for (const entrada of entradas) {
    const caminho = join(pasta, entrada.name);
    if (entrada.isDirectory()) {
      arquivos.push(...(await listarArquivos(caminho)));
    } else if (!IGNORADOS.has(entrada.name)) {
      arquivos.push(caminho);
    }
  }
  return arquivos.sort();
}

async function empacotar() {
  const manifesto = JSON.parse(await readFile(join(origem, "manifest.json"), "utf-8"));
  const arquivos = await listarArquivos(origem);

  const zip = new JSZip();
  for (const caminho of arquivos) {
    // O Chrome carrega a pasta descompactada: os caminhos dentro do .zip são
    // relativos à raiz da extensão, sem a pasta `extensao/` por fora.
    zip.file(relative(origem, caminho).split("\\").join("/"), await readFile(caminho), {
      // Data fixa: com o horário do build, cada publicação geraria um .zip
      // diferente byte a byte mesmo sem nenhuma mudança na extensão.
      date: new Date("2026-01-01T00:00:00Z"),
    });
  }

  const conteudo = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });

  await mkdir(destino, { recursive: true });
  await writeFile(join(destino, NOME_ZIP), conteudo);
  await writeFile(
    join(destino, "extensao-horasis.json"),
    JSON.stringify(
      {
        versao: manifesto.version,
        nome: manifesto.name,
        arquivo: NOME_ZIP,
        bytes: conteudo.length,
        // Para quem quiser conferir que baixou o mesmo arquivo que publicamos.
        sha256: createHash("sha256").update(conteudo).digest("hex"),
      },
      null,
      2,
    ) + "\n",
  );

  const kb = (conteudo.length / 1024).toFixed(0);
  console.log(`[extensao] ${NOME_ZIP}: ${arquivos.length} arquivos, ${kb} KB, versão ${manifesto.version}`);
}

empacotar().catch((erro) => {
  console.error("[extensao] Falha ao empacotar:", erro?.message || erro);
  process.exit(1);
});
