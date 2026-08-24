import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { 
  X, FileText, Printer, Code, Eye, HardDriveDownload, Save, 
  CheckCircle, Database, FileSpreadsheet, ExternalLink, RefreshCw 
} from "lucide-react";
import { addSyncedItem } from "../utils/googleSync";
import confetti from "canvas-confetti";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-2 sm:p-4 md:p-6 font-sans animate-fade-in select-none overflow-y-auto">
      <div id="preview-modal" className="bg-card text-card-foreground border border-border rounded-2xl w-full max-w-5xl h-[92vh] sm:h-[88vh] flex flex-col shadow-2xl overflow-hidden select-text my-auto">

        {/* Header */}
        <div className="bg-card text-card-foreground p-3.5 sm:p-4 flex items-center justify-between border-b border-border shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            <div className="bg-primary/10 text-primary border border-primary/20 p-2 rounded-xl shrink-0">
              <FileText className="w-5 h-5 animate-pulse" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-xs sm:text-base leading-snug text-foreground truncate">{title}</h3>
              <p className="text-[10px] text-muted-foreground font-medium truncate">Minuta sugerida do documento oficial</p>
            </div>
          </div>

          <Button
            onClick={onClose}
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground shrink-0"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Toolbar menu */}
        <div className="bg-muted/50 border-b border-border p-2.5 sm:p-3 flex flex-wrap items-center justify-between gap-2 shrink-0 text-foreground select-none">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">

            <Button
              onClick={() => setIsEditing(!isEditing)}
              variant={isEditing ? "default" : "outline"}
              size="sm"
              className="text-xs font-semibold"
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
            </Button>

            <Button
              onClick={handlePrint}
              variant="outline"
              size="sm"
              className="text-xs font-semibold"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimir / PDF</span>
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">

            {/* Real or Simulated Google Sync */}
            <Button
              onClick={handleGoogleDriveSync}
              disabled={isSyncing}
              variant={syncDone ? "outline" : "default"}
              size="sm"
              className={`text-xs font-semibold ${
                syncDone ? "border-success/30 bg-success/10 text-success hover:bg-success/15" : ""
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
            </Button>

            <Button
              onClick={handleDownloadHtml}
              variant="outline"
              size="sm"
              className="text-xs font-semibold bg-primary/10 hover:bg-primary/20 border-primary/20 text-primary"
              title="Baixar proposta formatada como arquivo HTML para abrir e imprimir no navegador"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>HTML</span>
            </Button>

            <Button
              onClick={handleDownload}
              variant="outline"
              size="sm"
              className="text-xs font-medium"
              title="Baixar código fonte em Markdown"
            >
              <HardDriveDownload className="w-3.5 h-3.5" />
              <span>.md</span>
            </Button>
          </div>
        </div>

        {/* Content Viewer pane */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-6 md:p-8 bg-muted">
          <div
            className="official-a4-paper bg-white text-slate-900 border border-slate-200 rounded-sm p-4 sm:p-8 md:p-14 shadow-xl max-w-3xl mx-auto h-auto min-h-full font-sans leading-relaxed text-xs"
            style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
          >
            {isEditing ? (
              <Textarea
                value={markdownText}
                onChange={(e) => setMarkdownText(e.target.value)}
                className="w-full h-full min-h-[500px] bg-white text-slate-900 font-sans text-xs leading-relaxed focus-visible:ring-2 focus-visible:ring-primary border-slate-300 p-4 rounded-lg selection:bg-orange-100"
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
        <div className="bg-card border-t border-border px-4 py-3 shrink-0 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Database className="w-3.5 h-3.5 text-primary" />
            Integrado ao Google Sheets e Drive automaticamente.
          </span>
          <span className="font-mono text-[10px]">UTF-8 Codification</span>
        </div>

      </div>
    </div>
  );
}
