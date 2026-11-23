import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import {
  productos,
  usuarios,
  clientes,
  ventas,
  detallesVenta,
  movimientosCtaCte,
  movimientosStock,
} from "./db/schema.js";

const app = express();
const PORT = process.env.PORT || 3000;

// El secreto que firma la sesión SOLO viene del .env / variables de Vercel.
// No hay una clave de respaldo escrita en el código.
const SECRET_KEY = process.env.JWT_SECRET as string;
if (!SECRET_KEY) {
  throw new Error("Falta la variable de entorno JWT_SECRET.");
}

// Punto de venta de la numeración (para cambiarlo a 0002 se toca solo esta línea)
const PUNTO_VENTA = "0001";

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// UTILIDADES
// ---------------------------------------------------------------------------

// IMPORTES: en la base de datos y en todos los cálculos del servidor, el dinero se guarda
// como NÚMERO ENTERO EN CENTAVOS ($18.500,50 se guarda como 1850050).
// Motivo: los números con coma flotante no son exactos (0.1 + 0.2 = 0.30000000000000004)
// y esos errores de redondeo se acumularían en facturas y saldos. Con enteros la suma es exacta.
// La API habla en pesos (lo que ve el usuario): se convierte solo al entrar y al salir.
const aCentavos = (pesos: unknown): number => Math.round(Number(pesos) * 100);
const aPesos = (centavos: number): number => centavos / 100;

// Stock mínimo para avisar que hay que reponer un producto (el mismo 20 con que la pantalla pinta el stock en rojo)
const STOCK_MINIMO = 20;

// Las fechas se guardan en UTC; para agrupar las ventas "por día" se pasa cada fecha a la hora de Argentina.
// "en-CA" devuelve el formato AAAA-MM-DD, que se puede comparar y ordenar como texto.
const ZONA_HORARIA = "America/Argentina/Buenos_Aires";
const diaLocal = (fecha: string | Date): string =>
  new Date(fecha).toLocaleDateString("en-CA", { timeZone: ZONA_HORARIA });

// Error "esperado" (stock insuficiente, dato inválido...). Lleva su código HTTP.
class ErrorNegocio extends Error {
  estado: number;
  constructor(estado: number, mensaje: string) {
    super(mensaje);
    this.estado = estado;
  }
}

// ¿El error de la base es por un valor repetido (columna .unique())?
function esDuplicado(error: unknown): boolean {
  const e = error as { message?: string; cause?: { message?: string } };
  return `${e?.message ?? ""} ${e?.cause?.message ?? ""}`.includes("UNIQUE");
}

// Arma la respuesta de error de la API en un solo lugar
function responderError(res: Response, error: unknown, mensajeGenerico: string) {
  if (error instanceof ErrorNegocio) {
    return res.status(error.estado).json({ error: error.message });
  }
  console.error(mensajeGenerico, error);
  return res.status(500).json({ error: mensajeGenerico });
}

// ---------------------------------------------------------------------------
// MIDDLEWARES (filtros que se ejecutan ANTES de la ruta)
// ---------------------------------------------------------------------------

// 1) Exige haber iniciado sesión: verifica el token y que el usuario siga ACTIVO.
async function requiereLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const cabecera = req.headers.authorization;
    if (!cabecera || !cabecera.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Tenés que iniciar sesión." });
    }

    const datos = jwt.verify(cabecera.slice(7), SECRET_KEY) as { id: number };

    // Se consulta la base en cada pedido: si desactivaron al usuario,
    // pierde el acceso al instante aunque su token todavía no venció.
    const [usuario] = await db.select().from(usuarios).where(eq(usuarios.id, datos.id));
    if (!usuario || !usuario.activo) {
      return res.status(401).json({ error: "Usuario inexistente o desactivado." });
    }

    res.locals.usuario = { id: usuario.id, rol: usuario.rol };
    next();
  } catch {
    return res.status(401).json({ error: "Sesión inválida o vencida." });
  }
}

// 2) Exige rol administrador (se usa DESPUÉS de requiereLogin).
function soloAdmin(req: Request, res: Response, next: NextFunction) {
  if (res.locals.usuario?.rol !== "admin") {
    return res.status(403).json({ error: "No tenés permiso para realizar esta acción." });
  }
  next();
}

// ---------------------------------------------------------------------------
// RUTAS
// ---------------------------------------------------------------------------

