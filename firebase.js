(function () {
    const firebaseConfig = {
        apiKey: "AIzaSyBwu7MN-2tm3Z35tzTbQuoIOeH8JOC6Vv8",
        authDomain: "lumenion.firebaseapp.com",
        projectId: "lumenion",
        storageBucket: "lumenion.firebasestorage.app",
        messagingSenderId: "208911556322",
        appId: "1:208911556322:web:0f773a05143396546dc8bb",
        measurementId: "G-NHKR4TJ750"
    };

    if (!window.firebase) {
        throw new Error("Firebase SDK non caricato. Controlla la connessione o gli script in HTML.");
    }

    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }

    const auth = firebase.auth();
    const db = firebase.firestore();
    const FieldValue = firebase.firestore.FieldValue;

    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((error) => {
        console.warn("Persistenza locale Firebase non disponibile:", error);
    });

    function doc(database, collectionPath, documentId) {
        return database.collection(collectionPath).doc(documentId);
    }

    function collection(database, collectionPath) {
        return database.collection(collectionPath);
    }

    function where(field, operator, value) {
        return { type: "where", args: [field, operator, value] };
    }

    function orderBy(field, direction) {
        return { type: "orderBy", args: [field, direction] };
    }

    function query(collectionRef, ...constraints) {
        return constraints.reduce((ref, constraint) => {
            if (constraint.type === "where") return ref.where(...constraint.args);
            if (constraint.type === "orderBy") return ref.orderBy(...constraint.args);
            return ref;
        }, collectionRef);
    }

    function normalizeDocumentSnapshot(snapshot) {
        if (!snapshot || typeof snapshot.data !== "function" || typeof snapshot.exists === "function") {
            return snapshot;
        }

        return {
            id: snapshot.id,
            ref: snapshot.ref,
            data: () => snapshot.data(),
            exists: () => snapshot.exists
        };
    }

    window.LumenFirebase = {
        auth,
        db,
        createUserWithEmailAndPassword: (authInstance, email, password) =>
            authInstance.createUserWithEmailAndPassword(email, password),
        signInWithEmailAndPassword: (authInstance, email, password) =>
            authInstance.signInWithEmailAndPassword(email, password),
        onAuthStateChanged: (authInstance, callback) =>
            authInstance.onAuthStateChanged(callback),
        signOut: (authInstance) => authInstance.signOut(),
        doc,
        collection,
        query,
        where,
        orderBy,
        getDoc: (ref) => ref.get().then(normalizeDocumentSnapshot),
        getDocs: (ref) => ref.get(),
        setDoc: (ref, data) => ref.set(data),
        updateDoc: (ref, data) => ref.update(data),
        deleteDoc: (ref) => ref.delete(),
        addDoc: (collectionRef, data) => collectionRef.add(data),
        onSnapshot: (ref, callback) => ref.onSnapshot(callback),
        arrayUnion: (...values) => FieldValue.arrayUnion(...values),
        arrayRemove: (...values) => FieldValue.arrayRemove(...values),
        serverTimestamp: () => FieldValue.serverTimestamp()
    };
})();
