import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup,
  signInWithRedirect, getRedirectResult, signOut
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, writeBatch, getDocs
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAzrOqmOxFsTHx2ygSJZ-Z94iW3NG3AwLI",
  authDomain: "mis-notas-matu.firebaseapp.com",
  projectId: "mis-notas-matu",
  storageBucket: "mis-notas-matu.firebasestorage.app",
  messagingSenderId: "398291296164",
  appId: "1:398291296164:web:12b43f91df982a24c4eb31"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
});
const provider = new GoogleAuthProvider();
provider.setCustomParameters({prompt: "select_account"});

const LOCAL_KEY = "mis_notas_estudio_v1";
let notes = [];
let currentUser = null;
let unsubscribeNotes = null;
let reviewNotes = [];
let reviewIndex = 0;
let loading = true;

const $ = id => document.getElementById(id);
const form = $("noteForm");
const list = $("notesList");
const template = $("noteTemplate");

function notesCollection() {
  if (!currentUser) throw new Error("No hay una sesión activa.");
  return collection(db, "usuarios", currentUser.uid, "notas");
}
function noteReference(id) {
  return doc(db, "usuarios", currentUser.uid, "notas", id);
}
function setSync(text, state="") {
  const badge = $("syncBadge");
  badge.textContent = text;
  badge.className = `sync-badge ${state}`.trim();
}
function friendlyError(error) {
  console.error(error);
  const code = error?.code || "";
  if (code.includes("unauthorized-domain")) return "El dominio de Vercel todavía no está autorizado en Firebase.";
  if (code.includes("popup-blocked")) return "El navegador bloqueó la ventana de acceso. Inténtelo otra vez.";
  if (code.includes("popup-closed")) return "Se cerró la ventana antes de completar el acceso.";
  if (code.includes("permission-denied")) return "Las reglas de Firestore no permiten esta operación. Revise las reglas.";
  if (!navigator.onLine) return "No hay conexión a Internet. El cambio se sincronizará al volver la conexión.";
  return "Ocurrió un error. Revise la configuración de Firebase e inténtelo nuevamente.";
}
async function login() {
  $("authError").classList.add("hidden");
  try {
    setSync("Iniciando sesión", "syncing");
    await signInWithPopup(auth, provider);
  } catch (error) {
    if (error?.code === "auth/popup-blocked" || error?.code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, provider);
      return;
    }
    $("authError").textContent = friendlyError(error);
    $("authError").classList.remove("hidden");
    setSync("Sin conexión");
  }
}
$("loginBtn").addEventListener("click", login);
$("logoutBtn").addEventListener("click", async () => {
  if (unsubscribeNotes) unsubscribeNotes();
  await signOut(auth);
});

getRedirectResult(auth).catch(error => {
  $("authError").textContent = friendlyError(error);
  $("authError").classList.remove("hidden");
});

onAuthStateChanged(auth, user => {
  currentUser = user;
  if (unsubscribeNotes) {
    unsubscribeNotes();
    unsubscribeNotes = null;
  }
  if (!user) {
    notes = [];
    $("authCard").classList.remove("hidden");
    $("appArea").classList.add("hidden");
    setSync("Sin conexión");
    return;
  }

  $("authCard").classList.add("hidden");
  $("appArea").classList.remove("hidden");
  $("userName").textContent = user.displayName || "Usuario";
  $("userEmail").textContent = user.email || "";
  if (user.photoURL) {
    $("userPhoto").src = user.photoURL;
    $("userPhoto").classList.remove("hidden");
  }
  loading = true;
  render();
  subscribeToNotes();
});

function subscribeToNotes() {
  setSync("Sincronizando", "syncing");
  const q = query(notesCollection(), orderBy("updatedAt", "desc"));
  unsubscribeNotes = onSnapshot(q, snapshot => {
    notes = snapshot.docs.map(d => ({id: d.id, ...d.data()}));
    loading = false;
    setSync(navigator.onLine ? "Sincronizado" : "Modo sin conexión", navigator.onLine ? "online" : "syncing");
    render();
    checkLocalMigration();
  }, error => {
    loading = false;
    setSync("Error de sincronización", "error");
    $("loadingState").textContent = friendlyError(error);
    $("loadingState").classList.remove("hidden");
  });
}
window.addEventListener("online", () => currentUser && setSync("Sincronizando", "syncing"));
window.addEventListener("offline", () => currentUser && setSync("Modo sin conexión", "syncing"));