// Prueba de conexión (pública)
app.get("/", (req, res) => {
  res.json({ mensaje: "Servidor funcionando." });
});

// LOGIN (pública): compara la contraseña con el hash de bcrypt
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Ingresá email y contraseña." });
    }

    const [usuario] = await db.select().from(usuarios).where(eq(usuarios.email, email));

    // Mismo mensaje para "no existe", "inactivo" y "clave mala": no da pistas
    if (!usuario || !usuario.activo || !(await bcrypt.compare(password, usuario.password))) {
      return res.status(401).json({ error: "Email o contraseña incorrectos." });
    }

    const token = jwt.sign({ id: usuario.id, rol: usuario.rol }, SECRET_KEY, { expiresIn: "2h" });

    res.json({
      mensaje: "Login exitoso.",
      token,
      usuario: { nombre: usuario.nombre, rol: usuario.rol },
    });
  } catch (error) {
    responderError(res, error, "Error interno del servidor.");
  }
});

// SESIÓN: devuelve nombre y rol del usuario del token (para recuperar la sesión al recargar)
app.get("/api/me", requiereLogin, async (req, res) => {
  try {
    const [u] = await db
      .select({ nombre: usuarios.nombre, rol: usuarios.rol })
      .from(usuarios)
      .where(eq(usuarios.id, res.locals.usuario.id));
    res.json({ usuario: u });
  } catch (error) {
    responderError(res, error, "Error al consultar la sesión.");
  }
});

// PRODUCTOS -----------------------------------------------------------------

app.get("/api/productos", requiereLogin, async (req, res) => {
  try {
    const lista = await db.select().from(productos);
    // En la base el precio está en centavos; a la pantalla se le responde en pesos
    res.json(lista.map((p) => ({ ...p, precio: aPesos(p.precio) })));
  } catch (error) {
    responderError(res, error, "Error al consultar la base de datos");
  }
});

// Valida y devuelve los datos de un producto (sirve para alta y edición)
function leerProducto(body: any) {
  const { codigo, nombre, precio, stock } = body;
  if (!codigo || !nombre || precio === undefined || stock === undefined) {
    throw new ErrorNegocio(400, "Faltan datos obligatorios.");
  }
  const precioNum = Number(precio);
  const stockNum = Number(stock);
  if (!(precioNum >= 0) || !Number.isInteger(stockNum) || stockNum < 0) {
    throw new ErrorNegocio(400, "El precio y el stock deben ser números válidos (stock entero), mayores o iguales a 0.");
  }
  // El precio entra en pesos y se guarda en centavos enteros
  return { codigo, nombre, precio: aCentavos(precioNum), stock: stockNum };
}

app.post("/api/productos", requiereLogin, soloAdmin, async (req, res) => {
  try {
    const datos = leerProducto(req.body);
    await db.insert(productos).values(datos);
    res.json({ mensaje: "Producto registrado exitosamente." });
  } catch (error) {
    if (esDuplicado(error)) {
      return res.status(409).json({ error: "Ya existe un producto con ese código." });
    }
    responderError(res, error, "Error interno del servidor al guardar el producto.");
  }
});

app.put("/api/productos/:id", requiereLogin, soloAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const datos = leerProducto(req.body);
    await db.update(productos).set(datos).where(eq(productos.id, id));
    res.json({ mensaje: "Producto actualizado exitosamente." });
  } catch (error) {
    if (esDuplicado(error)) {
      return res.status(409).json({ error: "Ya existe otro producto con ese código." });
    }
    responderError(res, error, "Error interno del servidor al actualizar el producto.");
  }
});

// USUARIOS (solo administradores) --------------------------------------------

app.get("/api/usuarios", requiereLogin, soloAdmin, async (req, res) => {
  try {
    const lista = await db
      .select({
        id: usuarios.id,
        nombre: usuarios.nombre,
        email: usuarios.email,
        rol: usuarios.rol,
        activo: usuarios.activo,
      })
      .from(usuarios);
    res.json(lista);
  } catch (error) {
    responderError(res, error, "Error al consultar usuarios.");
  }
});

