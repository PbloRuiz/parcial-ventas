import express from "express";
import cors from "cors";

// Importamos jsonwebtoken para generar el "pase de seguridad" del usuario
import jwt from "jsonwebtoken";

// Importamos 'eq' de Drizzle. Esto sirve para decirle a la base de datos que busque valores exactos
import { eq } from "drizzle-orm"; 
import { db } from "./db/index.js";
import { productos, usuarios } from "./db/schema.js";

const app = express();
const PORT = 3000;

// Esta es la llave secreta para crear los tokens. 
// En un proyecto real esto se oculta, pero para el parcial lo dejamos acá.
const SECRET_KEY = "clave_parcial_ventas"; 

app.use(cors());
app.use(express.json());

// RUTA 1: Prueba de conexión
app.get("/", (req, res) => {
  res.json({ mensaje: "Servidor funcionando." });
});

// RUTA 2: Obtener todos los productos
app.get("/api/productos", async (req, res) => {
  try {
    const listaProductos = await db.select().from(productos);
    res.json(listaProductos);
  } catch (error) {
    res.status(500).json({ error: "Error al consultar la base de datos" });
  }
});

// RUTA 3: Sistema de Login
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const usuarioEncontrado = await db.select().from(usuarios).where(eq(usuarios.email, email));

    if (usuarioEncontrado.length === 0) {
      return res.status(401).json({ error: "Usuario no encontrado." });
    }

    const usuario = usuarioEncontrado[0];

    if (password !== usuario.password) {
      return res.status(401).json({ error: "Contraseña incorrecta." });
    }

    const token = jwt.sign(
      { id: usuario.id, rol: usuario.rol }, 
      SECRET_KEY, 
      { expiresIn: "2h" }
    );

    res.json({ 
      mensaje: "Login exitoso.", 
      token: token,
      usuario: { nombre: usuario.nombre, rol: usuario.rol }
    });

  } catch (error) {
    console.error("Error en el login:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

// NUEVA RUTA 4: Procesar la venta y descontar stock
app.post("/api/ventas", async (req, res) => {
  try {
    // Recibimos los datos que React nos manda al presionar "Confirmar Venta"
    const { cliente, formaPago, carrito, total } = req.body;

    if (!carrito || carrito.length === 0) {
      return res.status(400).json({ error: "El carrito está vacío." });
    }

    // PASO 1: Descontar el stock de cada producto en la base de datos
    // Recorremos el arreglo de productos vendidos uno por uno
    for (const item of carrito) {
      // Consultamos el stock actual del producto en SQLite
      const productoDB = await db.select().from(productos).where(eq(productos.id, item.idProducto));
      
      if (productoDB.length > 0) {
        const stockActual = productoDB[0].stock;
        const nuevoStock = stockActual - item.cantidad;

        // Validamos por seguridad en el backend que el stock no quede negativo
        if (nuevoStock < 0) {
          return res.status(400).json({ error: `Stock insuficiente para el producto: ${item.nombre}` });
        }

        // Ejecutamos el UPDATE en SQLite para guardar la nueva cantidad
        await db.update(productos)
          .set({ stock: nuevoStock })
          .where(eq(productos.id, item.idProducto));
      }
    }
    // PASO 2: (Opcional según tu schema) Insertar el registro en la tabla de ventas
    // Si tenés una tabla "ventas" en schema.js, acá harías un db.insert(ventas).values(...)

    // Le respondemos a React que la operación fue un éxito
    res.json({ mensaje: "Venta confirmada y stock actualizado." });

  } catch (error) {
    console.error("Error al procesar la venta:", error);
    res.status(500).json({ error: "Error interno del servidor al procesar la venta." });
  }
});

// NUEVA RUTA 5: Crear un nuevo producto (Alta de inventario)
app.post("/api/productos", async (req, res) => {
  try {
    // Extraemos los datos que nos manda el formulario de React
    const { codigo, nombre, precio, stock } = req.body;

    // Pequeña validación de seguridad
    if (!codigo || !nombre || precio === undefined || stock === undefined) {
      return res.status(400).json({ error: "Faltan datos obligatorios." });
    }

    // Insertamos el nuevo producto en la tabla de SQLite
    await db.insert(productos).values({
      codigo: codigo,
      nombre: nombre,
      precio: precio,
      stock: stock
    });

    res.json({ mensaje: "Producto registrado exitosamente." });
  } catch (error) {
    console.error("Error al guardar el producto:", error);
    res.status(500).json({ error: "Error interno del servidor al guardar el producto." });
  }
});


app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});