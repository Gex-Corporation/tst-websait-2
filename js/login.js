import { initializeApp } from "firebase/app";
import { getFirestore, getDoc, doc } from "firebase/firestore";

// ==================== Firebase Configuration ====================
const firebaseConfig = {
  apiKey: "AIzaSyCng8ZDKd6zOc2ydbf-wUljOzEAViWSOQI",
  authDomain: "computer-kaaj.firebaseapp.com",
  projectId: "computer-kaaj",
  storageBucket: "computer-kaaj.firebasestorage.app",
  messagingSenderId: "786670596427",
  appId: "1:786670596427:web:db95ddef44d9f35739f8ce",
  measurementId: "G-007FD30DQ6"
};


let db;
try {
    if (!firebaseConfig.apiKey) {
        console.warn("Firebase configuration missing!");
    } else {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        console.log("Firebase Initialized (Login Page)");
    }
} catch (e) { console.error("Firebase Init Error:", e); }

// ==================== Session & Auth Keys ====================
const LOGIN_SESSION_KEY = 'invoice_logged_in_user_v1';
const REMEMBER_ME_KEY = 'invoice_remembered_user';

// ==================== Domain Lock System ====================
async function checkDomainAccess() {
    try {
        const response = await fetch('https://raw.githubusercontent.com/2dgameralif/srhealthcare-resource/main/Domain.json');
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const allowedDomains = await response.json();
        const currentHost = window.location.hostname;

        if (Array.isArray(allowedDomains)) {
            return allowedDomains.includes(currentHost) || allowedDomains.includes('*');
        }
        return false;
    } catch (error) {
        console.error('Domain lock error:', error);
        return false;
    }
}

// ==================== Login Logic ====================
async function performLogin() {
    if (!db) return alert("Firebase not connected!");
    const userEl = document.getElementById('loginUsername');
    const passEl = document.getElementById('loginPassword');
    const loginBtn = document.getElementById('loginBtn');
    const errorEl = document.getElementById('loginError');
    const user = userEl.value.trim();
    const pass = passEl.value.trim();
    const remember = document.getElementById('rememberMe').checked;

    if (!user || !pass) {
        errorEl.textContent = 'Enter username and password';
        errorEl.style.display = 'block';
        errorEl.style.color = '#f87171';
        return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = 'Verifying...';
    errorEl.textContent = 'Verifying data...';
    errorEl.style.display = 'block';
    errorEl.style.color = '#60a5fa';

    try {
        const docSnap = await getDoc(doc(db, "users", user));
        if (docSnap.exists() && String(docSnap.data().password) === String(pass)) {
            // Save session
            sessionStorage.setItem(LOGIN_SESSION_KEY, user);
            if (remember) {
                localStorage.setItem(REMEMBER_ME_KEY, JSON.stringify({ username: user, password: pass }));
            } else {
                localStorage.removeItem(REMEMBER_ME_KEY);
            }
            // Redirect: admin → dashboard, others → main app
            window.location.href = (user === 'admin') ? 'admin.html' : 'main.html';
        } else {
            errorEl.textContent = 'Incorrect username or password';
            errorEl.style.color = '#f87171';
        }
    } catch (e) {
        errorEl.textContent = 'Server connection problem.';
        errorEl.style.color = '#f87171';
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
    }
}

// ==================== App Entry Point ====================
window.addEventListener('DOMContentLoaded', async () => {
    // Domain lock check first
    const isDomainAllowed = await checkDomainAccess();
    if (!isDomainAllowed) {
        const appDiv = document.getElementById('app');
        if (appDiv) {
            appDiv.innerHTML = `
                <div style="display: flex; justify-content: center; align-items: center; height: 100vh; font-family: sans-serif;">
                    <div style="background: rgba(15,23,42,0.95); padding: 2rem; border-radius: 1rem; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.4); text-align: center; max-width: 400px; border: 1px solid rgba(255,255,255,0.1);">
                        <h1 style="color: #ef4444; margin-bottom: 0.5rem;">⛔ Hosting Denied</h1>
                        <p style="color: #e2e8f0;">This application is not authorized to run on <strong>${window.location.hostname}</strong>.</p>
                        <p style="font-size: 0.875rem; color: #94a3b8;">Contact &lt;Dev Alif/&gt; 01576429840</p>
                    </div>
                </div>
            `;
        }
        return;
    }

    // If already logged in (session exists), redirect accordingly
    const sess = sessionStorage.getItem(LOGIN_SESSION_KEY);
    if (sess) {
        window.location.href = (sess === 'admin') ? 'admin.html' : 'main.html';
        return;
    }

    // Pre-fill Remember Me credentials
    const rem = localStorage.getItem(REMEMBER_ME_KEY);
    if (rem) {
        try {
            const data = JSON.parse(rem);
            document.getElementById('loginUsername').value = data.username || '';
            document.getElementById('loginPassword').value = data.password || '';
            document.getElementById('rememberMe').checked = true;
        } catch (e) {}
    }

    // Bind events
    document.getElementById('loginBtn').onclick = performLogin;
    document.getElementById('loginPassword').onkeypress = (e) => {
        if (e.key === 'Enter') performLogin();
    };
    document.getElementById('loginUsername').onkeypress = (e) => {
        if (e.key === 'Enter') document.getElementById('loginPassword').focus();
    };
});
