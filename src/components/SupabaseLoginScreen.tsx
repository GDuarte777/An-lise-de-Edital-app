import { useState, useEffect } from "react";
import {
  Lock, Mail, Sparkles, ShieldCheck, ArrowRight, Eye, EyeOff,
  User, Phone, RefreshCw
} from "lucide-react";
import {
  getSupabaseConfig,
  signInWithSupabase,
  signUpWithSupabase
} from "../utils/supabaseClient";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Card,
  CardContent,
  CardHeader,
} from "./ui/card";

interface SupabaseLoginScreenProps {
  onLoginSuccess: (user: any) => void;
}

export default function SupabaseLoginScreen({ onLoginSuccess }: SupabaseLoginScreenProps) {
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState<{ success: boolean; message: string } | null>(null);

  // Connection settings
  const [configSaved, setConfigSaved] = useState(false);

  useEffect(() => {
    const config = getSupabaseConfig();
    if (config.url && config.anonKey) {
      setConfigSaved(true);
    }
  }, []);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configSaved) {
      setAuthMessage({
        success: false,
        message: "O Supabase não está configurado corretamente."
      });
      return;
    }

    if (authMode === "signup") {
      if (!fullName.trim()) {
        setAuthMessage({ success: false, message: "Por favor, insira o seu nome." });
        return;
      }
      if (!phone.trim()) {
        setAuthMessage({ success: false, message: "Por favor, insira o seu telefone." });
        return;
      }
      if (password !== confirmPassword) {
        setAuthMessage({ success: false, message: "As senhas digitadas não coincidem." });
        return;
      }
    }

    setLoading(true);
    setAuthMessage(null);

    try {
      if (authMode === "signup") {
        const res = await signUpWithSupabase(email, password, fullName, phone);
        setAuthMessage(res);
        if (res.success && res.user) {
          // If signed up successfully
          if (res.message.includes("verifique")) {
            // Needs verification, let them know
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
    <div className="min-h-screen bg-background flex flex-col justify-center items-center p-4 relative overflow-hidden font-sans select-none text-foreground">

      {/* Background radial glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[250px] h-[250px] bg-success/5 rounded-full blur-[80px] pointer-events-none" />

      <div className="w-full max-w-md space-y-6 relative z-10">

        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 bg-primary text-primary-foreground rounded-2xl shadow-lg">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight uppercase font-mono">HORASIS</h1>
            <p className="text-xs text-muted-foreground font-medium mt-0.5">Plataforma Inteligente de Licitações Públicas</p>
          </div>
        </div>

        {/* Auth card */}
        <Card className="p-6 shadow-2xl">
          <CardHeader className="p-0 mb-1">
            <div className="flex bg-muted p-1 rounded-lg border">
              <button
                type="button"
                onClick={() => {
                  setAuthMode("signin");
                  setAuthMessage(null);
                }}
                className={`flex-1 py-2 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  authMode === "signin"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Entrar na Conta
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode("signup");
                  setAuthMessage(null);
                }}
                className={`flex-1 py-2 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  authMode === "signup"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Cadastrar-se
              </button>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <form onSubmit={handleAuthSubmit} className="space-y-4">

              {/* Conditional fields only for SignUp */}
              {authMode === "signup" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="login-name" className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                      <User className="w-3.5 h-3.5" />
                      Nome do Usuário
                    </Label>
                    <Input
                      id="login-name"
                      type="text"
                      required={authMode === "signup"}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Seu nome completo"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="login-phone" className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                      <Phone className="w-3.5 h-3.5" />
                      Telefone
                    </Label>
                    <Input
                      id="login-phone"
                      type="tel"
                      required={authMode === "signup"}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="(11) 99999-9999"
                    />
                  </div>
                </>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="login-email" className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Mail className="w-3.5 h-3.5" />
                  E-mail Corporativo
                </Label>
                <Input
                  id="login-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nome@empresa.com.br"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="login-password" className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5" />
                  Senha de Acesso
                </Label>
                <div className="relative">
                  <Input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Sua senha secreta"
                    className="pr-10 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 transition-colors cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password field only for SignUp */}
              {authMode === "signup" && (
                <div className="space-y-1.5">
                  <Label htmlFor="login-password-confirm" className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Lock className="w-3.5 h-3.5" />
                    Confirmar Senha
                  </Label>
                  <div className="relative">
                    <Input
                      id="login-password-confirm"
                      type={showConfirmPassword ? "text" : "password"}
                      required={authMode === "signup"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repita sua senha"
                      className="pr-10 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 transition-colors cursor-pointer"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              {authMessage && (
                <div className={`p-3 rounded-lg text-xs leading-relaxed border ${
                  authMessage.success
                    ? "bg-success/10 border-success/30 text-success"
                    : "bg-destructive/10 border-destructive/30 text-destructive"
                }`}>
                  {authMessage.message}
                </div>
              )}

              <Button type="submit" disabled={loading} className="w-full cursor-pointer">
                {loading ? (
                  <>
                    <RefreshCw className="animate-spin" />
                    Autenticando...
                  </>
                ) : authMode === "signin" ? (
                  <>
                    Entrar na Plataforma
                    <ArrowRight />
                  </>
                ) : (
                  <>
                    Criar Minha Conta
                    <Sparkles />
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