function normalizeDate(value) {
  if (!value) return new Date();
  if (typeof value.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
function formatDate(value) {
  return new Intl.DateTimeFormat("es-CR", {dateStyle:"medium", timeStyle:"short"}).format(normalizeDate(value));
}
function escapeCsv(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}
function download(name, content, type) {
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function resetForm() {
  form.reset();
  $("noteId").value = "";
  $("formTitle").textContent = "Nueva nota";
  $("cancelEdit").classList.add("hidden");
}
form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!currentUser) return;
  const id = $("noteId").value;
  const existing = notes.find(n => n.id === id);
  const data = {
    category: $("category").value.trim(),
    title: $("title").value.trim(),
    content: $("content").value.trim(),
    tags: $("tags").value.split(",").map(x => x.trim()).filter(Boolean),
    learned: existing?.learned || false,
    createdAt: existing?.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  try {
    setSync("Guardando", "syncing");
    if (id) await updateDoc(noteReference(id), data);
    else await addDoc(notesCollection(), data);
    resetForm();
    window.scrollTo({top:0, behavior:"smooth"});
  } catch (error) {
    alert(friendlyError(error));
    setSync("Error", "error");
  }
});
$("cancelEdit").onclick = resetForm;

function render() {
  $("loadingState").classList.toggle("hidden", !loading);
  const queryText = $("search").value.toLowerCase();
  const selectedCategory = $("categoryFilter").value;
  const selectedStatus = $("statusFilter").value;
  const filtered = notes.filter(n => {
    const searchable = [n.category, n.title, n.content, (n.tags || []).join(" ")].join(" ").toLowerCase();
    return (!queryText || searchable.includes(queryText))
      && (!selectedCategory || n.category === selectedCategory)
      && (!selectedStatus || (selectedStatus === "learned" ? n.learned : !n.learned));
  });

  list.innerHTML = "";
  filtered.forEach(n => {
    const node = template.content.cloneNode(true);
    node.querySelector(".note-category").textContent = n.category || "Sin categoría";
    node.querySelector(".note-title").textContent = n.title || "Sin título";
    node.querySelector(".note-content").textContent = n.content || "";
    node.querySelector(".note-tags").textContent = (n.tags || []).length ? "Etiquetas: " + n.tags.join(", ") : "";
    node.querySelector(".note-date").textContent = "Actualizada: " + formatDate(n.updatedAt);
    const status = node.querySelector(".status");
    status.textContent = n.learned ? "Aprendida" : "Pendiente";
    if (n.learned) status.classList.add("learned");
    const learn = node.querySelector(".learn");
    learn.textContent = n.learned ? "Marcar pendiente" : "Marcar aprendida";
    learn.onclick = () => updateDoc(noteReference(n.id), {learned: !n.learned, updatedAt: serverTimestamp()}).catch(e => alert(friendlyError(e)));
    node.querySelector(".edit").onclick = () => editNote(n.id);
    node.querySelector(".delete").onclick = async () => {
      if (confirm("¿Eliminar esta nota?")) {
        try { await deleteDoc(noteReference(n.id)); }
        catch (e) { alert(friendlyError(e)); }
      }
    };
    list.append(node);
  });

  $("emptyState").classList.toggle("hidden", loading || filtered.length > 0);
  $("totalNotes").textContent = notes.length;
  $("learnedNotes").textContent = notes.filter(n => n.learned).length;
  $("pendingNotes").textContent = notes.filter(n => !n.learned).length;

  const categories = [...new Set(notes.map(n => n.category).filter(Boolean))].sort((a,b) => a.localeCompare(b));
  const current = $("categoryFilter").value;
  $("categoryFilter").innerHTML = '<option value="">Todas las categorías</option>';
  categories.forEach(category => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    $("categoryFilter").append(option);
  });
  $("categoryFilter").value = categories.includes(current) ? current : "";
}
function editNote(id) {
  const n = notes.find(x => x.id === id);
  if (!n) return;
  $("noteId").value = n.id;
  $("category").value = n.category || "";
  $("title").value = n.title || "";
  $("content").value = n.content || "";
  $("tags").value = (n.tags || []).join(", ");
  $("formTitle").textContent = "Editar nota";
  $("cancelEdit").classList.remove("hidden");
  window.scrollTo({top:0, behavior:"smooth"});
}
["search","categoryFilter","statusFilter"].forEach(id => {
  $(id).addEventListener(id === "search" ? "input" : "change", render);
});

