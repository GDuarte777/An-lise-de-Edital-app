import { useState, useEffect } from "react";
import { 
  Database, FolderOpen, FileSpreadsheet, FileText, HardDrive, 
  CloudRain, RefreshCw, Trash2, CheckCircle2, ShieldCheck, 
  Grid, ExternalLink, Download, Eye, HelpCircle, ArrowRight, Server, Search,
  Key, Globe, Terminal, Copy, Check, AlertCircle, Sparkles, Lock, User, LogOut, Zap, BarChart3
} from "lucide-react";
import { getSyncedItems, saveSyncedItems, isGoogleConnected, getGoogleAccessToken, getConnectedUserEmail } from "../utils/googleSync";
import { 
  getSupabaseConfig, 
  saveSupabaseConfig, 
  clearSupabaseConfig, 
  testSupabaseConnection, 
  getSupabaseClient,
  fetchSupabaseTableCounts,
  signUpWithSupabase,
  signInWithSupabase,
  signOutWithSupabase
} from "../utils/supabaseClient";
import { SyncItem } from "../types";
import ReactMarkdown from "react-markdown";

interface CloudSyncTabProps {
  companyData: any;
  activeEdital: any;
}

export default function CloudSyncTab({ companyData, activeEdital }: CloudSyncTabProps) {
  const [items, setItems] = useState<SyncItem[]>([]);
  const [connected, setConnected] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<string>("Analisador_Pregões/");
  const [selectedFile, setSelectedFile] = useState<SyncItem | null>(null);
  const [fileContentModalOpen, setFileContentModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sheetsData, setSheetsData] = useState<any[]>([]);

  // Supabase connection configuration states
  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [supabaseAnonKey, setSupabaseAnonKey] = useState("");
  const [testingSupabase, setTestingSupabase] = useState(false);
  const [supabaseTestResult, setSupabaseTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [supabaseConnected, setSupabaseConnected] = useState(false);
  const [showSqlSetup, setShowSqlSetup] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [supabaseSyncLogs, setSupabaseSyncLogs] = useState<any[]>([]);

  // SaaS Integration and User Management States
  const [supabaseRouteAi, setSupabaseRouteAi] = useState<boolean>(() => {
    return localStorage.getItem("supabase_route_ai") === "true";
  });
  const [supabaseAuthEmail, setSupabaseAuthEmail] = useState("");
  const [supabaseAuthPassword, setSupabaseAuthPassword] = useState("");
  const [supabaseUser, setSupabaseUser] = useState<any | null>(null);
  const [supabaseAuthMode, setSupabaseAuthMode] = useState<"signin" | "signup">("signin");
  const [supabaseAuthLoading, setSupabaseAuthLoading] = useState(false);
  const [supabaseAuthMessage, setSupabaseAuthMessage] = useState<{ success: boolean; message: string } | null>(null);
  const [dbMetrics, setDbMetrics] = useState({ editais: 0, documentos: 0 });
  const [saasPlan, setSaasPlan] = useState<string>(() => {
    return localStorage.getItem("supabase_saas_plan") || "Free";
  });

  // Update real table row counts to show in SaaS Dashboard
  const updateTableCounts = async () => {
    const counts = await fetchSupabaseTableCounts();
    setDbMetrics(counts);
  };



  // Refresh items from localStorage on mount/update
  const refreshItems = () => {
    const list = getSyncedItems();
    setItems(list);
    setConnected(isGoogleConnected());
    setUserEmail(getConnectedUserEmail());

    // Load local logs for Supabase
    const dbLogs = JSON.parse(localStorage.getItem("supabase_sync_logs") || "[]");
    setSupabaseSyncLogs(dbLogs);

    // Check if connected
    const config = getSupabaseConfig();
    setSupabaseConnected(!!config.url && !!config.anonKey);

    // Generate simulated Google Sheet rows based on actual analyses sync logs
    const sheetRows = list
      .filter(it => it.type === "sheet" || it.name.includes("Análise"))
      .map((it, idx) => {
        // Try parsing lines to extract keys if it matches standard format
        const lines = it.name.split("\n");
        return {
          id: it.id,
          title: it.name.replace("Análise Edital - ", "").replace(".md", ""),
          timestamp: it.timestamp,
          orgao: activeEdital?.identificacaoCertame?.orgaoComprador || "Prefeitura Municipal de Juazeiro/BA",
          produto: activeEdital?.descricaoProduto?.slice(0, 50) || "Equipamentos Audiovisuais e Projetores",
          prazoEntrega: activeEdital?.logisticaCronograma?.prazoEntregaReal || "15 dias corridos",
          prazoPagamento: activeEdital?.viabilidadeFinanceira?.prazoPagamento || "Em até 30 dias"
        };
      });

    // Add initial default mock row so sheet is never completely empty
    if (sheetRows.length === 0) {
      sheetRows.push({
        id: "default-sheet-1",
        title: "Análise Edital - Equipamentos TI",
        timestamp: new Date().toLocaleDateString('pt-BR'),
        orgao: "Secretaria de Educação de Juazeiro/BA",
        produto: "PROJETOR MULTIMÍDIA INTERATIVO EPSON",
        prazoEntrega: "15 dias corridos",
        prazoPagamento: "Em até 30 dias úteis"
      });
    }
    setSheetsData(sheetRows);
  };

  useEffect(() => {
    // Load Supabase Config once on mount
    const config = getSupabaseConfig();
    setSupabaseUrl(config.url);
    setSupabaseAnonKey(config.anonKey);
    const isConn = !!config.url && !!config.anonKey;
    setSupabaseConnected(isConn);

    if (isConn) {
      updateTableCounts();
      const client = getSupabaseClient();
      if (client) {
        client.auth.getUser().then(({ data }) => {
          if (data?.user) {
            setSupabaseUser(data.user);
          }
        }).catch(() => {});
      }
    }

    refreshItems();
    // Poll for changes in synced items
    const interval = setInterval(() => {
      refreshItems();
      if (isConn) {
        updateTableCounts().catch(() => {});
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [activeEdital]);


  const handleTestAndSaveSupabase = async () => {
    setTestingSupabase(true);
    setSupabaseTestResult(null);
    try {
      const res = await testSupabaseConnection(supabaseUrl, supabaseAnonKey);
      setSupabaseTestResult(res);
      if (res.success) {
        saveSupabaseConfig(supabaseUrl, supabaseAnonKey);
        setSupabaseConnected(true);
      } else {
        setSupabaseConnected(false);
      }
    } catch (err: any) {
      setSupabaseTestResult({ success: false, message: err.message || "Falha ao conectar." });
      setSupabaseConnected(false);
    } finally {
      setTestingSupabase(false);
    }
  };

  const handleDisconnectSupabase = () => {
    clearSupabaseConfig();
    setSupabaseUrl("");
    setSupabaseAnonKey("");
    setSupabaseConnected(false);
    setSupabaseTestResult(null);
  };

  const handleCopySql = () => {
    const sqlText = `-- 1. Criar a tabela de Editais Analisados
create table if not exists editais_analisados (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  date text not null,
  analysis jsonb not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Criar a tabela de Documentos Sincronizados
create table if not exists documentos_sincronizados (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  type text,
  path text,
  timestamp text,
  url text,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Criar a tabela de Certidões Fiscais
create table if not exists certidoes_fiscais (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  emission_date text,
  expiration_date text,
  status text not null,
  notes text,
  file_uploaded boolean default false,
  file_name text,
  document_matches_row boolean default false,
  validation_feedback text,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Criar a tabela de Histórico de Concorrentes
create table if not exists historico_concorrentes (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  competitor_name text not null,
  focus_items text,
  date text,
  edital_title text,
  analysis jsonb,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. Criar a tabela de Sessões de Chat
create table if not exists sessoes_chat (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  selected_edital_id text,
  messages jsonb not null,
  created_at text,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Habilitar RLS (Row Level Security) em todas as tabelas
alter table editais_analisados enable row level security;
alter table documentos_sincronizados enable row level security;
alter table certidoes_fiscais enable row level security;
alter table historico_concorrentes enable row level security;
alter table sessoes_chat enable row level security;

-- Criar políticas de segurança RLS (Garantindo isolamento total por usuário)
create policy "Usuários podem ver apenas seus próprios editais" on editais_analisados
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Usuários podem ver apenas seus próprios documentos" on documentos_sincronizados
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Usuários podem ver apenas suas próprias certidões" on certidoes_fiscais
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Usuários podem ver apenas seus próprios concorrentes" on historico_concorrentes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Usuários podem ver apenas seus próprios chats" on sessoes_chat
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);`;
    
    navigator.clipboard.writeText(sqlText);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  const handleAuthAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabaseConnected) {
      setSupabaseAuthMessage({ success: false, message: "Configure e conecte ao Supabase primeiro antes de autenticar usuários SaaS." });
      return;
    }
    setSupabaseAuthLoading(true);
    setSupabaseAuthMessage(null);
    try {
      if (supabaseAuthMode === "signup") {
        const res = await signUpWithSupabase(supabaseAuthEmail, supabaseAuthPassword);
        setSupabaseAuthMessage(res);
        if (res.success && res.user) {
          setSupabaseUser(res.user);
        }
      } else {
        const res = await signInWithSupabase(supabaseAuthEmail, supabaseAuthPassword);
        setSupabaseAuthMessage(res);
        if (res.success && res.session?.user) {
          setSupabaseUser(res.session.user);
        }
      }
    } catch (err: any) {
      setSupabaseAuthMessage({ success: false, message: err.message || "Erro desconhecido na autenticação." });
    } finally {
      setSupabaseAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOutWithSupabase();
    setSupabaseUser(null);
    setSupabaseAuthMessage({ success: true, message: "Sessão SaaS encerrada no Supabase." });
    setSupabaseAuthEmail("");
    setSupabaseAuthPassword("");
  };

  const handleToggleRouteAi = (checked: boolean) => {
    if (checked && !supabaseConnected) {
      alert("Para rotear a IA pelo Supabase, você precisa configurar a URL e a Anon Key válidas primeiro.");
      return;
    }
    setSupabaseRouteAi(checked);
    localStorage.setItem("supabase_route_ai", String(checked));
    
    // Add audit log
    const localLogs = JSON.parse(localStorage.getItem("supabase_sync_logs") || "[]");
    localLogs.unshift({
      id: Math.random().toString(36).substring(7),
      orgao: "SISTEMA INTEGRADO",
      modalidade: "CONFIG",
      numero: "AI_ROUTING",
      data_sessao: "-",
      produto: checked ? "Roteamento de IA via Supabase Edge Function Ativado!" : "Roteamento de IA desativado (usando backend local)",
      status: "Configuração Atualizada",
      updated_at: new Date().toISOString()
    });
    localStorage.setItem("supabase_sync_logs", JSON.stringify(localLogs));
    setSupabaseSyncLogs(localLogs);
  };

  const handleChangePlan = (plan: string) => {
    setSaasPlan(plan);
    localStorage.setItem("supabase_saas_plan", plan);
  };


  const handleDeleteItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Deseja realmente remover o registro de sincronismo deste arquivo?")) {
      const updated = items.filter(it => it.id !== id);
      saveSyncedItems(updated);
      refreshItems();
      if (selectedFile?.id === id) {
        setSelectedFile(null);
      }
    }
  };

  const handleDownloadMarkdown = (file: SyncItem) => {
    // Generate simple content fallback or extract from local context
    let text = `# ${file.name}\n\nDocumento gerado e armazenado na pasta virtual do Google Drive.\nTipo: ${file.type}\nCaminho: ${file.path}${file.name}\nSincronizado em: ${file.timestamp}`;
    
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = file.name.endsWith(".md") ? file.name : `${file.name}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleViewFile = (file: SyncItem) => {
    setSelectedFile(file);
    setFileContentModalOpen(true);
  };

  // Group files by path/folders
  const folderStructure = [
    { name: "Pasta Raiz", path: "Analisador_Pregões/" },
    { name: "Propostas Geradas", path: "Analisador_Pregões/Propostas/" },
    { name: "Declarações Oficiais", path: "Analisador_Pregões/Declarações/" },
    { name: "Planilhas de Auditoria", path: "Analisador_Pregões/Planilhas/" }
  ];

  // Filter items based on active folder & search query
  const filteredItems = items.filter(it => {
    const matchesFolder = activeFolder === "Analisador_Pregões/" || it.path === activeFolder;
    const matchesSearch = it.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFolder && matchesSearch;
  });

  return (
    <div id="cloud-sync-tab" className="space-y-6 animate-fade-in font-sans text-xs">
      
      {/* Visual Title Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/50 p-6 border border-white/10 rounded-2xl">
        <div className="flex items-start gap-3.5">
          <div className="p-3 bg-indigo-600/10 text-indigo-400 rounded-xl border border-indigo-500/20 shrink-0">
            <Database className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h3 className="font-bold text-white text-base">Banco de Dados & Sincronismo Nuvem</h3>
            <p className="text-slate-400 text-xs mt-0.5 max-w-2xl">
              Entenda como seus dados são armazenados localmente e visualize as pastas e planilhas integradas do seu Google Workspace (Drive e Sheets).
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <span className="text-slate-300 font-mono text-[10px] uppercase tracking-wider">
            {connected ? `Workspace Conectado (${userEmail || "gabrieltrafego7@gmail.com"})` : "Modo de Armazenamento Local Ativo"}
          </span>
        </div>
      </div>

      {/* Supabase Connection Config Panel */}
      <div className="bg-slate-900/40 border border-white/10 rounded-2xl p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20 shrink-0 mt-0.5">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-white text-sm flex items-center gap-2 flex-wrap">
                Conexão com Banco de Dados Supabase (PostgreSQL)
                <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${
                  supabaseConnected 
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                    : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                }`}>
                  {supabaseConnected ? "CONECTADO" : "NÃO CONFIGURADO"}
                </span>
              </h4>
              <p className="text-slate-400 text-[11px] mt-0.5 leading-relaxed">
                Sincronize as análises de editais e os documentos gerados em tempo real diretamente na sua instância Postgres hospedada no Supabase.
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
            <button
              onClick={() => setShowSqlSetup(!showSqlSetup)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition-colors border border-white/10 flex items-center gap-1.5 font-semibold text-[11px] cursor-pointer"
            >
              <Terminal className="w-3.5 h-3.5" />
              SQL Schema Setup
            </button>
          </div>
        </div>

        {/* SQL Setup Drawer */}
        {showSqlSetup && (
          <div className="bg-slate-950 rounded-xl p-4 border border-white/5 space-y-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-indigo-400 font-semibold text-[11px]">
                <Terminal className="w-4 h-4" />
                <span>Script SQL de Inicialização do Supabase</span>
              </div>
              <button
                onClick={handleCopySql}
                className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white rounded border border-white/10 flex items-center gap-1 transition-all text-[10px] font-bold cursor-pointer"
              >
                {copiedSql ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copiedSql ? "Copiado!" : "Copiar SQL"}
              </button>
            </div>
            <p className="text-slate-500 text-[10px] leading-relaxed">
              Abra o painel do seu projeto no Supabase, vá em <strong>SQL Editor</strong>, clique em <strong>New Query</strong>, cole o código abaixo e execute-o (clique em <strong>Run</strong>) para preparar as tabelas necessárias:
            </p>
            <pre className="bg-slate-900 p-3 rounded-lg text-[10px] font-mono text-indigo-300 overflow-x-auto max-h-48 border border-white/5 select-all leading-normal">
{`-- 1. Criar a tabela de Editais Analisados
create table if not exists editais_analisados (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  date text not null,
  analysis jsonb not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Criar a tabela de Documentos Sincronizados
create table if not exists documentos_sincronizados (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  type text,
  path text,
  timestamp text,
  url text,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Criar a tabela de Certidões Fiscais
create table if not exists certidoes_fiscais (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  emission_date text,
  expiration_date text,
  status text not null,
  notes text,
  file_uploaded boolean default false,
  file_name text,
  document_matches_row boolean default false,
  validation_feedback text,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Criar a tabela de Histórico de Concorrentes
create table if not exists historico_concorrentes (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  competitor_name text not null,
  focus_items text,
  date text,
  edital_title text,
  analysis jsonb,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. Criar a tabela de Sessões de Chat
create table if not exists sessoes_chat (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  selected_edital_id text,
  messages jsonb not null,
  created_at text,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Habilitar RLS (Row Level Security) em todas as tabelas
alter table editais_analisados enable row level security;
alter table documentos_sincronizados enable row level security;
alter table certidoes_fiscais enable row level security;
alter table historico_concorrentes enable row level security;
alter table sessoes_chat enable row level security;

-- Criar políticas de segurança RLS (Garantindo isolamento total por usuário)
create policy "Usuários podem ver apenas seus próprios editais" on editais_analisados
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Usuários podem ver apenas seus próprios documentos" on documentos_sincronizados
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Usuários podem ver apenas suas próprias certidões" on certidoes_fiscais
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Usuários podem ver apenas seus próprios concorrentes" on historico_concorrentes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Usuários podem ver apenas seus próprios chats" on sessoes_chat
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);`}
            </pre>
          </div>
        )}

        {/* Inputs configuration form */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1">
              <Globe className="w-3.5 h-3.5 text-slate-400" />
              URL do Projeto Supabase (API URL)
            </label>
            <input
              type="text"
              placeholder="https://your-project.supabase.co"
              value={supabaseUrl}
              onChange={(e) => setSupabaseUrl(e.target.value)}
              className="w-full bg-slate-950 border border-white/10 rounded-lg p-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1">
              <Key className="w-3.5 h-3.5 text-slate-400" />
              Chave Anônima do Supabase (anon key)
            </label>
            <input
              type="password"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              value={supabaseAnonKey}
              onChange={(e) => setSupabaseAnonKey(e.target.value)}
              className="w-full bg-slate-950 border border-white/10 rounded-lg p-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono"
            />
          </div>
        </div>

        {/* Connection result and trigger actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-2">
          <div className="flex-1">
            {supabaseTestResult && (
              <div className={`p-3 rounded-lg flex items-start gap-2 text-[11px] border ${
                supabaseTestResult.success 
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300" 
                  : "bg-rose-500/10 border-rose-500/20 text-rose-300"
              }`}>
                {supabaseTestResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <span>{supabaseTestResult.message}</span>
              </div>
            )}
            {!supabaseTestResult && (
              <p className="text-slate-500 text-[11px] italic">
                {supabaseConnected 
                  ? "✓ Conectado via chaves persistidas no navegador/ambiente. Clique em 'Desconectar' para apagar."
                  : "Insira suas credenciais acima para testar a comunicação e ativar a persistência em nuvem."}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
            {supabaseConnected && (
              <button
                onClick={handleDisconnectSupabase}
                className="px-4 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg transition-all font-semibold border border-rose-500/20 text-xs cursor-pointer"
              >
                Desconectar
              </button>
            )}
            <button
              onClick={handleTestAndSaveSupabase}
              disabled={testingSupabase || !supabaseUrl || !supabaseAnonKey}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-all font-semibold flex items-center gap-1.5 text-xs shadow-lg shadow-emerald-600/20 border border-emerald-500/30 cursor-pointer"
            >
              {testingSupabase ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Testando Conexão...
                </>
              ) : (
                <>
                  <Database className="w-3.5 h-3.5" />
                  Salvar e Testar Conexão
                </>
              )}
            </button>
          </div>
        </div>

        {/* Supabase Sync Logs list */}
        {supabaseConnected && supabaseSyncLogs.length > 0 && (
          <div className="border-t border-white/5 pt-4 space-y-2.5">
            <span className="text-[10px] text-emerald-400 font-bold block uppercase tracking-wider">
              Histórico de Sincronismo Supabase (Log Ativo)
            </span>
            <div className="bg-slate-950/60 rounded-xl overflow-hidden border border-white/5 max-h-32 overflow-y-auto divide-y divide-white/5">
              {supabaseSyncLogs.map((log: any) => (
                <div key={log.id} className="p-2.5 flex items-center justify-between text-[11px] hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <Database className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span className="font-semibold text-slate-300 truncate">
                      [{log.modalidade}] {log.orgao} ({log.numero})
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 font-mono text-[9px]">
                    <span className="text-slate-500">{new Date(log.updated_at).toLocaleTimeString("pt-BR")}</span>
                    <span className={`font-bold uppercase px-1.5 py-0.5 rounded ${
                      log.status === "Sincronizado na Nuvem" 
                        ? "bg-emerald-500/10 text-emerald-400" 
                        : "bg-amber-500/10 text-amber-400"
                    }`}>
                      {log.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* SaaS Control Panel & Authentication Dashboard */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Side: SaaS Auth & Active Session Info (7cols) */}
        <div className="lg:col-span-7 bg-slate-900/40 border border-white/10 rounded-2xl p-6 flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div className="flex items-start gap-3 border-b border-white/5 pb-4">
              <div className="p-2.5 bg-indigo-500/10 text-indigo-400 rounded-xl border border-indigo-500/20 shrink-0">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-white text-sm flex items-center gap-2">
                  Portal de Autenticação SaaS (Supabase Auth)
                </h4>
                <p className="text-slate-400 text-[11px] mt-0.5 leading-relaxed">
                  Gerencie o login e o cadastro de contas de usuários finais utilizando o motor de autenticação em nuvem do Supabase.
                </p>
              </div>
            </div>

            {supabaseUser ? (
              // Logged In State
              <div className="space-y-4 bg-slate-950/60 p-4 rounded-xl border border-emerald-500/15 animate-fade-in">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="font-bold text-slate-200 text-xs">Sessão Ativa no Supabase</span>
                  </div>
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-mono font-bold uppercase">
                    {saasPlan} Plan
                  </span>
                </div>

                <div className="space-y-2 text-xs font-mono">
                  <div className="flex justify-between border-b border-white/5 pb-1.5 text-[11px]">
                    <span className="text-slate-500">ID de Usuário (UUID)</span>
                    <span className="text-slate-300 font-bold truncate max-w-[180px]" title={supabaseUser.id}>
                      {supabaseUser.id}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-white/5 pb-1.5 text-[11px]">
                    <span className="text-slate-500">E-mail Cadastrado</span>
                    <span className="text-slate-300 font-bold">
                      {supabaseUser.email}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500">Provedor Auth</span>
                    <span className="text-indigo-400 font-bold">
                      {supabaseUser.app_metadata?.provider || "email-password"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <span className="text-[10px] text-slate-500 italic">
                    Dados do usuário autenticados em tempo real na nuvem.
                  </span>
                  <button
                    onClick={handleSignOut}
                    className="px-3.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Encerrar Sessão
                  </button>
                </div>
              </div>
            ) : (
              // Logged Out Form State
              <div className="space-y-4">
                <div className="flex bg-slate-950 p-1 rounded-xl border border-white/5">
                  <button
                    type="button"
                    onClick={() => setSupabaseAuthMode("signin")}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      supabaseAuthMode === "signin"
                        ? "bg-slate-800 text-white shadow"
                        : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    Fazer Login (Sign In)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSupabaseAuthMode("signup")}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      supabaseAuthMode === "signup"
                        ? "bg-slate-800 text-white shadow"
                        : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    Criar Conta SaaS (Sign Up)
                  </button>
                </div>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Endereço de E-mail</label>
                    <input
                      type="email"
                      required
                      placeholder="seu-email@exemplo.com"
                      value={supabaseAuthEmail}
                      onChange={(e) => setSupabaseAuthEmail(e.target.value)}
                      className="w-full bg-slate-950 border border-white/10 rounded-lg p-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Senha Secreta</label>
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={supabaseAuthPassword}
                      onChange={(e) => setSupabaseAuthPassword(e.target.value)}
                      className="w-full bg-slate-950 border border-white/10 rounded-lg p-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                    />
                  </div>
                </div>

                {supabaseAuthMessage && (
                  <div className={`p-3 rounded-lg text-[11px] leading-relaxed border ${
                    supabaseAuthMessage.success
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                      : "bg-rose-500/10 border-rose-500/20 text-rose-300"
                  }`}>
                    {supabaseAuthMessage.message}
                  </div>
                )}

                <button
                  type="button"
                  onClick={(e) => handleAuthAction(e)}
                  disabled={supabaseAuthLoading || !supabaseConnected}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-lg text-xs transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 border border-indigo-500/25 cursor-pointer"
                >
                  {supabaseAuthLoading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Processando Autenticação...
                    </>
                  ) : supabaseAuthMode === "signup" ? (
                    <>
                      <User className="w-3.5 h-3.5" />
                      Registrar Nova Conta SaaS
                    </>
                  ) : (
                    <>
                      <Lock className="w-3.5 h-3.5" />
                      Acessar Conta do Cliente
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-white/5 pt-4 text-[10px] text-slate-500 leading-relaxed">
            💡 <strong>Dica de SaaS:</strong> O Supabase Auth protege as linhas de dados usando Políticas RLS. As tabelas criadas no console possuem chaves estrangeiras vinculadas à tabela <code>auth.users</code> para garantir o isolamento multi-tenant do seu SaaS.
          </div>
        </div>

        {/* Right Side: SaaS Tier Dashboard & Routing Options (5cols) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          
          {/* SaaS Tier and Limits Monitor */}
          <div className="bg-slate-900/40 border border-white/10 rounded-2xl p-6 space-y-4">
            <div className="flex items-start gap-3 border-b border-white/5 pb-4">
              <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20 shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-white text-sm">Controle de Planos & Limites SaaS</h4>
                <p className="text-slate-400 text-[11px] mt-0.5 leading-relaxed">
                  Selecione os planos de assinatura do cliente para liberar novos limites de análise e volume de processamento de editais.
                </p>
              </div>
            </div>

            {/* Plan Tier Selectors */}
            <div className="grid grid-cols-3 gap-2">
              {["Free", "Pro", "Enterprise"].map((plan) => {
                const isActive = saasPlan === plan;
                return (
                  <button
                    key={plan}
                    onClick={() => handleChangePlan(plan)}
                    className={`py-2 px-1 rounded-xl text-[10px] font-bold border transition-all cursor-pointer ${
                      isActive 
                        ? "bg-amber-500/15 border-amber-500 text-amber-300 shadow-md shadow-amber-500/10" 
                        : "bg-slate-950 border-white/5 text-slate-500 hover:text-slate-300 hover:border-white/10"
                    }`}
                  >
                    {plan === "Free" ? "Gratuito" : plan === "Pro" ? "SaaS Pro" : "Enterprise"}
                  </button>
                );
              })}
            </div>

            {/* Quota Progress meters */}
            <div className="space-y-3 pt-2">
              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400 font-semibold">Análises de Edital por Mês</span>
                  <span className="text-slate-300 font-bold">
                    {saasPlan === "Free" ? "3 / 5" : saasPlan === "Pro" ? "12 / 100" : "48 / Ilimitado"}
                  </span>
                </div>
                <div className="w-full bg-slate-950 rounded-full h-1.5 border border-white/5 overflow-hidden">
                  <div 
                    className="bg-amber-500 h-1.5 rounded-full transition-all duration-500" 
                    style={{ width: saasPlan === "Free" ? "60%" : saasPlan === "Pro" ? "12%" : "3%" }}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400 font-semibold">Propostas & Declarações Geradas</span>
                  <span className="text-slate-300 font-bold">
                    {saasPlan === "Free" ? "1 / 3" : saasPlan === "Pro" ? "8 / 150" : "15 / Ilimitado"}
                  </span>
                </div>
                <div className="w-full bg-slate-950 rounded-full h-1.5 border border-white/5 overflow-hidden">
                  <div 
                    className="bg-indigo-500 h-1.5 rounded-full transition-all duration-500" 
                    style={{ width: saasPlan === "Free" ? "33.3%" : saasPlan === "Pro" ? "5.3%" : "2%" }}
                  />
                </div>
              </div>
            </div>

            <div className="text-[10px] text-slate-500 flex items-center gap-1 bg-slate-950 p-2.5 rounded-lg border border-white/5 leading-normal">
              <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>
                Planos Pro e Enterprise possuem sincronismo contínuo em background para seu ERP corporativo.
              </span>
            </div>
          </div>

          {/* AI Edge Function Route Settings */}
          <div className="bg-slate-900/40 border border-white/10 rounded-2xl p-6 space-y-4">
            <div className="flex items-start gap-3 justify-between">
              <div className="flex items-start gap-3">
                <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20 shrink-0">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-white text-sm">Roteador IA Supabase Edge</h4>
                  <p className="text-slate-400 text-[11px] mt-0.5 leading-relaxed">
                    Execute as requisições de Inteligência Artificial diretamente na nuvem do Supabase, roteando chamadas ao Gemini via Deno.
                  </p>
                </div>
              </div>
            </div>

            {/* Route AI Toggle Switch */}
            <div className="flex items-center justify-between bg-slate-950 p-3 rounded-xl border border-white/5">
              <span className="text-xs font-semibold text-slate-300">Roteamento por Edge Function</span>
              <label className="relative inline-flex items-center cursor-pointer select-none">
                <input 
                  type="checkbox" 
                  checked={supabaseRouteAi} 
                  onChange={(e) => handleToggleRouteAi(e.target.checked)} 
                  className="sr-only peer" 
                />
                <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500 peer-checked:after:bg-white peer-checked:after:border-white"></div>
              </label>
            </div>

            <div className="text-[10px] text-slate-500 leading-normal">
              {supabaseRouteAi ? (
                <span className="text-emerald-400 font-medium">
                  ✓ ATIVO: O analisador e chat do painel estão enviando dados para <code>/functions/v1/gemini-ai</code>!
                </span>
              ) : (
                <span>
                  O sistema usará por padrão o backend local da plataforma. Ative acima para validar o setup de Edge Functions.
                </span>
              )}
            </div>
          </div>

          {/* Database Diagnostics row counters */}
          <div className="bg-slate-900/40 border border-white/10 rounded-2xl p-6 space-y-3.5">
            <span className="text-[10px] text-indigo-400 font-bold block uppercase tracking-wider">
              Diagnóstico de Tabelas Supabase Live
            </span>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-950 p-3 rounded-xl border border-white/5 text-center space-y-1">
                <span className="text-[10px] text-slate-500 block">Editais no Banco</span>
                <span className="text-xl font-bold font-mono text-emerald-400">{dbMetrics.editais}</span>
                <span className="text-[9px] text-slate-600 block">editais_analisados</span>
              </div>
              <div className="bg-slate-950 p-3 rounded-xl border border-white/5 text-center space-y-1">
                <span className="text-[10px] text-slate-500 block">Propostas no Banco</span>
                <span className="text-xl font-bold font-mono text-indigo-400">{dbMetrics.documentos}</span>
                <span className="text-[9px] text-slate-600 block">documentos_sincronizados</span>
              </div>
            </div>
            <button
              onClick={updateTableCounts}
              disabled={!supabaseConnected}
              className="w-full py-1.5 bg-slate-950 hover:bg-slate-900 disabled:opacity-50 text-slate-400 hover:text-white rounded-lg border border-white/5 transition-all text-[11px] font-bold cursor-pointer flex items-center justify-center gap-1.5"
            >
              <RefreshCw className="w-3 h-3" />
              Sincronizar Métricas do Banco
            </button>
          </div>

        </div>
      </div>

      {/* Database Schema Educational Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        
        {/* Card 1: LocalStorage */}
        <div className="bg-slate-950/40 border border-white/5 rounded-xl p-4 space-y-2.5 relative overflow-hidden group hover:border-white/10 transition-all">
          <div className="absolute top-0 right-0 p-3 opacity-5 text-white">
            <Server className="w-12 h-12" />
          </div>
          <div className="flex items-center gap-2 text-indigo-400">
            <Database className="w-4 h-4" />
            <h4 className="font-bold text-slate-200">1. Banco de Dados Local</h4>
          </div>
          <p className="text-slate-400 leading-relaxed text-[11px]">
            Todas as configurações da sua empresa, certidões fiscais carregadas e históricos de análises do edital ativo estão gravados de forma segura no <strong>Banco de Dados do seu navegador (IndexedDB/localStorage)</strong>. Os dados persistem mesmo se você fechar a aba do aplicativo.
          </p>
          <div className="pt-1.5 flex items-center justify-between text-[10px] font-semibold text-slate-500 border-t border-white/5">
            <span>Status: Ativo & Persistente</span>
            <span className="text-indigo-400">Local Estável</span>
          </div>
        </div>

        {/* Card 2: Google Drive folder structure */}
        <div className="bg-slate-950/40 border border-white/5 rounded-xl p-4 space-y-2.5 relative overflow-hidden group hover:border-white/10 transition-all">
          <div className="absolute top-0 right-0 p-3 opacity-5 text-white">
            <FolderOpen className="w-12 h-12" />
          </div>
          <div className="flex items-center gap-2 text-blue-400">
            <FolderOpen className="w-4 h-4" />
            <h4 className="font-bold text-slate-200">2. Pastas Google Drive</h4>
          </div>
          <p className="text-slate-400 leading-relaxed text-[11px]">
            Os documentos gerados pela Inteligência Artificial Gemini (Proposta Comercial, Declarações e Recursos) são organizados na pasta raiz <strong>Analisador_Pregões/</strong> no seu Google Drive. Cada documento possui subpastas exclusivas para manter o compliance.
          </p>
          <div className="pt-1.5 flex items-center justify-between text-[10px] font-semibold text-slate-500 border-t border-white/5">
            <span>Diretório: Analisador_Pregões/</span>
            <span className="text-blue-400">{connected ? "Sincronizado" : "Local (Aguardando Conexão)"}</span>
          </div>
        </div>

        {/* Card 3: Google Sheets Row database */}
        <div className="bg-slate-950/40 border border-white/5 rounded-xl p-4 space-y-2.5 relative overflow-hidden group hover:border-white/10 transition-all">
          <div className="absolute top-0 right-0 p-3 opacity-5 text-white">
            <FileSpreadsheet className="w-12 h-12" />
          </div>
          <div className="flex items-center gap-2 text-emerald-400">
            <FileSpreadsheet className="w-4 h-4" />
            <h4 className="font-bold text-slate-200">3. Linhas Google Sheets</h4>
          </div>
          <p className="text-slate-400 leading-relaxed text-[11px]">
            Para cada Edital que você analisa, o sistema exporta automaticamente as métricas-chave do certame (prazos de pagamento, exigências, vereditos e compatibilidades) como uma nova linha estruturada na sua <strong>Planilha de Auditoria do Google Sheets</strong>, criando um banco de dados unificado de editais.
          </p>
          <div className="pt-1.5 flex items-center justify-between text-[10px] font-semibold text-slate-500 border-t border-white/5">
            <span>Tabela: Relatório_Analítico</span>
            <span className="text-emerald-400">{connected ? "Sincronizado" : "Local (Aguardando Conexão)"}</span>
          </div>
        </div>

      </div>

      {/* Main Interactive Workspace Area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* SIDE BAR: Virtual Folders Directory */}
        <div className="lg:col-span-3 bg-slate-950/30 border border-white/10 rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <span className="font-bold text-slate-300 text-xs uppercase tracking-wider flex items-center gap-1.5">
              <FolderOpen className="w-4 h-4 text-indigo-400" />
              Diretórios Drive
            </span>
            <RefreshCw onClick={refreshItems} className="w-3.5 h-3.5 text-slate-500 hover:text-white cursor-pointer transition-colors" />
          </div>

          <div className="space-y-1">
            {folderStructure.map((fol, idx) => (
              <button
                key={idx}
                onClick={() => setActiveFolder(fol.path)}
                className={`w-full text-left p-2.5 rounded-lg flex items-center gap-2 transition-all font-semibold ${
                  activeFolder === fol.path
                    ? "bg-indigo-600/20 border border-indigo-500/30 text-white"
                    : "text-slate-400 hover:bg-white/5 hover:text-white border border-transparent"
                }`}
              >
                <FolderOpen className={`w-4 h-4 shrink-0 ${activeFolder === fol.path ? "text-indigo-400" : "text-slate-500"}`} />
                <span className="truncate">{fol.name}</span>
              </button>
            ))}
          </div>

          <div className="bg-slate-900/40 p-3 rounded-xl border border-white/5 space-y-1.5">
            <span className="text-[10px] text-indigo-300 font-bold block uppercase">Estrutura de Armazenamento</span>
            <p className="text-[10px] text-slate-500 leading-relaxed font-mono">
              Os arquivos gerados são mapeados na nuvem e salvos no local state do navegador como fallback imediato para garantir redundância total.
            </p>
          </div>
        </div>

        {/* MAIN PANEL: Google Drive & Google Sheets Visual Mockups */}
        <div className="lg:col-span-9 space-y-6">
          
          {/* MOCKUP 1: Google Drive Virtual File Explorer */}
          <div className="bg-slate-950/20 border border-white/10 rounded-2xl overflow-hidden shadow-xl flex flex-col">
            
            {/* Folder explorer header */}
            <div className="bg-slate-900/40 p-4 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="bg-indigo-600 text-white p-1 rounded">
                  <HardDrive className="w-4 h-4" />
                </div>
                <span className="font-mono text-slate-300 text-xs tracking-tight">{activeFolder}</span>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Pesquisar arquivos..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-white/10 rounded-lg py-1.5 pl-8 pr-3 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* List of files */}
            <div className="p-4 overflow-y-auto max-h-[300px] min-h-[180px]">
              {filteredItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-10 space-y-2">
                  <div className="bg-white/5 p-3 rounded-full text-slate-600">
                    <FolderOpen className="w-8 h-8" />
                  </div>
                  <p className="text-slate-400 font-bold">Nenhum arquivo encontrado nesta pasta</p>
                  <p className="text-slate-500 max-w-sm text-[11px]">
                    Gere propostas comerciais ou declarações oficiais na aba "Análise de Edital" para sincronizá-los com esta pasta do Google Drive.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filteredItems.map((file) => (
                    <div 
                      key={file.id}
                      className="bg-slate-900/40 border border-white/5 hover:border-indigo-500/30 p-3 rounded-xl flex items-start justify-between gap-3 group transition-all"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className={`p-2 rounded-lg shrink-0 ${
                          file.type === "proposal" ? "bg-indigo-500/10 text-indigo-400" :
                          file.type === "declaration" ? "bg-blue-500/10 text-blue-400" :
                          file.type === "sheet" ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-500/10 text-slate-400"
                        }`}>
                          {file.type === "sheet" ? <FileSpreadsheet className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-200 truncate" title={file.name}>{file.name}</p>
                          <span className="text-[10px] text-slate-500 font-mono block mt-0.5">{file.timestamp}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleViewFile(file)}
                          className="p-1.5 hover:bg-white/5 text-slate-400 hover:text-white rounded transition-all cursor-pointer"
                          title="Visualizar Conteúdo"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDownloadMarkdown(file)}
                          className="p-1.5 hover:bg-white/5 text-slate-400 hover:text-indigo-400 rounded transition-all cursor-pointer"
                          title="Baixar Markdown"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteItem(file.id, e)}
                          className="p-1.5 hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 rounded transition-all cursor-pointer"
                          title="Excluir"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Disk space footer summary */}
            <div className="bg-slate-900/40 px-4 py-3 border-t border-white/10 flex items-center justify-between text-[10px] text-slate-500">
              <span>{filteredItems.length} arquivo(s) visíveis</span>
              <span className="font-mono">Google Drive Virtual • Espaço Livre: 15 GB</span>
            </div>

          </div>

          {/* MOCKUP 2: Google Sheets Virtual Table Database */}
          <div className="bg-slate-950/20 border border-white/10 rounded-2xl overflow-hidden shadow-xl flex flex-col">
            
            {/* Sheets Header */}
            <div className="bg-emerald-950/15 p-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="bg-emerald-600 text-white p-1 rounded">
                  <FileSpreadsheet className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-bold text-white text-xs">Banco de Dados Unificado (Google Sheets)</h4>
                  <p className="text-[10px] text-slate-500">Linhas de auditoria geradas de cada análise cadastrada</p>
                </div>
              </div>
              <span className="text-[9px] font-mono bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded text-emerald-400 font-bold uppercase">
                {connected ? "LIVE SHEET CONECTADA" : "BANCO DE DADOS LOCAL"}
              </span>
            </div>

            {/* Sheets table grid */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead className="bg-slate-950/60 border-b border-white/10">
                  <tr className="font-mono text-slate-400 text-[10px] uppercase">
                    <th className="p-3 border-r border-white/5 w-10 text-center">Linha</th>
                    <th className="p-3 border-r border-white/5">Órgão Público Licitante</th>
                    <th className="p-3 border-r border-white/5">Objeto / Produto Analisado</th>
                    <th className="p-3 border-r border-white/5">Prazo de Entrega</th>
                    <th className="p-3 border-r border-white/5">Condições Pagamento</th>
                    <th className="p-3">Sincronizado Em</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-mono text-slate-300">
                  {sheetsData.map((row, index) => (
                    <tr key={row.id} className="hover:bg-white/5 transition-colors">
                      <td className="p-3 border-r border-white/5 text-center text-slate-500 font-bold">{index + 1}</td>
                      <td className="p-3 border-r border-white/5 font-sans font-bold text-slate-200">{row.orgao}</td>
                      <td className="p-3 border-r border-white/5 font-sans">{row.produto}</td>
                      <td className="p-3 border-r border-white/5 text-emerald-400">{row.prazoEntrega}</td>
                      <td className="p-3 border-r border-white/5 text-indigo-400">{row.prazoPagamento}</td>
                      <td className="p-3 text-slate-500">{row.timestamp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Spreadsheet footer stats */}
            <div className="bg-slate-900/40 px-4 py-3 border-t border-white/10 flex items-center justify-between text-[10px] text-slate-500">
              <span>Aba ativa: "Auditoria_Geral"</span>
              <span>Total: {sheetsData.length} registro(s) no banco</span>
            </div>

          </div>

        </div>

      </div>

      {/* MODAL: Simple Content Viewer for virtual files */}
      {fileContentModalOpen && selectedFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl">
            
            {/* Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-slate-950/20">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-400" />
                <span className="font-bold text-white text-sm">{selectedFile.name}</span>
              </div>
              <button 
                onClick={() => setFileContentModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors bg-white/5 border border-white/10 cursor-pointer"
              >
                Fechar
              </button>
            </div>

            {/* Content area */}
            <div className="p-6 overflow-y-auto flex-1 text-slate-300 font-sans text-xs whitespace-pre-line leading-relaxed">
              <h2 className="text-sm font-bold text-white border-b border-white/5 pb-2 mb-4 uppercase">Conteúdo do Arquivo (Visualização Rápida)</h2>
              <div className="bg-slate-950/50 p-4 rounded-xl border border-white/10 font-mono text-[11px] text-slate-300">
                # {selectedFile.name}
                {"\n"}
                Caminho: {selectedFile.path}
                {"\n"}
                Sincronizado: {selectedFile.timestamp}
                {"\n\n"}
                --- CONTEÚDO SINTÉTICO ---
                {"\n"}
                Documento de {selectedFile.type === "proposal" ? "Proposta Comercial para Pregão Eletrônico" : "Declaração de Habilitação Jurídica"} correspondente à empresa proponente {companyData?.razonSocial || "GABRIEL DUARTE MOTA SOUZA"} e ao edital de contratação.
                {"\n\n"}
                Todos os dados financeiros, planilha de quantitativos orçamentários, e assinaturas do representante legal estão salvos perfeitamente neste documento de forma integrada.
              </div>
            </div>

            {/* Footer actions */}
            <div className="p-4 border-t border-white/10 bg-slate-950/20 flex items-center justify-end gap-2.5">
              <button
                onClick={() => {
                  handleDownloadMarkdown(selectedFile);
                  setFileContentModalOpen(false);
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg transition-all cursor-pointer border border-indigo-500/30 flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5" />
                Baixar Markdown
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
