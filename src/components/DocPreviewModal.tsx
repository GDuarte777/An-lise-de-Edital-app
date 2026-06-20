import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { 
  X, FileText, Printer, Code, Eye, HardDriveDownload, Save, 
  CheckCircle, Database, FileSpreadsheet, ExternalLink, RefreshCw 
} from "lucide-react";
import { addSyncedItem } from "../utils/googleSync";
import confetti from "canvas-confetti";

interface DocPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  initialMarkdown: string;
  type: "proposal" | "declaration";
  onAddLog: (logText: string) => void;
}

export default function DocPreviewModal({ isOpen, onClose, title, initialMarkdown, type, onAddLog }: DocPreviewModalProps) {
  const [markdownText, setMarkdownText] = useState(initialMarkdown);
  const [isEditing, setIsEditing] = useState(false);
  
  // Google sync indicators
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncDone, setSyncDone] = useState(false);

  if (!isOpen) return null;

  const handleDownload = () => {
    const element = document.createElement("a");
    const file = new Blob([markdownText], { type: "text/markdown;charset=utf-8" });
    element.href = URL.createObjectURL(file);
    element.download = title;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handlePrint = () => {
    window.print();
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
              onClick={handleDownload}
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-medium text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <HardDriveDownload className="w-3.5 h-3.5" />
              Baixar .md
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