app.post("/api/usuarios", requiereLogin, soloAdmin, async (req, res) => {
  try {
    const { nombre, email, password, rol } = req.body;
    if (!nombre || !email || !password) {
      return res.status(400).json({ error: "Todos los campos son obligatorios." });
    }
    // La contraseña se guarda ENCRIPTADA (hash), nunca en texto plano
    const hash = await bcrypt.hash(password, 10);
    await db.insert(usuarios).values({ nombre, email, password: hash, rol: rol || "vendedor" });
    res.json({ mensaje: "Usuario registrado exitosamente." });
  } catch (error) {
    if (esDuplicado(error)) {
      return res.status(409).json({ error: "Ya existe un usuario con ese email." });
    }
    responderError(res, error, "Error al registrar usuario.");
  }
});

// Activar / desactivar un usuario
app.put("/api/usuarios/:id/activo", requiereLogin, soloAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { activo } = req.body;
    if (typeof activo !== "boolean") {
      return res.status(400).json({ error: "El campo 'activo' debe ser true o false." });
    }
    if (id === res.locals.usuario.id && activo === false) {
      return res.status(400).json({ error: "No podés desactivarte a vos mismo." });
    }
    await db.update(usuarios).set({ activo }).where(eq(usuarios.id, id));
    res.json({ mensaje: activo ? "Usuario activado." : "Usuario desactivado." });
  } catch (error) {
    responderError(res, error, "Error al actualizar el usuario.");
  }
});

// EDITAR un usuario (solo admin).
// La contraseña es opcional: si viene vacía, se deja la que ya tenía.
app.put("/api/usuarios/:id", requiereLogin, soloAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nombre, email, password, rol } = req.body;

    if (!nombre || !email || !rol) {
      return res.status(400).json({ error: "Nombre, email y rol son obligatorios." });
    }
    if (rol !== "admin" && rol !== "vendedor") {
      return res.status(400).json({ error: "El rol debe ser 'admin' o 'vendedor'." });
    }
    // Evita que un admin se deje a sí mismo sin permisos
    if (id === res.locals.usuario.id && rol !== "admin") {
      return res.status(400).json({ error: "No podés quitarte a vos mismo el rol de administrador." });
    }

    const cambios: { nombre: string; email: string; rol: string; password?: string } = {
      nombre,
      email,
      rol,
    };
    if (password) {
      cambios.password = await bcrypt.hash(password, 10); // siempre encriptada
    }

    await db.update(usuarios).set(cambios).where(eq(usuarios.id, id));
    res.json({ mensaje: "Usuario actualizado exitosamente." });
  } catch (error) {
    if (esDuplicado(error)) {
      return res.status(409).json({ error: "Ya existe otro usuario con ese email." });
    }
    responderError(res, error, "Error al actualizar el usuario.");
  }
});

// ELIMINAR un usuario (solo admin).
// Las ventas no guardan el usuario que las hizo, así que se puede borrar sin romper nada.
// Si el usuario tenía la sesión abierta, pierde el acceso en el siguiente pedido
// (requiereLogin ya no lo encuentra en la base).
app.delete("/api/usuarios/:id", requiereLogin, soloAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (id === res.locals.usuario.id) {
      return res.status(400).json({ error: "No podés eliminar tu propio usuario." });
    }

    await db.delete(usuarios).where(eq(usuarios.id, id));
    res.json({ mensaje: "Usuario eliminado." });
  } catch (error) {
    responderError(res, error, "Error al eliminar el usuario.");
  }
});

// VENTAS --------------------------------------------------------------------

// HISTORIAL: lista todas las ventas con el nombre del cliente (solo administradores)
app.get("/api/ventas", requiereLogin, soloAdmin, async (req, res) => {
  try {
    const lista = await db
      .select({
        id: ventas.id,
        numeroComprobante: ventas.numeroComprobante,
        fecha: ventas.fecha,
        total: ventas.total,
        formaPago: ventas.formaPago,
        anulada: ventas.anulada,
        cliente: clientes.razonSocial,
      })
      .from(ventas)
      .leftJoin(clientes, eq(ventas.clienteId, clientes.id));

    // Las más nuevas primero
    lista.sort((a, b) => b.id - a.id);

    // Si la venta no tiene cliente, fue a "Consumidor Final". El total sale en pesos.
    res.json(
      lista.map((v) => ({ ...v, total: aPesos(v.total), cliente: v.cliente ?? "Consumidor Final" }))
    );
  } catch (error) {
    responderError(res, error, "Error al consultar las ventas.");
  }
});

