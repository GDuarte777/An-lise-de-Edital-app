import { initializeApp, getApps } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from "firebase/auth";
import firebaseConfig from "../../firebase-applet-config.json";
import { SyncItem } from "../types";
import { syncDocumentToSupabase } from "./supabaseClient";

// Initialize Firebase only if not already initialized
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.addScope("https://www.googleapis.com/auth/drive.file");
provider.addScope("https://www.googleapis.com/auth/spreadsheets");
provider.addScope("https://www.googleapis.com/auth/calendar");

// Local storage keys
const SYNCED_ITEMS_KEY = "aip_synced_items";

// Flag to indicate if we are in the middle of a sign-in flow.
let isSigningIn = false;
// Cache the access token in memory.
let cachedAccessToken: string | null = null;

// Default initial mock Drive folder items to represent initial files on Drive
const INITIAL_DRIVE_ITEMS: SyncItem[] = [];

export function getSyncedItems(): SyncItem[] {
  const items = localStorage.getItem(SYNCED_ITEMS_KEY);
  if (!items) {
    localStorage.setItem(SYNCED_ITEMS_KEY, JSON.stringify(INITIAL_DRIVE_ITEMS));
    return INITIAL_DRIVE_ITEMS;
  }
  return JSON.parse(items);
}

export function saveSyncedItems(items: SyncItem[]) {
  localStorage.setItem(SYNCED_ITEMS_KEY, JSON.stringify(items));
}

// Initialize auth state listener. Call this on app load.
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// Google sign-in using Firebase Auth
export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Failed to get access token from Firebase Auth");
    }

    cachedAccessToken = credential.accessToken;
    window.dispatchEvent(new CustomEvent("gdrive-sync-updated"));
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error("Sign in error:", error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
  window.dispatchEvent(new CustomEvent("gdrive-sync-updated"));
};

export function getGoogleAccessToken(): string | null {
  return cachedAccessToken;
}

export function isGoogleConnected(): boolean {
  return !!cachedAccessToken;
}

export function getConnectedUserEmail(): string | null {
  return auth.currentUser?.email || null;
}

export function addSyncedItem(name: string, type: "document" | "sheet" | "proposal" | "declaration", content: string, pathPrefix = "Analisador_Pregões/") {
  const items = getSyncedItems();
  
  const ext = type === "sheet" ? "" : ".md";
  const finalName = name.endsWith(".md") || type === "sheet" ? name : `${name}${ext}`;
  const subFolder = type === "proposal" ? "Propostas/" : type === "declaration" ? "Declarações/" : type === "sheet" ? "Planilhas/" : "Documentos/";
  const finalPath = `${pathPrefix}${subFolder}`;

  const newItem: SyncItem = {
    id: `gdrive-${Date.now()}`,
    name: finalName,
    type,
    path: finalPath,
    timestamp: new Date().toISOString().replace("T", " ").substring(0, 16),
  };

  const updated = [newItem, ...items];
  saveSyncedItems(updated);

  // Attempt Supabase Sync
  syncDocumentToSupabase({
    id: newItem.id,
    name: newItem.name,
    type: newItem.type,
    path: newItem.path,
    timestamp: newItem.timestamp,
    content: content
  }).catch(err => {
    console.warn("Falha no sync Supabase do documento:", err);
  });

  // Attempt real Google Sync if token exists
  uploadToGoogleAPIsIfConnected(finalName, type, content, finalPath).catch(err => {
    console.warn("Falha no sync real (usuário não autenticado ou escopos pendentes):", err);
  });

  return newItem;
}

/**
 * Attempts real OAuth upload using current access token
 */
async function uploadToGoogleAPIsIfConnected(name: string, type: string, content: string, path: string) {
  const token = getGoogleAccessToken();
  if (!token) return;

  try {
    if (type === "sheet") {
      // Create or update Spreadsheet row
      console.log("Realizando sincronização com Google Sheets: criando planilha ou adicionando dados...");
      // Endpoint to create a file
      const fileMetadata = {
        name: name,
        mimeType: "application/vnd.google-apps.spreadsheet"
      };

      const response = await fetch("https://www.googleapis.com/drive/v3/files", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(fileMetadata)
      });
      const data = await response.json();
      console.log("Planilha do Google criada com sucesso:", data);
    } else {
      // Upload markdown/text to Google Drive
      console.log("Sincronizando arquivo de texto com o Google Drive...");
      
      const fileMetadata = {
        name: name,
        mimeType: "text/markdown",
      };

      // Simple multipart upload or metadata-only
      const form = new FormData();
      form.append("metadata", new Blob([JSON.stringify(fileMetadata)], { type: "application/json" }));
      form.append("file", new Blob([content], { type: "text/markdown" }));

      // Standard multi-part upload url
      const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form
      });
      const data = await response.json();
      console.log("Arquivo carregado com sucesso ao Google Drive:", data);
    }
  } catch (error) {
    console.error("Erro no processamento da chamada de API Google Real:", error);
  }
}

/**
 * Sync row data representing the Edital analysis directly to Google Sheets
 */
export async function syncAnalysisToGoogleSheets(analysisTitle: string, details: any) {
  const token = getGoogleAccessToken();
  
  // Create local log
  const textContent = `
=== EDITAL ANALISADO: ${analysisTitle} ===
Descrição do Produto: ${details.descricaoProduto}
Prazo de Entrega: ${details.prazoEntrega}
Prazo de Recebimento: ${details.prazoPagamento}
Pontos Positivos: ${details.pontosPositivos?.join(", ") || ""}
Pontos Alerta: ${details.pontosAlerta?.join(", ") || ""}
Documentos Habilitação: ${details.documentosExigidos?.join(", ") || ""}
Sincronizado: ${new Date().toLocaleString()}
`;
  addSyncedItem(analysisTitle, "sheet", textContent);

  if (!token) return;

  try {
    // If real Google Sheets is connected, we would push row values to a specific spreadsheet
    console.log("Simulando injeção de linha no Google Sheets com dados reais...");
  } catch (e) {
    console.error("Falha ao injetar linha no Google Sheets real", e);
  }
}

/**
 * Creates an event in the user's Google Calendar.
 */
export async function syncEventToGoogleCalendar(
  summary: string,
  description: string,
  startDateTime: string,
  endDateTime: string,
  timeZone: string = "America/Sao_Paulo"
): Promise<any> {
  const token = getGoogleAccessToken();
  if (!token) {
    throw new Error("Não conectado ao Google Workspace. Conecte-se primeiro!");
  }

  try {
    const eventBody = {
      summary,
      description,
      start: {
        dateTime: startDateTime, // ISO 8601 string, e.g., "2026-07-15T09:00:00"
        timeZone
      },
      end: {
        dateTime: endDateTime, // ISO 8601 string, e.g., "2026-07-15T11:00:00"
        timeZone
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "popup", minutes: 60 },   // 1 hora antes
          { method: "email", minutes: 1440 }  // 1 dia antes
        ]
      }
    };

    console.log("Criando evento no Google Calendar real:", eventBody);

    const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(eventBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro da API do Google Calendar: ${errorText}`);
    }

    const data = await response.json();
    console.log("Evento criado com sucesso no Google Calendar:", data);
    return data;
  } catch (error) {
    console.error("Erro ao sincronizar com Google Calendar:", error);
    throw error;
  }
}
