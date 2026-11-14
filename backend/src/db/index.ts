import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

// Crea o abre el archivo de la base de datos SQLite
const sqlite = new Database("sistema_ventas.db");

// Exportamos "db" para usarlo en todo el proyecto
export const db = drizzle(sqlite, { schema });