// El cliente (frontend) manda SOLO: clienteId, formaPago y el carrito con
// idProducto + cantidad. El precio, el subtotal y el total los calcula el servidor.
// La puede usar cualquier usuario con sesión (administrador o vendedor).
app.post("/api/ventas", requiereLogin, async (req, res) => {
  try {
    const { clienteId, formaPago, carrito } = req.body;

    if (!Array.isArray(carrito) || carrito.length === 0) {
      throw new ErrorNegocio(400, "El carrito está vacío.");
    }
    if (!formaPago) {
      throw new ErrorNegocio(400, "Falta la forma de pago.");
    }
    if (formaPago === "cuenta_corriente" && !clienteId) {
      throw new ErrorNegocio(400, "Debe seleccionar un cliente registrado para vender en Cuenta Corriente.");
    }
    for (const item of carrito) {
      if (!Number.isInteger(Number(item.idProducto)) || !Number.isInteger(Number(item.cantidad)) || Number(item.cantidad) < 1) {
        throw new ErrorNegocio(400, "El carrito tiene un renglón inválido.");
      }
    }

    // TODO o NADA: si algo falla adentro, la base deshace todos los pasos (rollback).
    const resultado = await db.transaction(async (tx) => {
      // Límite de crédito del cliente en CENTAVOS (0 = sin límite; también vale para Consumidor Final)
      let limiteCredito = 0;
      if (clienteId) {
        const [cli] = await tx.select().from(clientes).where(eq(clientes.id, Number(clienteId)));
        if (!cli || !cli.activo) throw new ErrorNegocio(400, "El cliente seleccionado no existe.");
        limiteCredito = cli.limiteCredito;
      }

      // Número de factura: se asigna acá, ya adentro de la transacción, y es
      // consecutivo (último id + 1). Si la venta falla, el número no se gasta.
      const [ultimo] = await tx
        .select({ maximo: sql<number>`coalesce(max(${ventas.id}), 0)` })
        .from(ventas);
      const numeroComprobante = `${PUNTO_VENTA}-${String(Number(ultimo.maximo) + 1).padStart(8, "0")}`;
      const fecha = new Date().toISOString();

      // PASO 1: por cada renglón, buscar el PRECIO REAL en la base y descontar stock.
      // Todos los importes son enteros en centavos: las sumas y multiplicaciones son exactas.
      const renglones: { prod: typeof productos.$inferSelect; cantidad: number; subtotal: number }[] = [];
      let total = 0;

      for (const item of carrito) {
        const cantidad = Number(item.cantidad);
        const [prod] = await tx.select().from(productos).where(eq(productos.id, Number(item.idProducto)));
        if (!prod || !prod.activo) {
          throw new ErrorNegocio(400, `El producto ${item.idProducto} no existe.`);
        }

        // Descuento atómico: solo se resta SI alcanza (stock >= cantidad).
        // Si no se modificó ninguna fila, es que no había stock suficiente.
        const actualizado = await tx
          .update(productos)
          .set({ stock: sql`${productos.stock} - ${cantidad}` })
          .where(and(eq(productos.id, prod.id), gte(productos.stock, cantidad)))
          .returning({ id: productos.id });

        if (actualizado.length === 0) {
          throw new ErrorNegocio(400, `Stock insuficiente para el producto: ${prod.nombre}`);
        }

        const subtotal = prod.precio * cantidad; // centavos x unidades = centavos (entero exacto)
        total += subtotal;
        renglones.push({ prod, cantidad, subtotal });
      }

      // LÍMITE DE CRÉDITO: solo aplica a ventas en cuenta corriente de clientes con límite.
      // Si se supera, el error hace que la transacción se DESHAGA sola (el stock que ya
      // se había descontado vuelve atrás), así que no queda nada a medias.
      if (formaPago === "cuenta_corriente" && limiteCredito > 0) {
        // Deuda actual = suma de cargos - suma de abonos
        const [fila] = await tx
          .select({
            saldo: sql<number>`coalesce(sum(case when ${movimientosCtaCte.tipo} = 'cargo' then ${movimientosCtaCte.importe} else -${movimientosCtaCte.importe} end), 0)`,
          })
          .from(movimientosCtaCte)
          .where(eq(movimientosCtaCte.clienteId, Number(clienteId)));
        const deudaActual = Number(fila.saldo);

        if (deudaActual + total > limiteCredito) {
          throw new ErrorNegocio(
            400,
            `La venta supera el límite de crédito del cliente ($${aPesos(limiteCredito)}). ` +
              `Deuda actual: $${aPesos(deudaActual)}. Esta venta: $${aPesos(total)}.`
          );
        }
      }

      // PASO 2: cabecera de la venta
      const [venta] = await tx
        .insert(ventas)
        .values({
          numeroComprobante,
          fecha,
          clienteId: clienteId ? Number(clienteId) : null,
          total,
          formaPago,
        })
        .returning();

      // PASO 3: renglones + movimiento de stock (queda auditado)
      for (const r of renglones) {
        await tx.insert(detallesVenta).values({
          ventaId: venta.id,
          productoId: r.prod.id,
          cantidad: r.cantidad,
          precioUnitario: r.prod.precio, // precio histórico del momento (centavos)
          nombreProducto: r.prod.nombre,
          subtotal: r.subtotal,
        });

        await tx.insert(movimientosStock).values({
          productoId: r.prod.id,
          cantidad: -r.cantidad, // negativo = salida
          motivo: `Venta ${numeroComprobante}`,
          fecha,
        });
      }

      // PASO 4: si es cuenta corriente, se registra la deuda (cargo)
      if (formaPago === "cuenta_corriente") {
        await tx.insert(movimientosCtaCte).values({
          clienteId: Number(clienteId),
          fecha,
          tipo: "cargo",
          importe: total,
          observacion: `Venta ${numeroComprobante}`,
          ventaId: venta.id,
        });
      }

      return { comprobante: numeroComprobante, ventaId: venta.id, total: aPesos(total) };
    });

    res.json({ mensaje: "Venta confirmada y stock actualizado.", ...resultado });
  } catch (error) {
    responderError(res, error, "Error interno del servidor al procesar la venta.");
  }
});

