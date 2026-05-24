if (!window.LumenFirebase) {
    alert("Firebase non e' stato caricato. Controlla la connessione internet e ricarica Lumen.");
    throw new Error("LumenFirebase non disponibile.");
}

const {
    auth,
    db,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    collection,
    doc,
    getDocs,
    query,
    serverTimestamp,
    setDoc,
    where
} = window.LumenFirebase;

function normalizeNicknameKey(nickname) {
    return String(nickname ?? "").trim().toLowerCase();
}

async function isNicknameAvailable(nickname) {
    const nicknameLower = normalizeNicknameKey(nickname);
    if (!nicknameLower || nicknameLower.length < 2) return false;

    const nicknameQuery = query(
        collection(db, "users"),
        where("nicknameLower", "==", nicknameLower)
    );
    const snapshot = await getDocs(nicknameQuery);
    return snapshot.empty;
}

const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const showRegister = document.getElementById("show-register");
const showLogin = document.getElementById("show-login");

function showForm(formToShow) {
    loginForm.classList.toggle("hidden", formToShow !== "login");
    registerForm.classList.toggle("hidden", formToShow !== "register");
}

showRegister.addEventListener("click", (event) => {
    event.preventDefault();
    showForm("register");
});

showLogin.addEventListener("click", (event) => {
    event.preventDefault();
    showForm("login");
});

registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const nickname = document.getElementById("register-nickname").value.trim();
    const email = document.getElementById("register-email").value.trim();
    const password = document.getElementById("register-password").value;

    if (!nickname || nickname.length < 2) {
        alert("Il nickname deve avere almeno 2 caratteri.");
        return;
    }

    try {
        const available = await isNicknameAvailable(nickname);
        if (!available) {
            alert("Questo nickname e' gia' in uso. Scegline un altro.");
            return;
        }

        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid,
            nickname,
            nicknameLower: normalizeNicknameKey(nickname),
            email,
            friends: [],
            pendingRequests: [],
            status: "online",
            presenceVisible: true,
            accentColor: "purple",
            avatarDataUrl: "",
            createdAt: serverTimestamp()
        });

        window.location.href = "app.html";
    } catch (error) {
        console.error("Errore registrazione:", error);
        alert("Errore durante la creazione dell'account: " + error.message);
    }
});

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    try {
        await signInWithEmailAndPassword(auth, email, password);
        window.location.href = "app.html";
    } catch (error) {
        console.error("Errore login:", error);
        alert("Email o password errate.");
    }
});
