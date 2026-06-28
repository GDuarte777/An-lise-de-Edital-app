import { useState, useEffect } from "react";
import { 
  Lock, Mail, Database, Globe, Key, RefreshCw, AlertCircle, 
  CheckCircle2, Sparkles, ShieldCheck, ArrowRight, Eye, EyeOff
} from "lucide-react";
import { 
  getSupabaseConfig, 
  saveSupabaseConfig, 
  testSupabaseConnection, 
  signInWithSupabase, 
  signUpWithSupabase 
} from "../utils/supabaseClient";

interface SupabaseLoginScreenProps {
  onLoginSuccess: (user: any) => void;
}

export default function SupabaseLoginScreen({ onLoginSuccess }: SupabaseLoginScreenProps) {
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState<{ success: boolean; message: string } | null>(null);

  // Connection settings
  const [showConfig, setShowConfig] = useState(false);
  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [supabaseAnonKey, setSupabaseAnonKey] = useState("");
  const [configSaved, setConfigSaved] = useState(false);
  const [testingConfig, setTestingConfig] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    const config = getSupabaseConfig();
    setSupabaseUrl(config.url);
    setSupabaseAnonKey(config.anonKey);
    if (config.url && config.anonKey) {
      setConfigSaved(true);
    }
  }, []);

  const handleTestAndSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setTestingConfig(true);
    setTestResult(null);
    try {
      const res = await testSupabaseConnection(supabaseUrl, supabaseAnonKey);
      setTestResult(res);
      if (res.success) {
        saveSupabaseConfig(supabaseUrl, supabaseAnonKey);
        setConfigSaved(true);
        setTimeout(() => setShowConfig(false), 1500);
      } else {
        setConfigSaved(false);
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || "Erro de conexão." });
      setConfigSaved(false);
    } finally {
      setTestingConfig(false);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configSaved) {
      setAuthMessage({ 
        success: false, 
        message: "Por favor, configure as chaves do Supabase primeiro na seção abaixo." 
      });
      setShowConfig(true);
      return;
    }

    setLoading(true);
    setAuthMessage(null);

    try {
      if (authMode === "signup") {
        const res = await signUpWithSupabase(email, password);
        setAuthMessage(res);
        if (res.success && res.user) {
          // If signed up successfully
          if (res.message.includes("verifique")) {
            // Needs verification, but let them in or wait
          } else {
            onLoginSuccess(res.user);
          }
        }
      } else {
        const res = await signInWithSupabase(email, password);
        if (res.success && res.session?.user) {
          setAuthMessage({ success: true, message: "Acesso concedido! Redirecionando..." });
          setTimeout(() => {
            onLoginSuccess(res.session.user);
          }, 800);
        } else {
          setAuthMessage({ success: false, message: res.message || "Erro desconhecido." });
        }
      }
    } catch (err: any) {
      setAuthMessage({ success: false, message: err.message || "Falha técnica na autenticação." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070b13] flex flex-col justify-center items-center p-4 relative overflow-hidden font-sans select-none text-xs text-slate-300">
      
      {/* Background radial glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[250px] h-[250px] bg-emerald-500/5 rounded-full blur-[80px] pointer-events-none" />

      <div className="w-full max-w-md space-y-6 relative z-10">
        
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 bg-indigo-600/10 text-indigo-400 rounded-2xl border border-indigo-500/20 shadow-xl shadow-indigo-600/5">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-xl font-black text-white tracking-tight uppercase">Portal de Licitações</h1>
            <p className="text-xs text-slate-400 font-medium">Assessor Inteligente Multi-Tenant Supabase</p>
          </div>
        </div>

        {/* Auth card */}
        <div className="bg-[#0f1524]/80 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-2xl relative">
          
          <div className="flex bg-slate-950 p-1 rounded-xl border border-white/5 mb-5">
            <button
              onClick={() => {
                setAuthMode("signin");
                setAuthMessage(null);
              }}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                authMode === "signin"
                  ? "bg-slate-800 text-white shadow"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              Entrar na Conta
            </button>
            <button
              onClick={() => {
                setAuthMode("signup");
                setAuthMessage(null);
              }}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                authMode === "signup"
                  ? "bg-slate-800 text-white shadow"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              Cadastrar-se
            </button>
          </div>

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block flex items-center gap-1">
                <Mail className="w-3.5 h-3.5 text-slate-500" />
                E-mail Corporativo
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@empresa.com.br"
                className="w-full bg-slate-950 border border-white/10 rounded-xl p-3 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium transition-all"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5 text-slate-500" />
                  Senha de Acesso
                </span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Sua senha secreta"
                  className="w-full bg-slate-950 border border-white/10 rounded-xl p-3 pr-10 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5 transition-colors cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {authMessage && (
              <div className={`p-3 rounded-xl text-[11px] leading-relaxed border ${
                authMessage.success
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                  : "bg-rose-500/10 border-rose-500/20 text-rose-300"
              }`}>
                {authMessage.message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 border border-indigo-500/25 cursor-pointer hover:-translate-y-0.5 active:translate-y-0"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Autenticando...
                </>
              ) : authMode === "signin" ? (
                <>
                  Entrar na Plataforma
                  <ArrowRight className="w-4 h-4" />
                </>
              ) : (
                <>
                  Criar Minha Conta
                  <Sparkles className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Setup Supabase drawer toggler */}
          <div className="border-t border-white/5 mt-5 pt-4 text-center">
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="text-[10px] text-slate-400 hover:text-indigo-400 font-bold tracking-tight inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Database className="w-3.5 h-3.5" />
              {configSaved ? "✓ Conexão Supabase Configurada" : "⚠ Configurar Chaves do Supabase"}
              <span className="text-[8px] px-1 bg-white/5 rounded text-slate-500 font-mono">
                {showConfig ? "Esconder" : "Editar"}
              </span>
            </button>
          </div>

          {/* Setup inputs inside card */}
          {showConfig && (
            <form onSubmit={handleTestAndSaveConfig} className="mt-4 p-4 bg-slate-950/80 rounded-xl border border-white/5 space-y-3 animate-fade-in text-[11px]">
              <div className="flex items-center justify-between border-b border-white/5 pb-2">
                <span className="font-bold text-white flex items-center gap-1">
                  <Database className="w-3.5 h-3.5 text-indigo-400" />
                  Parâmetros de Banco SaaS
                </span>
                <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold ${configSaved ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>
                  {configSaved ? "Pronto" : "Pendente"}
                </span>
              </div>

              <div className="space-y-1">
                <span className="font-medium text-slate-400">URL do Supabase (Project URL)</span>
                <input
                  type="text"
                  required
                  value={supabaseUrl}
                  onChange={(e) => setSupabaseUrl(e.target.value)}
                  placeholder="https://sua-instancia.supabase.co"
                  className="w-full bg-slate-900 border border-white/5 rounded-lg p-2 text-[11px] text-white placeholder:text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                />
              </div>

              <div className="space-y-1">
                <span className="font-medium text-slate-400">Chave de API Pública (Anon Key)</span>
                <input
                  type="password"
                  required
                  value={supabaseAnonKey}
                  onChange={(e) => setSupabaseAnonKey(e.target.value)}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI..."
                  className="w-full bg-slate-900 border border-white/5 rounded-lg p-2 text-[11px] text-white placeholder:text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                />
              </div>

              {testResult && (
                <div className={`p-2 rounded text-[10px] border leading-normal ${testResult.success ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-rose-500/10 border-rose-500/20 text-rose-400"}`}>
                  {testResult.message}
                </div>
              )}

              <button
                type="submit"
                disabled={testingConfig || !supabaseUrl || !supabaseAnonKey}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                {testingConfig ? (
                  <>
                    <RefreshCw className="w-3 animate-spin" />
                    Testando comunicação...
                  </>
                ) : (
                  <>
                    <Globe className="w-3.5 h-3.5" />
                    Testar e Salvar Configuração
                  </>
                )}
              </button>
            </form>
          )}

        </div>

        <p className="text-center text-[10px] text-slate-500 max-w-xs mx-auto leading-relaxed">
          🔒 <strong>Isolamento Multi-tenant:</strong> Suas ações, análises, certidões fiscais e logs de chat serão salvos de forma privada no Supabase usando políticas RLS seguras.
        </p>

      </div>
    </div>
  );
}