// ANULAR una venta: no se borra nada, se marca como anulada y se revierte todo.
app.post("/api/ventas/:id/anular", requiereLogin, soloAdmin, async (req, res) => {
  try {
    const ventaId = Number(req.params.id);

    await db.transaction(async (tx) => {
      const [venta] = await tx.select().from(ventas).where(eq(ventas.id, ventaId));
      if (!venta) throw new ErrorNegocio(404, "La venta no existe.");
      if (venta.anulada) throw new ErrorNegocio(400, "La venta ya estaba anulada.");

      const fecha = new Date().toISOString();
      const renglones = await tx.select().from(detallesVenta).where(eq(detallesVenta.ventaId, ventaId));

      // Devolver el stock y dejarlo asentado
      for (const r of renglones) {
        await tx
          .update(productos)
          .set({ stock: sql`${productos.stock} + ${r.cantidad}` })
          .where(eq(productos.id, r.productoId));

        await tx.insert(movimientosStock).values({
          productoId: r.productoId,
          cantidad: r.cantidad, // positivo = entrada
          motivo: `Anulación ${venta.numeroComprobante}`,
          fecha,
        });
      }

      // Si era cuenta corriente, se compensa la deuda con un "abono" (queda el historial)
      if (venta.formaPago === "cuenta_corriente" && venta.clienteId) {
        await tx.insert(movimientosCtaCte).values({
          clienteId: venta.clienteId,
          fecha,
          tipo: "abono",
          importe: venta.total,
          observacion: `Anulación ${venta.numeroComprobante}`,
          ventaId,
        });
      }

      await tx.update(ventas).set({ anulada: true }).where(eq(ventas.id, ventaId));
    });

    res.json({ mensaje: "Venta anulada correctamente." });
  } catch (error) {
    responderError(res, error, "Error al anular la venta.");
  }
});

// PANEL DE INICIO ------------------------------------------------------------

