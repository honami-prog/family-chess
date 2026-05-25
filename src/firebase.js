import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import firebaseConfig from "./firebaseConfig.js";

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
