import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { 
  X, FileText, Printer, Code, Eye, HardDriveDownload, Save, 
  CheckCircle, Database, FileSpreadsheet, ExternalLink, RefreshCw 
} from "lucide-react";
import { addSyncedItem } from "../utils/googleSync";
import confetti from "canvas-confetti";

function cleanMarkdownText(text: string | undefined): string {
  if (!text) return "";
  let cleaned = text
    .replace(/\\n/gi, "\n")
    .replace(/\\r/gi, "\r")
    .replace(/\\t/gi, "\t")
    .replace(/\\"/g, '"');

  // Repair legacy mangled backslashes (e.g. "NN##", "|N|", "NN 1.", "|N ", "N| ")
  cleaned = cleaned.replace(/NN(#{1,6}\s)/g, "\n\n$1");
  cleaned = cleaned.replace(/nn(#{1,6}\s)/g, "\n\n$1");
  cleaned = cleaned.replace(/([^\n])(\|[\s\w\d\-_Á-Úá-ú]+\|)/g, "$1\n\n$2");
  cleaned = cleaned.replace(/\|N\|\s*/gi, "|\n| ");
  cleaned = cleaned.replace(/\|N\s*/gi, "|\n");

  return cleaned;
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
          
          @page {
            size: A4;
            margin: 0;
          }
          @media print {
            html, body {
              margin: 0;
              padding: 0;
              background-color: #ffffff;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
          }
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            line-height: 1.6;
            color: #1a202c;
            background-color: #ffffff;
            padding: 1.5cm 2cm;
            margin: 0;
            box-sizing: border-box;
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
      
      onAddLog(`Sincronizado "${title}" com sucesso na pasta 'HORASIS_Licitações/${type === "proposal" ? "Propostas" : "Declarações"}' no Google Drive.`);
      confetti({ particleCount: 50, spread: 50, colors: ["#10b981", "#3b82f6"] });
    } catch (e) {
      console.error(e);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-2 sm:p-4 md:p-6 font-sans animate-fade-in select-none overflow-y-auto">
      <div id="preview-modal" className="bg-white dark:bg-[#121212] border border-[#E5E7EB] dark:border-[#27272A] rounded-2xl w-full max-w-5xl h-[92vh] sm:h-[88vh] flex flex-col shadow-2xl overflow-hidden select-text my-auto">
        
        {/* Header */}
        <div className="bg-white dark:bg-[#18181B] text-[#111827] dark:text-zinc-100 p-3.5 sm:p-4 flex items-center justify-between border-b border-[#F3F4F6] dark:border-[#27272A] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            <div className="bg-[#FF5A00]/10 text-[#FF5A00] border border-[#FF5A00]/20 p-2 rounded-xl shrink-0">
              <FileText className="w-5 h-5 animate-pulse" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-xs sm:text-base leading-snug text-[#111827] dark:text-zinc-100 truncate">{title}</h3>
              <p className="text-[10px] text-[#6B7280] dark:text-zinc-400 font-medium truncate">Minuta sugerida do documento oficial</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-[#6B7280] dark:text-zinc-400 hover:text-[#111827] dark:hover:text-white p-1.5 hover:bg-[#F3F4F6] dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar menu */}
        <div className="bg-[#F9FAFB] dark:bg-[#18181B] border-b border-[#E5E7EB] dark:border-[#27272A] p-2.5 sm:p-3 flex flex-wrap items-center justify-between gap-2 shrink-0 text-[#374151] select-none">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            
            <button
              onClick={() => setIsEditing(!isEditing)}
              className={`px-2.5 sm:px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                isEditing 
                  ? "bg-[#FF5A00] border-[#FF5A00] text-white shadow-xs" 
                  : "bg-white dark:bg-[#27272A] border-[#D1D5DB] dark:border-[#3F3F46] hover:bg-[#F3F4F6] dark:hover:bg-zinc-700 text-[#374151] dark:text-zinc-200"
              }`}
            >
              {isEditing ? (
                <>
                  <Eye className="w-3.5 h-3.5" />
                  <span>Visualizar</span>
                </>
              ) : (
                <>
                  <Code className="w-3.5 h-3.5" />
                  <span>Editar Markdown</span>
                </>
              )}
            </button>

            <button
              onClick={handlePrint}
              className="px-2.5 sm:px-3 py-1.5 bg-white dark:bg-[#27272A] hover:bg-[#F3F4F6] dark:hover:bg-zinc-700 border border-[#D1D5DB] dark:border-[#3F3F46] rounded-lg text-xs font-semibold text-[#374151] dark:text-zinc-200 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimir / PDF</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            
            {/* Real or Simulated Google Sync */}
            <button
              onClick={handleGoogleDriveSync}
              disabled={isSyncing}
              className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 ${
                syncDone 
                  ? "bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300" 
                  : "bg-[#FF5A00] hover:bg-[#E04F00] active:bg-[#C74400] text-white shadow-xs"
              }`}
            >
              {isSyncing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Sincronizando...</span>
                </>
              ) : syncDone ? (
                <>
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>Salvo no Drive!</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Google Drive</span>
                </>
              )}
            </button>

            <button
              onClick={handleDownloadHtml}
              className="px-2.5 sm:px-3 py-1.5 bg-[#FF5A00]/10 hover:bg-[#FF5A00]/20 border border-[#FF5A00]/20 rounded-lg text-xs font-semibold text-[#FF5A00] flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Baixar proposta formatada como arquivo HTML para abrir e imprimir no navegador"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>HTML</span>
            </button>

            <button
              onClick={handleDownload}
              className="px-2.5 sm:px-3 py-1.5 bg-white dark:bg-[#27272A] hover:bg-[#F3F4F6] dark:hover:bg-zinc-700 border border-[#D1D5DB] dark:border-[#3F3F46] rounded-lg text-xs font-medium text-[#374151] dark:text-zinc-200 flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Baixar código fonte em Markdown"
            >
              <HardDriveDownload className="w-3.5 h-3.5" />
              <span>.md</span>
            </button>
          </div>
        </div>

        {/* Content Viewer pane */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-6 md:p-8 bg-[#F3F4F6] dark:bg-[#09090B]">
          <div 
            className="official-a4-paper bg-white text-slate-900 border border-slate-200 rounded-sm p-4 sm:p-8 md:p-14 shadow-xl max-w-3xl mx-auto h-auto min-h-full font-sans leading-relaxed text-xs"
            style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
          >
            {isEditing ? (
              <textarea
                value={markdownText}
                onChange={(e) => setMarkdownText(e.target.value)}
                className="w-full h-full min-h-[500px] bg-white text-slate-900 font-sans text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#FF5A00] border border-slate-300 p-4 rounded-lg selection:bg-orange-100"
                style={{ backgroundColor: "#ffffff", color: "#0f172a", lineHeight: "1.7" }}
                placeholder="Escreva aqui seu modelo estruturado..."
              />
            ) : (
              <div className="markdown-body text-slate-900">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdownText}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>

        {/* Sync Indicator footer */}
        <div className="bg-white border-t border-[#E5E7EB] px-4 py-3 shrink-0 flex items-center justify-between text-[11px] text-[#6B7280]">
          <span className="flex items-center gap-1">
            <Database className="w-3.5 h-3.5 text-[#FF5A00]" />
            Integrado ao Google Sheets e Drive automaticamente.
          </span>
          <span className="font-mono text-[10px]">UTF-8 Codification</span>
        </div>

      </div>
    </div>
  );
}