$("exportCsv").onclick = () => {
  const rows = [["Materia","Título","Contenido","Etiquetas","Estado","Creada","Actualizada"],
    ...notes.map(n => [n.category,n.title,n.content,(n.tags||[]).join("; "),n.learned?"Aprendida":"Pendiente",
      normalizeDate(n.createdAt).toISOString(),normalizeDate(n.updatedAt).toISOString()])];
  download("mis-notas.csv", "\ufeff" + rows.map(r => r.map(escapeCsv).join(",")).join("\n"), "text/csv;charset=utf-8");
};
$("exportJson").onclick = () => {
  const clean = notes.map(n => ({...n, createdAt:normalizeDate(n.createdAt).toISOString(), updatedAt:normalizeDate(n.updatedAt).toISOString()}));
  download("respaldo-mis-notas.json", JSON.stringify({version:2, exportedAt:new Date().toISOString(), notes:clean}, null, 2), "application/json");
};
$("importJson").onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const incoming = Array.isArray(data) ? data : data.notes;
    if (!Array.isArray(incoming)) throw new Error("Formato inválido");
    if (!confirm(`Se importarán ${incoming.length} notas. Las notas actuales se conservarán. ¿Continuar?`)) return;
    const batch = writeBatch(db);
    incoming.forEach(n => {
      const ref = doc(notesCollection());
      batch.set(ref, {
        category: String(n.category || ""),
        title: String(n.title || ""),
        content: String(n.content || ""),
        tags: Array.isArray(n.tags) ? n.tags.map(String) : [],
        learned: Boolean(n.learned),
        createdAt: n.createdAt ? new Date(n.createdAt) : serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    });
    await batch.commit();
  } catch (error) {
    alert("El archivo no es un respaldo válido o no pudo importarse.");
    console.error(error);
  } finally {
    event.target.value = "";
  }
};
$("clearAll").onclick = async () => {
  if (!notes.length || !confirm("¿Borrar todas las notas de Firebase? Esta acción no se puede deshacer.")) return;
  try {
    const snapshot = await getDocs(notesCollection());
    for (let i = 0; i < snapshot.docs.length; i += 400) {
      const batch = writeBatch(db);
      snapshot.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (error) {
    alert(friendlyError(error));
  }
};

function getLocalNotes() {
  try {
    const data = JSON.parse(localStorage.getItem(LOCAL_KEY));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}
function checkLocalMigration() {
  if (sessionStorage.getItem("migrationDismissed")) return;
  const local = getLocalNotes();
  if (!local.length) return;
  $("migrationText").textContent = `Encontramos ${local.length} nota(s) guardada(s) por la versión anterior en este dispositivo. Puede subirlas a su cuenta.`;
  $("migrationCard").classList.remove("hidden");
}
$("dismissMigration").onclick = () => {
  sessionStorage.setItem("migrationDismissed", "1");
  $("migrationCard").classList.add("hidden");
};
$("migrateBtn").onclick = async () => {
  const local = getLocalNotes();
  if (!local.length) return;
  try {
    $("migrateBtn").disabled = true;
    $("migrateBtn").textContent = "Subiendo...";
    for (let i = 0; i < local.length; i += 400) {
      const batch = writeBatch(db);
      local.slice(i, i + 400).forEach(n => {
        const ref = doc(notesCollection());
        batch.set(ref, {
          category: String(n.category || ""),
          title: String(n.title || ""),
          content: String(n.content || ""),
          tags: Array.isArray(n.tags) ? n.tags.map(String) : [],
          learned: Boolean(n.learned),
          createdAt: n.createdAt ? new Date(n.createdAt) : serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      });
      await batch.commit();
    }
    localStorage.removeItem(LOCAL_KEY);
    $("migrationCard").classList.add("hidden");
    alert("Las notas anteriores se subieron correctamente a Firebase.");
  } catch (error) {
    alert(friendlyError(error));
  } finally {
    $("migrateBtn").disabled = false;
    $("migrateBtn").textContent = "Subirlas a Firebase";
  }
};

$("reviewBtn").onclick = () => {
  if (!notes.length) return alert("Primero agregue alguna nota.");
  reviewNotes = [...notes].sort(() => Math.random() - 0.5);
  reviewIndex = 0;
  $("reviewDialog").showModal();
  showCard();
};
$("closeReview").onclick = () => $("reviewDialog").close();
$("showAnswer").onclick = () => {
  $("reviewContent").classList.remove("hidden");
  $("showAnswer").classList.add("hidden");
};
$("prevCard").onclick = () => {reviewIndex = (reviewIndex - 1 + reviewNotes.length) % reviewNotes.length; showCard();};
$("nextCard").onclick = () => {reviewIndex = (reviewIndex + 1) % reviewNotes.length; showCard();};
$("toggleLearned").onclick = async () => {
  const n = reviewNotes[reviewIndex];
  try {
    await updateDoc(noteReference(n.id), {learned: !n.learned, updatedAt: serverTimestamp()});
    n.learned = !n.learned;
    showCard();
  } catch (error) {
    alert(friendlyError(error));
  }
};
function showCard() {
  const n = reviewNotes[reviewIndex];
  $("reviewProgress").textContent = `Tarjeta ${reviewIndex + 1} de ${reviewNotes.length}`;
  $("reviewCategory").textContent = n.category || "Sin categoría";
  $("reviewTitle").textContent = n.title || "Sin título";
  $("reviewContent").textContent = n.content || "";
  $("reviewContent").classList.add("hidden");
  $("showAnswer").classList.remove("hidden");
  $("toggleLearned").textContent = n.learned ? "Marcar pendiente" : "Marcar aprendida";
}

$("themeBtn").onclick = () => {
  document.documentElement.classList.toggle("dark");
  localStorage.setItem("mis_notas_tema", document.documentElement.classList.contains("dark") ? "dark" : "light");
};
if (localStorage.getItem("mis_notas_tema") === "dark") document.documentElement.classList.add("dark");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(console.error));
}
