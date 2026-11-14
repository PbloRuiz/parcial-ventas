import "dotenv/config";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import {
  productos,
  usuarios,
  clientes,
  ventas,
  detallesVenta,
  movimientosCtaCte,
} from "./db/schema.js";

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.JWT_SECRET || "clave_parcial_ventas";

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
      usuario: { nombre: usuario.nombre, rol: usuario.rol },
    });
  } catch (error) {
    console.error("Error en el login:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

// RUTA 4: Procesar la venta, descontar stock y registrar en Ventas / Cuenta Corriente
app.post("/api/ventas", async (req, res) => {
  try {
    const { clienteId, formaPago, carrito, total } = req.body;

    if (!carrito || carrito.length === 0) {
      return res.status(400).json({ error: "El carrito está vacío." });
    }

    if (formaPago === "cuenta_corriente" && !clienteId) {
      return res.status(400).json({ error: "Debe seleccionar un cliente registrado para vender en Cuenta Corriente." });
    }

    // PASO 1: Validar y descontar stock
    for (const item of carrito) {
      const productoDB = await db.select().from(productos).where(eq(productos.id, item.idProducto));

      if (productoDB.length > 0) {
        const nuevoStock = productoDB[0].stock - item.cantidad;
        if (nuevoStock < 0) {
          return res.status(400).json({ error: `Stock insuficiente para el producto: ${item.nombre}` });
        }

        await db.update(productos)
          .set({ stock: nuevoStock })
          .where(eq(productos.id, item.idProducto));
      }
    }

    // PASO 2: Guardar cabecera y detalles de la venta
    const fechaActual = new Date().toISOString();
    const numeroComprobante = `FC-${Date.now()}`;

    const ventaInsertada = await db.insert(ventas).values({
      numeroComprobante,
      fecha: fechaActual,
      clienteId: clienteId ? Number(clienteId) : null,
      total: Number(total),
      formaPago,
    }).returning();

    const ventaId = ventaInsertada[0].id;

    for (const item of carrito) {
      await db.insert(detallesVenta).values({
        ventaId,
        productoId: item.idProducto,
        cantidad: item.cantidad,
        precioUnitario: item.precio,
        nombreProducto: item.nombre,
        subtotal: item.subtotal,
      });
    }

    // PASO 3: Si fue Cuenta Corriente, registrar el cargo (deuda) al cliente
    if (formaPago === "cuenta_corriente" && clienteId) {
      await db.insert(movimientosCtaCte).values({
        clienteId: Number(clienteId),
        fecha: fechaActual,
        tipo: "cargo",
        importe: Number(total),
        observacion: `Venta ${numeroComprobante}`,
        ventaId,
      });
    }

    res.json({ mensaje: "Venta confirmada y stock actualizado.", comprobante: numeroComprobante });
  } catch (error) {
    console.error("Error al procesar la venta:", error);
    res.status(500).json({ error: "Error interno del servidor al procesar la venta." });
  }
});

// RUTA 5: Crear un nuevo producto (Alta de inventario)
app.post("/api/productos", async (req, res) => {
  try {
    const { codigo, nombre, precio, stock } = req.body;

    if (!codigo || !nombre || precio === undefined || stock === undefined) {
      return res.status(400).json({ error: "Faltan datos obligatorios." });
    }

    await db.insert(productos).values({
      codigo,
      nombre,
      precio,
      stock,
    });

    res.json({ mensaje: "Producto registrado exitosamente." });
  } catch (error) {
    console.error("Error al guardar el producto:", error);
    res.status(500).json({ error: "Error interno del servidor al guardar el producto." });
  }
});

// RUTA 5B: Editar un producto existente
app.put("/api/productos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { codigo, nombre, precio, stock } = req.body;

    if (!codigo || !nombre || precio === undefined || stock === undefined) {
      return res.status(400).json({ error: "Faltan datos obligatorios." });
    }

    await db
      .update(productos)
      .set({
        codigo,
        nombre,
        precio: Number(precio),
        stock: Number(stock),
      })
      .where(eq(productos.id, id));

    res.json({ mensaje: "Producto actualizado exitosamente." });
  } catch (error) {
    console.error("Error al actualizar el producto:", error);
    res.status(500).json({ error: "Error interno del servidor al actualizar el producto." });
  }
});

// RUTA 6: Listar y crear Usuarios
app.get("/api/usuarios", async (req, res) => {
  try {
    const lista = await db.select({
      id: usuarios.id,
      nombre: usuarios.nombre,
      email: usuarios.email,
      rol: usuarios.rol,
    }).from(usuarios);
    res.json(lista);
  } catch (error) {
    res.status(500).json({ error: "Error al consultar usuarios." });
  }
});

app.post("/api/usuarios", async (req, res) => {
  try {
    const { nombre, email, password, rol } = req.body;
    if (!nombre || !email || !password) {
      return res.status(400).json({ error: "Todos los campos son obligatorios." });
    }
    await db.insert(usuarios).values({ nombre, email, password, rol: rol || "vendedor" });
    res.json({ mensaje: "Usuario registrado exitosamente." });
  } catch (error) {
    res.status(500).json({ error: "Error al registrar usuario (verifique que el email no esté duplicado)." });
  }
});

// RUTA 7: Clientes y Saldo de Cuenta Corriente
app.get("/api/clientes", async (req, res) => {
  try {
    const listaClientes = await db.select().from(clientes);
    const todosMovimientos = await db.select().from(movimientosCtaCte);

    // Calculamos el saldo actual de cada cliente (cargos - abonos)
    const clientesConSaldo = listaClientes.map((cli) => {
      const movs = todosMovimientos.filter((m) => m.clienteId === cli.id);
      const saldo = movs.reduce((acc, m) => (m.tipo === "cargo" ? acc + m.importe : acc - m.importe), 0);
      return { ...cli, saldo };
    });

    res.json(clientesConSaldo);
  } catch (error) {
    res.status(500).json({ error: "Error al consultar clientes." });
  }
});

app.post("/api/clientes", async (req, res) => {
  try {
    const { razonSocial, documento, contacto } = req.body;
    if (!razonSocial || !documento) {
      return res.status(400).json({ error: "Razón social y documento son obligatorios." });
    }
    await db.insert(clientes).values({ razonSocial, documento, contacto });
    res.json({ mensaje: "Cliente registrado exitosamente." });
  } catch (error) {
    res.status(500).json({ error: "Error al registrar cliente (verifique que el documento no exista)." });
  }
});

// RUTA 8: Consultar movimientos y registrar pagos (abonos) en Cuenta Corriente
app.get("/api/clientes/:id/movimientos", async (req, res) => {
  try {
    const clienteId = Number(req.params.id);
    const movimientos = await db
      .select()
      .from(movimientosCtaCte)
      .where(eq(movimientosCtaCte.clienteId, clienteId));
    res.json(movimientos);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener movimientos de cuenta corriente." });
  }
});

app.post("/api/clientes/:id/pagos", async (req, res) => {
  try {
    const clienteId = Number(req.params.id);
    const { importe, observacion } = req.body;

    if (!importe || Number(importe) <= 0) {
      return res.status(400).json({ error: "El importe del pago debe ser mayor a 0." });
    }

    await db.insert(movimientosCtaCte).values({
      clienteId,
      fecha: new Date().toISOString(),
      tipo: "abono",
      importe: Number(importe),
      observacion: observacion || "Pago recibido en caja",
    });

    res.json({ mensaje: "Pago registrado correctamente." });
  } catch (error) {
    res.status(500).json({ error: "Error al registrar el pago." });
  }
});

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`)
  });
}

export default app;