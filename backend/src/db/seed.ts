// Carga las variables del archivo .env (URL y Token de Turso) antes de iniciar la conexión
import "dotenv/config";
// Importa la instancia de Drizzle ORM ya conectada a la base de datos remota
import { db } from "./index.js";
// Importa la definición de las tablas desde schema.ts para validar columnas y tipos
import { usuarios, productos, clientes } from "./schema.js";

// Función asíncrona principal que inserta los registros iniciales en Turso
async function seed() {
  console.log("Cargando datos iniciales en Turso...");

  //1-inserta ambos usuarios administradores en una sola consulta usando un arreglo
  await db.insert(usuarios).values([
    {
      nombre: "Pablo Ruiz",
      email: "admin@ventas.com",
      password: "123456",
      rol: "admin",
    },
    {
      nombre: "Valentin Valdez del Pino",
      email: "admin@sistema.com",
      password: "321",
      rol: "admin",
    },
  ]);

  //2-inserta un lote de productos iniciales en una sola consulta
  await db.insert(productos).values([
    { codigo: "AG-2026", nombre: "Agenda Docente Personalizada", precio: 18500, stock: 35 },
    { codigo: "CU-001", nombre: "Cuaderno Pedagógico A4", precio: 12000, stock: 15 },
    { codigo: "RE-105", nombre: "Resma Papel Boreal A4 80g", precio: 9500, stock: 50 },
  ]);

  // 3-Inserta un cliente inicial para realizar pruebas de ventas y cuenta corriente
  await db.insert(clientes).values([
    { razonSocial: "Librería San Martín", documento: "20-35123456-7", contacto: "381-5551234" },
  ]);

  console.log("Datos cargados con éxito en Turso.");
  // Cierra la conexión HTTP y finaliza el script en la terminal con código de éxito (0)
  process.exit(0);
}

// Ejecuta la función y captura cualquier excepción (ej. intentar insertar datos duplicados)
seed().catch((err) => {
  console.error("Error al cargar datos:", err);
  // Finaliza el proceso en la terminal indicando que ocurrió un error (1)
  process.exit(1);
});