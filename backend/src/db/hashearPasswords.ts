// Script de UNA SOLA VEZ: encripta (bcrypt) las contraseñas que están en texto plano.
// Ubicación: backend/src/db/hashearPasswords.ts
// Ejecutar:  npx tsx src/db/hashearPasswords.ts
// Usa la base que indique el .env (Turso). Si una clave ya está encriptada, la saltea.
import "dotenv/config";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { db } from "./index.js";
import { usuarios } from "./schema.js";

const todos = await db.select().from(usuarios);

for (const u of todos) {
  if (u.password.startsWith("$2")) {
    console.log(`${u.email}: ya estaba encriptada, se saltea.`);
    continue;
  }
  const hash = await bcrypt.hash(u.password, 10);
  await db.update(usuarios).set({ password: hash }).where(eq(usuarios.id, u.id));
  console.log(`${u.email}: contraseña encriptada.`);
}

process.exit(0);