// Resumen del negocio para la pantalla principal (solo administradores).
// Todo se calcula con las ventas NO anuladas. Internamente se suma en centavos
// y los importes salen en pesos.
app.get("/api/dashboard", requiereLogin, soloAdmin, async (req, res) => {
  try {
    const hoy = diaLocal(new Date());
    const mes = hoy.slice(0, 7); // "AAAA-MM"

    const todasVentas = await db.select().from(ventas);
    const validas = todasVentas
      .filter((v) => !v.anulada)
      .map((v) => ({ id: v.id, total: v.total, formaPago: v.formaPago, dia: diaLocal(v.fecha) }));
    const deHoy = validas.filter((v) => v.dia === hoy);
    const delMes = validas.filter((v) => v.dia.startsWith(mes));
    const sumar = (lista: { total: number }[]) => lista.reduce((acc, v) => acc + v.total, 0);

    // Ventas de los últimos 30 días (incluye hoy): un dato por día, aunque no haya ventas
    const ventasDiarias: { fecha: string; total: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const dia = diaLocal(new Date(Date.now() - i * 24 * 60 * 60 * 1000));
      ventasDiarias.push({ fecha: dia, total: aPesos(sumar(validas.filter((v) => v.dia === dia))) });
    }

    // Ventas del mes agrupadas por forma de pago
    const porPago = new Map<string, number>();
    for (const v of delMes) {
      porPago.set(v.formaPago, (porPago.get(v.formaPago) ?? 0) + v.total);
    }

    // Deuda en cuentas corrientes: por cliente, cargos - abonos; se cuentan los que deben algo
    const movimientos = await db.select().from(movimientosCtaCte);
    const saldos = new Map<number, number>();
    for (const m of movimientos) {
      saldos.set(m.clienteId, (saldos.get(m.clienteId) ?? 0) + (m.tipo === "cargo" ? m.importe : -m.importe));
    }
    const saldosConDeuda = Array.from(saldos.values()).filter((s) => s > 0);

    // Productos más vendidos del mes (por unidades), con las ventas no anuladas
    const idsDelMes = new Set(delMes.map((v) => v.id));
    const detalles = await db.select().from(detallesVenta);
    const listaProductos = await db.select().from(productos);
    const acumulado = new Map<number, { nombre: string; unidades: number; importe: number }>();
    for (const d of detalles) {
      if (!idsDelMes.has(d.ventaId)) continue;
      const actual = acumulado.get(d.productoId) ?? { nombre: d.nombreProducto, unidades: 0, importe: 0 };
      actual.unidades += d.cantidad;
      actual.importe += d.subtotal;
      acumulado.set(d.productoId, actual);
    }
    const masVendidos = Array.from(acumulado.entries())
      .map(([productoId, a]) => ({
        codigo: listaProductos.find((p) => p.id === productoId)?.codigo ?? "-",
        nombre: a.nombre,
        unidades: a.unidades,
        importe: aPesos(a.importe),
      }))
      .sort((a, b) => b.unidades - a.unidades)
      .slice(0, 5);

    // Productos por debajo del stock mínimo, los más críticos primero
    const bajoStock = listaProductos
      .filter((p) => p.activo && p.stock < STOCK_MINIMO)
      .sort((a, b) => a.stock - b.stock)
      .map((p) => ({ id: p.id, codigo: p.codigo, nombre: p.nombre, stock: p.stock }));

    res.json({
      ventasHoy: { total: aPesos(sumar(deHoy)), cantidad: deHoy.length },
      ventasMes: {
        total: aPesos(sumar(delMes)),
        cantidad: delMes.length,
        ticketPromedio: delMes.length > 0 ? aPesos(Math.round(sumar(delMes) / delMes.length)) : 0,
      },
      deuda: {
        total: aPesos(saldosConDeuda.reduce((acc, s) => acc + s, 0)),
        clientesConSaldo: saldosConDeuda.length,
      },
      stockMinimo: STOCK_MINIMO,
      bajoStock,
      ventasDiarias,
      porFormaPago: Array.from(porPago.entries()).map(([formaPago, total]) => ({
        formaPago,
        total: aPesos(total),
      })),
      masVendidos,
    });
  } catch (error) {
    responderError(res, error, "Error al calcular el panel de inicio.");
  }
});

// CLIENTES Y CUENTA CORRIENTE ------------------------------------------------

// La lista la puede pedir cualquier usuario con sesión (la venta necesita elegir cliente),
// pero el vendedor recibe solo los datos básicos, sin saldos ni límites.
app.get("/api/clientes", requiereLogin, async (req, res) => {
  try {
    const listaClientes = await db.select().from(clientes);
    const todosMovimientos = await db.select().from(movimientosCtaCte);

    const clientesConSaldo = listaClientes.map((cli) => {
      const movs = todosMovimientos.filter((m) => m.clienteId === cli.id);
      // El saldo se CALCULA (cargos - abonos), no se guarda. Se suma en centavos (enteros).
      const saldo = movs.reduce((acc, m) => (m.tipo === "cargo" ? acc + m.importe : acc - m.importe), 0);
      return { ...cli, saldo: aPesos(saldo), limiteCredito: aPesos(cli.limiteCredito) };
    });

    // El vendedor solo necesita elegir al cliente, no ver cuánto debe
    if (res.locals.usuario.rol !== "admin") {
      return res.json(
        clientesConSaldo.map((c) => ({ id: c.id, razonSocial: c.razonSocial, documento: c.documento }))
      );
    }
    res.json(clientesConSaldo);
  } catch (error) {
    responderError(res, error, "Error al consultar clientes.");
  }
});

