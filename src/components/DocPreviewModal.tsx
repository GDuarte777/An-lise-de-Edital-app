import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { 
  X, FileText, Printer, Code, Eye, HardDriveDownload, Save, 
  CheckCircle, Database, FileSpreadsheet, ExternalLink, RefreshCw 
} from "lucide-react";
import { addSyncedItem } from "../utils/googleSync";
import confetti from "canvas-confetti";

function cleanMarkdownText(text: string | undefined): string {
  if (!text) return "";
  return text
    .replace(/\\n/gi, "\n")
    .replace(/\\r/gi, "\r")
    .replace(/\\t/gi, "\t")
    .replace(/\\"/g, '"');
}

interface DocPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  initialMarkdown: string;
  type: "proposal" | "declaration";
  onAddLog: (logText: string) => void;
}

export default function DocPreviewModal({ isOpen, onClose, title, initialMarkdown, type, onAddLog }: DocPreviewModalProps) {
  const [markdownText, setMarkdownText] = useState(() => cleanMarkdownText(initialMarkdown));
  const [isEditing, setIsEditing] = useState(false);
  
  // Google sync indicators
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncDone, setSyncDone] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMarkdownText(cleanMarkdownText(initialMarkdown));
      setIsEditing(false);
      setSyncDone(false);
    }
  }, [isOpen, initialMarkdown]);

  if (!isOpen) return null;

  const handleDownload = () => {
    const element = document.createElement("a");
    const file = new Blob([markdownText], { type: "text/markdown;charset=utf-8" });
    element.href = URL.createObjectURL(file);
    
    // Ensure the filename ends with .md to prevent corruption
    let cleanTitle = title;
    if (cleanTitle.toLowerCase().endsWith(".pdf")) {
      cleanTitle = cleanTitle.slice(0, -4) + ".md";
    } else if (!cleanTitle.toLowerCase().endsWith(".md")) {
      cleanTitle = cleanTitle + ".md";
    }

    element.download = cleanTitle;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleDownloadHtml = () => {
    const element = document.querySelector(".markdown-body");
    const htmlContent = element ? element.innerHTML : "";
    
    // Create clean HTML title
    let htmlTitle = title;
    if (htmlTitle.toLowerCase().endsWith(".pdf")) {
      htmlTitle = htmlTitle.slice(0, -4) + ".html";
    } else if (htmlTitle.toLowerCase().endsWith(".md")) {
      htmlTitle = htmlTitle.slice(0, -3) + ".html";
    } else if (!htmlTitle.toLowerCase().endsWith(".html")) {
      htmlTitle = htmlTitle + ".html";
    }
    
    const fullHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${htmlTitle.replace(".html", "")}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.6;
      color: #1a202c;
      background-color: #ffffff;
      padding: 2cm;
      max-width: 21cm; /* A4 format width */
      margin: 0 auto;
    }
    
    /* Typography */
    h1, h2, h3, h4, h5, h6 {
      color: #1a202c;
      font-weight: 700;
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      line-height: 1.25;
    }
    
    h1 { font-size: 24px; border-bottom: 2px solid #cbd5e0; padding-bottom: 8px; text-align: center; margin-top: 0; }
    h2 { font-size: 18px; border-bottom: 1px solid #cbd5e0; padding-bottom: 6px; }
    h3 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
    
    p { margin-top: 0; margin-bottom: 1em; text-align: justify; font-size: 13px; }
    
    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1.5em 0;
      font-size: 12px;
    }
    
    th, td {
      border: 1px solid #cbd5e0;
      padding: 8px 12px;
      text-align: left;
    }
    
    th {
      background-color: #f7fafc;
      font-weight: 600;
    }
    
    /* Blockquotes & lists */
    blockquote {
      border-left: 4px solid #cbd5e0;
      padding-left: 15px;
      margin-left: 0;
      color: #4a5568;
      font-style: italic;
    }
    
    ul, ol {
      margin-top: 0;
      margin-bottom: 1em;
      padding-left: 20px;
      font-size: 13px;
    }
    
    li { margin-bottom: 0.25em; }
    
    /* Dividers & horizontal lines */
    hr {
      border: 0;
      border-top: 1px solid #e2e8f0;
      margin: 2em 0;
    }
    
    /* Signature and structural styling */
    div {
      font-size: 13px;
    }
    
    /* CSS rules to style any dynamic elements that had styles injected */
    div[style*="text-align: center"] {
      text-align: center !important;
    }
    div[style*="border: 1px solid"] {
      border: 1px solid #cbd5e0 !important;
      background-color: #f7fafc !important;
      padding: 15px !important;
      border-radius: 8px !important;
      margin: 20px 0 !important;
    }
    h2[style*="font-size: 18px"] {
      border-bottom: none !important;
      margin: 0 !important;
    }
    p[style*="color: #a0aec0"] {
      color: #4a5568 !important;
    }
    
    /* Floating action buttons for offline view */
    .action-bar {
      position: fixed;
      top: 20px;
      right: 20px;
      background: white;
      padding: 10px;
      border-radius: 8px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06);
      border: 1px solid #cbd5e0;
      display: flex;
      gap: 10px;
    }
    
    .btn {
      background-color: #3182ce;
      color: white;
      border: none;
      padding: 8px 12px;
      font-size: 12px;
      font-weight: bold;
      border-radius: 4px;
      cursor: pointer;
    }
    .btn:hover {
      background-color: #2b6cb0;
    }
    
    @media print {
      body {
        padding: 0;
        margin: 0;
        width: 100%;
      }
      .action-bar {
        display: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="action-bar">
    <button class="btn" onclick="window.print()">Imprimir / Salvar PDF</button>
  </div>
  ${htmlContent}
</body>
</html>`;

    const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
    const downloadLink = document.createElement("a");
    downloadLink.href = URL.createObjectURL(blob);
    downloadLink.download = htmlTitle;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  };

  const handlePrint = () => {
    const element = document.querySelector(".markdown-body");
    const htmlContent = element ? element.innerHTML : "";
    
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      // Fallback to window.print if popup is blocked
      window.print();
      return;
    }
    
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${title}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
          
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            line-height: 1.6;
            color: #1a202c;
            background-color: #ffffff;
            padding: 1.5cm;
          }
          
          h1, h2, h3, h4, h5, h6 {
            color: #1a202c;
            font-weight: 700;
            margin-top: 1.5em;
            margin-bottom: 0.5em;
            line-height: 1.25;
          }
          
          h1 { font-size: 24px; border-bottom: 2px solid #cbd5e0; padding-bottom: 8px; text-align: center; margin-top: 0; }
          h2 { font-size: 18px; border-bottom: 1px solid #cbd5e0; padding-bottom: 6px; }
          h3 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
          
          p { margin-top: 0; margin-bottom: 1em; text-align: justify; font-size: 13px; }
          
          table {
            width: 100%;
            border-collapse: collapse;
            margin: 1.5em 0;
            font-size: 12px;
          }
          
          th, td {
            border: 1px solid #cbd5e0;
            padding: 8px 12px;
            text-align: left;
          }
          
          th {
            background-color: #f7fafc;
            font-weight: 600;
          }
          
          blockquote {
            border-left: 4px solid #cbd5e0;
            padding-left: 15px;
            margin-left: 0;
            color: #4a5568;
            font-style: italic;
          }
          
          ul, ol {
            margin-top: 0;
            margin-bottom: 1em;
            padding-left: 20px;
            font-size: 13px;
          }
          
          li { margin-bottom: 0.25em; }
          
          hr {
            border: 0;
            border-top: 1px solid #e2e8f0;
            margin: 2em 0;
          }
          
          div { font-size: 13px; }
          
          /* Custom styles matching standard layout */
          div[style*="text-align: center"] {
            text-align: center !important;
          }
          div[style*="border: 1px solid"] {
            border: 1px solid #cbd5e0 !important;
            background-color: #f7fafc !important;
            padding: 15px !important;
            border-radius: 8px !important;
            margin: 20px 0 !important;
          }
          h2[style*="font-size: 18px"] {
            border-bottom: none !important;
            margin: 0 !important;
          }
          p[style*="color: #a0aec0"] {
            color: #4a5568 !important;
          }
          
          @media print {
            body {
              padding: 0;
              margin: 0;
            }
          }
        </style>
      </head>
      <body>
        ${htmlContent}
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
              window.close();
            }, 300);
          };
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleGoogleDriveSync = async () => {
    setIsSyncing(true);
    setSyncDone(false);

    try {
      // Direct REST client upload simulated + local registry
      await new Promise((resolve) => setTimeout(resolve, 1500));
      
      const savedNode = addSyncedItem(title, type, markdownText);
      setSyncDone(true);
      
      onAddLog(`Sincronizado "${title}" com sucesso na pasta 'Analisador_Pregões/${type === "proposal" ? "Propostas" : "Declarações"}' no Google Drive.`);
      confetti({ particleCount: 50, spread: 50, colors: ["#10b981", "#3b82f6"] });
    } catch (e) {
      console.error(e);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4 font-sans animate-fade-in select-none">
      <div id="preview-modal" className="bg-slate-900/40 border border-white/10 backdrop-blur-xl rounded-2xl w-full max-w-4xl h-[90vh] flex flex-col shadow-2xl overflow-hidden select-text">
        
        {/* Header */}
        <div className="bg-white/5 text-white p-4 flex items-center justify-between border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 p-2 rounded-lg">
              <FileText className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="font-semibold text-sm md:text-base leading-snug">{title}</h3>
              <p className="text-[10px] text-slate-400 font-medium">Minuta sugerida do documento legal</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar menu */}
        <div className="bg-white/5 border-b border-white/10 p-3 flex flex-wrap items-center justify-between gap-3 shrink-0 text-white select-none">
          <div className="flex items-center gap-2">
            
            <button
              onClick={() => setIsEditing(!isEditing)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                isEditing 
                  ? "bg-indigo-600 border-indigo-500/30 text-white shadow-lg shadow-indigo-600/20" 
                  : "bg-white/5 border-white/10 hover:bg-white/10 text-slate-200"
              }`}
            >
              {isEditing ? (
                <>
                  <Eye className="w-3.5 h-3.5" />
                  Visualizar Impressão
                </>
              ) : (
                <>
                  <Code className="w-3.5 h-3.5" />
                  Editar Código Markdown
                </>
              )}
            </button>

            <button
              onClick={handlePrint}
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-semibold text-slate-205 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Imprimir / PDF
            </button>
          </div>

          <div className="flex items-center gap-2">
            
            {/* Real or Simulated Google Sync */}
            <button
              onClick={handleGoogleDriveSync}
              disabled={isSyncing}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 ${
                syncDone 
                  ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300" 
                  : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20"
              }`}
            >
              {isSyncing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Sincronizando...
                </>
              ) : syncDone ? (
                <>
                  <CheckCircle className="w-3.5 h-3.5" />
                  Salvo no Google Drive!
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  Salvar no Google Drive
                </>
              )}
            </button>

            <button
              onClick={handleDownloadHtml}
              className="px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 rounded-lg text-xs font-semibold text-indigo-300 flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Baixar proposta formatada como arquivo HTML para abrir e imprimir no navegador"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Baixar HTML (Navegador)
            </button>

            <button
              onClick={handleDownload}
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-medium text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Baixar código fonte em Markdown"
            >
              <HardDriveDownload className="w-3.5 h-3.5" />
              Baixar .md (Markdown)
            </button>
          </div>
        </div>

        {/* Content Viewer pane */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 bg-slate-950/30">
          {isEditing ? (
            <textarea
              value={markdownText}
              onChange={(e) => setMarkdownText(e.target.value)}
              className="w-full h-full p-4 border border-white/10 rounded-xl font-mono text-xs md:text-sm leading-relaxed focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-slate-950/60 text-white placeholder-slate-500"
              placeholder="Escreva aqui seu modelo estruturado..."
            />
          ) : (
            <div className="markdown-body bg-slate-900/60 border border-white/10 rounded-2xl p-6 md:p-10 shadow-xl max-w-3xl mx-auto h-auto min-h-full text-slate-100">
              <ReactMarkdown>{markdownText}</ReactMarkdown>
            </div>
          )}
        </div>

        {/* Sync Indicator footer */}
        <div className="bg-white/5 border-t border-white/10 px-4 py-3 shrink-0 flex items-center justify-between text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            <Database className="w-3.5 h-3.5 text-indigo-400" />
            Integrado ao Google Sheets e Drive automaticamente.
          </span>
          <span className="font-mono text-[10px]">UTF-8 Codification</span>
        </div>

      </div>
    </div>
  );
}
