// Firebase の設定。手順書(README.md)の「4. 設定をコピーする」で表示される
// firebaseConfig の中身を、下の {} の中にそのまま貼り付けてください。
// この値は公開しても問題ありません(データは firestore.rules で守ります)。
window.FIREBASE_CONFIG = {
    apiKey: "AIzaSyBGwzkATVmyAu47OASiHaOjVJjaNMK8PDA",
    authDomain: "keijiban-b45f4.firebaseapp.com",
    projectId: "keijiban-b45f4",
    storageBucket: "keijiban-b45f4.firebasestorage.app",
    messagingSenderId: "657260777705",
    appId: "1:657260777705:web:3a4be3926ec05a8edfa078"
};

// App Check(本物のアプリ以外からのアクセスを防ぐ)の reCAPTCHA Enterprise のキー(サイトキー)。
// README.md の「App Check を設定する」で、Google Cloud コンソールで作ったキーを "" の中に貼り付けてください。
// 空のままなら App Check は使いません。
window.APPCHECK_SITE_KEY = "";