app.post("/api/clientes", requiereLogin, soloAdmin, async (req, res) => {
  try {
    const { razonSocial, documento, contacto } = req.body;
    // Si no mandan límite, queda en 0 (= sin límite)
    const limitePesos = Number(req.body.limiteCredito ?? 0);

    if (!razonSocial || !documento) {
      return res.status(400).json({ error: "Razón social y documento son obligatorios." });
    }
    if (!(limitePesos >= 0)) {
      return res.status(400).json({ error: "El límite de crédito debe ser un número mayor o igual a 0." });
    }

    await db
      .insert(clientes)
      .values({ razonSocial, documento, contacto, limiteCredito: aCentavos(limitePesos) });
    res.json({ mensaje: "Cliente registrado exitosamente." });
  } catch (error) {
    if (esDuplicado(error)) {
      return res.status(409).json({ error: "Ya existe un cliente con ese documento." });
    }
    responderError(res, error, "Error al registrar cliente.");
  }
});

// Cambia el límite de crédito de un cliente que ya existe (0 = sin límite)
app.put("/api/clientes/:id/limite", requiereLogin, soloAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const limitePesos = Number(req.body.limiteCredito);

    if (!(limitePesos >= 0)) {
      throw new ErrorNegocio(400, "El límite de crédito debe ser un número mayor o igual a 0.");
    }

    const [cli] = await db.select().from(clientes).where(eq(clientes.id, id));
    if (!cli) throw new ErrorNegocio(404, "El cliente no existe.");

    await db.update(clientes).set({ limiteCredito: aCentavos(limitePesos) }).where(eq(clientes.id, id));
    res.json({ mensaje: "Límite de crédito actualizado." });
  } catch (error) {
    responderError(res, error, "Error al actualizar el límite de crédito.");
  }
});

app.get("/api/clientes/:id/movimientos", requiereLogin, soloAdmin, async (req, res) => {
  try {
    const clienteId = Number(req.params.id);
    const movimientos = await db
      .select()
      .from(movimientosCtaCte)
      .where(eq(movimientosCtaCte.clienteId, clienteId));
    // Los importes están en centavos; a la pantalla se le responde en pesos
    res.json(movimientos.map((m) => ({ ...m, importe: aPesos(m.importe) })));
  } catch (error) {
    responderError(res, error, "Error al obtener movimientos de cuenta corriente.");
  }
});

// Registrar un pago (abono). No puede ser mayor que la deuda.
app.post("/api/clientes/:id/pagos", requiereLogin, soloAdmin, async (req, res) => {
  try {
    const clienteId = Number(req.params.id);
    const importe = aCentavos(req.body.importe); // llega en pesos, se trabaja en centavos
    const observacion = req.body.observacion;

    if (!(importe > 0)) {
      throw new ErrorNegocio(400, "El importe del pago debe ser mayor a 0.");
    }

    await db.transaction(async (tx) => {
      const [cli] = await tx.select().from(clientes).where(eq(clientes.id, clienteId));
      if (!cli) throw new ErrorNegocio(404, "El cliente no existe.");

      // Deuda actual (en centavos) = suma de cargos - suma de abonos
      const [fila] = await tx
        .select({
          saldo: sql<number>`coalesce(sum(case when ${movimientosCtaCte.tipo} = 'cargo' then ${movimientosCtaCte.importe} else -${movimientosCtaCte.importe} end), 0)`,
        })
        .from(movimientosCtaCte)
        .where(eq(movimientosCtaCte.clienteId, clienteId));
      const saldo = Number(fila.saldo);

      if (importe > saldo) {
        throw new ErrorNegocio(
          400,
          `El pago ($${aPesos(importe)}) no puede ser mayor que la deuda actual ($${aPesos(saldo)}).`
        );
      }

      await tx.insert(movimientosCtaCte).values({
        clienteId,
        fecha: new Date().toISOString(),
        tipo: "abono",
        importe,
        observacion: observacion || "Pago recibido en caja",
      });
    });

    res.json({ mensaje: "Pago registrado correctamente." });
  } catch (error) {
    responderError(res, error, "Error al registrar el pago.");
  }
});

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });
}

export default app;