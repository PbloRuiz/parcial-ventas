import { db } from "./index.js";
import { usuarios, productos, clientes } from "./schema.js";

async function seed() {
  console.log("Cargando datos de prueba...");

  try {
    //Crear un usuario de prueba
    await db.insert(usuarios).values({
      nombre: "Pablo Ruiz",
      email: "admin@ventas.com",
      password: "123", 
      rol: "admin",
    });

    //Crear algunos productos iniciales
    await db.insert(productos).values([
      { codigo: "PROD-001", nombre: "Agenda Personalizada 2027", precio: 8500, stock: 15 },
      { codigo: "PROD-002", nombre: "Cuaderno Docente A4", precio: 6200, stock: 30 },
      { codigo: "PROD-003", nombre: "Resma Papel Fotográfico 180g", precio: 4500, stock: 50 },
    ]);

    //Crear un cliente
    await db.insert(clientes).values({
      razonSocial: "Librería Central",
      documento: "30-11223344-5",
      contacto: "Carlos Gómez",
    });

    console.log("Datos inyectados con exito en SQLite.");
  } catch (error) {
    console.error("Hubo un error:", error);
  } finally {
    process.exit(0);
  }
}

seed();